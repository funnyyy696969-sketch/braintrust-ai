"""
Perturbation API Schemas
"""

from typing import Optional
from pydantic import BaseModel


class PerturbedImageData(BaseModel):
    """Perturbed image data"""
    width: int
    height: int
    data: Optional[str] = None


class PerturbationResponse(BaseModel):
    """Response from perturbation endpoint"""
    success: bool
    perturbed_image: Optional[PerturbedImageData] = None
    method: str
    method_description: str
    processing_status: str = "completed"
    validation_status: str = "unknown"
    is_real_perturbation: bool = False
    status: str = "demo"
    message: Optional[str] = None
    error: Optional[str] = None
