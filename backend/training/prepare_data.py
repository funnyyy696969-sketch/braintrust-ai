"""
prepare_data.py — organise the Kaggle "Brain Tumor MRI Dataset" into an
ImageFolder layout for training and validation.

Two common source layouts are auto-detected:

  A) Training/  Testing/       → both contain the 4 class subfolders (the
                                 misspelled "pituitary"/"notumor" variants
                                 are matched case-insensitively)
  B) Training/  Validation/    → same idea

Result (created at --out, default backend/data/processed):

  processed/
    train/<class>/*.jpg
    val/<class>/*.jpg

Classes are normalised to exactly: glioma, meningioma, notumor, pituitary
(matched case-insensitively / ignoring separators).

Usage (Windows / VS Code terminal):

    cd backend
    python -m training.prepare_data --src "C:/datasets/Brain Tumor MRI Dataset"

Then verify:

    python -m training.prepare_data --verify-only
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

CLASSES = ["glioma", "meningioma", "notumor", "pituitary"]
SPLITS = ["train", "val"]


def normalise_class(name: str) -> str | None:
    """Map any of 'Glioma', 'glioma ', 'no_tumor', 'notumor', 'Pituitary'… to a class."""
    key = name.strip().lower().replace(" ", "").replace("_", "").replace("-", "")
    key = key.replace("notumor", "notumor").replace("tumor", "tumor")
    if key in CLASSES:
        return key
    # Common dataset variants
    if key in {"glioma_tumor", "gliomatumor"}:
        return "glioma"
    if key in {"meningioma_tumor", "meningiomatumor"}:
        return "meningioma"
    if key in {"pituitary_tumor", "pituitarytumor"}:
        return "pituitary"
    if key in {"no_tumor", "notumor", "notumor_tumor", "normal"}:
        return "notumor"
    return None


def split_source_dirs(src: Path) -> list[Path]:
    """Find the source split folders (Training/Testing or Training/Validation)."""
    found: list[Path] = []
    for name in ("Training", "training", "Testing", "testing", "Validation", "validation"):
        p = src / name
        if p.is_dir() and any(p.iterdir()):
            found.append(p)
    # Nested layout: <src>/<dataset-root>/Training/...
    if not found:
        for child in src.iterdir():
            if child.is_dir():
                for name in ("Training", "training", "Testing", "testing", "Validation"):
                    p = child / name
                    if p.is_dir() and any(p.iterdir()):
                        found.append(p)
    return found


def is_train_split(path: Path) -> bool:
    return "train" in path.name.lower()


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}


def count_images(directory: Path) -> int:
    return sum(1 for f in directory.rglob("*") if f.suffix.lower() in IMAGE_EXTS)


def prepare(src: Path, out: Path, val_fraction: float = 0.15, seed: int = 42) -> dict:
    import random

    rng = random.Random(seed)
    sources = split_source_dirs(src)
    if not sources:
        print(
            f"ERROR: could not find Training/Testing (or Training/Validation) "
            f"folders under {src}\n"
            f"Expected e.g. {src}/Training/glioma/*.jpg"
        )
        sys.exit(1)

    # Wipe previous output to avoid stale class folders
    if out.exists():
        shutil.rmtree(out)
    for split in SPLITS:
        for cls in CLASSES:
            (out / split / cls).mkdir(parents=True, exist_ok=True)

    stats: dict[str, dict[str, int]] = {cls: {"train": 0, "val": 0} for cls in CLASSES}
    copied = 0
    for split_dir in sources:
        train_like = is_train_split(split_dir)
        for entry in sorted(split_dir.iterdir()):
            if not entry.is_dir():
                continue
            cls = normalise_class(entry.name)
            if cls is None:
                print(f"  skipping unknown class folder: {entry.name}")
                continue
            images = sorted(
                f for f in entry.iterdir() if f.suffix.lower() in IMAGE_EXTS
            )
            rng.shuffle(images)
            n_val = 0 if not train_like else int(len(images) * val_fraction)
            for i, img in enumerate(images):
                split = "val" if i < n_val else "train"
                dest = out / split / cls / img.name
                # De-duplicate filenames within a class
                stem, ext = img.stem, img.suffix.lower()
                n = 1
                while dest.exists():
                    dest = out / split / cls / f"{stem}_{n}{ext}"
                    n += 1
                shutil.copy2(img, dest)
                stats[cls][split] += 1
                copied += 1

    print(f"\nCopied {copied} images → {out}")
    for cls in CLASSES:
        print(f"  {cls:<12} train={stats[cls]['train']:<6} val={stats[cls]['val']}")
    total_val = sum(s["val"] for s in stats.values())
    if total_val == 0:
        print(
            "WARNING: no validation images were produced. Provide a Testing/ "
            "folder or raise --val-fraction."
        )
        sys.exit(1)
    return stats


def verify(out: Path) -> bool:
    ok = True
    for split in SPLITS:
        for cls in CLASSES:
            d = out / split / cls
            n = count_images(d) if d.exists() else 0
            mark = "OK " if n > 0 else "MISSING"
            if n == 0:
                ok = False
            print(f"  {mark} {split}/{cls:<12} {n} images")
    return ok


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", type=Path, default=None, help="Path to the Kaggle dataset root")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "processed")
    ap.add_argument("--val-fraction", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--verify-only", action="store_true", help="Just verify the processed layout")
    args = ap.parse_args()

    if args.verify_only or args.src is None:
        ok = verify(args.out)
        sys.exit(0 if ok else 1)
    prepare(args.src, args.out, args.val_fraction, args.seed)
    print("\nVerify with:  python -m training.prepare_data --verify-only")


if __name__ == "__main__":
    main()
