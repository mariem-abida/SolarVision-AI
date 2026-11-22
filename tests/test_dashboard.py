"""Dashboard contracts use tiny fixtures; no training or dataset mutation."""

import json
import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from fastapi import FastAPI

from src.api import dashboard
from src.api import dashboard_snapshot


def write(root, path, content):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


def test_missing_artifacts_are_explicitly_unavailable(tmp_path):
    data = dashboard.build_dashboard(tmp_path)
    assert len(data["datasets"]) == 7
    assert all(item["status"] == "unavailable" for item in data["evaluations"])
    assert all(item["version"] is None for item in data["datasets"])
    assert all(not item["available"] for item in data["mlops"]["checkpoints"])
    assert data["mlops"]["mlflow"]["status"] == "not_configured"
    assert data["mlops"]["training_runs"] == []


def test_reads_real_report_values_and_tracked_hash_without_modifying_files(tmp_path):
    report = write(
        tmp_path,
        "reports/classification/resnet18/test_metrics.json",
        json.dumps(
            {
                "accuracy": 0.8,
                "macro_precision": 0.7,
                "macro_recall": 0.6,
                "macro_f1": 0.65,
                "test_images": 559,
            }
        ),
    )
    descriptor = write(
        tmp_path,
        "data/raw/pvf10.dvc",
        "outs:\n- md5: " + "a" * 32 + ".dir\n  size: 120\n  nfiles: 3\n  path: pvf10\n",
    )
    write(
        tmp_path,
        "reports/data_validation/raw_data_validation.json",
        json.dumps(
            [
                {
                    "dataset": "pvf10",
                    "images": 42,
                    "total_files": 43,
                    "corrupted_count": 0,
                    "private_extra": "must not be exposed",
                },
            ]
        ),
    )
    write(
        tmp_path,
        "data/processed/pvf10_grouped/split_summary.json",
        json.dumps(
            {
                split: {"images": count, "groups": 1, "classes": {"healthy": count}}
                for split, count in (("train", 30), ("val", 5), ("test", 7))
            }
        ),
    )
    write(
        tmp_path,
        ".dvc/config",
        '[core]\n    remote = private\n[remote "private"]\n    url = s3://private.example\n    password = private-secret\n',
    )
    before = {path: path.read_bytes() for path in (report, descriptor)}
    data = dashboard.build_dashboard(tmp_path)
    evaluation = next(item for item in data["evaluations"] if item["id"] == "resnet18")
    assert evaluation["metrics"]["accuracy"] == 0.8
    assert evaluation["metrics"]["test_images"] == 559
    dataset = next(item for item in data["datasets"] if item["id"] == "pvf10")
    assert dataset["version"] == "a" * 32 + ".dir"
    assert dataset["file_count"] == 3
    assert dataset["size_bytes"] == 120
    assert dataset["local_available"] is False
    assert dataset["statistics"] == {
        "images": 42,
        "total_files": 43,
        "corrupted_count": 0,
    }
    assert dataset["split_summary"]["test"]["images"] == 7
    assert data["mlops"]["dvc"]["remote_configured"] is True
    assert "private-secret" not in json.dumps(data)
    assert "s3://" not in json.dumps(data)
    assert all(path.read_bytes() == content for path, content in before.items())


def test_invalid_metrics_and_corrupted_metadata_do_not_become_demo_results(tmp_path):
    write(
        tmp_path,
        "reports/detection/panel/test_metrics.json",
        json.dumps(
            {
                "precision": 0.5,
                "recall": 0.5,
                "map50": 140,
                "map50_95": 0.5,
            }
        ),
    )
    write(tmp_path, "reports/detection/defect/test_metrics.json", "not json")
    write(tmp_path, "data/raw/pvf10.dvc", "outs:\n- md5: not-a-real-hash\n")
    data = dashboard.build_dashboard(tmp_path)
    assert all(item["status"] == "unavailable" for item in data["evaluations"])
    assert all(item["metrics"] == {} for item in data["evaluations"])


def create_tracking_database(path):
    with sqlite3.connect(path) as connection:
        connection.executescript("""
            CREATE TABLE experiments(experiment_id INTEGER, name TEXT, lifecycle_stage TEXT);
            CREATE TABLE runs(run_uuid TEXT, name TEXT, experiment_id INTEGER, status TEXT,
                              start_time INTEGER, end_time INTEGER, lifecycle_stage TEXT);
            CREATE TABLE latest_metrics(key TEXT, value REAL, run_uuid TEXT, is_nan INTEGER);
            INSERT INTO experiments VALUES(1, 'Thermal evaluation', 'active');
            INSERT INTO runs VALUES('abc', 'ResNet18', 1, 'FINISHED', 100, 200, 'active');
            INSERT INTO latest_metrics VALUES('val_accuracy', 0.91, 'abc', 0);
        """)


