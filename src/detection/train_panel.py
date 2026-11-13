
from pathlib import Path
import torch
from ultralytics import YOLO

# Configuration
DATA_YAML = Path("configs/yolo_panel.yaml").resolve()

assert DATA_YAML.exists(), f"YAML introuvable : {DATA_YAML}"
assert torch.cuda.is_available(), "CUDA non disponible"

print("\nSOLARVISION - YOLO PANEL DETECTION")
print("=" * 55)
print("GPU:", torch.cuda.get_device_name(0))
print("Dataset:", DATA_YAML)

# Charger YOLO11 Nano pré-entraîné
model = YOLO("yolo11n.pt")

# Premier entraînement pilote
results = model.train(
    data=str(DATA_YAML),
    epochs=3,
    imgsz=640,
    batch=8,
    device=0,
    workers=0,
    project="runs/solarvision",
    name="panel_detection_pilot",
    exist_ok=True,
    seed=42,
    plots=True,
    amp=True,
)

print("\n" + "=" * 55)
print("PILOT TRAINING COMPLETED")
print("Best model: runs/solarvision/panel_detection_pilot/weights/best.pt")
print("=" * 55)
