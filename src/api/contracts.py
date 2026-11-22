"""Public JSON contracts shared by inference and persisted inspection records."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

Probability = Annotated[FiniteFloat, Field(ge=0, le=1, strict=True)]
Milliseconds = Annotated[FiniteFloat, Field(ge=0, strict=True)]
Coordinate = Annotated[FiniteFloat, Field(strict=True)]
# Checkpoints round each of the ten probabilities to four decimal places.
PROBABILITY_SUM_TOLERANCE = 0.002
CONFIDENCE_TOLERANCE = 0.0002
BOUNDING_BOX_TOLERANCE = 0.01
TIMING_TOLERANCE_MS = 0.01


class Detection(BaseModel):
    class_id: int = Field(ge=0, strict=True)
    class_name: str | None = None
    confidence: Probability
    bbox_xyxy: tuple[Coordinate, Coordinate, Coordinate, Coordinate]

    @model_validator(mode="after")
    def ordered_coordinates(self):
        x1, y1, x2, y2 = self.bbox_xyxy
        if min(x1, y1) < 0 or x2 <= x1 or y2 <= y1:
            raise ValueError("Bounding boxes must be nonnegative with positive area")
        return self


class Prediction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str
    count: int | None = Field(default=None, ge=0, strict=True)
    detections: list[Detection] | None = None
    predicted_class: str | None = None
    confidence: Probability | None = None
    probabilities: dict[str, Probability] | None = None
    inference_ms: Milliseconds | None = None
    request_duration_ms: Milliseconds | None = Field(
        default=None,
        description=(
            "Server elapsed time from predict_image entry after multipart parsing, "
            "through decoding, inference and the initial SQLite INSERT. Measured "
            "before the timing UPDATE and transaction commit; excludes response "
            "serialization and network transport."
        ),
    )
    image_width: int | None = Field(default=None, ge=1, strict=True)
    image_height: int | None = Field(default=None, ge=1, strict=True)
    inspection_id: str | None = None
    created_at: str | None = None
    persistence_error: str | None = None

    @model_validator(mode="after")
    def complete_result(self):
        if not self.model.strip():
            raise ValueError("A model name is required")
        if (self.image_width is None) != (self.image_height is None):
            raise ValueError("Image width and height must be provided together")
        if (
            self.request_duration_ms is not None
            and self.inference_ms is not None
            and self.request_duration_ms + TIMING_TOLERANCE_MS < self.inference_ms
        ):
            raise ValueError("Server processing cannot be shorter than model inference")
        if self.detections is not None:
            if any(
                value is not None
                for value in (
                    self.predicted_class,
                    self.confidence,
                    self.probabilities,
                )
            ):
                raise ValueError("Detection and classification results cannot be mixed")
            if self.count != len(self.detections):
                raise ValueError("Detection count must match detections")
            if self.image_width is not None:
                for detection in self.detections:
                    _, _, x2, y2 = detection.bbox_xyxy
                    if (
                        x2 > self.image_width + BOUNDING_BOX_TOLERANCE
                        or y2 > self.image_height + BOUNDING_BOX_TOLERANCE
                    ):
                        raise ValueError("Bounding boxes must fit the image dimensions")
        elif (
            self.predicted_class is None
            or self.confidence is None
            or not self.probabilities
        ):
            raise ValueError(
                "A complete detection or classification result is required"
            )
        else:
            if self.count is not None:
                raise ValueError(
                    "Classification results cannot include a detection count"
                )
            if (
                not self.predicted_class.strip()
                or any(not name.strip() for name in self.probabilities)
                or self.predicted_class not in self.probabilities
            ):
                raise ValueError("The predicted class must belong to the distribution")
            if abs(sum(self.probabilities.values()) - 1) > PROBABILITY_SUM_TOLERANCE:
                raise ValueError("Classification probabilities must sum to one")
            predicted_probability = self.probabilities[self.predicted_class]
            if abs(self.confidence - predicted_probability) > CONFIDENCE_TOLERANCE:
                raise ValueError(
                    "Confidence must match the predicted class probability"
                )
            if (
                max(self.probabilities.values()) - predicted_probability
                > CONFIDENCE_TOLERANCE
            ):
                raise ValueError(
                    "The predicted class must have the highest probability"
                )
        return self


class Inspection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    date: str = Field(max_length=64)
    filename: str = Field(max_length=255)
    mode: Literal["panels", "defects", "classify"]
    # Legacy rows used duration for either model or browser elapsed time. Keep it
    # readable without inferring provenance; new API records use inference_ms.
    duration: Milliseconds
    request_duration_ms: Milliseconds | None = None
    client_duration_ms: Milliseconds | None = None
    result: Prediction
    status: Literal["Completed"] = "Completed"
    has_image: bool = False

    @model_validator(mode="after")
    def consistent_request_timing(self):
        if (self.mode == "classify") != (self.result.detections is None):
            raise ValueError("Inspection mode must match its prediction result")
        if (
            self.request_duration_ms is not None
            and self.result.request_duration_ms is not None
            and abs(self.request_duration_ms - self.result.request_duration_ms)
            > TIMING_TOLERANCE_MS
        ):
            raise ValueError(
                "Inspection and prediction server processing times must match"
            )
        return self


class HistoryImport(BaseModel):
    records: list[Inspection] = Field(max_length=100)
