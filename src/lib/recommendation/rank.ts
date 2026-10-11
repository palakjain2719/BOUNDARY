/**
 * Advisory match prioritisation. A transparent weighted score of data readiness and context; it is NOT a
 * prediction of a better fantasy result and is labelled "advisory" until validated.
 */
import { loadCompetition } from "../data/historical";
import type { Competition } from "../data/types";
import { buildHistoryIndex, priorRows } from "../features/history";
import { defaultRulesFor } from "../scoring/registry";

export const RANK_WEIGHTS = {
  dataReadiness: 0.35,
  lineupConfirmed: 0.2,
  labelSupport: 0.15,
  certainty: 0.2,
  timeToDecide: 0.1,
};

export interface RankInput {
  matchId: string;
  competition: Competition;
  date: string;
  startTimeUtc: string | null;
  poolPlayerIds: string[];
  lineupConfirmed: boolean;
  isReplay: boolean;
}

export interface RankResult {
  matchId: string;
  score: number;
  components: Record<keyof typeof RANK_WEIGHTS, number>;
  reasons: string[];
  label: "advisory";
}

export function rankMatches(inputs: RankInput[], now = new Date(), weights = RANK_WEIGHTS): RankResult[] {
  return inputs
    .map((m) => {
      const data = loadCompetition(m.competition);
      const idx = buildHistoryIndex(data, defaultRulesFor(m.competition));
      const priors = m.poolPlayerIds.map((p) => priorRows(idx, p, m.date));
      const ready = priors.length ? priors.filter((r) => r.length >= 5).length / priors.length : 0;
      const stds = priors
        .filter((r) => r.length >= 3)
        .map((r) => {
          const xs = r.slice(-10).map((x) => x.points);
          const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
          return Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, xs.length - 1));
        });
      const meanStd = stds.length ? stds.reduce((a, b) => a + b, 0) / stds.length : 40;
      const certainty = Math.max(0, Math.min(1, 1 - (meanStd - 15) / 30));
      const labelSupport = m.competition === "IPL" ? (m.date <= "2023-12-31" ? 1 : 0.7) : 0.4;
      let timeToDecide = m.isReplay ? 0.5 : 0;
      if (m.startTimeUtc) {
        const hrs = (Date.parse(m.startTimeUtc) - now.getTime()) / 3600_000;
        timeToDecide = hrs < 0 ? 0 : hrs <= 2 ? 0.6 : hrs <= 24 ? 1 : Math.max(0.2, 1 - (hrs - 24) / 144);
      }
      const components = { dataReadiness: ready, lineupConfirmed: m.lineupConfirmed ? 1 : 0, labelSupport, certainty, timeToDecide };
      const score = Object.entries(weights).reduce((s, [k, w]) => s + w * components[k as keyof typeof weights], 0);
      const reasons = [
        `${Math.round(ready * 100)}% of the pool has 5+ earlier ${m.competition} matches`,
        m.lineupConfirmed ? "Playing XI confirmed" : "Playing XI not confirmed yet",
        m.competition === "IPL"
          ? m.date <= "2023-12-31"
            ? "Season covered by Dream11 labels"
            : "After the labelled seasons: actuals are reconstructed"
          : "WPL labels are reconstructed_unverified",
        `Typical player spread ±${Math.round(meanStd)} pts`,
      ];
      return { matchId: m.matchId, score: Math.round(score * 100), components, reasons, label: "advisory" as const };
    })
    .sort((a, b) => b.score - a.score);
}
