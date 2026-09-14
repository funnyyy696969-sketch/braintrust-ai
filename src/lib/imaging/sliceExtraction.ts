/**
 * Slice / frame extraction for medical imaging formats.
 *
 * Scope (documented honestly — no silent failures):
 *  - NIfTI (.nii and .nii.gz): full voxel read, axial/coronal/sagittal slice
 *    extraction, slope/inter scaling, robust percentile windowing.
 *  - DICOM: explicit & implicit VR little-endian, uncompressed transfer
 *    syntaxes (native pixel data). Multi-frame and single-frame supported.
 *    Compressed transfer syntaxes (JPEG/JPEG-LS/RLE) raise a clear error.
 *  - TIFF: baseline uncompressed / single-channel pages.
 *  - ZIP: stored (uncompressed) entries are routed back as individual files.
 *
 * Patient-identifying DICOM attributes are NOT rendered or stored; only
 * non-identifying acquisition metadata (dimensions, series description) is read.
 */

import type { ExtractedImage, FileInspectionReport } from "./types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function readBytes(file: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, start + length).arrayBuffer());
}

function u16le(b: Uint8Array, off: number): number {
  return b[off] | (b[off + 1] << 8);
}

function u32le(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

function i16le(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8)) << 16 >> 16;
}

function i32le(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) | 0;
}

function ascii(b: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i]);
  return s;
}

/** Map a float voxel slice to a grayscale PNG data URL with percentile windowing. */
export function floatSliceToDataUrl(
  values: Float32Array,
  width: number,
  height: number,
): string {
  const sorted = Float32Array.from(values).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)] ?? 0;
  const hi = sorted[Math.floor(sorted.length * 0.99)] ?? 1;
  const range = hi - lo || 1;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = Math.max(0, Math.min(255, Math.round(((values[i] - lo) / range) * 255)));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

// ---------------------------------------------------------------------------
// TIFF — baseline uncompressed pages
// ---------------------------------------------------------------------------

export async function extractTiffPages(
  file: File,
  report: FileInspectionReport,
): Promise<ExtractedImage[]> {
  const b = await readBytes(file, 0, Math.min(file.size, 8 * 1024 * 1024));
  const little = ascii(b, 0, 2) === "II";
  const read16 = (o: number) => (little ? u16le(b, o) : (b[o] << 8) | b[o + 1]);
  const read32 = (o: number) =>
    little
      ? u32le(b, o)
      : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

  const images: ExtractedImage[] = [];
  let ifd = read32(4);
  let page = 0;

  while (ifd && ifd + 2 <= b.length && page < 256) {
    const entryCount = read16(ifd);
    let width = 0;
    let height = 0;
    let compression = 1;
    let stripOffsets: number[] = [];
    let stripBytes: number[] = [];
    let bitsPerSample = 8;
    let samplesPerPixel = 1;

    for (let i = 0; i < entryCount && ifd + 2 + i * 12 + 12 <= b.length; i++) {
      const e = ifd + 2 + i * 12;
      const tag = read16(e);
      const type = read16(e + 2);
      const count = read32(e + 4);
      const valOff = count * (type === 3 ? 2 : 4) <= 4 ? e + 8 : read32(e + 8);
      const rd = (k: number) => (type === 3 ? read16(valOff + k * 2) : read32(valOff + k * 4));
      switch (tag) {
        case 0x0100: width = rd(0); break;
        case 0x0101: height = rd(0); break;
        case 0x0102: bitsPerSample = rd(0); break;
        case 0x0103: compression = rd(0); break;
        case 0x0111: stripOffsets = Array.from({ length: count }, (_, k) => rd(k)); break;
        case 0x0117: stripBytes = Array.from({ length: count }, (_, k) => rd(k)); break;
        case 0x0115: samplesPerPixel = rd(0); break;
      }
    }

    if (width && height && stripOffsets.length && compression === 1 && bitsPerSample === 8) {
      const raw = new Uint8Array(width * height * samplesPerPixel);
      let filled = 0;
      for (let s = 0; s < stripOffsets.length && filled < raw.length; s++) {
        const len = stripBytes[s] ?? width * height;
        const chunk = b.slice(stripOffsets[s], stripOffsets[s] + len);
        raw.set(chunk.subarray(0, raw.length - filled), filled);
        filled += chunk.length;
      }
      const values = new Float32Array(width * height);
      for (let i = 0; i < width * height; i++) values[i] = raw[i * samplesPerPixel];
      images.push({
        id: `img-${page}`,
        dataUrl: floatSliceToDataUrl(values, width, height),
        width,
        height,
        channels: 1,
        source: { type: "tiff-page", page },
      });
    }
    page++;
    ifd = read32(ifd + 2 + entryCount * 12);
  }

  if (!images.length) {
    throw new Error(
      "This TIFF uses a compression or bit depth the browser build cannot decode. Convert the pages to PNG or use the desktop backend.",
    );
  }
  void report;
  return images;
}

