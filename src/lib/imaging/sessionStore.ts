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
}

let session: SessionData | null = null;

export function setSession(data: Omit<SessionData, "analyses"> & { analyses?: Map<string, ImageAnalysis> }) {
  session = { analyses: new Map(), ...data };
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
