import { describe, expect, it } from "vitest";
import { scorePlayer, inBand } from "@/lib/scoring/calculator";
import { assertNoBandOverlap, getRules, listRules, rulesSchema } from "@/lib/scoring/registry";
import { scoreTeam, toBasePoints } from "@/lib/scoring/team";
import type { RulesConfig } from "@/lib/scoring/types";
import { stats } from "./helpers";

const legacy = getRules("kaggle-ipl-legacy-inferred");
const modern = getRules("dream11-t20-modern-draft");
const item = (s: ReturnType<typeof scorePlayer>, code: string) => s.lineItems.find((i) => i.code === code);

describe("participation", () => {
  it("awards announced-XI points once and never also as substitute", () => {
    const s = scorePlayer(stats({ inAnnouncedXI: true, substituteIn: null }), "BAT", legacy);
    expect(s.basePoints).toBe(4);
    expect(s.lineItems.filter((i) => i.category === "participation")).toHaveLength(1);
  });
  it("awards substitute points to an impact player who entered", () => {
    const s = scorePlayer(stats({ inAnnouncedXI: false, substituteIn: "impact_player" }), "BAT", legacy);
    expect(item(s, "participation.substitute")?.points).toBe(4);
    expect(item(s, "participation.announced_xi")).toBeUndefined();
  });
  it("gives nothing to a player who neither started nor came on", () => {
    const s = scorePlayer(stats({ inAnnouncedXI: false }), "BAT", legacy);
    expect(s.basePoints).toBe(0);
    expect(s.omitted.some((o) => o.code === "participation")).toBe(true);
  });
});

describe("batting", () => {
  it("reproduces a Kaggle example: 92 off 50 with 4 fours and 9 sixes = 128 batting points", () => {
    const s = scorePlayer(stats({ batted: true, runs: 92, ballsFaced: 50, fours: 4, sixes: 9, dismissed: true, dismissalKind: "caught" }), "BAT", legacy);
    expect(s.byCategory.batting + s.byCategory.strike_rate).toBe(128);
  });
  it("applies only the highest milestone in highest_only mode", () => {
    const s = scorePlayer(stats({ batted: true, runs: 100, ballsFaced: 60 }), "BAT", legacy);
    expect(item(s, "batting.milestone_100")?.points).toBe(16);
    expect(item(s, "batting.milestone_50")).toBeUndefined();
    expect(item(s, "batting.milestone_30")).toBeUndefined();
  });
  it("applies every milestone in cumulative mode", () => {
    const cum: RulesConfig = { ...legacy, batting: { ...legacy.batting, milestoneMode: "cumulative" } };
    const s = scorePlayer(stats({ batted: true, runs: 100, ballsFaced: 60 }), "BAT", cum);
    expect(s.lineItems.filter((i) => i.code.startsWith("batting.milestone")).map((i) => i.points)).toEqual([4, 8, 16]);
  });
  it("milestone boundary: 29 gets nothing, 30 gets the 30-run bonus", () => {
    expect(item(scorePlayer(stats({ batted: true, runs: 29, ballsFaced: 25 }), "BAT", legacy), "batting.milestone_30")).toBeUndefined();
    expect(item(scorePlayer(stats({ batted: true, runs: 30, ballsFaced: 25 }), "BAT", legacy), "batting.milestone_30")?.points).toBe(4);
  });
  it("duck: penalised for batters, exempt for bowlers, not for retired hurt or not-out zero", () => {
    expect(item(scorePlayer(stats({ batted: true, dismissed: true, dismissalKind: "bowled", ballsFaced: 3 }), "BAT", legacy), "batting.duck")?.points).toBe(-2);
    expect(item(scorePlayer(stats({ batted: true, dismissed: true, dismissalKind: "bowled", ballsFaced: 3 }), "BOWL", legacy), "batting.duck")).toBeUndefined();
    expect(item(scorePlayer(stats({ batted: true, dismissed: true, dismissalKind: "retired hurt", ballsFaced: 3 }), "BAT", legacy), "batting.duck")).toBeUndefined();
    expect(item(scorePlayer(stats({ batted: true, dismissed: false, ballsFaced: 3 }), "BAT", legacy), "batting.duck")).toBeUndefined();
  });
});

describe("strike rate and economy thresholds", () => {
  const sr = (runs: number, balls: number, role: "BAT" | "BOWL" = "BAT", rules = legacy) => item(scorePlayer(stats({ batted: true, runs, ballsFaced: balls }), role, rules), "strike_rate")?.points ?? 0;
  it("requires the minimum balls", () => {
    expect(sr(0, 9)).toBe(0);
    expect(sr(4, 10)).toBe(-6); // SR 40
  });
  it("band edges", () => {
    expect(sr(13, 10)).toBe(2); // 130 inclusive
    expect(sr(15, 10)).toBe(2); // 150 inclusive in 130–150
    expect(sr(151, 100)).toBe(4); // 151
    expect(sr(17, 10)).toBe(4); // 170 inclusive
    expect(sr(171, 100)).toBe(6); // >170
    expect(sr(7, 10)).toBe(-2); // 70 inclusive
    expect(sr(71, 100)).toBe(0); // 71 neutral
    expect(sr(5, 10)).toBe(-4); // 50
    expect(sr(49, 100)).toBe(-6);
  });
  it("respects role exemptions configured per version", () => {
    const exempt: RulesConfig = { ...legacy, strikeRate: { ...legacy.strikeRate, exemptRoles: ["BOWL"] } };
    expect(sr(4, 10, "BOWL", exempt)).toBe(0);
    expect(sr(4, 10, "BOWL", legacy)).toBe(-6);
  });
  const ec = (conceded: number, balls: number) => item(scorePlayer(stats({ ballsBowled: balls, runsConceded: conceded }), "BOWL", legacy), "economy")?.points ?? 0;
  it("economy needs 2 overs and uses inclusive/exclusive edges", () => {
    expect(ec(0, 11)).toBe(0);
    expect(ec(9, 12)).toBe(6); // 4.5
    expect(ec(10, 12)).toBe(4); // 5.0
    expect(ec(12, 12)).toBe(2); // 6.0
    expect(ec(14, 12)).toBe(2); // 7.0
    expect(ec(20, 12)).toBe(-2); // 10.0
    expect(ec(22, 12)).toBe(-2); // 11.0
    expect(ec(24, 12)).toBe(-4); // 12.0
    expect(ec(25, 12)).toBe(-6); // 12.5
  });
});

