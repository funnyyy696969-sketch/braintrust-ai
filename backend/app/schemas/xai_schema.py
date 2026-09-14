"""
Grad-CAM / XAI API Schemas
"""

from typing import Optional
from pydantic import BaseModel


class HeatmapData(BaseModel):
    """Heatmap data from Grad-CAM"""
    width: int
    height: int
    data: Optional[str] = None


class SaliencyMaskData(BaseModel):
    """Saliency mask data"""
    width: int
    height: int
    data: Optional[str] = None


class GradCAMResponse(BaseModel):
    """Response from Grad-CAM endpoint"""
    success: bool
    heatmap: Optional[HeatmapData] = None
    saliency_mask: Optional[SaliencyMaskData] = None
    target_class: Optional[int] = None
    target_class_name: Optional[str] = None
    method: str = "Grad-CAM"
    model_name: str
    status: str = "demo"
    message: Optional[str] = None
    error: Optional[str] = None
