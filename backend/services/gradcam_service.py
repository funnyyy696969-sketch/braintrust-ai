"""
gradcam_service.py — per-image Grad-CAM via Captum.

The heatmap is generated from the SAME tensor that produced the prediction, at
the SAME resolution, so it can never be stretched onto the wrong image.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class GradCamResult:
    heatmap: np.ndarray  # H×W float32, normalised 0..1
    target_class: str
    saliency_mask: np.ndarray  # H×W bool
    coverage: float


def gradcam(
    model,
    tensor,  # 1×C×H×W torch tensor (already preprocessed)
    target_class_index: int,
    layer_name: str = "layer4",
) -> GradCamResult:
    import torch
    from captum.attr import LayerGradCam

    layer = dict(model.named_modules())[layer_name]
    lgc = LayerGradCam(model, layer)
    attrs = lgc.attribute(tensor, target=target_class_index, relu_attributions=True)
    cam = attrs[0, 0].detach().cpu().numpy()

    # Normalise
    cam = cam - cam.min()
    denom = cam.max() or 1.0
    cam = cam / denom

    # Upscale to input resolution (bilinear) — same image, matched dims
    import torch.nn.functional as F

    cam_t = torch.from_numpy(cam)[None, None]
    cam_up = F.interpolate(cam_t, size=tensor.shape[-2:], mode="bilinear", align_corners=False)
    cam_up = cam_up[0, 0].numpy()

    mask = cam_up >= 0.6
    coverage = float(mask.mean())
    return GradCamResult(
        heatmap=cam_up, target_class="", saliency_mask=mask, coverage=coverage
    )


def saliency_bbox(mask: np.ndarray) -> dict:
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return {"x": 0, "y": 0, "w": mask.shape[1], "h": mask.shape[0]}
    return {
        "x": int(xs.min()), "y": int(ys.min()),
        "w": int(xs.max() - xs.min() + 1), "h": int(ys.max() - ys.min() + 1),
    }
