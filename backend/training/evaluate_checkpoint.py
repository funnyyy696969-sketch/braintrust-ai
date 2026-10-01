"""
evaluate_checkpoint.py — validate a trained checkpoint before trusting it.

Loads backend/checkpoints/brain_mri_resnet50.pt, runs it over the processed
validation split, and reports accuracy, per-class precision/recall/F1 and the
confusion matrix. Exits non-zero if the checkpoint is missing or performs
at/below chance, so it can gate a release.

Usage:

    cd backend
    python -m training.evaluate_checkpoint
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.prediction_service import (  # noqa: E402
    CHECKPOINT_PATH,
    checkpoint_available,
)
from training.train import evaluate_model, make_loaders  # noqa: E402


def main() -> None:
    if not checkpoint_available():
        print(f"ERROR: no checkpoint at {CHECKPOINT_PATH}")
        print("Train first:  python -m training.train --data data/processed")
        sys.exit(1)

    import torch

    data_dir = BACKEND / "data" / "processed"
    if not (data_dir / "val").exists():
        print(f"ERROR: {data_dir}/val missing — run prepare_data.py first.")
        sys.exit(1)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = torch.load(CHECKPOINT_PATH, map_location=device, weights_only=False)
    model.eval()

    _, val_loader, _ = make_loaders(data_dir, batch_size=32, num_workers=2)
    metrics = evaluate_model(model, val_loader, device)

    print("\n=== Checkpoint evaluation ===")
    print(f"checkpoint : {CHECKPOINT_PATH}")
    print(f"accuracy   : {metrics['accuracy']:.4f}")
    print(f"macro-F1   : {metrics['macro_f1']:.4f}")
    for name, m in metrics["per_class"].items():
        print(f"  {name:<12} P={m['precision']:.3f} R={m['recall']:.3f} F1={m['f1']:.3f} n={m['support']}")
    print("confusion matrix (rows=true, cols=pred):")
    for name, row in zip(metrics["labels"], metrics["confusion_matrix"]):
        print(f"  {name:<12} {row}")

    # Chance-level guard: 4 classes → 0.25 accuracy. Refuse to bless a broken ckpt.
    if metrics["accuracy"] <= 0.25:
        print("\nFAILED: accuracy at/below chance — checkpoint is NOT usable.")
        sys.exit(2)
    print("\nPASSED: checkpoint performs above chance and can be served.")


if __name__ == "__main__":
    main()
