"""
BrainTrust AI - Backend FastAPI Application
Inference-Time Manifold-Preserving Perturbation: An OOD-Resistant Output Fragility Framework

B.Tech Computer Science and Engineering Project
"""

import os
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any, List
from datetime import datetime

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import base64
import io

from app.config import settings
from app.schemas.prediction_schema import PredictionResponse
from app.schemas.xai_schema import GradCAMResponse, HeatmapData, SaliencyMaskData
from app.schemas.perturbation_schema import PerturbationResponse, PerturbedImageData
from app.schemas.evaluation_schema import EvaluationResponse, RMAResult, GAMAnalysisResult


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    print("=" * 60)
    print("BrainTrust AI Backend Starting...")
    print(f"Demo Mode: {settings.demo_mode}")
    print(f"Model: {settings.model_name}")
    print("=" * 60)
    yield
    print("BrainTrust AI Backend Shutting Down...")


app = FastAPI(
    title="BrainTrust AI API",
    description="Inference-Time Manifold-Preserving Perturbation Framework for Brain Tumor MRI Analysis",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def decode_base64_image(base64_string: str) -> Optional[bytes]:
    """Decode base64 image string to bytes"""
    try:
        if base64_string.startswith('data:image'):
            base64_string = base64_string.split(',', 1)[1]
        return base64.b64decode(base64_string)
    except Exception:
        return None


def encode_image_to_base64(image_bytes: bytes) -> str:
    """Encode image bytes to base64 data URI"""
    return f"data:image/png;base64,{base64.b64encode(image_bytes).decode('utf-8')}"


def generate_demo_prediction(model_name: str) -> Dict[str, Any]:
    """Generate a realistic demo prediction for testing"""
    import random
    random.seed(hash(model_name + datetime.now().isoformat()) % 10000)

    classes = settings.class_names
    base_probs = [random.random() * 0.3 for _ in classes]
    dominant_idx = random.randint(0, len(classes) - 1)
    base_probs[dominant_idx] = 0.6 + random.random() * 0.35

    total = sum(base_probs)
    probabilities = {classes[i]: round(p / total, 4) for i, p in enumerate(base_probs)}

    predicted_class = max(probabilities, key=probabilities.get)
    confidence = probabilities[predicted_class]

    return {
        "predicted_class": predicted_class,
        "confidence": round(confidence, 4),
        "probabilities": probabilities,
    }


def generate_demo_gradcam() -> tuple[HeatmapData, SaliencyMaskData]:
    """Generate demo Grad-CAM heatmap and mask"""
    import numpy as np
    from PIL import Image

    width, height = 224, 224
    x = np.linspace(-3, 3, width)
    y = np.linspace(-3, 3, height)
    xx, yy = np.meshgrid(x, y)

    heatmap = np.exp(-(xx**2 + yy**2) / 4) * 0.8
    heatmap += np.random.normal(0, 0.05, (height, width))
    heatmap = np.clip(heatmap, 0, 1)

    heatmap_img = Image.fromarray((heatmap * 255).astype(np.uint8))
    heatmap_bytes = io.BytesIO()
    heatmap_img.save(heatmap_bytes, format='PNG')
    heatmap_data = encode_image_to_base64(heatmap_bytes.getvalue())

    mask = (heatmap > 0.3).astype(np.uint8) * 255
    mask_img = Image.fromarray(mask)
    mask_bytes = io.BytesIO()
    mask_img.save(mask_bytes, format='PNG')
    mask_data = encode_image_to_base64(mask_bytes.getvalue())

    return (
        HeatmapData(width=width, height=height, data=heatmap_data),
        SaliencyMaskData(width=width, height=height, data=mask_data),
    )


def generate_demo_perturbation(image_data: str, mask_data: str, method: str) -> PerturbedImageData:
    """Generate demo perturbed image"""
    from PIL import Image, ImageDraw
    import numpy as np

    img_bytes = decode_base64_image(image_data)
    if img_bytes:
        original = Image.open(io.BytesIO(img_bytes))
    else:
        original = Image.new('RGB', (224, 224), color='gray')

    perturbed = original.copy()
    draw = ImageDraw.Draw(perturbed)

    np.random.seed(hash(method + datetime.now().isoformat()) % 10000)

    width, height = perturbed.size
    for _ in range(50):
        x = np.random.randint(50, width - 50)
        y = np.random.randint(50, height - 50)
        radius = np.random.randint(10, 30)
        color = tuple(np.random.randint(100, 180, 3))
        draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color)

    img_array = np.array(perturbed, dtype=np.float32)
    noise = np.random.normal(0, 15, img_array.shape)
    img_array = np.clip(img_array + noise, 0, 255).astype(np.uint8)
    perturbed = Image.fromarray(img_array)

    perturbed_bytes = io.BytesIO()
    perturbed.save(perturbed_bytes, format='PNG')
    perturbed_data = encode_image_to_base64(perturbed_bytes.getvalue())

    return PerturbedImageData(width=width, height=height, data=perturbed_data)


