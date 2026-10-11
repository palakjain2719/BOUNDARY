/**
 * Match workspace: everything needed to research a match and build teams at a given decision phase.
 * Enforces the decision-phase boundary: toss / confirmed XI only appear in post_toss workspaces, and
 * features use data strictly before the match date.
 */
import crypto from "node:crypto";
import { findMatch, loadCompetition, playerName, type CompetitionData } from "../data/historical";
import { canonicalTeam, venueKey } from "../data/normalize";
import type { Competition, DecisionPhase, MatchOrigin, PoolPlayer } from "../data/types";
import { buildFeatures, buildHistoryIndex, rolePriors, type HistoryIndex } from "../features/history";
import { getActiveModel, predictWith, type ActiveModel } from "../models/registry";
import { defaultTeamRulesFor, getTeamRules, type TeamRules } from "../optimizer/rules";
import { defaultRulesFor } from "../scoring/registry";
import type { RulesConfig } from "../scoring/types";
import { liveProvider } from "../providers";
import { statusAt, tossTime, type ClockInfo } from "../pipeline/clock";
import type { Fixture, MatchContextSnapshot, Repository, Snapshot, SnapshotPrediction } from "../store/types";

export interface WorkspaceMatch {
  id: string;
  competition: Competition;
  origin: MatchOrigin;
  season: string;
  date: string;
  startTimeUtc: string | null;
  timezone: string | null;
  venue: string;
  city: string | null;
  team1: string;
  team2: string;
  stage: string | null;
  status: "upcoming" | "live" | "completed";
  /** Post-match facts; only shown on review pages. */
  result: string | null;
}

export interface HeadToHead {
  matches: number;
  team1Wins: number;
  team2Wins: number;
  noResult: number;
  last: { date: string; winner: string | null; venue: string }[];
}

export interface Workspace {
  match: WorkspaceMatch;
  phase: DecisionPhase;
  availablePhases: DecisionPhase[];
  pool: PoolPlayer[];
  predictions: SnapshotPrediction[];
  context: MatchContextSnapshot;
  headToHead: HeadToHead;
  rules: RulesConfig;
  teamRules: TeamRules;
  model: ActiveModel;
  dataCutoffDate: string;
  warnings: string[];
}

export function estimatedDemoCredits(mean: number): number {
  const raw = 6.5 + (mean - 20) / 12;
  return Math.min(10.5, Math.max(6.5, Math.round(raw * 2) / 2));
}

