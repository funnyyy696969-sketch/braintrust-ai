/**
 * Composite panel detection & extraction for PNG/JPG uploads.
 *
 * Strategy:
 *  1. Load the ORIGINAL image at full resolution (never resized for cropping).
 *  2. Downscale a scratch copy (max 1024px) for analysis — fast and robust.
 *  3. Detect gutters (rows/columns of near-uniform pixels) via per-row/column
 *     standard deviation. MRI panels sit on white OR black backgrounds, so
 *     uniformity — not brightness — identifies separators.
 *  4. Content bands = maximal runs of non-uniform rows/columns. If the band
 *     count forms a consistent grid (e.g. 2×2, 3×3), crop by gutter midpoints.
 *  5. Fallback: if no clean gutters exist, split on whitespace rows/cols
 *     (classic projecting segmentation); if still ambiguous, ask the user to
 *     confirm or correct the grid manually (handled in the review UI).
 *
 * Crops are computed on analysis scale and mapped back to ORIGINAL pixels, so
 * extracted panels keep full resolution. Nothing is stretched or rotated.
 */

import type { ExtractedImage } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GridDetection {
  rows: number;
  cols: number;
  /** Analysis-scale cut positions (x for cols, y for rows), at gutter midpoints. */
  cutsX: number[];
  cutsY: number[];
  confidence: "high" | "medium" | "low";
  method: "uniform-gutter" | "whitespace-projection" | "single-panel";
  /** Original-scale panel rects. */
  panels: { x: number; y: number; w: number; h: number }[];
}

interface Gray {
  data: Float32Array; // 0..255
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

export function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = dataUrl;
  });
}

export function drawToCanvas(img: HTMLImageElement, w?: number, h?: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w ?? img.naturalWidth;
  canvas.height = h ?? img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toGray(canvas: HTMLCanvasElement): Gray {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { width, height } = canvas;
  const px = ctx.getImageData(0, 0, width, height).data;
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    // Rec.601 luma
    data[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  }
  return { data, width, height };
}

// ---------------------------------------------------------------------------
// Gutter detection
// ---------------------------------------------------------------------------

/** Std-dev of each row/column. Near-zero ⇒ uniform separator line. */
function rowColStdDev(g: Gray): { rowStd: Float32Array; colStd: Float32Array } {
  const rowStd = new Float32Array(g.height);
  const colStd = new Float32Array(g.width);
  const rowSum = new Float64Array(g.height);
  const colSum = new Float64Array(g.width);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const v = g.data[y * g.width + x];
      rowSum[y] += v;
      colSum[x] += v;
    }
  }
  for (let y = 0; y < g.height; y++) {
    const mean = rowSum[y] / g.width;
    let acc = 0;
    for (let x = 0; x < g.width; x++) {
      const d = g.data[y * g.width + x] - mean;
      acc += d * d;
    }
    rowStd[y] = Math.sqrt(acc / g.width);
  }
  for (let x = 0; x < g.width; x++) {
    const mean = colSum[x] / g.height;
    let acc = 0;
    for (let y = 0; y < g.height; y++) {
      const d = g.data[y * g.width + x] - mean;
      acc += d * d;
    }
    colStd[x] = Math.sqrt(acc / g.height);
  }
  return { rowStd, colStd };
}

/** Maximal runs of indices whose std-dev is below threshold. */
function uniformRuns(std: Float32Array, threshold: number): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  for (let i = 0; i < std.length; i++) {
    if (std[i] < threshold) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push({ start, end: i - 1 });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, end: std.length - 1 });
  return runs;
}

/** Content bands = gaps between uniform runs (the panels themselves). */
function contentBands(std: Float32Array, threshold: number, minLength: number): number[][] {
  const runs = uniformRuns(std, threshold);
  const bands: number[][] = [];
  let prev = 0;
  for (const r of runs) {
    if (r.start - prev >= minLength) bands.push([prev, r.start - 1]);
    prev = r.end + 1;
  }
  if (std.length - prev >= minLength) bands.push([prev, std.length - 1]);
  return bands;
}

// ---------------------------------------------------------------------------
// Grid detection
// ---------------------------------------------------------------------------

const MIN_PANEL_FRACTION = 0.12; // a panel must be ≥12% of the axis length

