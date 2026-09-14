import { supabase } from './supabase';

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

export async function createAnalysisSession(
  userId: string,
  data: Partial<AnalysisSession> = {}
): Promise<AnalysisSession | null> {
  const { data: session, error } = await supabase
    .from('analysis_sessions')
    .insert({
      user_id: userId,
      status: 'pending',
      ...data,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating analysis session:', error);
    return null;
  }

  return session as AnalysisSession;
}

export async function getAnalysisSessions(userId: string): Promise<AnalysisSession[]> {
  const { data, error } = await supabase
    .from('analysis_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching analysis sessions:', error);
    return [];
  }

  return data as AnalysisSession[];
}

export async function getAnalysisSession(id: string): Promise<AnalysisSession | null> {
  const { data, error } = await supabase
    .from('analysis_sessions')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching analysis session:', error);
    return null;
  }

  return data as AnalysisSession;
}

export async function updateAnalysisSession(
  id: string,
  updates: Partial<AnalysisSession>
): Promise<AnalysisSession | null> {
  const { data, error } = await supabase
    .from('analysis_sessions')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating analysis session:', error);
    return null;
  }

  return data as AnalysisSession;
}
