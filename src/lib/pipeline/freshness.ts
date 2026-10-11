/**
 * Lightweight freshness check used when a dashboard loads: compares the latest prepared analysis with the
 * current fixture revision, decision phase and active model. It never re-runs the analytical workflow.
 */
import { getActiveModel } from "../models/registry";
import type { PreparedAnalysis, Repository } from "../store/types";
import { tossTime, type ClockInfo } from "./clock";

export interface Freshness {
  state: "fresh" | "stale" | "missing" | "frozen";
  analysis: PreparedAnalysis | null;
  versions: number;
  reasons: string[];
  ageMinutes: number | null;
}

export async function analysisFreshness(repo: Repository, matchId: string, clock: ClockInfo): Promise<Freshness> {
  const versions = await repo.listPreparedAnalyses(matchId);
  const fixture = await repo.getFixture(matchId);
  const started = !!fixture?.startTimeUtc && clock.now >= new Date(fixture.startTimeUtc);
  // After the start, the analysis that counts is the last one prepared before the start.
  const eligible = started && fixture?.startTimeUtc ? versions.filter((v) => Date.parse(v.clockAt) < Date.parse(fixture.startTimeUtc!)) : versions;
  const analysis = eligible[eligible.length - 1] ?? null;
  if (!analysis) return { state: "missing", analysis: null, versions: versions.length, reasons: ["No prepared analysis yet — the background pipeline prepares upcoming matches within 7 days."], ageMinutes: null };
  const ageMinutes = Math.round((clock.now.getTime() - Date.parse(analysis.clockAt)) / 60_000);
  if (started) return { state: "frozen", analysis, versions: versions.length, reasons: ["Match has started; this frozen pre-match analysis is the one evaluated."], ageMinutes };
  const reasons: string[] = [];
  if (fixture && fixture.revision > analysis.fixtureRevision && fixture.startTimeUtc) reasons.push("Fixture details changed since preparation.");
  if (fixture?.startTimeUtc && fixture.source === "sim_replay" && clock.now >= tossTime(fixture.startTimeUtc) && analysis.decisionPhase === "pre_match") reasons.push("Toss and playing XI are now known.");
  const active = await getActiveModel(repo, analysis.competition);
  if (active.model.id !== analysis.modelId) reasons.push(`Active model changed to ${active.model.id}.`);
  if (!clock.simulated && ageMinutes > 6 * 60) reasons.push(`Prepared ${Math.round(ageMinutes / 60)}h ago.`);
  return { state: reasons.length ? "stale" : "fresh", analysis, versions: versions.length, reasons, ageMinutes };
}
