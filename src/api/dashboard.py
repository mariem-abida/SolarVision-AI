"""Read-only, allowlisted project metadata and process-local API telemetry.

No endpoint accepts a filename, SQL statement, shell command, or remote URL.
Missing artifacts are reported explicitly rather than replaced by demo data.
"""

import configparser
import csv
import json
import math
import re
import sqlite3
import threading
import time
from collections import deque
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter

ROOT = Path(__file__).resolve().parents[2]
router = APIRouter(tags=["dashboard"])
MAX_METADATA_BYTES = 8 * 1024 * 1024

DATASETS = (
    ("panel_detection", "Panel Detection"),
    ("defect_detection", "Defect Detection"),
    ("pvf10", "PVF-10"),
    ("infrared_solar_modules", "Infrared Solar Modules"),
    ("external_validation", "External Validation"),
    ("rgb_thermal", "RGB / Thermal"),
    ("thermal_json_samples", "Thermal JSON Samples"),
)
EVALUATIONS = (
    ("panels", "YOLO11n Panel Detection", "detection", "reports/detection/panel/test_metrics.json"),
    ("defects", "YOLO11n Defect Detection", "detection", "reports/detection/defect/test_metrics.json"),
    ("resnet18", "ResNet18", "classification", "reports/classification/resnet18/test_metrics.json"),
    ("vit_tiny", "ViT-Tiny", "classification", "reports/classification/vit_tiny/test_metrics.json"),
)
CHECKPOINTS = (
    ("panels", "YOLO11n Panel Detection", "runs/detect/runs/solarvision/panel_detection_full/weights/best.pt", True),
    ("defects", "YOLO11n Defect Detection", "runs/solarvision/defect_detection_full-2/weights/best.pt", True),
    ("resnet18", "ResNet18", "models/classification/resnet18_best.pth", True),
    ("vit_tiny", "ViT-Tiny", "models/classification/vit_tiny_best.pth", False),
)
TRAINING_CSVS = (
    "runs/detect/runs/solarvision/panel_detection_full/results.csv",
    "runs/detect/runs/solarvision/panel_detection_pilot/results.csv",
    "runs/solarvision/defect_detection_full-2/results.csv",
    "runs/solarvision/defect_detection_full/results.csv",
    "runs/solarvision/defect_detection_pilot/results.csv",
)


def _now():
    return datetime.now(UTC).isoformat()


def _modified(path):
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat()
    except OSError:
        return None


def _read_text(path):
    # Bound reads independently of dataset/model sizes; never deserialize weights.
    with path.open("rb") as stream:
        content = stream.read(MAX_METADATA_BYTES + 1)
    if len(content) > MAX_METADATA_BYTES:
        raise ValueError("Metadata file exceeds the read limit")
    return content.decode("utf-8-sig")


def _json(path):
    return json.loads(_read_text(path))


def _numbers(value):
    if not isinstance(value, dict):
        return {}
    return {
        str(key)[:250]: number
        for key, number in value.items()
        if isinstance(number, (int, float))
        and not isinstance(number, bool)
        and math.isfinite(number)
    }


def _dvc_metadata(path):
    """Read only the small scalar fields emitted by DVC's .dvc descriptors."""
    try:
        text = _read_text(path)
        digest = re.search(r"^\s*-?\s*md5:\s*([a-f0-9]{32}(?:\.dir)?)\s*$", text, re.MULTILINE)
        size = re.search(r"^\s*size:\s*(\d+)\s*$", text, re.MULTILINE)
        count = re.search(r"^\s*nfiles:\s*(\d+)\s*$", text, re.MULTILINE)
        return {
            "version": digest.group(1) if digest else None,
            "size_bytes": int(size.group(1)) if size else None,
            "file_count": int(count.group(1)) if count else None,
        }
    except (OSError, UnicodeError, ValueError):
        return {"version": None, "size_bytes": None, "file_count": None}


