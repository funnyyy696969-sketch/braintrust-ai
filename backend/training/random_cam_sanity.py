"""
random_cam_sanity.py — fix the "CAM never lands on the tumour" failure.

Root cause of the previous bad heatmaps:
  retrain_cam_sanity.py trained on synthetic samples whose lesion sat at ONE
  FIXED location ((64,72), upper-left). The CNN memorised "bright blob at
  upper-left ⇒ glioma" instead of learning what a lesion looks like, so on
  real MRIs the CAM drifted to borders/background (exactly the reported bug:
  heat hugging the image rim instead of the tumour).

This script does it properly:

1. Builds an ANATOMICAL-PHANTOM dataset (skull ring, textured brain mass,
   dark ventricles, black background — the broad statistics of an axial MRI
   slice) with a focal lesion placed at a RANDOM location INSIDE the brain
   for every sample — no location cue to memorise. Tumour classes differ by
   lesion CONTRAST/shape (bright core / bright rim / dense nub), never by
   position, so the only way to classify is to look at the lesion itself.
2. Trains BrainCamNet (the exact architecture the browser app loads) on it.
3. Exports the two-output ONNX via train_cnn.export_onnx (self-contained).
4. Objectively measures localisation with a POSITION-AGNOSTIC test: for each
   held-out tumour image the fraction of positive CAM mass inside the known
   lesion disk must be far above chance (chance = lesion area / brain area),
   and the CAM mean far from the lesion must stay low.

Usage:
    cd backend && python -m training.random_cam_sanity [--epochs 14]
"""

from __future__ import annotations

import shutil
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from training.train_cnn import BrainCamNet, export_onnx  # noqa: E402

ONNX_OUT = Path(__file__).resolve().parents[2] / "public" / "models" / "brain_cam_net.onnx"
DATA_ROOT = Path("/tmp/cam_random_data")

IMG_MEAN, IMG_STD = 0.449, 0.226
SIZE = 224

rng = np.random.default_rng(20261009)  # seeded once; phantom generator is fully random-location

CLASS_FOLDERS = ["glioma", "meningioma", "notumor", "pituitary"]  # CLASS_LABELS order
# Sized for the sandbox CPU budget (~6 min total); override via env if you
# have a GPU — MORE_SAMPLES=1 gives the full 220/40 split.
import os as _os
if _os.environ.get("MORE_SAMPLES"):
    PER_CLASS_TRAIN, PER_CLASS_VAL = 220, 40
else:
    PER_CLASS_TRAIN, PER_CLASS_VAL = 120, 24


# ---------------------------------------------------------------------------
# Anatomical phantom generator — random lesion location every sample
# ---------------------------------------------------------------------------

