/**
 * Ridge regression served from coefficients exported by ml/train_benchmark.py.
 * Preprocessing (median imputation + standardisation) parameters were fitted on the training split only.
 */
import type { FeatureVector, PlayerFeatures } from "../features/history";
import type { Prediction } from "./types";

export interface RidgeArtifact {
  modelId: string;
  features: string[];
  medians: number[];
  means: number[];
  scales: number[];
  coef: number[];
  intercept: number;
  /** Residual std by role from validation split, for intervals. */
  residualStdByRole: Record<string, number>;
  trainingCutoff: string;
  target: string;
}

const Z80 = 1.2816;

export function predictRidge(pf: PlayerFeatures, art: RidgeArtifact): Prediction {
  let y = art.intercept;
  const contributions: { name: string; c: number }[] = [];
  art.features.forEach((name, i) => {
    const raw = (pf.features as FeatureVector)[name as keyof FeatureVector];
    const v = raw == null || Number.isNaN(raw) ? art.medians[i] : raw;
    const z = art.scales[i] ? (v - art.means[i]) / art.scales[i] : 0;
    const c = z * art.coef[i];
    y += c;
    contributions.push({ name, c });
  });
  const sigma = art.residualStdByRole[pf.role.role] ?? art.residualStdByRole.ALL ?? 30;
  const top = contributions.sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 3);
  return {
    playerId: pf.playerId,
    modelId: art.modelId,
    mean: Math.round(y * 10) / 10,
    p10: Math.round((y - Z80 * sigma) * 10) / 10,
    p90: Math.round((y + Z80 * sigma) * 10) / 10,
    sigma: Math.round(sigma * 10) / 10,
    sampleSize: pf.priorCount,
    features: pf.features,
    explanation: [
      `Ridge model (${art.target}); largest feature contributions: ${top.map((t) => `${t.name} ${t.c >= 0 ? "+" : ""}${t.c.toFixed(1)}`).join(", ")}.`,
    ],
  };
}