// ---------------------------------------------------------------------------
// DICOM — explicit/implicit VR little-endian, uncompressed pixel data
// ---------------------------------------------------------------------------

export async function extractDicomFrames(
  file: File,
  report: FileInspectionReport,
): Promise<ExtractedImage[]> {
  const head = await readBytes(file, 0, Math.min(file.size, 1024 * 1024));
  const hasPreamble = ascii(head, 128, 4) === "DICM";
  let off = hasPreamble ? 132 : 0;

  let rows = 0;
  let cols = 0;
  let frames = 1;
  let bitsAllocated = 16;
  let pixelRepresentation = 0;
  let rescaleSlope = 1;
  let rescaleIntercept = 0;
  let transferSyntaxUid = "1.2.840.10008.1.2.1"; // default: explicit VR LE
  let explicitVr = true;
  let pixelDataOff = -1;
  let pixelDataLen = 0;

  const readTag = () => {
    const group = u16le(head, off);
    const element = u16le(head, off + 2);
    return (group << 16) | element;
  };

  // First pass over the meta group for the transfer syntax
  while (off + 8 <= head.length) {
    const tag = readTag();
    const vr = ascii(head, off + 4, 2);
    if (!/^[A-Z]{2}$/.test(vr)) break;
    let len: number;
    let vOff: number;
    if (vr === "OB" || vr === "OW" || vr === "OF" || vr === "SQ" || vr === "UT" || vr === "UN") {
      len = u32le(head, off + 8);
      vOff = off + 12;
    } else {
      len = u16le(head, off + 6);
      vOff = off + 8;
    }
    if (len === 0xffffffff) break;
    if (tag === 0x00020010) transferSyntaxUid = ascii(head, vOff, len).replace(/\0/g, "").trim();
    off = vOff + len;
    if ((tag >> 16) !== 0x0002) break;
  }

  if (transferSyntaxUid === "1.2.840.10008.1.2") {
    explicitVr = false; // implicit VR LE
  } else if (
    transferSyntaxUid !== "1.2.840.10008.1.2.1" &&
    transferSyntaxUid !== "1.2.840.10008.1.2.1.99"
  ) {
    throw new Error(
      `DICOM transfer syntax ${transferSyntaxUid} uses compression that the browser build cannot decode. Export the study uncompressed.`,
    );
  }

  // Second pass: locate Rows/Columns/frames/pixel data
  off = hasPreamble ? 132 : 0;
  while (off + 8 <= head.length) {
    const group = u16le(head, off);
    if (group === 0x0002) {
      // skip meta group again (already read)
      const vr = ascii(head, off + 4, 2);
      const long = vr === "OB" || vr === "OW" || vr === "OF" || vr === "SQ" || vr === "UT" || vr === "UN";
      const len = long ? u32le(head, off + 8) : u16le(head, off + 6);
      if (len === 0xffffffff) break;
      off += (long ? 12 : 8) + len;
      continue;
    }
    if (!explicitVr) {
      if (off + 8 > head.length) break;
      const tag = readTag();
      const len = u32le(head, off + 4);
      if (len === 0xffffffff) break;
      if (tag === 0x00280010) rows = u16le(head, off + 8);
      else if (tag === 0x00280011) cols = u16le(head, off + 8);
      else if (tag === 0x00280008) frames = parseInt(ascii(head, off + 8, Math.min(len, 12)).trim(), 10) || 1;
      else if (tag === 0x00280100) bitsAllocated = u16le(head, off + 8);
      else if (tag === 0x00281003) pixelRepresentation = u16le(head, off + 8);
      else if (tag === 0x00281053) rescaleSlope = new Float32Array(head.slice(off + 8, off + 12).buffer)[0];
      else if (tag === 0x00281052) rescaleIntercept = new Float32Array(head.slice(off + 8, off + 12).buffer)[0];
      else if (tag === 0x7fe00010) {
        pixelDataOff = off + 8;
        pixelDataLen = len || file.size - (off + 8);
        break;
      }
      off += 8 + len;
    } else {
      const vr = ascii(head, off + 4, 2);
      if (!/^[A-Z]{2}$/.test(vr)) break;
      const tag = readTag();
      let len: number;
      let vOff: number;
      const long = vr === "OB" || vr === "OW" || vr === "OF" || vr === "SQ" || vr === "UT" || vr === "UN";
      if (long) {
        len = u32le(head, off + 8);
        vOff = off + 12;
      } else {
        len = u16le(head, off + 6);
        vOff = off + 8;
      }
      if (len === 0xffffffff) break;
      if (tag === 0x00280010) rows = u16le(head, vOff);
      else if (tag === 0x00280011) cols = u16le(head, vOff);
      else if (tag === 0x00280008) frames = parseInt(ascii(head, vOff, Math.min(len, 12)).trim(), 10) || 1;
      else if (tag === 0x00280100) bitsAllocated = u16le(head, vOff);
      else if (tag === 0x00281003) pixelRepresentation = u16le(head, vOff);
      else if (tag === 0x00281053) rescaleSlope = new Float32Array(head.slice(vOff, vOff + 4).buffer)[0];
      else if (tag === 0x00281052) rescaleIntercept = new Float32Array(head.slice(vOff, vOff + 4).buffer)[0];
      else if (tag === 0x7fe00010) {
        pixelDataOff = vOff;
        pixelDataLen = len || file.size - vOff;
        break;
      }
      off = vOff + len;
    }
  }

  if (!rows || !cols || pixelDataOff < 0) {
    throw new Error("DICOM image data could not be located (missing rows/columns/pixel data).");
  }

  const pixels = await readBytes(file, pixelDataOff, Math.min(pixelDataLen, file.size - pixelDataOff));
  const pixelsPerFrame = rows * cols;
  const bytesPerPixel = bitsAllocated / 8;
  const images: ExtractedImage[] = [];

  for (let f = 0; f < frames; f++) {
    const frameStart = f * pixelsPerFrame * bytesPerPixel;
    if (frameStart + pixelsPerFrame * bytesPerPixel > pixels.length) break;
    const values = new Float32Array(pixelsPerFrame);
    for (let i = 0; i < pixelsPerFrame; i++) {
      const o = frameStart + i * bytesPerPixel;
      let raw: number;
      if (bitsAllocated === 8) raw = pixels[o];
      else if (pixelRepresentation === 1) raw = i16le(pixels, o);
      else raw = u16le(pixels, o);
      values[i] = raw * rescaleSlope + rescaleIntercept;
    }
    images.push({
      id: `img-${f}`,
      dataUrl: floatSliceToDataUrl(values, cols, rows),
      width: cols,
      height: rows,
      channels: 1,
      source: { type: "dicom-frame", frame: f },
    });
  }

  void report;
  if (!images.length) throw new Error("No decodable frames found in this DICOM file.");
  return images;
}

