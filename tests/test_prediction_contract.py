"""Semantic prediction regressions; no checkpoints or persistent databases."""

import pytest
from pydantic import ValidationError

from src.api.contracts import Inspection, Prediction


def classification(**changes):
    return {
        "model": "ResNet18",
        "predicted_class": "0",
        "confidence": 0.9,
        "probabilities": {"0": 0.9, "1": 0.1},
        **changes,
    }


def detection(**changes):
    return {
        "model": "YOLO11n Panel Detection",
        "count": 1,
        "detections": [
            {
                "class_id": 0,
                "confidence": 0.95,
                "bbox_xyxy": [10, 20, 90, 95],
            }
        ],
        "image_width": 100,
        "image_height": 100,
        **changes,
    }


@pytest.mark.parametrize(
    "changes",
    [
        {"predicted_class": "absent"},
        {"predicted_class": "1", "confidence": 0.1},
        {"confidence": 0.8},
        {"confidence": True},
        {"probabilities": {"0": 0.9}},
        {"probabilities": {}},
        {"probabilities": {"0": float("nan"), "1": 0.1}},
        {"probabilities": {"0": 0.9, "": 0.1}},
        {"confidence": 1.1},
        {"confidence": "0.9"},
        {"count": 0},
        {"detections": [], "count": 0},
        {"model": " "},
    ],
)
def test_rejects_incoherent_classification(changes):
    with pytest.raises(ValidationError):
        Prediction.model_validate(classification(**changes))


def test_accepts_rounded_probabilities_and_ties_from_real_precision():
    rounded = {str(index): 0.0333 for index in range(1, 10)}
    rounded["0"] = 0.7001
    assert (
        Prediction.model_validate(
            classification(
                confidence=0.7001,
                probabilities=rounded,
            )
        ).predicted_class
        == "0"
    )
    assert (
        Prediction.model_validate(
            classification(
                confidence=0.5,
                probabilities={"0": 0.5, "1": 0.5},
            )
        ).confidence
        == 0.5
    )


@pytest.mark.parametrize(
    "box",
    [
        [-1, 0, 20, 20],
        [0, -1, 20, 20],
        [10, 10, 5, 20],
        [0, 0, 0, 20],
        [0, 20, 10, 20],
        [0, 0, 101, 20],
        [0, 0, 20, 101],
        [0, 0, float("inf"), 20],
        [True, 0, 20, 20],
    ],
)
def test_rejects_invalid_bounding_boxes(box):
    payload = detection()
    payload["detections"][0]["bbox_xyxy"] = box
    with pytest.raises(ValidationError):
        Prediction.model_validate(payload)


@pytest.mark.parametrize(
    "changes",
    [
        {"image_width": 0},
        {"image_height": -1},
        {"image_width": 1.5},
        {"image_width": True},
        {"image_width": None},
        {"image_height": None},
        {"count": 0},
        {"count": True},
        {"detections": None},
        {"inference_ms": float("nan")},
        {"request_duration_ms": -1},
        {"inference_ms": 20.0, "request_duration_ms": 10.0},
    ],
)
def test_rejects_malformed_dimensions_counts_and_timings(changes):
    with pytest.raises(ValidationError):
        Prediction.model_validate(detection(**changes))


def test_legacy_prediction_without_dimensions_and_timing_remains_readable():
    payload = detection()
    payload.pop("image_width")
    payload.pop("image_height")
    legacy = Inspection.model_validate(
        {
            "id": "legacy",
            "date": "2026-11-20",
            "filename": "old.png",
            "mode": "panels",
            "duration": 731.25,
            "result": payload,
        }
    )
    assert legacy.duration == 731.25
    assert legacy.request_duration_ms is None
    assert legacy.client_duration_ms is None


def test_rejects_conflicting_server_processing_fields():
    with pytest.raises(ValidationError):
        Inspection.model_validate(
            {
                "id": "timed",
                "date": "2026-11-21",
                "filename": "new.png",
                "mode": "panels",
                "duration": 1,
                "request_duration_ms": 5.0,
                "result": detection(request_duration_ms=10.0),
            }
        )


@pytest.mark.parametrize(
    ("mode", "result"),
    [
        ("classify", detection()),
        ("panels", classification()),
        ("defects", classification()),
    ],
)
def test_rejects_history_mode_result_mismatch(mode, result):
    with pytest.raises(ValidationError):
        Inspection.model_validate(
            {
                "id": "mismatch",
                "date": "2026-11-21",
                "filename": "image.png",
                "mode": mode,
                "duration": 1,
                "result": result,
            }
        )
