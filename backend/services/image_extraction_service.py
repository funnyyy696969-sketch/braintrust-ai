"""
image_extraction_service.py — routes a file to the right extractor and
normalises results into a uniform list of ExtractedImage records.
"""

from __future__ import annotations

import gzip
import io
import zipfile
from dataclasses import dataclass

import numpy as np
from PIL import Image

from .composite_detection_service import detect_grid, extract_panels
from .file_inspection_service import FileKind, InspectionReport, inspect_file


@dataclass
class ExtractedImage:
    image_id: str
    pixels: np.ndarray  # H×W×C float32
    width: int
    height: int
    channels: int
    source: str  # single-file | composite-panel | tiff-page | dicom-frame | nifti-slice | zip-entry
    source_detail: str


def extract_all(path) -> tuple[InspectionReport, list[ExtractedImage]]:
    report = inspect_file(path)
    images: list[ExtractedImage] = []

    if report.kind in (FileKind.PNG, FileKind.JPEG):
        img = Image.open(path)
        panels = extract_panels(img)
        if len(panels) == 1:
            images.append(_from_pil(panels[0], "single-file", "whole file"))
        else:
            for i, p in enumerate(panels):
                images.append(
                    _from_pil(p, "composite-panel", f"panel {i} of {len(panels)}")
                )

    elif report.kind is FileKind.TIFF:
        import tifffile

        with tifffile.TiffFile(path) as tif:
            for i, page in enumerate(tif.pages):
                arr = page.asarray()
                images.append(
                    _from_array(arr, "tiff-page", f"page {i + 1} of {len(tif.pages)}")
                )

    elif report.kind is FileKind.DICOM:
        import pydicom

        ds = pydicom.dcmread(path)
        arr = ds.pixel_array  # handles frames + decompression where codecs exist
        if arr.ndim == 2:
            images.append(_from_array(arr, "dicom-frame", "frame 1"))
        else:
            for f in range(arr.shape[0]):
                images.append(
                    _from_array(arr[f], "dicom-frame", f"frame {f + 1} of {arr.shape[0]}")
                )

    elif report.kind is FileKind.NIFTI:
        import nibabel as nib

        raw = open(path, "rb").read()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        img = nib.Nifti1Image.from_bytes(raw) if hasattr(nib, "Nifti1Image") else None
        data = np.asarray(img.dataobj, dtype=np.float32)
        nz = data.shape[2] if data.ndim == 3 else data.shape[2]
        nt = data.shape[3] if data.ndim >= 4 else 1
        count = 0
        for t in range(nt):
            for z in range(nz):
                vol = data[:, :, z, t] if data.ndim >= 4 else data[:, :, z]
                images.append(
                    _from_array(vol, "nifti-slice", f"axial slice {z + 1} (t={t + 1})")
                )
                count += 1

    elif report.kind is FileKind.ZIP:
        import tempfile

        with zipfile.ZipFile(path) as zf:
            for name in zf.namelist():
                if name.endswith("/") or not name.lower().endswith(
                    (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".dcm", ".nii", ".gz")
                ):
                    continue
                with tempfile.NamedTemporaryFile(
                    suffix="." + name.rsplit(".", 1)[-1], delete=False
                ) as tmp:
                    tmp.write(zf.read(name))
                    tmp_path = tmp.name
                try:
                    sub_report, sub_images = extract_all(tmp_path)
                    for im in sub_images:
                        im.source = "zip-entry"
                        im.source_detail = name
                        im.image_id = f"img-{len(images)}"
                        images.append(im)
                finally:
                    import os

                    os.unlink(tmp_path)

    return report, images


def _from_pil(img: Image.Image, source: str, detail: str) -> ExtractedImage:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    return ExtractedImage(
        image_id="", pixels=arr, width=arr.shape[1], height=arr.shape[0],
        channels=3, source=source, source_detail=detail,
    )


def _from_array(arr: np.ndarray, source: str, detail: str) -> ExtractedImage:
    arr = np.asarray(arr, dtype=np.float32)
    if arr.ndim == 2:
        arr = arr[:, :, None]
    return ExtractedImage(
        image_id="", pixels=arr, width=arr.shape[1], height=arr.shape[0],
        channels=arr.shape[2], source=source, source_detail=detail,
    )
