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
    """H×W×C uint8 → 1×1×224×224 normalised tensor.

    Mirrors the training transform EXACTLY (test_training parity test):
    PIL luma → PIL antialiased bilinear 224² → ToTensor /255 →
    (x − 0.449) / 0.226. No percentile stretch here — the model must see
    at inference exactly what it saw during training.
    """
    from PIL import Image
    from torchvision import transforms

    if pixels.ndim == 2:
        pixels = pixels[:, :, None]
    if pixels.shape[2] == 3:
        # PIL's ITU-R 601-2 luma (Grayscale()) matches these weights closely;
        # use the exact same weights for determinism.
        arr = pixels @ np.array([0.299, 0.587, 0.114], dtype=np.float32)[:, None]
        pil = Image.fromarray(np.clip(arr[:, :, 0], 0, 255).astype(np.uint8), mode="L")
    else:
        pil = Image.fromarray(np.clip(pixels[:, :, 0], 0, 255).astype(np.uint8), mode="L")

    tf = transforms.Compose(
        [
            transforms.Resize((MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.449], std=[0.226]),
        ]
    )
    return tf(pil).unsqueeze(0)


def _load_model(device: str):
    import torch

    if not checkpoint_available():
        raise RuntimeError(
            f"No model checkpoint found at {CHECKPOINT_PATH}. "
            "Place a trained brain-MRI classifier checkpoint there — predictions are never simulated."
        )
    if device not in _model_cache:
        # weights_only=False: the checkpoint is a full pickled module saved by
        # training/train.py. PyTorch 2.6 flipped the default to True, which
        # rejects pickled nn.Modules — keep the explicit flag for 2.6+ compat.
        model = torch.load(CHECKPOINT_PATH, map_location=device, weights_only=False)
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
