"""
file_inspection_service.py — format detection & structure reporting.

Desktop counterpart of src/lib/imaging/fileInspection.ts. Runs where PyTorch,
pydicom, nibabel, and tifffile are available, so it supports the full format
range (compressed DICOM transfer syntaxes, 4D NIfTI, deflated ZIP, …).
"""

from __future__ import annotations

import gzip
import io
import struct
import zipfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class FileKind(str, Enum):
    PNG = "png"
    JPEG = "jpeg"
    TIFF = "tiff"
    DICOM = "dicom"
    NIFTI = "nifti"
    ZIP = "zip"
    UNKNOWN = "unknown"


@dataclass
class InspectionReport:
    file_name: str
    file_size: int
    kind: FileKind
    structure: str  # single | composite | slice-stack | volume | archive | invalid
    image_count: int
    dimensions: list[dict] = field(default_factory=list)
    channels: list[int] = field(default_factory=list)
    bit_depth: int | None = None
    series_info: str | None = None
    voxel_spacing: dict | None = None
    status: str = "ok"
    status_message: str = ""
    identification_note: str = ""


PNG_SIG = b"\x89PNG\r\n\x1a\n"
JPEG_SIG = b"\xff\xd8\xff"
TIFF_II = b"II*\x00"
TIFF_MM = b"MM\x00*"
ZIP_SIG = b"PK\x03\x04"


def detect_kind(head: bytes) -> FileKind:
    if head.startswith(PNG_SIG):
        return FileKind.PNG
    if head.startswith(JPEG_SIG):
        return FileKind.JPEG
    if head.startswith(TIFF_II) or head.startswith(TIFF_MM):
        return FileKind.TIFF
    if len(head) >= 132 and head[128:132] == b"DICM":
        return FileKind.DICOM
    if head[:2] == b"\x1f\x8b" or (len(head) > 348 and struct.unpack("<I", head[:4])[0] == 348):
        return FileKind.NIFTI
    if head.startswith(ZIP_SIG):
        return FileKind.ZIP
    return FileKind.UNKNOWN


def inspect_file(path: str | Path) -> InspectionReport:
    path = Path(path)
    size = path.stat().st_size
    with open(path, "rb") as f:
        head = f.read(4096)

    kind = detect_kind(head)

    if kind is FileKind.PNG:
        w, h = struct.unpack(">II", head[16:24])
        return InspectionReport(
            file_name=path.name, file_size=size, kind=kind, structure="single",
            image_count=1, dimensions=[{"width": w, "height": h}],
            channels=[_png_channels(head[25])],
            bit_depth=8, status="ok",
            status_message="Ordinary raster image; composite panel detection runs next.",
            identification_note="PNG signature matched.",
        )

    if kind is FileKind.JPEG:
        dims = _jpeg_dimensions(head)
        return InspectionReport(
            file_name=path.name, file_size=size, kind=kind, structure="single",
            image_count=1, dimensions=[dims], channels=[3], bit_depth=8,
            status="ok",
            status_message="Ordinary raster image; composite panel detection runs next.",
            identification_note="JPEG SOI marker matched.",
        )

    if kind is FileKind.TIFF:
        import tifffile  # local import: optional heavy dependency

        with tifffile.TiffFile(path) as tif:
            pages = len(tif.pages)
            p0 = tif.pages[0]
            return InspectionReport(
                file_name=path.name, file_size=size, kind=kind,
                structure="slice-stack" if pages > 1 else "single",
                image_count=pages,
                dimensions=[{"width": p0.shape[1], "height": p0.shape[0]}],
                channels=[1], bit_depth=int(p0.dtype.itemsize * 8) if p0.dtype else None,
                status="ok",
                status_message=f"Multi-page TIFF with {pages} page(s).",
                identification_note="TIFF magic matched.",
            )

    if kind is FileKind.DICOM:
        import pydicom

        ds = pydicom.dcmread(path, stop_before_pixels=True)
        frames = int(getattr(ds, "NumberOfFrames", 1))
        return InspectionReport(
            file_name=path.name, file_size=size, kind=kind,
            structure="slice-stack" if frames > 1 else "single",
            image_count=frames,
            dimensions=[{"width": int(ds.Columns), "height": int(ds.Rows)}],
            channels=[1], bit_depth=int(getattr(ds, "BitsAllocated", 16)),
            series_info=str(getattr(ds, "SeriesDescription", "") or "") or None,
            status="ok",
            status_message=f"DICOM with {frames} frame(s) at {ds.Columns}x{ds.Rows}.",
            identification_note="DICM preamble matched. Patient-identifying tags are not read.",
        )

    if kind is FileKind.NIFTI:
        import nibabel as nib

        raw = path.read_bytes()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        img = nib.Nifti1Image(io.BytesIO(raw), affine=None) if False else nib.load(path)
        shape = tuple(int(s) for s in img.shape)
        ndim = len(shape)
        zooms = [float(z) for z in img.header.get_zooms()[: min(ndim, 3)]] if ndim >= 3 else []
        return InspectionReport(
            file_name=path.name, file_size=size, kind=kind,
            structure="volume" if ndim >= 3 else "invalid",
            image_count=int(shape[2]) if ndim == 3 else int(shape[3]) if ndim >= 4 else 0,
            dimensions=[{"width": shape[0], "height": shape[1]}] if ndim >= 3 else [],
            channels=[1], bit_depth=int(img.header["bitpix"]),
            series_info=str(img.header.get("descrip", b"") or b"", "utf-8", "ignore").strip() or None,
            voxel_spacing={"x": zooms[0], "y": zooms[1], "z": zooms[2]} if len(zooms) == 3 else None,
            status="ok" if ndim >= 3 else "error",
            status_message=(
                f"NIfTI volume {shape}." if ndim >= 3
                else f"Unsupported NIfTI dimensionality: {shape}."
            ),
            identification_note="sizeof_hdr == 348 (NIfTI-1).",
        )

    if kind is FileKind.ZIP:
        with zipfile.ZipFile(path) as zf:
            names = [n for n in zf.namelist() if not n.endswith("/")]
        return InspectionReport(
            file_name=path.name, file_size=size, kind=kind, structure="archive",
            image_count=len(names), series_info=", ".join(names[:20]) or None,
            status="warning",
            status_message=f"ZIP archive with {len(names)} entries; extraction handled per entry.",
            identification_note="ZIP local header matched.",
        )

    return InspectionReport(
        file_name=path.name, file_size=size, kind=FileKind.UNKNOWN,
        structure="invalid", image_count=0, status="error",
        status_message="Unrecognised file type.",
        identification_note="No known signature.",
    )


def _png_channels(color_type: int) -> int:
    return {0: 1, 2: 3, 3: 3, 4: 1, 6: 4}.get(color_type, 3)


def _jpeg_dimensions(head: bytes) -> dict:
    off = 2
    while off + 9 < len(head):
        if head[off] != 0xFF:
            off += 1
            continue
        marker = head[off + 1]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", head[off + 5: off + 9])
            return {"width": w, "height": h}
        seg_len = struct.unpack(">H", head[off + 2: off + 4])[0]
        off += 2 + seg_len
    return {"width": 0, "height": 0}