def _evaluations(root):
    result = []
    expected = {
        "classification": {"accuracy", "macro_precision", "macro_recall", "macro_f1"},
        "detection": {"precision", "recall", "map50", "map50_95"},
    }
    for identifier, name, task, source in EVALUATIONS:
        path = root / source
        try:
            metrics = _numbers(_json(path))
            valid = expected[task].issubset(metrics) and all(
                0 <= metrics[key] <= 1 for key in expected[task]
            )
        except (OSError, ValueError, UnicodeError):
            metrics, valid = {}, False
        result.append({
            "id": identifier, "name": name, "task": task,
            "status": "available" if valid else "unavailable", "source": source,
            "recorded_at": _modified(path), "metrics": metrics if valid else {},
            "explanation": "Historical test evaluation; recorded_at is the report file timestamp."
            if valid else "The test evaluation report is missing or invalid.",
        })
    return result


def _datasets(root):
    statistics_source = "reports/data_validation/raw_data_validation.json"
    try:
        raw_statistics = _json(root / statistics_source)
        statistics = {
            item["dataset"]: item for item in raw_statistics
            if isinstance(item, dict) and isinstance(item.get("dataset"), str)
        } if isinstance(raw_statistics, list) else {}
    except (OSError, ValueError, UnicodeError):
        statistics = {}
    try:
        raw_splits = _json(root / "data/processed/pvf10_grouped/split_summary.json")
        splits = {}
        for split in ("train", "val", "test"):
            info = raw_splits[split]
            if not isinstance(info.get("images"), int) or info["images"] < 0:
                raise ValueError("Invalid grouped split count")
            splits[split] = {
                "images": info["images"],
                "classes": _numbers(info.get("classes")),
            }
            if isinstance(info.get("groups"), int):
                splits[split]["groups"] = info["groups"]
    except (OSError, ValueError, UnicodeError, KeyError, TypeError, AttributeError):
        splits = None

    result = []
    for identifier, name in DATASETS:
        relative_path = f"data/raw/{identifier}"
        dvc_file = f"{relative_path}.dvc"
        metadata = _dvc_metadata(root / dvc_file)
        report = statistics.get(identifier, {})
        report_stats = {
            key: value for key, value in _numbers(report).items()
            if key in {"images", "total_files", "corrupted_count"}
        }
        available = (root / relative_path).is_dir()
        result.append({
            "id": identifier, "name": name, "path": relative_path, "dvc_file": dvc_file,
            "status": "available" if metadata["version"] else "unavailable", **metadata,
            "local_available": available, "statistics": report_stats,
            "statistics_source": statistics_source if report_stats else None,
            "split_summary": splits if identifier == "pvf10" else None,
            "explanation": "DVC content hash identifies the tracked snapshot; validation counts are historical."
            if available else "Tracked dataset files are not available in this runtime. DVC metadata may still be readable.",
        })
    return result