describe("bowling and fielding", () => {
  it("counts LBW/bowled bonus and highest haul bonus only", () => {
    const s = scorePlayer(stats({ wickets: 5, lbwBowledWickets: 2, ballsBowled: 24, runsConceded: 30 }), "BOWL", legacy);
    expect(item(s, "bowling.wickets")?.points).toBe(125);
    expect(item(s, "bowling.lbw_bowled")?.points).toBe(16);
    expect(item(s, "bowling.haul_5")?.points).toBe(16);
    expect(item(s, "bowling.haul_4")).toBeUndefined();
  });
  it("run-outs are fielding credits, never bowler wickets", () => {
    const s = scorePlayer(stats({ runOutsDirect: 1, runOutsIndirect: 2 }), "BAT", legacy);
    expect(item(s, "bowling.wickets")).toBeUndefined();
    expect(s.byCategory.fielding).toBe(12 + 12);
  });
  it("3-catch bonus and dot balls depend on the rules version", () => {
    expect(item(scorePlayer(stats({ catches: 3 }), "BAT", legacy), "fielding.catch_bonus")?.points).toBe(4);
    expect(item(scorePlayer(stats({ dotBalls: 10, ballsBowled: 24, runsConceded: 30 }), "BOWL", legacy), "bowling.dot_balls")).toBeUndefined();
    expect(item(scorePlayer(stats({ dotBalls: 10, ballsBowled: 24, runsConceded: 30 }), "BOWL", modern), "bowling.dot_balls")?.points).toBe(10);
  });
  it("line items sum exactly to base points and carry the rules version", () => {
    const s = scorePlayer(stats({ batted: true, runs: 57, ballsFaced: 33, fours: 5, sixes: 3, wickets: 2, lbwBowledWickets: 1, ballsBowled: 24, runsConceded: 26, maidens: 1, catches: 1 }), "AR", legacy);
    expect(s.lineItems.reduce((a, b) => a + b.points, 0)).toBeCloseTo(s.basePoints, 6);
    expect(s.rulesId).toBe(legacy.id);
    expect(s.rulesVersion).toBe(legacy.version);
  });
});

describe("rules versioning", () => {
  it("every config validates and has non-overlapping bands", () => {
    for (const r of listRules()) {
      expect(() => rulesSchema.parse(r)).not.toThrow();
      expect(() => assertNoBandOverlap(r)).not.toThrow();
    }
  });
  it("a verified config must carry verifiedAt", () => {
    expect(() => rulesSchema.parse({ ...legacy, status: "verified", verifiedAt: null })).toThrow();
  });
  it("no supplied config is marked verified (nothing has been verified against official rules)", () => {
    expect(listRules().every((r) => r.status !== "verified")).toBe(true);
  });
  it("different versions give different scores for the same events", () => {
    const st = stats({ batted: true, runs: 40, ballsFaced: 25, fours: 4, sixes: 2 });
    expect(scorePlayer(st, "BAT", legacy).basePoints).not.toBe(scorePlayer(st, "BAT", modern).basePoints);
  });
  it("inBand honours inclusive and exclusive bounds", () => {
    expect(inBand(150, { gt: 150, lte: 170, points: 4, label: "" })).toBe(false);
    expect(inBand(150.01, { gt: 150, lte: 170, points: 4, label: "" })).toBe(true);
  });
});

describe("team scoring: multipliers applied once", () => {
  const base = { a: 10, b: 20, c: 30 };
  it("applies C 2x and VC 1.5x to base points", () => {
    const t = scoreTeam({ playerIds: ["a", "b", "c"], captainId: "c", viceCaptainId: "b", basePoints: base }, legacy);
    expect(t.total).toBe(10 + 30 + 60);
  });
  it("rejects same captain and vice-captain, duplicates, and leaders outside the team", () => {
    expect(() => scoreTeam({ playerIds: ["a", "b"], captainId: "a", viceCaptainId: "a", basePoints: base }, legacy)).toThrow();
    expect(() => scoreTeam({ playerIds: ["a", "a"], captainId: "a", viceCaptainId: "b", basePoints: base }, legacy)).toThrow();
    expect(() => scoreTeam({ playerIds: ["a", "b"], captainId: "c", viceCaptainId: "b", basePoints: base }, legacy)).toThrow();
  });
  it("returns null total when an actual is missing", () => {
    expect(scoreTeam({ playerIds: ["a", "x"], captainId: "a", viceCaptainId: "x", basePoints: base }, legacy).total).toBeNull();
  });
  it("divides out multipliers from entered values exactly once", () => {
    expect(toBasePoints(120, true, 2)).toBe(60);
    expect(toBasePoints(90, true, 1.5)).toBe(60);
    expect(toBasePoints(60, false, 2)).toBe(60);
  });
});