def test_mlflow_database_is_read_only_and_exposes_only_allowed_fields(tmp_path):
    path = tmp_path / "mlflow.db"
    create_tracking_database(path)
    original = path.read_bytes()
    data = dashboard.build_dashboard(tmp_path)["mlops"]["mlflow"]
    assert data["status"] == "available"
    assert data["experiments"] == [{"id": "1", "name": "Thermal evaluation"}]
    assert data["runs"][0]["metrics"] == {"val_accuracy": 0.91}
    assert data["registry"] == []
    assert path.read_bytes() == original
    assert not (tmp_path / "mlflow.db-journal").exists()


def test_broken_mlflow_store_reports_unavailable(tmp_path):
    write(tmp_path, "mlflow.db", "not a sqlite database")
    data = dashboard.build_dashboard(tmp_path)["mlops"]["mlflow"]
    assert data["status"] == "unavailable"
    assert data["runs"] == []


def test_training_csv_and_checkpoint_metadata_are_observed_without_loading_weights(
    tmp_path,
):
    source = dashboard.TRAINING_CSVS[0]
    write(tmp_path, source, "epoch,time,metrics/mAP50(B)\n1,3.2,0.5\n2,6.4,0.7\n")
    checkpoint_path = dashboard.CHECKPOINTS[0][2]
    checkpoint = write(
        tmp_path, checkpoint_path, "checkpoint bytes are never deserialized"
    )
    data = dashboard.build_dashboard(tmp_path)["mlops"]
    assert data["training_runs"][0]["epochs"] == 2
    assert data["training_runs"][0]["last_metrics"]["metrics/mAP50(B)"] == 0.7
    assert data["checkpoints"][0]["available"] is True
    assert data["checkpoints"][0]["size_bytes"] == checkpoint.stat().st_size


def test_request_metrics_count_inference_errors_and_bound_sensitive_route_data():
    metrics = dashboard.RequestMetrics()
    metrics.record("GET", "/health", 200, 10)
    metrics.record("POST", "/predict/panels", 500, 30)
    metrics.record("GET", "/secret/user-upload-name?token=secret", 404, 20)
    result = metrics.snapshot()
    assert result["total"] == 3
    assert result["errors"] == 2
    assert result["server_errors"] == 1
    assert result["inference_requests"] == 1
    assert result["inference_errors"] == 1
    assert result["average_latency_ms"] == 20
    assert "secret" not in json.dumps(result)
    for _ in range(200):
        metrics.record("GET", "/health", 200, 1)
    assert len(metrics.snapshot()["recent"]) == 120


def test_dashboard_routes_have_no_client_controlled_file_or_command_parameters(
    monkeypatch,
):
    app = FastAPI()
    app.include_router(dashboard.router)
    monkeypatch.setattr(
        dashboard, "build_dashboard", lambda: {"generated_at": "now", "datasets": []}
    )
    monkeypatch.setattr(
        dashboard,
        "hardware_metrics",
        lambda: {
            "cpu_percent": None,
            "ram": None,
            "gpus": [],
            "explanation": "Unavailable",
        },
    )
    schema = app.openapi()
    assert set(schema["paths"]["/dashboard"]) == {"get"}
    assert "parameters" not in schema["paths"]["/dashboard"]["get"]
    assert "requestBody" not in schema["paths"]["/dashboard"]["get"]
    assert "parameters" not in schema["paths"]["/monitoring"]["get"]
    assert dashboard.dashboard() == {"generated_at": "now", "datasets": []}
    monitoring = dashboard.monitoring()
    assert monitoring["uptime_seconds"] >= 0
    assert monitoring["hardware"]["cpu_percent"] is None


def test_cors_preflights_do_not_count_as_model_inferences():
    metrics = dashboard.RequestMetrics()
    metrics.record("OPTIONS", "/predict/panels", 200, 1)
    metrics.record("POST", "/predict/panels", 200, 10)
    assert metrics.snapshot()["total"] == 2
    assert metrics.snapshot()["inference_requests"] == 1


