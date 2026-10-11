/**
 * Reconciliation report: reconstructed points (calculator + Cricsheet events) vs Kaggle Dream11 IPL labels.
 * Writes data/processed/reconciliation_report.json and prints a summary. Does NOT treat Kaggle labels as
 * identical to reconstruction; it measures the gap per component and season.
 *
 * Usage: npx tsx scripts/reconcile-kaggle.ts [rulesId]
 */
import fs from "node:fs";
import path from "node:path";
import { loadCompetition, loadKaggleLabels, PROCESSED_DIR } from "../src/lib/data/historical";
import { inferRole } from "../src/lib/data/roles";
import { scorePlayer } from "../src/lib/scoring/calculator";
import { getRules } from "../src/lib/scoring/registry";

const rulesId = process.argv[2] ?? "kaggle-ipl-legacy-inferred";
const rules = getRules(rulesId);
const ipl = loadCompetition("IPL");
const labels = loadKaggleLabels().filter((l) => l.playerId);

type Agg = { n: number; exactTotal: number; exactBat: number; exactBowl: number; exactField: number; absErr: number; bias: number };
const mk = (): Agg => ({ n: 0, exactTotal: 0, exactBat: 0, exactBowl: 0, exactField: 0, absErr: 0, bias: 0 });
const overall = mk();
const bySeason: Record<string, Agg> = {};
const mismatchSamples: unknown[] = [];
let missingStats = 0;

for (const l of labels) {
  const stats = ipl.statsByMatch.get(l.matchId)?.find((s) => s.playerId === l.playerId);
  if (!stats) {
    missingStats++;
    continue;
  }
  const match = ipl.matchById.get(l.matchId)!;
  const prior = (ipl.statsByPlayer.get(l.playerId!) ?? []).filter((s) => ipl.matchById.get(s.matchId)!.date < match.date);
  const role = inferRole(prior).role;
  const sc = scorePlayer(stats, role, rules);
  const bat = sc.byCategory.batting + sc.byCategory.strike_rate;
  const bowl = sc.byCategory.bowling + sc.byCategory.economy;
  const field = sc.byCategory.fielding;
  // Kaggle total includes the 4-point Starting_11 value; reconstruction includes participation once.
  const total = sc.basePoints;
  const a = (bySeason[l.season] ??= mk());
  for (const g of [overall, a]) {
    g.n++;
    if (Math.abs(total - l.totalFP) < 1e-6) g.exactTotal++;
    if (Math.abs(bat - l.battingFP) < 1e-6) g.exactBat++;
    if (Math.abs(bowl - l.bowlingFP) < 1e-6) g.exactBowl++;
    if (Math.abs(field - l.fieldingFP) < 1e-6) g.exactField++;
    g.absErr += Math.abs(total - l.totalFP);
    g.bias += total - l.totalFP;
  }
  if (Math.abs(total - l.totalFP) > 1e-6 && mismatchSamples.length < 40) {
    mismatchSamples.push({
      matchId: l.matchId, season: l.season, player: l.kaggleName, role,
      kaggle: { bat: l.battingFP, bowl: l.bowlingFP, field: l.fieldingFP, total: l.totalFP },
      reconstructed: { bat, bowl, field, total },
      stats: { runs: stats.runs, balls: stats.ballsFaced, fours: stats.fours, sixes: stats.sixes, dismissed: stats.dismissalKind, wk: stats.wickets, lbwb: stats.lbwBowledWickets, bb: stats.ballsBowled, rc: stats.runsConceded, maid: stats.maidens, c: stats.catches, st: stats.stumpings, rod: stats.runOutsDirect, roi: stats.runOutsIndirect, sub: stats.substituteIn, xi: stats.inAnnouncedXI },
    });
  }
}

const fmt = (g: Agg) => ({
  rows: g.n,
  exactTotalPct: +(100 * g.exactTotal / g.n).toFixed(2),
  exactBattingPct: +(100 * g.exactBat / g.n).toFixed(2),
  exactBowlingPct: +(100 * g.exactBowl / g.n).toFixed(2),
  exactFieldingPct: +(100 * g.exactField / g.n).toFixed(2),
  mae: +(g.absErr / g.n).toFixed(3),
  bias: +(g.bias / g.n).toFixed(3),
});
const report = {
  generatedAt: new Date().toISOString(),
  rulesId: rules.id,
  rulesVersion: rules.version,
  rulesStatus: rules.status,
  comparedRows: overall.n,
  labelRowsWithoutCricsheetStats: missingStats,
  note: "Only high-confidence identity-mapped Kaggle rows are compared. Roles are inferred from prior history, which affects duck/strike-rate exemptions. Kaggle labels remain the source of truth for 2008–2023 men's IPL; reconstruction is not substituted for them.",
  overall: fmt(overall),
  bySeason: Object.fromEntries(Object.entries(bySeason).sort().map(([k, v]) => [k, fmt(v)])),
  mismatchSamples,
};
const out = path.join(PROCESSED_DIR, `reconciliation_${rules.id}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, mismatchSamples: report.mismatchSamples.slice(0, 12) }, null, 1));
