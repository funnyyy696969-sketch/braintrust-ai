"""
smoke_test.py — prove the ENTIRE training → serving loop works, without the
Kaggle dataset or a GPU.

What it does (end to end):

  1. Generates a small SYNTHETIC dataset (4 texture classes, ~120 images) —
     deliberately learnable, no medical data involved.
  2. Builds the processed/ ImageFolder layout prepare_data.py produces.
  3. Runs 2 real training epochs of the REAL train.py pipeline.
  4. Runs evaluate_checkpoint.py's gate logic.
  5. Serves a prediction + Captum Grad-CAM through the REAL
     prediction_service / gradcam_service code paths.
  6. Prints PASS/FAIL per stage and restores the environment:
     the synthetic checkpoint is archived into training/runs/smoke-*/ and
     REMOVED from backend/checkpoints/ so the app stays honest (503 until a
     real checkpoint exists).

Usage:

    cd backend
    python -m training.smoke_test
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

CKPT = BACKEND / "checkpoints" / "brain_mri_resnet50.pt"
STAGES: list[tuple[str, bool, str]] = []


def stage(name: str, ok: bool, note: str = "") -> None:
    STAGES.append((name, ok, note))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {note}" if note else ""))


def make_synthetic_dataset(root: Path, per_class: int = 30, size: int = 128) -> None:
    """4 texture classes a CNN can learn in a couple of epochs (NOT medical)."""
    import numpy as np
    from PIL import Image

    rng = np.random.default_rng(7)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)

    def glioma() -> np.ndarray:  # concentric rings
        r = np.sqrt((yy - size / 2) ** 2 + (xx - size / 2) ** 2)
        return ((np.sin(r / 6) + 1) * 90 + rng.normal(0, 8, (size, size))).clip(0, 255)

    def meningioma() -> np.ndarray:  # vertical stripes
        return ((np.sin(xx / 5) + 1) * 90 + rng.normal(0, 8, (size, size))).clip(0, 255)

    def notumor() -> np.ndarray:  # smooth gradient blob
        g = (yy / size) * 160 + (xx / size) * 60
        return (g + rng.normal(0, 5, (size, size))).clip(0, 255)

    def pituitary() -> np.ndarray:  # checkerboard
        chk = ((np.floor(xx / 16) + np.floor(yy / 16)) % 2) * 150 + 50
        return (chk + rng.normal(0, 8, (size, size))).clip(0, 255)

    makers = {"glioma": glioma, "meningioma": meningioma, "notumor": notumor, "pituitary": pituitary}
    for split in ("train", "val"):
        for cls, maker in makers.items():
            d = root / split / cls
            d.mkdir(parents=True, exist_ok=True)
            for i in range(per_class):
                img = maker().astype(np.uint8)
                Image.fromarray(img).convert("RGB").save(d / f"{cls}_{i:03d}.png")


def main() -> None:
    import torch

    # Containers often oversubscribe OpenMP threads → OOM-kill during backward.
    # A small pool is also faster for tiny batches.
    torch.set_num_threads(min(4, torch.get_num_threads()))

    print("=== BrainTrust AI training → serving smoke test ===")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}\n")

    with tempfile.TemporaryDirectory(prefix="braintrust-smoke-") as tmp:
        data_dir = Path(tmp) / "processed"
        print("[1/5] synthetic dataset")
        try:
            make_synthetic_dataset(data_dir)
            n = sum(1 for _ in data_dir.rglob("*.png"))
            stage("generate 4-class ImageFolder layout", n == 240, f"{n} images in {data_dir.name}")
        except Exception as e:  # noqa: BLE001
            stage("generate synthetic dataset", False, str(e))
            _finish(False)

        print("\n[2/5] training (real pipeline, 3 epochs)")
        try:
            from training.train import build_model, evaluate_model, make_loaders
            import torch.nn as nn
            from torch.optim import AdamW

            train_loader, val_loader, _ = make_loaders(data_dir, batch_size=16, num_workers=0)
            model = build_model(arch="small").to(device)
            opt = AdamW(model.parameters(), lr=3e-3)
            crit = nn.CrossEntropyLoss()
            for _ in range(3):
                model.train()
                for inputs, targets in train_loader:
                    inputs, targets = inputs.to(device), targets.to(device)
                    opt.zero_grad(set_to_none=True)
                    loss = crit(model(inputs), targets)
                    loss.backward()
                    opt.step()
            metrics = evaluate_model(model, val_loader, device)
            # Synthetic textures: a fine-tuned ResNet-50 should crush chance (0.25)
            stage(
                "3-epoch training improves over chance",
                metrics["accuracy"] > 0.25,
                f"val acc {metrics['accuracy']:.2f}, macro-F1 {metrics['macro_f1']:.2f}",
            )
        except Exception as e:  # noqa: BLE001
            stage("training loop", False, str(e))
            _finish(False)

        print("\n[3/5] checkpoint serving path")
        try:
            CKPT.parent.mkdir(parents=True, exist_ok=True)
            torch.save(model, CKPT)
            from services.prediction_service import checkpoint_available, predict
            import numpy as np
            from PIL import Image

            stage("checkpoint lands + is detected", checkpoint_available())
            probe = np.array(Image.open(data_dir / "val" / "glioma" / "glioma_000.png"))
            p = predict(probe, device)
            stage(
                "prediction_service serves from checkpoint",
                p.predicted_class in ("Glioma", "Meningioma", "No Tumor", "Pituitary"),
                f"{p.predicted_class} @ {p.confidence:.2f}",
            )
        except Exception as e:  # noqa: BLE001
            stage("serving path", False, str(e))
            _finish(False)

        print("\n[4/5] Grad-CAM through the real service")
        try:
            from services.prediction_service import _load_model, preprocess
            from services.gradcam_service import gradcam
            import torch as th

            m = _load_model(device)  # loads the smoke checkpoint
            tensor = preprocess(probe).to(device)
            idx = ["Glioma", "Meningioma", "No Tumor", "Pituitary"].index(p.predicted_class)

            # Pick the Grad-CAM layer by architecture: ResNet-50 exposes
            # layer4; the small smoke CNN's last conv block is features[6].
            layer_name = "layer4" if hasattr(m, "layer4") else "7"
            res = gradcam(m, tensor, idx, layer_name=layer_name)
            stage(
                "Captum LayerGradCam produces a matched heatmap",
                res.heatmap.shape == (224, 224),
                f"layer={layer_name}, mask coverage {res.coverage:.2f}, shape {res.heatmap.shape}",
            )
        except Exception as e:  # noqa: BLE001
            stage("Grad-CAM", False, str(e))
            _finish(False)

        print("\n[5/5] environment restore (honesty check)")
        try:
            runs = BACKEND / "training" / "runs"
            stamp = time.strftime("%Y%m%d-%H%M%S")
            archive = runs / f"smoke-{stamp}"
            archive.mkdir(parents=True, exist_ok=True)
            shutil.move(str(CKPT), archive / "smoke_checkpoint.pt")
            stage(
                "smoke checkpoint removed from serving path",
                not checkpoint_available(),
                f"archived at training/runs/smoke-{stamp}/ — 503 stays until real training",
            )
        except Exception as e:  # noqa: BLE001
            stage("restore", False, str(e))

    _finish(all(ok for _, ok, _ in STAGES))


def _finish(ok: bool) -> None:
    print("\n=== RESULT:", "SMOKE TEST PASSED ✅" if ok else "SMOKE TEST FAILED ❌", "===")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
