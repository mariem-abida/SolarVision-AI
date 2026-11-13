from pathlib import Path
from collections import Counter
import csv

REPORT = Path("reports/data_validation/pvf10_similar_images.csv")


def main():
    with REPORT.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    print("\nSOLARVISION - SIMILARITY ANALYSIS")
    print("=" * 60)

    print(f"Total suspicious pairs : {len(rows)}")

    print("\nDISTANCE DISTRIBUTION")
    distances = Counter(int(r["distance"]) for r in rows)

    for distance, count in sorted(distances.items()):
        print(f"Distance {distance}: {count} pairs")

    same_class = sum(
        r["class_a"] == r["class_b"]
        for r in rows
    )

    different_class = len(rows) - same_class

    print("\nCLASS COMPARISON")
    print(f"Same class      : {same_class}")
    print(f"Different class : {different_class}")

    print("\nUNIQUE IMAGES INVOLVED")
    images = {
        path
        for r in rows
        for path in (r["image_a"], r["image_b"])
    }

    print(f"Unique suspicious images : {len(images)}")

    print("\nFIRST 10 MOST SIMILAR PAIRS")

    for row in sorted(
        rows,
        key=lambda r: int(r["distance"])
    )[:10]:
        print(
            f"Distance={row['distance']} | "
            f"{row['split_a']}/{row['class_a']} -> "
            f"{row['split_b']}/{row['class_b']}"
        )
        print(f"  A: {Path(row['image_a']).name}")
        print(f"  B: {Path(row['image_b']).name}")

    print("=" * 60)


if __name__ == "__main__":
    main()