/**
 * Self-improvement loop: detect recurring error patterns (with sample size and evidence), propose
 * candidate adjustments, backtest them chronologically against the active model, and only activate
 * through an explicit, audited approval with rollback. Original predictions are never rewritten.
 *
 * Windows (chronological):
 *   IPL  calibrate on 2020–2021, evaluate on 2022–2023 — Kaggle Dream11 labels.
 *   WPL  calibrate on 2023/24–2024/25, evaluate on 2025/26 — reconstructed_unverified (research only).
 */
import crypto from "node:crypto";
import { loadCompetition, loadKaggleLabels } from "../data/historical";
import type { Competition, PlayerRole } from "../data/types";
import { buildFeatures, buildHistoryIndex, rolePriors } from "../features/history";
import { getActiveModel, getModel, predictWith, type ModelParams } from "../models/registry";
import type { ModelVersion } from "../models/types";
import { defaultRulesFor } from "../scoring/registry";
import type { ErrorPattern, ModelActivation, ModelChangeEvaluation, ModelChangeProposal, Repository, TeamEvaluation } from "../store/types";

export interface BacktestRow {
  matchId: string;
  season: string;
  date: string;
  role: PlayerRole;
  venue: string;
  historyBucket: string;
  predicted: number;
  p10: number;
  p90: number;
  actual: number;
}

export interface Window {
  name: string;
  from: string;
  to: string;
  labelSource: "kaggle_dream11_labels" | "reconstructed_unverified";
}

/**
 * fit: where model weights are fitted; calibrate: where patterns are detected and profiles compared;
 * evaluate: the later release-gate window. Strictly chronological: fit < calibrate < evaluate.
 */
export const WINDOWS: Record<Competition, { fit: Window; calibrate: Window; evaluate: Window }> = {
  IPL: {
    fit: { name: "IPL 2016–2019", from: "2016-01-01", to: "2019-12-31", labelSource: "kaggle_dream11_labels" },
    calibrate: { name: "IPL 2020–2021", from: "2020-01-01", to: "2021-12-31", labelSource: "kaggle_dream11_labels" },
    evaluate: { name: "IPL 2022–2023", from: "2022-01-01", to: "2023-12-31", labelSource: "kaggle_dream11_labels" },
  },
  WPL: {
    fit: { name: "WPL 2022/23", from: "2023-01-01", to: "2023-12-31", labelSource: "reconstructed_unverified" },
    calibrate: { name: "WPL 2023/24–2024/25", from: "2024-01-01", to: "2025-06-30", labelSource: "reconstructed_unverified" },
    evaluate: { name: "WPL 2025/26", from: "2025-07-01", to: "2026-12-31", labelSource: "reconstructed_unverified" },
  },
};

export const MIN_SUPPORT = 30;
export const ACCEPTANCE = { minRows: { IPL: 500, WPL: 150 } as Record<Competition, number>, minImprovementPct: 0.5, maxSegmentRegressionPct: 2 };

const memo = new Map<string, BacktestRow[]>();

function historyBucket(n: number) {
  return n === 0 ? "0 prior" : n <= 5 ? "1–5 prior" : n <= 20 ? "6–20 prior" : "21+ prior";
}

