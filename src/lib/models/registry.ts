/**
 * Model registry: built-in versions come from the offline benchmark (data/processed/model_benchmark.json)
 * and the servable artifacts in ./artifacts. Activations (with params learned through approved proposals)
 * are stored append-only in the repository so every change can be audited and rolled back.
 */
import fs from "node:fs";
import path from "node:path";
import type { Competition, PlayerRole } from "../data/types";
import { PROCESSED_DIR } from "../data/historical";
import type { PlayerFeatures } from "../features/history";
import type { Repository } from "../store/types";
import { BASELINE_ID, predictBaseline } from "./baseline";
import { predictRidge, type RidgeArtifact } from "./ridge";
import type { ModelMetrics, ModelVersion, Prediction } from "./types";
import ridgeArtifact from "./artifacts/ridge-ipl-v1.json";
import ridgeV2Artifact from "./artifacts/ridge-ipl-v2.json";
import { LEGACY_RULES_ID } from "../scoring/registry";

/** Rules the served models predict on (official Dream11 T20 points). */
export const CURRENT_RULES_ID = "dream11-t20-2026";
const ARTIFACTS: Record<string, RidgeArtifact> = {
  "ridge-ipl-v1": ridgeArtifact as RidgeArtifact,
  "ridge-ipl-v2": ridgeV2Artifact as RidgeArtifact,
};
import { EQUAL_WEIGHTS, predictWeighted, type Weights } from "./weighted";

export const FEATURE_SCHEMA_VERSION = "fs-1.0";

/** Post-model adjustments that the learning loop may propose. Default: none. */
export interface ModelParams {
  roleBias?: Partial<Record<PlayerRole, number>>;
  venueWeight?: number;
  /** Criterion weights for the weighted_criteria model. */
  weights?: Weights;
}

interface BenchmarkFile {
  generatedAt: string;
  results: Record<string, { kind: string; validation: ModelMetrics; test: ModelMetrics }>;
  selectedOnValidation: string;
  wplResearch: { season: string; recencyBaseline: ModelMetrics; trainMean: ModelMetrics }[];
  currentRules?: { rulesId: string; results: Record<string, { kind: string; validation: ModelMetrics; test: ModelMetrics; recent?: ModelMetrics }> };
}

export function loadBenchmark(): BenchmarkFile | null {
  const f = path.join(PROCESSED_DIR, "model_benchmark.json");
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as BenchmarkFile) : null;
}