function dayBefore(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function headToHead(data: CompetitionData, team1: string, team2: string, beforeDate: string): HeadToHead {
  const a = canonicalTeam(team1);
  const b = canonicalTeam(team2);
  const games = data.matches.filter((m) => m.date < beforeDate && new Set([canonicalTeam(m.team1), canonicalTeam(m.team2)]).size === 2 && [canonicalTeam(m.team1), canonicalTeam(m.team2)].includes(a) && [canonicalTeam(m.team1), canonicalTeam(m.team2)].includes(b));
  return {
    matches: games.length,
    team1Wins: games.filter((m) => m.winner && canonicalTeam(m.winner) === a).length,
    team2Wins: games.filter((m) => m.winner && canonicalTeam(m.winner) === b).length,
    noResult: games.filter((m) => !m.winner).length,
    last: games.slice(-5).reverse().map((m) => ({ date: m.date, winner: m.winner, venue: m.venue })),
  };
}

function venueHistory(idx: HistoryIndex, venue: string, beforeDate: string) {
  const key = venueKey(venue);
  const ms = idx.data.matches.filter((m) => m.date < beforeDate && venueKey(m.venue) === key);
  let innings = 0;
  let runs = 0;
  let pts = 0;
  let n = 0;
  for (const m of ms) {
    const rows = idx.byMatch.get(m.id) ?? [];
    for (const t of [m.team1, m.team2]) {
      const r = rows.filter((x) => x.stats.team === t);
      if (r.some((x) => x.stats.batted)) {
        innings++;
        runs += r.reduce((s, x) => s + x.stats.runs, 0);
      }
    }
    for (const r of rows) {
      pts += r.points;
      n++;
    }
  }
  return { matches: ms.length, avgFirstInningsProxy: innings ? Math.round(runs / innings) : null, avgPlayerPoints: n ? Math.round((pts / n) * 10) / 10 : null };
}

/** Squad proxy for pre-match replay: players who appeared for the team in its last 5 matches before the date. */
function squadProxy(data: CompetitionData, team: string, beforeDate: string): string[] {
  const t = canonicalTeam(team);
  const prior = data.matches.filter((m) => m.date < beforeDate && (canonicalTeam(m.team1) === t || canonicalTeam(m.team2) === t)).slice(-5);
  const ids = new Set<string>();
  for (const m of prior) for (const s of data.statsByMatch.get(m.id) ?? []) if (canonicalTeam(s.team) === t && (s.inAnnouncedXI || s.substituteIn)) ids.add(s.playerId);
  return [...ids];
}

function nameIndex(data: CompetitionData) {
  const m = new Map<string, string>();
  for (const [id, n] of Object.entries(data.names)) m.set(n.toLowerCase(), id);
  return m;
}

export interface LoadedMatch {
  match: WorkspaceMatch;
  fixture: Fixture | null;
  tossTimeUtc: string | null;
  startTimeAssumed: boolean;
}

/**
 * Resolve a match id at a given clock. Simulated fixtures expose status from the clock; archived Cricsheet
 * matches on or after the simulated date are hidden so the simulation cannot leak the future.
 */
export async function loadWorkspaceMatch(repo: Repository, id: string, clock?: ClockInfo): Promise<LoadedMatch | null> {
  const fixture = await repo.getFixture(id);
  const hist = findMatch(id);
  if (fixture?.source === "sim_replay" && hist) {
    const m = hist.match;
    const status = clock && fixture.startTimeUtc ? statusAt(fixture.startTimeUtc, clock.now) : fixture.status;
    return {
      match: {
        id: m.id, competition: m.competition, origin: "sim_replay", season: m.season, date: m.date, startTimeUtc: fixture.startTimeUtc,
        timezone: "Asia/Kolkata", venue: m.venue, city: m.city, team1: m.team1, team2: m.team2, stage: m.eventStage, status,
        result: status === "completed" ? m.result : null,
      },
      fixture,
      tossTimeUtc: fixture.startTimeUtc ? tossTime(fixture.startTimeUtc).toISOString() : null,
      startTimeAssumed: fixture.startTimeAssumed,
    };
  }
  if (hist && !fixture) {
    const m = hist.match;
    if (clock?.simulated && m.date >= clock.now.toISOString().slice(0, 10)) return null;
    return {
      match: {
        id: m.id, competition: m.competition, origin: "cricsheet_replay", season: m.season, date: m.date, startTimeUtc: null, timezone: "Asia/Kolkata",
        venue: m.venue, city: m.city, team1: m.team1, team2: m.team2, stage: m.eventStage, status: "completed", result: m.result,
      },
      fixture: null,
      tossTimeUtc: null,
      startTimeAssumed: false,
    };
  }
  let fx = fixture;
  if (!fx && id.startsWith("cricapi-")) {
    const provider = liveProvider();
    const d = provider ? await provider.matchDetails(id.slice("cricapi-".length)).catch(() => null) : null;
    if (d && d.competition !== "other") {
      const now = new Date().toISOString();
      fx = {
        id, competition: d.competition, date: d.date, startTimeUtc: d.startTimeUtc, startTimeAssumed: false, timezone: null, venue: d.venue, city: null,
        team1: d.team1, team2: d.team2, status: d.status, source: "provider", providerMatchId: d.providerMatchId, importedAt: now,
        importedBy: `provider:${provider!.id}`, lastSyncedAt: now, revision: 1,
      };
    }
  }
  if (!fx) return null;
  return {
    match: {
      id: fx.id, competition: fx.competition, origin: fx.source === "provider" ? "provider" : "csv_import", season: fx.date.slice(0, 4), date: fx.date,
      startTimeUtc: fx.startTimeUtc, timezone: fx.timezone, venue: fx.venue, city: fx.city, team1: fx.team1, team2: fx.team2, stage: null,
      status: fx.status, result: null,
    },
    fixture: fx,
    tossTimeUtc: null,
    startTimeAssumed: fx.startTimeAssumed,
  };
}

export async function buildWorkspace(
  repo: Repository,
  id: string,
  opts: { phase?: DecisionPhase; teamRulesId?: string; clock?: ClockInfo } = {},
): Promise<Workspace | null> {
  const loaded = await loadWorkspaceMatch(repo, id, opts.clock);
  if (!loaded) return null;
  const { match } = loaded;
  // Simulated fixtures use the Cricsheet pool logic below; only imported/provider fixtures use fixture pools.
  const fixture = loaded.fixture && loaded.fixture.source !== "sim_replay" ? loaded.fixture : null;
  const data = loadCompetition(match.competition);
  const rules = defaultRulesFor(match.competition);
  const idx = buildHistoryIndex(data, rules);
  const teamRules = opts.teamRulesId ? getTeamRules(opts.teamRulesId) : defaultTeamRulesFor(match.date);
  const model = await getActiveModel(repo, match.competition);
  const priors = rolePriors(idx, match.date);
  const warnings: string[] = [];

  const tossKnown = match.origin === "cricsheet_replay" || (match.origin === "sim_replay" && !!loaded.tossTimeUtc && !!opts.clock && opts.clock.now >= new Date(loaded.tossTimeUtc));
  const availablePhases: DecisionPhase[] = fixture ? ["pre_match"] : tossKnown ? ["post_toss", "pre_match"] : ["pre_match"];
  let phase: DecisionPhase = opts.phase && availablePhases.includes(opts.phase) ? opts.phase : availablePhases[0];

  // ---- Pool -------------------------------------------------------------------------------------------
  let pool: PoolPlayer[] = [];
  let lineupStatus: MatchContextSnapshot["lineupStatus"] = "squad_proxy";
  if (fixture) {
    let imported = await repo.listFixturePool(fixture.id);
    if (!imported.length && fixture.source === "provider") {
      const pid = fixture.providerMatchId ?? fixture.id.replace(/^cricapi-/, "");
      const xi = await liveProvider()?.playingXI(pid).catch(() => null);
      const squad = xi?.length ? xi : await liveProvider()?.squad(pid).catch(() => []);
      if (xi?.length) phase = "post_toss";
      imported = (squad ?? []).map((p) => ({ fixtureId: fixture.id, playerName: p.name, playerId: null, team: p.team, role: p.role ?? "BAT", credits: null, announced: xi?.length ? true : null }));
      if (squad?.some((p) => !p.role)) warnings.push("Some provider squad roles were missing and default to BAT.");
    }
    const names = nameIndex(data);
    pool = imported.map((p) => ({
      playerId: p.playerId ?? names.get(p.playerName.toLowerCase()) ?? `import:${p.playerName}`,
      name: p.playerName, team: p.team, role: p.role, roleSource: "imported", credits: p.credits,
      creditSource: p.credits == null ? "none" : "imported", announced: p.announced,
    }));
    lineupStatus = "imported_pool";
    if (imported.some((p) => p.announced)) phase = "post_toss";
    if (!pool.length) warnings.push("No player pool imported for this fixture yet. Import a pool CSV on Settings → Data import.");
  } else if (phase === "post_toss") {
    const rows = (data.statsByMatch.get(match.id) ?? []).filter((s) => s.inAnnouncedXI);
    pool = rows.map((s) => ({ playerId: s.playerId, name: playerName(data, s.playerId), team: s.team, role: "BAT", roleSource: "inferred_history", credits: null, creditSource: "estimated_demo", announced: true }));
    lineupStatus = "confirmed_xi";
    if (data.statsByMatch.get(match.id)?.some((s) => s.substituteIn)) {
      warnings.push("Impact/concussion substitutes who entered later are excluded from the post-toss pool (not known at toss).");
    }
  } else {
    for (const team of [match.team1, match.team2]) {
      for (const pid of squadProxy(data, team, match.date)) {
        pool.push({ playerId: pid, name: playerName(data, pid), team, role: "BAT", roleSource: "inferred_history", credits: null, creditSource: "estimated_demo", announced: null });
      }
    }
    lineupStatus = "squad_proxy";
    warnings.push("Pre-match pool is a squad proxy (players from each team's last 5 matches), not an official squad.");
  }

  // ---- Predictions (features strictly before match date) ------------------------------------------------
  const predictions: SnapshotPrediction[] = [];
  for (const p of pool) {
    const opponent = p.team === match.team1 ? match.team2 : match.team1;
    const pf = buildFeatures(idx, { playerId: p.playerId, matchId: match.id, targetDate: match.date, venue: match.venue, opponent, season: match.season });
    if (p.roleSource === "inferred_history") p.role = pf.role.role;
    else pf.role = { ...pf.role, role: p.role, reason: `Role from ${p.roleSource}` };
    const pred = predictWith(model.model, model.params, pf, priors[p.role]);
    if (p.creditSource === "estimated_demo") p.credits = estimatedDemoCredits(pred.mean);
    predictions.push({
      playerId: p.playerId, name: p.name, team: p.team, role: p.role, roleReason: p.roleSource === "inferred_history" ? pf.role.reason : `Role from ${p.roleSource}`,
      credits: p.credits, mean: pred.mean, p10: pred.p10, p90: pred.p90, sigma: pred.sigma, sampleSize: pred.sampleSize, explanation: pred.explanation,
      recentPoints: pf.recentPoints.map((r) => r.points), venueMatches: pf.features.player_venue_matches ?? 0,
      venueMean: pf.features.player_venue_pts_mean == null ? null : Math.round(pf.features.player_venue_pts_mean * 10) / 10,
      oppMatches: pf.features.player_vs_opp_matches ?? 0,
      oppMean: pf.features.player_vs_opp_pts_mean == null ? null : Math.round(pf.features.player_vs_opp_pts_mean * 10) / 10,
    });
  }
  if (pool.some((p) => p.creditSource === "estimated_demo")) warnings.push("Credits are demo estimates derived from projections — not Dream11 credits.");
  if (match.competition === "WPL") warnings.push("WPL points are reconstructed_unverified: no verified WPL Dream11 labels exist yet.");

  const hist = findMatch(match.id)?.match;
  const toss = phase === "post_toss" && !fixture && hist?.tossWinner ? { winner: hist.tossWinner, decision: hist.tossDecision ?? "" } : null;
  const context: MatchContextSnapshot = {
    venue: match.venue,
    city: match.city,
    date: match.date,
    startTimeUtc: match.startTimeUtc,
    toss,
    lineupStatus,
    venueHistory: venueHistory(idx, match.venue, match.date),
    pitchReport: null,
    weather: null,
    dataFreshness:
      match.origin === "sim_replay"
        ? `Simulated replay clock ${opts.clock?.now.toISOString().slice(0, 16).replace("T", " ")} UTC. Features use ${match.competition} matches before ${match.date}.`
        : match.origin === "cricsheet_replay"
        ? `Historical replay. Features use ${match.competition} matches before ${match.date}.`
        : `Imported ${fixture?.importedAt?.slice(0, 16).replace("T", " ") ?? ""} UTC. History through the latest processed ${match.competition} match before ${match.date}.`,
    sourceNotes: [
      match.origin === "cricsheet_replay" || match.origin === "sim_replay" ? "Fixture, XI and toss from Cricsheet (ball-by-ball archive)." : match.origin === "provider" ? "Fixture and squad from the configured provider." : "Fixture and pool from CSV import.",
      ...(loaded.startTimeAssumed ? ["Start time is assumed (19:30 IST, 15:30 IST for the first game of a double-header); the source has dates only."] : []),
      "No pitch report source configured.",
    ],
  };

  return {
    match: { ...match, result: null },
    phase,
    availablePhases,
    pool,
    predictions,
    context,
    headToHead: headToHead(data, match.team1, match.team2, match.date),
    rules,
    teamRules,
    model,
    dataCutoffDate: dayBefore(match.date),
    warnings,
  };
}

export function snapshotHash(ws: Pick<Workspace, "pool" | "predictions" | "context" | "phase">, modelId: string, params: unknown) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ pool: ws.pool, predictions: ws.predictions, context: ws.context, phase: ws.phase, modelId, params }))
    .digest("hex");
}

