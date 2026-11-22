"""Versioned public metadata snapshots, never model/data/database archives.

The generator uses the existing read-only readers. The runtime checks the
canonical payload/manifest digests and prefers mounted sources, including
reporting a mounted corrupt file instead of hiding it with old metadata.
Checksums establish integrity and provenance, not publisher authentication.
"""

import hashlib
import json
import math
import os
import re
from datetime import UTC, datetime
from pathlib import Path

SCHEMA_VERSION = 1
MAX_BYTES = 8 * 1024 * 1024
DEFAULT_MAX_AGE = 30 * 24 * 60 * 60
PUBLIC_MODELS = {
    "SolarVision-ResNet18-PVF10", "SolarVision-ViT-Tiny-PVF10",
    "SolarVision-YOLO11n-Panel-Detection", "SolarVision-YOLO11n-Defect-Detection",
}
PUBLIC_EXPERIMENTS = {
    "Default", "SolarVision-PVF10-Classification", "SolarVision-YOLO-Detection",
}
PUBLIC_TRAINING_RUNS = {"ResNet18-PVF10-Grouped", "ViT-Tiny-PVF10-Grouped"}
SHA256 = re.compile(r"[a-f0-9]{64}")


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"), allow_nan=False).encode()


def checksum(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def file_sha256(path):
    with path.open("rb") as stream:
        value = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def allowed_sources():
    from src.api.dashboard import CHECKPOINTS, DATASETS, EVALUATIONS, TRAINING_CSVS
    return {
        *(item[3] for item in EVALUATIONS),
        *(f"data/raw/{identifier}.dvc" for identifier, _ in DATASETS),
        *(f"{item[2]}.dvc" for item in CHECKPOINTS),
        *TRAINING_CSVS, "reports/data_validation/raw_data_validation.json",
        "data/processed/pvf10_grouped/split_summary.json", "mlflow.db",
        ".dvc/config", ".dvc/config.local", ".github/workflows/ci.yml",
    }


def _public_payload(data):
    """Reconstruct the fixed public contract; never copy arbitrary MLflow fields."""
    mlops = data["mlops"]
    registry = [row for row in mlops["mlflow"]["registry"] if row["name"] in PUBLIC_MODELS]
    run_ids = {row["run_id"] for row in registry}
    experiments = [row for row in mlops["mlflow"]["experiments"] if row["name"] in PUBLIC_EXPERIMENTS]
    experiment_ids = {row["id"] for row in experiments}
    runs = [row for row in mlops["mlflow"]["runs"] if row["experiment_id"] in experiment_ids
            and (row["id"] in run_ids or row["name"] in PUBLIC_TRAINING_RUNS)]
    return {
        "evaluations": data["evaluations"],
        "datasets": [dict(row, local_available=False) for row in data["datasets"]],
        "mlops": {
            "dvc": {key: mlops["dvc"][key] for key in (
                "status", "tracked_datasets", "remote_configured", "remote_names",
                "remote_accessible", "artifacts_synchronized", "explanation")},
            "mlflow": {
                "status": mlops["mlflow"]["status"], "source": "mlflow.db",
                "experiments": experiments, "runs": runs, "registry": registry,
                "explanation": "Recorded local SQLite metadata; no MLflow tracking-server connectivity was checked.",
            },
            "training_runs": mlops["training_runs"], "ci": mlops["ci"],
        },
    }


def _require(condition):
    if not condition:
        raise ValueError("Snapshot does not match the public metadata contract")


def _object(value, fields):
    _require(isinstance(value, dict) and set(value) == set(fields))


def _text(value, limit=500, nullable=False):
    _require((nullable and value is None) or (isinstance(value, str) and 0 < len(value) <= limit))


def _integer(value, nullable=False):
    _require((nullable and value is None) or (type(value) is int and value >= 0))


def _numbers(values):
    _require(isinstance(values, dict) and len(values) <= 100)
    for key, value in values.items():
        _text(key, 250)
        _require(type(value) in (int, float) and math.isfinite(value))


def validate_payload(payload, sources):
    """Validate both shape and semantics before any snapshot value is displayed."""
    from src.api.dashboard import DATASETS, EVALUATIONS, TRAINING_CSVS
    _object(payload, ("evaluations", "datasets", "mlops"))
    _require(isinstance(payload["evaluations"], list) and len(payload["evaluations"]) == 4)
    expected = {identifier: (name, task, path) for identifier, name, task, path in EVALUATIONS}
    _require({row.get("id") for row in payload["evaluations"] if isinstance(row, dict)} == set(expected))
    for row in payload["evaluations"]:
        _object(row, ("id", "name", "task", "status", "source", "recorded_at", "metrics", "explanation"))
        name, task, source = expected[row["id"]]
        _require((row["name"], row["task"], row["source"]) == (name, task, source))
        _require(row["status"] in {"available", "unavailable"})
        _text(row["recorded_at"], nullable=True)
        _text(row["explanation"], 1000, nullable=True)
        _numbers(row["metrics"])
        keys = {"accuracy", "macro_precision", "macro_recall", "macro_f1"} if task == "classification" else {"precision", "recall", "map50", "map50_95"}
        if row["status"] == "available":
            _require(source in sources and keys.issubset(row["metrics"]) and all(0 <= row["metrics"][key] <= 1 for key in keys))
        else:
            _require(not row["metrics"])
    _require(isinstance(payload["datasets"], list) and len(payload["datasets"]) == 7)
    expected = dict(DATASETS)
    _require({row.get("id") for row in payload["datasets"] if isinstance(row, dict)} == set(expected))
    for row in payload["datasets"]:
        _object(row, ("id", "name", "path", "dvc_file", "status", "version", "size_bytes", "file_count", "local_available", "statistics", "statistics_source", "split_summary", "explanation"))
        path = f"data/raw/{row['id']}"
        _require((row["name"], row["path"], row["dvc_file"]) == (expected[row["id"]], path, f"{path}.dvc"))
        _require(row["local_available"] is False)
        _require(row["status"] in {"available", "unavailable"})
        _require(row["version"] is None or bool(re.fullmatch(r"[a-f0-9]{32}\.dir", row["version"])))
        _integer(row["size_bytes"], True)
        _integer(row["file_count"], True)
        if row["status"] == "available":
            _require(row["dvc_file"] in sources and row["version"] is not None)
        _require(isinstance(row["statistics"], dict) and set(row["statistics"]).issubset({"images", "total_files", "corrupted_count"}))
        for count in row["statistics"].values():
            _integer(count)
        if row["statistics"]:
            _require(row["statistics_source"] == "reports/data_validation/raw_data_validation.json" and row["statistics_source"] in sources)
        else:
            _require(row["statistics_source"] is None)
        _text(row["explanation"], 1000, nullable=True)
        splits = row["split_summary"]
        if splits is not None:
            _require(row["id"] == "pvf10" and set(splits) == {"train", "val", "test"} and "data/processed/pvf10_grouped/split_summary.json" in sources)
            for split in splits.values():
                _require(set(split).issubset({"images", "groups", "classes"}) and {"images", "classes"}.issubset(split))
                _integer(split["images"])
                if "groups" in split:
                    _integer(split["groups"])
                _require(isinstance(split["classes"], dict) and len(split["classes"]) <= 100)
                for cls, count in split["classes"].items():
                    _text(cls, 100)
                    _integer(count)
                _require(sum(split["classes"].values()) == split["images"])
    mlops = payload["mlops"]
    _object(mlops, ("dvc", "mlflow", "training_runs", "ci"))
    dvc = mlops["dvc"]
    _object(dvc, ("status", "tracked_datasets", "remote_configured", "remote_names", "remote_accessible", "artifacts_synchronized", "explanation"))
    _require(dvc["status"] in {"available", "not_configured"})
    _integer(dvc["tracked_datasets"])
    _require(dvc["tracked_datasets"] == sum(row["version"] is not None for row in payload["datasets"]))
    _require(isinstance(dvc["remote_names"], list) and len(dvc["remote_names"]) <= 100)
    for name in dvc["remote_names"]:
        _require(isinstance(name, str) and bool(re.fullmatch(r"[\w.-]{1,100}", name)))
    _require(type(dvc["remote_configured"]) is bool and dvc["remote_configured"] == bool(dvc["remote_names"]))
    _require(dvc["remote_accessible"] is None and dvc["artifacts_synchronized"] is None)
    _text(dvc["explanation"], 1000, nullable=True)
    flow = mlops["mlflow"]
    _object(flow, ("status", "source", "experiments", "runs", "registry", "explanation"))
    _require(flow["status"] in {"available", "unavailable", "not_configured"} and flow["source"] == "mlflow.db")
    _text(flow["explanation"], 1000)
    for key in ("experiments", "runs", "registry"):
        _require(isinstance(flow[key], list) and len(flow[key]) <= 100)
    for row in flow["experiments"]:
        _object(row, ("id", "name"))
        _text(row["id"], 100)
        _require(row["name"] in PUBLIC_EXPERIMENTS)
    for row in flow["registry"]:
        _object(row, ("name", "version", "stage", "status", "run_id"))
        _require(row["name"] in PUBLIC_MODELS)
        _integer(row["version"])
        _require(row["version"] >= 1)
        for key in ("stage", "status"):
            _text(row[key], 100)
        _text(row["run_id"], 100, True)
    _require(len({(row["name"], row["version"]) for row in flow["registry"]}) == len(flow["registry"]))
    if flow["status"] == "available":
        _require("mlflow.db" in sources)
    for row in flow["runs"]:
        _object(row, ("id", "name", "experiment_id", "status", "start_time", "end_time", "metrics"))
        for key in ("id", "name", "experiment_id", "status"):
            _text(row[key], 250)
        _require(row["experiment_id"] in {e["id"] for e in flow["experiments"]})
        _require(row["name"] in PUBLIC_TRAINING_RUNS or row["id"] in {r["run_id"] for r in flow["registry"]})
        for key in ("start_time", "end_time"):
            _integer(row[key], True)
        _numbers(row["metrics"])
    _require(isinstance(mlops["training_runs"], list) and len(mlops["training_runs"]) <= len(TRAINING_CSVS))
    _require(len({row.get("source") for row in mlops["training_runs"] if isinstance(row, dict)}) == len(mlops["training_runs"]))
    for row in mlops["training_runs"]:
        _object(row, ("id", "name", "source", "epochs", "last_metrics", "recorded_at"))
        _require(row["source"] in TRAINING_CSVS and row["source"] in sources)
        _require(row["id"] == row["name"] == Path(row["source"]).parent.name)
        _integer(row["epochs"])
        _numbers(row["last_metrics"])
        _text(row["recorded_at"], nullable=True)
    ci = mlops["ci"]
    _object(ci, ("configured", "source", "execution_status", "explanation"))
    _require(type(ci["configured"]) is bool and ci["source"] == ".github/workflows/ci.yml" and ci["execution_status"] == "not_checked")
    _require(not ci["configured"] or ci["source"] in sources)
    _text(ci["explanation"], 1000)


def create_snapshot(root):
    """Read the fixed sources twice to reject concurrent changes during capture."""
    from src.api.dashboard import build_dashboard
    sources = [{"path": path, "sha256": file_sha256(root / path)} for path in sorted(allowed_sources()) if (root / path).is_file()]
    payload = _public_payload(build_dashboard(root, use_snapshot=False))
    for source in sources:
        if file_sha256(root / source["path"]) != source["sha256"]:
            raise ValueError("A metadata source changed during snapshot capture; retry after the write completes")
    validate_payload(payload, {source["path"] for source in sources})
    snapshot = {"schema_version": SCHEMA_VERSION, "generated_at": datetime.now(UTC).isoformat(),
                "sources": sources, "payload": payload, "payload_sha256": checksum(payload)}
    snapshot["manifest_sha256"] = checksum({key: value for key, value in snapshot.items() if key != "payload"})
    return snapshot


def read_snapshot(root, path):
    info = {"status": "absent", "path": "configs/dashboard-snapshot.json", "generated_at": None,
            "age_seconds": None, "freshness": "unknown", "payload_sha256": None, "sources": [],
            "explanation": "No public metadata snapshot is configured at this path."}
    try:
        with path.open("rb") as stream:
            raw = stream.read(MAX_BYTES + 1)
        _require(len(raw) <= MAX_BYTES)
        envelope = json.loads(raw)
        _object(envelope, ("schema_version", "generated_at", "sources", "payload", "payload_sha256", "manifest_sha256"))
        _require(type(envelope["schema_version"]) is int and envelope["schema_version"] == SCHEMA_VERSION)
        _require(envelope["payload_sha256"] == checksum(envelope["payload"]))
        _require(envelope["manifest_sha256"] == checksum({key: value for key, value in envelope.items() if key not in {"payload", "manifest_sha256"}}))
        captured = datetime.fromisoformat(envelope["generated_at"])
        _require(captured.tzinfo is not None)
        age = (datetime.now(UTC) - captured).total_seconds()
        _require(age >= -300)
        _require(isinstance(envelope["sources"], list) and len(envelope["sources"]) <= len(allowed_sources()))
        source_paths = set()
        for source in envelope["sources"]:
            _object(source, ("path", "sha256"))
            _require(source["path"] in allowed_sources() and source["path"] not in source_paths)
            _require(isinstance(source["sha256"], str) and bool(SHA256.fullmatch(source["sha256"])))
            source_paths.add(source["path"])
        validate_payload(envelope["payload"], source_paths)
        max_age = int(os.environ.get("SOLARVISION_DASHBOARD_SNAPSHOT_MAX_AGE_SECONDS", DEFAULT_MAX_AGE))
        _require(max_age > 0)
        states = []
        for source in envelope["sources"]:
            source_path = root / source["path"]
            try:
                state = "matches" if file_sha256(source_path) == source["sha256"] else "changed"
            except FileNotFoundError:
                state = "not_mounted"
            except OSError:
                state = "unreadable"
            states.append(dict(source, runtime_state=state))
        info.update(status="valid", generated_at=envelope["generated_at"], age_seconds=round(max(age, 0)),
                    freshness="current" if age <= max_age else "stale", payload_sha256=envelope["payload_sha256"],
                    sources=states, explanation="Verified public metadata snapshot. Original sources may be unmounted or changed; this does not verify remote services or artifact synchronization.")
        return envelope["payload"], info
    except FileNotFoundError:
        return None, info
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, OverflowError):
        info.update(status="invalid", explanation="Public metadata snapshot failed its schema, digest, or timestamp checks; no snapshot values are used.")
        return None, info


