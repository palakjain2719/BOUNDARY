/**
 * Autonomous background pipeline. One `runTick` executes every job in order; each job run is recorded with
 * an idempotency key, retried on failure, and isolated so one failing provider never blocks the others.
 *
 *   discover_fixtures → refresh_status → prepare_analysis → collect_actuals → evaluate_matches
 *   → detect_patterns → improve_models → send_reminders
 *
 * Triggered by Vercel Cron / an external scheduler (/api/cron/pipeline), the local daemon
 * (scripts/pipeline-daemon.ts) or an admin. User login is never required.
 */
import crypto from "node:crypto";
import { findMatch, loadCompetition } from "../data/historical";
import type { Competition } from "../data/types";
import { archiveMatchId, availableActuals, evaluateSystem } from "../evaluation/evaluate";
import { backtestProposal, backtestRows, decideProposal, proposeChanges, refreshLivePatterns, refreshPatterns, type Window } from "../learning/loop";
import { recomputeRecommended, submitProfile } from "../learning/weights";
import { buildRecommendation } from "../match/actions";
import { buildWorkspace } from "../match/workspace";
import { getActiveModel, getModel, type ModelParams } from "../models/registry";
import { processDueReminders, demoSender } from "../notifications";
import { liveProvider, providerFixtureId } from "../providers";
import { rankMatches } from "../recommendation/rank";
import { getRules, reconstructedLabelStatus } from "../scoring/registry";
import type { ActualPoint, Fixture, JobName, JobRun, PreparedAnalysis, Repository } from "../store/types";
import { SYSTEM_USER_ID } from "../store/types";
import { advanceSimClock, assumedStartUtc, getClock, statusAt, type ClockInfo } from "./clock";

export const DISCOVERY_HORIZON_DAYS = 7;
export const MIN_NEW_OBSERVATIONS = 100;
const MAX_ATTEMPTS = 2;
const LOCK_KEY = "pipeline_lock";
const LOCK_TTL_MS = 10 * 60_000;

export interface JobContext {
  repo: Repository;
  clock: ClockInfo;
  tickId: string;
}

type JobFn = (ctx: JobContext) => Promise<Record<string, unknown>>;

const slot = (d: Date, minutes = 15) => new Date(Math.floor(d.getTime() / (minutes * 60_000)) * minutes * 60_000).toISOString();

async function runJob(ctx: JobContext, job: JobName, key: string, fn: JobFn): Promise<JobRun> {
  const done = (await ctx.repo.listJobRuns({ job, key, limit: 5 })).find((r) => r.status === "succeeded");
  const now = () => new Date().toISOString();
  if (done) {
    const skipped: JobRun = { id: crypto.randomUUID(), job, key: `${key}#skip`, status: "skipped", attempt: 0, startedAt: now(), finishedAt: now(), clockAt: ctx.clock.now.toISOString(), summary: { reason: "Already succeeded for this key", previousRun: done.id }, error: null, tickId: ctx.tickId };
    return skipped; // not persisted, to keep the run log readable
  }
  let last: JobRun | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const run: JobRun = { id: crypto.randomUUID(), job, key, status: "running", attempt, startedAt: now(), finishedAt: null, clockAt: ctx.clock.now.toISOString(), summary: {}, error: null, tickId: ctx.tickId };
    await ctx.repo.saveJobRun(run);
    try {
      const summary = await fn(ctx);
      last = { ...run, status: "succeeded", finishedAt: now(), summary };
      await ctx.repo.saveJobRun(last);
      return last;
    } catch (e) {
      last = { ...run, status: "failed", finishedAt: now(), error: e instanceof Error ? e.message : String(e) };
      await ctx.repo.saveJobRun(last);
    }
  }
  return last!;
}

// ---------------------------------------------------------------------------------------------------------
// 1. Fixture discovery
// ---------------------------------------------------------------------------------------------------------

