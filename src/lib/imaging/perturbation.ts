/**
 * Perturbation service — realistic, salient-region-only perturbations.
 *
 * Only pixels inside the Grad-CAM saliency mask are modified; the rest of the
 * image stays untouched. This is what makes the OFI_res measurement meaningful:
 * the model's attention region is disturbed, nothing else.
 */

import type { PerturbationResult, SaliencyMask } from "../imaging/types";
import { loadImageElement } from "../imaging/compositeDetection";

export type PerturbationMethod =
  | "gaussian-blur"
  | "pixelate"
  | "brightness-shift"
  | "noise-overlay";

export const PERTURBATION_METHODS: {
  id: PerturbationMethod;
  label: string;
  description: string;
}[] = [
  {
    id: "gaussian-blur",
    label: "Gaussian blur",
    description: "Softens the salient region — simulates focus loss or motion.",
  },
  {
    id: "pixelate",
    label: "Pixelation",
    description: "Downsamples the salient region — simulates low-resolution acquisition.",
  },
  {
    id: "brightness-shift",
    label: "Brightness shift",
    description: "Darkens the salient region — simulates acquisition gain change.",
  },
  {
    id: "noise-overlay",
    label: "Noise overlay",
    description: "Adds Gaussian noise — simulates scanner noise.",
  },
];

const BLUR_RADIUS = 10; // px, on the image being perturbed
const NOISE_SIGMA = 0.18; // fraction of full scale
const ALPHA_THRESHOLD = 0.05; // a pixel counts as "perturbed" above this mask alpha

export async function perturbImage(
  imageDataUrl: string,
  saliency: SaliencyMask,
  method: PerturbationMethod,
): Promise<PerturbationResult> {
  const img = await loadImageElement(imageDataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  // 1. Original pixels
  const base = document.createElement("canvas");
  base.width = w;
  base.height = h;
  const ctx = base.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const orig = ctx.getImageData(0, 0, w, h);

  // 2. Whole-image effect (we will only sample it inside the mask)
  const effect = document.createElement("canvas");
  effect.width = w;
  effect.height = h;
  const ectx = effect.getContext("2d", { willReadFrequently: true })!;
  ectx.drawImage(img, 0, 0);

  if (method === "gaussian-blur") {
    ectx.filter = `blur(${BLUR_RADIUS}px)`;
    ectx.drawImage(img, 0, 0);
    ectx.filter = "none";
  } else if (method === "pixelate") {
    const block = 12;
    const sw = Math.max(1, Math.floor(w / block));
    const sh = Math.max(1, Math.floor(h / block));
    const tmp = document.createElement("canvas");
    tmp.width = sw;
    tmp.height = sh;
    tmp.getContext("2d")!.drawImage(img, 0, 0, sw, sh);
    ectx.imageSmoothingEnabled = false;
    ectx.drawImage(tmp, 0, 0, sw, sh, 0, 0, w, h);
  } else if (method === "brightness-shift") {
    ectx.fillStyle = "rgba(0,0,0,0.28)";
    ectx.fillRect(0, 0, w, h);
  } else {
    // noise-overlay: deterministic pseudo-Gaussian noise (stable per pixel index)
    const id = ectx.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < w * h; i++) {
      const u1 = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const u2 = ((Math.sin(i * 78.233) * 12345.6789) % 1 + 1) % 1;
      const n = Math.sqrt(-2 * Math.log(u1 + 1e-9)) * Math.cos(2 * Math.PI * u2);
      const delta = n * NOISE_SIGMA * 255;
      for (let c = 0; c < 3; c++) {
        d[i * 4 + c] = Math.max(0, Math.min(255, d[i * 4 + c] + delta));
      }
    }
    ectx.putImageData(id, 0, 0);
  }
  const effectData = ectx.getImageData(0, 0, w, h);

  // 3. Feathered saliency mask scaled to this image's dimensions
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mctx = maskCanvas.getContext("2d")!;
  const maskImg = await loadImageElement(saliency.dataUrl);
  mctx.drawImage(maskImg, 0, 0, w, h);
  const feather = document.createElement("canvas");
  feather.width = w;
  feather.height = h;
  const fctx = feather.getContext("2d")!;
  fctx.filter = "blur(3px)";
  fctx.drawImage(maskCanvas, 0, 0);
  const maskData = fctx.getImageData(0, 0, w, h);

  // 4. Alpha-blend original ← effect through the mask
  let perturbedPixelCount = 0;
  for (let i = 0; i < w * h; i++) {
    const alpha = maskData.data[i * 4 + 3] / 255;
    if (alpha <= ALPHA_THRESHOLD) continue;
    perturbedPixelCount++;
    for (let c = 0; c < 3; c++) {
      orig.data[i * 4 + c] =
        orig.data[i * 4 + c] * (1 - alpha) + effectData.data[i * 4 + c] * alpha;
    }
  }
  ctx.putImageData(orig, 0, 0);

  return {
    method,
    dataUrl: base.toDataURL("image/png"),
    perturbedPixelCount,
  };
}
