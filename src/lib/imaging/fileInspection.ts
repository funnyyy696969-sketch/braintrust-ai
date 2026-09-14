/**
 * File inspection: determine WHAT was uploaded before doing anything else.
 *
 * Detects PNG / JPEG / TIFF / DICOM parsers by magic bytes (not by extension),
 * then gathers structure information:
 *  - PNG/JPEG: width, height, channels (and whether it *could* be a composite)
 *  - TIFF: page count via IFD chain walk
 *  - DICOM: part-10 preamble, rows/cols, frames, bit depth
 *  - NIfTI: header dims (3D volume vs 4D series)
 *  - ZIP: list of archive entries (local file headers, no compression lib needed)
 */

import type { FileInspectionReport, FileKind } from "./types";

// ---------------------------------------------------------------------------
// Low-level binary helpers
// ---------------------------------------------------------------------------

async function readSlice(file: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, start + length).arrayBuffer());
}

/** 16-bit little-endian read. */
function u16le(b: Uint8Array, off: number): number {
  return b[off] | (b[off + 1] << 8);
}

/** 16-bit big-endian read. */
function u16be(b: Uint8Array, off: number): number {
  return (b[off] << 8) | b[off + 1];
}

/** 32-bit little-endian read. */
function u32le(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

function ascii(b: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i]);
  return s;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

