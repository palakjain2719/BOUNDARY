/**
 * Infer a fantasy role from a player's history BEFORE the target date. Cricsheet has no listed roles,
 * so this is labelled `inferred_history` everywhere it is shown. Imported/provider roles override it.
 */
import type { PlayerMatchStats, PlayerRole } from "./types";

export interface RoleEvidence {
  role: PlayerRole;
  matches: number;
  avgBallsBowled: number;
  avgBallsFaced: number;
  avgBattingPosition: number | null;
  stumpings: number;
  reason: string;
}

export function inferRole(prior: PlayerMatchStats[]): RoleEvidence {
  const n = prior.length;
  if (n === 0) {
    return { role: "BAT", matches: 0, avgBallsBowled: 0, avgBallsFaced: 0, avgBattingPosition: null, stumpings: 0, reason: "No prior matches; defaulted to batter (low confidence)" };
  }
  const recent = prior.slice(-20);
  const m = recent.length;
  const avgBallsBowled = recent.reduce((s, r) => s + r.ballsBowled, 0) / m;
  const avgBallsFaced = recent.reduce((s, r) => s + r.ballsFaced, 0) / m;
  const positions = recent.filter((r) => r.battingPosition != null).map((r) => r.battingPosition!);
  const avgBattingPosition = positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : null;
  const stumpings = prior.reduce((s, r) => s + r.stumpings, 0);
  const base = { matches: n, avgBallsBowled, avgBallsFaced, avgBattingPosition, stumpings };
  const r1 = (x: number) => Math.round(x * 10) / 10;

  if (stumpings > 0 && avgBallsBowled < 3) {
    return { ...base, role: "WK", reason: `${stumpings} career stumpings and rarely bowls` };
  }
  const bowlShare = recent.filter((r) => r.ballsBowled >= 6).length / m;
  const batShare = recent.filter((r) => r.ballsFaced >= 5 && r.battingPosition != null && r.battingPosition <= 7).length / m;
  if (bowlShare >= 0.4 && batShare >= 0.4) {
    return { ...base, role: "AR", reason: `Bowled in ${Math.round(bowlShare * 100)}% and batted top-7 in ${Math.round(batShare * 100)}% of the last ${m} matches` };
  }
  if (avgBallsBowled >= 9) {
    return { ...base, role: "BOWL", reason: `Bowls ${r1(avgBallsBowled)} balls per match (last ${m})` };
  }
  return { ...base, role: "BAT", reason: `Bats at ~${avgBattingPosition ? r1(avgBattingPosition) : "?"}, bowls ${r1(avgBallsBowled)} balls per match` };
}
