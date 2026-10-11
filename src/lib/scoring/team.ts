/**
 * Team scorer: applies captain / vice-captain multipliers exactly once to BASE player points.
 */
import type { RulesConfig } from "./types";

export interface TeamScoreInput {
  playerIds: string[];
  captainId: string;
  viceCaptainId: string;
  basePoints: Record<string, number | null | undefined>;
}

export interface TeamScoreLine {
  playerId: string;
  basePoints: number | null;
  multiplier: number;
  contribution: number | null;
}

export interface TeamScore {
  total: number | null;
  /** Players without a base score (missing input). total is null if any are missing. */
  missing: string[];
  lines: TeamScoreLine[];
  rulesId: string;
}

export function multiplierFor(playerId: string, captainId: string, viceCaptainId: string, rules: Pick<RulesConfig, "multipliers">) {
  if (playerId === captainId) return rules.multipliers.captain;
  if (playerId === viceCaptainId) return rules.multipliers.viceCaptain;
  return 1;
}

export function scoreTeam(input: TeamScoreInput, rules: Pick<RulesConfig, "id" | "multipliers">): TeamScore {
  if (input.captainId === input.viceCaptainId) throw new Error("Captain and vice-captain must be different players");
  if (new Set(input.playerIds).size !== input.playerIds.length) throw new Error("Duplicate player in team");
  if (!input.playerIds.includes(input.captainId) || !input.playerIds.includes(input.viceCaptainId)) {
    throw new Error("Captain and vice-captain must be in the team");
  }
  const lines: TeamScoreLine[] = input.playerIds.map((id) => {
    const base = input.basePoints[id];
    const multiplier = multiplierFor(id, input.captainId, input.viceCaptainId, rules);
    return {
      playerId: id,
      basePoints: base ?? null,
      multiplier,
      contribution: base == null ? null : Math.round(base * multiplier * 100) / 100,
    };
  });
  const missing = lines.filter((l) => l.contribution == null).map((l) => l.playerId);
  const total = missing.length ? null : Math.round(lines.reduce((s, l) => s + (l.contribution ?? 0), 0) * 100) / 100;
  return { total, missing, lines, rulesId: rules.id };
}

/**
 * Convert user-entered actual points to base points. If the user entered points that already include
 * the C/VC multiplier, divide them out so the multiplier is never applied twice.
 */
export function toBasePoints(entered: number, includesMultiplier: boolean, multiplier: number) {
  if (!includesMultiplier) return entered;
  return Math.round((entered / multiplier) * 100) / 100;
}
