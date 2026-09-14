"""
multi_image_analysis_service.py — orchestrates the per-image pipeline.

Contract: every image gets its OWN prediction, Grad-CAM, perturbation and
OFI_res. No result is ever copied or averaged between images; group-level
numbers are computed separately and clearly labelled as aggregations.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .fragility_service import OfiResult, compute_ofi
from .gradcam_service import GradCamResult, gradcam, saliency_bbox
from .image_extraction_service import ExtractedImage
from .perturbation_service import perturb
from .prediction_service import MODEL_INPUT_SIZE, Prediction, checkpoint_available, predict


@dataclass
class ImageResult:
    image_id: str
    status: str  # done | error
    stage: str
    prediction: Prediction | None = None
    perturbed_prediction: Prediction | None = None
    gradcam: GradCamResult | None = None
    perturbed_pixels: object | None = None
    ofi: OfiResult | None = None
    saliency_bbox: dict | None = None
    error: str | None = None


@dataclass
class BatchResult:
    results: list[ImageResult] = field(default_factory=list)
    model_ready: bool = False


def analyze_image(model, image: ExtractedImage, target_index: int, method: str, device: str = "cpu") -> ImageResult:
    res = ImageResult(image_id=image.image_id, status="running", stage="preprocess")
    try:
        tensor = _to_tensor(image.pixels)
        res.prediction = predict(image.pixels, device=device)
        res.stage = "gradcam"

        from .prediction_service import CLASS_LABELS

        idx = CLASS_LABELS.index(res.prediction.predicted_class)
        gc = gradcam(model, tensor, idx)
        gc.target_class = res.prediction.predicted_class
        res.gradcam = gc
        res.saliency_bbox = saliency_bbox(gc.saliency_mask)
        res.stage = "perturb"

        pert = perturb(image.pixels, gc.saliency_mask, method)
        res.perturbed_pixels = pert.image
        res.stage = "re-classify"

        res.perturbed_prediction = predict(pert.image, device=device)
        res.stage = "ofi"

        res.ofi = compute_ofi(
            res.prediction.probabilities[res.prediction.predicted_class],
            res.perturbed_prediction.probabilities[res.prediction.predicted_class],
        )
        res.status, res.stage = "done", "complete"
    except Exception as exc:  # noqa: BLE001 — surface a real message, never a fake value
        res.status, res.stage, res.error = "error", "failed", str(exc)
    return res


def analyze_batch(model, images: list[ExtractedImage], method: str, device: str = "cpu") -> BatchResult:
    if not checkpoint_available():
        raise RuntimeError(
            "No model checkpoint is loaded. Multi-image analysis requires a trained checkpoint; "
            "no values are simulated."
        )
    out = BatchResult(model_ready=True)
    for i, im in enumerate(images):
        im.image_id = im.image_id or f"img-{i}"
        out.results.append(analyze_image(model, im, 0, method, device))
    return out


def _to_tensor(pixels: "np.ndarray"):
    import torch

    from .prediction_service import preprocess

    return torch.from_numpy(
        preprocess(pixels)[0, 0].numpy()[None, None].astype("float32")
    )
