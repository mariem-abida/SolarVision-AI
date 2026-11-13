from pathlib import Path
from collections import defaultdict, Counter
from PIL import Image
import hashlib
import re

BASE = Path("data/processed/pvf10_grouped")

SPLITS = ["train", "val", "test"]
EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"}

EXPECTED_TOTAL = 5577

PATTERN = re.compile(
    r"^(DJI_\d{14}_\d+_T)_\d+",
    re.IGNORECASE
)


def get_group(path):
    match = PATTERN.match(path.stem)

    if match:
        return match.group(1)

    return f"unknown_{path.stem}"


def main():
    sequence_splits = defaultdict(set)
    hash_records = defaultdict(list)
    total = 0
    corrupted = []
    class_counts = {}

    print("\nSOLARVISION - GROUPED DATASET VALIDATION")
    print("=" * 65)

    for split in SPLITS:
        counts = Counter()
        split_total = 0

        for class_id in range(10):
            folder = BASE / split / str(class_id)

            if not folder.is_dir():
                raise FileNotFoundError(folder)

            for path in folder.iterdir():
                if path.suffix.lower() not in EXTENSIONS:
                    continue

                counts[class_id] += 1
                split_total += 1

                sequence = get_group(path)
                sequence_splits[sequence].add(split)

                try:
                    with Image.open(path) as img:
                        img.verify()

                    digest = hashlib.sha256(
                        path.read_bytes()
                    ).hexdigest()

                    hash_records[digest].append(
                        (split, str(path))
                    )

                except Exception as exc:
                    corrupted.append((str(path), str(exc)))

        class_counts[split] = counts
        total += split_total

        print(f"\n{split.upper()}: {split_total} images")
        print("Classes:", dict(sorted(counts.items())))

    shared_sequences = {
        sequence: splits
        for sequence, splits in sequence_splits.items()
        if len(splits) > 1
    }

    duplicate_groups = [
        records
        for records in hash_records.values()
        if len({r[0] for r in records}) > 1
    ]

    missing_classes = [
        (split, class_id)
        for split in SPLITS
        for class_id in range(10)
        if class_counts[split][class_id] == 0
    ]

    print("\n" + "=" * 65)
    print("TOTAL IMAGES              :", total)
    print("EXPECTED TOTAL            :", EXPECTED_TOTAL)
    print("CORRUPTED IMAGES          :", len(corrupted))
    print("SHARED DJI SEQUENCES      :", len(shared_sequences))
    print("CROSS-SPLIT DUPLICATES    :", len(duplicate_groups))
    print("MISSING CLASSES           :", len(missing_classes))

    if shared_sequences:
        print("\nFIRST SHARED SEQUENCES:")
        for sequence in list(shared_sequences)[:5]:
            print(sequence, shared_sequences[sequence])

    if duplicate_groups:
        print("\nFIRST DUPLICATES:")
        for group in duplicate_groups[:5]:
            print(group)

    if corrupted:
        print("\nFIRST CORRUPTED IMAGES:")
        for item in corrupted[:5]:
            print(item)

    print("=" * 65)

    passed = (
        total == EXPECTED_TOTAL
        and not corrupted
        and not shared_sequences
        and not duplicate_groups
        and not missing_classes
    )

    if passed:
        print("STATUS: GROUPED DATASET VALIDATION PASSED")
    else:
        print("STATUS: FURTHER INVESTIGATION REQUIRED")


if __name__ == "__main__":
    main()