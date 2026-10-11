/**
 * End-to-end acceptance test (spec §16), run against the real processed data with the simulated pipeline
 * clock and an in-memory repository. Each `it` is one numbered step and they run in order.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { loadManifest, PROCESSED_DIR } from "@/lib/data/historical";
import { decideProposal, backtestProposal, rollback } from "@/lib/learning/loop";
import { loadMatchView } from "@/lib/match/view";
import { getActiveModel } from "@/lib/models/registry";
import ridge from "@/lib/models/artifacts/ridge-ipl-v1.json";
import { getTeamRules } from "@/lib/optimizer/rules";
import { validateTeam } from "@/lib/optimizer/validate";
import { runSimulation, runTick } from "@/lib/pipeline/jobs";
import { getClock } from "@/lib/pipeline/clock";
import { LocalRepository } from "@/lib/store/local";
import { SYSTEM_USER_ID, type ModelChangeProposal, type PreparedAnalysis } from "@/lib/store/types";

const repo = new LocalRepository(null);
const aryan = { id: "aryan", displayName: "Aryan", demo: true, accessToken: null, isAdmin: true };
let target: PreparedAnalysis;

describe.sequential("acceptance: autonomous end-to-end flow", () => {
  beforeAll(async () => {
    await runTick(repo); // the scheduler's first tick — nobody is logged in
  }, 300_000);

  it("1. historical datasets are ingested and audited", () => {
    const m = loadManifest()!;
    expect(m.competitions.IPL.matches).toBe(1243);
    expect(m.competitions.WPL.matches).toBe(88);
    expect(m.kaggleIplLabels.labelledMatches).toBe(1024);
    const rec = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, "reconciliation_kaggle-ipl-legacy-inferred.json"), "utf8"));
    expect(rec.overall.exactTotalPct).toBeGreaterThan(95);
  });

  it("2. models are trained and benchmarked with time-ordered validation", () => {
    const b = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, "model_benchmark.json"), "utf8"));
    expect(b.split).toEqual({ train: "<=2019", validation: "2020-2021", test: "2022-2023" });
    expect(Object.keys(b.results)).toEqual(expect.arrayContaining(["Ridge regression", "Random Forest", "HistGradientBoosting", "Train mean baseline"]));
    expect(b.selectedOnValidation).toBeTruthy();
    expect(ridge.trainingCutoff <= "2019-12-31").toBe(true);
  });

  it("3. a supported upcoming match is discovered automatically", async () => {
    const fixtures = await repo.listFixtures();
    expect(fixtures.filter((f) => f.status === "upcoming" && f.source === "sim_replay").length).toBeGreaterThan(0);
    expect(fixtures.every((f) => f.startTimeAssumed)).toBe(true);
  });

  it("4. research, predictions and suitability ranking are prepared before any user login", async () => {
    const prepared = await repo.listPreparedAnalyses();
    expect(prepared.length).toBeGreaterThan(0);
    expect(await repo.listUserTeams("aryan")).toHaveLength(0);
    target = [...prepared].sort((a, b) => b.suitability.score - a.suitability.score)[0];
    expect(target.suitability.reasons.length).toBeGreaterThan(2);
    const snap = (await repo.getSnapshot(target.snapshotId))!;
    expect(snap.predictions.length).toBeGreaterThanOrEqual(22);
    expect(snap.predictions.every((p) => Number.isFinite(p.mean) && p.p10 <= p.mean && p.mean <= p.p90)).toBe(true);
    expect(snap.dataCutoffDate < snap.context.date).toBe(true);
  });

  it("5–6. a valid XI with captain/vice-captain is generated and passes the deterministic validator", async () => {
    const rec = (await repo.listRecommendations(SYSTEM_USER_ID, target.matchId)).find((r) => r.id === target.recommendationId)!;
    const snap = (await repo.getSnapshot(target.snapshotId))!;
    expect(rec.playerIds).toHaveLength(11);
    expect(rec.captainId).not.toBe(rec.viceCaptainId);
    const v = validateTeam({ playerIds: rec.playerIds, captainId: rec.captainId, viceCaptainId: rec.viceCaptainId }, snap.pool, getTeamRules(snap.teamRulesId));
    expect(v.valid).toBe(true);
    expect(rec.validation.valid).toBe(true);
  });

  it("7. reasoning and every prediction version are saved (and earlier versions stay unchanged)", async () => {
    const rec = (await repo.listRecommendations(SYSTEM_USER_ID, target.matchId)).find((r) => r.id === target.recommendationId)!;
    expect(rec.explanationText.length).toBeGreaterThan(50);
    expect(rec.evidenceQuality.length).toBeGreaterThan(3);
    expect(rec.avoid.length).toBeGreaterThan(0);
    const v1 = JSON.stringify(await repo.getSnapshot(target.snapshotId));
    // Advance past the simulated toss of the target match: a new post-toss version must appear.
    const f = (await repo.getFixture(target.matchId))!;
    const hours = (Date.parse(f.startTimeUtc!) - (await getClock(repo)).now.getTime()) / 3600_000;
    await runSimulation(repo, Math.max(0.25, hours - 0.25), 15); // lands 15 min before start: after the toss, before the match
    const versions = await repo.listPreparedAnalyses(target.matchId);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions[versions.length - 1].decisionPhase).toBe("post_toss");
    expect(versions[versions.length - 1].trigger).toBe("lineup_announced");
    expect(JSON.stringify(await repo.getSnapshot(target.snapshotId))).toBe(v1);
  }, 300_000);

  it("8. Aryan logs in and sees the prepared recommendation with its freshness", async () => {
    const view = (await loadMatchView(repo, aryan, target.matchId))!;
    expect(view.source).toBe("prepared");
    expect(view.recommendation?.userId).toBe(SYSTEM_USER_ID);
    expect(["fresh", "stale"]).toContain(view.freshness!.state);
  });

  it("9. the match completes and actual results are collected automatically", async () => {
    await runSimulation(repo, 6, 30);
    const actuals = await repo.listActuals(SYSTEM_USER_ID, target.matchId);
    expect(actuals.length).toBeGreaterThanOrEqual(22);
    expect(new Set(actuals.map((a) => `${a.source}/${a.verification}`))).toEqual(new Set(["reconstructed/reconstructed_unverified"]));
  }, 300_000);

  it("10. frozen predictions are evaluated against actual outcomes", async () => {
    const ev = (await repo.listEvaluations(SYSTEM_USER_ID)).find((e) => e.matchId === target.matchId)!;
    const f = (await repo.getFixture(target.matchId))!;
    const evaluated = (await repo.listPreparedAnalyses(target.matchId)).find((a) => a.id === ev.analysisId)!;
    expect(Date.parse(evaluated.clockAt)).toBeLessThan(Date.parse(f.startTimeUtc!));
    expect(ev.poolMetrics!.n).toBeGreaterThanOrEqual(22);
    expect(ev.poolMetrics!.complete).toBe(true);
    expect(ev.optimizer!.actual).not.toBeNull();
    expect(ev.captainError).not.toBeNull();
  });

  it("11. error patterns are stored and candidate improvements are tested", async () => {
    expect((await repo.listPatterns()).length).toBeGreaterThan(0);
    const proposals = await repo.listProposals();
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.status === "proposed" || p.evaluation)).toBe(true);
  });

  it("12. a model change is promoted only when its release gates pass, and can be rolled back", async () => {
    for (const p of await repo.listProposals()) {
      if (p.status === "accepted") expect(p.evaluation!.passes).toBe(true);
      if (p.evaluation && !p.evaluation.passes) expect(p.status).not.toBe("accepted");
    }
    // A failing candidate cannot be accepted.
    const failing = (await repo.listProposals()).find((p) => p.status === "backtested" && !p.evaluation!.passes);
    if (failing) await expect(decideProposal(repo, failing.id, "accept", "test")).rejects.toThrow(/did not pass/);

    // Controlled scenario: make the active IPL model worse, then show a corrective candidate passes and is promoted.
    const before = await getActiveModel(repo, "IPL");
    const harmful = { roleBias: { WK: 20, BAT: 20, AR: 20, BOWL: 20 } };
    await repo.addActivation({ id: crypto.randomUUID(), competition: "IPL", modelId: before.model.id, params: harmful, activatedAt: new Date().toISOString(), activatedBy: "test", reason: "test: degrade", previousModelId: before.model.id, previousParams: before.params as Record<string, unknown> });
    const fix: ModelChangeProposal = {
      id: crypto.randomUUID(), competition: "IPL", baseModelId: before.model.id, candidateModelId: before.model.id, candidateParams: {}, rationale: "test: remove bias",
      patternIds: [], status: "proposed", createdAt: new Date().toISOString(), decidedAt: null, decidedBy: null, evaluation: null,
    };
    await repo.saveProposal(fix);
    const tested = await backtestProposal(repo, fix, "test");
    expect(tested.evaluation!.passes).toBe(true);
    expect(tested.evaluation!.improvementPct).toBeGreaterThan(ACCEPT_MIN);
    await decideProposal(repo, fix.id, "accept", "test");
    expect((await getActiveModel(repo, "IPL")).params).toEqual({});
    await rollback(repo, "IPL", "test");
    expect((await getActiveModel(repo, "IPL")).params).toEqual(harmful);
  }, 300_000);
});

const ACCEPT_MIN = 0.5;
