/**
 * Server-side match actions used by API routes: optimizer recommendation, saving Aryan's team,
 * recording actual points and building the post-match review.
 */
import crypto from "node:crypto";
import { explainWithGemini } from "../ai/gemini";
import type { SessionUser } from "../auth";
import type { DecisionPhase } from "../data/types";
import { availableActuals, evaluateMatch } from "../evaluation/evaluate";
import { HttpError } from "../http/handler";
import { matchWeather } from "../providers/weather";
import { isInfeasible, runOptimizer, type RiskProfile } from "../optimizer/service";
import { validateTeam } from "../optimizer/validate";
import { getRules, reconstructedLabelStatus } from "../scoring/registry";
import { scoreTeam, toBasePoints, multiplierFor } from "../scoring/team";
import type { ActualPoint, OptimizerRecommendation, Repository, Snapshot, UserTeam } from "../store/types";
import { SYSTEM_USER_ID } from "../store/types";
import { buildWorkspace, freezeSnapshot, type Workspace } from "./workspace";
import { getClock, type ClockInfo } from "../pipeline/clock";

async function workspaceOr404(repo: Repository, matchId: string, phase?: DecisionPhase, teamRulesId?: string, clock?: ClockInfo) {
  const ws = await buildWorkspace(repo, matchId, { phase, teamRulesId, clock: clock ?? (await getClock(repo)) });
  if (!ws) throw new HttpError(404, "Match not found");
  return ws;
}

export function templateExplanation(ws: Workspace, rec: Pick<OptimizerRecommendation, "captainReason" | "viceCaptainReason" | "risks" | "validation" | "projectedTotal">) {
  return [
    `For ${ws.match.team1} v ${ws.match.team2} at ${ws.match.venue.split(",")[0]} (${ws.phase === "post_toss" ? "after the toss, confirmed XI" : "before the toss"}), the optimizer projects ${rec.projectedTotal} points including captain and vice-captain multipliers.`,
    `Captain — ${rec.captainReason}`,
    `Vice-captain — ${rec.viceCaptainReason}`,
    `Validation: ${rec.validation.label}.`,
    `Watch-outs: ${rec.risks.slice(0, 2).join(" ")}`,
  ].join(" ");
}

/**
 * Shared by the background pipeline (owner = SYSTEM_USER_ID) and on-demand requests: optimise, validate,
 * freeze an immutable snapshot, explain (Gemini or template) and persist the recommendation.
 */
export async function buildRecommendation(repo: Repository, ws: Workspace, ownerId: string, profile: RiskProfile = "balanced", exclude?: string[]) {
  const result = runOptimizer(ws, profile, { exclude });
  const clock = await getClock(repo);
  const weather = await matchWeather(ws.match.venue, ws.match.date, new Date(), fetch, clock).catch(() => null);
  const snapshot = await freezeSnapshot(repo, ws, ownerId, weather);
  if (isInfeasible(result)) return { infeasible: result, recommendation: null, snapshot, invalidCandidates: 0 };
  const predById = new Map(ws.predictions.map((p) => [p.playerId, p]));
  const base: Omit<OptimizerRecommendation, "explanationText" | "explanationSource"> = {
    id: crypto.randomUUID(),
    userId: ownerId,
    matchId: ws.match.id,
    snapshotId: snapshot.id,
    modelId: ws.model.model.id,
    playerIds: result.team.playerIds,
    captainId: result.team.captainId,
    viceCaptainId: result.team.viceCaptainId,
    riskAversion: result.riskAversion,
    projectedBase: result.team.projectedBase,
    projectedTotal: result.team.projectedWithMultipliers,
    validation: result.team.validation,
    picks: result.picks,
    avoid: result.avoid,
    alternatives: result.alternatives,
    captainReason: result.captainReason,
    viceCaptainReason: result.viceCaptainReason,
    risks: result.risks,
    evidenceQuality: result.evidenceQuality,
    createdAt: new Date().toISOString(),
  };
  const evidence = {
    match: `${ws.match.team1} v ${ws.match.team2}`,
    competition: ws.match.competition,
    venue: ws.match.venue,
    decisionPhase: ws.phase,
    toss: ws.context.toss,
    venueHistory: ws.context.venueHistory,
    validationLabel: base.validation.label,
    projectedTotal: base.projectedTotal,
    captain: base.captainReason,
    viceCaptain: base.viceCaptainReason,
    picks: base.picks.map((p) => ({ name: predById.get(p.playerId)?.name, role: predById.get(p.playerId)?.role, reasons: p.reasons.slice(0, 2) })),
    avoid: base.avoid.map((a) => ({ name: predById.get(a.playerId)?.name, reason: a.reason })),
    risks: base.risks,
    evidenceQuality: base.evidenceQuality,
    model: { id: ws.model.model.id, note: ws.model.model.notes },
  };
  const fallback = templateExplanation(ws, base);
  const ex = await explainWithGemini(evidence, fallback, fetch, repo);
  const rec: OptimizerRecommendation = { ...base, explanationText: ex.text, explanationSource: ex.source };
  await repo.saveRecommendation(rec);
  await repo.audit({ actor: ownerId, action: "recommendation.created", entity: "optimizer_recommendation", entityId: rec.id, details: { matchId: ws.match.id, snapshotId: snapshot.id, explanation: ex.source, geminiError: ex.error ?? null, invalidCandidates: result.team.invalidCandidates } });
  return { infeasible: null, recommendation: rec, snapshot, invalidCandidates: result.team.invalidCandidates };
}

