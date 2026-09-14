"""
evaluation_service.py — statistical evaluation over per-image results.

All outputs are descriptive statistics over image-level values. Nothing here
combines predictions into a diagnosis; aggregation is labelled as such.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .multi_image_analysis_service import BatchResult


@dataclass
class EvaluationSummary:
    total_images: int
    analyzed: int
    failed: int
    prediction_counts: dict[str, int]
    ofi_mean: float | None
    ofi_std: float | None
    images_requiring_review: list[str]
    prediction_consistency: float  # fraction agreeing with the modal class


def evaluate(batch: BatchResult) -> EvaluationSummary:
    done = [r for r in batch.results if r.status == "done"]
    failed = [r for r in batch.results if r.status == "error"]

    counts: dict[str, int] = {}
    for r in done:
        if r.prediction:
            counts[r.prediction.predicted_class] = counts.get(r.prediction.predicted_class, 0) + 1

    modal = max(counts.values()) if counts else 0
    ofi = [r.ofi.value for r in done if r.ofi]
    review = [r.image_id for r in done if r.ofi and not r.ofi.reliable]

    return EvaluationSummary(
        total_images=len(batch.results),
        analyzed=len(done),
        failed=len(failed),
        prediction_counts=counts,
        ofi_mean=float(np.mean(ofi)) if ofi else None,
        ofi_std=float(np.std(ofi, ddof=1)) if len(ofi) > 1 else None,
        images_requiring_review=review,
        prediction_consistency=(modal / len(done)) if done else 0.0,
    )