def _mlflow(root):
    result = {
        "status": "not_configured", "source": "mlflow.db", "experiments": [],
        "runs": [], "registry": [], "explanation": "No local MLflow SQLite store is available.",
    }
    database = root / "mlflow.db"
    if not database.is_file():
        return result
    try:
        with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True, timeout=0.25)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA query_only = ON")
            # Bound work even when a damaged or unexpectedly large database is mounted.
            connection.set_progress_handler(lambda: 1, 500_000)
            result["experiments"] = [
                {"id": str(row["experiment_id"]), "name": row["name"]}
                for row in connection.execute(
                    "SELECT experiment_id, name FROM experiments WHERE lifecycle_stage = 'active' ORDER BY experiment_id LIMIT 100"
                )
            ]
            rows = connection.execute(
                "SELECT run_uuid, name, experiment_id, status, start_time, end_time FROM runs "
                "WHERE lifecycle_stage = 'active' ORDER BY start_time DESC LIMIT 100"
            ).fetchall()
            for row in rows:
                metric_rows = connection.execute(
                    "SELECT key, value FROM latest_metrics WHERE run_uuid = ? AND is_nan = 0 LIMIT 100",
                    (row["run_uuid"],),
                )
                result["runs"].append({
                    "id": row["run_uuid"], "name": row["name"] or row["run_uuid"],
                    "experiment_id": str(row["experiment_id"]), "status": row["status"],
                    "start_time": row["start_time"], "end_time": row["end_time"],
                    "metrics": _numbers({item["key"]: item["value"] for item in metric_rows}),
                })
            # Older MLflow databases can legitimately lack the registry tables.
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            if "model_versions" in tables:
                result["registry"] = [
                    {"name": row["name"], "version": row["version"], "stage": row["current_stage"],
                     "status": row["status"], "run_id": row["run_id"]}
                    for row in connection.execute(
                        "SELECT name, version, current_stage, status, run_id FROM model_versions ORDER BY creation_time DESC LIMIT 100"
                    )
                ]
        result["status"] = "available"
        result["explanation"] = "Local SQLite records read in query-only mode; this does not check MLflow server availability."
    except (sqlite3.Error, OSError, ValueError):
        result.update(status="unavailable", experiments=[], runs=[], registry=[],
                      explanation="The local MLflow store could not be read or has an unsupported schema.")
    return result


def _checkpoints(root):
    result = []
    for identifier, name, source, deployed in CHECKPOINTS:
        path = root / source
        try:
            size = path.stat().st_size if path.is_file() else None
        except OSError:
            size = None
        result.append({
            "id": identifier, "name": name, "path": source, "available": size is not None,
            "size_bytes": size, "modified_at": _modified(path),
            "dvc_version": _dvc_metadata(root / f"{source}.dvc")["version"],
            # Configured inference role, not proof that a model is loaded in memory.
            "deployed": deployed,
        })
    return result


def _training_runs(root):
    result = []
    for source in TRAINING_CSVS:
        try:
            rows = list(csv.DictReader(_read_text(root / source).splitlines()))
            if not rows:
                continue
            metrics = {}
            for key, value in rows[-1].items():
                try:
                    number = float(value)
                    if math.isfinite(number):
                        metrics[key.strip()[:250]] = number
                except (TypeError, ValueError):
                    continue
            result.append({
                "id": Path(source).parent.name, "name": Path(source).parent.name,
                "source": source, "epochs": len(rows), "last_metrics": metrics,
                "recorded_at": _modified(root / source),
            })
        except (OSError, UnicodeError, ValueError, csv.Error):
            continue
    return result


def build_dashboard(root=ROOT):
    datasets = _datasets(root)
    dvc_present = (root / ".dvc").is_dir() or any(d["version"] for d in datasets)
    remote_configured = False
    try:
        parser = configparser.ConfigParser()
        parser.read_string(_read_text(root / ".dvc/config"))
        remote_configured = any(section.startswith('remote "') for section in parser.sections())
    except (OSError, UnicodeError, ValueError, configparser.Error):
        pass
    return {
        "generated_at": _now(), "evaluations": _evaluations(root), "datasets": datasets,
        "mlops": {
            "dvc": {
                "status": "available" if dvc_present else "not_configured",
                "tracked_datasets": sum(d["version"] is not None for d in datasets),
                "remote_configured": remote_configured,
                "explanation": "Local descriptors only; no remote connectivity or cache integrity check is performed."
                if dvc_present else "DVC descriptors are not mounted in this runtime.",
            },
            "mlflow": _mlflow(root), "checkpoints": _checkpoints(root),
            "training_runs": _training_runs(root),
            "ci": {
                "configured": (root / ".github/workflows/ci.yml").is_file(),
                "source": ".github/workflows/ci.yml",
                "explanation": "Workflow file presence only; remote GitHub Actions execution status is not configured.",
            },
        },
    }


