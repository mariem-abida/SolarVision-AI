from pathlib import Path
import torch
import timm
import onnx

checkpoint_path = Path("models/classification/resnet18_best.pth")
output_path = Path("models/onnx/resnet18_pvf10.onnx")

checkpoint = torch.load(
    checkpoint_path,
    map_location="cpu",
    weights_only=True
)

model = timm.create_model(
    "resnet18",
    pretrained=False,
    num_classes=10
)

model.load_state_dict(checkpoint["model_state_dict"])
model.eval()

output_path.parent.mkdir(parents=True, exist_ok=True)

dummy_input = torch.randn(1, 3, 224, 224)

torch.onnx.export(
    model,
    dummy_input,
    str(output_path),
    input_names=["images"],
    output_names=["logits"],
    dynamic_axes={
        "images": {0: "batch"},
        "logits": {0: "batch"}
    },
    opset_version=17,
    dynamo=False
)

onnx.checker.check_model(str(output_path))

print("ONNX EXPORT SUCCESS")
print("Model:", output_path)
print("Size:", round(output_path.stat().st_size / 1048576, 2), "MB")
