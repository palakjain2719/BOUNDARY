/**
 * Exact branch-and-bound team optimizer.
 *
 * Objective: maximise Σ value_i + (captainMult − 1)·value_C + (viceMult − 1)·value_VC, where
 * value_i = mean_i − riskAversion·sigma_i. Captain and vice-captain are optimised jointly with the XI:
 * every ordered (C, VC) pair is enumerated (by default over the whole pool) and the remaining picks are
 * solved exactly by branch-and-bound under role, real-team, squad-size and credit constraints. The best
 * (team, C, VC) triple is globally optimal for the objective. The result is re-checked with
 * validateTeam(); a candidate that fails is returned with its violations so the caller can forbid it and
 * re-solve (correction loop).
 */
import type { PlayerRole, PoolPlayer } from "../data/types";
import type { TeamRules } from "./rules";
import { validateTeam, type ValidationResult } from "./validate";

export interface Candidate {
  player: PoolPlayer;
  mean: number;
  sigma: number;
}

export interface OptimizeOptions {
  riskAversion: number;
  captainMultiplier: number;
  viceCaptainMultiplier: number;
  /** Limit captain / vice-captain search to the top-K players (default: whole pool = exact joint optimum). */
  leaderPoolSize?: number;
  /** Exact player sets the validator rejected in earlier attempts; never returned again. */
  forbiddenSets?: string[][];
  /** Ignore credits (only when credits are unavailable; the result is then not fully valid). */
  ignoreCredits?: boolean;
  /** Players that must not be picked (e.g. user exclusions). */
  exclude?: string[];
  maxAttempts?: number;
}

export interface OptimizedTeam {
  playerIds: string[];
  captainId: string;
  viceCaptainId: string;
  objective: number;
  projectedBase: number;
  projectedWithMultipliers: number;
  validation: ValidationResult;
  attempts: number;
  invalidCandidates: number;
  searchedPairs: number;
  nodes: number;
}

const ROLES: PlayerRole[] = ["WK", "BAT", "AR", "BOWL"];

export function valueOf(c: Candidate, riskAversion: number) {
  return c.mean - riskAversion * c.sigma;
}

interface SolveState {
  best: number;
  bestSet: number[] | null;
  nodes: number;
}

