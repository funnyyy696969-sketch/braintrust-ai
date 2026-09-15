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
import {
  summarizeGroup,
  validateAnalysisBinding,
} from "../analysisPipeline";
import {
  buildUniformGrid,
  validateGridInput,
  MAX_GRID_DIM,
} from "../compositeDetection";
import type { ExtractedImage, ImageAnalysis } from "../types";

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

describe("group summary", () => {

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

// ---------------------------------------------------------------------------
// M×N grid layout support (1×1 … 6×6 and beyond, any M×N up to MAX_GRID_DIM)
// ---------------------------------------------------------------------------

describe("M×N grid layouts", () => {
  const LAYOUTS: [number, number, number][] = [
    // [rows, cols, expected panel count]
    [1, 1, 1],
    [2, 2, 4],
    [2, 3, 6],
    [3, 2, 6],
    [3, 3, 9],
    [4, 4, 16],
    [5, 5, 25],
    [6, 6, 36],
  ];

  it.each(LAYOUTS)(
    "%i×%i produces exactly %i panels in reading order",
    (rows, cols, count) => {
      const grid = buildUniformGrid(2048, 1536, rows, cols);
      expect(grid.panels).toHaveLength(count);
      expect(grid.rows).toBe(rows);
      expect(grid.cols).toBe(cols);
      expect(grid.confirmed).toBe(true);

      // Reading order: top-left → bottom-right, indices 0..count-1
      grid.panels.forEach((p, i) => {
        expect(p.index).toBe(i);
        expect(p.row).toBe(Math.floor(i / cols));
        expect(p.col).toBe(i % cols);
      });

      // Rects tile the image exactly, no gaps or overlaps
      const totalArea = grid.panels.reduce((s, p) => s + p.w * p.h, 0);
      expect(totalArea).toBe(2048 * 1536);
      expect(grid.panels[0].x).toBe(0);
      expect(grid.panels[0].y).toBe(0);
      const last = grid.panels[grid.panels.length - 1];
      expect(last.x + last.w).toBe(2048);
      expect(last.y + last.h).toBe(1536);
    },
  );

  it("produces unique panel rects (no shared coordinates)", () => {
    const grid = buildUniformGrid(1024, 1024, 3, 3);
    const keys = grid.panels.map((p) => `${p.x},${p.y},${p.w},${p.h}`);
    expect(new Set(keys).size).toBe(9);
  });

  it("rejects invalid layouts with clear errors", () => {
    expect(validateGridInput(0, 3)).toMatchInlineSnapshot(
      `"Rows and columns must each be at least 1."`,
    );
    expect(validateGridInput(3, 0)).toMatchInlineSnapshot(
      `"Rows and columns must each be at least 1."`,
    );
    expect(validateGridInput(1.5, 3)).toMatchInlineSnapshot(
      `"Rows and columns must be whole numbers."`,
    );
    expect(validateGridInput(MAX_GRID_DIM + 1, 3)).toMatchInlineSnapshot(
      `"Layouts above 12×12 are not supported (got 13×3)."`,
    );
    expect(validateGridInput(3, 3)).toBeNull();
  });

  it("throws on invalid buildUniformGrid input", () => {
    expect(() => buildUniformGrid(100, 100, 0, 3)).toThrow();
    expect(() => buildUniformGrid(100, 100, 50, 50)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Result binding: heatmap / prediction / OFI_res must stay with their image
// ---------------------------------------------------------------------------

function mkImage(id: string): ExtractedImage {
  return {
    id,
    dataUrl: "data:image/png;base64,x",
    width: 512,
    height: 512,
    channels: 3,
    source: { type: "composite-panel", panelIndex: 0, row: 0, col: 0 },
  };
}

function mkBoundAnalysis(imageId: string): ImageAnalysis {
  return {
    ...mkAnalysis(imageId, "done", 0.3),
    heatmap: {
      dataUrl: "data:image/png;base64,x",
      activations: Array.from({ length: 14 }, () => Array.from({ length: 14 }, () => 0.5)),
      targetClass: "Glioma",
    },
    saliency: {
      dataUrl: "data:image/png;base64,x",
      coverage: 0.1,
      bbox: { x: 10, y: 10, w: 40, h: 40 },
    },
  };
}

describe("analysis binding integrity", () => {
  it("accepts a correctly bound result", () => {
    const image = mkImage("img-3");
    expect(() => validateAnalysisBinding(image, mkBoundAnalysis("img-3"))).not.toThrow();
  });

  it("rejects a heatmap copied from another image", () => {
    const image = mkImage("img-4");
    expect(() => validateAnalysisBinding(image, mkBoundAnalysis("img-2"))).toThrow(
      /Result mapping mismatch/,
    );
  });

  it("rejects heatmap/target-class mismatch", () => {
    const image = mkImage("img-0");
    const a = mkBoundAnalysis("img-0");
    a.heatmap!.targetClass = "Meningioma";
    expect(() => validateAnalysisBinding(image, a)).toThrow(/Heatmap\/target-class mismatch/);
  });

  it("rejects empty heatmap activations", () => {
    const image = mkImage("img-0");
    const a = mkBoundAnalysis("img-0");
    a.heatmap!.activations = [];
    expect(() => validateAnalysisBinding(image, a)).toThrow(/Empty heatmap/);
  });

  it("rejects out-of-bounds saliency boxes", () => {
    const image = mkImage("img-0");
    const a = mkBoundAnalysis("img-0");
    a.saliency!.bbox = { x: 200, y: 200, w: 100, h: 100 };
    expect(() => validateAnalysisBinding(image, a)).toThrow(/out of bounds/);
  });

  it("rejects OFI_res computed with the wrong formula version", () => {
    const image = mkImage("img-0");
    const a = mkBoundAnalysis("img-0");
    a.ofi = { value: 0.2, confidenceChange: 0.15, formulaVersion: "OFI_res-v0.9-bogus" };
    expect(() => validateAnalysisBinding(image, a)).toThrow(/formula version mismatch/);
  });

  it("keeps per-image OFI values independent across images", () => {
    // Simulate the pipeline contract: two images analyzed in one batch must
    // never share an OFI record. Verify keying by image ID stays disjoint.
    const analyses = new Map<string, ImageAnalysis>([
      ["img-0", mkBoundAnalysis("img-0")],
      ["img-1", mkBoundAnalysis("img-1")],
    ]);
    analyses.get("img-0")!.ofi = {
      value: 0.1,
      confidenceChange: 0.05,
      formulaVersion: OFI_FORMULA_VERSION,
    };
    analyses.get("img-1")!.ofi = {
      value: 0.9,
      confidenceChange: 0.8,
      formulaVersion: OFI_FORMULA_VERSION,
    };
    expect(analyses.get("img-0")!.ofi!.value).toBeCloseTo(0.1);
    expect(analyses.get("img-1")!.ofi!.value).toBeCloseTo(0.9);
    for (const [id, a] of analyses) {
      expect(a.imageId).toBe(id); // map key ↔ record identity
      const image = mkImage(id);
      expect(() => validateAnalysisBinding(image, a)).not.toThrow();
    }
  });
});
