/**
 * Session store — keeps extracted images and their analyses in memory only.
 *
 * Pixel data never leaves the browser (privacy requirement), so Convex stores
 * the *records* while this module holds the actual images during a session.
 */

import type { ExtractedImage, ImageAnalysis } from "./types";

interface SessionData {
  file: File;
  images: ExtractedImage[];
  analyses: Map<string, ImageAnalysis>;
  modelName: string;
  formulaVersion: string;
  /**
   * True once the user confirmed the grid layout (or the file is a single
   * image / medical volume that needs no grid confirmation). Analysis pages
   * must refuse to run while this is false for composite uploads.
   */
  gridConfirmed: boolean;
  /** One-line description of the layout that produced `images`. */
  gridInfo: string | null;
}

let session: SessionData | null = null;

export function setSession(
  data: Omit<SessionData, "analyses" | "gridConfirmed" | "gridInfo"> & {
    analyses?: Map<string, ImageAnalysis>;
    gridConfirmed?: boolean;
    gridInfo?: string | null;
  },
) {
  session = {
    analyses: new Map(),
    gridConfirmed: false,
    gridInfo: null,
    ...data,
  };
}

export function confirmGrid(confirmed = true) {
  if (session) {
    session.gridConfirmed = confirmed;
  }
}

export function isGridConfirmed(): boolean {
  return session?.gridConfirmed ?? false;
}

export function getSession(): SessionData | null {
  return session;
}

export function clearSession() {
  session = null;
}

export function setAnalyses(analyses: Map<string, ImageAnalysis>) {
  if (session) session.analyses = analyses;
}

export function getAnalysis(imageId: string): ImageAnalysis | null {
  return session?.analyses.get(imageId) ?? null;
}

export function getImage(imageId: string): ExtractedImage | null {
  return session?.images.find((im) => im.id === imageId) ?? null;
}