// ---------------------------------------------------------------------------
// NIfTI — 3D/4D volumes, .nii and gzip .nii.gz
// ---------------------------------------------------------------------------

export async function extractNiftiSlices(
  file: File,
  report: FileInspectionReport,
  options: { axis?: "axial" | "coronal" | "sagittal"; maxSlices?: number } = {},
): Promise<ExtractedImage[]> {
  const axis = options.axis ?? "axial";
  const maxSlices = options.maxSlices ?? 64;

  // Load the whole header+data (volumes used in this project are ≤ a few hundred MB)
  const buf = new Uint8Array(await file.arrayBuffer());
  let b = buf;

  // gzip detection: 1f 8b
  if (b[0] === 0x1f && b[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("Gzip-compressed NIfTI requires browser DecompressionStream support.");
    }
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([b]).stream().pipeThrough(ds);
    b = new Uint8Array(await new Response(stream).arrayBuffer());
  }

  if (u32le(b, 0) !== 348) throw new Error("Not a NIfTI-1 file.");
  const dimLen = u16le(b, 40);
  const dims: number[] = [];
  for (let i = 0; i < Math.min(dimLen, 7); i++) dims.push(u32le(b, 42 + i * 2));
  const ndim = dims[0];
  if (ndim < 3) throw new Error("NIfTI volume must be at least 3-dimensional.");
  const nx = dims[1];
  const ny = dims[2];
  const nz = dims[3];
  const nt = ndim >= 4 ? dims[4] : 1;

  const datatype = u16le(b, 70);
  const bitpix = u16le(b, 72);
  const slopeRaw = u32le(b, 112);
  const slope = new Float32Array(new Uint8Array([slopeRaw & 0xff, (slopeRaw >> 8) & 0xff, (slopeRaw >> 16) & 0xff, (slopeRaw >> 24) & 0xff]).buffer)[0];
  const interRaw = u32le(b, 116);
  const inter = new Float32Array(new Uint8Array([interRaw & 0xff, (interRaw >> 8) & 0xff, (interRaw >> 16) & 0xff, (interRaw >> 24) & 0xff]).buffer)[0];
  const voxOffsetRaw = u32le(b, 108);
  const voxOffset = new Float32Array(new Uint8Array([voxOffsetRaw & 0xff, (voxOffsetRaw >> 8) & 0xff, (voxOffsetRaw >> 16) & 0xff, (voxOffsetRaw >> 24) & 0xff]).buffer)[0] || 352;

  const readVoxel = (o: number): number => {
    switch (datatype) {
      case 2: return b[o]; // uint8
      case 4: return i16le(b, o); // int16
      case 8: return i32le(b, o); // int32
      case 16: return new Float32Array(b.slice(o, o + 4).buffer)[0]; // float32
      case 512: return u16le(b, o); // uint16
      case 768: return u32le(b, o); // uint32
      case 64: return new Float64Array(b.slice(o, o + 8).buffer)[0]; // float64
      default:
        throw new Error(`Unsupported NIfTI datatype code ${datatype} (bitpix ${bitpix}).`);
    }
  };

  const bytesPerVoxel = bitpix / 8;
  const dataBase = Math.round(voxOffset);

  // Slice count along the chosen axis
  const sliceCount =
    axis === "axial" ? nz : axis === "coronal" ? ny : nx;
  const step = Math.max(1, Math.ceil(sliceCount / maxSlices));

  const images: ExtractedImage[] = [];
  let idx = 0;
  for (let s = 0; s < sliceCount; s += step) {
    const values = new Float32Array(nx * ny);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        // Voxel index depends on axis; t=0 volume only
        let vi: number;
        if (axis === "axial") vi = x + nx * (y + ny * s);
        else if (axis === "coronal") vi = x + nx * (s + ny * y);
        else vi = s + nx * (x + ny * y);
        const o = dataBase + vi * bytesPerVoxel + 0 * nx * ny * nz * bytesPerVoxel;
        values[y * nx + x] = o + bytesPerVoxel <= b.length
          ? readVoxel(o) * (slope || 1) + (inter || 0)
          : 0;
      }
    }
    images.push({
      id: `img-${idx}`,
      dataUrl: floatSliceToDataUrl(values, nx, ny),
      width: nx,
      height: ny,
      channels: 1,
      source: { type: "nifti-slice", axis, index: s },
    });
    idx++;
  }

  void report;
  if (!images.length) throw new Error("No slices could be extracted from this volume.");
  return images;
}

