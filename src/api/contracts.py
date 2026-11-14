"""Public JSON contracts shared by inference and persisted inspection records."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

Probability = Annotated[FiniteFloat, Field(ge=0, le=1)]


class Detection(BaseModel):
    class_id: int = Field(ge=0)
    class_name: str | None = None
    confidence: Probability
    bbox_xyxy: tuple[FiniteFloat, FiniteFloat, FiniteFloat, FiniteFloat]

    @model_validator(mode="after")
    def ordered_coordinates(self):
        x1, y1, x2, y2 = self.bbox_xyxy
        if x2 < x1 or y2 < y1:
            raise ValueError("Bounding box coordinates must be ordered")
        return self


class Prediction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str
    count: int | None = Field(default=None, ge=0)
    detections: list[Detection] | None = None
    predicted_class: str | None = None
    confidence: Probability | None = None
    probabilities: dict[str, Probability] | None = None
    inference_ms: FiniteFloat | None = Field(default=None, ge=0)
    image_width: int | None = Field(default=None, ge=1)
    image_height: int | None = Field(default=None, ge=1)
    inspection_id: str | None = None
    created_at: str | None = None
    persistence_error: str | None = None

    @model_validator(mode="after")
    def complete_result(self):
        if self.detections is not None:
            if self.count != len(self.detections):
                raise ValueError("Detection count must match detections")
        elif (
            self.predicted_class is None
            or self.confidence is None
            or not self.probabilities
        ):
            raise ValueError(
                "A complete detection or classification result is required"
            )
        return self


class Inspection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    date: str = Field(max_length=64)
    filename: str = Field(max_length=255)
    mode: Literal["panels", "defects", "classify"]
    duration: FiniteFloat = Field(ge=0)
    result: Prediction
    status: Literal["Completed"] = "Completed"
    has_image: bool = False


class HistoryImport(BaseModel):
    records: list[Inspection] = Field(max_length=100)
