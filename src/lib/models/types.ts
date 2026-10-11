import type { Competition } from "../data/types";
import type { FeatureVector } from "../features/history";

export type ModelStatus = "active" | "candidate" | "retired" | "benchmark_only";

export interface ModelMetrics {
  split: string;
  n: number;
  mae: number;
  rmse: number;
  bias: number;
  r2: number | null;
  spearman: number | null;
  intervalCoverage80?: number | null;
}

export interface ModelVersion {
  id: string;
  name: string;
  kind: "recency_baseline" | "ridge" | "weighted_criteria" | "random_forest" | "hist_gradient_boosting" | "train_mean";
  competition: Competition;
  status: ModelStatus;
  trainingCutoff: string | null;
  featureSchemaVersion: string;
  ruleTargetId: string;
  targetLabelSource: "kaggle_dream11_labels" | "reconstructed_unverified" | "none";
  metrics: ModelMetrics[];
  artifactPath: string | null;
  servable: boolean;
  notes: string;
  createdAt: string;
}

export interface Prediction {
  playerId: string;
  modelId: string;
  mean: number;
  p10: number;
  p90: number;
  sigma: number;
  /** Effective sample size behind the forecast (prior matches). */
  sampleSize: number;
  features: FeatureVector;
  explanation: string[];
}