export function detectGrid(g: Gray): GridDetection {
  const { rowStd, colStd } = rowColStdDev(g);

  // Adaptive threshold: uniform if std-dev < max(2, 8% of median non-zero std)
  const medianStd = (arr: Float32Array) => {
    const sorted = Array.from(arr).filter((v) => v > 0.5).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  };
  const thrRow = Math.max(2, medianStd(rowStd) * 0.08);
  const thrCol = Math.max(2, medianStd(colStd) * 0.08);

  const minBand = Math.round(Math.min(g.width, g.height) * MIN_PANEL_FRACTION);
  const rowBands = contentBands(rowStd, thrRow, minBand);
  const colBands = contentBands(colStd, thrCol, minBand);

  // Single-panel: no consistent gutters in both axes
  if (rowBands.length <= 1 && colBands.length <= 1) {
    return {
      rows: 1,
      cols: 1,
      cutsX: [],
      cutsY: [],
      confidence: "high",
      method: "single-panel",
      panels: [{ x: 0, y: 0, w: g.width, h: g.height }],
    };
  }

  // Regular grid: every band should have similar size (±30%)
  const bandSizes = (bands: number[][]) => bands.map((b) => b[1] - b[0] + 1);
  const consistent = (sizes: number[]) => {
    if (sizes.length < 2) return true;
    const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    return sizes.every((s) => Math.abs(s - avg) / avg < 0.3);
  };

  const rows = rowBands.length;
  const cols = colBands.length;
  const sizesR = bandSizes(rowBands);
  const sizesC = bandSizes(colBands);
  const rowsOk = consistent(sizesR);
  const colsOk = consistent(sizesC);

  const method: GridDetection["method"] =
    thrRow > 2 || thrCol > 2 ? "uniform-gutter" : "whitespace-projection";
  const conf: GridDetection["confidence"] =
    rowsOk && colsOk ? "high" : rows === 1 || cols === 1 ? "medium" : "low";

  // Cuts at gutter midpoints between adjacent bands (analysis scale)
  const midCuts = (bands: number[][]): number[] => {
    const cuts: number[] = [];
    for (let i = 0; i < bands.length - 1; i++) {
      cuts.push(Math.round((bands[i][1] + bands[i + 1][0]) / 2));
    }
    return cuts;
  };

  const cutsX = midCuts(colBands);
  const cutsY = midCuts(rowBands);

  // Build panel rects in analysis scale, then scale to ORIGINAL coordinates
  const panels: { x: number; y: number; w: number; h: number }[] = [];
  const xs = [0, ...cutsX, g.width];
  const ys = [0, ...cutsY, g.height];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      panels.push({
        x: xs[c],
        y: ys[r],
        w: xs[c + 1] - xs[c],
        h: ys[r + 1] - ys[r],
      });
    }
  }

  return { rows, cols, cutsX, cutsY, confidence: conf, method, panels };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

async function canvasToPngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return canvas.toDataURL("image/png");
}

function countChannels(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const px = ctx.getImageData(0, 0, 1, 1).data;
  // Alpha uniformity check is cheap; treat RGBA with constant alpha as 3 channels
  return px.length === 4 ? 3 : 3; // decoded canvases are RGBA; MRI content is luma
}

export interface ExtractionResult {
  images: ExtractedImage[];
  grid: GridDetection;
  analysisWidth: number;
  analysisHeight: number;
}

/**
 * Detect panels and extract them at FULL resolution.
 * `forceGrid` (from manual correction) overrides automatic detection.
 */
export async function extractPanels(
  dataUrl: string,
  forceGrid?: { rows: number; cols: number },
): Promise<ExtractionResult> {
  const img = await loadImageElement(dataUrl);

  // Analysis copy (max 1024 on the long side)
  const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  const aw = Math.max(1, Math.round(img.naturalWidth * scale));
  const ah = Math.max(1, Math.round(img.naturalHeight * scale));
  const analysisCanvas = drawToCanvas(img, aw, ah);
  const gray = toGray(analysisCanvas);

  const detection = detectGrid(gray);
  let grid = detection;

  // Manual override: even grid over the full image
  if (forceGrid) {
    const { rows, cols } = forceGrid;
    const cutsX: number[] = [];
    const cutsY: number[] = [];
    for (let c = 1; c < cols; c++) cutsX.push(Math.round((aw * c) / cols));
    for (let r = 1; r < rows; r++) cutsY.push(Math.round((ah * r) / rows));
    const panels: GridDetection["panels"] = [];
    const xs = [0, ...cutsX, aw];
    const ys = [0, ...cutsY, ah];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        panels.push({ x: xs[c], y: ys[r], w: xs[c + 1] - xs[c], h: ys[r + 1] - ys[r] });
      }
    }
    grid = { rows, cols, cutsX, cutsY, confidence: "high", method: "whitespace-projection", panels };
  }

  const fullCanvas = drawToCanvas(img); // ORIGINAL resolution
  const channels = countChannels(fullCanvas);
  const images: ExtractedImage[] = [];

  for (let i = 0; i < grid.panels.length; i++) {
    const p = grid.panels[i];
    // Map analysis-scale rect back to original pixels
    const sx = Math.round(p.x / scale);
    const sy = Math.round(p.y / scale);
    const sw = Math.round(p.w / scale);
    const sh = Math.round(p.h / scale);
    if (sw < 16 || sh < 16) continue; // skip degenerate slivers

    const crop = document.createElement("canvas");
    crop.width = sw;
    crop.height = sh;
    crop.getContext("2d")!.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const row = Math.floor(i / grid.cols);
    const col = i % grid.cols;
    images.push({
      id: `img-${i}`,
      dataUrl: await canvasToPngDataUrl(crop),
      width: sw,
      height: sh,
      channels,
      source:
        grid.panels.length === 1
          ? { type: "single-file" }
          : { type: "composite-panel", panelIndex: i, row, col },
    });
  }

  return { images, grid, analysisWidth: aw, analysisHeight: ah };
}

/** Draw detected panel boundaries over the original image for review. */
export async function renderPanelOverlay(
  dataUrl: string,
  panels: { x: number; y: number; w: number; h: number }[],
): Promise<string> {
  const img = await loadImageElement(dataUrl);
  const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = drawToCanvas(img, w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "#008C95";
  ctx.lineWidth = Math.max(2, Math.round(w / 400));
  ctx.font = `${Math.max(12, Math.round(w / 60))}px sans-serif`;
  ctx.fillStyle = "#008C95";
  panels.forEach((p, i) => {
    ctx.strokeRect(p.x, p.y, p.w, p.h);
    ctx.fillText(`#${i}`, p.x + 6, p.y + 20);
  });
  return canvas.toDataURL("image/png");
}
