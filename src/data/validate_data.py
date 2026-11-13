from pathlib import Path
from collections import Counter
from PIL import Image
import json


RAW_DIR = Path("data/raw")

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}


def inspect_dataset(dataset_path: Path):
    """Inspect a raw dataset without modifying it."""

    all_files = [p for p in dataset_path.rglob("*") if p.is_file()]
    images = [p for p in all_files if p.suffix.lower() in IMAGE_EXTENSIONS]

    extensions = Counter(p.suffix.lower() for p in all_files)

    corrupted_images = []
    resolutions = Counter()

    for image_path in images:
        try:
            with Image.open(image_path) as img:
                resolutions[img.size] += 1
                img.verify()
        except Exception:
            corrupted_images.append(str(image_path))

    return {
        "dataset": dataset_path.name,
        "total_files": len(all_files),
        "images": len(images),
        "extensions": dict(extensions),
        "resolutions": {
            f"{width}x{height}": count
            for (width, height), count in resolutions.items()
        },
        "corrupted_images": corrupted_images,
        "corrupted_count": len(corrupted_images),
    }


def main():
    reports_dir = Path("reports/data_validation")
    reports_dir.mkdir(parents=True, exist_ok=True)

    datasets = sorted(
        path for path in RAW_DIR.iterdir()
        if path.is_dir()
    )

    results = []

    print("\nSOLARVISION - DATA VALIDATION")
    print("=" * 60)

    for dataset in datasets:
        print(f"\nInspecting: {dataset.name}")

        result = inspect_dataset(dataset)
        results.append(result)

        print(f"  Total files      : {result['total_files']}")
        print(f"  Images           : {result['images']}")
        print(f"  Corrupted images : {result['corrupted_count']}")

        if result["resolutions"]:
            print("  Main resolutions :")
            top_resolutions = sorted(
                result["resolutions"].items(),
                key=lambda x: x[1],
                reverse=True
            )[:5]

            for resolution, count in top_resolutions:
                print(f"    {resolution}: {count}")

    output_file = reports_dir / "raw_data_validation.json"

    with output_file.open("w", encoding="utf-8") as f:
        json.dump(results, f, indent=4, ensure_ascii=False)

    print("\n" + "=" * 60)
    print(f"Report saved to: {output_file}")


if __name__ == "__main__":
    main()