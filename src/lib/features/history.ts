/**
 * Points history index for one competition under one rules config, and leakage-safe pre-match features.
 *
 * Temporal rule: a feature for a target match may only use matches whose DATE is strictly earlier than the
 * target date. Same-day matches are excluded because the archives have no reliable start times.
 */
import type { CompetitionData } from "../data/historical";
import { canonicalTeam, venueKey } from "../data/normalize";
import { inferRole, type RoleEvidence } from "../data/roles";
import type { PlayerMatchStats, PlayerRole } from "../data/types";
import { scorePlayer } from "../scoring/calculator";
import type { RulesConfig } from "../scoring/types";

export interface ScoredRow {
  stats: PlayerMatchStats;
  date: string;
  venue: string;
  opponent: string;
  season: string;
  /** Role inferred from strictly earlier matches at the time of this match. */
  role: PlayerRole;
  points: number;
}

export interface HistoryIndex {
  data: CompetitionData;
  rules: RulesConfig;
  byPlayer: Map<string, ScoredRow[]>;
  byMatch: Map<string, ScoredRow[]>;
  /** Canonical venue key per match id. */
  matchVenue: Map<string, string>;
  /** Role prior (mean/std of points) computed from all rows strictly before a date; cached by date. */
  rolePriorCache: Map<string, Record<PlayerRole, { mean: number; std: number; n: number }>>;
}

const indexCache = new Map<string, HistoryIndex>();

export function buildHistoryIndex(data: CompetitionData, rules: RulesConfig): HistoryIndex {
  const key = `${data.competition}|${rules.id}|${rules.version}|${data.stats.length}`;
  const hit = indexCache.get(key);
  if (hit) return hit;
  const byPlayer = new Map<string, ScoredRow[]>();
  const byMatch = new Map<string, ScoredRow[]>();
  for (const [playerId, rows] of data.statsByPlayer) {
    const scored: ScoredRow[] = [];
    const prior: PlayerMatchStats[] = [];
    for (const s of rows) {
      const m = data.matchById.get(s.matchId)!;
      // Role at the time: inferred from strictly earlier matches only.
      const role = inferRole(prior.filter((p) => data.matchById.get(p.matchId)!.date < m.date)).role;
      const points = scorePlayer(s, role, rules).basePoints;
      const opponent = canonicalTeam(s.team === m.team1 ? m.team2 : m.team1);
      const row: ScoredRow = { stats: s, date: m.date, venue: venueKey(m.venue), opponent, season: m.season, role, points };
      scored.push(row);
      if (!byMatch.has(s.matchId)) byMatch.set(s.matchId, []);
      byMatch.get(s.matchId)!.push(row);
      prior.push(s);
    }
    byPlayer.set(playerId, scored);
  }
  const matchVenue = new Map(data.matches.map((m) => [m.id, venueKey(m.venue)]));
  const idx: HistoryIndex = { data, rules, byPlayer, byMatch, matchVenue, rolePriorCache: new Map() };
  indexCache.set(key, idx);
  return idx;
}

/** Feature allowlist: every model input must be listed here. Tests assert nothing else is used. */
export const FEATURE_ALLOWLIST = [
  "matches_before",
  "days_since_previous",
  "pts_prev",
  "pts_mean_last3",
  "pts_mean_last5",
  "pts_mean_last10",
  "pts_std_last10",
  "pts_ewm_hl5",
  "pts_mean_all",
  "pts_mean_season_prior",
  "runs_mean_last5",
  "balls_faced_mean_last5",
  "bat_pos_mean_last5",
  "sr_last10",
  "balls_bowled_mean_last5",
  "wickets_mean_last5",
  "econ_last10",
  "catches_mean_last10",
  "xi_rate_last10",
  "player_venue_matches",
  "player_venue_pts_mean",
  "venue_pts_mean_prior",
  "player_vs_opp_matches",
  "player_vs_opp_pts_mean",
  "role_WK",
  "role_BAT",
  "role_AR",
  "role_BOWL",
] as const;

export type FeatureName = (typeof FEATURE_ALLOWLIST)[number];
export type FeatureVector = Record<FeatureName, number | null>;

/** Column names / substrings that must never appear in a pre-match feature matrix. */
export const FORBIDDEN_FEATURE_PATTERNS = [
  /target/i,
  /total_fp/i,
  /dream_?team/i,
  /captain/i,
  /winner/i,
  /player_of_match/i,
  /toss/i,
  /same_match/i,
  /^actual_/i,
  /^runs$/,
  /^wickets$/,
  /result/i,
];

