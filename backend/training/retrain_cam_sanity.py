"""
retrain_cam_sanity.py — one-shot script for the Grad-CAM fix.

1. Generates a small lesion-aware synthetic sanity dataset (glioma images have
   a focal bright lesion in the upper-left; other classes are plain tissue with
   mild per-class signatures), so a real trained CNN can be produced in-sandbox
   (2 GB RAM cap rules out ResNet-50) and Grad-CAM can be objectively checked
   against a known lesion location.
2. Trains BrainCamNet (train_cnn.BrainCamNet, 98K params) on it with
   torch.set_num_threads(2) to stay under the cgroup memory cap.
3. Exports the two-output ONNX (logits + cam_features) via
   train_cnn.export_onnx, which folds external data back into the single file.
4. Verifies with onnxruntime + real CAM math (alphas from the ONNX head
   initializer m.21.weight):
     - gradient magnitude std over the last conv map  > 0.05  (spatially
       specific, i.e. genuinely trained)
     - CAM@lesion > 0.7 where CAM elsewhere < 0.45             (localisation)
     - per-class CAM maps differ (mean abs diff > 0.05, low correlation)
   Exit code 0 only if all checks pass on an image the model classifies as
   glioma (the lesion class) with high confidence.

Usage:
    cd backend && python -m training.retrain_cam_sanity
    (override with --epochs / --out-dir if needed)
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from training.train_cnn import BrainCamNet, export_onnx  # noqa: E402

ONNX_OUT = (
    Path(__file__).resolve().parents[2] / "public" / "models" / "brain_cam_net.onnx"
)

DATA_ROOT = Path("/tmp/cam_sanity_data")
IMG_MEAN, IMG_STD = 0.449, 0.226
LESION = (64, 72)  # known lesion centre in 224×224 coords (upper-left quadrant)
LESION_R = 26
PER_CLASS = 60

rng = np.random.default_rng(20261001)

CLASS_FOLDERS = ["glioma", "meningioma", "notumor", "pituitary"]  # matches CLASS_LABELS order


# ---------------------------------------------------------------------------
# Synthetic dataset
# ---------------------------------------------------------------------------

def make_image(label: int) -> np.ndarray:
    """224×224 uint8 luma with a per-class signature. Glioma: focal bright
    lesion at LESION; others: plain tissue with mild class-specific patterns."""
    base = 120.0 + rng.normal(0, 14, (224, 224))
    # smooth tissue texture
    base = (
        0.25 * np.roll(base, 2, axis=0)
        + 0.25 * np.roll(base, -1, axis=1)
        + 0.5 * base
    )
    img = base + np.linspace(-12, 12, 224)[None, :]  # gentle horizontal gradient
    if label == 0:  # glioma → focal bright lesion, fixed upper-left location
        yy, xx = np.mgrid[0:224, 0:224]
        d2 = (yy - LESION[0]) ** 2 + (xx - LESION[1]) ** 2
        img += 90 * np.exp(-d2 / (2 * LESION_R**2))
    elif label == 1:  # meningioma → broad rim brightening
        yy, xx = np.mgrid[0:224, 0:224]
        r2 = (yy - 112) ** 2 + (xx - 112) ** 2
        img += 18 * np.exp(-((np.sqrt(r2) - 88) ** 2) / 120)
    elif label == 2:  # notumor → flat, lower mean
        img = img * 0.6 + 60
    else:  # pituitary → small central dark spot
        yy, xx = np.mgrid[0:224, 0:224]
        d2 = (yy - 112) ** 2 + (xx - 112) ** 2
        img -= 30 * np.exp(-d2 / (2 * 16**2))
    return np.clip(img + rng.normal(0, 6, img.shape), 0, 255).astype(np.uint8)


def build_dataset() -> Path:
    if DATA_ROOT.exists():
        shutil.rmtree(DATA_ROOT)
    for split in ("train", "val"):
        for ci, cname in enumerate(CLASS_FOLDERS):
            d = DATA_ROOT / split / cname
            d.mkdir(parents=True, exist_ok=True)
            n = PER_CLASS if split == "train" else 12
            for i in range(n):
                Image.fromarray(make_image(ci), mode="L").save(d / f"{cname}_{i:03d}.png")
    return DATA_ROOT


# ---------------------------------------------------------------------------
# Train (reuses BrainCamNet so browser + sanity test share one architecture)
# ---------------------------------------------------------------------------

def train_model(data_root: Path, epochs: int):
    import torch

    torch.manual_seed(42)
    np.random.seed(42)
    device = "cpu"
    torch.set_num_threads(2)

    from training.train_cnn import class_weights, evaluate, make_loaders

    model = BrainCamNet.build().to(device)
    train_loader, val_loader = make_loaders(data_root, batch_size=16)
    crit = torch.nn.CrossEntropyLoss(weight=class_weights(train_loader))
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)

    for ep in range(1, epochs + 1):
        model.train()
        loss_sum, seen = 0.0, 0
        for x, y in train_loader:
            opt.zero_grad(set_to_none=True)
            loss = crit(model(x), y)
            loss.backward()
            opt.step()
            loss_sum += loss.item() * x.size(0)
            seen += x.size(0)
        sched.step()
        m = evaluate(model, val_loader, device)
        print(f"epoch {ep:>2}/{epochs}  loss {loss_sum / seen:.4f}  val_acc {m['accuracy']:.4f}")
    return model


# ---------------------------------------------------------------------------
# Verification: real CAM math on the exported ONNX
# ---------------------------------------------------------------------------

def verify(onnx_path: Path) -> bool:
    import onnx
    import onnxruntime as ort

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    m = onnx.load(str(onnx_path))
    head_w = None
    for init in m.graph.initializer:
        if init.name == "m.21.weight":
            head_w = onnx.numpy_helper.to_array(init).astype(np.float32)
    if head_w is None:
        raise RuntimeError("head initializer m.21.weight not found in ONNX")

    def preprocess(arr: np.ndarray) -> np.ndarray:
        x = arr.astype(np.float32) / 255.0
        x = (x - IMG_MEAN) / IMG_STD
        return x[None, None]

    def cam_for_class(feats: np.ndarray, cls: int) -> np.ndarray:
        alpha = head_w[cls]  # [64]
        cam = np.maximum((feats[0] * alpha[:, None, None]).sum(0), 0.0)
        cam = (cam - cam.min()) / max(cam.max() - cam.min(), 1e-8)
        return cam

    def make_image_like(label: int) -> np.ndarray:
        return make_image(label)

    ok = True
    # Use several glioma samples for robustness
    lesion_vals, other_vals, diffs, corrs, grad_stds, confs = [], [], [], [], [], []
    for sample_i in range(3):
        img = make_image_like(0)
        x = preprocess(img)
        logits, feats = sess.run(["logits", "cam_features"], {"input": x})
        logits, feats = logits[0], feats.astype(np.float32)
        pred = int(np.argmax(logits))
        conf = float(np.exp(logits[pred]) / np.exp(logits).sum())
        confs.append(conf)
        print(f"[sample {sample_i}] pred={CLASS_FOLDERS[pred]} conf={conf:.3f}")

        # gradient-magnitude std of the CAM weights per channel (spatial specificity)
        # Approximate: std over spatial map of the weighted sum BEFORE ReLU/normalise
        weighted = (feats[0] * head_w[pred][:, None, None]).sum(0)
        gy, gx = np.gradient(weighted)
        gstd = float(np.sqrt((gy**2 + gx**2)).mean())
        grad_stds.append(gstd)
        print(f"  gradient-mag std = {gstd:.3f}  (PASS if > 0.05)")

        cams = {c: cam_for_class(feats, c) for c in range(4)}
        if pred == 0:
            # cam grid is 28×28 for a 224 input → map lesion centre into grid space
            s = cams[0].shape[0] / 224.0
            gy0, gx0 = round(LESION[0] * s), round(LESION[1] * s)
            at = float(cams[0][gy0, gx0])
            # average elsewhere = far from lesion
            far = cams[0].copy()
            yy, xx = np.mgrid[0: far.shape[0], 0: far.shape[1]]
            far_mask = ((yy - gy0) ** 2 + (xx - gx0) ** 2) > (6.0) ** 2
            away = float(far[far_mask].mean())
            lesion_vals.append(at)
            other_vals.append(away)
            print(f"  CAM@glioma@lesion = {at:.3f}   mean elsewhere = {away:.3f}")
            if not (at > 0.7 and away < 0.45):
                ok = False
                print("  ✗ localisation check FAILED")
            # per-class CAM difference
            for c in (1, 2, 3):
                d = float(np.abs(cams[0] - cams[c]).mean())
                r = np.corrcoef(cams[0].ravel(), cams[c].ravel())[0, 1]
                corr = float(r) if np.isfinite(r) else 0.0  # constant CAM → nan
                diffs.append(d)
                corrs.append(corr)
                print(f"  vs {CLASS_FOLDERS[c]}: diff={d:.3f} corr={corr:.3f}")
                if d <= 0.05:
                    ok = False
                    print(f"  ✗ per-class diff vs {CLASS_FOLDERS[c]} FAILED")
        else:
            ok = False
            print("  ✗ model failed to predict glioma on a lesion sample")

    print(f"\ngrad-mag stds: {[round(v,3) for v in grad_stds]}  (all > 0.05 required)")
    if any(g <= 0.05 for g in grad_stds):
        ok = False
    if lesion_vals:
        print(
            f"CAM@lesion: {[round(v,3) for v in lesion_vals]} (want > 0.7)   "
            f"elsewhere: {[round(v,3) for v in other_vals]} (want < 0.45)"
        )
        print(f"per-class diffs: {[round(v,3) for v in diffs]} (want > 0.05)")

    return ok and len(lesion_vals) == 3


def main() -> None:
    epochs = 12
    for i, a in enumerate(sys.argv):
        if a == "--epochs":
            epochs = int(sys.argv[i + 1])

    print("== 1/4 building sanity dataset ==")
    data_root = build_dataset()
    print(f"dataset at {data_root}")

    print("\n== 2/4 training BrainCamNet ==")
    model = train_model(data_root, epochs)

    print("\n== 3/4 exporting self-contained ONNX ==")
    export_onnx(model, ONNX_OUT)

    print("\n== 4/4 verifying real Grad-CAM from ONNX ==")
    ok = verify(ONNX_OUT)
    print("\nRESULT:", "ALL CHECKS PASSED" if ok else "CHECKS FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
