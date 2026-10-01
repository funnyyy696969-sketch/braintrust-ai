"""
Unit tests for the training pipeline plumbing (no GPU or dataset needed).

Verifies:
  - class-name normalisation used by prepare_data.py
  - build_model(): 1-channel input, 4-logit output, forward pass shape
  - preprocessing parity between training and the serving path

Run with:  pytest backend/tests -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.prediction_service import CLASS_LABELS, MODEL_INPUT_SIZE  # noqa: E402
from training.prepare_data import normalise_class  # noqa: E402

torch = pytest.importorskip("torch", reason="torch not installed in this environment")


# ---------------------------------------------------------------------------
# prepare_data class normalisation (pure Python — runs without torch)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# prepare_data class normalisation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("glioma", "glioma"),
        ("Glioma", "glioma"),
        ("meningioma", "meningioma"),
        ("no_tumor", "notumor"),
        ("notumor", "notumor"),
        ("No Tumor", "notumor"),
        ("pituitary", "pituitary"),
        ("Pituitary Tumor", "pituitary"),
        ("glioma_tumor", "glioma"),
        ("meningioma_tumor", "meningioma"),
        ("bogus_class", None),
        ("", None),
    ],
)
def test_normalise_class(raw, expected):
    assert normalise_class(raw) == expected


# ---------------------------------------------------------------------------
# build_model — architecture contract with the serving path
# ---------------------------------------------------------------------------

def test_build_model_contract():
    from training.train import build_model

    model = build_model()
    # 1-channel grayscale input, 224×224
    x = torch.randn(2, 1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
    model.eval()
    with torch.no_grad():
        logits = model(x)
    assert logits.shape == (2, 4)

    # First conv must accept exactly 1 channel
    assert model.conv1.in_channels == 1
    # Head must be 4-way, ordered per CLASS_LABELS
    assert model.fc.out_features == 4 == len(CLASS_LABELS)


def test_model_is_deterministic_in_eval():
    from training.train import build_model

    model = build_model()
    model.eval()
    x = torch.randn(1, 1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
    with torch.no_grad():
        a = model(x)
        b = model(x)
    assert torch.equal(a, b)


# ---------------------------------------------------------------------------
# Preprocessing parity: training transform ≈ serving preprocess
# ---------------------------------------------------------------------------

def test_preprocessing_parity():
    import numpy as np
    from services.prediction_service import preprocess
    from torchvision import transforms

    rng = np.random.default_rng(0)
    # Simulated MRI-like image: mid-gray with structure, uint8 RGB
    base = rng.normal(128, 40, (256, 256)).clip(0, 255).astype(np.uint8)
    img = np.stack([base, base, base], axis=-1)

    serving = preprocess(img)  # 1×1×224×224, normalised
    tf = transforms.Compose(
        [
            transforms.Grayscale(num_output_channels=1),
            transforms.Resize((MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.449], std=[0.226]),
        ]
    )
    from PIL import Image

    pil = Image.fromarray(img)
    trained = tf(pil).unsqueeze(0)  # 1×1×224×224

    # Same pipeline ⇒ near-identical tensors (small interpolation diffs allowed)
    diff = (serving - trained).abs().max().item()
    assert diff < 0.25, f"training/serving preprocessing diverged: max diff {diff:.3f}"
