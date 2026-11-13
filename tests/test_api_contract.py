
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from src.api import main as api


class FakePipeline:
    def detect_panels(self, image_path):
        return [{
            "class_id": 0,
            "confidence": 0.95,
            "bbox_xyxy": [10, 20, 100, 120]
        }]

    def detect_defects(self, image_path):
        return []

    def classify_panel(self, image_path):
        return {
            "predicted_class": "test_class",
            "confidence": 0.90,
            "probabilities": {"test_class": 0.90}
        }


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(api, "SolarVisionPipeline", FakePipeline)

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
        files={
            "file": ("test.png", image_bytes, "image/png")
        }
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
        "/predict/panels",
        files={"file": ("test.txt", b"invalid", "text/plain")}
    )

    assert response.status_code == 400


def test_invalid_image(client):
    response = client.post(
        "/predict/panels",
        files={"file": ("test.png", b"invalid", "image/png")}
    )

    assert response.status_code == 400
