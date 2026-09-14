/**
 * Preprocessing — the exact steps the (demo) classifier expects, applied
 * independently to every extracted image. Original images are never modified;
 * processed copies are new canvases.
 */

import type { ExtractedImage } from "../imaging/types";
import { loadImageElement } from "../imaging/compositeDetection";

export const MODEL_INPUT_SIZE = 224;

export interface PreprocessResult {
  /** Float32 tensor [1, 1, 224, 224], normalised. */
  tensor: Float32Array;
  /** 224×224 grayscale PNG preview of what the model actually sees. */
  previewDataUrl: string;
  normalisation: string;
}

export async function preprocessImage(image: ExtractedImage): Promise<PreprocessResult> {
  const img = await loadImageElement(image.dataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = MODEL_INPUT_SIZE;
  canvas.height = MODEL_INPUT_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

  const px = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE).data;
  const tensor = new Float32Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
  for (let i = 0; i < tensor.length; i++) {
    const luma = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
    // Single-channel ImageNet-style normalisation
    tensor[i] = (luma - 0.449) / 0.226;
  }

  return {
    tensor,
    previewDataUrl: canvas.toDataURL("image/png"),
    normalisation: `Luma → ${MODEL_INPUT_SIZE}×${MODEL_INPUT_SIZE} bilinear → (x − 0.449) / 0.226`,
  };
}
