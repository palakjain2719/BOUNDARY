import { describe, expect, it } from "vitest";
import { buildCompetitionData, loadCompetition } from "@/lib/data/historical";
import type { MatchRecord, PlayerMatchStats } from "@/lib/data/types";
import { assertFeatureSchema, buildFeatures, buildHistoryIndex, FEATURE_ALLOWLIST } from "@/lib/features/history";
import { getRules } from "@/lib/scoring/registry";
import { stats } from "./helpers";

const rules = getRules("kaggle-ipl-legacy-inferred");
const m = (id: string, date: string): MatchRecord => ({
  id, competition: "IPL", gender: "male", season: date.slice(0, 4), date, venue: "Ground X, City", city: "City", team1: "A", team2: "B", eventStage: null,
  tossWinner: "A", tossDecision: "bat", winner: "A", result: "A won", hasSuperOver: false, source: "test", sourceRevision: 1,
});

function synthetic(targetRuns: number, futureRuns: number, sameDayRuns: number) {
  const matches = [m("1", "2024-04-01"), m("2", "2024-04-05"), m("3", "2024-04-10"), m("4", "2024-04-10"), m("5", "2024-04-20")];
  const rows: PlayerMatchStats[] = [
    stats({ matchId: "1", runs: 20, ballsFaced: 15, batted: true }),
    stats({ matchId: "2", runs: 40, ballsFaced: 25, batted: true }),
    stats({ matchId: "3", runs: targetRuns, ballsFaced: 30, batted: true }), // target match
    stats({ matchId: "4", runs: sameDayRuns, ballsFaced: 30, batted: true }), // same date, unknown order
    stats({ matchId: "5", runs: futureRuns, ballsFaced: 30, batted: true }), // future
  ];
  return buildCompetitionData("IPL", matches, rows, { p1: "Player One" });
}

describe("pre-match features", () => {
  const args = { playerId: "p1", matchId: "3", targetDate: "2024-04-10", venue: "Ground X, City", opponent: "B", season: "2024" };
  it("ignore the target match, same-day matches and future matches", () => {
    const a = buildFeatures(buildHistoryIndex(synthetic(0, 0, 0), rules), args);
    const b = buildFeatures(buildHistoryIndex(synthetic(150, 150, 150), rules), args);
    expect(a.features).toEqual(b.features);
    expect(a.priorCount).toBe(2);
  });
  it("use earlier matches", () => {
    const f = buildFeatures(buildHistoryIndex(synthetic(0, 0, 0), rules), args);
    expect(f.features.runs_mean_last5).toBe(30);
    expect(f.features.matches_before).toBe(2);
  });
  it("never treat a missing statistic as zero (null instead)", () => {
    const f = buildFeatures(buildHistoryIndex(synthetic(0, 0, 0), rules), { ...args, targetDate: "2024-03-01" });
    expect(f.features.pts_mean_last5).toBeNull();
    expect(f.features.sr_last10).toBeNull();
  });
  it("feature schema is an allowlist and rejects leakage columns", () => {
    expect(() => assertFeatureSchema([...FEATURE_ALLOWLIST])).not.toThrow();
    for (const bad of ["target_total_fp", "dream_team_label", "captain_label", "toss_winner_post_toss_only", "match_winner", "player_of_match", "actual_runs_same_match"]) {
      expect(() => assertFeatureSchema([bad])).toThrow();
    }
  });
  it("real data: features for a 2023 match equal features computed with all later matches removed", () => {
    const ipl = loadCompetition("IPL");
    const target = ipl.matches.find((x) => x.id === "1370353")!;
    const truncated = buildCompetitionData("IPL", ipl.matches.filter((x) => x.date < target.date), ipl.stats.filter((s) => ipl.matchById.get(s.matchId)!.date < target.date), ipl.names);
    const full = buildHistoryIndex(ipl, rules);
    const cut = buildHistoryIndex(truncated, rules);
    for (const s of ipl.statsByMatch.get(target.id)!.slice(0, 6)) {
      const a = { playerId: s.playerId, matchId: target.id, targetDate: target.date, venue: target.venue, opponent: s.team === target.team1 ? target.team2 : target.team1, season: target.season };
      expect(buildFeatures(full, a).features).toEqual(buildFeatures(cut, a).features);
    }
  });
  it("competitions stay separate: WPL data never contains men's rows", () => {
    const wpl = loadCompetition("WPL");
    expect(wpl.matches.every((x) => x.gender === "female")).toBe(true);
    expect(wpl.stats.every((s) => s.competition === "WPL")).toBe(true);
    expect(() => buildCompetitionData("WPL", [], [stats({ competition: "IPL" })], {})).toThrow();
  });
});
