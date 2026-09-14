/**
 * Shared types for the multi-image MRI analysis pipeline.
 *
 * These types are the contract between:
 *  - file inspection  (what did the user upload?)
 *  - extraction       (what valid images does it contain?)
 *  - analysis         (per-image prediction / Grad-CAM / perturbation / OFI_res)
 *  - persistence      (Convex records)
 */

// ---------------------------------------------------------------------------
// File kinds
// ---------------------------------------------------------------------------

export type FileKind =
  | "png" // ordinary raster image (may be a composite)
  | "jpeg" // ordinary raster image (may be a composite)
  | "tiff" // multi-page TIFF
  | "dicom" // single-frame or multi-frame DICOM
  | "nifti" // .nii / .nii.gz volume (3D or 4D)
  | "zip" // archive of compatible image files
  | "unknown";

export interface FileInspectionReport {
  fileName: string;
  fileSize: number; // bytes
  mimeType: string;
  kind: FileKind;
  /** Human-readable summary of how the file was identified. */
  identificationNote: string;
  /** How many distinct valid images the file contains. */
  imageCount: number;
  /** What those images represent. */
  structure: "single" | "composite" | "slice-stack" | "volume" | "archive" | "invalid";
  /** Width × height of each detected image (after extraction). */
  dimensions: { width: number; height: number }[];
  /** Channels per image (1 = grayscale, 3 = RGB, 4 = RGBA). */
  channels: number[];
  /** Pixel bit depth when known (e.g. DICOM BitsAllocated). */
  bitDepth: number | null;
  /** Series / orientation info when available (DICOM/NIfTI). */
  seriesInfo: string | null;
  /** Slice spacing in mm when available (NIfTI/DICOM). */
  voxelSpacing: { x: number; y: number; z: number } | null;
  /** "ok" | "warning" | "error" — processing status for the report. */
  status: "ok" | "warning" | "error";
  statusMessage: string;
}

// ---------------------------------------------------------------------------
// Panels & slices
// ---------------------------------------------------------------------------

/** A single valid image extracted from an uploaded file. */
export interface ExtractedImage {
  id: string; // unique image ID, e.g. "img-0"
  /** Data URL (PNG) of the extracted image, unresized. */
  dataUrl: string;
  width: number;
  height: number;
  channels: number;
  /** Where this image came from. */
  source:
    | { type: "single-file" }
    | { type: "composite-panel"; panelIndex: number; row: number; col: number }
    | { type: "tiff-page"; page: number }
    | { type: "dicom-frame"; frame: number }
    | { type: "nifti-slice"; axis: "axial" | "coronal" | "sagittal"; index: number }
    | { type: "zip-entry"; entryName: string };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export const CLASS_LABELS = ["Glioma", "Meningioma", "No Tumor", "Pituitary"] as const;
export type ClassLabel = (typeof CLASS_LABELS)[number];

export interface PredictionResult {
  predictedClass: ClassLabel;
  confidence: number; // 0..1
  probabilities: Record<ClassLabel, number>;
}

export interface HeatmapResult {
  /** Data URL of the jet-coloured heatmap, same dimensions as the source image. */
  dataUrl: string;
  /** 32×32 raw activations (source of the heatmap). */
  activations: number[][];
  targetClass: ClassLabel;
}

export interface SaliencyMask {
  /** Binary mask data URL (violet on transparent). */
  dataUrl: string;
  /** Fraction of the image marked salient. */
  coverage: number; // 0..1
  /** Bounding box of the salient region in source pixels. */
  bbox: { x: number; y: number; w: number; h: number };
}

export interface PerturbationResult {
  method: "gaussian-blur" | "pixelate" | "brightness-shift" | "noise-overlay";
  /** Data URL of the perturbed image. */
  dataUrl: string;
  /** Pixel positions (row-major, width known) perturbed, for the audit trail. */
  perturbedPixelCount: number;
}

export interface ImageAnalysis {
  imageId: string;
  status: "pending" | "running" | "done" | "error";
  stage: string;
  prediction: PredictionResult | null;
  perturbedPrediction: PredictionResult | null;
  heatmap: HeatmapResult | null;
  saliency: SaliencyMask | null;
  perturbation: PerturbationResult | null;
  ofi: {
    value: number; // OFI_res per the project formula
    confidenceChange: number; // p_orig(target) − p_perturbed(target)
    formulaVersion: string;
    /** False when the baseline confidence was too low for a stable ratio. */
    unreliable?: boolean;
    note?: string;
  } | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Group-level summary
// ---------------------------------------------------------------------------

export interface GroupSummary {
  totalImages: number;
  analyzed: number;
  failed: number;
  /** Distinct predicted classes across images. */
  predictionCounts: Record<ClassLabel, number>;
  /** Mean and sample standard deviation of per-image OFI_res. */
  ofiMean: number | null;
  ofiStdDev: number | null;
  /** Images whose OFI_res could not be computed reliably. */
  imagesRequiringReview: string[];
}