def apply_snapshot(data, root, path):
    payload, info = read_snapshot(root, path)
    used = set()

    def provenance(row, source):
        row["metadata_source"] = source
        used.add(source)
        if source == "snapshot":
            row["explanation"] = (row.get("explanation") or "Recorded project metadata.") + f" Snapshot captured {info['generated_at']}; runtime source availability is listed separately."
        return row

    for index, row in enumerate(data["evaluations"]):
        source = "runtime" if (root / row["source"]).exists() else "unavailable"
        if source == "unavailable" and payload:
            row = next(item.copy() for item in payload["evaluations"] if item["id"] == row["id"])
            source = "snapshot" if row["status"] == "available" else "unavailable"
        data["evaluations"][index] = provenance(row, source)
    for index, row in enumerate(data["datasets"]):
        runtime_row = row
        source = "runtime" if (root / row["dvc_file"]).exists() else "unavailable"
        saved = next((item for item in payload["datasets"] if item["id"] == row["id"]), None) if payload else None
        if source == "unavailable" and saved and saved["status"] == "available":
            row = dict(saved, local_available=row["local_available"])
            source = "snapshot"
        # Descriptor, validation report and split summary are independent
        # sources. A mounted report always wins, even when the descriptor is
        # unmounted or the report is corrupt. Do not mask invalid inputs with
        # an older snapshot, or mix an updated DVC version's missing counts.
        compatible = saved and row["version"] == saved["version"]
        if (root / "reports/data_validation/raw_data_validation.json").exists():
            row.update(statistics=runtime_row["statistics"], statistics_source=runtime_row["statistics_source"],
                       statistics_metadata_source="runtime")
        elif compatible and saved["statistics"]:
            row.update(statistics=saved["statistics"], statistics_source=saved["statistics_source"],
                       statistics_metadata_source="snapshot")
        else:
            row.update(statistics={}, statistics_source=None, statistics_metadata_source="unavailable")
        if row["id"] == "pvf10" and (root / "data/processed/pvf10_grouped/split_summary.json").exists():
            row.update(split_summary=runtime_row["split_summary"], split_metadata_source="runtime")
        elif compatible and saved["split_summary"]:
            row.update(split_summary=saved["split_summary"], split_metadata_source="snapshot")
        else:
            row.update(split_summary=None, split_metadata_source="unavailable")
        used.update((row["statistics_metadata_source"], row["split_metadata_source"]))
        data["datasets"][index] = provenance(row, source)
    mlops = data["mlops"]
    flow = mlops["mlflow"]
    source = "runtime" if (root / "mlflow.db").exists() else "unavailable"
    if source == "unavailable" and payload and payload["mlops"]["mlflow"]["status"] == "available":
        flow = dict(payload["mlops"]["mlflow"])
        flow["source"] = "configs/dashboard-snapshot.json (recorded mlflow.db metadata)"
        source = "snapshot"
    mlops["mlflow"] = provenance(flow, source)
    current_runs = {row["source"]: row for row in mlops["training_runs"]}
    if payload:
        for row in payload["mlops"]["training_runs"]:
            if not (root / row["source"]).exists():
                current_runs[row["source"]] = provenance(dict(row), "snapshot")
    mlops["training_runs"] = [row if "metadata_source" in row else provenance(row, "runtime") for row in current_runs.values()]
    ci = mlops["ci"]
    source = "runtime" if (root / ci["source"]).exists() else "unavailable"
    if source == "unavailable" and payload and payload["mlops"]["ci"]["configured"]:
        ci = dict(payload["mlops"]["ci"])
        source = "snapshot"
    mlops["ci"] = provenance(ci, source)
    dvc = mlops["dvc"]
    if dvc["configuration_source"] == "unavailable" and not dvc["configuration_files_present"] and payload:
        saved = payload["mlops"]["dvc"]
        dvc.update(remote_configured=saved["remote_configured"], remote_names=saved["remote_names"],
                   configuration_source="snapshot")
        used.add("snapshot")
    dvc["tracked_datasets"] = sum(row["version"] is not None for row in data["datasets"])
    if dvc["tracked_datasets"]:
        dvc["status"] = "available"
    mlops["dvc"] = provenance(dvc, dvc["configuration_source"])
    modes = used - {"unavailable"}
    data["metadata"] = {"mode": "mixed" if len(modes) > 1 else next(iter(modes), "unavailable"), "snapshot": info}
    return data
