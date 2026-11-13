
from pathlib import Path
from ultralytics import YOLO
import json

MODEL_PATH = Path(
    "runs/detect/runs/solarvision/"
    "panel_detection_full/weights/best.pt"
).resolve()

DATA_YAML = Path("configs/yolo_panel.yaml").resolve()

REPORT_DIR = Path("reports/detection/panel")
REPORT_DIR.mkdir(parents=True, exist_ok=True)

assert MODEL_PATH.exists(), f"Modèle introuvable : {MODEL_PATH}"
assert DATA_YAML.exists(), f"YAML introuvable : {DATA_YAML}"

print("\nSOLARVISION - YOLO PANEL TEST EVALUATION")
print("=" * 60)

model = YOLO(str(MODEL_PATH))

metrics = model.val(
    data=str(DATA_YAML),
    split="test",
    imgsz=640,
    batch=8,
    device=0,
    workers=0,
    plots=True,
    project=str(REPORT_DIR.resolve()),
    name="test_evaluation",
    exist_ok=True,
)

results = {
    "precision": float(metrics.box.mp),
    "recall": float(metrics.box.mr),
    "map50": float(metrics.box.map50),
    "map50_95": float(metrics.box.map),
}

print("\nFINAL TEST METRICS")
print("=" * 60)

for name, value in results.items():
    print(f"{name}: {value:.4f}")

with open(
    REPORT_DIR / "test_metrics.json",
    "w",
    encoding="utf-8"
) as f:
    json.dump(results, f, indent=2)

print("=" * 60)
print("Reports:", REPORT_DIR)
print("STATUS: PANEL TEST EVALUATION COMPLETED")
