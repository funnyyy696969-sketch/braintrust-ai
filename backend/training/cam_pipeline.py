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


def stage_trainloc() -> None:
    """Continue from best.pt with an auxiliary CAM-LOCALISATION loss + a
    coordinate-channel bias so the CAM can't drift toward image centre.

    GAP-head CAMs are naturally diffuse because nothing in plain CE training
    constrains the *spatial* shape of the block-5 feature map. For each sample
    we know the lesion mask, so we add:

        L_loc = CE( softmax(CAM_c), normalized lesion mask ↓14×14 )

    where CAM_c = ReLU(Σ_k W[c,k]·A_k) for the TRUE class c — exactly the map
    the browser renders. Gradients flow through both the block-5 activations
    and the head weights, sharpening the CAM onto the lesion.
    """
    import torch.nn.functional as F
    from training.train_cnn import evaluate, BrainCamNet
    from training.random_cam_sanity import CLASS_FOLDERS, IMG_MEAN, IMG_STD, make_image

    torch.manual_seed(int(time.time()) % 2**31)  # fresh stream each round (cv training continues from BEST)

    model = BrainCamNet.build()
    if BEST.exists():
        model.load_state_dict(torch.load(BEST, map_location="cpu", weights_only=True))
        print("warm-started from best.pt", flush=True)

    head = model[21]          # Linear(64 → 4), the CAM-alpha source
    feats_box: list[torch.Tensor] = []
    model[18].register_forward_hook(lambda _m, _i, out: feats_box.append(out) or None)

    BATCH, LAM, EPOCHS = 16, 8.0, 6
    STEPS = 36                # 576 samples/epoch; 6 rounds ≈ 2.5 min each, inside cap
    opt = torch.optim.AdamW(model.parameters(), lr=6e-4, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=EPOCHS)

    rng = np.random.default_rng(int(time.time()) % 2**31)

    def make_batch():
        imgs, masks, ys = [], [], []
        for _ in range(BATCH):
            y = int(rng.integers(0, 4))
            img, les, _brain = make_image(y)
            if rng.random() < 0.5:  # same horizontal-flip aug as make_loaders
                img, les = np.ascontiguousarray(img[:, ::-1]), np.ascontiguousarray(les[:, ::-1])
            x = ((img.astype(np.float32) / 255.0 - IMG_MEAN) / IMG_STD)[None]
            imgs.append(x)
            masks.append(les.astype(np.float32)[None])
            ys.append(y)
        return (
            torch.from_numpy(np.stack(imgs, axis=0)),  # already (B,1,224,224) — each entry is (1,224,224)
            torch.from_numpy(np.stack(masks, axis=0)),
            torch.tensor(ys),
        )

    best_acc = -1.0
    for ep in range(1, EPOCHS + 1):
        model.train()
        ce_sum, loc_sum, seen = 0.0, 0.0, 0
        for _ in range(STEPS):
            x, les, y = make_batch()
            opt.zero_grad(set_to_none=True)
            logits = model(x)
            ce = F.cross_entropy(logits, y)
            A = feats_box[-1]  # in-graph so gradients shape the CAM activations
            wc = head.weight[y]  # (B,64) — rows for the TRUE class
            cam = torch.clamp((A * wc[:, :, None, None]).sum(1), min=0)  # (B,14,14)
            m14 = F.avg_pool2d(les, 16).squeeze(1)  # (B,1,224,224) → (B,14,14)
            has = (m14.flatten(1).sum(1) > 0).float()  # notumor → weight 0
            p = torch.softmax(cam.flatten(1), dim=1)
            t = m14.flatten(1)
            t = t / t.sum(1, keepdim=True).clamp(min=1e-8)
            loc = (-(t * (p + 1e-8).log()).sum(1) * has).mean()
            loss = ce + LAM * loc
            loss.backward()
            opt.step()
            ce_sum += ce.item() * BATCH
            loc_sum += loc.item() * BATCH
            seen += BATCH
        sched.step()
        acc = evaluate_dynamic(model)
        print(
            f"epoch {ep:>2}/{EPOCHS}  ce {ce_sum / seen:.4f}  loc {loc_sum / seen:.4f}  val_acc {acc:.4f}",
            flush=True,
        )
        if acc > best_acc:
            best_acc = acc
            torch.save(model.state_dict(), BEST2)
    print(f"best val_acc {best_acc:.4f} → {BEST2}")


def class_weights_batch() -> list[float]:
    """Rough inverse-frequency weights for the phantom mix (equal sampling)."""
    return [1.0, 1.0, 1.0, 1.0]


def evaluate_dynamic(model) -> float:
    """Accuracy over a small fresh random batch (no ImageFolder needed)."""
    from training.random_cam_sanity import IMG_MEAN, IMG_STD

    model.eval()
    rng = np.random.default_rng(77)
    correct = 0
    with torch.no_grad():
        for _ in range(4):
            imgs, ys = [], []
            for _ in range(16):
                y = int(rng.integers(0, 4))
                img, _les, _b = make_image(y)
                imgs.append(((img.astype(np.float32) / 255.0 - IMG_MEAN) / IMG_STD)[None])
                ys.append(y)
            out = model(torch.from_numpy(np.stack(imgs, axis=0)))
            correct += int((out.argmax(1).numpy() == np.array(ys)).sum())
    model.train()
    return correct / 64


STAGES = {"dataset": stage_dataset, "train": stage_train, "train2": stage_train2, "trainloc": stage_trainloc, "export": stage_export, "verify": stage_verify}
t0 = time.time()
if STAGE:
    STAGES[STAGE]()
    print(f"[{STAGE}] took {time.time() - t0:.0f}s")