def test_dvc_real_quoted_sections_overlay_local_without_exposing_credentials(tmp_path):
    write(tmp_path, ".dvc/config", """[core]
    remote = gdrive
['remote "gdrive"']
    url = gdrive://private-folder-id
    client_secret = private-secret
""")
    write(tmp_path, ".dvc/config.local", """['remote "gdrive"']
    url = gdrive://different-private-folder
['remote "gdrive_onnx"']
    url = gdrive://another-private-folder
    gdrive_user_credentials_file = C:/private/oauth.json
""")
    data = dashboard.build_dashboard(tmp_path)
    dvc = data["mlops"]["dvc"]
    assert dvc["remote_names"] == ["gdrive", "gdrive_onnx"]
    assert dvc["remote_configured"] is True
    assert dvc["configuration_source"] == "runtime"
    assert dvc["remote_accessible"] is None
    assert dvc["artifacts_synchronized"] is None
    exposed = json.dumps(data)
    assert "private-folder" not in exposed
    assert "private-secret" not in exposed
    assert "oauth.json" not in exposed


def public_snapshot_fixture(root):
    """Tiny synthetic metadata only; no model/dataset/real registry mutation."""
    for _, _, task, source in dashboard.EVALUATIONS:
        metrics = ({"accuracy": .9, "macro_precision": .8, "macro_recall": .85, "macro_f1": .82}
                   if task == "classification" else {"precision": .8, "recall": .7, "map50": .75, "map50_95": .6})
        write(root, source, json.dumps(metrics))
    for identifier, _ in dashboard.DATASETS:
        write(root, f"data/raw/{identifier}.dvc", "outs:\n- md5: " + "a" * 32 + f".dir\n  size: 123\n  nfiles: 2\n  path: {identifier}\n")
    write(root, "reports/data_validation/raw_data_validation.json", json.dumps([
        {"dataset": identifier, "images": 1, "total_files": 2, "corrupted_count": 0} for identifier, _ in dashboard.DATASETS
    ]))
    write(root, "data/processed/pvf10_grouped/split_summary.json", json.dumps({
        split: {"images": 1, "groups": 1, "classes": {"0": 1}} for split in ("train", "val", "test")
    }))
    for source in dashboard.TRAINING_CSVS:
        write(root, source, "epoch,time,metrics/mAP50(B)\n1,2.1,0.5\n2,4.1,0.7\n")
    write(root, ".dvc/config", "['remote \"gdrive\"']\nurl = gdrive://must-not-be-published\npassword = private-secret\n")
    write(root, ".github/workflows/ci.yml", "name: Fixture CI\non: workflow_dispatch\n")
    with sqlite3.connect(root / "mlflow.db") as connection:
        connection.executescript("""
            CREATE TABLE experiments(experiment_id INTEGER, name TEXT, lifecycle_stage TEXT);
            CREATE TABLE runs(run_uuid TEXT, name TEXT, experiment_id INTEGER, status TEXT,
                start_time INTEGER, end_time INTEGER, lifecycle_stage TEXT);
            CREATE TABLE latest_metrics(key TEXT, value REAL, run_uuid TEXT, is_nan INTEGER);
            CREATE TABLE model_versions(name TEXT, version INTEGER, current_stage TEXT, status TEXT,
                run_id TEXT, creation_time INTEGER, source TEXT);
            INSERT INTO experiments VALUES(1, 'SolarVision-PVF10-Classification', 'active');
            INSERT INTO experiments VALUES(2, 'Unrelated private project', 'active');
            INSERT INTO runs VALUES('private', 'Private run', 2, 'FINISHED', 10, 20, 'active');
        """)
        for index, name in enumerate(sorted(dashboard_snapshot.PUBLIC_MODELS)):
            run_id = f"run-{index}"
            connection.execute("INSERT INTO model_versions VALUES(?,1,'None','READY',?,1,'file:///private/user/model')", (name, run_id))
            connection.execute("INSERT INTO runs VALUES(?,?,1,'FINISHED',10,20,'active')", (run_id, f"Registry model {index}"))
            connection.execute("INSERT INTO latest_metrics VALUES('val_accuracy',.9,?,0)", (run_id,))
    return dashboard_snapshot.create_snapshot(root)


def save_snapshot(root, snapshot):
    target = root / "configs/dashboard-snapshot.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(snapshot), encoding="utf-8")
    return target


def resign_snapshot(snapshot):
    snapshot["payload_sha256"] = dashboard_snapshot.checksum(snapshot["payload"])
    snapshot["manifest_sha256"] = dashboard_snapshot.checksum({
        key: value for key, value in snapshot.items() if key not in {"payload", "manifest_sha256"}
    })