/** Simulated replay discovery: archived matches whose assumed start falls inside the horizon. */
export function simulatedFixtures(clock: ClockInfo): Omit<Fixture, "importedAt" | "lastSyncedAt" | "revision">[] {
  const from = new Date(clock.now.getTime() - 86400_000).toISOString().slice(0, 10);
  const to = new Date(clock.now.getTime() + DISCOVERY_HORIZON_DAYS * 86400_000).toISOString().slice(0, 10);
  const out: Omit<Fixture, "importedAt" | "lastSyncedAt" | "revision">[] = [];
  for (const c of ["IPL", "WPL"] as Competition[]) {
    const ms = loadCompetition(c).matches.filter((m) => m.date >= from && m.date <= to);
    for (const m of ms) {
      const sameDay = ms.filter((x) => x.date === m.date).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      const start = assumedStartUtc(m.date, sameDay.length > 1 && sameDay[0].id === m.id);
      out.push({
        id: m.id, competition: c, date: m.date, startTimeUtc: start, startTimeAssumed: true, timezone: "Asia/Kolkata", venue: m.venue, city: m.city,
        team1: m.team1, team2: m.team2, status: statusAt(start, clock.now), source: "sim_replay", providerMatchId: m.id, importedBy: "pipeline:sim-replay",
      });
    }
  }
  return out;
}

async function upsertDiscovered(repo: Repository, found: Omit<Fixture, "importedAt" | "lastSyncedAt" | "revision">[], nowIso: string) {
  let created = 0;
  let changed = 0;
  const rescheduled: string[] = [];
  const existing = new Map((await repo.listFixtures()).map((f) => [f.id, f]));
  const batch: Fixture[] = [];
  for (const f of found) {
    const prev = existing.get(f.id);
    if (!prev) {
      batch.push({ ...f, importedAt: nowIso, lastSyncedAt: nowIso, revision: 1 });
      created++;
      continue;
    }
    const material = prev.startTimeUtc !== f.startTimeUtc || prev.venue !== f.venue || prev.status !== f.status;
    if (prev.startTimeUtc !== f.startTimeUtc) rescheduled.push(f.id);
    if (material) changed++;
    batch.push({ ...prev, ...f, importedAt: prev.importedAt, lastSyncedAt: nowIso, revision: material ? prev.revision + 1 : prev.revision });
  }
  if (batch.length) await repo.upsertFixtures(batch, []);
  return { created, changed, rescheduled };
}

const discoverFixtures: JobFn = async ({ repo, clock }) => {
  const nowIso = clock.now.toISOString();
  if (clock.simulated) {
    const r = await upsertDiscovered(repo, simulatedFixtures(clock), nowIso);
    return { source: "sim_replay (Cricsheet archive on a simulated clock)", ...r };
  }
  const provider = liveProvider();
  if (!provider) return { source: "none", note: "No live provider configured; only CSV-imported fixtures are available." };
  if ("budgetRepo" in provider) (provider as { budgetRepo: Repository | null }).budgetRepo = repo;
  const fixtures = await provider.searchFixtures();
  const supported = fixtures.filter((f) => f.competition !== "other");
  const r = await upsertDiscovered(
    repo,
    supported.map((f) => ({
      id: providerFixtureId(provider.id, f.providerMatchId), competition: f.competition as Competition, date: f.date, startTimeUtc: f.startTimeUtc, startTimeAssumed: false,
      timezone: null, venue: f.venue, city: null, team1: f.team1, team2: f.team2, status: f.status, source: "provider" as const,
      providerMatchId: f.providerMatchId, importedBy: `provider:${provider.id}`,
    })),
    nowIso,
  );
  return { source: provider.id, seen: fixtures.length, unsupportedCompetition: fixtures.length - supported.length, ...r };
};

// ---------------------------------------------------------------------------------------------------------
// 2. Status refresh (simulated status follows the clock; stale CSV fixtures are flagged, not guessed)
// ---------------------------------------------------------------------------------------------------------
const refreshStatus: JobFn = async ({ repo, clock }) => {
  const nowIso = clock.now.toISOString();
  const updates: Fixture[] = [];
  const stale: string[] = [];
  for (const f of await repo.listFixtures()) {
    if (f.status === "completed") continue;
    if (f.source === "sim_replay" && f.startTimeUtc) {
      const st = statusAt(f.startTimeUtc, clock.now);
      if (st !== f.status) updates.push({ ...f, status: st, lastSyncedAt: nowIso, revision: f.revision + 1 });
    } else if (f.startTimeUtc && Date.parse(f.startTimeUtc) + 6 * 3600_000 < clock.now.getTime()) {
      stale.push(f.id);
    }
  }
  if (updates.length) await repo.upsertFixtures(updates, []);
  return { statusChanges: updates.map((u) => `${u.id}:${u.status}`), staleFixtures: stale };
};