export async function generateRecommendation(
  repo: Repository,
  user: SessionUser,
  matchId: string,
  input: { phase?: DecisionPhase; profile?: RiskProfile; teamRulesId?: string; exclude?: string[] },
) {
  const clock = await getClock(repo);
  const ws = await workspaceOr404(repo, matchId, input.phase, input.teamRulesId, clock);
  return buildRecommendation(repo, ws, user.id, input.profile ?? "balanced", input.exclude);
}

export async function saveUserTeam(
  repo: Repository,
  user: SessionUser,
  matchId: string,
  input: { phase?: DecisionPhase; teamRulesId?: string; playerIds: string[]; captainId: string | null; viceCaptainId: string | null },
) {
  const ws = await workspaceOr404(repo, matchId, input.phase, input.teamRulesId);
  // Deterministic server-side validation; the client check is only a convenience.
  const validation = validateTeam({ playerIds: input.playerIds, captainId: input.captainId, viceCaptainId: input.viceCaptainId }, ws.pool, ws.teamRules);
  if (!validation.valid) throw new HttpError(422, "Team is not valid", validation);
  const snapshot = await freezeSnapshot(repo, ws, user.id, null);
  const predicted: Record<string, number> = Object.fromEntries(ws.predictions.map((p) => [p.playerId, p.mean]));
  const total = scoreTeam({ playerIds: input.playerIds, captainId: input.captainId!, viceCaptainId: input.viceCaptainId!, basePoints: predicted }, ws.rules).total ?? 0;
  const team: UserTeam = {
    id: crypto.randomUUID(), userId: user.id, matchId, snapshotId: snapshot.id, playerIds: input.playerIds, captainId: input.captainId!,
    viceCaptainId: input.viceCaptainId!, validation, predictedTotal: Math.round(total * 10) / 10, createdAt: new Date().toISOString(),
  };
  await repo.saveUserTeam(team);
  await repo.audit({ actor: user.id, action: "user_team.saved", entity: "user_team", entityId: team.id, details: { matchId, snapshotId: snapshot.id } });
  return { team, snapshot };
}

export interface ReviewData {
  userTeam: UserTeam | null;
  recommendation: OptimizerRecommendation | null;
  snapshot: Snapshot | null;
  actuals: ActualPoint[];
  unionPlayerIds: string[];
  evaluation: ReturnType<typeof evaluateMatch> | null;
  canLoad: { reconstructed: boolean; kaggle: boolean };
}

export async function getReview(repo: Repository, user: SessionUser, matchId: string, opts: { ownActualsOnly?: boolean } = {}): Promise<ReviewData> {
  const [teams, userRecs, own, fixture, versions] = await Promise.all([
    repo.listUserTeams(user.id, matchId),
    repo.listRecommendations(user.id, matchId),
    repo.listActuals(user.id, matchId),
    repo.getFixture(matchId),
    repo.listPreparedAnalyses(matchId),
  ]);
  const userTeam = teams[teams.length - 1] ?? null;
  // Prefer the user's own on-demand recommendation; otherwise the pipeline's frozen pre-start recommendation.
  let recommendation: OptimizerRecommendation | null = userRecs[userRecs.length - 1] ?? null;
  if (!recommendation) {
    const f = fixture;
    const frozen = versions.filter((v) => !f?.startTimeUtc || Date.parse(v.clockAt) < Date.parse(f.startTimeUtc)).pop();
    if (frozen?.recommendationId) recommendation = (await repo.listRecommendations(SYSTEM_USER_ID, matchId)).find((r) => r.id === frozen.recommendationId) ?? null;
  }
  const snapId = userTeam?.snapshotId ?? recommendation?.snapshotId;
  const snapshot = snapId ? await repo.getSnapshot(snapId) : null;
  // The optimizer may have used a different snapshot; merge its predictions so every player is covered.
  let merged = snapshot;
  if (snapshot && recommendation && recommendation.snapshotId !== snapshot.id) {
    const other = await repo.getSnapshot(recommendation.snapshotId);
    if (other) {
      const ids = new Set(snapshot.predictions.map((p) => p.playerId));
      merged = { ...snapshot, predictions: [...snapshot.predictions, ...other.predictions.filter((p) => !ids.has(p.playerId))], pool: [...snapshot.pool, ...other.pool.filter((p) => !ids.has(p.playerId))] };
    }
  }
  // The user's own entries take precedence; otherwise use the actuals the pipeline collected.
  const actuals = own.length || opts.ownActualsOnly ? own : await repo.listActuals(SYSTEM_USER_ID, matchId);
  const unionPlayerIds = [...new Set([...(userTeam?.playerIds ?? []), ...(recommendation?.playerIds ?? [])])];
  const rules = merged ? getRules(merged.rulesId) : null;
  const evaluation = merged && actuals.length && rules ? evaluateMatch({ userId: user.id, snapshot: merged, userTeam, recommendation, actuals, multipliers: rules.multipliers }) : null;
  return {
    userTeam,
    recommendation,
    snapshot: merged,
    actuals,
    unionPlayerIds,
    evaluation,
    canLoad: {
      reconstructed: !!merged && (merged.matchOrigin === "cricsheet_replay" || merged.matchOrigin === "sim_replay"),
      kaggle: !!merged && merged.competition === "IPL" && merged.matchOrigin === "cricsheet_replay" && merged.dataCutoffDate < "2023-12-31",
    },
  };
}

