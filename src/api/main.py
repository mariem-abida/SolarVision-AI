
from contextlib import asynccontextmanager
from pathlib import Path
import tempfile

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import Image, UnidentifiedImageError

from src.inference.pipeline import SolarVisionPipeline


pipeline = None

ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".tif", ".tiff"
}

MAX_FILE_SIZE = 20 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pipeline

    pipeline = SolarVisionPipeline()
    print("SolarVision API ready!")

    yield

    pipeline = None


app = FastAPI(
    title="SolarVision AI API",
    description="Solar panel inspection with Deep Learning",
    version="1.0.0",
    lifespan=lifespan
)


async def save_upload(file: UploadFile):
    suffix = Path(file.filename or "").suffix.lower()

    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image format"
        )

    data = await file.read(MAX_FILE_SIZE + 1)

    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Image exceeds 20 MB"
        )

    try:
        with Image.open(__import__("io").BytesIO(data)) as img:
            img.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="Invalid image"
        )

    with tempfile.NamedTemporaryFile(
        suffix=suffix,
        delete=False
    ) as temp:
        temp.write(data)
        return Path(temp.name)


@app.get("/health")
def health():
    return {
        "status": "healthy" if pipeline is not None else "starting",
        "models_loaded": pipeline is not None
    }


@app.post("/predict/panels")
async def predict_panels(file: UploadFile = File(...)):
    path = await save_upload(file)

    try:
        detections = await run_in_threadpool(
            pipeline.detect_panels,
            path
        )

        return {
            "model": "YOLO11n Panel Detection",
            "count": len(detections),
            "detections": detections
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Panel inference failed"
        ) from exc

    finally:
        path.unlink(missing_ok=True)


@app.post("/predict/defects")
async def predict_defects(file: UploadFile = File(...)):
    path = await save_upload(file)

    try:
        detections = await run_in_threadpool(
            pipeline.detect_defects,
            path
        )

        return {
            "model": "YOLO11n Defect Detection",
            "count": len(detections),
            "detections": detections
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Defect inference failed"
        ) from exc

    finally:
        path.unlink(missing_ok=True)


@app.post("/predict/classify")
async def predict_classify(file: UploadFile = File(...)):
    path = await save_upload(file)

    try:
        result = await run_in_threadpool(
            pipeline.classify_panel,
            path
        )

        return {
            "model": "ResNet18",
            **result
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Classification inference failed"
        ) from exc

    finally:
        path.unlink(missing_ok=True)