def test_public_snapshot_restores_real_metadata_shape_without_claiming_runtime_artifacts(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    snapshot = public_snapshot_fixture(source)
    before = (source / "mlflow.db").read_bytes()
    runtime = tmp_path / "runtime"
    path = save_snapshot(runtime, snapshot)
    data = dashboard.build_dashboard(runtime, snapshot_path=path)
    assert data["metadata"]["mode"] == "snapshot"
    info = data["metadata"]["snapshot"]
    assert info["status"] == "valid" and info["freshness"] == "current"
    assert all(row["runtime_state"] == "not_mounted" for row in info["sources"])
    assert all(row["status"] == "available" and row["metadata_source"] == "snapshot" for row in data["evaluations"])
    assert len(data["datasets"]) == 7 and all(row["version"] for row in data["datasets"])
    assert all(row["local_available"] is False for row in data["datasets"])
    assert {row["name"] for row in data["mlops"]["mlflow"]["registry"]} == dashboard_snapshot.PUBLIC_MODELS
    assert len(data["mlops"]["training_runs"]) == 5
    assert data["mlops"]["ci"]["configured"] is True
    assert data["mlops"]["ci"]["execution_status"] == "not_checked"
    assert all(row["available"] is False for row in data["mlops"]["checkpoints"])
    assert data["mlops"]["dvc"]["remote_configured"] is True
    assert data["mlops"]["dvc"]["remote_accessible"] is None
    assert data["mlops"]["dvc"]["artifacts_synchronized"] is None
    assert (source / "mlflow.db").read_bytes() == before
    published = path.read_text(encoding="utf-8")
    for private in ("private-secret", "gdrive://", "file:///private", "Unrelated private", "Private run"):
        assert private not in published
    assert not (runtime / "mlflow.db").exists()


def test_mounted_sources_override_snapshot_and_corrupt_sources_are_not_hidden(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    snapshot = public_snapshot_fixture(source)
    runtime = tmp_path / "runtime"
    path = save_snapshot(runtime, snapshot)
    report = snapshot["payload"]["evaluations"][0]["source"]
    write(runtime, report, "not json")
    write(runtime, "data/raw/panel_detection.dvc", "invalid descriptor")
    write(runtime, dashboard.TRAINING_CSVS[0], "")
    write(runtime, ".dvc/config", "invalid INI")
    create_tracking_database(runtime / "mlflow.db")
    data = dashboard.build_dashboard(runtime, snapshot_path=path)
    first = next(row for row in data["evaluations"] if row["source"] == report)
    assert first["status"] == "unavailable" and first["metadata_source"] == "runtime"
    assert next(row for row in data["datasets"] if row["id"] == "panel_detection")["version"] is None
    assert len(data["mlops"]["training_runs"]) == 4
    assert data["mlops"]["mlflow"]["metadata_source"] == "runtime"
    assert data["mlops"]["mlflow"]["registry"] == []
    assert data["mlops"]["dvc"]["remote_configured"] is False
    assert data["mlops"]["dvc"]["configuration_source"] == "unavailable"
    assert data["metadata"]["mode"] == "mixed"
    assert any(row["runtime_state"] == "changed" for row in data["metadata"]["snapshot"]["sources"])


@pytest.mark.parametrize("damage", ["digest", "manifest", "metrics", "private_field", "source_path", "duplicate", "future", "invalid_timestamp"])
def test_snapshot_tampering_or_malformed_content_never_becomes_available(tmp_path, damage):
    source = tmp_path / "source"
    source.mkdir()
    snapshot = public_snapshot_fixture(source)
    if damage == "digest":
        snapshot["payload"]["evaluations"][0]["metrics"]["accuracy"] = .42
    elif damage == "manifest":
        snapshot["sources"][0]["sha256"] = "0" * 64
    elif damage == "metrics":
        snapshot["payload"]["evaluations"][0]["metrics"] = {"accuracy": 15}
    elif damage == "private_field":
        snapshot["payload"]["mlops"]["mlflow"]["registry"][0]["source"] = "file:///private/user/model"
    elif damage == "source_path":
        snapshot["sources"][0]["path"] = "../../private-secret"
    elif damage == "duplicate":
        snapshot["payload"]["evaluations"][0] = snapshot["payload"]["evaluations"][1].copy()
    elif damage == "future":
        snapshot["generated_at"] = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    else:
        snapshot["generated_at"] = "not a date"
    if damage not in {"digest", "manifest"}:
        resign_snapshot(snapshot)
    runtime = tmp_path / "runtime"
    data = dashboard.build_dashboard(runtime, snapshot_path=save_snapshot(runtime, snapshot))
    assert data["metadata"]["snapshot"]["status"] == "invalid"
    assert all(row["status"] == "unavailable" for row in data["evaluations"])
    assert data["mlops"]["mlflow"]["registry"] == []
    assert data["mlops"]["training_runs"] == []


def test_old_snapshot_is_explicitly_stale_and_missing_snapshot_has_no_fake_values(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    snapshot = public_snapshot_fixture(source)
    snapshot["generated_at"] = (datetime.now(UTC) - timedelta(days=40)).isoformat()
    resign_snapshot(snapshot)
    runtime = tmp_path / "runtime"
    data = dashboard.build_dashboard(runtime, snapshot_path=save_snapshot(runtime, snapshot))
    assert data["metadata"]["snapshot"]["status"] == "valid"
    assert data["metadata"]["snapshot"]["freshness"] == "stale"
    assert data["metadata"]["snapshot"]["age_seconds"] > 30 * 86400
    absent = dashboard.build_dashboard(tmp_path / "empty", snapshot_path=tmp_path / "missing.json")
    assert absent["metadata"]["snapshot"]["status"] == "absent"
    assert all(row["metrics"] == {} for row in absent["evaluations"])


def test_snapshot_summaries_do_not_blend_different_dvc_dataset_versions(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    snapshot = public_snapshot_fixture(source)
    runtime = tmp_path / "runtime"
    path = save_snapshot(runtime, snapshot)
    write(runtime, "data/raw/panel_detection.dvc", "outs:\n- md5: " + "b" * 32 + ".dir\n  size: 20\n  nfiles: 1\n")
    data = dashboard.build_dashboard(runtime, snapshot_path=path)
    panel = next(row for row in data["datasets"] if row["id"] == "panel_detection")
    assert panel["version"] == "b" * 32 + ".dir"
    assert panel["statistics"] == {}
    assert panel["statistics_metadata_source"] == "unavailable"
    assert panel["metadata_source"] == "runtime"


@pytest.mark.parametrize("corrupt", [False, True])
def test_mounted_statistics_and_splits_override_snapshot_even_without_dvc_pointer(tmp_path, corrupt):
    source = tmp_path / "source"
    source.mkdir()
    snapshot = public_snapshot_fixture(source)
    runtime = tmp_path / "runtime"
    path = save_snapshot(runtime, snapshot)
    stats = [{"dataset": "pvf10", "images": 42, "total_files": 43, "corrupted_count": 0}]
    splits = {split: {"images": 4, "classes": {"0": 4}} for split in ("train", "val", "test")}
    write(runtime, "reports/data_validation/raw_data_validation.json", "not json" if corrupt else json.dumps(stats))
    write(runtime, "data/processed/pvf10_grouped/split_summary.json", "not json" if corrupt else json.dumps(splits))
    data = dashboard.build_dashboard(runtime, snapshot_path=path)
    pvf10 = next(row for row in data["datasets"] if row["id"] == "pvf10")
    assert pvf10["metadata_source"] == "snapshot"  # Only its descriptor is unmounted.
    assert pvf10["statistics_metadata_source"] == "runtime"
    assert pvf10["split_metadata_source"] == "runtime"
    assert data["metadata"]["mode"] == "mixed"
    if corrupt:
        assert pvf10["statistics"] == {}
        assert pvf10["statistics_source"] is None
        assert pvf10["split_summary"] is None
    else:
        assert pvf10["statistics"]["images"] == 42
        assert pvf10["statistics_source"] == "reports/data_validation/raw_data_validation.json"
        assert pvf10["split_summary"]["test"]["images"] == 4


def test_runtime_descriptor_with_unmounted_summaries_reports_field_provenance(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    snapshot = public_snapshot_fixture(source)
    runtime = tmp_path / "runtime"
    path = save_snapshot(runtime, snapshot)
    write(runtime, "data/raw/pvf10.dvc", (source / "data/raw/pvf10.dvc").read_text())
    data = dashboard.build_dashboard(runtime, snapshot_path=path)
    pvf10 = next(row for row in data["datasets"] if row["id"] == "pvf10")
    assert pvf10["metadata_source"] == "runtime"
    assert pvf10["statistics_metadata_source"] == "snapshot"
    assert pvf10["split_metadata_source"] == "snapshot"
    assert data["metadata"]["mode"] == "mixed"


def test_ready_metrics_are_counted_as_their_own_endpoint():
    metrics = dashboard.RequestMetrics()
    metrics.record("GET", "/ready", 503, 1)
    assert metrics.snapshot()["endpoints"][0]["path"] == "/ready"
