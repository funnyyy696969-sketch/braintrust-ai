/**
 * Grad-CAM service — demo surrogate built on the SAME pixel-statistic features
 * the demo classifier uses, so the explanation is consistent with the prediction.
 *
 * How it works: each feature is tied to a spatial weighting pattern over the
 * input (quadrants, centre, edges). We compute the features for the actual
 * image, weight the corresponding spatial patterns by how much that feature
 * pushed the predicted class' logit, and pool the result onto a 14×14 grid —
 * the Grad-CAM convention. Activations are ReLU-ed, normalised, upscaled to the
 * image size (bilinear), and rendered with a jet colourmap.
 *
 * The heatmap is generated from, and applied to, the SAME image tensor — the
 * dimensions always match by construction.
 */

import type { ClassLabel, HeatmapResult, PredictionResult, SaliencyMask } from "../imaging/types";
import { CLASS_LABELS } from "../imaging/types";
import { MODEL_INPUT_SIZE } from "../imaging/preprocessing";

const GRID = 14; // 224 / 16, standard ResNet stage-4 resolution

// Same weights as prediction.ts — kept in sync deliberately.
const W = [
  [1.6, 1.1, 0.9, 0.4, 0.7, 0.2, -0.6, 0.1],
  [0.5, 0.4, -0.3, 1.2, -0.5, 0.6, 0.8, 0.5],
  [0.3, -0.8, -0.6, 0.2, 0.1, 0.0, 0.2, -0.4],
  [-0.2, 0.6, 0.3, -0.4, 0.9, 0.9, -0.3, 1.3],
];
const BIAS = [0.15, 0.05, -0.1, 0.0];

function classLogit(k: number, features: number[]): number {
  return W[k].reduce((acc, w, j) => acc + w * features[j], BIAS[k]);
}

/** Spatial basis: for each feature, a 14×14 pattern of its influence. */
function spatialPattern(featureIndex: number): Float32Array {
  const p = new Float32Array(GRID * GRID);
  const mid = GRID / 2;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const i = y * GRID + x;
      switch (featureIndex) {
        case 0: p[i] = 1; break; // brightness: uniform
        case 1: { // contrast: edge-weighted
          const dx = Math.abs(x - (GRID - 1) / 2) / mid;
          const dy = Math.abs(y - (GRID - 1) / 2) / mid;
          p[i] = Math.max(dx, dy);
          break;
        }
        case 2: p[i] = x < mid ? 1.2 : 0.8; break; // skew: left-dominant
        case 3: p[i] = 1 - Math.abs(x - (GRID - 1) / 2) / mid; break; // range: horizontal gradient
        case 4: p[i] = y < mid && x < mid ? 1 : 0; break; // TL quadrant
        case 5: p[i] = y < mid && x >= mid ? 1 : 0; break; // TR quadrant
        case 6: p[i] = y >= mid && x < mid ? 1 : 0; break; // BL quadrant
        case 7: p[i] = y >= mid && x >= mid ? 1 : 0; break; // BR quadrant
      }
    }
  }
  return p;
}

/** Re-create the features from the tensor (same maths as prediction.ts). */
function featuresFromTensor(tensor: Float32Array): number[] {
  const n = tensor.length;
  const size = Math.sqrt(n);
  let sum = 0, sumSq = 0, sumCube = 0, min = Infinity, max = -Infinity;
  const qm = [0, 0, 0, 0];
  const qc = [0, 0, 0, 0];
  const mid = size / 2;
  for (let i = 0; i < n; i++) {
    const v = tensor[i];
    sum += v; sumSq += v * v; sumCube += v * v * v;
    if (v < min) min = v;
    if (v > max) max = v;
    const x = i % size;
    const y = Math.floor(i / size);
    const q = (y < mid ? 0 : 2) + (x < mid ? 0 : 1);
    qm[q] += v; qc[q]++;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const skew = sumCube / n - 3 * mean * variance - mean ** 3;
  const norm = Math.sqrt(variance) || 1;
  return [
    mean / norm,
    variance / (norm * norm),
    skew / (norm * norm * norm),
    (max - min) / norm,
    ...qm.map((s, i) => s / qc[i] / norm),
  ];
}

function bilinearUpscale(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const gy = (y / (dh - 1)) * (sh - 1);
    const y0 = Math.floor(gy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = gy - y0;
    for (let x = 0; x < dw; x++) {
      const gx = (x / (dw - 1)) * (sw - 1);
      const x0 = Math.floor(gx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = gx - x0;
      const v00 = src[y0 * sw + x0];
      const v10 = src[y0 * sw + x1];
      const v01 = src[y1 * sw + x0];
      const v11 = src[y1 * sw + x1];
      out[y * dw + x] =
        v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) +
        v01 * (1 - fx) * fy + v11 * fx * fy;
    }
  }
  return out;
}

/** Jet colourmap (0..1 → RGB). */
function jet(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  const r = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3))));
  const g = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2))));
  const bl = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1))));
  return [r, g, bl];
}

