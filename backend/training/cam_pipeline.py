"""
cam_pipeline.py — stage runner for random_cam_sanity, split into individually
-short steps because the host kills any command over ~10 min.

Stages (run with `python3 backend/training/cam_pipeline.py <stage>`):
  dataset   — build the random-lesion phantom dataset   (~1 min)
  train     — 8 epochs, saves best.pt + state           (~4 min)
  export    — write self-contained ONNX to public/models (~5 s)
  verify    — position-agnostic CAM localisation test   (~2 min)

Each stage is idempotent and resumes from the previous one's artefacts.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
ROOT = BACKEND.parent

import numpy as np  # noqa: E402
import torch  # noqa: E402

torch.manual_seed(42)
np.random.seed(42)
torch.set_num_threads(2)

STAGE = sys.argv[1] if len(sys.argv) > 1 else ""
EPOCHS = 8
BEST = Path("/tmp/cam_best.pt")
BEST2 = Path("/tmp/cam_best2.pt")

from training.random_cam_sanity import (  # noqa: E402
    CLASS_FOLDERS,
    DATA_ROOT,
    build_dataset,
    make_image,
)
from training.train_cnn import BrainCamNet, export_onnx  # noqa: E402

ONNX_OUT = ROOT / "public" / "models" / "brain_cam_net.onnx"


def stage_dataset() -> None:
    build_dataset()
    print("dataset done")


def stage_train() -> None:
    from training.train_cnn import class_weights, evaluate, make_loaders

    model = BrainCamNet.build()
    train_loader, val_loader = make_loaders(DATA_ROOT, batch_size=16)
    crit = torch.nn.CrossEntropyLoss(weight=class_weights(train_loader))
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=EPOCHS)
    best_acc = -1.0
    for ep in range(1, EPOCHS + 1):
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
        m = evaluate(model, val_loader, "cpu")
        print(f"epoch {ep:>2}/{EPOCHS}  loss {loss_sum / seen:.4f}  val_acc {m['accuracy']:.4f}", flush=True)
        if m["accuracy"] > best_acc:
            best_acc = m["accuracy"]
            torch.save(model.state_dict(), BEST)
    print(f"best val_acc {best_acc:.4f} → {BEST}")


def stage_export() -> None:
    model = BrainCamNet.build()
    model.load_state_dict(torch.load(BEST, map_location="cpu", weights_only=True))
    model.eval()
    export_onnx(model, ONNX_OUT)
    # Sanity: confirm no stray .data file was created next to it.
    stray = ONNX_OUT.with_suffix(".onnx.data")
    if stray.exists():
        stray.unlink()
        print("(removed stray external-data file)")
    print("export done")


def stage_verify() -> None:
    import onnx
    import onnxruntime as ort

    sess = ort.InferenceSession(str(ONNX_OUT), providers=["CPUExecutionProvider"])
    m = onnx.load(str(ONNX_OUT))
    head_w = None
    for init in m.graph.initializer:
        if init.name == "m.21.weight":
            head_w = onnx.numpy_helper.to_array(init).astype(np.float32)
    if head_w is None:
        raise RuntimeError("m.21.weight not found")
    IMG_MEAN, IMG_STD = 0.449, 0.226

    def preprocess(arr):
        x = arr.astype(np.float32) / 255.0
        return ((x - IMG_MEAN) / IMG_STD)[None, None]

    def cam_for(feats, cls):
        cam = np.maximum((feats[0] * head_w[cls][:, None, None]).sum(0), 0.0)
        mx = cam.max()
        return cam / mx if mx > 0 else None

    ok = True
    print("localisation test (position-agnostic):", flush=True)
    for ci in (0, 1, 3):
        ratios, away_means, used = [], [], 0
        for _ in range(8):
            img, les, brain = make_image(ci)
            logits, feats = sess.run(["logits", "cam_features"], {"input": preprocess(img)})
            if int(np.argmax(logits[0])) != ci:
                continue
            used += 1
            cam = cam_for(feats.astype(np.float32), ci)
            if cam is None:
                continue
            import PIL.Image as PImage
            up = np.asarray(
                PImage.fromarray((cam * 255).astype(np.uint8)).resize((224, 224), PImage.BILINEAR),
                dtype=np.float32,
            ) / 255.0
            total = float(up.sum())
            inside = float(up[les].sum()) / max(total, 1e-8)
            chance = float(les.sum()) / max(float(brain.sum()), 1e-8)
            ys, xs = np.where(les)
            yyc, xxc = np.mgrid[0:224, 0:224]
            dist = np.sqrt((yyc - ys.mean()) ** 2 + (xxc - xs.mean()) ** 2)
            far = (dist > 60) & ~les
            away = float(up[far].mean()) if far.any() else 0.0
            ratios.append(inside / max(chance, 1e-8))
            away_means.append(away)
            print(f"  {CLASS_FOLDERS[ci]:<11} CAM-in-lesion={inside:.3f} (chance={chance:.3f}, ×{inside / max(chance, 1e-8):.1f})  away={away:.3f}", flush=True)
        if used >= 3:
            r, a = float(np.mean(ratios)), float(np.mean(away_means))
            passed = r >= 6.0 and a <= 0.30
            print(f"  → {CLASS_FOLDERS[ci]}: ×chance={r:.1f} away={a:.3f} → {'PASS' if passed else 'FAIL'}")
        else:
            passed = False
            print(f"  → {CLASS_FOLDERS[ci]}: only {used}/8 correct → FAIL")
        ok = ok and passed
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


def stage_train2() -> None:
    """Continue from best.pt at the base LR — tuned to finish well inside the
    ~9.5 min command cap (measured: ~20 s/epoch at batch 16)."""
    from training.train_cnn import class_weights, evaluate, make_loaders

    model = BrainCamNet.build()
    model.load_state_dict(torch.load(BEST, map_location="cpu", weights_only=True))
    train_loader, val_loader = make_loaders(DATA_ROOT, batch_size=16)
    crit = torch.nn.CrossEntropyLoss(weight=class_weights(train_loader))
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=8)  # fits the cap
    best_acc = -1.0
    for ep in range(1, 9):
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
        m = evaluate(model, val_loader, "cpu")
        print(f"epoch {ep:>2}/8  loss {loss_sum / seen:.4f}  val_acc {m['accuracy']:.4f}", flush=True)
        if m["accuracy"] > best_acc:
            best_acc = m["accuracy"]
            torch.save(model.state_dict(), BEST2)
    print(f"best val_acc {best_acc:.4f} → {BEST2}")


STAGES = {"dataset": stage_dataset, "train": stage_train, "train2": stage_train2, "export": stage_export, "verify": stage_verify}
t0 = time.time()
STAGES[STAGE]()
print(f"[{STAGE}] took {time.time() - t0:.0f}s")