export async function recordActuals(
  repo: Repository,
  user: SessionUser,
  matchId: string,
  input:
    | { mode: "manual"; includesMultiplier: boolean; entries: { playerId: string; points: number }[] }
    | { mode: "reconstructed" | "kaggle_label" },
) {
  const review = await getReview(repo, user, matchId);
  if (!review.snapshot) throw new HttpError(409, "Save your team or generate an optimizer team before entering actual points");
  const snap = review.snapshot;
  const allowed = new Set(review.unionPlayerIds);
  const now = new Date().toISOString();
  const rows: ActualPoint[] = [];
  if (input.mode === "manual") {
    const seen = new Set<string>();
    for (const e of input.entries) {
      if (!allowed.has(e.playerId)) throw new HttpError(400, `Player ${e.playerId} is not in either team`);
      if (seen.has(e.playerId)) throw new HttpError(400, `Duplicate entry for ${e.playerId}`);
      if (!Number.isFinite(e.points) || Math.abs(e.points) > 1000) throw new HttpError(400, `Invalid points for ${e.playerId}`);
      seen.add(e.playerId);
      // If the value already includes C/VC multipliers, divide it out so the multiplier is applied once.
      // A player can be C in one lineup and not in the other, so the user's own team defines the multiplier.
      const ref = review.userTeam ?? review.recommendation!;
      const mult = multiplierFor(e.playerId, ref.captainId, ref.viceCaptainId, getRules(snap.rulesId));
      rows.push({
        id: crypto.randomUUID(), userId: user.id, matchId, playerId: e.playerId, enteredValue: e.points, includesMultiplier: input.includesMultiplier,
        basePoints: toBasePoints(e.points, input.includesMultiplier, mult), source: "manual", verification: "user_confirmed", rulesId: null, createdAt: now,
      });
    }
  } else {
    const avail = availableActuals(snap, input.mode);
    if (!avail.length) throw new HttpError(409, input.mode === "kaggle_label" ? "No Kaggle Dream11 labels exist for this match" : "No Cricsheet events available to reconstruct this match");
    const verification = input.mode === "kaggle_label" ? "unverified" : reconstructedLabelStatus(snap.competition, getRules(snap.rulesId));
    for (const a of avail) {
      if (!allowed.has(a.playerId)) continue;
      rows.push({
        id: crypto.randomUUID(), userId: user.id, matchId, playerId: a.playerId, enteredValue: a.basePoints, includesMultiplier: false, basePoints: a.basePoints,
        source: input.mode, verification, rulesId: input.mode === "reconstructed" ? snap.rulesId : null, createdAt: now,
      });
    }
    // Players who did not appear in the source data scored 0 (did not play) — recorded explicitly.
    for (const pid of allowed) {
      if (!rows.some((r) => r.playerId === pid)) {
        rows.push({ id: crypto.randomUUID(), userId: user.id, matchId, playerId: pid, enteredValue: 0, includesMultiplier: false, basePoints: 0, source: input.mode, verification, rulesId: null, createdAt: now });
      }
    }
  }
  await repo.addActuals(rows);
  const updated = await getReview(repo, user, matchId);
  if (updated.evaluation) await repo.saveEvaluation(updated.evaluation);
  await repo.audit({ actor: user.id, action: "actuals.recorded", entity: "actual_player_points", entityId: matchId, details: { mode: input.mode, rows: rows.length } });
  return updated;
}

