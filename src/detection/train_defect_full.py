
from pathlib import Path
import torch
from ultralytics import YOLO

DATA_YAML = Path("configs/yolo_defect.yaml").resolve()

PILOT_MODEL = Path(
    "runs/solarvision/"
    "defect_detection_pilot/weights/best.pt"
).resolve()

assert DATA_YAML.exists(), "Dataset YAML introuvable"
assert PILOT_MODEL.exists(), "Checkpoint pilote introuvable"
assert torch.cuda.is_available(), "CUDA non disponible"

print("\nSOLARVISION - DEFECT DETECTION FULL TRAINING")
print("=" * 60)
print("GPU:", torch.cuda.get_device_name(0))
print("Initial checkpoint:", PILOT_MODEL)

model = YOLO(str(PILOT_MODEL))

results = model.train(
    data=str(DATA_YAML),
    epochs=50,
    imgsz=640,
    batch=8,
    device=0,
    workers=0,
    optimizer="AdamW",
    lr0=0.001,
    patience=12,
    project=str(Path("runs/solarvision").resolve()),
    name="defect_detection_full",
    exist_ok=False,
    seed=42,
    plots=True,
    amp=True,
)

print("\n" + "=" * 60)
print("FULL TRAINING COMPLETED")
print("Results directory:", results.save_dir)
print(
    "Best checkpoint:",
    Path(results.save_dir) / "weights" / "best.pt"
)
print("=" * 60)
