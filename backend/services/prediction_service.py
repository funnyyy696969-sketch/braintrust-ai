"""
prediction_service.py — checkpoint-backed classification (and only that).

The service refuses to fabricate predictions: without a valid checkpoint it
raises, and the API surfaces a clear error instead of inventing medical output.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

CLASS_LABELS = ["Glioma", "Meningioma", "No Tumor", "Pituitary"]
MODEL_INPUT_SIZE = 224
CHECKPOINT_PATH = Path(__file__).resolve().parents[1] / "checkpoints" / "brain_mri_resnet50.pt"


@dataclass
class Prediction:
    predicted_class: str
    confidence: float
    probabilities: dict[str, float]
    model_name: str


_model_cache: dict[str, object] = {}


def checkpoint_available() -> bool:
    return CHECKPOINT_PATH.exists()


def preprocess(pixels: np.ndarray) -> "np.ndarray":
    """H×W×C float32 → 1×1×224×224 normalised tensor."""
    import torch
    import torch.nn.functional as F

    if pixels.ndim == 2:
        pixels = pixels[:, :, None]
    if pixels.shape[2] == 3:
        pixels = pixels @ np.array([0.299, 0.587, 0.114], dtype=np.float32)[:, None]
    elif pixels.shape[2] > 1:
        pixels = pixels[:, :, :1]

    img = pixels[:, :, 0]
    lo, hi = np.percentile(img, 1), np.percentile(img, 99)
    img = np.clip((img - lo) / max(hi - lo, 1e-8), 0, 1)
    img = (img - 0.449) / 0.226

    t = torch.from_numpy(img[None, None].astype(np.float32))
    return F.interpolate(t, size=(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE), mode="bilinear", align_corners=False)


def _load_model(device: str):
    import torch

    if not checkpoint_available():
        raise RuntimeError(
            f"No model checkpoint found at {CHECKPOINT_PATH}. "
            "Place a trained brain-MRI classifier checkpoint there — predictions are never simulated."
        )
    if device not in _model_cache:
        model = torch.load(CHECKPOINT_PATH, map_location=device)
        model.eval()
        _model_cache[device] = model
    return _model_cache[device]


def predict(pixels: np.ndarray, device: str = "cpu") -> Prediction:
    import torch

    model = _load_model(device)
    tensor = preprocess(pixels).to(device)
    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1)[0].cpu().numpy()
    idx = int(np.argmax(probs))
    return Prediction(
        predicted_class=CLASS_LABELS[idx],
        confidence=float(probs[idx]),
        probabilities={CLASS_LABELS[i]: float(p) for i, p in enumerate(probs)},
        model_name=CHECKPOINT_PATH.stem,
    )
