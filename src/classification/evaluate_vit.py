from pathlib import Path
import json

import torch
import timm
import numpy as np
import matplotlib.pyplot as plt

from torchvision import datasets, transforms
from torch.utils.data import DataLoader

from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    classification_report,
    ConfusionMatrixDisplay,
    confusion_matrix,
)

DATA_DIR = Path("data/processed/pvf10_grouped/test")
MODEL_PATH = Path("models/classification/vit_tiny_best.pth")
REPORT_DIR = Path("reports/classification/vit_tiny")
REPORT_DIR.mkdir(parents=True, exist_ok=True)

DEVICE = torch.device(
    "cuda" if torch.cuda.is_available() else "cpu"
)

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225],
    ),
])

test_dataset = datasets.ImageFolder(
    DATA_DIR,
    transform=transform,
)

test_loader = DataLoader(
    test_dataset,
    batch_size=8,
    shuffle=False,
    num_workers=0,
)

checkpoint = torch.load(
    MODEL_PATH,
    map_location=DEVICE,
    weights_only=True,
)

assert test_dataset.classes == checkpoint["classes"]

model = timm.create_model(
    "vit_tiny_patch16_224",
    pretrained=False,
    num_classes=10,
)

model.load_state_dict(
    checkpoint["model_state_dict"]
)

model = model.to(DEVICE)
model.eval()

y_true = []
y_pred = []

with torch.no_grad():
    for images, labels in test_loader:
        images = images.to(DEVICE)

        outputs = model(images)
        predictions = outputs.argmax(dim=1)

        y_true.extend(labels.tolist())
        y_pred.extend(predictions.cpu().tolist())

labels = list(range(10))

accuracy = accuracy_score(y_true, y_pred)
precision = precision_score(
    y_true, y_pred,
    labels=labels,
    average="macro",
    zero_division=0,
)
recall = recall_score(
    y_true, y_pred,
    labels=labels,
    average="macro",
    zero_division=0,
)
macro_f1 = f1_score(
    y_true, y_pred,
    labels=labels,
    average="macro",
    zero_division=0,
)

print("\nSOLARVISION - VIT TEST EVALUATION")
print("=" * 60)
print("Device:", DEVICE)
print("Test images:", len(test_dataset))
print("Checkpoint epoch:", checkpoint["epoch"])
print(f"Accuracy:        {accuracy:.4f}")
print(f"Macro Precision: {precision:.4f}")
print(f"Macro Recall:    {recall:.4f}")
print(f"Macro F1:        {macro_f1:.4f}")

report = classification_report(
    y_true,
    y_pred,
    labels=labels,
    target_names=test_dataset.classes,
    zero_division=0,
)

print("\nCLASSIFICATION REPORT")
print(report)

metrics = {
    "accuracy": accuracy,
    "macro_precision": precision,
    "macro_recall": recall,
    "macro_f1": macro_f1,
    "checkpoint_epoch": checkpoint["epoch"],
    "test_images": len(test_dataset),
}

with open(
    REPORT_DIR / "test_metrics.json",
    "w",
    encoding="utf-8",
) as f:
    json.dump(metrics, f, indent=2)

with open(
    REPORT_DIR / "classification_report.txt",
    "w",
    encoding="utf-8",
) as f:
    f.write(report)

cm = confusion_matrix(
    y_true,
    y_pred,
    labels=labels,
)

fig, ax = plt.subplots(figsize=(11, 9))

display = ConfusionMatrixDisplay(
    confusion_matrix=cm,
    display_labels=test_dataset.classes,
)

display.plot(
    ax=ax,
    cmap="Blues",
    values_format="d",
    colorbar=False,
)

plt.title("SolarVision AI - VIT-Tiny Confusion Matrix")
plt.tight_layout()

plt.savefig(
    REPORT_DIR / "confusion_matrix.png",
    dpi=200,
)

plt.close()

print("=" * 60)
print("Reports saved to:", REPORT_DIR)
print("STATUS: TEST EVALUATION COMPLETED")