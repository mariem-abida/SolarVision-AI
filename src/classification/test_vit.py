import torch
import timm

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

MODEL_NAME = "vit_tiny_patch16_224"

print("\nSOLARVISION - VIT TEST")
print("=" * 55)

print("Device:", DEVICE)
print("Model:", MODEL_NAME)

model = timm.create_model(
    MODEL_NAME,
    pretrained=True,
    num_classes=10
).to(DEVICE)

model.eval()

images = torch.randn(
    4, 3, 224, 224,
    device=DEVICE
)

with torch.no_grad():
    outputs = model(images)

print("Input shape:", images.shape)
print("Output shape:", outputs.shape)

if DEVICE == "cuda":
    print(
        "GPU memory allocated:",
        round(
            torch.cuda.memory_allocated() / 1024**2,
            2
        ),
        "MB"
    )

assert outputs.shape == (4, 10)

print("=" * 55)
print("STATUS: VIT FORWARD PASS SUCCESSFUL")