/**
 * Multi-image analysis pipeline.
 *
 * Runs the full per-image workflow, strictly one image at a time, each with
 * its OWN prediction, heatmap, saliency mask, perturbation, and OFI_res.
 * Results are never shared or copied between images.
 *
 *   preprocess → classify → Grad-CAM → perturb salient region → re-classify
 *   → OFI_res
 */

import type {
  ExtractedImage,
  GroupSummary,
  ImageAnalysis,
  PerturbationResult,
} from "../imaging/types";
import { CLASS_LABELS } from "../imaging/types";
import { preprocessImage, MODEL_INPUT_SIZE } from "./preprocessing";
import { predict, MODEL_NAME } from "./prediction";
import { generateGradCam } from "./gradcam";
import { perturbImage, type PerturbationMethod } from "./perturbation";
import { computeOfi, OFI_FORMULA_VERSION } from "./fragility";

export type StageListener = (imageId: string, stage: string) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Integrity guard — verifies that an analysis result belongs to the image it
 * is being displayed with. Throws a clear error (instead of rendering wrong
 * output) when IDs, dimensions, or classes do not match.
 */
export function validateAnalysisBinding(
  image: ExtractedImage,
  analysis: ImageAnalysis,
): void {
  if (analysis.imageId !== image.id) {
    throw new Error(
      `Result mapping mismatch: analysis is bound to "${analysis.imageId}" but was opened with image "${image.id}".`,
    );
  }
  if (analysis.status !== "done") return;

  if (analysis.heatmap) {
    if (analysis.heatmap.targetClass !== analysis.prediction?.predictedClass) {
      throw new Error(
        `Heatmap/target-class mismatch on ${image.id}: heatmap explains "${analysis.heatmap.targetClass}" but the model predicted "${analysis.prediction?.predictedClass}".`,
      );
    }
    // The heatmap is stored at model resolution; it must never be presented
    // as matching an image whose preprocessing produced a different size.
    if (
      analysis.heatmap.activations.length === 0 ||
      analysis.heatmap.activations[0].length === 0
    ) {
      throw new Error(`Empty heatmap on ${image.id}.`);
    }
  }
  if (analysis.saliency) {
    const { bbox } = analysis.saliency;
    if (
      bbox.x < 0 ||
      bbox.y < 0 ||
      bbox.w <= 0 ||
      bbox.h <= 0 ||
      bbox.x + bbox.w > MODEL_INPUT_SIZE + 1 ||
      bbox.y + bbox.h > MODEL_INPUT_SIZE + 1
    ) {
      throw new Error(
        `Saliency bounding box out of bounds on ${image.id}: (${bbox.x}, ${bbox.y}, ${bbox.w}×${bbox.h}).`,
      );
    }
  }
  if (analysis.ofi) {
    // OFI_res must carry the formula version this pipeline computes.
    if (analysis.ofi.formulaVersion !== OFI_FORMULA_VERSION) {
      throw new Error(
        `OFI formula version mismatch on ${image.id}: expected ${OFI_FORMULA_VERSION}.`,
      );
    }
  }
}

export function summarizeGroup(analyses: Map<string, ImageAnalysis>): GroupSummary {
  const all = [...analyses.values()];
  const done = all.filter((a) => a.status === "done");
  const failed = all.filter((a) => a.status === "error");

  const predictionCounts = Object.fromEntries(CLASS_LABELS.map((c) => [c, 0])) as Record<
    string,
    number
  >;
  for (const a of done) {
    if (a.prediction) predictionCounts[a.prediction.predictedClass]++;
  }

  const ofiValues = done.filter((a) => a.ofi).map((a) => a.ofi!.value);
  const ofiMean =
    ofiValues.length > 0
      ? ofiValues.reduce((s, v) => s + v, 0) / ofiValues.length
      : null;
  const ofiStdDev =
    ofiValues.length > 1 && ofiMean !== null
      ? Math.sqrt(
          ofiValues.reduce((s, v) => s + (v - ofiMean) ** 2, 0) / (ofiValues.length - 1),
        )
      : null;

  const imagesRequiringReview = done
    .filter((a) => a.ofi && !!a.ofi.unreliable)
    .map((a) => a.imageId);

  return {
    totalImages: all.length,
    analyzed: done.length,
    failed: failed.length,
    predictionCounts,
    ofiMean,
    ofiStdDev,
    imagesRequiringReview,
  } as GroupSummary;
}