function inspectPng(b: Uint8Array): { width: number; height: number; channels: number } {
  const width = u32le(b, 16);
  const height = u32le(b, 20);
  const colorType = b[25];
  const palette = colorType === 3;
  const channels = palette
    ? 3 // rendered palette images become RGB
    : colorType === 0
      ? 1
      : colorType === 4
        ? 2 // grayscale + alpha → treated as 1 data channel + alpha
        : colorType === 2
          ? 3
          : 4;
  return { width, height, channels: channels === 2 ? 1 : channels };
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

function inspectJpeg(b: Uint8Array): { width: number; height: number; channels: number } {
  let off = 2;
  while (off + 4 < b.length) {
    if (b[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = b[off + 1];
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11 (progressive etc.)
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = u16be(b, off + 5);
      const width = u16be(b, off + 7);
      const channels = b[off + 9];
      return { width, height, channels };
    }
    const segLen = u16be(b, off + 2);
    off += 2 + segLen;
  }
  return { width: 0, height: 0, channels: 0 };
}

// ---------------------------------------------------------------------------
// TIFF — count pages by walking the IFD chain
// ---------------------------------------------------------------------------

function inspectTiff(b: Uint8Array): { pageCount: number; width: number; height: number } {
  const little = ascii(b, 0, 2) === "II";
  const read16 = (o: number) => (little ? u16le(b, o) : u16be(b, o));
  const read32 = (off: number): number => {
    if (little) return u32le(b, off);
    return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
  };
  const firstIfd = read32(4);
  let pageCount = 0;
  let width = 0;
  let height = 0;
  let ifd = firstIfd;
  while (ifd && ifd + 2 <= b.length && pageCount < 4096) {
    const entryCount = read16(ifd);
    pageCount++;
    for (let i = 0; i < entryCount && ifd + 2 + i * 12 + 12 <= b.length; i++) {
      const entry = ifd + 2 + i * 12;
      const tag = read16(entry);
      if (tag === 0x0100) width = read16(entry + 8) || read32(entry + 8);
      if (tag === 0x0101) height = read16(entry + 8) || read32(entry + 8);
    }
    ifd = read32(entryCount * 12 + ifd + 2);
  }
  return { pageCount, width, height };
}

// ---------------------------------------------------------------------------
// DICOM (part-10)
// ---------------------------------------------------------------------------

function inspectDicom(b: Uint8Array): {
  rows: number;
  columns: number;
  frames: number;
  bitDepth: number | null;
  seriesDescription: string | null;
} {
  const hasPreamble = ascii(b, 128, 4) === "DICM";
  let off = hasPreamble ? 132 : 0;
  let rows = 0;
  let columns = 0;
  let frames = 1;
  let bitDepth: number | null = null;
  let seriesDescription: string | null = null;

  const isTag = (o: number) => o + 8 <= b.length && b[o] !== 0xff;

  while (off + 8 <= b.length) {
    if (!isTag(off)) break;
    const group = u16le(b, off);
    const element = u16le(b, off + 2);
    const vr = ascii(b, off + 4, 2);
    const tag = (group << 16) | element;

    if (/^[A-Z]{2}$/.test(vr)) {
      // explicit VR
      let len: number;
      let valueOff: number;
      if (vr === "OB" || vr === "OW" || vr === "OF" || vr === "SQ" || vr === "UT" || vr === "UN") {
        len = u32le(b, off + 8);
        valueOff = off + 12;
      } else {
        len = u16le(b, off + 6);
        valueOff = off + 8;
      }
      if (len === 0xffffffff) break; // undefined-length sequence; stop safely
      const value = b.slice(valueOff, valueOff + Math.min(len, 64));
      if (tag === 0x00280010) rows = u16le(value, 0);
      else if (tag === 0x00280011) columns = u16le(value, 0);
      else if (tag === 0x00280008) frames = parseInt(ascii(value, 0, Math.min(len, 12)).trim(), 10) || 1;
      else if (tag === 0x00280100) bitDepth = u16le(value, 0);
      else if (tag === 0x0008103e)
        seriesDescription = ascii(value, 0, Math.min(len, 64)).replace(/\0/g, "").trim() || null;
      off = valueOff + len;
    } else {
      // implicit VR: 4-byte length
      const len = u32le(b, off + 4);
      if (len === 0xffffffff) break;
      if (tag === 0x00280010) rows = u16le(b, off + 8);
      else if (tag === 0x00280011) columns = u16le(b, off + 8);
      else if (tag === 0x00280008) frames = parseInt(ascii(b, off + 8, Math.min(len, 12)).trim(), 10) || 1;
      else if (tag === 0x00280100) bitDepth = u16le(b, off + 8);
      off += 8 + len;
    }
    if (rows && columns) break;
  }

  if (!hasPreamble && !rows && !columns) {
    throw new Error("Not a recognisable DICOM file (missing part-10 preamble and image tags)");
  }
  return { rows, columns, frames, bitDepth, seriesDescription };
}

// ---------------------------------------------------------------------------
// NIfTI-1
// ---------------------------------------------------------------------------

function inspectNifti(b: Uint8Array): {
  dims: number[];
  datatype: number;
  bitpix: number;
  pixdim: number[];
  description: string | null;
} {
  const sizeofHdr = 348;
  if (u32le(b, 0) !== sizeofHdr) throw new Error("Not a NIfTI-1 file (sizeof_hdr ≠ 348)");
  const dimLen = u16le(b, 40);
  const dims: number[] = [];
  for (let i = 0; i < Math.min(dimLen, 7); i++) dims.push(u32le(b, 42 + i * 2));
  const datatype = u16le(b, 70);
  const bitpix = u16le(b, 72);
  const pixdim: number[] = [];
  for (let i = 0; i < Math.min(dimLen, 7); i++) {
    const raw = u32le(b, 76 + i * 4);
    pixdim.push(new Float32Array(new Uint8Array([raw & 0xff, (raw >> 8) & 0xff, (raw >> 16) & 0xff, (raw >> 24) & 0xff]).buffer)[0]);
  }
  const description = ascii(b, 148, 80).replace(/\0/g, "").trim() || null;
  return { dims, datatype, bitpix, pixdim, description };
}

// ---------------------------------------------------------------------------
// ZIP — count entries via local file headers (no compression library)
// ---------------------------------------------------------------------------

function inspectZip(b: Uint8Array): { entryCount: number; entries: string[] } {
  const entries: string[] = [];
  let off = 0;
  while (off + 30 <= b.length) {
    const sig = u32le(b, off);
    if (sig !== 0x04034b50) {
      off++;
      continue;
    }
    const nameLen = u16le(b, off + 26);
    const extraLen = u16le(b, off + 28);
    const name = ascii(b, off + 30, Math.min(nameLen, 128));
    if (name && !name.endsWith("/")) entries.push(name);
    off += 30 + nameLen + extraLen;
    if (entries.length >= 512) break;
  }
  return { entryCount: entries.length, entries };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TIFF_II = [0x49, 0x49, 0x2a, 0x00];
const TIFF_MM = [0x4d, 0x4d, 0x00, 0x2a];

function matches(b: Uint8Array, sig: number[], off = 0): boolean {
  return sig.every((v, i) => b[off + i] === v);
}

export async function inspectFile(file: File): Promise<FileInspectionReport> {
  const head = await readSlice(file, 0, Math.min(file.size, 4096));
  const base = {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
  };

  // --- PNG ---
  if (matches(head, PNG_SIG)) {
    const { width, height, channels } = inspectPng(head);
    return {
      ...base,
      kind: "png",
      identificationNote: "Identified as PNG by 8-byte signature.",
      imageCount: 1,
      structure: "single",
      dimensions: [{ width, height }],
      channels: [channels],
      bitDepth: 8,
      seriesInfo: null,
      voxelSpacing: null,
      status: "ok",
      statusMessage: "Ordinary raster image. Composite panel detection runs next.",
    };
  }

  // --- JPEG ---
  if (matches(head, [0xff, 0xd8, 0xff])) {
    const { width, height, channels } = inspectJpeg(head);
    return {
      ...base,
      kind: "jpeg",
      identificationNote: "Identified as JPEG by SOI marker (0xFFD8FF).",
      imageCount: 1,
      structure: "single",
      dimensions: [{ width, height }],
      channels: [channels],
      bitDepth: 8,
      seriesInfo: null,
      voxelSpacing: null,
      status: "ok",
      statusMessage: "Ordinary raster image. Composite panel detection runs next.",
    };
  }

  // --- TIFF ---
  if (matches(head, TIFF_II) || matches(head, TIFF_MM)) {
    const info = inspectTiff(head);
    return {
      ...base,
      kind: "tiff",
      identificationNote: `Identified as TIFF (${info.pageCount} page${info.pageCount === 1 ? "" : "s"} via IFD chain).`,
      imageCount: info.pageCount,
      structure: info.pageCount > 1 ? "slice-stack" : "single",
      dimensions: [{ width: info.width, height: info.height }],
      channels: [1],
      bitDepth: null,
      seriesInfo: null,
      voxelSpacing: null,
      status: "ok",
      statusMessage:
        info.pageCount > 1
          ? `Multi-page TIFF: ${info.pageCount} slices detected.`
          : "Single-page TIFF.",
    };
  }

  // --- DICOM ---
  if (ascii(head, 128, 4) === "DICM" || head[0] === 0x08) {
    try {
      const d = inspectDicom(head);
      return {
        ...base,
        kind: "dicom",
        identificationNote: "Identified as DICOM via part-10 preamble / element tags.",
        imageCount: d.frames,
        structure: d.frames > 1 ? "slice-stack" : "single",
        dimensions: [{ width: d.columns, height: d.rows }],
        channels: [1],
        bitDepth: d.bitDepth,
        seriesInfo: d.seriesDescription,
        voxelSpacing: null,
        status: "ok",
        statusMessage:
          d.frames > 1
            ? `Multi-frame DICOM: ${d.frames} frames at ${d.columns}×${d.rows}.`
            : `Single-frame DICOM at ${d.columns}×${d.rows}.`,
      };
    } catch (e) {
      return {
        ...base,
        kind: "dicom",
        identificationNote: "DICOM-like but unparseable.",
        imageCount: 0,
        structure: "invalid",
        dimensions: [],
        channels: [],
        bitDepth: null,
        seriesInfo: null,
        voxelSpacing: null,
        status: "error",
        statusMessage: e instanceof Error ? e.message : "DICOM parse failed",
      };
    }
  }

  // --- NIfTI (raw .nii) ---
  if (head.length > 348 && u32le(head, 0) === 348) {
    try {
      const n = inspectNifti(head);
      const ndim = n.dims[0];
      return {
        ...base,
        kind: "nifti",
        identificationNote: "Identified as NIfTI-1 by sizeof_hdr = 348.",
        imageCount: ndim >= 3 ? n.dims[3] : 0,
        structure: ndim >= 3 ? "volume" : "invalid",
        dimensions: ndim >= 3 ? [{ width: n.dims[1], height: n.dims[2] }] : [],
        channels: [1],
        bitDepth: n.bitpix,
        seriesInfo: n.description,
        voxelSpacing: { x: n.pixdim[1], y: n.pixdim[2], z: n.pixdim[3] },
        status: "ok",
        statusMessage:
          ndim === 4
            ? `4D NIfTI series: ${n.dims[3]} volumes of ${n.dims[1]}×${n.dims[2]}.`
            : ndim === 3
              ? `3D NIfTI volume: ${n.dims[1]}×${n.dims[2]}×${n.dims[3]} slices.`
              : "Unsupported NIfTI dimensionality.",
      };
    } catch (e) {
      return {
        ...base,
        kind: "nifti",
        identificationNote: "NIfTI-like but unparseable.",
        imageCount: 0,
        structure: "invalid",
        dimensions: [],
        channels: [],
        bitDepth: null,
        seriesInfo: null,
        voxelSpacing: null,
        status: "error",
        statusMessage: e instanceof Error ? e.message : "NIfTI parse failed",
      };
    }
  }

  // --- ZIP ---
  if (matches(head, [0x50, 0x4b, 0x03, 0x04])) {
    const z = inspectZip(head);
    return {
      ...base,
      kind: "zip",
      identificationNote: `Identified as ZIP with ${z.entryCount} entries (first 4 KB scanned).`,
      imageCount: z.entryCount,
      structure: "archive",
      dimensions: [],
      channels: [],
      bitDepth: null,
      seriesInfo: z.entries.slice(0, 20).join(", "),
      voxelSpacing: null,
      status: "warning",
      statusMessage:
        "ZIP archives are listed but not extracted in the browser build — upload the individual files instead.",
    };
  }

  // --- unknown ---
  return {
    ...base,
    kind: "unknown",
    identificationNote: "No known signature matched.",
    imageCount: 0,
    structure: "invalid",
    dimensions: [],
    channels: [],
    bitDepth: null,
    seriesInfo: null,
    voxelSpacing: null,
    status: "error",
    statusMessage:
      "Unrecognised file type. Supported: PNG, JPG, multi-page TIFF, DICOM, NIfTI (.nii/.nii.gz), ZIP.",
  };
}