class RequestMetrics:
    """Bounded, thread-safe observations since this worker process started."""

    def __init__(self):
        self.started = time.monotonic()
        self.lock = threading.Lock()
        self.total = self.errors = self.server_errors = 0
        self.inference_requests = self.inference_errors = 0
        self.total_ms = 0.0
        self.endpoints = {}
        self.recent = deque(maxlen=120)

    def record(self, method, path, status_code, duration_ms):
        # Never retain uploaded filenames, URL query strings, or unbounded route keys.
        known_paths = {"/health", "/dashboard", "/monitoring", "/predict/panels",
                       "/predict/defects", "/predict/classify", "/inspections",
                       "/inspections/{inspection_id}", "/inspections/{inspection_id}/image",
                       "/inspections/import", "/docs", "/openapi.json", "/redoc"}
        path = path if path in known_paths else "other"
        duration_ms = max(0.0, float(duration_ms))
        with self.lock:
            self.total += 1
            self.errors += int(status_code >= 400)
            self.server_errors += int(status_code >= 500)
            self.total_ms += duration_ms
            if method == "POST" and path.startswith("/predict/"):
                self.inference_requests += 1
                self.inference_errors += int(status_code >= 400)
            key = (method if method in {"GET", "POST", "OPTIONS", "DELETE", "PUT", "PATCH", "HEAD"} else "OTHER", path)
            endpoint = self.endpoints.setdefault(key, {"total": 0, "errors": 0, "total_ms": 0.0})
            endpoint["total"] += 1
            endpoint["errors"] += int(status_code >= 400)
            endpoint["total_ms"] += duration_ms
            self.recent.append({"at": _now(), "method": key[0], "path": path,
                                "status_code": status_code, "duration_ms": round(duration_ms, 2)})

    def snapshot(self):
        with self.lock:
            elapsed = max(time.monotonic() - self.started, 0.001)
            return {
                "total": self.total, "errors": self.errors, "server_errors": self.server_errors,
                "inference_requests": self.inference_requests, "inference_errors": self.inference_errors,
                "average_latency_ms": round(self.total_ms / self.total, 2) if self.total else None,
                "uptime_availability_percent": round(100 * (self.total - self.errors) / self.total, 2) if self.total else None,
                "requests_per_minute": round(60 * self.total / elapsed, 2),
                "endpoints": [
                    {"method": method, "path": path, "total": metric["total"], "errors": metric["errors"],
                     "average_latency_ms": round(metric["total_ms"] / metric["total"], 2)}
                    for (method, path), metric in self.endpoints.items()
                ],
                "recent": list(self.recent),
            }


request_metrics = RequestMetrics()


def hardware_metrics():
    result = {"cpu_percent": None, "ram": None, "gpus": [], "explanation": None}
    explanations = []
    try:
        import psutil
        result["cpu_percent"] = psutil.cpu_percent(interval=0.05)
        memory = psutil.virtual_memory()
        result["ram"] = {"total_bytes": memory.total, "used_bytes": memory.used, "percent": memory.percent}
    except (ImportError, OSError, RuntimeError):
        explanations.append("CPU and RAM telemetry unavailable; install psutil for this runtime.")
    try:
        import torch
        if torch.cuda.is_available():
            for index in range(torch.cuda.device_count()):
                free, total = torch.cuda.mem_get_info(index)
                result["gpus"].append({
                    "name": torch.cuda.get_device_name(index), "memory_used_bytes": total - free,
                    "memory_total_bytes": total, "utilization_percent": None,
                })
            explanations.append("GPU memory is CUDA device memory; utilization sampling is unavailable.")
        else:
            explanations.append("No CUDA GPU is available in this runtime.")
    except (ImportError, OSError, RuntimeError, AssertionError):
        explanations.append("CUDA device telemetry is unavailable.")
    result["explanation"] = " ".join(explanations) or None
    return result


@router.get("/dashboard")
def dashboard():
    return build_dashboard()


@router.get("/monitoring")
def monitoring():
    return {
        "generated_at": _now(), "uptime_seconds": round(time.monotonic() - request_metrics.started, 2),
        "requests": request_metrics.snapshot(), "hardware": hardware_metrics(),
    }
