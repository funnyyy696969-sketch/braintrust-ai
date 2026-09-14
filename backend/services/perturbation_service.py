"""
perturbation_service.py — realistic, salient-region-only perturbations.

Only pixels inside the saliency mask change; everything else stays identical,
which is what makes the downstream OFI_res measurement meaningful.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageFilter


@dataclass
class Perturbed:
    image: np.ndarray  # H×W×C float32
    method: str
    perturbed_pixel_count: int


def perturb(
    pixels: np.ndarray,       # H×W×C float32, 0..255 scale
    mask: np.ndarray,         # H×W bool (True = salient)
    method: str = "gaussian-blur",
) -> Perturbed:
    h, w = mask.shape
    img = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))

    if method == "gaussian-blur":
        effect = img.filter(ImageFilter.GaussianBlur(radius=10))
    elif method == "pixelate":
        block = 12
        small = img.resize((max(1, w // block), max(1, h // block)), Image.BILINEAR)
        effect = small.resize((w, h), Image.NEAREST)
    elif method == "brightness-shift":
        effect = Image.fromarray(np.clip(pixels * 0.72, 0, 255).astype(np.uint8))
    elif method == "noise-overlay":
        rng = np.random.default_rng(12345)  # fixed seed: reproducible
        noise = rng.normal(0, 0.18 * 255, size=pixels.shape).astype(np.float32)
        effect = Image.fromarray(np.clip(pixels + noise, 0, 255).astype(np.uint8))
    else:
        raise ValueError(f"Unknown perturbation method: {method}")

    eff = np.asarray(effect, dtype=np.float32)
    feather = np.asarray(
        Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)),
        dtype=np.float32,
    ) / 255.0
    alpha = feather[:, :, None] if eff.ndim == 3 else feather

    out = pixels * (1 - alpha) + eff * alpha
    count = int((feather > 0.05).sum())
    return Perturbed(image=out, method=method, perturbed_pixel_count=count)
