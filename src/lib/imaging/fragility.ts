/**
 * OFI_res — Output Fragility Index (resolution-consistent variant).
 *
 * Formula (v1, project-defined — NOT a clinically validated standard):
 *
 *   OFI_res = ( p_orig(target) − p_perturbed(target) ) / ( p_orig(target) + ε )
 *
 * where:
 *   p_orig(target)      = model confidence in the target class on the clean image
 *   p_perturbed(target) = same, after salient-region perturbation
 *   target              = the class the model predicted on the clean image
 *   ε = 1e-8            = numerical floor so p_orig = 0 never divides by zero
 *
 * Interpretation:
 *   OFI_res ≈ 0   → prediction robust under salient-region perturbation
 *   OFI_res ≈ 1   → confidence in the target class fully collapsed
 *   OFI_res > 1   → confidence not only collapsed but flipped to other classes
 *
 * Reliability guard: when p_orig(target) < 0.35 the denominator is small and
 * the ratio becomes unstable — the result is flagged `unreliable` rather than
 * silently reported.
 */

import type { PredictionResult } from "../imaging/types";

export const OFI_FORMULA_VERSION = "OFI_res-v1.0";
export const OFI_RELIABILITY_THRESHOLD = 0.35;
const EPSILON = 1e-8;

export interface OfiComputation {
  value: number;
  confidenceChange: number; // p_orig(target) − p_pert(target)
  formulaVersion: string;
  reliable: boolean;
  note: string;
}

export function computeOfi(
  original: PredictionResult,
  perturbed: PredictionResult,
): OfiComputation {
  const target = original.predictedClass;
  const pOrig = original.probabilities[target];
  const pPert = perturbed.probabilities[target];
  const confidenceChange = pOrig - pPert;

  const value = confidenceChange / (pOrig + EPSILON);

  const reliable = pOrig >= OFI_RELIABILITY_THRESHOLD;
  const note = reliable
    ? "Computed per OFI_res-v1.0 with sufficient baseline confidence."
    : `Baseline confidence ${(pOrig * 100).toFixed(1)}% is below the ${(OFI_RELIABILITY_THRESHOLD * 100).toFixed(0)}% reliability floor for the denominator — treat this value with caution.`;

  return {
    value,
    confidenceChange,
    formulaVersion: OFI_FORMULA_VERSION,
    reliable,
    note,
  };
}
