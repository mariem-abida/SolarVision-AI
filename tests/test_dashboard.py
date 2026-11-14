"""Dashboard contracts use tiny fixtures; no training or dataset mutation."""

import json
import sqlite3

from fastapi import FastAPI

from src.api import dashboard


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
