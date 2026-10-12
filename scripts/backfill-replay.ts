/**
 * Replay backfill: for past matches, rebuild the post-toss prediction exactly as it would have been made at
 * decision time (features use only earlier matches), run the optimizer, freeze it, collect reconstructed actual
 * points and evaluate. Everything is tagged origin = "replay_backfill" and excluded from live patterns and
 * model-promotion counts. Idempotent: matches already backfilled are skipped.
 *
 * Usage: npx tsx scripts/backfill-replay.ts --season 2026 [--competition IPL|WPL] [--limit N] [--force]
 * --force rebuilds matches already backfilled (e.g. after a rules or model change); new actual rows supersede old ones.
 * Gemini is disabled for the backfill (template explanations) to use no API quota.
 */
process.env.GEMINI_API_KEY = "";
import crypto from "node:crypto";
import { loadCompetition } from "../src/lib/data/historical";
import type { Competition } from "../src/lib/data/types";
import { availableActuals, evaluateSystem } from "../src/lib/evaluation/evaluate";
import { buildRecommendation } from "../src/lib/match/actions";
import { buildWorkspace } from "../src/lib/match/workspace";
import { rankMatches } from "../src/lib/recommendation/rank";
import { getRules } from "../src/lib/scoring/registry";
import { getRepository } from "../src/lib/store";
import { SYSTEM_USER_ID, type ActualPoint, type PreparedAnalysis } from "../src/lib/store/types";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const season = arg("season") ?? "2026";
const only = arg("competition") as Competition | undefined;
const limit = Number(arg("limit") ?? Infinity);
const force = process.argv.includes("--force");

(async () => {
  const repo = getRepository(null);
  console.log(`Repository: ${repo.kind}`);
  const done = new Set((await repo.listEvaluations(SYSTEM_USER_ID)).filter((e) => e.origin === "replay_backfill").map((e) => e.matchId));
  let n = 0;
  for (const c of ["IPL", "WPL"] as Competition[]) {
    if (only && only !== c) continue;
    const matches = loadCompetition(c).matches.filter((m) => m.date.startsWith(season.slice(0, 4)) || m.season === season || m.season.endsWith(season.slice(2)));
    for (const m of matches) {
      if (n >= limit) break;
      if (done.has(m.id) && !force) continue;
      const t0 = Date.now();
      const ws = await buildWorkspace(repo, m.id, { phase: "post_toss" });
      if (!ws) continue;
      const built = await buildRecommendation(repo, ws, SYSTEM_USER_ID, "balanced");
      const [rank] = rankMatches([{ matchId: m.id, competition: c, date: m.date, startTimeUtc: null, poolPlayerIds: ws.pool.map((p) => p.playerId), lineupConfirmed: true, isReplay: true }]);
      const versions = await repo.listPreparedAnalyses(m.id);
      const analysis: PreparedAnalysis = {
        id: crypto.randomUUID(), matchId: m.id, competition: c, version: (versions[versions.length - 1]?.version ?? 0) + 1, decisionPhase: ws.phase,
        preparedAt: new Date().toISOString(), clockAt: `${m.date}T13:45:00.000Z`, trigger: "manual", snapshotId: built.snapshot.id,
        recommendationId: built.recommendation?.id ?? null, infeasibility: built.infeasible?.reasons ?? null,
        suitability: { score: rank.score, components: rank.components, reasons: ["Replay backfill: rebuilt at decision time from earlier matches only", ...rank.reasons] },
        inputsHash: built.snapshot.contentHash.slice(0, 32), fixtureRevision: 0, modelId: ws.model.model.id,
      };
      await repo.savePreparedAnalysis(analysis);
      const snap = built.snapshot;
      const now = new Date().toISOString();
      const rows = availableActuals(snap, "reconstructed");
      const seen = new Set(rows.map((r) => r.playerId));
      const actuals: ActualPoint[] = rows.map((r) => ({
        id: crypto.randomUUID(), userId: SYSTEM_USER_ID, matchId: m.id, playerId: r.playerId, enteredValue: r.basePoints, includesMultiplier: false, basePoints: r.basePoints,
        source: "reconstructed", verification: "reconstructed_unverified", rulesId: snap.rulesId, createdAt: now,
      }));
      for (const p of snap.pool) if (!seen.has(p.playerId)) actuals.push({ id: crypto.randomUUID(), userId: SYSTEM_USER_ID, matchId: m.id, playerId: p.playerId, enteredValue: 0, includesMultiplier: false, basePoints: 0, source: "reconstructed", verification: "reconstructed_unverified", rulesId: null, createdAt: now });
      if (force || !(await repo.listActuals(SYSTEM_USER_ID, m.id)).length) await repo.addActuals(actuals);
      const ev = evaluateSystem({ snapshot: snap, recommendation: built.recommendation, actuals: await repo.listActuals(SYSTEM_USER_ID, m.id), multipliers: getRules(snap.rulesId).multipliers, analysisId: analysis.id });
      await repo.saveEvaluation({ ...ev, origin: "replay_backfill" });
      n++;
      console.log(`${c} ${m.date} ${m.team1} v ${m.team2}: pool MAE ${ev.poolMetrics?.mae.toFixed(1)}, XI ${ev.optimizer?.predicted.toFixed(0)}→${ev.optimizer?.actual?.toFixed(0)} (${Date.now() - t0}ms)`);
    }
  }
  console.log(`Backfilled ${n} match(es).`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
