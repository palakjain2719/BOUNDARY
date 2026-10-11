/**
 * Weighted-criteria model: a transparent blend of pre-match criteria whose weights can be reviewed and
 * (as a candidate) adjusted by the user on the Weights page. Missing criteria are dropped and the remaining
 * weights renormalised — a missing statistic is never treated as zero / poor performance.
 *
 * System-recommended weights are fitted on a chronological calibration window by projected gradient descent
 * on the probability simplex (non-negative, sum to 1). These are model weights, not fantasy scoring rules.
 */
import type { FeatureVector, PlayerFeatures } from "../features/history";
import type { Prediction } from "./types";

export interface Criterion {
  key: string;
  label: string;
  definition: string;
  value: (f: FeatureVector, rolePrior: number) => number | null;
}

const MIN_CONTEXT = 3;

export const CRITERIA: Criterion[] = [
  { key: "recent_form", label: "Recent form", definition: "Recency-weighted mean of the player's earlier fantasy points (half-life 5 matches).", value: (f) => f.pts_ewm_hl5 },
  { key: "last5", label: "Last 5 matches", definition: "Plain mean of the last five earlier matches.", value: (f) => f.pts_mean_last5 },
  { key: "season_form", label: "This season so far", definition: "Mean points in earlier matches of the same season.", value: (f) => f.pts_mean_season_prior },
  { key: "career", label: "Career average", definition: "Mean points over all earlier matches in this competition.", value: (f) => f.pts_mean_all },
  {
    key: "venue_history", label: "Player at this venue", definition: `Player's mean at this venue (only with ≥${MIN_CONTEXT} earlier venue matches).`,
    value: (f) => ((f.player_venue_matches ?? 0) >= MIN_CONTEXT ? f.player_venue_pts_mean : null),
  },
  {
    key: "opponent_history", label: "Player vs this opponent", definition: `Player's mean against this opponent (only with ≥${MIN_CONTEXT} earlier meetings).`,
    value: (f) => ((f.player_vs_opp_matches ?? 0) >= MIN_CONTEXT ? f.player_vs_opp_pts_mean : null),
  },
  { key: "venue_environment", label: "Venue scoring environment", definition: "Average points of all players in earlier matches at this venue.", value: (f) => f.venue_pts_mean_prior },
  { key: "role_prior", label: "Role baseline", definition: "Average points for the player's (inferred) role in earlier matches. Always available.", value: (_f, rp) => rp },
];

export type Weights = Record<string, number>;

export const EQUAL_WEIGHTS: Weights = Object.fromEntries(CRITERIA.map((c) => [c.key, 1 / CRITERIA.length]));

export function normalise(w: Weights): Weights {
  const clean = Object.fromEntries(CRITERIA.map((c) => [c.key, Math.max(0, Number(w[c.key] ?? 0))]));
  const s = Object.values(clean).reduce((a, b) => a + b, 0);
  return s > 0 ? Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, v / s])) : { ...EQUAL_WEIGHTS };
}

export function criteriaValues(f: FeatureVector, rolePrior: number): (number | null)[] {
  return CRITERIA.map((c) => {
    const v = c.value(f, rolePrior);
    return v == null || Number.isNaN(v) ? null : v;
  });
}

export function blend(values: (number | null)[], w: Weights): number {
  let num = 0;
  let den = 0;
  CRITERIA.forEach((c, i) => {
    const v = values[i];
    const wi = w[c.key] ?? 0;
    if (v != null && wi > 0) {
      num += wi * v;
      den += wi;
    }
  });
  return den > 0 ? num / den : (values[values.length - 1] ?? 0);
}

const Z80 = 1.2816;

