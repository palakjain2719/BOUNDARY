/**
 * Model-weight profiles for the weighted-criteria model.
 * - System-recommended weights are fitted on the `fit` window and compared on the `calibrate` window.
 * - A user's candidate weights are evaluated on the same window, stored separately, and never replace the
 *   active model. Submitting a candidate creates a model-change proposal that must pass the release gates.
 * These are prediction-model weights; fantasy scoring rules are a separate, versioned configuration.
 */
import crypto from "node:crypto";
import { loadCompetition, loadKaggleLabels } from "../data/historical";
import type { Competition } from "../data/types";
import { buildFeatures, buildHistoryIndex, rolePriors } from "../features/history";
import { getActiveModel } from "../models/registry";
import { blend, CRITERIA, criteriaValues, criterionEvidence, fitWeights, normalise, type CriterionEvidence, type FitRow, type Weights } from "../models/weighted";
import { defaultRulesFor } from "../scoring/registry";
import type { ModelChangeProposal, Repository, WeightProfile } from "../store/types";
import { backtestProposal, backtestRows, WINDOWS, type Window } from "./loop";

const memo = new Map<string, FitRow[]>();

export function criteriaRows(competition: Competition, w: Window): FitRow[] {
  const key = `${competition}|${w.from}|${w.to}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const data = loadCompetition(competition);
  const idx = buildHistoryIndex(data, defaultRulesFor(competition));
  const labels = new Map<string, number>();
  if (w.labelSource === "kaggle_dream11_labels") for (const l of loadKaggleLabels()) if (l.playerId) labels.set(`${l.matchId}|${l.playerId}`, l.totalFP);
  const rows: FitRow[] = [];
  for (const m of data.matches) {
    if (m.date < w.from || m.date > w.to) continue;
    const priors = rolePriors(idx, m.date);
    for (const r of idx.byMatch.get(m.id) ?? []) {
      if (!r.stats.inAnnouncedXI) continue;
      const actual = w.labelSource === "kaggle_dream11_labels" ? labels.get(`${m.id}|${r.stats.playerId}`) : r.points;
      if (actual == null) continue;
      const opponent = r.stats.team === m.team1 ? m.team2 : m.team1;
      const pf = buildFeatures(idx, { playerId: r.stats.playerId, matchId: m.id, targetDate: m.date, venue: m.venue, opponent, season: m.season });
      rows.push({ values: criteriaValues(pf.features, priors[pf.role.role].mean), actual });
    }
  }
  memo.set(key, rows);
  return rows;
}

export function evaluateWeights(rows: FitRow[], weights: Weights) {
  const w = normalise(weights);
  const mae = rows.reduce((s, r) => s + Math.abs(blend(r.values, w) - r.actual), 0) / Math.max(1, rows.length);
  return Math.round(mae * 1000) / 1000;
}

export interface WeightsOverview {
  competition: Competition;
  windows: typeof WINDOWS[Competition];
  recommended: WeightProfile;
  evidence: CriterionEvidence[];
  candidates: WeightProfile[];
  activeModel: { id: string; name: string; calibrateMae: number };
  criteria: { key: string; label: string; definition: string }[];
}

export async function recomputeRecommended(repo: Repository, competition: Competition): Promise<WeightProfile> {
  const fitRows = criteriaRows(competition, WINDOWS[competition].fit);
  const weights = fitWeights(fitRows);
  const cal = WINDOWS[competition].calibrate;
  const calRows = criteriaRows(competition, cal);
  const active = await getActiveModel(repo, competition);
  const activeRows = backtestRows(competition, active.model, active.params, cal);
  const baselineMae = activeRows.reduce((s, r) => s + Math.abs(r.predicted - r.actual), 0) / Math.max(1, activeRows.length);
  const profile: WeightProfile = {
    id: crypto.randomUUID(), competition, owner: "system", name: `System recommended (fitted on ${WINDOWS[competition].fit.name})`, weights,
    status: "recommended", createdAt: new Date().toISOString(),
    evaluation: { window: cal.name, n: calRows.length, mae: evaluateWeights(calRows, weights), baselineMae: Math.round(baselineMae * 1000) / 1000, labelSource: cal.labelSource },
    proposalId: null,
  };
  await repo.saveWeightProfile(profile);
  await repo.audit({ actor: "system", action: "weights.recommended", entity: "weight_profile", entityId: profile.id, details: { competition, weights } });
  return profile;
}

export async function getWeightsOverview(repo: Repository, competition: Competition, userId: string): Promise<WeightsOverview> {
  const profiles = await repo.listWeightProfiles(competition);
  const recommended = [...profiles].reverse().find((p) => p.owner === "system" && p.status === "recommended") ?? (await recomputeRecommended(repo, competition));
  const active = await getActiveModel(repo, competition);
  return {
    competition,
    windows: WINDOWS[competition],
    recommended,
    evidence: criterionEvidence(criteriaRows(competition, WINDOWS[competition].fit)),
    candidates: profiles.filter((p) => p.owner === userId),
    activeModel: { id: active.model.id, name: active.model.name, calibrateMae: recommended.evaluation?.baselineMae ?? NaN },
    criteria: CRITERIA.map(({ key, label, definition }) => ({ key, label, definition })),
  };
}

export async function saveCandidate(repo: Repository, userId: string, competition: Competition, weights: Weights, name: string): Promise<WeightProfile> {
  const w = normalise(weights);
  const cal = WINDOWS[competition].calibrate;
  const rows = criteriaRows(competition, cal);
  const rec = (await repo.listWeightProfiles(competition)).reverse().find((p) => p.owner === "system" && p.status === "recommended");
  const profile: WeightProfile = {
    id: crypto.randomUUID(), competition, owner: userId, name: name || "My weights", weights: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
    status: "candidate", createdAt: new Date().toISOString(),
    evaluation: { window: cal.name, n: rows.length, mae: evaluateWeights(rows, w), baselineMae: rec?.evaluation?.baselineMae ?? NaN, labelSource: cal.labelSource },
    proposalId: null,
  };
  await repo.saveWeightProfile(profile);
  await repo.audit({ actor: userId, action: "weights.candidate_saved", entity: "weight_profile", entityId: profile.id, details: { competition } });
  return profile;
}

/** Turn a weight profile into a proposal and run the release-gate backtest. Never activates it directly. */
export async function submitProfile(repo: Repository, actor: string, profileId: string): Promise<{ profile: WeightProfile; proposal: ModelChangeProposal }> {
  const profile = (await repo.listWeightProfiles()).find((p) => p.id === profileId);
  if (!profile) throw new Error("Weight profile not found");
  if (profile.owner !== actor && profile.owner !== "system") throw new Error("You can only submit your own weight profiles");
  const active = await getActiveModel(repo, profile.competition);
  const proposal: ModelChangeProposal = {
    id: crypto.randomUUID(), competition: profile.competition, baseModelId: active.model.id, candidateModelId: `weighted-criteria-${profile.competition.toLowerCase()}-v1`,
    candidateParams: { weights: profile.weights }, patternIds: [], status: "proposed",
    rationale: `${profile.owner === "system" ? "System-recommended" : "User-submitted"} weight profile "${profile.name}" for the weighted-criteria model.`,
    createdAt: new Date().toISOString(), decidedAt: null, decidedBy: null, evaluation: null,
  };
  await repo.saveProposal(proposal);
  const tested = await backtestProposal(repo, proposal, actor);
  const updated: WeightProfile = { ...profile, status: profile.owner === "system" ? profile.status : "submitted", proposalId: tested.id };
  await repo.saveWeightProfile(updated);
  return { profile: updated, proposal: tested };
}