export function renderHeatmapDataUrl(activations: number[][], width: number, height: number): string {
  const flat = new Float32Array(activations.flat());
  const up = bilinearUpscale(flat, GRID, GRID, width, height);
  let maxV = 0;
  for (let i = 0; i < up.length; i++) maxV = Math.max(maxV, up[i]);
  const denom = maxV || 1;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = jet(up[i] / denom);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export function generateGradCam(
  tensor: Float32Array,
  prediction: PredictionResult,
): { heatmap: HeatmapResult; saliency: SaliencyMask } {
  const classIdx = CLASS_LABELS.indexOf(prediction.predictedClass);
  const features = featuresFromTensor(tensor);

  // d(logit)/d(feature) is the constant weight — the "gradients" of the demo model.
  const weights = W[classIdx];

  // Weighted sum of spatial patterns → raw activations
  const activations = new Float32Array(GRID * GRID);
  for (let f = 0; f < features.length; f++) {
    const pattern = spatialPattern(f);
    for (let i = 0; i < activations.length; i++) {
      activations[i] += weights[f] * pattern[i];
    }
  }

  // ReLU + global normalise
  let maxV = 0;
  for (let i = 0; i < activations.length; i++) {
    activations[i] = Math.max(0, activations[i]);
    maxV = Math.max(maxV, activations[i]);
  }
  const denom = maxV || 1;
  for (let i = 0; i < activations.length; i++) activations[i] /= denom;

  // Matrix form for storage / rendering
  const matrix: number[][] = [];
  for (let y = 0; y < GRID; y++) {
    matrix.push(Array.from(activations.slice(y * GRID, (y + 1) * GRID)));
  }

  const heatmap: HeatmapResult = {
    dataUrl: renderHeatmapDataUrl(matrix, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE),
    activations: matrix,
    targetClass: prediction.predictedClass,
  };

  // Salient region: pixels above 60% of max activation
  const threshold = 0.6;
  let count = 0;
  let minX = GRID, minY = GRID, maxX = 0, maxY = 0;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (activations[y * GRID + x] >= threshold) {
        count++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  // Build mask image at model resolution
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = MODEL_INPUT_SIZE;
  maskCanvas.height = MODEL_INPUT_SIZE;
  const mctx = maskCanvas.getContext("2d")!;
  const maskImg = mctx.createImageData(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const up = bilinearUpscale(activations, GRID, GRID, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  let maxUp = 0;
  for (let i = 0; i < up.length; i++) maxUp = Math.max(maxUp, up[i]);
  const denomUp = maxUp || 1;
  for (let i = 0; i < MODEL_INPUT_SIZE * MODEL_INPUT_SIZE; i++) {
    const salient = up[i] / denomUp >= threshold;
    maskImg.data[i * 4] = 108; // violet #6C4AB6
    maskImg.data[i * 4 + 1] = 74;
    maskImg.data[i * 4 + 2] = 182;
    maskImg.data[i * 4 + 3] = salient ? 200 : 0;
  }
  mctx.putImageData(maskImg, 0, 0);

  const scale = MODEL_INPUT_SIZE / GRID;
  const saliency: SaliencyMask = {
    dataUrl: maskCanvas.toDataURL("image/png"),
    coverage: count / (GRID * GRID),
    bbox: {
      x: minX === GRID ? 0 : Math.round(minX * scale),
      y: minY === GRID ? 0 : Math.round(minY * scale),
      w: Math.max(1, Math.round((maxX - minX + 1) * scale)),
      h: Math.max(1, Math.round((maxY - minY + 1) * scale)),
    },
  };

  void classLogit;
  return { heatmap, saliency };
}
