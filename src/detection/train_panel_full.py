
from pathlib import Path
import torch
from ultralytics import YOLO

DATA_YAML = Path("configs/yolo_panel.yaml").resolve()

assert DATA_YAML.exists(), f"Dataset YAML introuvable : {DATA_YAML}"
assert torch.cuda.is_available(), "CUDA non disponible"

print("\nSOLARVISION - YOLO PANEL FULL TRAINING")
print("=" * 60)
print("GPU:", torch.cuda.get_device_name(0))
print("Dataset:", DATA_YAML)

# Initialisation depuis les poids pré-entraînés
# pour un entraînement complet indépendant du pilote.
model = YOLO("yolo11n.pt")

results = model.train(
    data=str(DATA_YAML),
    epochs=50,
    imgsz=640,
    batch=8,
    device=0,
    workers=0,
    patience=12,
    optimizer="AdamW",
    lr0=0.001,
    project="runs/solarvision",
    name="panel_detection_full",
    exist_ok=False,
    seed=42,
    plots=True,
    amp=True,
)

print("\n" + "=" * 60)
print("FULL TRAINING COMPLETED")
print("Results directory:", results.save_dir)
print("Best checkpoint:", Path(results.save_dir) / "weights" / "best.pt")
print("=" * 60)
