"""
Prediction API Schemas
"""

from typing import Optional, Dict
from pydantic import BaseModel, Field


class PredictionResponse(BaseModel):
    """Response from prediction endpoint"""
    success: bool
    model_name: str
    predicted_class: Optional[str] = None
    confidence: Optional[float] = None
    probabilities: Optional[Dict[str, float]] = None
    preprocessing_info: Optional[dict] = None
    status: str = "demo"
    message: Optional[str] = None
    error: Optional[str] = None