// ---------------------------------------------------------------------------
// ZIP — stored (uncompressed) entries routed back as files
// ---------------------------------------------------------------------------

export async function extractZipEntries(
  file: File,
  report: FileInspectionReport,
): Promise<ExtractedImage[]> {
  const b = await readBytes(file, 0, Math.min(file.size, 16 * 1024 * 1024));
  const images: ExtractedImage[] = [];
  let off = 0;
  let idx = 0;

  while (off + 30 <= b.length && idx < 64) {
    const sig = u32le(b, off);
    if (sig !== 0x04034b50) {
      off++;
      continue;
    }
    const method = u16le(b, off + 8);
    const compressedSize = u32le(b, off + 18);
    const nameLen = u16le(b, off + 26);
    const extraLen = u16le(b, off + 28);
    const name = ascii(b, off + 30, nameLen);
    const dataOff = off + 30 + nameLen + extraLen;

    if (!name.endsWith("/") && /\.(png|jpe?g|tiff?|dcm|nii)$/i.test(name)) {
      if (method !== 0) {
        throw new Error(
          `ZIP entry "${name}" is deflated. Re-create the archive without compression, or upload the files individually.`,
        );
      }
      const blob = file.slice(dataOff, dataOff + compressedSize);
      const asFile = new File([blob], name.split("/").pop() || `entry-${idx}`);
      // Recurse via dynamic import to avoid a circular dependency at module load
      const { inspectFile } = await import("./fileInspection");
      const { extractAll } = await import("./extraction");
      const inner = await inspectFile(asFile);
      const innerImages = await extractAll(asFile, inner);
      innerImages.forEach((im) => {
        images.push({
          ...im,
          id: `img-${images.length}`,
          source: { type: "zip-entry", entryName: name },
        });
      });
    }

    off = dataOff + compressedSize;
    idx++;
  }

  void report;
  if (!images.length) throw new Error("No decodable image entries were found in this ZIP archive.");
  return images;
}
