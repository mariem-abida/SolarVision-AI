from pathlib import Path
from collections import defaultdict
from PIL import Image
import imagehash
import csv

BASE = Path("data/processed/pvf10")
SPLITS = ["train", "val", "test"]
EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"}

THRESHOLD = 4
REPORT = Path("reports/data_validation/pvf10_similar_images.csv")


def collect_hashes():
    records = []

    for split in SPLITS:
        split_dir = BASE / split

        for class_dir in sorted(split_dir.iterdir()):
            if not class_dir.is_dir():
                continue

            for path in sorted(class_dir.iterdir()):
                if path.suffix.lower() not in EXTENSIONS:
                    continue

                with Image.open(path) as img:
                    h = imagehash.phash(img.convert("RGB"))

                records.append({
                    "split": split,
                    "class": class_dir.name,
                    "path": str(path),
                    "hash": h,
                })

    return records


def main():
    print("\nSOLARVISION - PVF10 SIMILARITY CHECK")
    print("=" * 60)

    records = collect_hashes()

    groups = defaultdict(list)

    for record in records:
        groups[record["split"]].append(record)

    comparisons = [
        ("train", "val"),
        ("train", "test"),
        ("val", "test"),
    ]

    similar = []

    for split_a, split_b in comparisons:
        print(f"\nChecking {split_a} vs {split_b}...")

        count = 0

        for a in groups[split_a]:
            for b in groups[split_b]:
                distance = a["hash"] - b["hash"]

                if distance <= THRESHOLD:
                    similar.append({
                        "split_a": split_a,
                        "class_a": a["class"],
                        "image_a": a["path"],
                        "split_b": split_b,
                        "class_b": b["class"],
                        "image_b": b["path"],
                        "distance": distance,
                    })

                    count += 1

        print(f"Potentially similar pairs: {count}")

    REPORT.parent.mkdir(parents=True, exist_ok=True)

    with open(REPORT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "split_a", "class_a", "image_a",
                "split_b", "class_b", "image_b", "distance"
            ]
        )

        writer.writeheader()
        writer.writerows(similar)

    print("\n" + "=" * 60)
    print(f"Images analyzed : {len(records)}")
    print(f"Potentially similar pairs : {len(similar)}")
    print(f"Report : {REPORT}")

    if similar:
        print("STATUS: Review required before final training.")
    else:
        print("STATUS: No near-duplicates detected at this threshold.")


if __name__ == "__main__":
    main()