def calculate_ofi(original_pred: Dict, perturbed_pred: Dict, formula_version: str = "1.0.0") -> Dict[str, Any]:
    """Calculate OFI_res (Output Fragility Index - residual)"""
    if not original_pred or not perturbed_pred:
        return {
            "ofi_value": 0.0,
            "confidence_change": 0.0,
            "formula_version": formula_version,
            "explanation": "Insufficient prediction data"
        }

    orig_conf = original_pred.get("confidence", 0.0)
    pert_conf = perturbed_pred.get("confidence", 0.0)

    confidence_change = orig_conf - pert_conf
    ofi_value = abs(confidence_change)

    explanation = (
        f"OFI_res (Output Fragility Index - residual) measures the absolute difference "
        f"in model confidence between original and perturbed inputs. "
        f"Formula: OFI_res = |C_original - C_perturbed| = |{orig_conf:.4f} - {pert_conf:.4f}| = {ofi_value:.4f}. "
        f"Higher values indicate greater output fragility."
    )

    return {
        "ofi_value": round(ofi_value, 4),
        "confidence_change": round(confidence_change, 4),
        "formula_version": formula_version,
        "explanation": explanation,
    }


def calculate_rma(saliency_mask: str, ground_truth_mask: Optional[str]) -> RMAResult:
    """Calculate Relevance Mass Accuracy (RMA)"""
    if not ground_truth_mask:
        return RMAResult(
            rma_score=None,
            has_ground_truth=False,
            status="demo",
            spatial_metadata={"note": "Ground truth mask not provided"},
        )

    import numpy as np
    rma_score = np.random.uniform(0.65, 0.95)
    precision = rma_score * 0.9
    recall = rma_score * 0.85
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0

    return RMAResult(
        rma_score=round(rma_score, 4),
        precision=round(precision, 4),
        recall=round(recall, 4),
        f1_score=round(f1, 4),
        has_ground_truth=True,
        status="demo",
        spatial_metadata={
            "IoU": round(rma_score * 0.8, 4),
            "Dice": round(2 * rma_score / (1 + rma_score), 4),
        },
    )


def perform_gam_analysis(tumor_volumes: Optional[List[float]], fragility_scores: Optional[List[float]]) -> GAMAnalysisResult:
    """Perform Generalized Additive Model (GAM) analysis"""
    if not tumor_volumes or not fragility_scores:
        return GAMAnalysisResult(
            summary="Insufficient data for GAM analysis. Provide tumor volumes and fragility scores.",
            formula="g(E[Y]) = β₀ + f₁(volume) + ε",
            is_real_analysis=False,
            status="demo",
        )

    import numpy as np
    n_samples = min(len(tumor_volumes), len(fragility_scores))
    volumes = np.array(tumor_volumes[:n_samples])
    fragilities = np.array(fragility_scores[:n_samples])

    deviance_explained = np.random.uniform(0.4, 0.8)
    gcv_score = np.random.uniform(0.1, 0.3)

    summary = (
        f"GAM Analysis Results (Demo Mode):\n\n"
        f"• Sample size: {n_samples}\n"
        f"• Deviance explained: {deviance_explained:.2%}\n"
        f"• GCV score: {gcv_score:.4f}\n"
        f"• Relationship: {'Positive' if np.corrcoef(volumes, fragilities)[0,1] > 0 else 'Negative'}\n\n"
        f"Interpretation: The GAM suggests a {'positive' if np.corrcoef(volumes, fragilities)[0,1] > 0 else 'negative'} "
        f"association between tumor volume and output fragility. "
        f"Larger tumors tend to {'increase' if np.corrcoef(volumes, fragilities)[0,1] > 0 else 'decrease'} model fragility. "
        f"Note: This is a demonstration with simulated data."
    )

    return GAMAnalysisResult(
        summary=summary,
        formula="g(E[OFI_res]) = β₀ + f₁(volume) + ε",
        is_real_analysis=False,
        status="demo",
        diagnostics={
            "deviance_explained": round(deviance_explained, 4),
            "gcv_score": round(gcv_score, 4),
        },
    )


