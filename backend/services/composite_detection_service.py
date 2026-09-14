"""
composite_detection_service.py — panel grid detection for composite PNG/JPG.

Desktop counterpart of src/lib/imaging/compositeDetection.ts. Detects 1, 4, 9,
or other panel counts from uniform gutter rows/columns (content-agnostic: works
for white or black backgrounds), and crops panels at FULL resolution.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from PIL import Image


@dataclass
class PanelGrid:
    rows: int
    cols: int
    confidence: str  # high | medium | low
    method: str  # uniform-gutter | whitespace-projection | single-panel
    panels: list[dict] = field(default_factory=list)  # x, y, w, h


def _to_gray(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("L"), dtype=np.float32)


def _std_profile(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return gray.std(axis=1), gray.std(axis=0)  # per row, per column


def _content_bands(std: np.ndarray, threshold: float, min_len: int) -> list[tuple[int, int]]:
    bands: list[tuple[int, int]] = []
    start = 0
    in_band = std[0] >= threshold
    for i in range(1, len(std)):
        now = std[i] >= threshold
        if now != in_band:
            if in_band and i - start >= min_len:
                bands.append((start, i - 1))
            start = i
            in_band = now
    if in_band and len(std) - start >= min_len:
        bands.append((start, len(std) - 1))
    return bands


def _consistent(sizes: list[int]) -> bool:
    if len(sizes) < 2:
        return True
    avg = float(np.mean(sizes))
    return all(abs(s - avg) / avg < 0.3 for s in sizes)


def detect_grid(image: Image.Image, analysis_max: int = 1024) -> PanelGrid:
    scale = min(1.0, analysis_max / max(image.size))
    aw, ah = max(1, round(image.width * scale)), max(1, round(image.height * scale))
    gray = np.asarray(image.convert("L").resize((aw, ah)), dtype=np.float32)

    row_std, col_std = _std_profile(gray)
    med = lambda arr: float(np.median(arr[arr > 0.5])) if (arr > 0.5).any() else 0.0
    thr_row, thr_col = max(2.0, med(row_std) * 0.08), max(2.0, med(col_std) * 0.08)

    min_band = round(min(aw, ah) * 0.12)
    row_bands = _content_bands(row_std, thr_row, min_band)
    col_bands = _content_bands(col_std, thr_col, min_band)

    if len(row_bands) <= 1 and len(col_bands) <= 1:
        return PanelGrid(1, 1, "high", "single-panel", [{"x": 0, "y": 0, "w": image.width, "h": image.height}])

    rows, cols = len(row_bands), len(col_bands)
    rows_ok = _consistent([b - t + 1 for t, b in row_bands])
    cols_ok = _consistent([b - t + 1 for t, b in col_bands])
    conf = "high" if rows_ok and cols_ok else ("medium" if rows == 1 or cols == 1 else "low")

    panels: list[dict] = []
    for r, (t, b) in enumerate(row_bands):
        for c, (l, rr) in enumerate(col_bands):
            panels.append({
                "x": round(l / scale), "y": round(t / scale),
                "w": round((rr - l + 1) / scale), "h": round((b - t + 1) / scale),
            })
    return PanelGrid(rows, cols, conf, "uniform-gutter", panels)


def extract_panels(image: Image.Image, grid: PanelGrid | None = None) -> list[Image.Image]:
    g = grid or detect_grid(image)
    out: list[Image.Image] = []
    for p in g.panels:
        if p["w"] < 16 or p["h"] < 16:
            continue
        out.append(image.crop((p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"])))
    return out
