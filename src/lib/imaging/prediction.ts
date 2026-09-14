/**
 * Prediction service — demo-mode classifier.
 *
 * IMPORTANT: no real trained checkpoint runs in the browser build. To stay
 * honest (per the project's reliability requirements), this module:
 *  - derives a DETERMINISTIC score from the image's actual pixel statistics
 *    (mean, variance, skew, and quadrant intensity), so identical inputs give
 *    identical outputs and different images give different outputs — no RNG;
 *  - is always labelled "Demo (pixel-statistics surrogate)" in the UI.
 *
 * A real checkpoint can be swapped in behind the same interface: the input is
 * a normalised Float32Array and the output is a probability distribution.
 */

import { CLASS_LABELS } from "../imaging/types";
import type { ClassLabel, PredictionResult } from "../imaging/types";

export const MODEL_NAME = "demo-pixel-stats-v1";

/** Feature extractor over the normalised 224×224 single-channel tensor. */
function extractFeatures(tensor: Float32Array): number[] {
  const n = tensor.length;
  const size = Math.sqrt(n);

  let sum = 0;
  let sumSq = 0;
  let sumCube = 0;
  let min = Infinity;
  let max = -Infinity;
  const quadrantMeans = [0, 0, 0, 0];
  const quadrantCounts = [0, 0, 0, 0];
  const mid = size / 2;

  for (let i = 0; i < n; i++) {
    const v = tensor[i];
    sum += v;
    sumSq += v * v;
    sumCube += v * v * v;
    if (v < min) min = v;
    if (v > max) max = v;

    const x = i % size;
    const y = Math.floor(i / size);
    const q = (y < mid ? 0 : 2) + (x < mid ? 0 : 1);
    quadrantMeans[q] += v;
    quadrantCounts[q]++;
  }

  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const skew = sumCube / n - 3 * mean * variance - mean ** 3;
  const norm = Math.sqrt(variance) || 1;

  return [
    mean / norm,                        // normalised brightness
    variance / (norm * norm),           // normalised contrast
    skew / (norm * norm * norm),        // normalised asymmetry
    (max - min) / norm,                 // dynamic range
    ...quadrantMeans.map((s, i) => s / quadrantCounts[i] / norm), // regional balance
  ];
}

/** Deterministic mix of features into 4 class scores (softmax-ed). */
function scoreFeatures(features: number[]): PredictionResult {
  // Fixed weight matrix (4 classes × 8 features), chosen by hand — NOT trained.
  const W = [
    // glioma: prefers bright, high-contrast, asymmetric (left-dominant) texture
    [1.6, 1.1, 0.9, 0.4, 0.7, 0.2, -0.6, 0.1],
    // meningioma: prefers mid-brightness, smooth, peripheral (edge-heavy)
    [0.5, 0.4, -0.3, 1.2, -0.5, 0.6, 0.8, 0.5],
    // no tumor: prefers lower variance, symmetric quadrants
    [0.3, -0.8, -0.6, 0.2, 0.1, 0.0, 0.2, -0.4],
    // pituitary: prefers central-dominant bright compact regions
    [-0.2, 0.6, 0.3, -0.4, 0.9, 0.9, -0.3, 1.3],
  ];
  const bias = [0.15, 0.05, -0.1, 0.0];

  const logits = W.map((row, k) => row.reduce((acc, w, j) => acc + w * features[j], bias[k]));
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxLogit));
  const sum = exps.reduce((a, b) => a + b, 0);

  const probabilities = {} as Record<ClassLabel, number>;
  CLASS_LABELS.forEach((cls, k) => {
    probabilities[cls] = exps[k] / sum;
  });
  const predictedClass = CLASS_LABELS[logits.indexOf(maxLogit)];

  return { predictedClass, confidence: probabilities[predictedClass], probabilities };
}

export function predict(tensor: Float32Array): PredictionResult {
  return scoreFeatures(extractFeatures(tensor));
}
