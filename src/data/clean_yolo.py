from pathlib import Path
import shutil


RAW_DIR = Path("data/raw")
INTERIM_DIR = Path("data/interim")


# ============================================================
# ANNOTATIONS INVALIDES À RETIRER
# ============================================================

INVALID_DEFECT_ANNOTATIONS = {
    (
        "5_Beatrix_Vision_images-20-35-_jpeg-Copy_jpg."
        "rf.89eb1c481cafb76baeb88757c953c473.txt",
        7,
    ),
    (
        "5_Beatrix_Vision_IR_0224_jpg."
        "rf.8b2f0630a61229d23f20216f3efc1e21.txt",
        3,
    ),
}


# ============================================================
# IMAGES PANEL SANS ANNOTATION
# ============================================================

PANEL_IMAGES_TO_EXCLUDE = {
    (
        "DJI_20230213170209_0001_T_JPG."
        "rf.95b9dbd9c1b1989c443bc23d004cb355.jpg"
    ),
    (
        "DJI_20230213170213_0003_T_JPG."
        "rf.18f02dbe2b7e0d7981d3578a9243d566.jpg"
    ),
}


def copy_dataset(source: Path, destination: Path):
    """Copy raw dataset to interim without modifying raw data."""

    if destination.exists():
        shutil.rmtree(destination)

    print(f"Copying {source} -> {destination}")

    shutil.copytree(source, destination)


def clean_defect_annotations(dataset_path: Path):
    """Remove the two known invalid YOLO annotations."""

    labels_dir = dataset_path / "train" / "labels"

    removed = 0

    for filename, target_line in INVALID_DEFECT_ANNOTATIONS:

        label_path = labels_dir / filename

        if not label_path.exists():
            print(f"WARNING: label not found: {label_path}")
            continue

        lines = label_path.read_text(
            encoding="utf-8"
        ).splitlines()

        if target_line > len(lines):
            print(
                f"WARNING: line {target_line} does not exist "
                f"in {label_path}"
            )
            continue

        removed_content = lines[target_line - 1]

        del lines[target_line - 1]

        label_path.write_text(
            "\n".join(lines) + ("\n" if lines else ""),
            encoding="utf-8"
        )

        removed += 1

        print("\nRemoved invalid annotation:")
        print(f"  File : {filename}")
        print(f"  Line : {target_line}")
        print(f"  Data : {removed_content}")

    return removed


def remove_unlabeled_panel_images(dataset_path: Path):
    """Exclude known panel images that have no YOLO annotation."""

    images_dir = dataset_path / "train" / "images"

    removed = 0

    for filename in PANEL_IMAGES_TO_EXCLUDE:

        image_path = images_dir / filename

        if not image_path.exists():
            print(f"WARNING: image not found: {image_path}")
            continue

        image_path.unlink()

        removed += 1

        print("\nExcluded unlabeled image:")
        print(f"  {filename}")

    return removed


def main():

    print("\nSOLARVISION - YOLO DATA CLEANING")
    print("=" * 65)

    defect_raw = RAW_DIR / "defect_detection"
    panel_raw = RAW_DIR / "panel_detection"

    defect_interim = INTERIM_DIR / "defect_detection"
    panel_interim = INTERIM_DIR / "panel_detection"

    # --------------------------------------------------------
    # Safety checks
    # --------------------------------------------------------

    if not defect_raw.exists():
        raise FileNotFoundError(defect_raw)

    if not panel_raw.exists():
        raise FileNotFoundError(panel_raw)

    INTERIM_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    # --------------------------------------------------------
    # Copy RAW -> INTERIM
    # --------------------------------------------------------

    copy_dataset(
        defect_raw,
        defect_interim
    )

    copy_dataset(
        panel_raw,
        panel_interim
    )

    # --------------------------------------------------------
    # Clean defect detection
    # --------------------------------------------------------

    print("\nCleaning defect_detection...")

    removed_annotations = clean_defect_annotations(
        defect_interim
    )

    # --------------------------------------------------------
    # Clean panel detection
    # --------------------------------------------------------

    print("\nCleaning panel_detection...")

    removed_images = remove_unlabeled_panel_images(
        panel_interim
    )

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    print("\n" + "=" * 65)
    print("CLEANING SUMMARY")
    print("=" * 65)

    print(
        f"Invalid annotations removed : "
        f"{removed_annotations}"
    )

    print(
        f"Unlabeled images excluded   : "
        f"{removed_images}"
    )

    print("\nRAW datasets were NOT modified.")

    print(
        "Clean datasets are available in:"
    )

    print(
        "  data/interim/defect_detection"
    )

    print(
        "  data/interim/panel_detection"
    )

    print("=" * 65)


if __name__ == "__main__":
    main()