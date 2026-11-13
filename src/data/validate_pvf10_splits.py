from pathlib import Path
from collections import defaultdict
from PIL import Image
import hashlib

BASE = Path("data/processed/pvf10")
SPLITS = ["train", "val", "test"]
CLASSES = [str(i) for i in range(10)]
EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}


def main():
    hashes = defaultdict(list)
    totals = {}
    corrupted = []
    errors = []

    print("\nSOLARVISION - PVF10 SPLIT VALIDATION")
    print("=" * 60)

    for split in SPLITS:
        split_total = 0

        for class_id in CLASSES:
            folder = BASE / split / class_id

            if not folder.is_dir():
                errors.append(f"Missing folder: {folder}")
                continue

            images = sorted(
                p for p in folder.iterdir()
                if p.is_file() and p.suffix.lower() in EXTENSIONS
            )

            split_total += len(images)

            for path in images:
                try:
                    with Image.open(path) as img:
                        img.verify()

                    digest = hashlib.sha256(path.read_bytes()).hexdigest()
                    hashes[digest].append((split, class_id, str(path)))

                except Exception as exc:
                    corrupted.append((str(path), str(exc)))

        totals[split] = split_total
        print(f"{split.upper():5} : {split_total} images")

    duplicate_groups = []

    for digest, records in hashes.items():
        involved_splits = {r[0] for r in records}

        if len(involved_splits) > 1:
            duplicate_groups.append(records)

    print("-" * 60)
    print(f"TOTAL                : {sum(totals.values())}")
    print(f"Corrupted images     : {len(corrupted)}")
    print(f"Cross-split duplicate groups : {len(duplicate_groups)}")
    print(f"Missing folders      : {len(errors)}")

    if duplicate_groups:
        print("\nDUPLICATES (first 10 groups)")
        for group in duplicate_groups[:10]:
            for record in group:
                print(record)
            print()

    if corrupted:
        print("\nCORRUPTED FILES")
        for path, error in corrupted[:10]:
            print(path, error)

    if errors:
        print("\nSTRUCTURE ERRORS")
        for error in errors:
            print(error)

    expected = {"train": 4467, "val": 557, "test": 553}

    counts_ok = totals == expected

    print("=" * 60)

    if counts_ok and not corrupted and not duplicate_groups and not errors:
        print("STATUS: Basic split validation PASSED")
    else:
        print("STATUS: Further investigation required")


if __name__ == "__main__":
    main()