function solveForced(
  cands: Candidate[],
  values: number[],
  forced: number[],
  bonus: Map<number, number>,
  rules: TeamRules,
  useCredits: boolean,
  excluded: Set<number>,
  forbidden: Set<string> = new Set(),
): { set: number[]; objective: number; nodes: number } | null {
  const n = cands.length;
  const order = [...Array(n).keys()]
    .filter((i) => !forced.includes(i) && !excluded.has(i))
    .sort((a, b) => values[b] - values[a] || cands[a].player.playerId.localeCompare(cands[b].player.playerId));

  const roleCount: Record<PlayerRole, number> = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  const teamCount: Record<string, number> = {};
  let credits = 0;
  let value = 0;
  for (const i of forced) {
    const p = cands[i].player;
    roleCount[p.role]++;
    teamCount[p.team] = (teamCount[p.team] ?? 0) + 1;
    credits += p.credits ?? 0;
    value += values[i] + (bonus.get(i) ?? 0);
  }
  const teams = [...new Set(cands.map((c) => c.player.team))];
  for (const t of teams) if ((teamCount[t] ?? 0) > rules.maxPerRealTeam) return null;
  for (const r of ROLES) if (roleCount[r] > rules.roleLimits[r][1]) return null;
  if (useCredits && credits > rules.creditCap + 1e-9) return null;

  // Suffix counts per role / team for feasibility pruning.
  const m = order.length;
  const suffixRole: Record<PlayerRole, number[]> = { WK: Array(m + 1).fill(0), BAT: Array(m + 1).fill(0), AR: Array(m + 1).fill(0), BOWL: Array(m + 1).fill(0) };
  const suffixTeam: Record<string, number[]> = Object.fromEntries(teams.map((t) => [t, Array(m + 1).fill(0)]));
  for (let k = m - 1; k >= 0; k--) {
    const p = cands[order[k]].player;
    for (const r of ROLES) suffixRole[r][k] = suffixRole[r][k + 1] + (p.role === r ? 1 : 0);
    for (const t of teams) suffixTeam[t][k] = suffixTeam[t][k + 1] + (p.team === t ? 1 : 0);
  }
  const prefix = [0];
  for (const i of order) prefix.push(prefix[prefix.length - 1] + values[i]);

  const st: SolveState = { best: -Infinity, bestSet: null, nodes: 0 };
  const chosen: number[] = [...forced];
  const need0 = rules.squadSize - forced.length;
  if (need0 < 0) return null;

  const dfs = (k: number, need: number) => {
    st.nodes++;
    if (need === 0) {
      for (const r of ROLES) if (roleCount[r] < rules.roleLimits[r][0]) return;
      for (const t of teams) if ((teamCount[t] ?? 0) < rules.minPerRealTeam) return;
      if (value > st.best + 1e-9) {
        if (forbidden.size && forbidden.has(chosen.map((c) => cands[c].player.playerId).sort().join("|"))) return;
        st.best = value;
        st.bestSet = [...chosen];
      }
      return;
    }
    if (m - k < need) return;
    // Bound: values are sorted descending, so the best possible completion is the next `need` values.
    if (value + (prefix[k + need] - prefix[k]) <= st.best + 1e-9) return;
    // Feasibility: remaining role minimums must be reachable and fit in `need` slots.
    let minsNeeded = 0;
    for (const r of ROLES) {
      const short = Math.max(0, rules.roleLimits[r][0] - roleCount[r]);
      if (suffixRole[r][k] < short) return;
      minsNeeded += short;
    }
    if (minsNeeded > need) return;
    for (const t of teams) {
      const short = Math.max(0, rules.minPerRealTeam - (teamCount[t] ?? 0));
      if (suffixTeam[t][k] < short) return;
    }

    const i = order[k];
    const p = cands[i].player;
    const c = p.credits ?? 0;
    const canTake =
      roleCount[p.role] < rules.roleLimits[p.role][1] &&
      (teamCount[p.team] ?? 0) < rules.maxPerRealTeam &&
      (!useCredits || credits + c <= rules.creditCap + 1e-9);
    if (canTake) {
      roleCount[p.role]++;
      teamCount[p.team] = (teamCount[p.team] ?? 0) + 1;
      credits += c;
      value += values[i];
      chosen.push(i);
      dfs(k + 1, need - 1);
      chosen.pop();
      value -= values[i];
      credits -= c;
      teamCount[p.team]--;
      roleCount[p.role]--;
    }
    dfs(k + 1, need);
  };
  dfs(0, need0);
  if (!st.bestSet) return null;
  return { set: st.bestSet, objective: st.best, nodes: st.nodes };
}

export function optimizeTeam(cands: Candidate[], rules: TeamRules, opts: OptimizeOptions): OptimizedTeam | null {
  const useCredits = !opts.ignoreCredits && cands.every((c) => c.player.credits != null);
  const values = cands.map((c) => valueOf(c, opts.riskAversion));
  const excludedIds = new Set(opts.exclude ?? []);
  const excluded = new Set(cands.map((c, i) => (excludedIds.has(c.player.playerId) ? i : -1)).filter((i) => i >= 0));
  const K = Math.min(opts.leaderPoolSize ?? cands.length, cands.length);
  const forbidden = new Set((opts.forbiddenSets ?? []).map((x) => [...x].sort().join("|")));
  const leaders = [...cands.keys()]
    .filter((i) => !excluded.has(i))
    .sort((a, b) => values[b] - values[a])
    .slice(0, K);

  let best: { set: number[]; objective: number; c: number; v: number } | null = null;
  let nodes = 0;
  let pairs = 0;
  for (const c of leaders) {
    for (const v of leaders) {
      if (c === v) continue;
      pairs++;
      const bonus = new Map([
        [c, (opts.captainMultiplier - 1) * values[c]],
        [v, (opts.viceCaptainMultiplier - 1) * values[v]],
      ]);
      const r = solveForced(cands, values, [c, v], bonus, rules, useCredits, excluded, forbidden);
      if (!r) continue;
      nodes += r.nodes;
      if (!best || r.objective > best.objective + 1e-9) best = { set: r.set, objective: r.objective, c, v };
    }
  }
  if (!best) return null;

  const pool = cands.map((x) => x.player);
  const playerIds = best.set.map((i) => cands[i].player.playerId);
  const captainId = cands[best.c].player.playerId;
  const viceCaptainId = cands[best.v].player.playerId;
  const validation = validateTeam({ playerIds, captainId, viceCaptainId }, pool, rules);

  const projectedBase = best.set.reduce((s, i) => s + cands[i].mean, 0);
  const projectedWithMultipliers =
    projectedBase + (opts.captainMultiplier - 1) * cands[best.c].mean + (opts.viceCaptainMultiplier - 1) * cands[best.v].mean;
  return {
    playerIds,
    captainId,
    viceCaptainId,
    objective: Math.round(best.objective * 10) / 10,
    projectedBase: Math.round(projectedBase * 10) / 10,
    projectedWithMultipliers: Math.round(projectedWithMultipliers * 10) / 10,
    validation,
    attempts: 1,
    invalidCandidates: 0,
    searchedPairs: pairs,
    nodes,
  };
}

