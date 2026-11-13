from pathlib import Path
from collections import defaultdict
import random
import shutil
import re
import yaml

SEED = 42
VAL_RATIO = 0.111

SOURCE = Path("data/interim/pvf10/PVF-10/PVF_10_Ori")
DEST = Path("data/processed/pvf10")

CONFIG = Path("configs/pvf10_classes.yaml")
EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"}

random.seed(SEED)


def normalize_class(name):
    # Supprime le numéro initial : 01, 02, etc.
    name = re.sub(r"^\d+", "", name)
    return " ".join(name.lower().split())


def load_classes():
    with open(CONFIG, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    classes = config["classes"]

    return {
        normalize_class(str(name)): int(idx)
        for idx, name in classes.items()
    }


def collect_images(split, class_mapping):
    result = defaultdict(list)
    split_dir = SOURCE / split

    for class_dir in sorted(split_dir.iterdir()):
        if not class_dir.is_dir():
            continue

        class_name = normalize_class(class_dir.name)

        if class_name not in class_mapping:
            raise ValueError(f"Classe inconnue : {class_dir.name}")

        class_id = class_mapping[class_name]

        for image in sorted(class_dir.iterdir()):
            if image.suffix.lower() in EXTENSIONS:
                result[class_id].append(image)

    return result


def copy_images(images, split, class_id):
    target = DEST / split / str(class_id)
    target.mkdir(parents=True, exist_ok=True)

    for image in images:
        shutil.copy2(image, target / image.name)


def main():
    if DEST.exists():
        raise FileExistsError(
            f"{DEST} existe déjà. "
            "Vérifie son contenu avant de relancer le script."
        )

    class_mapping = load_classes()

    train_data = collect_images("train", class_mapping)
    test_data = collect_images("test", class_mapping)

    print("\nSOLARVISION - PVF10 DATA PREPARATION")
    print("=" * 65)

    totals = defaultdict(int)

    for class_id in sorted(class_mapping.values()):

        images = train_data[class_id].copy()
        random.shuffle(images)

        val_count = round(len(images) * VAL_RATIO)

        val_images = images[:val_count]
        train_images = images[val_count:]

        test_images = test_data[class_id]

        copy_images(train_images, "train", class_id)
        copy_images(val_images, "val", class_id)
        copy_images(test_images, "test", class_id)

        totals["train"] += len(train_images)
        totals["val"] += len(val_images)
        totals["test"] += len(test_images)

        print(
            f"Class {class_id}: "
            f"train={len(train_images)} "
            f"val={len(val_images)} "
            f"test={len(test_images)}"
        )

    print("=" * 65)
    print(f"TRAIN : {totals['train']}")
    print(f"VAL   : {totals['val']}")
    print(f"TEST  : {totals['test']}")
    print(f"TOTAL : {sum(totals.values())}")

    print("\nDataset prepared successfully.")
    print(f"Output: {DEST}")


if __name__ == "__main__":
    main()