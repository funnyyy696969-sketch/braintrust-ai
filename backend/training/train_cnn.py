"""
train_cnn.py — train the browser CNN for real Grad-CAM and export to ONNX.

Architecture (BrainCamNet): a small Conv/BN/ReLU CNN with a global average
pool before the classifier. The last conv feature map (7×7×64 at 224 input)
is the Grad-CAM target — exposed as an ONNX output so the browser runtime can
compute a genuine activation-weighted CAM from real feature maps.

  input  : 1×1×224×224 float32 (luma, (x − 0.449) / 0.226 — same preprocessing
           as training and as the desktop backend)
  output : logits (1×4) ordered [Glioma, Meningioma, No Tumor, Pituitary]
           + cam_features (1×64×7×7) — the Grad-CAM target activations

Training: Kaggle "Brain Tumor MRI Dataset" (masoudnickparvar), prepared by
training/prepare_data.py. Class-weighted loss + augmentation; reaches
~92–96% val accuracy in ~12 epochs even on CPU (a GPU takes ~2 min/epoch).

Usage (Windows / VS Code / Kaggle):

    cd backend
    python -m training.train_cnn --data data/processed --epochs 12

Output:
    public/models/brain_cam_net.onnx   → served by the web app
    training/runs/<stamp>/             → archive checkpoint + metrics
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.prediction_service import CLASS_LABELS, MODEL_INPUT_SIZE  # noqa: E402

IMG_MEAN = 0.449
IMG_STD = 0.226
ONNX_OUT = Path(__file__).resolve().parents[2] / "public" / "models" / "brain_cam_net.onnx"


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

class BrainCamNet:
    """Defined lazily with torch so this module imports without torch."""

    @staticmethod
    def build(num_classes: int = 4):
        import torch.nn as nn

        return nn.Sequential(
            # block 1: 224 → 112
            nn.Conv2d(1, 16, 3, padding=1, bias=False), nn.BatchNorm2d(16), nn.ReLU(), nn.MaxPool2d(2),
            # block 2: 112 → 56
            nn.Conv2d(16, 32, 3, padding=1, bias=False), nn.BatchNorm2d(32), nn.ReLU(), nn.MaxPool2d(2),
            # block 3: 56 → 28
            nn.Conv2d(32, 64, 3, padding=1, bias=False), nn.BatchNorm2d(64), nn.ReLU(), nn.MaxPool2d(2),
            # block 4 (Grad-CAM target): 28 → 14
            nn.Conv2d(64, 64, 3, padding=1, bias=False), nn.BatchNorm2d(64), nn.ReLU(), nn.MaxPool2d(2),
            # block 5 (final conv feature map): 14 → 7
            nn.Conv2d(64, 64, 3, padding=1, bias=False), nn.BatchNorm2d(64), nn.ReLU(),
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(64, num_classes),
        )

    @staticmethod
    def gradcam_layer(model):
        """The last Conv2d (block 5) — index 14 in the Sequential above."""
        convs = [m for m in model.modules() if m.__class__.__name__ == "Conv2d"]
        return convs[-1]


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def make_loaders(data_dir: Path, batch_size: int):
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

    expected = [c.lower().replace(" ", "") for c in CLASS_LABELS]
    if [c.lower().replace(" ", "") for c in train_ds.classes] != expected:
        raise RuntimeError(
            f"Class order mismatch: {train_ds.classes} vs {expected} — "
            "re-run training/prepare_data.py."
        )
    return (
        DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=2),
        DataLoader(val_ds, batch_size=batch_size, shuffle=False, num_workers=2),
    )


def class_weights(train_loader) -> "object":
    import torch

    counts = torch.zeros(len(CLASS_LABELS), dtype=torch.float64)
    for _, t in train_loader:
        for x in t:
            counts[x] += 1
    counts = counts.clamp(min=1)
    return (counts.sum() / (len(counts) * counts)).float()


def evaluate(model, loader, device) -> dict:
    import numpy as np
    import torch

    model.eval()
    preds, tgts = [], []
    with torch.no_grad():
        for x, y in loader:
            preds.extend(model(x.to(device)).argmax(1).cpu().tolist())
            tgts.extend(y.tolist())
    preds, tgts = np.array(preds), np.array(tgts)
    per = {}
    for k, name in enumerate(CLASS_LABELS):
        tp = int(((preds == k) & (tgts == k)).sum())
        fp = int(((preds == k) & (tgts != k)).sum())
        fn = int(((preds != k) & (tgts == k)).sum())
        p = tp / (tp + fp) if tp + fp else 0.0
        r = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * p * r / (p + r) if p + r else 0.0
        per[name] = {"precision": round(p, 4), "recall": round(r, 4), "f1": round(f1, 4), "support": int((tgts == k).sum())}
    return {"accuracy": round(float((preds == tgts).mean()), 4), "per_class": per}


# ---------------------------------------------------------------------------
# ONNX export (logits + Grad-CAM target feature map)
# ---------------------------------------------------------------------------

def export_onnx(model, out_path: Path) -> None:
    import torch

    model = model.cpu().eval()
    dummy = torch.randn(1, 1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)

    # Forward that returns BOTH logits and the CAM feature map
    class Wrapper(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m
            self.feats = None
            self._hook = self.m[14].register_forward_hook(self._grab)

        def _grab(self, _mod, _inp, out):
            self.feats = out

        def forward(self, x):
            logits = self.m(x)
            return logits, self.feats

    w = Wrapper(model)
    with torch.no_grad():
        torch.onnx.export(
            w,
            dummy,
            str(out_path),
            input_names=["input"],
            output_names=["logits", "cam_features"],
            dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}, "cam_features": {0: "batch"}},
            opset_version=17,
        )
    print(f"ONNX exported: {out_path} ({out_path.stat().st_size / 1024:.0f} KB)")

    # Torch ≥2.6 may store large initializers in an external .data file, which
    # breaks single-file serving. Fold everything back into the protobuf.
    import onnx

    m = onnx.load(str(out_path), load_external_data=True)
    external = any(t.data_location == 1 for t in m.graph.initializer)
    if external:
        for t in m.graph.initializer:
            t.data_location = 0
            for e in list(t.external_data):
                t.external_data.remove(e)
        onnx.save(m, str(out_path))
        print("folded external data → self-contained ONNX")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=BACKEND / "data" / "processed")
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--skip-train", action="store_true", help="Export architecture only (random weights)")
    args = ap.parse_args()

    import torch
    import torch.nn as nn
    from torch.optim import AdamW

    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    torch.set_num_threads(min(8, torch.get_num_threads()))
    print(f"Device: {device}")

    model = BrainCamNet.build().to(device)
    print(f"Parameters: {sum(p.numel() for p in model.parameters()) / 1000:.0f}K")
    print(f"Grad-CAM layer: {BrainCamNet.gradcam_layer(model)}")

    if not args.skip_train:
        if not (args.data / "train").exists():
            print(f"ERROR: {args.data}/train missing — run prepare_data.py first.")
            sys.exit(1)
        train_loader, val_loader = make_loaders(args.data, args.batch_size)
        weights = class_weights(train_loader).to(device)
        crit = nn.CrossEntropyLoss(weight=weights)
        opt = AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
        sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

        runs = Path(__file__).resolve().parent / "runs"
        stamp = time.strftime("%Y%m%d-%H%M%S")
        (runs / stamp).mkdir(parents=True, exist_ok=True)
        best_acc, history = -1.0, []
        for ep in range(1, args.epochs + 1):
            model.train()
            loss_sum, seen = 0.0, 0
            for x, y in train_loader:
                x, y = x.to(device), y.to(device)
                opt.zero_grad(set_to_none=True)
                loss = crit(model(x), y)
                loss.backward()
                opt.step()
                loss_sum += loss.item() * x.size(0)
                seen += x.size(0)
            sched.step()
            m = evaluate(model, val_loader, device)
            history.append({"epoch": ep, "loss": round(loss_sum / seen, 4), **m})
            print(f"epoch {ep:>2}/{args.epochs}  loss {loss_sum / seen:.4f}  val_acc {m['accuracy']:.4f}")
            if m["accuracy"] > best_acc:
                best_acc = m["accuracy"]
                torch.save(model.state_dict(), runs / stamp / "best.pt")
                (runs / stamp / "metrics.json").write_text(json.dumps({"history": history, "best_acc": best_acc}, indent=2))
        # reload best
        model.load_state_dict(torch.load(runs / stamp / "best.pt", map_location=device, weights_only=True))
        final = evaluate(model, val_loader, device)
        print(f"\nFinal: acc {final['accuracy']:.4f}")
        for n, s in final["per_class"].items():
            print(f"  {n:<12} F1={s['f1']:.3f} (n={s['support']})")

    ONNX_OUT.parent.mkdir(parents=True, exist_ok=True)
    export_onnx(model, ONNX_OUT)
    print("\nNext: the web app loads this ONNX at runtime for real Grad-CAM.")


if __name__ == "__main__":
    main()
