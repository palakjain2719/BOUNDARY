/**
 * Transparent recency baseline: exponentially-weighted mean of the player's prior base points,
 * shrunk toward the role mean when history is short. Uncertainty blends the player's own spread with
 * the role spread. Labelled as a baseline everywhere it is shown.
 */
import type { PlayerFeatures } from "../features/history";
import type { Prediction } from "./types";

export const BASELINE_ID = "recency-baseline-v1";
export const SHRINK_K = 3;
const Z80 = 1.2816;

export function predictBaseline(
  pf: PlayerFeatures,
  rolePrior: { mean: number; std: number },
  opts: { venueWeight?: number } = {},
): Prediction {
  const f = pf.features;
  const n = Math.min(pf.priorCount, 10);
  const own = f.pts_ewm_hl5 ?? rolePrior.mean;
  let mean = (n * own + SHRINK_K * rolePrior.mean) / (n + SHRINK_K);
  const explanation: string[] = [];
  explanation.push(
    pf.priorCount
      ? `Recency-weighted average ${own.toFixed(1)} pts over ${pf.priorCount} earlier matches, shrunk toward the ${pf.role.role} average ${rolePrior.mean.toFixed(1)} (k=${SHRINK_K}).`
      : `No earlier matches: using the ${pf.role.role} average ${rolePrior.mean.toFixed(1)} pts.`,
  );
  // Optional venue adjustment (weight is configurable and starts at 0 until a backtest supports it).
  const vw = opts.venueWeight ?? 0;
  if (vw && f.player_venue_pts_mean != null && (f.player_venue_matches ?? 0) >= 3) {
    const delta = f.player_venue_pts_mean - (f.pts_mean_all ?? mean);
    mean += vw * delta;
    explanation.push(`Venue adjustment ${vw} × (${f.player_venue_pts_mean.toFixed(1)} at this venue − ${(f.pts_mean_all ?? 0).toFixed(1)} overall).`);
  }
  const ownStd = f.pts_std_last10 ?? rolePrior.std;
  const sigma = Math.sqrt((n * ownStd ** 2 + SHRINK_K * rolePrior.std ** 2) / (n + SHRINK_K));
  return {
    playerId: pf.playerId,
    modelId: BASELINE_ID,
    mean: Math.round(mean * 10) / 10,
    p10: Math.round((mean - Z80 * sigma) * 10) / 10,
    p90: Math.round((mean + Z80 * sigma) * 10) / 10,
    sigma: Math.round(sigma * 10) / 10,
    sampleSize: pf.priorCount,
    features: f,
    explanation,
  };
}