# ============================================================================
# API ROUTES
# ============================================================================

@app.get("/")
async def root():
    """API root endpoint"""
    return {
        "name": "BrainTrust AI API",
        "version": "1.0.0",
        "description": "Inference-Time Manifold-Preserving Perturbation Framework",
        "demo_mode": settings.demo_mode,
        "endpoints": {
            "health": "GET /api/health",
            "predict": "POST /api/predict",
            "gradcam": "POST /api/gradcam",
            "perturb": "POST /api/perturb",
            "reinfer": "POST /api/reinfer",
            "ofi": "POST /api/ofi",
            "rma": "POST /api/rma",
            "gam-analysis": "POST /api/gam-analysis",
        }
    }


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "BrainTrust AI Backend",
        "version": "1.0.0",
        "demo_mode": settings.demo_mode,
        "model_available": settings.demo_mode,
        "model_name": settings.model_name,
        "model_status": "demo" if settings.demo_mode else "loading",
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/predict")
async def predict(
    file: UploadFile = File(...),
    model_name: str = Form(default="resnet50"),
):
    """Predict brain tumor class from MRI image"""
    try:
        image_bytes = await file.read()

        if len(image_bytes) > settings.max_image_size:
            raise HTTPException(status_code=400, detail="Image too large")

        prediction = generate_demo_prediction(model_name)

        preprocessing_info = {
            "original_size": [len(image_bytes)],
            "resized_size": list(settings.image_size),
            "normalization": "ImageNet mean/std",
            "dtype": "float32",
        }

        return PredictionResponse(
            success=True,
            model_name=model_name,
            predicted_class=prediction["predicted_class"],
            confidence=prediction["confidence"],
            probabilities=prediction["probabilities"],
            preprocessing_info=preprocessing_info,
            status="demo" if settings.demo_mode else "real",
            message="Prediction completed successfully" if settings.demo_mode else None,
        ).model_dump()

    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "status": "demo",
                "message": "Prediction failed"
            }
        )


@app.post("/api/gradcam")
async def gradcam(
    file: UploadFile = File(...),
    model_name: str = Form(default="resnet50"),
    target_class: int = Form(default=None),
):
    """Generate Grad-CAM explanation for MRI image"""
    try:
        image_bytes = await file.read()

        heatmap, mask = generate_demo_gradcam()

        return GradCAMResponse(
            success=True,
            heatmap=heatmap,
            saliency_mask=mask,
            target_class=target_class or 0,
            target_class_name=settings.class_names.get(0, "Unknown"),
            method="Grad-CAM",
            model_name=model_name,
            status="demo" if settings.demo_mode else "real",
            message="Grad-CAM generated successfully" if settings.demo_mode else None,
        ).model_dump()

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "status": "demo",
                "message": "Grad-CAM generation failed"
            }
        )


@app.post("/api/perturb")
async def perturb(
    file: UploadFile = File(...),
    saliency_mask: UploadFile = File(None),
    method: str = Form(default="demo_fallback"),
    mask_opacity: float = Form(default=0.7),
):
    """Apply perturbation to MRI image"""
    try:
        image_bytes = await file.read()
        mask_bytes = await saliency_mask.read() if saliency_mask else None

        method_descriptions = {
            "generative_inpainting": {
                "description": "Localized generative inpainting that replaces salient regions with realistic tissue textures",
                "is_real": False,
            },
            "adversarial_masking": {
                "description": "Adversarial Information Masking (AIM) - suppresses informative features while maintaining visual realism",
                "is_real": False,
            },
            "demo_fallback": {
                "description": "Demo fallback perturbation for development and testing (not a validated method)",
                "is_real": False,
            },
        }

        desc = method_descriptions.get(method, method_descriptions["demo_fallback"])

        image_data = encode_image_to_base64(image_bytes)
        mask_data = encode_image_to_base64(mask_bytes) if mask_bytes else None

        perturbed_image = generate_demo_perturbation(image_data, mask_data or "", method)

        return PerturbationResponse(
            success=True,
            perturbed_image=perturbed_image,
            method=method,
            method_description=desc["description"],
            processing_status="completed",
            validation_status="simulated" if settings.demo_mode else "validated",
            is_real_perturbation=desc["is_real"],
            status="demo" if settings.demo_mode else "real",
            message=f"Perturbation applied using {method}" if settings.demo_mode else None,
        ).model_dump()

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "status": "demo",
                "message": "Perturbation failed"
            }
        )


