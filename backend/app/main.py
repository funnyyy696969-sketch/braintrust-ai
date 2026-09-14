"""
FastAPI application — desktop backend exposing the multi-image pipeline.

Routes are only enabled when a trained checkpoint exists; the API never
simulates medical output (reliability requirement #12 of the project spec).
"""

from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .services.evaluation_service import evaluate
from .services.multi_image_analysis_service import analyze_batch
from .services.prediction_service import checkpoint_available

app = FastAPI(title="BrainTrust AI — Multi-Image MRI Analysis", version="2.0.0")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "checkpoint_available": checkpoint_available(),
        "analysis_enabled": checkpoint_available(),
    }


@app.post("/api/inspect")
async def inspect(file: UploadFile = File(...)):
    from .services.file_inspection_service import inspect_file

    path = await _persist(file)
    try:
        report = inspect_file(path)
        return {
            "fileName": report.file_name,
            "fileSize": report.file_size,
            "kind": report.kind.value,
            "structure": report.structure,
            "imageCount": report.image_count,
            "dimensions": report.dimensions,
            "channels": report.channels,
            "bitDepth": report.bit_depth,
            "seriesInfo": report.series_info,
            "voxelSpacing": report.voxel_spacing,
            "status": report.status,
            "statusMessage": report.status_message,
            "identificationNote": report.identification_note,
        }
    finally:
        Path(path).unlink(missing_ok=True)


@app.post("/api/extract")
async def extract(file: UploadFile = File(...)):
    from .services.image_extraction_service import extract_all

    path = await _persist(file)
    try:
        report, images = extract_all(path)
        return {
            "report": {
                "kind": report.kind.value,
                "structure": report.structure,
                "imageCount": len(images),
                "status": report.status,
            },
            "images": [
                {
                    "imageId": im.image_id or f"img-{i}",
                    "width": im.width,
                    "height": im.height,
                    "channels": im.channels,
                    "source": im.source,
                    "sourceDetail": im.source_detail,
                }
                for i, im in enumerate(images)
            ],
        }
    finally:
        Path(path).unlink(missing_ok=True)


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...), method: str = "gaussian-blur"):
    if not checkpoint_available():
        raise HTTPException(
            status_code=503,
            detail=(
                "No trained model checkpoint is configured on this server. "
                "Analysis is disabled rather than simulated."
            ),
        )
    from .services.image_extraction_service import extract_all

    path = await _persist(file)
    try:
        _, images = extract_all(path)
        batch = analyze_batch(model=None, images=images, method=method)
        summary = evaluate(batch)
        return {
            "images": [
                {
                    "imageId": r.image_id,
                    "status": r.status,
                    "stage": r.stage,
                    "prediction": None
                    if not r.prediction
                    else {
                        "predictedClass": r.prediction.predicted_class,
                        "confidence": r.prediction.confidence,
                        "probabilities": r.prediction.probabilities,
                    },
                    "perturbedPrediction": None
                    if not r.perturbed_prediction
                    else {
                        "predictedClass": r.perturbed_prediction.predicted_class,
                        "confidence": r.perturbed_prediction.confidence,
                    },
                    "ofi": None
                    if not r.ofi
                    else {
                        "value": r.ofi.value,
                        "confidenceChange": r.ofi.confidence_change,
                        "formulaVersion": r.ofi.formula_version,
                        "reliable": r.ofi.reliable,
                        "note": r.ofi.note,
                    },
                    "saliencyBbox": r.saliency_bbox,
                    "error": r.error,
                }
                for r in batch.results
            ],
            "groupSummary": {
                "totalImages": summary.total_images,
                "analyzed": summary.analyzed,
                "failed": summary.failed,
                "predictionCounts": summary.prediction_counts,
                "ofiMean": summary.ofi_mean,
                "ofiStdDev": summary.ofi_std,
                "imagesRequiringReview": summary.images_requiring_review,
                "predictionConsistency": summary.prediction_consistency,
            },
        }
    finally:
        Path(path).unlink(missing_ok=True)


async def _persist(upload: UploadFile) -> str:
    suffix = Path(upload.filename or "upload.bin").suffix or ".bin"
    data = await upload.read()
    path = Path(tempfile.gettempdir()) / f"bta-{uuid.uuid4().hex}{suffix}"
    path.write_bytes(data)
    return str(path)
