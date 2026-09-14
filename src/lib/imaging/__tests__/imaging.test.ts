/**
 * Browser-side pipeline tests (vitest-compatible specifications).
 *
 * These document and verify the core invariants that must hold regardless of
 * whether analysis runs in the browser or on the desktop backend:
 *   - deterministic prediction for identical input
 *   - OFI_res formula behaviour (0 = robust, 1 = collapse)
 *   - group summary aggregation correctness
 */

import { describe, expect, it } from "vitest";
import { computeOfi, OFI_FORMULA_VERSION } from "../fragility";
import { predict } from "../prediction";
import { summarizeGroup } from "../analysisPipeline";
import type { ImageAnalysis } from "../types";

const TENSOR_SIZE = 224 * 224;

function fakeTensor(seed: number): Float32Array {
  const t = new Float32Array(TENSOR_SIZE);
  for (let i = 0; i < t.length; i++) {
    t[i] = Math.sin(seed + i * 0.001);
  }
  return t;
}

describe("prediction (demo surrogate)", () => {
  it("is deterministic for identical input", () => {
    const a = predict(fakeTensor(1));
    const b = predict(fakeTensor(1));
    expect(a).toEqual(b);
  });

  it("produces a valid probability distribution", () => {
    const p = predict(fakeTensor(2));
    const sum = Object.values(p.probabilities).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(p.probabilities[p.predictedClass]).toBeCloseTo(p.confidence, 10);
  });

  it("differs between different inputs", () => {
    const a = predict(fakeTensor(1));
    const b = predict(fakeTensor(99));
    expect(a.probabilities).not.toEqual(b.probabilities);
  });
});

describe("OFI_res", () => {
  it("is 0 when nothing changed", () => {
    const p = predict(fakeTensor(1));
    const ofi = computeOfi(p, p);
    expect(ofi.value).toBeCloseTo(0, 6);
  });

  it("is ~1 on full confidence collapse", () => {
    const orig = { predictedClass: "Glioma" as const, confidence: 0.9, probabilities: { Glioma: 0.9, Meningioma: 0.04, "No Tumor": 0.03, Pituitary: 0.03 } };
    const pert = { predictedClass: "Meningioma" as const, confidence: 0.5, probabilities: { Glioma: 0.0, Meningioma: 0.5, "No Tumor": 0.25, Pituitary: 0.25 } };
    const ofi = computeOfi(orig, pert);
    expect(ofi.value).toBeCloseTo(1.0, 3);
  });

  it("flags low-baseline results as unreliable", () => {
    const orig = { predictedClass: "Glioma" as const, confidence: 0.2, probabilities: { Glioma: 0.2, Meningioma: 0.3, "No Tumor": 0.3, Pituitary: 0.2 } };
    const pert = { predictedClass: "Glioma" as const, confidence: 0.05, probabilities: { Glioma: 0.05, Meningioma: 0.35, "No Tumor": 0.35, Pituitary: 0.25 } };
    const ofi = computeOfi(orig, pert);
    expect(ofi.reliable).toBe(false);
  });

  it("reports its formula version", () => {
    const p = predict(fakeTensor(1));
    expect(computeOfi(p, p).formulaVersion).toBe(OFI_FORMULA_VERSION);
  });
});

describe("group summary", () => {
  const mkAnalysis = (id: string, status: ImageAnalysis["status"], ofi: number | null): ImageAnalysis => ({
    imageId: id,
    status,
    stage: status === "done" ? "Complete" : "Failed",
    prediction: status === "done" ? { predictedClass: "Glioma", confidence: 0.9, probabilities: { Glioma: 0.9, Meningioma: 0.04, "No Tumor": 0.03, Pituitary: 0.03 } } : null,
    perturbedPrediction: null,
    heatmap: null,
    saliency: null,
    perturbation: null,
    ofi: ofi === null ? null : { value: ofi, confidenceChange: ofi * 0.9, formulaVersion: OFI_FORMULA_VERSION },
    error: status === "error" ? "boom" : null,
  });

  it("aggregates means and counts without touching per-image values", () => {
    const m = new Map<string, ImageAnalysis>([
      ["img-0", mkAnalysis("img-0", "done", 0.2)],
      ["img-1", mkAnalysis("img-1", "done", 0.8)],
      ["img-2", mkAnalysis("img-2", "error", null)],
    ]);
    const s = summarizeGroup(m);
    expect(s.totalImages).toBe(3);
    expect(s.analyzed).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.ofiMean).toBeCloseTo(0.5, 6);
  });
});