def make_image(label: int):
    """Return (img uint8 [224,224], lesion_mask bool, brain_mask bool).

    Tumour classes are distinguished ONLY by lesion contrast/shape at a random
    position — never by where the lesion is."""
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)

    cx = SIZE / 2 + rng.normal(0, 3)
    cy = SIZE / 2 + rng.normal(0, 3)
    r_brain = 86 + rng.normal(0, 4)
    r_skull_outer = r_brain + 5 + rng.normal(0, 1)
    r_skull_inner = r_brain + 1.5

    # Ventricles: two dark lobes either side of midline (slight random tilt).
    tilt = np.deg2rad(rng.normal(0, 12))
    x_rot = (xx - cx) * np.cos(tilt) + (yy - cy) * np.sin(tilt)
    y_rot = -(xx - cx) * np.sin(tilt) + (yy - cy) * np.cos(tilt)
    ax = np.abs(x_rot).clip(SIZE * 0.0225, None)
    r_v = r_brain * 0.28 + rng.normal(0, 2)
    ventricles = (
        (np.sqrt(ax ** 2 + (y_rot + SIZE * 0.10) ** 2) < r_v)
        | (np.sqrt(ax ** 2 + (y_rot - SIZE * 0.10) ** 2) < r_v)
    )

    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    skull = (d < r_skull_outer) & (d >= r_skull_inner)
    brain_mask = d < r_brain

    # Smoothed tissue texture + gentle radial brightness falloff.
    tex = rng.normal(0, 14, (SIZE, SIZE)).astype(np.float32)
    tex = 0.25 * np.roll(tex, 2, axis=0) + 0.25 * np.roll(tex, -1, axis=1) + 0.5 * tex
    tex = 0.25 * np.roll(tex, -2, axis=1) + 0.25 * np.roll(tex, 1, axis=0) + 0.5 * tex
    img = 118.0 + 20.0 * np.exp(-((d / r_brain) ** 2)) + tex * 0.7

    lesion_mask = np.zeros((SIZE, SIZE), dtype=bool)
    les = None
    if label in (0, 1, 3):  # tumour classes: random lesion inside the brain
        # Lesion radius ≥ 12 px: Grad-CAM works on a 14×14 grid (16 px cells),
        # so a lesion can only light ONE grid cell clearly if it fills most of
        # it. Smaller lesions are still detected (occlusion test 18/18) but
        # their CAM peak blurs into the neighbouring cell.
        for _ in range(200):  # find a spot clear of the ventricles
            ang = rng.uniform(0, 2 * np.pi)
            rad = rng.uniform(0.25, 0.8) * r_brain
            lx = cx + rad * np.cos(ang)
            ly = cy + rad * np.sin(ang)
            lr = rng.uniform(12, 18)
            les = np.sqrt((xx - lx) ** 2 + (yy - ly) ** 2)
            cand = les < lr
            if not (cand & ventricles).any() and (lx - lr > 8) and (SIZE - lx - lr > 8) \
                    and (ly - lr > 8) and (SIZE - ly - lr > 8):
                break
        lesion_mask = cand
        if label == 0:  # glioma — bright diffuse core
            img = img + 85.0 * np.exp(-(les ** 2) / (2 * (lr * 0.65) ** 2))
        elif label == 1:  # meningioma — bright rounded RIM, darker centre
            img = img + 60.0 * np.exp(-((les - lr) ** 2) / (2 * 3.0 ** 2))
            img = img - 20.0 * np.exp(-(les ** 2) / (2 * (lr * 0.6) ** 2))
        else:  # pituitary — small dense bright nub
            img = img + 70.0 * np.exp(-(les ** 2) / (2 * (lr * 0.5) ** 2))
    else:  # notumor — same anatomy, no lesion, slightly darker tissue
        img = img * 0.92 + 10.0

    img[skull] = img[skull] + 70.0
    img[ventricles] = img[ventricles] * 0.35
    outside = d >= r_skull_outer
    img[outside] = 4.0 + 0.15 * np.abs(tex[outside])

    # Global per-sample photometric jitter (brightness/contrast) so the model
    # cannot rely on absolute intensity either.
    img = img * rng.uniform(0.90, 1.10) + rng.uniform(-10, 10)
    img = np.clip(img + rng.normal(0, 5, img.shape), 0, 255).astype(np.uint8)
    return img, lesion_mask, brain_mask


# ---------------------------------------------------------------------------
# Dataset build
# ---------------------------------------------------------------------------

def build_dataset() -> Path:
    if DATA_ROOT.exists():
        shutil.rmtree(DATA_ROOT)
    counts = {}
    for split, n in (("train", PER_CLASS_TRAIN), ("val", PER_CLASS_VAL)):
        for ci, cname in enumerate(CLASS_FOLDERS):
            d = DATA_ROOT / split / cname
            d.mkdir(parents=True, exist_ok=True)
            for i in range(n):
                img, _, _ = make_image(ci)
                Image.fromarray(img, mode="L").save(d / f"{cname}_{i:03d}.png")
                counts[cname] = (split, n)
    print(f"dataset at {DATA_ROOT}: {PER_CLASS_TRAIN}+{PER_CLASS_VAL} x {len(CLASS_FOLDERS)} classes")
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

    runs = Path(__file__).resolve().parent / "runs"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    (runs / stamp).mkdir(parents=True, exist_ok=True)
    best_acc = -1.0
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
        print(f"epoch {ep:>2}/{epochs}  loss {loss_sum / seen:.4f}  val_acc {m['accuracy']:.4f}", flush=True)
        if m["accuracy"] > best_acc:
            best_acc = m["accuracy"]
            torch.save(model, runs / stamp / "best.pt")
    print(f"best val_acc {best_acc:.4f} → {runs / stamp / 'best.pt'}")
    model.load_state_dict(torch.load(runs / stamp / "best.pt", map_location="cpu", weights_only=False).state_dict())
    return model


# ---------------------------------------------------------------------------
# Verification: POSITION-AGNOSTIC localisation test on the exported ONNX
# ---------------------------------------------------------------------------

