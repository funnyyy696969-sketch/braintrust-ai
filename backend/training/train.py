"""
train.py — fine-tune a brain-MRI classifier and export the checkpoint the
backend expects.

What it does:

  1. Loads the processed ImageFolder dataset produced by prepare_data.py
     (grayscale 1-channel, 224×224, mean 0.449 / std 0.226 — matching the
     backend's preprocessing exactly).
  2. Builds a ResNet-50 (ImageNet weights) with the first conv adapted to
     1 input channel and a 4-class head: [Glioma, Meningioma, No Tumor, Pituitary].
  3. Trains with class-weighted cross-entropy (robust to imbalanced MRI sets),
     augmentation, cosine LR schedule, early stopping on val macro-F1.
  4. Saves TWO things:
       - backend/checkpoints/brain_mri_resnet50.pt  (full model, what the
         backend + Grad-CAM service load)
       - training/runs/<stamp>/best_val.pt          (archive copy)
  5. Prints final val metrics and the confusion matrix.

Usage (Windows / VS Code terminal):

    cd backend
    python -m training.train --data data/processed --epochs 25

CPU-only machines work but are slow (expect hours). A CUDA GPU is strongly
recommended. Kaggle's free GPU is ideal: run prepare_data + train in a notebook,
download the checkpoint, drop it into backend/checkpoints/.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.prediction_service import CLASS_LABELS, MODEL_INPUT_SIZE, CHECKPOINT_PATH  # noqa: E402

IMG_MEAN = 0.449
IMG_STD = 0.226


def build_model(num_classes: int = 4, arch: str = "resnet50"):
    import torch
    import torch.nn as nn
    from torchvision import models

    if arch == "small":
        # Lightweight CNN — same I/O contract as ResNet-50 (1×224×224 in,
        # 4 logits out). Used by the smoke test where a 2 GB memory budget
        # cannot hold ResNet-50 training state.
        return nn.Sequential(
            nn.Conv2d(1, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(), nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(64, num_classes),
        )

    model = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V2)
    # Adapt first conv to single-channel (MRI luma) while keeping pretrained
    # spatial weights: sum the 3-channel filters.
    w = model.conv1.weight.data
    model.conv1 = nn.Conv2d(1, 64, kernel_size=7, stride=2, padding=3, bias=False)
    model.conv1.weight.data = w.sum(dim=1, keepdim=True)
    model.fc = nn.Linear(model.fc.in_features, num_classes)
    return model


def make_loaders(data_dir: Path, batch_size: int, num_workers: int):
    import torch
    from torch.utils.data import DataLoader
    from torchvision import datasets, transforms

    train_tf = transforms.Compose(
        [
            transforms.Grayscale(num_output_channels=1),
            transforms.Resize((MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomRotation(10),
            transforms.RandomAffine(degrees=0, translate=(0.05, 0.05), scale=(0.95, 1.05)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[IMG_MEAN], std=[IMG_STD]),
        ]
    )
    val_tf = transforms.Compose(
        [
            transforms.Grayscale(num_output_channels=1),
            transforms.Resize((MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[IMG_MEAN], std=[IMG_STD]),
        ]
    )

    train_ds = datasets.ImageFolder(str(data_dir / "train"), transform=train_tf)
    val_ds = datasets.ImageFolder(str(data_dir / "val"), transform=val_tf)

    # Sanity: ImageFolder's alphabetical class order must match CLASS_LABELS order.
    imagefolder_classes = train_ds.classes  # ['glioma','meningioma','notumor','pituitary']
    expected = [c.lower().replace(" ", "") for c in CLASS_LABELS]
    if [c.lower().replace(" ", "") for c in imagefolder_classes] != expected:
        raise RuntimeError(
            f"Class order mismatch: ImageFolder gave {imagefolder_classes}, "
            f"expected {expected}. Rename folders in prepare_data.py's output."
        )

    train_loader = DataLoader(
        train_ds, batch_size=batch_size, shuffle=True, num_workers=num_workers, pin_memory=True
    )
    val_loader = DataLoader(
        val_ds, batch_size=batch_size, shuffle=False, num_workers=num_workers, pin_memory=True
    )
    return train_loader, val_loader, train_ds.class_to_idx


def class_weights(train_loader) -> "object":
    """Inverse-frequency weights for imbalanced MRI class counts."""
    import torch

    counts = torch.zeros(len(CLASS_LABELS), dtype=torch.float64)
    for _, targets in train_loader:
        for t in targets:
            counts[t] += 1
    counts = counts.clamp(min=1)
    weights = counts.sum() / (len(counts) * counts)
    return weights.float()


def evaluate_model(model, val_loader, device) -> dict:
    import numpy as np
    import torch

    model.eval()
    all_preds, all_targets = [], []
    with torch.no_grad():
        for inputs, targets in val_loader:
            inputs = inputs.to(device)
            logits = model(inputs)
            all_preds.extend(logits.argmax(dim=1).cpu().tolist())
            all_targets.extend(targets.tolist())

    all_preds = np.array(all_preds)
    all_targets = np.array(all_targets)
    n_classes = len(CLASS_LABELS)

    per_class = {}
    f1s = []
    for k, name in enumerate(CLASS_LABELS):
        tp = int(((all_preds == k) & (all_targets == k)).sum())
        fp = int(((all_preds == k) & (all_targets != k)).sum())
        fn = int(((all_preds != k) & (all_targets == k)).sum())
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        support = int((all_targets == k).sum())
        per_class[name] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "support": support,
        }
        f1s.append(f1)

    cm = np.zeros((n_classes, n_classes), dtype=int)
    for t, p in zip(all_targets, all_preds):
        cm[t, p] += 1

    return {
        "accuracy": round(float((all_preds == all_targets).mean()), 4),
        "macro_f1": round(float(np.mean(f1s)), 4),
        "per_class": per_class,
        "confusion_matrix": cm.tolist(),
        "labels": CLASS_LABELS,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=BACKEND / "data" / "processed")
    ap.add_argument("--epochs", type=int, default=25)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--num-workers", type=int, default=2)
    ap.add_argument("--patience", type=int, default=6, help="Early-stop patience (epochs)")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    import torch
    import torch.nn as nn
    from torch.optim import AdamW
    from torch.optim.lr_scheduler import CosineAnnealingLR

    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}" + (f" ({torch.cuda.get_device_name(0)})" if device == "cuda" else ""))

    if not (args.data / "train").exists() or not (args.data / "val").exists():
        print(
            f"ERROR: {args.data}/train or /val missing. Run first:\n"
            f"  python -m training.prepare_data --src <path-to-kaggle-dataset>"
        )
        sys.exit(1)

    train_loader, val_loader, _ = make_loaders(args.data, args.batch_size, args.num_workers)
    print(f"Train batches: {len(train_loader)}  Val batches: {len(val_loader)}")

    model = build_model().to(device)
    weights = class_weights(train_loader).to(device)
    print(f"Class weights: {weights.tolist()}")
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = CosineAnnealingLR(optimizer, T_max=args.epochs)

    best_f1 = -1.0
    best_stamp = ""
    runs_dir = Path(__file__).resolve().parent / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    history = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        running_loss, seen = 0.0, 0
        for inputs, targets in train_loader:
            inputs, targets = inputs.to(device), targets.to(device)
            optimizer.zero_grad(set_to_none=True)
            logits = model(inputs)
            loss = criterion(logits, targets)
            loss.backward()
            optimizer.step()
            running_loss += loss.item() * inputs.size(0)
            seen += inputs.size(0)
        scheduler.step()

        metrics = evaluate_model(model, val_loader, device)
        history.append(
            {"epoch": epoch, "train_loss": round(running_loss / max(seen, 1), 4), **{
                k: metrics[k] for k in ("accuracy", "macro_f1")
            }}
        )
        print(
            f"epoch {epoch:>3}/{args.epochs}  loss {running_loss / max(seen, 1):.4f}  "
            f"val_acc {metrics['accuracy']:.4f}  val_macroF1 {metrics['macro_f1']:.4f}"
        )

        if metrics["macro_f1"] > best_f1:
            best_f1 = metrics["macro_f1"]
            best_stamp = stamp
            ckpt_dir = runs_dir / stamp
            ckpt_dir.mkdir(parents=True, exist_ok=True)
            torch.save(model, ckpt_dir / "best_val.pt")
            (ckpt_dir / "metrics.json").write_text(
                json.dumps({"history": history, "final": metrics}, indent=2)
            )
            torch.save(model, CHECKPOINT_PATH)  # what the backend serves
            print(f"  ↳ new best — saved to {CHECKPOINT_PATH}")

        # Early stopping
        if epoch - max((h["epoch"] for h in history), default=0) > args.patience:
            pass  # placeholder; real stop condition below
        best_so_far = max((h["macro_f1"] for h in history), default=0)
        if best_so_far >= best_f1 and epoch - max(
            (h["epoch"] for h in history if h["macro_f1"] >= best_so_far), default=0
        ) >= args.patience:
            print(f"Early stopping at epoch {epoch} (no improvement for {args.patience}).")
            break

    # Final report
    model = torch.load(CHECKPOINT_PATH, map_location=device, weights_only=False)
    final = evaluate_model(model, val_loader, device)
    print("\n=== FINAL (best checkpoint reloaded) ===")
    print(f"accuracy: {final['accuracy']:.4f}   macro-F1: {final['macro_f1']:.4f}")
    for name, m in final["per_class"].items():
        print(f"  {name:<12} P={m['precision']:.3f} R={m['recall']:.3f} F1={m['f1']:.3f} n={m['support']}")
    print("confusion matrix (rows=true, cols=pred):")
    for name, row in zip(CLASS_LABELS, final["confusion_matrix"]):
        print(f"  {name:<12} {row}")
    print(f"\nCheckpoint: {CHECKPOINT_PATH}")
    print("Backend will now enable analysis:  uvicorn app.main:app --port 8000")


if __name__ == "__main__":
    main()
