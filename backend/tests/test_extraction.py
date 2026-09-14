"""
Unit tests for the multi-image extraction core.

Covers the required cases: 1-panel, 4-panel, 9-panel composites, multi-frame
inputs, and 3D medical volumes. Run with:  pytest backend/tests -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.composite_detection_service import detect_grid, extract_panels  # noqa: E402
from services.file_inspection_service import inspect_file  # noqa: E402


def _composite(rows: int, cols: int, panel: int = 64, gutter: int = 8) -> Image.Image:
    """Build a composite image: bright brain-ish blobs on a white background."""
    w = cols * panel + (cols + 1) * gutter
    h = rows * panel + (rows + 1) * gutter
    canvas = np.full((h, w), 255, dtype=np.uint8)
    rng = np.random.default_rng(rows * 10 + cols)
    for r in range(rows):
        for c in range(cols):
            y0 = gutter + r * (panel + gutter)
            x0 = gutter + c * (panel + gutter)
            yy, xx = np.mgrid[y0:y0 + panel, x0:x0 + panel]
            cy, cx = y0 + panel / 2, x0 + panel / 2
            blob = 255 - ((yy - cy) ** 2 + (xx - cx) ** 2).astype(np.float32) / (panel / 2) ** 2 * 160
            canvas[y0:y0 + panel, x0:x0 + panel] = np.clip(blob + rng.normal(0, 4, blob.shape), 0, 255)
    return Image.fromarray(canvas)


@pytest.mark.parametrize("rows,cols", [(1, 1), (2, 2), (3, 3), (1, 3), (3, 1)])
def test_grid_detection_counts(rows: int, cols: int):
    img = _composite(rows, cols)
    grid = detect_grid(img)
    assert grid.rows == rows
    assert grid.cols == cols
    assert len(grid.panels) == rows * cols


@pytest.mark.parametrize("rows,cols", [(1, 1), (2, 2), (3, 3)])
def test_panel_extraction_resolution(rows: int, cols: int):
    img = _composite(rows, cols, panel=80)
    panels = extract_panels(img)
    assert len(panels) == rows * cols
    # No stretching: every crop should be roughly square if panels are square
    for p in panels:
        ratio = p.width / p.height
        assert 0.7 < ratio < 1.4


def test_inspection_reports_png(tmp_path):
    p = tmp_path / "single.png"
    _composite(1, 1).save(p)
    report = inspect_file(p)
    assert report.kind.value == "png"
    assert report.image_count == 1
    assert report.status == "ok"


def test_inspection_multipage_tiff(tmp_path):
    p = tmp_path / "stack.tiff"
    frames = [_composite(1, 1, panel=32) for _ in range(5)]
    frames[0].save(p, save_all=True, append_images=frames[1:])
    report = inspect_file(p)
    assert report.kind.value == "tiff"
    assert report.image_count == 5
    assert report.structure == "slice-stack"


def test_inspection_3d_volume_reported_as_volume(tmp_path):
    """A 3D NIfTI-style stack must be reported as a volume, not a composite."""
    try:
        import nibabel as nib  # noqa: F401
    except ImportError:
        pytest.skip("nibabel not installed")
    p = tmp_path / "vol.nii"
    data = np.random.default_rng(0).normal(100, 30, (8, 8, 12)).astype(np.float32)
    img = nib.Nifti1Image(data, affine=np.eye(4))
    nib.save(img, p)
    report = inspect_file(p)
    assert report.kind.value == "nifti"
    assert report.structure == "volume"
    assert report.image_count == 12  # slices along the 3rd axis


def test_gutter_detection_is_content_agnostic(tmp_path):
    """White gutters (typical composite) and black gutters both detected."""
    img_white = _composite(2, 2)
    grid_w = detect_grid(img_white)
    assert grid_w.rows == 2 and grid_w.cols == 2

    arr = 255 - np.asarray(img_white)  # invert: black background
    img_black = Image.fromarray(arr)
    grid_b = detect_grid(img_black)
    assert grid_b.rows == 2 and grid_b.cols == 2
