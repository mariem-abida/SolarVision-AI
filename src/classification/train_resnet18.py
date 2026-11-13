import random
from pathlib import Path

import mlflow
import numpy as np
import timm
import torch

from sklearn.metrics import accuracy_score, f1_score
from torch import nn
from torch.utils.data import DataLoader
from torchvision import datasets, transforms
from tqdm import tqdm


# ==========================================
# CONFIGURATION
# ==========================================

SEED = 42
DATA_DIR = Path("data/processed/pvf10_grouped")
MODEL_DIR = Path("models/classification")

EPOCHS = 15
BATCH_SIZE = 8
LEARNING_RATE = 1e-4
PATIENCE = 5
NUM_CLASSES = 10

DEVICE = torch.device(
    "cuda" if torch.cuda.is_available() else "cpu"
)


# ==========================================
# REPRODUCIBILITY
# ==========================================

random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)

if torch.cuda.is_available():
    torch.cuda.manual_seed_all(SEED)

torch.backends.cudnn.deterministic = True
torch.backends.cudnn.benchmark = False


# ==========================================
# DATA TRANSFORMS
# ==========================================

train_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.RandomHorizontalFlip(p=0.5),
    transforms.RandomVerticalFlip(p=0.5),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

val_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])


# ==========================================
# DATASETS
# ==========================================

train_dataset = datasets.ImageFolder(
    DATA_DIR / "train",
    transform=train_transform
)

val_dataset = datasets.ImageFolder(
    DATA_DIR / "val",
    transform=val_transform
)

assert train_dataset.classes == val_dataset.classes
assert len(train_dataset.classes) == NUM_CLASSES

train_loader = DataLoader(
    train_dataset,
    batch_size=BATCH_SIZE,
    shuffle=True,
    num_workers=0,
    pin_memory=torch.cuda.is_available()
)

val_loader = DataLoader(
    val_dataset,
    batch_size=BATCH_SIZE,
    shuffle=False,
    num_workers=0,
    pin_memory=torch.cuda.is_available()
)


# ==========================================
# CLASS WEIGHTS
# ==========================================

targets = torch.tensor(train_dataset.targets)

class_counts = torch.bincount(
    targets,
    minlength=NUM_CLASSES
).float()

class_weights = (
    class_counts.sum() /
    (NUM_CLASSES * class_counts)
).to(DEVICE)

print("Class counts:", class_counts.tolist())
print("Class weights:", class_weights.cpu().tolist())


# ==========================================
# MODEL
# ==========================================

model = timm.create_model(
    "resnet18",
    pretrained=True,
    num_classes=NUM_CLASSES
).to(DEVICE)

criterion = nn.CrossEntropyLoss(
    weight=class_weights
)

optimizer = torch.optim.AdamW(
    model.parameters(),
    lr=LEARNING_RATE,
    weight_decay=1e-4
)


# ==========================================
# TRAINING FUNCTIONS
# ==========================================

def train_one_epoch():
    model.train()

    total_loss = 0.0
    predictions = []
    true_labels = []

    for images, labels in tqdm(
        train_loader,
        desc="Training",
        leave=False
    ):
        images = images.to(
            DEVICE,
            non_blocking=True
        )

        labels = labels.to(
            DEVICE,
            non_blocking=True
        )

        optimizer.zero_grad(set_to_none=True)

        outputs = model(images)

        loss = criterion(outputs, labels)

        loss.backward()
        optimizer.step()

        total_loss += loss.item() * images.size(0)

        predictions.extend(
            outputs.argmax(dim=1).detach().cpu().tolist()
        )

        true_labels.extend(
            labels.cpu().tolist()
        )

    return (
        total_loss / len(train_dataset),
        accuracy_score(true_labels, predictions),
        f1_score(
            true_labels,
            predictions,
            average="macro",
            zero_division=0
        )
    )


