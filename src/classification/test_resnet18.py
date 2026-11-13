import torch
import timm

from pathlib import Path
from torchvision import datasets, transforms
from torch.utils.data import DataLoader

DATA_DIR = Path("data/processed/pvf10_grouped")

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

train_dataset = datasets.ImageFolder(
    root=DATA_DIR / "train",
    transform=transform
)

train_loader = DataLoader(
    train_dataset,
    batch_size=8,
    shuffle=True,
    num_workers=0
)

model = timm.create_model(
    "resnet18",
    pretrained=True,
    num_classes=10
).to(DEVICE)

print("\nSOLARVISION - RESNET18 TEST")
print("=" * 55)

print("Device:", DEVICE)
print("Classes:", train_dataset.classes)
print("Training images:", len(train_dataset))

images, labels = next(iter(train_loader))

images = images.to(DEVICE)

model.eval()

with torch.no_grad():
    outputs = model(images)

print("Input shape:", images.shape)
print("Output shape:", outputs.shape)

print("=" * 55)
print("STATUS: RESNET18 FORWARD PASS SUCCESSFUL")