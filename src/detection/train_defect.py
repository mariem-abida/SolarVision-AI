
from pathlib import Path
import torch
from ultralytics import YOLO

DATA_YAML = Path("configs/yolo_defect.yaml").resolve()

assert DATA_YAML.exists(), "Configuration YAML introuvable"
assert torch.cuda.is_available(), "CUDA non disponible"

print("\nSOLARVISION - YOLO DEFECT DETECTION")
print("=" * 60)
print("GPU:", torch.cuda.get_device_name(0))
print("Dataset:", DATA_YAML)

model = YOLO("yolo11n.pt")

results = model.train(
    data=str(DATA_YAML),
    epochs=3,
    imgsz=640,
    batch=8,
    device=0,
    workers=0,
    optimizer="auto",
    project=str(Path("runs/solarvision").resolve()),
    name="defect_detection_pilot",
    exist_ok=False,
    seed=42,
    plots=True,
    amp=True,
)

print("\n" + "=" * 60)
print("PILOT TRAINING COMPLETED")
print("Results directory:", results.save_dir)
print(
    "Best checkpoint:",
    Path(results.save_dir) / "weights" / "best.pt"
)
print("=" * 60)