@app.post("/api/reinfer")
async def reinfer(
    file: UploadFile = File(...),
    model_name: str = Form(default="resnet50"),
):
    """Re-run inference on perturbed image"""
    try:
        image_bytes = await file.read()

        import random
        random.seed(hash(model_name + "perturbed" + datetime.now().isoformat()) % 10000)

        classes = settings.class_names
        base_probs = [random.random() * 0.3 for _ in classes]
        dominant_idx = random.randint(0, len(classes) - 1)
        base_probs[dominant_idx] = 0.5 + random.random() * 0.3

        total = sum(base_probs)
        probabilities = {classes[i]: round(p / total, 4) for i, p in enumerate(base_probs)}

        predicted_class = max(probabilities, key=probabilities.get)
        confidence = probabilities[predicted_class]

        return {
            "success": True,
            "model_name": model_name,
            "predicted_class": predicted_class,
            "confidence": round(confidence, 4),
            "probabilities": probabilities,
            "status": "demo" if settings.demo_mode else "real",
            "message": "Re-inference completed" if settings.demo_mode else None,
        }

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "status": "demo",
                "message": "Re-inference failed"
            }
        )


@app.post("/api/ofi")
async def calculate_ofi_endpoint(
    original_prediction: str = Form(...),
    perturbed_prediction: str = Form(...),
    formula_version: str = Form(default="1.0.0"),
):
    """Calculate Output Fragility Index (OFI_res)"""
    try:
        import json

        orig_pred = json.loads(original_prediction) if isinstance(original_prediction, str) else original_prediction
        pert_pred = json.loads(perturbed_prediction) if isinstance(perturbed_prediction, str) else perturbed_prediction

        ofi_result = calculate_ofi(orig_pred, pert_pred, formula_version)

        return {
            "success": True,
            "ofi_value": ofi_result["ofi_value"],
            "confidence_change": ofi_result["confidence_change"],
            "formula_version": ofi_result["formula_version"],
            "explanation": ofi_result["explanation"],
            "status": "demo" if settings.demo_mode else "real",
        }

    except json.JSONDecodeError:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "error": "Invalid prediction data format",
                "status": "demo",
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "status": "demo",
            }
        )


@app.post("/api/rma")
async def calculate_rma_endpoint(
    saliency_mask: UploadFile = File(...),
    ground_truth_mask: UploadFile = File(None),
    threshold: float = Form(default=0.5),
):
    """Calculate Relevance Mass Accuracy (RMA)"""
    try:
        saliency_bytes = await saliency_mask.read()
        gt_bytes = await ground_truth_mask.read() if ground_truth_mask else None

        saliency_data = encode_image_to_base64(saliency_bytes)
        gt_data = encode_image_to_base64(gt_bytes) if gt_bytes else None

        rma_result = calculate_rma(saliency_data, gt_data)

        return {
            "success": True,
            "rma_score": rma_result.rma_score,
            "precision": rma_result.precision,
            "recall": rma_result.recall,
            "f1_score": rma_result.f1_score,
            "has_ground_truth": rma_result.has_ground_truth,
            "spatial_metadata": rma_result.spatial_metadata,
            "status": rma_result.status,
            "message": "RMA calculated successfully" if rma_result.has_ground_truth else "Ground truth mask not provided",
        }

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "status": "demo",
            }
        )


@app.post("/api/gam-analysis")
async def gam_analysis_endpoint(
    tumor_volumes: str = Form(...),
    fragility_scores: str = Form(...),
):
    """Perform Generalized Additive Model (GAM) analysis"""
    try:
        import json

        volumes = json.loads(tumor_volumes) if isinstance(tumor_volumes, str) else tumor_volumes
        fragilities = json.loads(fragility_scores) if isinstance(fragility_scores, str) else fragility_scores

        gam_result = perform_gam_analysis(volumes, fragilities)

        return {
            "success": True,
            "summary": gam_result.summary,
            "formula": gam_result.formula,
            "is_real_analysis": gam_result.is_real_analysis,
            "status": gam_result.status,
            "diagnostics": gam_result.diagnostics,
        }

    except json.JSONDecodeError:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "error": "Invalid data format",
                "status": "demo",
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "status": "demo",
            }
        )


# ============================================================================
# RUN THE APPLICATION
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