// ---------------------------------------------------------------------------------------------------------
// 3. Prepare analysis (research + predictions + optimizer + validation + explanation), versioned
// ---------------------------------------------------------------------------------------------------------
function inputsHash(parts: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

export async function prepareMatch(repo: Repository, clock: ClockInfo, f: Fixture, trigger?: PreparedAnalysis["trigger"]) {
  const active = await getActiveModel(repo, f.competition);
  const ws = await buildWorkspace(repo, f.id, { clock });
  if (!ws) return { matchId: f.id, status: "not_found" };
  const hash = inputsHash({ rev: f.revision > 0 ? f.startTimeUtc : null, venue: f.venue, phase: ws.phase, model: active.model.id, params: active.params, pool: ws.pool.map((p) => p.playerId).sort(), credits: ws.pool.map((p) => p.credits) });
  const versions = await repo.listPreparedAnalyses(f.id);
  const latest = versions[versions.length - 1];
  if (latest && latest.inputsHash === hash) return { matchId: f.id, status: "unchanged", version: latest.version };
  const why: PreparedAnalysis["trigger"] =
    trigger ?? (!latest ? "scheduled" : latest.decisionPhase !== ws.phase ? "lineup_announced" : latest.modelId !== active.model.id || JSON.stringify(active.params) !== JSON.stringify((await repo.getSnapshot(latest.snapshotId))?.modelParams) ? "model_change" : "fixture_change");
  const built = await buildRecommendation(repo, ws, SYSTEM_USER_ID, "balanced");
  const [rank] = rankMatches([{ matchId: f.id, competition: f.competition, date: f.date, startTimeUtc: f.startTimeUtc, poolPlayerIds: ws.pool.map((p) => p.playerId), lineupConfirmed: ws.context.lineupStatus === "confirmed_xi", isReplay: false }], clock.now);
  const suitabilityReasons = [...rank.reasons, built.recommendation ? `Valid lineup generated (${built.recommendation.validation.label})` : "No valid lineup could be generated"];
  const analysis: PreparedAnalysis = {
    id: crypto.randomUUID(), matchId: f.id, competition: f.competition, version: (latest?.version ?? 0) + 1, decisionPhase: ws.phase, preparedAt: new Date().toISOString(),
    clockAt: clock.now.toISOString(), trigger: why, snapshotId: built.snapshot.id, recommendationId: built.recommendation?.id ?? null,
    infeasibility: built.infeasible ? built.infeasible.reasons : null,
    suitability: { score: built.recommendation ? rank.score : Math.round(rank.score * 0.5), components: { ...rank.components, validLineup: built.recommendation ? 1 : 0 }, reasons: suitabilityReasons },
    inputsHash: hash, fixtureRevision: f.revision, modelId: active.model.id,
  };
  await repo.savePreparedAnalysis(analysis);
  await repo.audit({ actor: "pipeline", action: "analysis.prepared", entity: "prepared_analysis", entityId: analysis.id, details: { matchId: f.id, version: analysis.version, trigger: why, phase: ws.phase } });
  return { matchId: f.id, status: "prepared", version: analysis.version, trigger: why, phase: ws.phase, invalidCandidates: built.invalidCandidates };
}

const prepareAnalysis: JobFn = async ({ repo, clock }) => {
  const results = [];
  for (const f of await repo.listFixtures()) {
    if (f.status !== "upcoming") continue; // predictions are frozen once the match starts
    if (f.startTimeUtc && Date.parse(f.startTimeUtc) - clock.now.getTime() > DISCOVERY_HORIZON_DAYS * 86400_000) continue;
    try {
      results.push(await prepareMatch(repo, clock, f));
    } catch (e) {
      results.push({ matchId: f.id, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }
  const errors = results.filter((r) => r.status === "error");
  if (errors.length && errors.length === results.length) throw new Error(`All ${errors.length} preparations failed: ${JSON.stringify(errors[0])}`);
  return { prepared: results.filter((r) => r.status === "prepared").length, unchanged: results.filter((r) => r.status === "unchanged").length, errors, results };
};

/** The analysis that counts for evaluation: the latest version prepared before the (assumed) start. */
export async function frozenAnalysis(repo: Repository, f: Fixture) {
  const versions = await repo.listPreparedAnalyses(f.id);
  const before = versions.filter((v) => !f.startTimeUtc || Date.parse(v.clockAt) < Date.parse(f.startTimeUtc));
  return before[before.length - 1] ?? null;
}

// ---------------------------------------------------------------------------------------------------------
// 4. Actual-result collection
// ---------------------------------------------------------------------------------------------------------
const collectActuals: JobFn = async ({ repo }) => {
  const collected: Record<string, unknown>[] = [];
  for (const f of await repo.listFixtures()) {
    if (f.status !== "completed") continue;
    const existing = await repo.listActuals(SYSTEM_USER_ID, f.id);
    if (existing.length) continue;
    const analysis = await frozenAnalysis(repo, f);
    if (!analysis) continue;
    const snap = await repo.getSnapshot(analysis.snapshotId);
    if (!snap) continue;
    if (!findMatch(archiveMatchId(f.id))) {
      collected.push({ matchId: f.id, status: "waiting", reason: "Ball-by-ball data for this match is not in the Cricsheet archive yet (rebuild data after Cricsheet publishes it), or import actuals via CSV." });
      continue;
    }
    // Prefer platform labels when they exist (Kaggle men's IPL 2008–2023); otherwise reconstruct.
    const kaggle = availableActuals(snap, "kaggle_label");
    const source = kaggle.length ? "kaggle_label" : "reconstructed";
    const rows = source === "kaggle_label" ? kaggle : availableActuals(snap, "reconstructed");
    const verification = source === "kaggle_label" ? "unverified" : reconstructedLabelStatus(snap.competition, getRules(snap.rulesId));
    const now = new Date().toISOString();
    const playersInMatch = new Set(rows.map((r) => r.playerId));
    const actuals: ActualPoint[] = rows.map((r) => ({
      id: crypto.randomUUID(), userId: SYSTEM_USER_ID, matchId: f.id, playerId: r.playerId, enteredValue: r.basePoints, includesMultiplier: false,
      basePoints: r.basePoints, source, verification, rulesId: source === "reconstructed" ? snap.rulesId : null, createdAt: now,
    }));
    // Pool players with no record in the match did not play: 0 points, recorded explicitly.
    for (const p of snap.pool) {
      if (!playersInMatch.has(p.playerId)) {
        actuals.push({ id: crypto.randomUUID(), userId: SYSTEM_USER_ID, matchId: f.id, playerId: p.playerId, enteredValue: 0, includesMultiplier: false, basePoints: 0, source, verification, rulesId: null, createdAt: now });
      }
    }
    await repo.addActuals(actuals);
    collected.push({ matchId: f.id, status: "collected", source, verification, players: actuals.length });
  }
  return { collected };
};

// ---------------------------------------------------------------------------------------------------------
// 5. Evaluation of frozen predictions
// ---------------------------------------------------------------------------------------------------------
const evaluateMatches: JobFn = async ({ repo }) => {
  const evaluated: Record<string, unknown>[] = [];
  const existing = new Map((await repo.listEvaluations(SYSTEM_USER_ID)).map((e) => [e.matchId, e]));
  for (const f of await repo.listFixtures()) {
    if (f.status !== "completed") continue;
    const actuals = await repo.listActuals(SYSTEM_USER_ID, f.id);
    if (!actuals.length) continue;
    const analysis = await frozenAnalysis(repo, f);
    if (!analysis) continue;
    const prev = existing.get(f.id);
    const newestActual = actuals.reduce((a, b) => (a > b.createdAt ? a : b.createdAt), "");
    if (prev && prev.analysisId === analysis.id && prev.computedAt >= newestActual) continue;
    const snap = (await repo.getSnapshot(analysis.snapshotId))!;
    const rec = analysis.recommendationId ? (await repo.listRecommendations(SYSTEM_USER_ID, f.id)).find((r) => r.id === analysis.recommendationId) ?? null : null;
    const prepRun = (await repo.listJobRuns({ job: "prepare_analysis", limit: 200 })).flatMap((r) => (r.summary.results as { matchId: string; version?: number; invalidCandidates?: number }[] | undefined) ?? []).find((x) => x.matchId === f.id && x.version === analysis.version);
    const ev = evaluateSystem({ snapshot: snap, recommendation: rec, actuals, multipliers: getRules(snap.rulesId).multipliers, analysisId: analysis.id, invalidCandidates: prepRun?.invalidCandidates ?? 0 });
    await repo.saveEvaluation(ev);
    evaluated.push({ matchId: f.id, poolMae: ev.poolMetrics?.mae, spearman: ev.poolMetrics?.spearman, optimizerActual: ev.optimizer?.actual, optimizerPredicted: ev.optimizer?.predicted });
  }
  return { evaluated };
};

// ---------------------------------------------------------------------------------------------------------
// 6. Pattern detection (live observations + periodic historical backtest)
// ---------------------------------------------------------------------------------------------------------
const detectPatterns: JobFn = async ({ repo }) => {
  const evals = (await repo.listAllEvaluations()).filter((e) => e.scope === "system");
  const out: Record<string, unknown> = {};
  for (const c of ["IPL", "WPL"] as Competition[]) {
    const active = await getActiveModel(repo, c);
    const live = await refreshLivePatterns(repo, c, evals, active.model.id);
    const hist = await refreshPatterns(repo, c);
    out[c] = { liveRows: live.rows, livePatterns: live.patterns.length, actionableLive: live.patterns.filter((p) => p.confidence !== "insufficient").length, historicalPatterns: hist.patterns.length };
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------
// 7. Model improvement: candidates → chronological backtest → gates → promote (with rollback kept)
// ---------------------------------------------------------------------------------------------------------
export function recentWindow(clock: ClockInfo, competition: Competition): Window | null {
  const to = new Date(clock.now.getTime() - 86400_000).toISOString().slice(0, 10);
  const from = new Date(clock.now.getTime() - 120 * 86400_000).toISOString().slice(0, 10);
  const n = loadCompetition(competition).matches.filter((m) => m.date >= from && m.date <= to).length;
  return n ? { name: `${competition} recent ${from}–${to} (reconstructed)`, from, to, labelSource: "reconstructed_unverified" } : null;
}

const improveModels: JobFn = async ({ repo, clock }) => {
  const out: Record<string, unknown> = {};
  for (const c of ["IPL", "WPL"] as Competition[]) {
    const observations = (await repo.listAllEvaluations()).filter((e) => e.scope === "system" && e.origin !== "replay_backfill" && e.competition === c).reduce((s, e) => s + (e.poolPlayers?.length ?? 0), 0);
    const lastSeen = (await repo.getState<number>(`improve_obs_${c}`)) ?? -Infinity;
    if (observations - lastSeen < MIN_NEW_OBSERVATIONS && lastSeen !== -Infinity) {
      out[c] = { status: "waiting", observations, needed: MIN_NEW_OBSERVATIONS, sinceLast: observations - lastSeen };
      continue;
    }
    await repo.setState(`improve_obs_${c}`, observations);
    const proposals = await proposeChanges(repo, c);
    // The system-recommended weight profile is also tested as a candidate model.
    const rec = await recomputeRecommended(repo, c);
    const fromWeights = await submitProfile(repo, "system", rec.id);
    const results = [];
    for (const p of [...proposals.map((x) => x), fromWeights.proposal]) {
      const tested = p.evaluation ? p : await backtestProposal(repo, p, "pipeline");
      let passes = !!tested.evaluation?.passes;
      let recentNote = "no recent reconstructed window";
      const rw = recentWindow(clock, c);
      if (passes && rw) {
        const active = await getActiveModel(repo, c);
        const cand = getModel(tested.candidateModelId)!;
        const b = backtestRows(c, active.model, active.params, rw);
        const k = backtestRows(c, cand, tested.candidateParams as ModelParams, rw);
        if (b.length >= 100) {
          const mae = (r: typeof b) => r.reduce((s, x) => s + Math.abs(x.predicted - x.actual), 0) / r.length;
          passes = mae(k) <= mae(b) * 1.01;
          recentNote = `recent window MAE ${mae(b).toFixed(2)} → ${mae(k).toFixed(2)} (${b.length} rows)`;
        }
      }
      if (passes) await decideProposal(repo, tested.id, "accept", "pipeline");
      else if (tested.status === "backtested") await decideProposal(repo, tested.id, "reject", "pipeline");
      results.push({ proposal: tested.id, rationale: tested.rationale.slice(0, 120), passes, improvementPct: tested.evaluation?.improvementPct, recentNote });
      if (passes) break; // promote at most one change per cycle; re-test the rest against the new baseline next time
    }
    out[c] = { status: "tested", observations, results };
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------
// 8. Reminders (simulated clock never sends real messages)
// ---------------------------------------------------------------------------------------------------------
const sendReminders: JobFn = async ({ repo, clock }) => {
  const senders = clock.simulated ? { email: demoSender("email", repo), sms: demoSender("sms", repo) } : {};
  const results = await processDueReminders(repo, clock.now, async (id) => {
    const f = await repo.getFixture(id);
    return f ? `${f.team1} v ${f.team2}` : id;
  }, senders);
  return { processed: results.length, results };
};

export const JOBS: { name: JobName; key: (c: ClockInfo, repo: Repository) => Promise<string>; fn: JobFn }[] = [
  { name: "discover_fixtures", key: async (c) => `discover:${slot(c.now)}`, fn: discoverFixtures },
  { name: "refresh_status", key: async (c) => `refresh:${slot(c.now)}`, fn: refreshStatus },
  { name: "prepare_analysis", key: async (c) => `prepare:${slot(c.now)}`, fn: prepareAnalysis },
  { name: "collect_actuals", key: async (c) => `collect:${slot(c.now)}`, fn: collectActuals },
  { name: "evaluate_matches", key: async (c) => `evaluate:${slot(c.now)}`, fn: evaluateMatches },
  { name: "detect_patterns", key: async (_c, repo) => `detect:${(await repo.listAllEvaluations()).filter((e) => e.scope === "system").map((e) => e.computedAt).sort().pop() ?? "none"}`, fn: detectPatterns },
  { name: "improve_models", key: async (c) => `improve:${slot(c.now, 60)}`, fn: improveModels },
  { name: "send_reminders", key: async (c) => `reminders:${slot(c.now, 5)}`, fn: sendReminders },
];

export interface TickResult {
  tickId: string;
  clock: string;
  simulated: boolean;
  runs: JobRun[];
  locked?: boolean;
}

export async function runTick(repo: Repository, opts: { advanceHours?: number; only?: JobName[] } = {}): Promise<TickResult> {
  const tickId = crypto.randomUUID();
  const lock = await repo.getState<{ until: number; tickId: string }>(LOCK_KEY);
  if (lock && lock.until > Date.now()) return { tickId, clock: "", simulated: false, runs: [], locked: true };
  await repo.setState(LOCK_KEY, { until: Date.now() + LOCK_TTL_MS, tickId });
  try {
    // Supabase: make sure reference rows (rules configs, model versions…) exist before jobs reference them.
    const maybeSeed = repo as Repository & { ensureReferenceData?: () => Promise<Record<string, unknown>> };
    if (maybeSeed.ensureReferenceData) {
      const seeded = await maybeSeed.ensureReferenceData();
      if (seeded.seeded) await repo.audit({ actor: "pipeline", action: "reference_data.seeded", entity: "system", entityId: "reference_data", details: seeded });
    }
    let clock = await getClock(repo);
    if (opts.advanceHours && clock.simulated) clock = await advanceSimClock(repo, { hours: opts.advanceHours });
    const ctx: JobContext = { repo, clock, tickId };
    const runs: JobRun[] = [];
    for (const j of JOBS) {
      if (opts.only && !opts.only.includes(j.name)) continue;
      runs.push(await runJob(ctx, j.name, await j.key(clock, repo), j.fn));
    }
    await repo.setState("last_tick", { tickId, at: new Date().toISOString(), clock: clock.now.toISOString(), statuses: runs.map((r) => `${r.job}:${r.status}`) });
    return { tickId, clock: clock.now.toISOString(), simulated: clock.simulated, runs };
  } finally {
    await repo.setState(LOCK_KEY, null);
  }
}


/**
 * Advance the simulated clock by `hours` in `stepMinutes` increments, running a full tick at each step so
 * toss windows (30 min before start) and completions are observed like a real 15-minute scheduler would.
 */
export async function runSimulation(repo: Repository, hours: number, stepMinutes = 30) {
  const steps = Math.max(1, Math.round((hours * 60) / stepMinutes));
  const ticks: TickResult[] = [];
  for (let i = 0; i < steps; i++) ticks.push(await runTick(repo, { advanceHours: stepMinutes / 60 }));
  return ticks;
}
