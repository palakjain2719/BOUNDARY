/**
 * Post-match evaluation. Both lineups are scored from the same set of BASE actual points with the same
 * multipliers, so the comparison uses one scoring convention. Attribution only names a cause when the data
 * supports it; otherwise it says the outcome was within / outside the forecast range.
 */
import crypto from "node:crypto";
import { findMatch, loadCompetition, loadKaggleLabels } from "../data/historical";
import { inferRole } from "../data/roles";
import type { PlayerMatchStats } from "../data/types";
import { scorePlayer } from "../scoring/calculator";
import { getRules } from "../scoring/registry";
import { scoreTeam } from "../scoring/team";
import type {
  ActualPoint, OptimizerRecommendation, PlayerEvaluation, Snapshot, TeamEvaluation, TeamEvaluationSide, UserTeam,
} from "../store/types";

export interface ErrorMetrics {
  n: number;
  mae: number;
  rmse: number;
  bias: number;
  coverage80: number;
}

export function errorMetrics(rows: { predicted: number; actual: number; insideInterval?: boolean }[]): ErrorMetrics | null {
  if (!rows.length) return null;
  const errs = rows.map((r) => r.predicted - r.actual);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    n: rows.length,
    mae: r3(errs.reduce((s, e) => s + Math.abs(e), 0) / rows.length),
    rmse: r3(Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / rows.length)),
    bias: r3(errs.reduce((s, e) => s + e, 0) / rows.length),
    coverage80: r3(rows.filter((r) => r.insideInterval).length / rows.length),
  };
}

