
from pathlib import Path
import json

import torch
import timm
from PIL import Image
from torchvision import transforms

# Configuration
MODEL_PATH = Path(
    "models/classification/resnet18_best.pth"
)

IMAGE_DIR = Path(
    "data/processed/pvf10_grouped/test"
)

OUTPUT_DIR = Path("outputs/inference/classification")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

assert MODEL_PATH.exists(), "Checkpoint ResNet18 introuvable"
assert IMAGE_DIR.exists(), "Dataset de test introuvable"

device = torch.device(
    "cuda" if torch.cuda.is_available() else "cpu"
)

# Charger le checkpoint
checkpoint = torch.load(
    MODEL_PATH,
    map_location=device,
    weights_only=False
)

classes = checkpoint["classes"]

# Recréer exactement l'architecture
model = timm.create_model(
    "resnet18",
    pretrained=False,
    num_classes=len(classes)
)

model.load_state_dict(checkpoint["model_state_dict"])
model = model.to(device)
model.eval()

# Même prétraitement que pendant l'évaluation
transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    ),
])

# Sélectionner une image du test PVF-10
extensions = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}

images = sorted(
    p for p in IMAGE_DIR.rglob("*")
    if p.is_file() and p.suffix.lower() in extensions
)

assert images, "Aucune image de test trouvée"

image_path = images[0]

image = Image.open(image_path).convert("RGB")
input_tensor = transform(image).unsqueeze(0).to(device)

# Inférence
with torch.inference_mode():
    logits = model(input_tensor)
    probabilities = torch.softmax(logits, dim=1)[0]

confidence, predicted_idx = probabilities.max(dim=0)

predicted_class = classes[predicted_idx.item()]
true_class = image_path.parent.name

result = {
    "image": image_path.name,
    "true_class": true_class,
    "predicted_class": predicted_class,
    "confidence": round(confidence.item(), 4),
    "correct": predicted_class == true_class,
    "model": "ResNet18",
}

with open(
    OUTPUT_DIR / "prediction.json",
    "w",
    encoding="utf-8"
) as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

print("\nSOLARVISION - RESNET18 INFERENCE")
print("=" * 55)
print("Device:", device)
print("Image:", image_path.name)
print("True class:", true_class)
print("Predicted class:", predicted_class)
print("Confidence:", f"{confidence.item():.2%}")
print("Correct prediction:", predicted_class == true_class)
print("=" * 55)
print("STATUS: RESNET18 INFERENCE COMPLETED")
