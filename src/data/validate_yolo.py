from pathlib import Path
from collections import Counter


# ============================================================
# CONFIGURATION
# ============================================================

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".tif",
    ".tiff"
}

DATASETS = {
    "defect_detection": {
        "path": Path("data/interim/defect_detection"),
        "splits": ["train", "valid", "test"],
    },

    "panel_detection": {
        "path": Path("data/interim/panel_detection"),
        "splits": ["train", "val", "test"],
    },
}

for dataset_name, config in DATASETS.items():
    dataset_path = config["path"]

    if not dataset_path.exists():
        raise FileNotFoundError(
            f"Dataset introuvable : {dataset_path.resolve()}"
        )

    print(
        f"[OK] {dataset_name} -> {dataset_path.resolve()}"
    )

    
# ============================================================
# VALIDATION D'UN SPLIT YOLO
# ============================================================

def validate_split(dataset_name, dataset_path, split):

    images_dir = dataset_path / split / "images"
    labels_dir = dataset_path / split / "labels"

    print(f"\n  [{split}]")

    # --------------------------------------------------------
    # Vérification des dossiers
    # --------------------------------------------------------

    if not images_dir.exists():
        print(f"  ERROR: images directory not found: {images_dir}")
        return None

    if not labels_dir.exists():
        print(f"  ERROR: labels directory not found: {labels_dir}")
        return None

    # --------------------------------------------------------
    # Récupération des images
    # --------------------------------------------------------

    images = {
        p.stem: p
        for p in images_dir.iterdir()
        if p.is_file()
        and p.suffix.lower() in IMAGE_EXTENSIONS
    }

    # --------------------------------------------------------
    # Récupération des labels YOLO
    # --------------------------------------------------------

    labels = {
        p.stem: p
        for p in labels_dir.glob("*.txt")
    }

    # --------------------------------------------------------
    # Images sans label / labels sans image
    # --------------------------------------------------------

    missing_labels = set(images) - set(labels)

    orphan_labels = set(labels) - set(images)

    # --------------------------------------------------------
    # Variables de validation
    # --------------------------------------------------------

    empty_labels = []

    invalid_lines = []

    class_counts = Counter()

    boxes = 0

    # --------------------------------------------------------
    # Analyse de chaque fichier label
    # --------------------------------------------------------

    for stem, label_path in labels.items():

        try:
            content = label_path.read_text(
                encoding="utf-8",
                errors="ignore"
            ).strip()

        except Exception as error:

            invalid_lines.append(
                (
                    str(label_path),
                    0,
                    f"Cannot read file: {error}",
                    ""
                )
            )

            continue

        # ----------------------------------------------------
        # Label vide
        # ----------------------------------------------------

        if not content:

            empty_labels.append(str(label_path))

            continue

        # ----------------------------------------------------
        # Analyse ligne par ligne
        # ----------------------------------------------------

        for line_number, line in enumerate(
            content.splitlines(),
            start=1
        ):

            parts = line.split()

            # YOLO standard :
            # class x_center y_center width height

            if len(parts) != 5:

                invalid_lines.append(
                    (
                        str(label_path),
                        line_number,
                        f"Expected 5 values, found {len(parts)}",
                        line
                    )
                )

                continue

            # ------------------------------------------------
            # Conversion numérique
            # ------------------------------------------------

            try:

                class_value = float(parts[0])

                class_id = int(class_value)

                x = float(parts[1])
                y = float(parts[2])
                w = float(parts[3])
                h = float(parts[4])

            except ValueError:

                invalid_lines.append(
                    (
                        str(label_path),
                        line_number,
                        "Non-numeric value",
                        line
                    )
                )

                continue

            # ------------------------------------------------
            # Vérification class ID
            # ------------------------------------------------

            if class_value != class_id or class_id < 0:

                invalid_lines.append(
                    (
                        str(label_path),
                        line_number,
                        f"Invalid class ID: {parts[0]}",
                        line
                    )
                )

                continue

            # ------------------------------------------------
            # Vérification bbox YOLO
            # ------------------------------------------------

            if not (
                0 <= x <= 1
                and 0 <= y <= 1
                and 0 < w <= 1
                and 0 < h <= 1
            ):

                invalid_lines.append(
                    (
                        str(label_path),
                        line_number,
                        (
                            "Invalid bbox "
                            f"(x={x}, y={y}, w={w}, h={h})"
                        ),
                        line
                    )
                )

                continue

            # ------------------------------------------------
            # Annotation valide
            # ------------------------------------------------

            class_counts[class_id] += 1

            boxes += 1

    # ========================================================
    # AFFICHAGE DES ANOMALIES
    # ========================================================

    if missing_labels:

        print("\n    >>> IMAGES WITHOUT LABEL:")

        for stem in sorted(missing_labels):

            print(
                f"        {images[stem]}"
            )

    if orphan_labels:

        print("\n    >>> LABELS WITHOUT IMAGE:")

        for stem in sorted(orphan_labels):

            print(
                f"        {labels[stem]}"
            )

    if invalid_lines:

        print("\n    >>> INVALID ANNOTATIONS:")

        for (
            path,
            line_number,
            reason,
            content
        ) in invalid_lines:

            print(f"\n        File   : {path}")

            print(
                f"        Line   : {line_number}"
            )

            print(
                f"        Reason : {reason}"
            )

            if content:

                print(
                    f"        Content: {content}"
                )

    # ========================================================
    # RÉSULTATS
    # ========================================================

    result = {

        "dataset": dataset_name,

        "split": split,

        "images": len(images),

        "labels": len(labels),

        "bounding_boxes": boxes,

        "missing_labels": len(
            missing_labels
        ),

        "orphan_labels": len(
            orphan_labels
        ),

        "empty_labels": len(
            empty_labels
        ),

        "invalid_annotations": len(
            invalid_lines
        ),

        "classes": dict(
            class_counts
        ),
    }

    # --------------------------------------------------------
    # Résumé
    # --------------------------------------------------------

    print(
        f"  Images              : "
        f"{result['images']}"
    )

    print(
        f"  Labels              : "
        f"{result['labels']}"
    )

    print(
        f"  Bounding boxes      : "
        f"{result['bounding_boxes']}"
    )

    print(
        f"  Missing labels      : "
        f"{result['missing_labels']}"
    )

    print(
        f"  Orphan labels       : "
        f"{result['orphan_labels']}"
    )

    print(
        f"  Empty labels        : "
        f"{result['empty_labels']}"
    )

    print(
        f"  Invalid annotations : "
        f"{result['invalid_annotations']}"
    )

    print(
        f"  Classes             : "
        f"{result['classes']}"
    )

    return result