/** Latest actual entry per player wins (history is append-only). */
export function latestActuals(rows: ActualPoint[]): Map<string, ActualPoint> {
  const m = new Map<string, ActualPoint>();
  for (const r of [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) m.set(r.playerId, r);
  return m;
}

export function attribute(pred: { mean: number; p10: number; p90: number; sampleSize: number; role: string }, actual: number, stats: PlayerMatchStats | null | undefined, statsKnown: boolean): string {
  const err = pred.mean - actual;
  if (statsKnown && !stats) return "Participation: no record of this player taking part (lineup/availability change).";
  if (stats && !stats.inAnnouncedXI && !stats.substituteIn) return "Participation: not in the playing XI.";
  if (stats && pred.role !== "BOWL" && stats.ballsFaced < 5 && stats.ballsBowled === 0 && err > 15) {
    return `Opportunity: faced ${stats.ballsFaced} balls and did not bowl, so there was little chance to score.`;
  }
  if (stats && pred.role === "BOWL" && stats.ballsBowled < 12 && err > 15) return `Opportunity: bowled only ${stats.ballsBowled} legal balls.`;
  if (actual >= pred.p10 && actual <= pred.p90) return "Within the 80% forecast range.";
  if (pred.sampleSize < 5) return `Data quality: thin history (${pred.sampleSize} earlier matches) and the outcome fell outside the range.`;
  return err > 0 ? "High-variance outcome: below the 80% range without a recorded opportunity issue." : "High-variance outcome: above the 80% range.";
}

function side(
  teamId: string,
  playerIds: string[],
  captainId: string,
  viceCaptainId: string,
  predicted: number,
  base: Record<string, number>,
  multipliers: { captain: number; viceCaptain: number },
): TeamEvaluationSide {
  const s = scoreTeam({ playerIds, captainId, viceCaptainId, basePoints: base }, { id: "evaluation", multipliers });
  return {
    teamId,
    predicted,
    actual: s.total,
    error: s.total == null ? null : Math.round((predicted - s.total) * 10) / 10,
    captainId,
    viceCaptainId,
    captainActualBase: base[captainId] ?? null,
    missing: s.missing,
  };
}

export function evaluateMatch(args: {
  userId: string;
  snapshot: Snapshot;
  userTeam: UserTeam | null;
  recommendation: OptimizerRecommendation | null;
  actuals: ActualPoint[];
  multipliers: { captain: number; viceCaptain: number };
}): TeamEvaluation {
  const { snapshot, userTeam, recommendation } = args;
  const latest = latestActuals(args.actuals);
  const base: Record<string, number> = {};
  for (const [pid, a] of latest) base[pid] = a.basePoints;
  const predById = new Map(snapshot.predictions.map((p) => [p.playerId, p]));
  const hist = findMatch(snapshot.matchId);
  const statsByPlayer = new Map((hist?.data.statsByMatch.get(snapshot.matchId) ?? []).map((s) => [s.playerId, s]));
  const statsKnown = !!hist;

  const union = [...new Set([...(userTeam?.playerIds ?? []), ...(recommendation?.playerIds ?? [])])];
  const players: PlayerEvaluation[] = [];
  for (const pid of union) {
    const p = predById.get(pid);
    const a = base[pid];
    if (!p || a == null) continue;
    players.push({
      playerId: pid, name: p.name, role: p.role, predicted: p.mean, actual: a, error: Math.round((p.mean - a) * 10) / 10,
      insideInterval: a >= p.p10 && a <= p.p90, inUserTeam: !!userTeam?.playerIds.includes(pid), inOptimizerTeam: !!recommendation?.playerIds.includes(pid),
      attribution: attribute(p, a, statsByPlayer.get(pid), statsKnown),
    });
  }

  const u = userTeam ? side(userTeam.id, userTeam.playerIds, userTeam.captainId, userTeam.viceCaptainId, userTeam.predictedTotal, base, args.multipliers) : null;
  const o = recommendation ? side(recommendation.id, recommendation.playerIds, recommendation.captainId, recommendation.viceCaptainId, recommendation.projectedTotal, base, args.multipliers) : null;
  const metrics = errorMetrics(players);

  const takeaways: string[] = [];
  if (metrics) takeaways.push(`${players.filter((p) => p.insideInterval).length} of ${players.length} players finished inside their 80% forecast range; MAE ${metrics.mae.toFixed(1)}, bias ${metrics.bias > 0 ? "+" : ""}${metrics.bias.toFixed(1)} (positive = over-predicted).`);
  for (const [label, s] of [["Your", u], ["Optimizer", o]] as const) {
    if (!s || s.captainActualBase == null) continue;
    const cp = predById.get(s.captainId);
    takeaways.push(`${label} captain ${cp?.name ?? s.captainId}: ${s.captainActualBase} base pts (projected ${cp?.mean ?? "?"}).`);
  }
  if (u?.actual != null && o?.actual != null) {
    const d = Math.round((o.actual - u.actual) * 10) / 10;
    takeaways.push(d === 0 ? "Both lineups scored the same." : d > 0 ? `Optimizer outscored your team by ${d}.` : `Your team outscored the optimizer by ${-d}.`);
  }
  const worst = [...players].sort((a, b) => Math.abs(b.error) - Math.abs(a.error))[0];
  if (worst) takeaways.push(`Largest miss: ${worst.name} (projected ${worst.predicted}, actual ${worst.actual}). ${worst.attribution}`);
  if (players.length < union.length) takeaways.push(`${union.length - players.length} player(s) still need actual points.`);
  takeaways.push("One match is not evidence that a model weight is wrong; patterns are only acted on with enough samples.");

  const sources = [...new Set([...latest.values()].map((a) => `${a.source}/${a.verification}`))];
  return {
    id: crypto.randomUUID(),
    userId: args.userId,
    matchId: snapshot.matchId,
    computedAt: new Date().toISOString(),
    user: u,
    optimizer: o,
    optimizerMinusUser: u?.actual != null && o?.actual != null ? Math.round((o.actual - u.actual) * 10) / 10 : null,
    players,
    metrics,
    takeaways,
    actualsSource: sources.join(", ") || "none",
  };
}

/**
 * Actual points available from data for a replay match: reconstructed (calculator over Cricsheet events,
 * same rules as the snapshot) or Kaggle Dream11 labels (men's IPL 2008–2023, high-confidence mapping only).
 */
export function availableActuals(snapshot: Snapshot, kind: "reconstructed" | "kaggle_label"): { playerId: string; basePoints: number; lineItems?: unknown }[] {
  const hist = findMatch(snapshot.matchId);
  if (!hist) return [];
  if (kind === "kaggle_label") {
    if (snapshot.competition !== "IPL") return [];
    return loadKaggleLabels()
      .filter((l) => l.matchId === snapshot.matchId && l.playerId)
      .map((l) => ({ playerId: l.playerId!, basePoints: l.totalFP }));
  }
  const rules = getRules(snapshot.rulesId);
  const data = loadCompetition(snapshot.competition);
  return (data.statsByMatch.get(snapshot.matchId) ?? []).map((s) => {
    const prior = (data.statsByPlayer.get(s.playerId) ?? []).filter((x) => (data.matchById.get(x.matchId)?.date ?? "") < hist.match.date);
    const role = snapshot.pool.find((p) => p.playerId === s.playerId)?.role ?? inferRole(prior).role;
    const sc = scorePlayer(s, role, rules);
    return { playerId: s.playerId, basePoints: sc.basePoints, lineItems: sc };
  });
}

function spearman(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = Array(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxx && syy ? Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000 : null;
}

/**
 * Background evaluation of a frozen prepared analysis against collected actuals. Scores the optimizer XI
 * (with multipliers applied once) and, where actuals cover the pool, the whole eligible pool.
 */
export function evaluateSystem(args: {
  snapshot: Snapshot;
  recommendation: OptimizerRecommendation | null;
  actuals: ActualPoint[];
  multipliers: { captain: number; viceCaptain: number };
  analysisId: string;
  invalidCandidates?: number;
}): TeamEvaluation {
  const base = evaluateMatch({ userId: "system", snapshot: args.snapshot, userTeam: null, recommendation: args.recommendation, actuals: args.actuals, multipliers: args.multipliers });
  const latest = latestActuals(args.actuals);
  const pool = args.snapshot.predictions
    .filter((p) => latest.has(p.playerId))
    .map((p) => ({ playerId: p.playerId, role: p.role, predicted: p.mean, actual: latest.get(p.playerId)!.basePoints, sigma: p.sigma, sampleSize: p.sampleSize, inside: false, p10: p.p10, p90: p.p90 }));
  for (const p of pool) p.inside = p.actual >= p.p10 && p.actual <= p.p90;
  const m = errorMetrics(pool.map((p) => ({ predicted: p.predicted, actual: p.actual, insideInterval: p.inside })));
  const complete = pool.length === args.snapshot.predictions.length;
  const buckets = new Map<string, number[]>();
  for (const p of pool) {
    const b = p.sigma < 25 ? "σ<25" : p.sigma < 35 ? "σ 25–35" : "σ≥35";
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(Math.abs(p.predicted - p.actual));
  }
  const rec = args.recommendation;
  const err = (id: string | undefined) => {
    const p = pool.find((x) => x.playerId === id);
    return p ? Math.round((p.predicted - p.actual) * 10) / 10 : null;
  };
  return {
    ...base,
    userId: "system",
    scope: "system",
    competition: args.snapshot.competition,
    analysisId: args.analysisId,
    modelId: args.snapshot.modelId,
    decisionPhase: args.snapshot.decisionPhase,
    poolMetrics: m ? { ...m, spearman: spearman(pool.map((p) => p.predicted), pool.map((p) => p.actual)), complete } : null,
    captainError: err(rec?.captainId),
    viceCaptainError: err(rec?.viceCaptainId),
    byUncertainty: [...buckets].map(([bucket, e]) => ({ bucket, n: e.length, mae: Math.round((e.reduce((a, b) => a + b, 0) / e.length) * 100) / 100 })),
    invalidCandidates: args.invalidCandidates ?? 0,
    poolPlayers: pool.map(({ playerId, role, predicted, actual, sigma, sampleSize }) => ({ playerId, role, predicted, actual, sigma, sampleSize })),
    takeaways: base.takeaways.filter((t) => !t.startsWith("Your")),
  };
}
