"""
Evaluation API Schemas
"""

from typing import Optional, Dict
from pydantic import BaseModel


class RMAResult(BaseModel):
    """RMA calculation result"""
    rma_score: Optional[float] = None
    precision: Optional[float] = None
    recall: Optional[float] = None
    f1_score: Optional[float] = None
    spatial_metadata: Dict[str, float] = {}
    has_ground_truth: bool = False
    status: str = "demo"


class GAMAnalysisResult(BaseModel):
    """Result of GAM analysis"""
    summary: str
    plot_data: Optional[str] = None
    diagnostics: Optional[Dict[str, float]] = None
    formula: str
    is_real_analysis: bool = False
    status: str = "demo"