export function builtinModels(): ModelVersion[] {
  const b = loadBenchmark();
  const m = (name: string) => (b?.results[name] ? [b.results[name].validation, b.results[name].test] : []);
  const cm = (name: string) => {
    const r = b?.currentRules?.results[name];
    return r ? [r.validation, r.test, ...(r.recent ? [r.recent] : [])] : [];
  };
  const art2 = ridgeV2Artifact as RidgeArtifact;
  const created = b?.generatedAt ?? new Date(0).toISOString();
  const art = ridgeArtifact as RidgeArtifact;
  return [
    {
      id: "ridge-ipl-v2", name: "Ridge regression, official T20 points (men's IPL)", kind: "ridge", competition: "IPL", status: "active",
      trainingCutoff: art2.trainingCutoff, featureSchemaVersion: FEATURE_SCHEMA_VERSION, ruleTargetId: CURRENT_RULES_ID,
      targetLabelSource: "reconstructed_unverified", metrics: cm("Ridge regression"), artifactPath: "src/lib/models/artifacts/ridge-ipl-v2.json",
      servable: true, createdAt: created,
      notes: "Served model. Trained on points re-scored from ball-by-ball data with the official Dream11 T20 rules, so predictions are on the same scale as the points Aryan enters. Selected on 2020–21 validation MAE; also checked on 2024+ (impact-player era). Weak signal: a few percent better than the train-mean baseline.",
    },
    {
      id: "ridge-ipl-v1", name: "Ridge regression, legacy Kaggle labels (men's IPL)", kind: "ridge", competition: "IPL", status: "candidate",
      trainingCutoff: art.trainingCutoff, featureSchemaVersion: FEATURE_SCHEMA_VERSION, ruleTargetId: LEGACY_RULES_ID,
      targetLabelSource: "kaggle_dream11_labels", metrics: m("Ridge regression"), artifactPath: "src/lib/models/artifacts/ridge-ipl-v1.json",
      servable: true, createdAt: created,
      notes: "Benchmark against real Dream11 labels (2008–2023, older points system). Kept for comparison; its predictions are on the old, smaller point scale.",
    },
    {
      id: BASELINE_ID, name: "Recency baseline (men's IPL)", kind: "recency_baseline", competition: "IPL", status: "candidate",
      trainingCutoff: null, featureSchemaVersion: FEATURE_SCHEMA_VERSION, ruleTargetId: CURRENT_RULES_ID,
      targetLabelSource: "none", metrics: cm("Recency baseline (recency-baseline-v1)"), artifactPath: null, servable: true, createdAt: created,
      notes: "Transparent heuristic: shrunk exponentially-weighted mean of prior points.",
    },
    {
      id: `${BASELINE_ID}-wpl`, name: "Recency baseline (women's WPL)", kind: "recency_baseline", competition: "WPL", status: "active",
      trainingCutoff: null, featureSchemaVersion: FEATURE_SCHEMA_VERSION, ruleTargetId: CURRENT_RULES_ID,
      targetLabelSource: "reconstructed_unverified",
      metrics: (b?.wplResearch ?? []).map((w) => ({ ...w.recencyBaseline, split: `research ${w.season} (reconstructed_unverified)` })),
      artifactPath: null, servable: true, createdAt: created,
      notes: "No WPL model is trained: labels are reconstructed_unverified. History uses WPL matches only; no men's data.",
    },
    ...(["IPL", "WPL"] as Competition[]).map((c) => ({
      id: `weighted-criteria-${c.toLowerCase()}-v1`, name: `Weighted criteria (${c === "IPL" ? "men's IPL" : "women's WPL"})`, kind: "weighted_criteria" as const,
      competition: c, status: "candidate" as const, trainingCutoff: null, featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      ruleTargetId: CURRENT_RULES_ID, targetLabelSource: "reconstructed_unverified" as ModelVersion["targetLabelSource"],
      metrics: [], artifactPath: null, servable: true, createdAt: created,
      notes: "Transparent blend of pre-match criteria. Weights are fitted on an early chronological window and can be reviewed on the Weights page. Becomes active only through a passing, approved proposal.",
    })),
    ...(["HistGradientBoosting", "Random Forest", "Train mean baseline"] as const).map((name) => ({
      id: `${name.toLowerCase().replace(/\s+/g, "-")}-ipl-benchmark`, name: `${name} (benchmark only)`,
      kind: (b?.results[name]?.kind ?? "train_mean") as ModelVersion["kind"], competition: "IPL" as Competition, status: "benchmark_only" as const,
      trainingCutoff: art.trainingCutoff, featureSchemaVersion: FEATURE_SCHEMA_VERSION, ruleTargetId: LEGACY_RULES_ID,
      targetLabelSource: "kaggle_dream11_labels" as const, metrics: m(name), artifactPath: null, servable: false, createdAt: created,
      notes: "Benchmarked offline in ml/train_benchmark.py; not served (needs a Python prediction service).",
    })),
  ];
}

const art2Fallback = () => ridgeV2Artifact as RidgeArtifact;

export function getModel(id: string): ModelVersion | undefined {
  return builtinModels().find((m) => m.id === id);
}

export interface ActiveModel {
  model: ModelVersion;
  params: ModelParams;
  activationId: string | null;
}

export async function getActiveModel(repo: Repository, competition: Competition): Promise<ActiveModel> {
  const acts = await repo.listActivations(competition);
  const last = acts[acts.length - 1];
  if (last) {
    const model = getModel(last.modelId);
    if (model?.servable && model.competition === competition) return { model, params: last.params as ModelParams, activationId: last.id };
  }
  const model = builtinModels().find((m) => m.competition === competition && m.status === "active")!;
  return { model, params: {}, activationId: null };
}

export function predictWith(model: ModelVersion, params: ModelParams, pf: PlayerFeatures, rolePrior: { mean: number; std: number }): Prediction {
  if (!model.servable) throw new Error(`Model ${model.id} is not servable`);
  let p: Prediction;
  if (model.kind === "ridge") p = predictRidge(pf, ARTIFACTS[model.id] ?? art2Fallback());
  else if (model.kind === "weighted_criteria") p = predictWeighted(pf, rolePrior, params.weights ?? EQUAL_WEIGHTS, model.id);
  else p = predictBaseline(pf, rolePrior, { venueWeight: params.venueWeight });
  p = { ...p, modelId: model.id };
  const bias = params.roleBias?.[pf.role.role];
  if (bias) {
    p = {
      ...p,
      mean: Math.round((p.mean + bias) * 10) / 10,
      p10: Math.round((p.p10 + bias) * 10) / 10,
      p90: Math.round((p.p90 + bias) * 10) / 10,
      explanation: [...p.explanation, `Approved ${pf.role.role} bias correction ${bias > 0 ? "+" : ""}${bias}.`],
    };
  }
  return p;
}
