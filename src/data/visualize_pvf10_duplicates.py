from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
import matplotlib.pyplot as plt
import csv

REPORT = Path("reports/data_validation/pvf10_similar_images.csv")
OUTPUT = Path("reports/data_validation/pvf10_visual_review.png")

with REPORT.open("r", encoding="utf-8", newline="") as f:
    rows = list(csv.DictReader(f))

pairs = [r for r in rows if int(r["distance"]) == 0]

if not pairs:
    print("Aucune paire avec distance 0.")
    raise SystemExit

fig, axes = plt.subplots(
    len(pairs), 2,
    figsize=(12, 3 * len(pairs)),
    squeeze=False
)

for i, pair in enumerate(pairs):
    for j, key in enumerate(["image_a", "image_b"]):
        path = Path(pair[key])

        with Image.open(path) as img:
            image = img.convert("RGB").copy()

        axes[i, j].imshow(image)
        axes[i, j].set_title(
            f"{pair['split_a'] if j == 0 else pair['split_b']} "
            f"| classe {pair['class_a'] if j == 0 else pair['class_b']}\n"
            f"{path.name}",
            fontsize=9
        )
        axes[i, j].axis("off")

plt.tight_layout()

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
plt.savefig(OUTPUT, dpi=150, bbox_inches="tight")
plt.close()

print(f"Nombre de paires : {len(pairs)}")
print(f"Image de comparaison créée : {OUTPUT}")