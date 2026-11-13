from pathlib import Path
from collections import defaultdict
from PIL import Image
import hashlib

BASE = Path("data/interim/pvf10/PVF-10/PVF_10_Ori")
EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}


def scan_split(split):
    records = []
    invalid = []

    for class_dir in sorted((BASE / split).iterdir()):
        if not class_dir.is_dir():
            continue

        for path in class_dir.iterdir():
            if path.suffix.lower() not in EXTENSIONS:
                continue

            try:
                with Image.open(path) as image:
                    image.verify()

                digest = hashlib.sha256(path.read_bytes()).hexdigest()

                records.append({
                    "path": str(path),
                    "class": class_dir.name,
                    "hash": digest,
                })

            except Exception as exc:
                invalid.append((str(path), str(exc)))

    return records, invalid


def main():
    if not BASE.is_dir():
        raise FileNotFoundError(BASE)

    train, train_invalid = scan_split("train")
    test, test_invalid = scan_split("test")

    train_hashes = defaultdict(list)

    for item in train:
        train_hashes[item["hash"]].append(item)

    duplicates = []

    for item in test:
        for match in train_hashes.get(item["hash"], []):
            duplicates.append((match, item))

    print("\nPVF-10 DATA QUALITY")
    print("=" * 55)
    print(f"Train images       : {len(train)}")
    print(f"Test images        : {len(test)}")
    print(f"Corrupted images   : {len(train_invalid) + len(test_invalid)}")
    print(f"Train/test exact duplicate pairs : {len(duplicates)}")

    if train_invalid or test_invalid:
        print("\nINVALID FILES")
        for path, error in train_invalid + test_invalid:
            print(path, error)

    if duplicates:
        print("\nEXACT DUPLICATES (first 10)")
        for a, b in duplicates[:10]:
            print(f"TRAIN: {a['path']}")
            print(f"TEST : {b['path']}\n")

    print("=" * 55)

    if not train_invalid and not test_invalid and not duplicates:
        print("STATUS: Basic integrity and exact-hash checks passed.")
    else:
        print("STATUS: Further investigation required.")


if __name__ == "__main__":
    main()