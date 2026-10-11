import type { PlayerMatchStats, PoolPlayer, PlayerRole } from "@/lib/data/types";

export function stats(o: Partial<PlayerMatchStats> = {}): PlayerMatchStats {
  return {
    matchId: "m1", playerId: "p1", team: "A", competition: "IPL", inAnnouncedXI: true, substituteIn: null, batted: false, battingPosition: null,
    runs: 0, ballsFaced: 0, fours: 0, sixes: 0, dismissed: false, dismissalKind: null, ballsBowled: 0, runsConceded: 0, wickets: 0,
    lbwBowledWickets: 0, dotBalls: 0, maidens: 0, catches: 0, stumpings: 0, runOutsDirect: 0, runOutsIndirect: 0, ...o,
  };
}

export function player(id: string, team: string, role: PlayerRole, credits: number | null = 8): PoolPlayer {
  return { playerId: id, name: id, team, role, roleSource: "imported", credits, creditSource: credits == null ? "none" : "imported", announced: true };
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
