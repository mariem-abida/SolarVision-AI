
from pathlib import Path
from ultralytics import YOLO
import json

MODEL_PATH = Path(
    "runs/detect/runs/solarvision/"
    "panel_detection_full/weights/best.pt"
)

IMAGE_DIR = Path("data/interim/panel_detection/test/images")
OUTPUT_DIR = Path("outputs/inference/panel")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

assert MODEL_PATH.exists(), "Modèle YOLO Panel introuvable"
assert IMAGE_DIR.exists(), "Dossier d'images introuvable"

images = sorted(
    p for p in IMAGE_DIR.iterdir()
    if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
)

assert images, "Aucune image trouvée"

image_path = images[0]

print("Image sélectionnée :", image_path)

model = YOLO(str(MODEL_PATH))

results = model.predict(
    source=str(image_path),
    imgsz=640,
    conf=0.25,
    device=0,
    save=True,
    project=str(OUTPUT_DIR.resolve()),
    name="prediction",
    exist_ok=True,
)

detections = []

for box in results[0].boxes:
    detections.append({
        "class_id": int(box.cls.item()),
        "confidence": round(float(box.conf.item()), 4),
        "bbox_xyxy": [
            round(float(v), 2)
            for v in box.xyxy[0].tolist()
        ],
    })

report = {
    "image": image_path.name,
    "model": "YOLO11n Panel Detection",
    "number_of_panels": len(detections),
    "detections": detections,
}

with open(
    OUTPUT_DIR / "prediction.json",
    "w",
    encoding="utf-8"
) as f:
    json.dump(report, f, indent=2)

print("\nSOLARVISION - PANEL INFERENCE")
print("=" * 50)
print("Image:", image_path.name)
print("Detected panels:", len(detections))
print("Output:", OUTPUT_DIR.resolve())
print("STATUS: PANEL INFERENCE COMPLETED")
