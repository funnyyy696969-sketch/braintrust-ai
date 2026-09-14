// Supabase database removed - using Convex instead
// This file is kept empty to avoid import errors
export interface AnalysisSession {
  id: string;
  user_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  model_name: string | null;
  original_image_url: string | null;
  preprocessed_image_url: string | null;
  prediction: {
    predicted_class: string;
    confidence: number;
    probabilities: Record<string, number>;
  } | null;
  gradcam_result: {
    heatmap_url: string;
    mask_url: string;
    target_class: string;
    overlay_url: string | null;
  } | null;
  perturbed_image_url: string | null;
  perturbation_method: string | null;
  perturbation_status: string | null;
  perturbed_prediction: {
    predicted_class: string;
    confidence: number;
    probabilities: Record<string, number>;
  } | null;
  ofi_result: {
    ofi_value: number;
    confidence_change: number;
    formula_version: string;
  } | null;
  ground_truth_mask_url: string | null;
  rma_result: {
    rma_score: number;
    spatial_metadata: Record<string, string>;
  } | null;
  gam_analysis: {
    summary: string;
    plot_data: string;
    diagnostics: Record<string, string>;
  } | null;
  created_at: string;
  updated_at: string;
}

export async function createAnalysisSession(userId: string, data: Partial<AnalysisSession> = {}): Promise<AnalysisSession | null> {
  return null;
}

export async function getAnalysisSessions(userId: string): Promise<AnalysisSession[]> {
  return [];
}

export async function getAnalysisSession(id: string): Promise<AnalysisSession | null> {
  return null;
}

export async function updateAnalysisSession(id: string, updates: Partial<AnalysisSession>): Promise<AnalysisSession | null> {
  return null;
}