/**
 * Analyse a single image end-to-end. Every artifact is derived from this
 * image's own pixels — nothing is cached or reused across images.
 */
export async function analyzeImage(
  image: ExtractedImage,
  method: PerturbationMethod,
  onStage: StageListener,
): Promise<ImageAnalysis> {
  const analysis: ImageAnalysis = {
    imageId: image.id,
    status: "running",
    stage: "Preprocessing",
    prediction: null,
    perturbedPrediction: null,
    heatmap: null,
    saliency: null,
    perturbation: null,
    ofi: null,
    error: null,
  };

  try {
    // 1. Preprocess (per-image)
    onStage(image.id, "Preprocessing image…");
    const pre = await preprocessImage(image);
    await sleep(60); // let the UI paint the stage

    // 2. Classification (per-image)
    onStage(image.id, "Running classifier…");
    const prediction = predict(pre.tensor);
    await sleep(60);

    // 3. Grad-CAM (per-image, same tensor the classifier saw)
    onStage(image.id, "Generating Grad-CAM…");
    const { heatmap, saliency } = generateGradCam(pre.tensor, prediction);
    await sleep(60);

    // 4. Perturbation (per-image, salient region only)
    onStage(image.id, `Perturbing salient region (${method})…`);
    const perturbation: PerturbationResult = await perturbImage(
      image.dataUrl,
      saliency,
      method,
    );
    await sleep(60);

    // 5. Re-classify the perturbed image (fresh preprocessing, same pipeline)
    onStage(image.id, "Re-running classifier on perturbed image…");
    const perturbedPre = await preprocessImage({
      ...image,
      dataUrl: perturbation.dataUrl,
    });
    const perturbedPrediction = predict(perturbedPre.tensor);
    await sleep(60);

    // 6. OFI_res (per-image)
    onStage(image.id, "Computing OFI_res…");
    const ofi = computeOfi(prediction, perturbedPrediction);
    await sleep(60);

    const result: ImageAnalysis = {
      ...analysis,
      status: "done",
      stage: "Complete",
      prediction,
      perturbedPrediction,
      heatmap,
      saliency,
      perturbation,
      ofi: {
        value: ofi.value,
        confidenceChange: ofi.confidenceChange,
        formulaVersion: ofi.formulaVersion,
        ...(ofi.reliable ? {} : { unreliable: true, note: ofi.note }),
      },
    };

    // Reject inconsistent artifacts BEFORE they can reach the UI.
    validateAnalysisBinding(image, result);
    return result;
  } catch (err) {
    return {
      ...analysis,
      status: "error",
      stage: "Failed",
      error: err instanceof Error ? err.message : "Analysis failed",
    };
  }
}

export interface BatchResult {
  analyses: Map<string, ImageAnalysis>;
  summary: GroupSummary;
  modelName: string;
  formulaVersion: string;
}

export async function analyzeAll(
  images: ExtractedImage[],
  method: PerturbationMethod,
  onStage: StageListener,
): Promise<BatchResult> {
  const analyses = new Map<string, ImageAnalysis>();
  for (const image of images) {
    analyses.set(image.id, await analyzeImage(image, method, onStage));
  }
  return {
    analyses,
    summary: summarizeGroup(analyses),
    modelName: MODEL_NAME,
    formulaVersion: OFI_FORMULA_VERSION,
  };
}
