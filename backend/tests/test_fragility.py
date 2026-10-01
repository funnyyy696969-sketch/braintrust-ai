"""OFI_res unit tests — formula behaviour, guard, and versioning."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.fragility_service import (  # noqa: E402
    OFI_FORMULA_VERSION,
    OFI_RELIABILITY_THRESHOLD,
    compute_ofi,
)


def test_no_change_gives_zero():
    r = compute_ofi(0.9, 0.9)
    assert abs(r.value) < 1e-6
    assert r.reliable


def test_full_collapse_gives_one():
    r = compute_ofi(0.9, 0.0)
    assert abs(r.value - 1.0) < 1e-3
    assert abs(r.confidence_change - 0.9) < 1e-6


def test_flip_caps_at_one():
    # p_pert can never go below 0, so (p_orig − 0)/(p_orig + ε) ≈ 1 — the
    # formula's upper bound. A "flip" manifests as value → 1, not > 1.
    r = compute_ofi(0.8, 0.0)
    assert 0.999 <= r.value <= 1.0


def test_reliability_guard():
    r = compute_ofi(0.2, 0.05)
    assert not r.reliable
    assert "caution" in r.note.lower()


def test_version_is_reported():
    r = compute_ofi(0.9, 0.8)
    assert r.formula_version == OFI_FORMULA_VERSION
    assert OFI_FORMULA_VERSION.startswith("OFI_res-v")


def test_threshold_is_used():
    assert 0 < OFI_RELIABILITY_THRESHOLD < 1
