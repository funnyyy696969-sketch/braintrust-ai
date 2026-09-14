"""
nifti_service.py — NIfTI volume adapter (desktop backend).

Full voxel access with documented slice-selection: slices are taken along the
chosen anatomical axis at t=0 by default, preserving the volume's ordering.
"""

from __future__ import annotations

import gzip
from dataclasses import dataclass

import numpy as np


@dataclass
class NiftiInfo:
    shape: tuple[int, ...]
    zooms: tuple[float, ...]
    bitpix: int
    description: str | None


def read_info(path) -> NiftiInfo:
    import nibabel as nib

    img = nib.load(path)
    return NiftiInfo(
        shape=tuple(int(s) for s in img.shape),
        zooms=tuple(float(z) for z in img.header.get_zooms()[:3]),
        bitpix=int(img.header["bitpix"]),
        description=str(img.header.get("descrip", b"") or b"", "utf-8", "ignore").strip() or None,
    )


def read_volume(path) -> np.ndarray:
    raw = open(path, "rb").read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    import io

    import nibabel as nib

    img = nib.Nifti1Image.from_bytes(raw)
    return np.asarray(img.dataobj, dtype=np.float32)


def read_slices(path, axis: str = "axial", t: int = 0) -> list[np.ndarray]:
    data = read_volume(path)
    if data.ndim < 3:
        raise ValueError("NIfTI volume must be at least 3-dimensional.")
    if data.ndim >= 4:
        data = data[..., min(t, data.shape[3] - 1)]
    axis_idx = {"axial": 2, "coronal": 1, "sagittal": 0}[axis]
    slices = [np.take(data, i, axis=axis_idx) for i in range(data.shape[axis_idx])]
    # Bring every slice to row×col for display
    if axis == "sagittal":
        slices = [np.rot90(s, k=1) for s in slices]
    return slices
