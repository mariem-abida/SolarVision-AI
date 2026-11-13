
from pathlib import Path
import json

from pipeline import SolarVisionPipeline


ROOT = Path(__file__).resolve().parents[2]

PANEL_DIR = ROOT / "data/interim/panel_detection/test/images"
DEFECT_DIR = ROOT / "data/interim/defect_detection/test/images"
CLASSIFICATION_DIR = ROOT / "data/processed/pvf10_grouped/test"

OUTPUT_DIR = ROOT / "outputs/inference/unified"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def first_image(folder):
    extensions = {
        ".jpg", ".jpeg", ".png", ".tif", ".tiff"
    }

    images = sorted(
        p for p in folder.rglob("*")
        if p.is_file() and p.suffix.lower() in extensions
    )

    if not images:
        raise FileNotFoundError(
            f"No images found in {folder}"
        )

    return images[0]


def main():
    pipeline = SolarVisionPipeline()

    panel_image = first_image(PANEL_DIR)
    defect_image = first_image(DEFECT_DIR)
    classification_image = first_image(CLASSIFICATION_DIR)

    print("\nRunning panel detection...")
    panels = pipeline.detect_panels(panel_image)

    print("Running defect detection...")
    defects = pipeline.detect_defects(defect_image)

    print("Running classification...")
    classification = pipeline.classify_panel(
        classification_image
    )

    report = {
        "panel_detection": {
            "image": panel_image.name,
            "count": len(panels),
            "detections": panels
        },
        "defect_detection": {
            "image": defect_image.name,
            "count": len(defects),
            "detections": defects
        },
        "classification": {
            "image": classification_image.name,
            **classification
        }
    }

    report_path = OUTPUT_DIR / "result.json"

    with open(
        report_path,
        "w",
        encoding="utf-8"
    ) as f:
        json.dump(report, f, indent=2)

    print("\n" + "=" * 55)
    print("SOLARVISION AI - UNIFIED INFERENCE")
    print("=" * 55)
    print(f"Panels detected: {len(panels)}")
    print(f"Defects detected: {len(defects)}")
    print(
        "Classification:",
        classification["predicted_class"]
    )
    print(
        "Confidence:",
        f"{classification['confidence']:.2%}"
    )
    print(f"Report: {report_path}")
    print("STATUS: SUCCESS")


if __name__ == "__main__":
    main()
