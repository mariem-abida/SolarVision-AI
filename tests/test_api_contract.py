import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from src.api import main as api


class FakePipeline:
    def detect_panels(self, image_path):
        return [{"class_id": 0, "confidence": 0.95, "bbox_xyxy": [10, 20, 100, 120]}]

    def detect_defects(self, image_path):
        return []

    def classify_panel(self, image_path):
        return {
            "predicted_class": "test_class",
            "confidence": 0.90,
            "probabilities": {"test_class": 0.90},
        }


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(api, "SolarVisionPipeline", FakePipeline)
    monkeypatch.setenv("SOLARVISION_HISTORY_DB", str(tmp_path / "history.sqlite3"))

    with TestClient(api.app) as test_client:
        yield test_client


@pytest.fixture
def image_bytes():
    image = Image.new("RGB", (100, 100), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def upload(client, endpoint, image_bytes):
    return client.post(
        endpoint,
        data={"thermal_confirmed": "true"} if endpoint.endswith("classify") else {},
        files={"file": ("test.png", image_bytes, "image/png")},
    )


def test_health(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["models_loaded"] is True


def test_panel_detection(client, image_bytes):
    response = upload(client, "/predict/panels", image_bytes)

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert len(response.json()["detections"]) == 1


def test_defect_detection(client, image_bytes):
    response = upload(client, "/predict/defects", image_bytes)

    assert response.status_code == 200
    assert response.json()["count"] == 0


def test_classification(client, image_bytes):
    response = upload(client, "/predict/classify", image_bytes)

    assert response.status_code == 200
    assert response.json()["predicted_class"] == "test_class"


def test_invalid_extension(client):
    response = client.post(
        "/predict/panels", files={"file": ("test.txt", b"invalid", "text/plain")}
    )

    assert response.status_code == 400


def test_invalid_image(client):
    response = client.post(
        "/predict/panels", files={"file": ("test.png", b"invalid", "image/png")}
    )

    assert response.status_code == 400


@pytest.mark.parametrize(
    "origin",
    [
        f"http://{host}:{port}"
        for host in ("localhost", "127.0.0.1")
        for port in (8080, 8081)
    ],
)
def test_local_cors_preflight(client, origin):
    response = client.options(
        "/predict/panels",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_untrusted_cors_origin(client):
    response = client.get("/health", headers={"Origin": "https://untrusted.example"})
    assert "access-control-allow-origin" not in response.headers


def test_thermal_confirmation_required(client, image_bytes):
    response = client.post(
        "/predict/classify", files={"file": ("rgb.png", image_bytes, "image/png")}
    )
    assert response.status_code == 422
    assert "thermal" in response.json()["detail"]


def test_radiometric_thermal_requires_conversion(client):
    buffer = io.BytesIO()
    Image.new("I;16", (10, 10)).save(buffer, format="TIFF")
    response = client.post(
        "/predict/classify",
        data={"thermal_confirmed": "true"},
        files={"file": ("raw.tif", buffer.getvalue(), "image/tiff")},
    )
    assert response.status_code == 422


def test_persistence_preview_and_idempotent_import(client, image_bytes):
    result = upload(client, "/predict/panels", image_bytes).json()
    assert result["inference_ms"] >= 0
    assert result["image_width"] == 100
    record = client.get("/inspections").json()["records"][0]
    assert record["id"] == result["inspection_id"]
    assert record["has_image"] is True
    assert (
        client.post(
            "/inspections/import", json={"records": [record, record]}
        ).status_code
        == 200
    )
    assert client.get("/inspections").json()["total"] == 1
    preview = client.get(f"/inspections/{record['id']}/image")
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/png"
    assert client.get("/inspections/missing/image").status_code == 404


def test_unavailable_models_return_503(client, monkeypatch, image_bytes):
    monkeypatch.setattr(api, "pipeline", None)
    assert client.get("/health").json()["models_loaded"] is False
    assert upload(client, "/predict/panels", image_bytes).status_code == 503


def test_inference_failure_cleans_temporary_upload(client, monkeypatch, image_bytes):
    paths = []

    def fail(path):
        paths.append(path)
        raise RuntimeError("test failure")

    monkeypatch.setattr(api.pipeline, "detect_panels", fail)
    assert upload(client, "/predict/panels", image_bytes).status_code == 500
    assert paths and not paths[0].exists()


def test_storage_failure_still_returns_real_prediction(
    client, monkeypatch, image_bytes
):
    def unavailable(*args):
        raise OSError("test read-only storage")

    monkeypatch.setattr(api, "save_inspection", unavailable)
    response = upload(client, "/predict/panels", image_bytes)
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert "persistence_error" in response.json()


def test_invalid_history_prediction_is_rejected(client):
    response = client.post(
        "/inspections/import",
        json={
            "records": [
                {
                    "id": "legacy",
                    "date": "2026-11-14",
                    "filename": "image.png",
                    "mode": "panels",
                    "duration": 1,
                    "result": {"model": "YOLO", "count": 2, "detections": []},
                    "status": "Completed",
                }
            ]
        },
    )
    assert response.status_code == 422
    assert client.get("/inspections").json()["total"] == 0
