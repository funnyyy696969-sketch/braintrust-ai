/**
 * Extraction orchestrator: routes a file to the correct extractor based on its
 * inspection report, and normalises results (IDs, ordering, dedup).
 */

import type { ExtractedImage, FileInspectionReport } from "./types";
import { extractPanels } from "./compositeDetection";
import {
  extractDicomFrames,
  extractNiftiSlices,
  extractTiffPages,
  extractZipEntries,
} from "./sliceExtraction";

export interface ExtractOptions {
  /** Manual grid override for composites, e.g. { rows: 2, cols: 2 }. */
  forceGrid?: { rows: number; cols: number };
  /** Preferred NIfTI slice axis. */
  niftiAxis?: "axial" | "coronal" | "sagittal";
  /** Cap on slices/frames per file (memory safety). */
  maxSlices?: number;
}

export async function extractAll(
  file: File,
  report: FileInspectionReport,
  options: ExtractOptions = {},
): Promise<ExtractedImage[]> {
  const dataUrl = await blobToDataUrl(file);

  switch (report.kind) {
    case "png":
    case "jpeg": {
      const { images } = await extractPanels(dataUrl, options.forceGrid);
      return images;
    }
    case "tiff":
      return extractTiffPages(file, report);
    case "dicom":
      return extractDicomFrames(file, report);
    case "nifti":
      return extractNiftiSlices(file, report, {
        axis: options.niftiAxis,
        maxSlices: options.maxSlices,
      });
    case "zip":
      return extractZipEntries(file, report);
    default:
      throw new Error(
        report.statusMessage || "This file type cannot be processed in the browser build.",
      );
  }
}

export function blobToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