export function assertFeatureSchema(names: string[]) {
  const allow = new Set<string>(FEATURE_ALLOWLIST);
  for (const n of names) {
    if (!allow.has(n)) throw new Error(`Feature ${n} is not in the allowlist`);
    for (const p of FORBIDDEN_FEATURE_PATTERNS) if (p.test(n)) throw new Error(`Feature ${n} matches forbidden pattern ${p}`);
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const std = (xs: number[]) => {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

export function priorRows(idx: HistoryIndex, playerId: string, targetDate: string): ScoredRow[] {
  const rows = idx.byPlayer.get(playerId) ?? [];
  // rows are chronological; take strictly-earlier dates.
  let end = 0;
  while (end < rows.length && rows[end].date < targetDate) end++;
  return rows.slice(0, end);
}

export function rolePriors(idx: HistoryIndex, targetDate: string) {
  const cached = idx.rolePriorCache.get(targetDate);
  if (cached) return cached;
  const acc: Record<PlayerRole, number[]> = { WK: [], BAT: [], AR: [], BOWL: [] };
  for (const rows of idx.byPlayer.values()) {
    for (const r of rows) {
      if (r.date >= targetDate) break;
      acc[r.role].push(r.points);
    }
  }
  const all = Object.values(acc).flat();
  const fallback = { mean: mean(all) ?? 30, std: std(all) ?? 25, n: all.length };
  const out = Object.fromEntries(
    (Object.keys(acc) as PlayerRole[]).map((r) => [r, acc[r].length >= 30 ? { mean: mean(acc[r])!, std: std(acc[r])!, n: acc[r].length } : fallback]),
  ) as Record<PlayerRole, { mean: number; std: number; n: number }>;
  idx.rolePriorCache.set(targetDate, out);
  return out;
}

export interface PlayerFeatures {
  playerId: string;
  matchId: string;
  targetDate: string;
  role: RoleEvidence;
  features: FeatureVector;
  priorCount: number;
  recentPoints: { matchId: string; date: string; points: number; opponent: string; venue: string }[];
}

/**
 * Build pre-match features for a player for a target match. `opponent` and `venue` describe the target
 * fixture (known before the match). No stats from the target match or later are read.
 */
export function buildFeatures(
  idx: HistoryIndex,
  args: { playerId: string; matchId: string; targetDate: string; venue: string; opponent: string; season: string },
): PlayerFeatures {
  const prior = priorRows(idx, args.playerId, args.targetDate);
  const pts = prior.map((r) => r.points);
  const last = (k: number) => pts.slice(-k);
  const lastRows = (k: number) => prior.slice(-k);
  const role = inferRole(prior.map((r) => r.stats));

  // Exponentially-weighted mean, half-life 5 matches.
  let ewm: number | null = null;
  if (pts.length) {
    let wsum = 0;
    let vsum = 0;
    pts.forEach((p, i) => {
      const w = Math.pow(0.5, (pts.length - 1 - i) / 5);
      wsum += w;
      vsum += w * p;
    });
    ewm = vsum / wsum;
  }
  const l10 = lastRows(10);
  const sumBalls = l10.reduce((s, r) => s + r.stats.ballsFaced, 0);
  const sumRuns = l10.reduce((s, r) => s + r.stats.runs, 0);
  const sumBowled = l10.reduce((s, r) => s + r.stats.ballsBowled, 0);
  const sumConceded = l10.reduce((s, r) => s + r.stats.runsConceded, 0);
  const positions = lastRows(5)
    .map((r) => r.stats.battingPosition)
    .filter((x): x is number => x != null);
  const vKey = venueKey(args.venue);
  const opp = canonicalTeam(args.opponent);
  const atVenue = prior.filter((r) => r.venue === vKey);
  const vsOpp = prior.filter((r) => r.opponent === opp);
  const seasonPrior = prior.filter((r) => r.season === args.season);

  // Venue-wide average of all players' points in earlier matches at this venue.
  let venueSum = 0;
  let venueN = 0;
  for (const [mid, rows] of idx.byMatch) {
    if (idx.matchVenue.get(mid) !== vKey) continue;
    const m = idx.data.matchById.get(mid)!;
    if (m.date < args.targetDate) {
      for (const r of rows) {
        venueSum += r.points;
        venueN++;
      }
    }
  }
  const prevDate = prior.length ? prior[prior.length - 1].date : null;
  const days = prevDate ? Math.round((Date.parse(args.targetDate) - Date.parse(prevDate)) / 86400000) : null;

  const f: FeatureVector = {
    matches_before: prior.length,
    days_since_previous: days,
    pts_prev: pts.length ? pts[pts.length - 1] : null,
    pts_mean_last3: mean(last(3)),
    pts_mean_last5: mean(last(5)),
    pts_mean_last10: mean(last(10)),
    pts_std_last10: std(last(10)),
    pts_ewm_hl5: ewm,
    pts_mean_all: mean(pts),
    pts_mean_season_prior: mean(seasonPrior.map((r) => r.points)),
    runs_mean_last5: mean(lastRows(5).map((r) => r.stats.runs)),
    balls_faced_mean_last5: mean(lastRows(5).map((r) => r.stats.ballsFaced)),
    bat_pos_mean_last5: mean(positions),
    sr_last10: sumBalls >= 10 ? (100 * sumRuns) / sumBalls : null,
    balls_bowled_mean_last5: mean(lastRows(5).map((r) => r.stats.ballsBowled)),
    wickets_mean_last5: mean(lastRows(5).map((r) => r.stats.wickets)),
    econ_last10: sumBowled >= 12 ? (6 * sumConceded) / sumBowled : null,
    catches_mean_last10: mean(l10.map((r) => r.stats.catches)),
    xi_rate_last10: l10.length ? l10.filter((r) => r.stats.inAnnouncedXI).length / l10.length : null,
    player_venue_matches: atVenue.length,
    player_venue_pts_mean: mean(atVenue.map((r) => r.points)),
    venue_pts_mean_prior: venueN ? venueSum / venueN : null,
    player_vs_opp_matches: vsOpp.length,
    player_vs_opp_pts_mean: mean(vsOpp.map((r) => r.points)),
    role_WK: role.role === "WK" ? 1 : 0,
    role_BAT: role.role === "BAT" ? 1 : 0,
    role_AR: role.role === "AR" ? 1 : 0,
    role_BOWL: role.role === "BOWL" ? 1 : 0,
  };
  return {
    playerId: args.playerId,
    matchId: args.matchId,
    targetDate: args.targetDate,
    role,
    features: f,
    priorCount: prior.length,
    recentPoints: prior.slice(-10).map((r) => ({ matchId: r.stats.matchId, date: r.date, points: r.points, opponent: r.opponent, venue: r.venue })),
  };
}