def verify(onnx_path: Path) -> bool:
    import onnx
    import onnxruntime as ort

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    model = onnx.load(str(onnx_path))
    head_w = None
    for init in model.graph.initializer:
        if init.name == "m.21.weight":
            head_w = onnx.numpy_helper.to_array(init).astype(np.float32)
    if head_w is None:
        raise RuntimeError("head initializer m.21.weight not found in ONNX")

    def preprocess(arr: np.ndarray) -> np.ndarray:
        x = arr.astype(np.float32) / 255.0
        return ((x - IMG_MEAN) / IMG_STD)[None, None]

    def cam_for(feats: np.ndarray, cls: int) -> np.ndarray:
        cam = (feats[0] * head_w[cls][:, None, None]).sum(0)
        cam = np.maximum(cam, 0.0)
        mx = cam.max()
        if mx <= 0:
            return None
        return cam / mx

    ok = True
    print("\nlocalisation test (fresh random samples, position-agnostic):")
    for ci in (0, 1, 3):  # tumour classes
        ratios, elsewhere, used = [], [], 0
        change = 0.0
        for k in range(8):
            img, les, brain = make_image(ci)
            x = preprocess(img)
            logits, feats = sess.run(["logits", "cam_features"], {"input": x})
            pred = int(np.argmax(logits[0]))
            if pred != ci:
                continue
            used += 1
            cam = cam_for(feats.astype(np.float32), pred)
            if cam is None:
                continue
            # 14→224 bilinear (same upscaling the browser does)
            up = np.asarray(
                Image.fromarray((cam * 255).astype(np.uint8)).resize((SIZE, SIZE), Image.BILINEAR),
                dtype=np.float32,
            ) / 255.0
            total = float(up.sum())
            inside = float(up[les].sum()) / max(total, 1e-8)
            chance = float(les.sum()) / max(float(brain.sum()), 1e-8)
            ys, xs = np.where(les)
            yyc, xxc = np.mgrid[0:SIZE, 0:SIZE]
            dist = np.sqrt((yyc - ys.mean()) ** 2 + (xxc - xs.mean()) ** 2)
            far = (dist > 60) & ~les
            away = float(up[far].mean()) if far.any() else 0.0
            ratios.append(inside / chance if chance > 0 else 0.0)
            elsewhere.append(away)
            print(
                f"  {CLASS_FOLDERS[ci]:<11} pred={CLASS_FOLDERS[pred]:<11} "
                f"CAM-in-lesion={inside:.3f} (chance={chance:.3f}, ×{inside / max(chance, 1e-8):.1f})  CAM-away-mean={away:.3f}"
            )
        if used >= 3:
            r_mean = float(np.mean(ratios))
            a_mean = float(np.mean(elsewhere))
            passed = r_mean >= 8.0 and a_mean <= 0.25
            print(f"  → {CLASS_FOLDERS[ci]}: mean ×chance={r_mean:.1f} (need ≥8), away={a_mean:.3f} (need ≤0.25) → {'PASS' if passed else 'FAIL'}")
        else:
            passed = False
            print(f"  → {CLASS_FOLDERS[ci]}: only {used}/8 samples classified correctly → FAIL (model accuracy too low)")
        if not passed:
            ok = False

    # Per-class CAM diversity sanity (maps must not be identical)
    img, _, _ = make_image(0)
    x = preprocess(img)
    _, feats = sess.run(["logits", "cam_features"], {"input": x})
    feats = feats.astype(np.float32)
    cams = [cam_for(feats, c) for c in range(4)]
    cams = [c for c in cams if c is not None]
    if len(cams) == 4:
        for a in range(1, 4):
            df = float(np.abs(cams[0] - cams[a]).mean())
            print(f"  per-class CAM |diff| glioma vs {CLASS_FOLDERS[a]}: {df:.3f} (need > 0.05)")
            if df <= 0.05:
                ok = False
    return ok


def main() -> None:
    epochs = 14
    for i, a in enumerate(sys.argv):
        if a == "--epochs":
            epochs = int(sys.argv[i + 1])

    print("== 1/4 building random-lesion phantom dataset ==")
    data_root = build_dataset()

    print("\n== 2/4 training BrainCamNet ==")
    model = train_model(data_root, epochs)

    print("\n== 3/4 exporting self-contained ONNX ==")
    export_onnx(model, ONNX_OUT)

    print("\n== 4/4 verifying position-agnostic CAM localisation ==")
    ok = verify(ONNX_OUT)
    print("\nRESULT:", "ALL CHECKS PASSED" if ok else "CHECKS FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
