import io
import logging
import os
import tempfile
import threading
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Annotated
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageOps, UnidentifiedImageError

from src.api.contracts import HistoryImport, Inspection, Prediction
from src.api.dashboard import request_metrics
from src.api.dashboard import router as dashboard_router
from src.api.history import get_preview, list_inspections, save_inspection
from src.inference.pipeline import SolarVisionPipeline

logger = logging.getLogger(__name__)
pipeline = None
inference_lock = threading.Lock()
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_PIXELS = 25_000_000


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pipeline
    try:
        pipeline = await run_in_threadpool(SolarVisionPipeline)
    except Exception:
        logger.exception("Model loading failed; health and dashboard remain available")
        pipeline = None
    yield
    pipeline = None


app = FastAPI(title="SolarVision AI API", version="1.1.0", lifespan=lifespan)
local_origins = [
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in (8080, 8081, 8082)
]
extra_origins = [
    value.strip().rstrip("/")
    for value in os.getenv("SOLARVISION_CORS_ORIGINS", "").split(",")
    if value.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=local_origins + extra_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(dashboard_router)


@app.middleware("http")
async def monitor_requests(request: Request, call_next):
    started = perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        return response
    finally:
        route = request.scope.get("route")
        request_metrics.record(
            request.method,
            getattr(route, "path", request.url.path),
            status,
            (perf_counter() - started) * 1000,
        )


def decode_image(data: bytes, thermal: bool):
    try:
        with Image.open(io.BytesIO(data)) as original:
            if original.width * original.height > MAX_PIXELS:
                raise HTTPException(413, "Image exceeds 25 million pixels")
            if thermal and original.mode not in {"L", "RGB", "RGBA", "P"}:
                raise HTTPException(
                    422,
                    "PVF-10 requires an 8-bit thermal crop. Raw radiometric or 16-bit thermal data must be converted using the training dataset convention first.",
                )
            original.load()
            image = ImageOps.exif_transpose(original).convert("RGB")
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ) as exc:
        raise HTTPException(400, "Invalid or unsafe image") from exc
    return image


async def save_upload(file: UploadFile, thermal: bool = False):
    if Path(file.filename or "").suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, "Unsupported image format")
    data = await file.read(MAX_FILE_SIZE + 1)
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(413, "Image exceeds 20 MB")
    image = await run_in_threadpool(decode_image, data, thermal)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temporary:
        path = Path(temporary.name)
    try:
        await run_in_threadpool(image.save, path, "PNG")
        width, height = image.size
        image.thumbnail((1600, 1600))
        preview = io.BytesIO()
        image.save(preview, format="PNG")
        return path, width, height, preview.getvalue()
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        image.close()


def model_availability():
    """Report actual model objects, independently of registry metadata."""
    return {
        mode: pipeline is not None
        and getattr(pipeline, attribute, None) is not None
        and callable(getattr(pipeline, method, None))
        and (mode != "classify" or bool(getattr(pipeline, "classes", [])))
        for mode, attribute, method in (
            ("panels", "panel_model", "detect_panels"),
            ("defects", "defect_model", "detect_defects"),
            ("classify", "classifier", "classify_panel"),
        )
    }


@app.get("/health")
def health():
    # Liveness remains HTTP 200 while the process can serve requests. Readiness
    # is a separate contract so dashboards remain usable when a model is absent.
    models = model_availability()
    loaded = all(models.values())
    return {
        "status": "healthy"
        if loaded
        else "partial"
        if any(models.values())
        else "unavailable",
        "models_loaded": loaded,
        "device": str(getattr(pipeline, "device", "unavailable")),
        "models": models,
        "classification_classes": list(getattr(pipeline, "classes", [])),
        "explanation": None
        if loaded
        else "Models unavailable. Check server logs and trained checkpoint mounts.",
    }


@app.get(
    "/ready", responses={503: {"description": "Required inference models unavailable"}}
)
def readiness():
    state = health()
    return JSONResponse(state, status_code=200 if state["models_loaded"] else 503)


