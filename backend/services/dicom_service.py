"""
dicom_service.py — DICOM parsing adapter (desktop backend).

Wraps pydicom with safe metadata handling: patient-identifying attributes are
never returned. Supports single-frame and multi-frame, uncompressed and (with
installed codecs) compressed transfer syntaxes.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# Attributes that must never be surfaced by this service.
_PII_TAGS = (
    "PatientName", "PatientID", "PatientBirthDate", "PatientSex",
    "PatientAddress", "PatientAge", "OtherPatientIDs", "InstitutionName",
    "ReferringPhysicianName", "AccessionNumber", "StudyID",
)


@dataclass
class DicomInfo:
    rows: int
    columns: int
    frames: int
    bits_allocated: int
    series_description: str | None
    transfer_syntax: str | None


def read_info(path) -> DicomInfo:
    import pydicom

    ds = pydicom.dcmread(path, stop_before_pixels=True)
    return DicomInfo(
        rows=int(ds.Rows),
        columns=int(ds.Columns),
        frames=int(getattr(ds, "NumberOfFrames", 1)),
        bits_allocated=int(getattr(ds, "BitsAllocated", 16)),
        series_description=str(getattr(ds, "SeriesDescription", "") or "") or None,
        transfer_syntax=str(getattr(ds.file_meta, "TransferSyntaxUID", "") or "") or None,
    )


def read_frames(path) -> list[np.ndarray]:
    """Return every frame as float32 H×W. Anonymised: no metadata is attached."""
    import pydicom

    ds = pydicom.dcmread(path)
    arr = ds.pixel_array.astype(np.float32)
    if arr.ndim == 2:
        return [arr]
    return [arr[i] for i in range(arr.shape[0])]


def safe_metadata(path) -> dict:
    """Non-identifying metadata only."""
    info = read_info(path)
    return {
        "rows": info.rows,
        "columns": info.columns,
        "frames": info.frames,
        "bits_allocated": info.bits_allocated,
        "series_description": info.series_description,
    }