# ============================================================
# PROGRAMME PRINCIPAL
# ============================================================

def main():

    print(
        "\nSOLARVISION - YOLO VALIDATION"
    )

    print("=" * 65)

    all_results = []

    for dataset_name, config in DATASETS.items():

        print(
            f"\nDATASET: "
            f"{dataset_name.upper()}"
        )

        for split in config["splits"]:

            result = validate_split(
                dataset_name,
                config["path"],
                split
            )

            if result is not None:

                all_results.append(
                    result
                )

    # ========================================================
    # RÉSUMÉ GLOBAL
    # ========================================================

    print("\n" + "=" * 65)

    print(
        "GLOBAL VALIDATION SUMMARY"
    )

    print("=" * 65)

    total_images = sum(
        r["images"]
        for r in all_results
    )

    total_labels = sum(
        r["labels"]
        for r in all_results
    )

    total_boxes = sum(
        r["bounding_boxes"]
        for r in all_results
    )

    total_missing = sum(
        r["missing_labels"]
        for r in all_results
    )

    total_orphans = sum(
        r["orphan_labels"]
        for r in all_results
    )

    total_empty = sum(
        r["empty_labels"]
        for r in all_results
    )

    total_invalid = sum(
        r["invalid_annotations"]
        for r in all_results
    )

    print(
        f"Total images              : "
        f"{total_images}"
    )

    print(
        f"Total labels              : "
        f"{total_labels}"
    )

    print(
        f"Total valid bounding boxes: "
        f"{total_boxes}"
    )

    print(
        f"Total missing labels      : "
        f"{total_missing}"
    )

    print(
        f"Total orphan labels       : "
        f"{total_orphans}"
    )

    print(
        f"Total empty labels        : "
        f"{total_empty}"
    )

    print(
        f"Total invalid annotations : "
        f"{total_invalid}"
    )

    print("=" * 65)

    # --------------------------------------------------------
    # Verdict
    # --------------------------------------------------------

    if (
        total_missing == 0
        and total_orphans == 0
        and total_invalid == 0
    ):

        print(
            "STATUS: YOLO datasets are structurally valid."
        )

    else:

        print(
            "STATUS: Problems detected. "
            "Do not train yet."
        )

    print("=" * 65)


if __name__ == "__main__":
    main()