export function backtestRows(competition: Competition, model: ModelVersion, params: ModelParams, w: Window): BacktestRow[] {
  const key = `${competition}|${model.id}|${JSON.stringify(params)}|${w.from}|${w.to}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const data = loadCompetition(competition);
  const idx = buildHistoryIndex(data, defaultRulesFor(competition));
  const labels = new Map<string, number>();
  if (w.labelSource === "kaggle_dream11_labels") for (const l of loadKaggleLabels()) if (l.playerId) labels.set(`${l.matchId}|${l.playerId}`, l.totalFP);
  const rows: BacktestRow[] = [];
  for (const m of data.matches) {
    if (m.date < w.from || m.date > w.to) continue;
    const priors = rolePriors(idx, m.date);
    for (const r of idx.byMatch.get(m.id) ?? []) {
      if (!r.stats.inAnnouncedXI) continue;
      const actual = w.labelSource === "kaggle_dream11_labels" ? labels.get(`${m.id}|${r.stats.playerId}`) : r.points;
      if (actual == null) continue;
      const opponent = r.stats.team === m.team1 ? m.team2 : m.team1;
      const pf = buildFeatures(idx, { playerId: r.stats.playerId, matchId: m.id, targetDate: m.date, venue: m.venue, opponent, season: m.season });
      const p = predictWith(model, params, pf, priors[pf.role.role]);
      rows.push({
        matchId: m.id, season: m.season, date: m.date, role: pf.role.role, venue: m.venue.split(",")[0], historyBucket: historyBucket(pf.priorCount),
        predicted: p.mean, p10: p.p10, p90: p.p90, actual,
      });
    }
  }
  memo.set(key, rows);
  return rows;
}

function stats(rows: { predicted: number; actual: number }[]) {
  const n = rows.length;
  const errs = rows.map((r) => r.predicted - r.actual);
  const bias = errs.reduce((a, b) => a + b, 0) / n;
  const mae = errs.reduce((a, b) => a + Math.abs(b), 0) / n;
  const sd = Math.sqrt(errs.reduce((s, e) => s + (e - bias) ** 2, 0) / Math.max(1, n - 1));
  const t = sd > 0 ? bias / (sd / Math.sqrt(n)) : 0;
  return { n, bias, mae, t };
}

export function detectPatterns(
  rows: ({ predicted: number; actual: number } & object)[],
  segmentTypes: string[],
  meta: { competition: Competition; source: ErrorPattern["source"]; modelId: string },
): ErrorPattern[] {
  const out: ErrorPattern[] = [];
  for (const st of segmentTypes) {
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = String((r as Record<string, unknown>)[st] ?? "unknown");
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    for (const [seg, g] of groups) {
      const s = stats(g);
      if (Math.abs(s.bias) < 2 && s.n >= MIN_SUPPORT) continue;
      const confidence: ErrorPattern["confidence"] =
        s.n < MIN_SUPPORT ? "insufficient" : Math.abs(s.t) >= 4 && s.n >= 200 ? "high" : Math.abs(s.t) >= 3 ? "moderate" : Math.abs(s.t) >= 2 ? "low" : "insufficient";
      if (confidence === "insufficient" && meta.source === "historical_backtest") continue;
      out.push({
        id: crypto.randomUUID(), competition: meta.competition, segmentType: st, segment: seg, n: s.n,
        bias: Math.round(s.bias * 100) / 100, mae: Math.round(s.mae * 100) / 100, tStat: Math.round(s.t * 100) / 100,
        direction: s.bias > 0 ? "overpredict" : "underpredict", confidence, source: meta.source, modelId: meta.modelId, detectedAt: new Date().toISOString(),
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.tStat) - Math.abs(a.tStat));
}

export async function refreshPatterns(repo: Repository, competition: Competition) {
  const active = await getActiveModel(repo, competition);
  const rows = backtestRows(competition, active.model, active.params, WINDOWS[competition].calibrate);
  const hist = detectPatterns(rows, ["role", "historyBucket", "venue", "season"], { competition, source: "historical_backtest", modelId: active.model.id });
  await repo.replacePatterns(competition, "historical_backtest", hist);
  return { patterns: hist, rows: rows.length, window: WINDOWS[competition].calibrate };
}

/**
 * Patterns from live (post-match) evaluations of frozen predictions. Uses every pool player with an actual,
 * segmented by role, uncertainty bucket and history depth. Below MIN_SUPPORT a segment is reported as
 * "insufficient" and is never used to change the model.
 */
export async function refreshLivePatterns(repo: Repository, competition: Competition, evaluations: TeamEvaluation[], modelId: string) {
  const rows = evaluations
    .filter((e) => e.scope === "system" && e.competition === competition && e.poolPlayers?.length)
    .flatMap((e) =>
      e.poolPlayers!.map((p) => ({
        predicted: p.predicted,
        actual: p.actual,
        role: p.role,
        uncertainty: p.sigma < 25 ? "σ<25" : p.sigma < 35 ? "σ 25–35" : "σ≥35",
        historyBucket: historyBucket(p.sampleSize),
      })),
    );
  const pats = detectPatterns(rows, ["role", "uncertainty", "historyBucket"], { competition, source: "live_evaluations", modelId });
  await repo.replacePatterns(competition, "live_evaluations", pats);
  return { patterns: pats, rows: rows.length };
}

/** Build candidate proposals from calibration-window patterns. Shrinks corrections toward zero. */
export async function proposeChanges(repo: Repository, competition: Competition): Promise<ModelChangeProposal[]> {
  const active = await getActiveModel(repo, competition);
  const patterns = (await repo.listPatterns(competition)).filter((p) => p.source === "historical_backtest" && p.modelId === active.model.id);
  const proposals: ModelChangeProposal[] = [];
  const rolePats = patterns.filter((p) => p.segmentType === "role" && (p.confidence === "moderate" || p.confidence === "high"));
  if (rolePats.length) {
    const roleBias: Partial<Record<PlayerRole, number>> = { ...(active.params.roleBias ?? {}) };
    for (const p of rolePats) {
      const shrink = p.n / (p.n + 200);
      roleBias[p.segment as PlayerRole] = Math.round(((roleBias[p.segment as PlayerRole] ?? 0) - p.bias * shrink) * 10) / 10;
    }
    proposals.push({
      id: crypto.randomUUID(), competition, baseModelId: active.model.id, candidateModelId: active.model.id,
      candidateParams: { ...active.params, roleBias }, patternIds: rolePats.map((p) => p.id), status: "proposed",
      rationale: `Role-level bias correction from ${WINDOWS[competition].calibrate.name}: ${rolePats.map((p) => `${p.segment} ${p.direction} by ${Math.abs(p.bias).toFixed(1)} (n=${p.n}, t=${p.tStat})`).join("; ")}. Corrections shrunk by n/(n+200).`,
      createdAt: new Date().toISOString(), decidedAt: null, decidedBy: null, evaluation: null,
    });
  }
  if (active.model.kind === "recency_baseline" && !active.params.venueWeight) {
    proposals.push({
      id: crypto.randomUUID(), competition, baseModelId: active.model.id, candidateModelId: active.model.id,
      candidateParams: { ...active.params, venueWeight: 0.2 }, patternIds: patterns.filter((p) => p.segmentType === "venue").map((p) => p.id), status: "proposed",
      rationale: "Increase weight on the player's own venue history (0.2 × venue delta, players with ≥3 venue matches). Venue-segment errors were detected; this tests whether venue history helps out of sample.",
      createdAt: new Date().toISOString(), decidedAt: null, decidedBy: null, evaluation: null,
    });
  }
  for (const p of proposals) {
    await repo.saveProposal(p);
    await repo.audit({ actor: "system", action: "proposal.created", entity: "model_change_proposal", entityId: p.id, details: { competition, params: p.candidateParams } });
  }
  return proposals;
}

export async function backtestProposal(repo: Repository, proposal: ModelChangeProposal, actor: string): Promise<ModelChangeProposal> {
  if (proposal.evaluation) return proposal; // evaluations are immutable
  const active = await getActiveModel(repo, proposal.competition);
  const w = WINDOWS[proposal.competition].evaluate;
  const candidateModel = getModel(proposal.candidateModelId);
  if (!candidateModel?.servable) throw new Error(`Candidate model ${proposal.candidateModelId} is not servable`);
  const baseRows = backtestRows(proposal.competition, active.model, active.params, w);
  const candRows = backtestRows(proposal.competition, candidateModel, proposal.candidateParams as ModelParams, w);
  const mae = (rows: BacktestRow[]) => rows.reduce((s, r) => s + Math.abs(r.predicted - r.actual), 0) / Math.max(1, rows.length);
  const baseMae = mae(baseRows);
  const candMae = mae(candRows);
  const improvementPct = baseMae ? (100 * (baseMae - candMae)) / baseMae : 0;
  const segmentRegressions: ModelChangeEvaluation["segmentRegressions"] = [];
  for (const role of ["WK", "BAT", "AR", "BOWL"] as PlayerRole[]) {
    const b = baseRows.filter((r) => r.role === role);
    const c = candRows.filter((r) => r.role === role);
    if (b.length < MIN_SUPPORT) continue;
    const bm = mae(b);
    const cm = mae(c);
    if (cm > bm * (1 + ACCEPTANCE.maxSegmentRegressionPct / 100)) segmentRegressions.push({ segment: `role ${role}`, baseMae: Math.round(bm * 1000) / 1000, candidateMae: Math.round(cm * 1000) / 1000 });
  }
  const minRows = ACCEPTANCE.minRows[proposal.competition];
  const criteria = [
    `Evaluation rows ≥ ${minRows}: ${baseRows.length >= minRows ? "pass" : "fail"} (${baseRows.length})`,
    `MAE improvement ≥ ${ACCEPTANCE.minImprovementPct}%: ${improvementPct >= ACCEPTANCE.minImprovementPct ? "pass" : "fail"} (${improvementPct.toFixed(2)}%)`,
    `No role segment worse by > ${ACCEPTANCE.maxSegmentRegressionPct}%: ${segmentRegressions.length ? "fail" : "pass"}`,
    `Labels: ${w.labelSource}${w.labelSource === "reconstructed_unverified" ? " (research only — not verified fantasy labels)" : ""}`,
  ];
  const passes = baseRows.length >= minRows && improvementPct >= ACCEPTANCE.minImprovementPct && segmentRegressions.length === 0;
  const evaluation: ModelChangeEvaluation = {
    id: crypto.randomUUID(), proposalId: proposal.id, window: w.name, labelSource: w.labelSource, n: baseRows.length,
    baseMae: Math.round(baseMae * 1000) / 1000, candidateMae: Math.round(candMae * 1000) / 1000, improvementPct: Math.round(improvementPct * 100) / 100,
    segmentRegressions, passes, criteria, computedAt: new Date().toISOString(),
  };
  const updated: ModelChangeProposal = { ...proposal, status: "backtested", evaluation };
  await repo.saveProposal(updated);
  await repo.audit({ actor, action: "proposal.backtested", entity: "model_change_proposal", entityId: proposal.id, details: { passes, improvementPct: evaluation.improvementPct } });
  return updated;
}

export async function decideProposal(repo: Repository, proposalId: string, decision: "accept" | "reject", actor: string): Promise<ModelChangeProposal> {
  const p = (await repo.listProposals()).find((x) => x.id === proposalId);
  if (!p) throw new Error("Proposal not found");
  if (p.status !== "backtested") throw new Error("Only backtested proposals can be decided");
  if (decision === "accept" && !p.evaluation?.passes) throw new Error("Proposal did not pass the backtest criteria and cannot be accepted");
  const now = new Date().toISOString();
  if (decision === "accept") {
    const active = await getActiveModel(repo, p.competition);
    const act: ModelActivation = {
      id: crypto.randomUUID(), competition: p.competition, modelId: p.candidateModelId, params: p.candidateParams, activatedAt: now,
      activatedBy: actor, reason: `Accepted proposal ${p.id}`, previousModelId: active.model.id, previousParams: active.params as Record<string, unknown>,
    };
    await repo.addActivation(act);
  }
  const updated: ModelChangeProposal = { ...p, status: decision === "accept" ? "accepted" : "rejected", decidedAt: now, decidedBy: actor };
  await repo.saveProposal(updated);
  await repo.audit({ actor, action: `proposal.${decision}ed`, entity: "model_change_proposal", entityId: p.id, details: {} });
  return updated;
}

export async function rollback(repo: Repository, competition: Competition, actor: string): Promise<ModelActivation | null> {
  const acts = await repo.listActivations(competition);
  const last = acts[acts.length - 1];
  if (!last) return null;
  const act: ModelActivation = {
    id: crypto.randomUUID(), competition, modelId: last.previousModelId ?? last.modelId, params: last.previousParams ?? {}, activatedAt: new Date().toISOString(),
    activatedBy: actor, reason: `Rollback of activation ${last.id}`, previousModelId: last.modelId, previousParams: last.params,
  };
  await repo.addActivation(act);
  const prop = (await repo.listProposals()).find((x) => last.reason.includes(x.id));
  if (prop) await repo.saveProposal({ ...prop, status: "rolled_back" });
  await repo.audit({ actor, action: "model.rollback", entity: "model_activation", entityId: act.id, details: { from: last.id } });
  return act;
}