export function predictWeighted(pf: PlayerFeatures, rolePrior: { mean: number; std: number }, weights: Weights, modelId: string): Prediction {
  const w = normalise(weights);
  const vals = criteriaValues(pf.features, rolePrior.mean);
  const mean = blend(vals, w);
  const n = Math.min(pf.priorCount, 10);
  const ownStd = pf.features.pts_std_last10 ?? rolePrior.std;
  const sigma = Math.sqrt((n * ownStd ** 2 + 3 * rolePrior.std ** 2) / (n + 3));
  const used = CRITERIA.map((c, i) => ({ c, v: vals[i], w: w[c.key] })).filter((x) => x.v != null && x.w > 0.02).sort((a, b) => b.w - a.w);
  const missing = CRITERIA.filter((c, i) => vals[i] == null && w[c.key] > 0.02).map((c) => c.label.toLowerCase());
  return {
    playerId: pf.playerId,
    modelId,
    mean: Math.round(mean * 10) / 10,
    p10: Math.round((mean - Z80 * sigma) * 10) / 10,
    p90: Math.round((mean + Z80 * sigma) * 10) / 10,
    sigma: Math.round(sigma * 10) / 10,
    sampleSize: pf.priorCount,
    features: pf.features,
    explanation: [
      `Weighted blend: ${used.slice(0, 4).map((x) => `${x.c.label} ${x.v!.toFixed(1)} (w ${(x.w * 100).toFixed(0)}%)`).join(", ")}.`,
      ...(missing.length ? [`Unavailable and excluded (not counted as zero): ${missing.join(", ")}.`] : []),
    ],
  };
}

export interface FitRow {
  values: (number | null)[];
  actual: number;
}

/** Projected gradient descent on the simplex minimising squared error. Deterministic. */
export function fitWeights(rows: FitRow[], iterations = 400, lr = 0.02): Weights {
  const k = CRITERIA.length;
  let w = Array(k).fill(1 / k);
  for (let it = 0; it < iterations; it++) {
    const grad = Array(k).fill(0);
    for (const r of rows) {
      let num = 0;
      let den = 0;
      for (let i = 0; i < k; i++) {
        const v = r.values[i];
        if (v != null && w[i] > 0) {
          num += w[i] * v;
          den += w[i];
        }
      }
      if (den <= 0) continue;
      const pred = num / den;
      const err = pred - r.actual;
      for (let i = 0; i < k; i++) {
        const v = r.values[i];
        if (v == null) continue;
        grad[i] += (2 * err * (v - pred)) / den;
      }
    }
    const scale = Math.max(...grad.map(Math.abs)) || 1;
    w = projectSimplex(w.map((wi, i) => wi - (lr * grad[i]) / scale));
  }
  return Object.fromEntries(CRITERIA.map((c, i) => [c.key, Math.round(w[i] * 1000) / 1000]));
}

export function projectSimplex(v: number[]): number[] {
  const u = [...v].sort((a, b) => b - a);
  let css = 0;
  let rho = 0;
  let theta = 0;
  for (let i = 0; i < u.length; i++) {
    css += u[i];
    const t = (css - 1) / (i + 1);
    if (u[i] - t > 0) {
      rho = i;
      theta = t;
    }
  }
  void rho;
  return v.map((x) => Math.max(0, x - theta));
}

export interface CriterionEvidence {
  key: string;
  label: string;
  definition: string;
  availableRows: number;
  totalRows: number;
  correlation: number | null;
  soloMae: number | null;
}

export function criterionEvidence(rows: FitRow[]): CriterionEvidence[] {
  return CRITERIA.map((c, i) => {
    const pairs = rows.filter((r) => r.values[i] != null).map((r) => [r.values[i]!, r.actual] as const);
    const n = pairs.length;
    let corr: number | null = null;
    if (n > 10) {
      const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
      const my = pairs.reduce((s, p) => s + p[1], 0) / n;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (const [x, y] of pairs) {
        sxy += (x - mx) * (y - my);
        sxx += (x - mx) ** 2;
        syy += (y - my) ** 2;
      }
      corr = sxx && syy ? Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000 : null;
    }
    const soloMae = n ? Math.round((pairs.reduce((s, p) => s + Math.abs(p[0] - p[1]), 0) / n) * 100) / 100 : null;
    return { key: c.key, label: c.label, definition: c.definition, availableRows: n, totalRows: rows.length, correlation: corr, soloMae };
  });
}