/** Freeze the workspace into an immutable snapshot, reusing an identical earlier snapshot if present. */
export async function freezeSnapshot(repo: Repository, ws: Workspace, userId: string, weather: unknown = null): Promise<Snapshot> {
  const context = { ...ws.context, weather };
  const hash = snapshotHash({ ...ws, context }, ws.model.model.id, ws.model.params);
  const existing = (await repo.listSnapshots(ws.match.id)).find((s) => s.contentHash === hash);
  if (existing) return existing;
  const snap: Snapshot = {
    id: crypto.randomUUID(),
    matchId: ws.match.id,
    competition: ws.match.competition,
    matchOrigin: ws.match.origin,
    decisionPhase: ws.phase,
    snapshotAt: new Date().toISOString(),
    dataCutoffDate: ws.dataCutoffDate,
    modelId: ws.model.model.id,
    modelParams: ws.model.params as Record<string, unknown>,
    rulesId: ws.rules.id,
    rulesVersion: ws.rules.version,
    teamRulesId: ws.teamRules.id,
    pool: ws.pool,
    predictions: ws.predictions,
    context,
    contentHash: hash,
    createdBy: userId,
  };
  await repo.saveSnapshot(snap);
  await repo.audit({ actor: userId, action: "snapshot.created", entity: "match_data_snapshot", entityId: snap.id, details: { matchId: snap.matchId, phase: snap.decisionPhase, modelId: snap.modelId } });
  return snap;
}