def run_inference(mode, path):
    # Ultralytics predictors are mutable; serialize shared GPU/model access.
    with inference_lock:
        started = perf_counter()
        if mode == "classify":
            result = {"model": "ResNet18", **pipeline.classify_panel(path)}
        else:
            method = (
                pipeline.detect_panels if mode == "panels" else pipeline.detect_defects
            )
            detections = method(path)
            result = {
                "model": f"YOLO11n {'Panel' if mode == 'panels' else 'Defect'} Detection",
                "count": len(detections),
                "detections": detections,
            }
        result["inference_ms"] = round((perf_counter() - started) * 1000, 3)
        return result


async def predict_image(mode: str, file: UploadFile):
    request_started_at = perf_counter()
    if not model_availability().get(mode, False):
        raise HTTPException(
            503, "Models unavailable. Check trained checkpoints and server logs."
        )
    path, width, height, preview = await save_upload(file, thermal=mode == "classify")
    try:
        result = await run_in_threadpool(run_inference, mode, path)
        result.update(
            image_width=width,
            image_height=height,
            inspection_id=str(uuid4()),
            created_at=datetime.now(UTC).isoformat(),
        )
        prediction = Prediction(**result)
        record = Inspection(
            id=prediction.inspection_id,
            date=prediction.created_at,
            filename=Path((file.filename or "image").replace("\\", "/")).name[:255],
            mode=mode,
            duration=prediction.inference_ms,
            result=prediction,
            has_image=True,
        )
        try:
            await run_in_threadpool(
                save_inspection, record, preview, request_started_at=request_started_at
            )
        except Exception:
            logger.exception("Could not persist inspection")
            prediction.persistence_error = "Inference completed; server history could not be saved. Keep the local record or export JSON."
            prediction.request_duration_ms = round(
                (perf_counter() - request_started_at) * 1000, 3
            )
        return prediction
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Inference failed for %s", mode)
        raise HTTPException(500, "Model inference failed. Check server logs.") from exc
    finally:
        path.unlink(missing_ok=True)


@app.post(
    "/predict/panels", response_model=Prediction, response_model_exclude_none=True
)
async def predict_panels(file: Annotated[UploadFile, File()]):
    return await predict_image("panels", file)


@app.post(
    "/predict/defects", response_model=Prediction, response_model_exclude_none=True
)
async def predict_defects(file: Annotated[UploadFile, File()]):
    return await predict_image("defects", file)


@app.post(
    "/predict/classify", response_model=Prediction, response_model_exclude_none=True
)
async def predict_classify(
    file: Annotated[UploadFile, File()],
    thermal_confirmed: Annotated[bool, Form()] = False,
):
    if not thermal_confirmed:
        raise HTTPException(
            422,
            "Confirm that this is a compatible PVF-10 thermal panel crop; ordinary RGB photographs are outside the classifier's training domain.",
        )
    return await predict_image("classify", file)


@app.get("/inspections")
def inspections(limit: int = Query(200, ge=1, le=500), offset: int = Query(0, ge=0)):
    try:
        return list_inspections(limit, offset)
    except Exception as exc:
        raise HTTPException(503, "Inspection storage unavailable") from exc


@app.post("/inspections/import")
def import_inspections(payload: HistoryImport):
    try:
        for record in payload.records:
            save_inspection(record.model_copy(update={"has_image": False}))
        return {"status": "saved", "records_received": len(payload.records)}
    except Exception as exc:
        raise HTTPException(
            503, "Inspection storage unavailable; local records are preserved"
        ) from exc


@app.get("/inspections/{inspection_id}/image")
def inspection_image(inspection_id: str):
    try:
        preview = get_preview(inspection_id)
    except Exception as exc:
        raise HTTPException(503, "Inspection storage unavailable") from exc
    if preview is None:
        raise HTTPException(404, "No retained preview for this inspection")
    return Response(
        preview,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )
