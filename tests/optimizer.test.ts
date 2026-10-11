import { describe, expect, it } from "vitest";
import { getTeamRules, type TeamRules } from "@/lib/optimizer/rules";
import { optimizeTeam, optimizeWithCorrection, valueOf, type Candidate } from "@/lib/optimizer/solve";
import { diagnoseInfeasible } from "@/lib/optimizer/service";
import { validateTeam } from "@/lib/optimizer/validate";
import type { PlayerRole } from "@/lib/data/types";
import { player, rng } from "./helpers";

const ROLES: PlayerRole[] = ["WK", "BAT", "AR", "BOWL"];

function randomPool(seed: number, n = 22): Candidate[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const role: PlayerRole = i < 2 ? "WK" : i < 4 ? "BOWL" : i < 6 ? "AR" : i < 8 ? "BAT" : ROLES[Math.floor(r() * 4)];
    return { player: player(`p${i}`, i % 2 ? "A" : "B", role, 6.5 + Math.round(r() * 8) / 2), mean: 10 + r() * 60, sigma: 10 + r() * 30 };
  });
}

/** Brute force the joint (XI, C, VC) optimum for small pools. */
function brute(cands: Candidate[], rules: TeamRules, ra: number) {
  let best = -Infinity;
  const n = cands.length;
  const k = rules.squadSize;
  const idx: number[] = [];
  const rec = (start: number) => {
    if (idx.length === k) {
      const ids = idx.map((i) => cands[i].player.playerId);
      const v = validateTeam({ playerIds: ids, captainId: ids[0], viceCaptainId: ids[1] }, cands.map((c) => c.player), rules);
      if (!v.valid) return;
      const vals = idx.map((i) => valueOf(cands[i], ra)).sort((a, b) => b - a);
      const total = vals.reduce((a, b) => a + b, 0) + vals[0] + 0.5 * vals[1];
      if (total > best) best = total;
      return;
    }
    for (let i = start; i < n; i++) {
      idx.push(i);
      rec(i + 1);
      idx.pop();
    }
  };
  rec(0);
  return best;
}

describe("optimizer", () => {
  const modern = getTeamRules("dream11-t20-team-modern-draft");
  const legacy = getTeamRules("dream11-t20-team-legacy");

  it("returns teams that satisfy every hard constraint (randomised pools, both rule sets)", () => {
    for (let seed = 1; seed <= 25; seed++) {
      for (const rules of [modern, legacy]) {
        const c = randomPool(seed);
        const t = optimizeTeam(c, rules, { riskAversion: 0.25, captainMultiplier: 2, viceCaptainMultiplier: 1.5 });
        if (!t) continue;
        expect(t.validation.valid, JSON.stringify(t.validation.violations)).toBe(true);
        expect(t.playerIds).toHaveLength(11);
        expect(new Set(t.playerIds).size).toBe(11);
        expect(t.captainId).not.toBe(t.viceCaptainId);
        expect(t.validation.creditsUsed!).toBeLessThanOrEqual(rules.creditCap);
      }
    }
  });

  it("matches the brute-force joint optimum including captain and vice-captain", () => {
    const small: TeamRules = { ...modern, squadSize: 5, creditCap: 42, maxPerRealTeam: 4, roleLimits: { WK: [1, 2], BAT: [1, 3], AR: [1, 3], BOWL: [1, 3] } };
    for (let seed = 1; seed <= 12; seed++) {
      const c = randomPool(100 + seed, 11);
      const t = optimizeTeam(c, small, { riskAversion: 0.25, captainMultiplier: 2, viceCaptainMultiplier: 1.5 });
      const b = brute(c, small, 0.25);
      if (b === -Infinity) expect(t).toBeNull();
      else expect(t!.objective).toBeCloseTo(b, 1);
    }
  });

  it("captain gets the highest risk-adjusted value in the chosen XI (joint optimum property)", () => {
    const c = randomPool(7);
    const t = optimizeTeam(c, modern, { riskAversion: 0.25, captainMultiplier: 2, viceCaptainMultiplier: 1.5 })!;
    const v = (id: string) => valueOf(c.find((x) => x.player.playerId === id)!, 0.25);
    const vals = t.playerIds.map(v).sort((a, b) => b - a);
    expect(v(t.captainId)).toBeCloseTo(vals[0], 6);
    expect(v(t.viceCaptainId)).toBeCloseTo(vals[1], 6);
  });

  it("reports infeasibility with a reason instead of an invalid team", () => {
    const c = randomPool(3).map((x) => ({ ...x, player: { ...x.player, role: x.player.role === "WK" ? ("BAT" as const) : x.player.role } }));
    expect(optimizeTeam(c, modern, { riskAversion: 0, captainMultiplier: 2, viceCaptainMultiplier: 1.5 })).toBeNull();
    expect(diagnoseInfeasible(c.map((x) => x.player), modern).reasons.join(" ")).toMatch(/0 WK/);
  });

  it("correction loop forbids a lineup the validator rejects and re-solves", () => {
    const c = randomPool(11);
    const first = optimizeTeam(c, modern, { riskAversion: 0.25, captainMultiplier: 2, viceCaptainMultiplier: 1.5 })!;
    let calls = 0;
    // Simulate an external validator that rejects the first lineup.
    const t = optimizeWithCorrection(c, modern, { riskAversion: 0.25, captainMultiplier: 2, viceCaptainMultiplier: 1.5 }, (team) => {
      calls++;
      if (team.playerIds.slice().sort().join() === first.playerIds.slice().sort().join()) {
        return { ...team, validation: { ...team.validation, valid: false, violations: [{ code: "team_max", message: "rejected for test" }] } };
      }
      return team;
    })!;
    expect(calls).toBe(2);
    expect(t.attempts).toBe(2);
    expect(t.invalidCandidates).toBe(1);
    expect(t.playerIds.slice().sort().join()).not.toBe(first.playerIds.slice().sort().join());
  });

  it("the validator flags credit cap, role, team and leadership violations", () => {
    const picked = [player("w", "A", "WK", 12), ...Array.from({ length: 10 }, (_, i) => player(`b${i}`, "A", "BAT", 9))];
    const pool = [...picked, player("other", "B", "BOWL", 8)];
    const v = validateTeam({ playerIds: picked.map((p) => p.playerId), captainId: "w", viceCaptainId: "w" }, pool, legacy);
    const codes = v.violations.map((x) => x.code);
    for (const c of ["credit_cap", "role_max", "role_min", "team_max", "team_min", "captain_equals_vice"]) expect(codes).toContain(c);
    expect(v.label).toBe("Not valid");
  });

  it("never labels demo credits or draft rules as fully 'Rules validated'", () => {
    const c = randomPool(5).map((x) => ({ ...x, player: { ...x.player, creditSource: "estimated_demo" as const } }));
    const t = optimizeTeam(c, modern, { riskAversion: 0.25, captainMultiplier: 2, viceCaptainMultiplier: 1.5 })!;
    expect(t.validation.valid).toBe(true);
    expect(t.validation.fullyVerifiable).toBe(false);
    expect(t.validation.label).not.toBe("Rules validated");
  });
});
