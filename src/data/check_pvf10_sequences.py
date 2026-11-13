from pathlib import Path
from collections import defaultdict
import re

BASE = Path("data/processed/pvf10")
SPLITS = ["train", "val", "test"]

groups = defaultdict(lambda: defaultdict(list))

pattern = re.compile(
    r"^(DJI_\d{14}_\d+_T)_\d+",
    re.IGNORECASE
)

for split in SPLITS:
    for image in (BASE / split).rglob("*.tif"):
        match = pattern.match(image.stem)

        if match:
            sequence_id = match.group(1)
            groups[sequence_id][split].append(str(image))

leakage_groups = []

for sequence_id, split_images in groups.items():
    if len(split_images) > 1:
        leakage_groups.append((sequence_id, split_images))

print("\nSOLARVISION - DJI SEQUENCE CHECK")
print("=" * 60)

print("Total DJI sequence IDs :", len(groups))
print("Sequences across multiple splits :", len(leakage_groups))

print("\nFIRST 10 CROSS-SPLIT SEQUENCES")

for sequence_id, split_images in leakage_groups[:10]:
    print(f"\nSequence: {sequence_id}")

    for split, images in split_images.items():
        print(f"  {split}: {len(images)} images")

print("\n" + "=" * 60)

if leakage_groups:
    print("STATUS: Potential sequence leakage detected.")
else:
    print("STATUS: No shared sequence IDs across splits.")