/** Hard violations (credits_unknown is tolerated only when credits are genuinely unavailable). */
export function hardViolations(team: OptimizedTeam, cands: Candidate[]) {
  const creditsKnown = cands.every((c) => c.player.credits != null);
  return team.validation.violations.filter((x) => !(x.code === "credits_unknown" && !creditsKnown));
}

/**
 * Correction loop: solve, validate deterministically, and if any hard constraint fails forbid that exact
 * lineup and re-solve, up to maxAttempts. Returns the first lineup that passes, or null.
 */
export function optimizeWithCorrection(cands: Candidate[], rules: TeamRules, opts: OptimizeOptions, validator?: (t: OptimizedTeam) => OptimizedTeam): OptimizedTeam | null {
  const forbiddenSets: string[][] = [...(opts.forbiddenSets ?? [])];
  const max = opts.maxAttempts ?? 5;
  for (let attempt = 1; attempt <= max; attempt++) {
    let team = optimizeTeam(cands, rules, { ...opts, forbiddenSets });
    if (!team) return null;
    if (validator) team = validator(team);
    team.attempts = attempt;
    team.invalidCandidates = attempt - 1;
    if (!hardViolations(team, cands).length) return team;
    forbiddenSets.push(team.playerIds);
  }
  return null;
}

export interface SwapAlternative {
  outId: string;
  inId: string;
  valueDelta: number;
}

/** Best single feasible swap for each picked player (an "alternative", not an official bench). */
export function alternativesFor(team: OptimizedTeam, cands: Candidate[], rules: TeamRules, riskAversion: number): SwapAlternative[] {
  const pool = cands.map((c) => c.player);
  const byId = new Map(cands.map((c) => [c.player.playerId, c]));
  const out: SwapAlternative[] = [];
  for (const outId of team.playerIds) {
    let bestAlt: SwapAlternative | null = null;
    for (const c of cands) {
      const inId = c.player.playerId;
      if (team.playerIds.includes(inId)) continue;
      const ids = team.playerIds.map((x) => (x === outId ? inId : x));
      const cap = team.captainId === outId ? inId : team.captainId;
      const vc = team.viceCaptainId === outId ? inId : team.viceCaptainId;
      const v = validateTeam({ playerIds: ids, captainId: cap, viceCaptainId: vc }, pool, rules);
      const hard = v.violations.filter((x) => x.code !== "credits_unknown");
      if (hard.length) continue;
      const delta = valueOf(c, riskAversion) - valueOf(byId.get(outId)!, riskAversion);
      if (!bestAlt || delta > bestAlt.valueDelta) bestAlt = { outId, inId, valueDelta: Math.round(delta * 10) / 10 };
    }
    if (bestAlt) out.push(bestAlt);
  }
  return out.sort((a, b) => b.valueDelta - a.valueDelta);
}
