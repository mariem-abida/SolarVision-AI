
from pathlib import Path

import torch
import timm
from PIL import Image
from torchvision import transforms
from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[2]

PANEL_MODEL = (
    ROOT / "runs/detect/runs/solarvision/"
    "panel_detection_full/weights/best.pt"
)

DEFECT_MODEL = (
    ROOT / "runs/solarvision/"
    "defect_detection_full-2/weights/best.pt"
)

CLASSIFIER_MODEL = (
    ROOT / "models/classification/resnet18_best.pth"
)


class SolarVisionPipeline:

    def __init__(self):
        self.device = torch.device(
            "cuda" if torch.cuda.is_available() else "cpu"
        )

        print(f"Loading SolarVision models on {self.device}...")

        # YOLO models
        self.panel_model = YOLO(str(PANEL_MODEL))
        self.defect_model = YOLO(str(DEFECT_MODEL))

        # ResNet18 checkpoint
        checkpoint = torch.load(
            CLASSIFIER_MODEL,
            map_location="cpu",
            weights_only=False
        )

        self.classes = checkpoint["classes"]

        self.classifier = timm.create_model(
            "resnet18",
            pretrained=False,
            num_classes=len(self.classes)
        )

        self.classifier.load_state_dict(
            checkpoint["model_state_dict"]
        )

        self.classifier.to(self.device)
        self.classifier.eval()

        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225]
            ),
        ])

        print("All models loaded successfully!")

    def _detect(self, model, image_path, confidence=0.25):
        result = model.predict(
            source=str(image_path),
            imgsz=640,
            conf=confidence,
            device=str(self.device),
            verbose=False
        )[0]

        detections = []

        for box in result.boxes:
            detections.append({
                "class_id": int(box.cls.item()),
                "confidence": round(float(box.conf.item()), 4),
                "bbox_xyxy": [
                    round(float(value), 2)
                    for value in box.xyxy[0].tolist()
                ]
            })

        return detections

    def detect_panels(self, image_path, confidence=0.25):
        return self._detect(
            self.panel_model,
            image_path,
            confidence
        )

    def detect_defects(self, image_path, confidence=0.25):
        return self._detect(
            self.defect_model,
            image_path,
            confidence
        )

    def classify_panel(self, image_path):
        image = Image.open(image_path).convert("RGB")

        tensor = (
            self.transform(image)
            .unsqueeze(0)
            .to(self.device)
        )

        with torch.inference_mode():
            logits = self.classifier(tensor)
            probabilities = torch.softmax(logits, dim=1)[0]

        confidence, index = probabilities.max(dim=0)

        return {
            "predicted_class": self.classes[index.item()],
            "confidence": round(float(confidence.item()), 4),
            "probabilities": {
                name: round(float(prob), 4)
                for name, prob in zip(
                    self.classes,
                    probabilities.tolist()
                )
            }
        }
