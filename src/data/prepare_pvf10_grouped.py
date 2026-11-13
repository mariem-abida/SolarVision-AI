from pathlib import Path
from collections import defaultdict, Counter
from sklearn.model_selection import GroupShuffleSplit
import shutil
import random
import re
import json

SEED = 42

SOURCE = Path("data/processed/pvf10")
DEST = Path("data/processed/pvf10_grouped")

EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"}

pattern = re.compile(
    r"^(DJI_\d{14}_\d+_T)_\d+",
    re.IGNORECASE
)


def get_group(path):
    match = pattern.match(path.stem)

    if match:
        return match.group(1)

    # En l'absence d'identifiant DJI, chaque image
    # reçoit son propre groupe.
    return f"unknown_{path.stem}"


def collect_images():
    records = []

    for split in ["train", "val", "test"]:
        for class_dir in (SOURCE / split).iterdir():
            if not class_dir.is_dir():
                continue

            for path in class_dir.iterdir():
                if path.suffix.lower() not in EXTENSIONS:
                    continue

                records.append({
                    "path": path,
                    "class": class_dir.name,
                    "group": get_group(path),
                })

    return records


def main():
    if DEST.exists():
        raise FileExistsError(
            f"{DEST} existe déjà. "
            "Vérifie son contenu avant de relancer."
        )

    records = collect_images()

    groups = [r["group"] for r in records]

    indices = list(range(len(records)))

    splitter = GroupShuffleSplit(
        n_splits=1,
        test_size=0.10,
        random_state=SEED
    )

    trainval_idx, test_idx = next(
        splitter.split(indices, groups=groups)
    )

    trainval = [records[i] for i in trainval_idx]
    test = [records[i] for i in test_idx]

    splitter2 = GroupShuffleSplit(
        n_splits=1,
        test_size=0.111,
        random_state=SEED
    )

    train_idx, val_idx = next(
        splitter2.split(
            trainval,
            groups=[r["group"] for r in trainval]
        )
    )

    train = [trainval[i] for i in train_idx]
    val = [trainval[i] for i in val_idx]

    splits = {
        "train": train,
        "val": val,
        "test": test,
    }

    summary = {}

    for split, items in splits.items():
        counts = Counter()

        for item in items:
            target = DEST / split / item["class"]
            target.mkdir(parents=True, exist_ok=True)

            shutil.copy2(
                item["path"],
                target / item["path"].name
            )

            counts[item["class"]] += 1

        summary[split] = {
            "images": len(items),
            "classes": dict(counts),
            "groups": len(set(i["group"] for i in items)),
        }

    DEST.mkdir(parents=True, exist_ok=True)

    with (DEST / "split_summary.json").open(
        "w", encoding="utf-8"
    ) as f:
        json.dump(summary, f, indent=2)

    print("\nSOLARVISION - GROUPED SPLIT")
    print("=" * 60)

    for split, info in summary.items():
        print(
            f"{split.upper():5}: "
            f"{info['images']} images | "
            f"{info['groups']} groups"
        )
        print("Classes:", info["classes"])

    print("=" * 60)
    print("Grouped dataset:", DEST)


if __name__ == "__main__":
    main()