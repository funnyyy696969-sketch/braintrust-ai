"""
fragility_service.py — OFI_res (Output Fragility Index, resolution-consistent).

Formula (v1.0, project-defined — NOT a clinically validated standard):

    OFI_res = ( p_orig(target) − p_perturbed(target) ) / ( p_orig(target) + ε )

  target  : the class predicted on the clean image
  ε       : 1e-8 numerical floor
  ~0      : robust      ~1 : confidence collapsed (formula upper bound)
"""

from __future__ import annotations

from dataclasses import dataclass

OFI_FORMULA_VERSION = "OFI_res-v1.0"
OFI_RELIABILITY_THRESHOLD = 0.35
_EPSILON = 1e-8


@dataclass
class OfiResult:
    value: float
    confidence_change: float
    formula_version: str
    reliable: bool
    note: str


def compute_ofi(
    p_orig_target: float,
    p_pert_target: float,
) -> OfiResult:
    confidence_change = p_orig_target - p_pert_target
    value = confidence_change / (p_orig_target + _EPSILON)
    reliable = p_orig_target >= OFI_RELIABILITY_THRESHOLD
    note = (
        "Computed per OFI_res-v1.0 with sufficient baseline confidence."
        if reliable
        else (
            f"Baseline confidence {p_orig_target:.3f} is below the "
            f"{OFI_RELIABILITY_THRESHOLD:.2f} reliability floor — treat with caution."
        )
    )
    return OfiResult(
        value=value,
        confidence_change=confidence_change,
        formula_version=OFI_FORMULA_VERSION,
        reliable=reliable,
        note=note,
    )