@torch.no_grad()
def validate():
    model.eval()

    total_loss = 0.0
    predictions = []
    true_labels = []

    for images, labels in tqdm(
        val_loader,
        desc="Validation",
        leave=False
    ):
        images = images.to(
            DEVICE,
            non_blocking=True
        )

        labels = labels.to(
            DEVICE,
            non_blocking=True
        )

        outputs = model(images)

        loss = criterion(outputs, labels)

        total_loss += loss.item() * images.size(0)

        predictions.extend(
            outputs.argmax(dim=1).cpu().tolist()
        )

        true_labels.extend(
            labels.cpu().tolist()
        )

    return (
        total_loss / len(val_dataset),
        accuracy_score(true_labels, predictions),
        f1_score(
            true_labels,
            predictions,
            average="macro",
            zero_division=0
        )
    )


# ==========================================
# MLFLOW
# ==========================================

MODEL_DIR.mkdir(
    parents=True,
    exist_ok=True
)

mlflow.set_tracking_uri("sqlite:///mlflow.db")

mlflow.set_experiment(
    "SolarVision-PVF10-Classification"
)

# ==========================================
# MAIN TRAINING
# ==========================================

def main():
    print("\nSOLARVISION - RESNET18 TRAINING")
    print("=" * 60)

    print("Device:", DEVICE)
    print("Train images:", len(train_dataset))
    print("Val images:", len(val_dataset))
    print("Classes:", train_dataset.classes)

    best_f1 = -1.0
    patience_counter = 0

    checkpoint_path = MODEL_DIR / "resnet18_best.pth"

    with mlflow.start_run(
        run_name="ResNet18-PVF10-Grouped"
    ):
        mlflow.log_params({
            "model": "resnet18",
            "pretrained": True,
            "epochs": EPOCHS,
            "batch_size": BATCH_SIZE,
            "learning_rate": LEARNING_RATE,
            "optimizer": "AdamW",
            "loss": "WeightedCrossEntropy",
            "seed": SEED,
            "dataset": "pvf10_grouped",
            "image_size": 224,
            "device": str(DEVICE)
        })

        for epoch in range(1, EPOCHS + 1):
            print(f"\nEpoch {epoch}/{EPOCHS}")

            train_loss, train_acc, train_f1 = (
                train_one_epoch()
            )

            val_loss, val_acc, val_f1 = validate()

            print(
                f"Train Loss: {train_loss:.4f} | "
                f"Acc: {train_acc:.4f} | "
                f"Macro-F1: {train_f1:.4f}"
            )

            print(
                f"Val Loss: {val_loss:.4f} | "
                f"Acc: {val_acc:.4f} | "
                f"Macro-F1: {val_f1:.4f}"
            )

            mlflow.log_metrics({
                "train_loss": train_loss,
                "train_accuracy": train_acc,
                "train_macro_f1": train_f1,
                "val_loss": val_loss,
                "val_accuracy": val_acc,
                "val_macro_f1": val_f1
            }, step=epoch)

            if val_f1 > best_f1:
                best_f1 = val_f1
                patience_counter = 0

                torch.save({
                    "model_state_dict": model.state_dict(),
                    "classes": train_dataset.classes,
                    "epoch": epoch,
                    "val_macro_f1": val_f1,
                    "architecture": "resnet18"
                }, checkpoint_path)

                print("Best model saved!")

            else:
                patience_counter += 1

            if patience_counter >= PATIENCE:
                print("\nEarly stopping triggered.")
                break

        mlflow.log_metric(
            "best_val_macro_f1",
            best_f1
        )

        mlflow.log_artifact(
            str(checkpoint_path),
            artifact_path="checkpoints"
        )

    print("\n" + "=" * 60)
    print("TRAINING COMPLETED")
    print("Best Validation Macro-F1:", round(best_f1, 4))
    print("Checkpoint:", checkpoint_path)
    print("=" * 60)


if __name__ == "__main__":
    main()