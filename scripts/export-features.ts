/**
 * Export the leakage-safe pre-match feature matrix for offline training (ml/train_benchmark.py).
 * One row per player who took part in a match (announced XI or substitute).
 *
 * Targets:
 *   IPL: target_kaggle_total (Dream11 labels from the Kaggle dataset, 2008–2023, high-confidence mapping only)
 *   both: target_reconstructed (calculator output, label_status reconstructed_unverified)
 * Usage: npx tsx scripts/export-features.ts
 */
import fs from "node:fs";
import path from "node:path";
import { loadCompetition, loadKaggleLabels, PROCESSED_DIR } from "../src/lib/data/historical";
import { assertFeatureSchema, buildFeatures, buildHistoryIndex, FEATURE_ALLOWLIST, rolePriors } from "../src/lib/features/history";
import { predictBaseline } from "../src/lib/models/baseline";
import { defaultRulesFor } from "../src/lib/scoring/registry";
import type { Competition } from "../src/lib/data/types";

assertFeatureSchema([...FEATURE_ALLOWLIST]);

function split(competition: Competition, season: string, date: string) {
  if (competition === "IPL") {
    const y = Number(date.slice(0, 4));
    if (y <= 2019) return "train";
    if (y <= 2021) return "validation";
    if (y <= 2023) return "test";
    return "post_label_period";
  }
  return `wpl_${season.replace("/", "_")}`;
}

for (const competition of ["IPL", "WPL"] as Competition[]) {
  const data = loadCompetition(competition);
  const rules = defaultRulesFor(competition);
  const idx = buildHistoryIndex(data, rules);
  const labels = new Map<string, number>();
  if (competition === "IPL") for (const l of loadKaggleLabels()) if (l.playerId) labels.set(`${l.matchId}|${l.playerId}`, l.totalFP);

  const header = ["competition", "match_id", "match_date", "season", "player_id", "split", "role_inferred", "target_kaggle_total", "target_reconstructed", "baseline_pred", "baseline_p10", "baseline_p90", ...FEATURE_ALLOWLIST];
  const lines = [header.join(",")];
  const t = Date.now();
  for (const m of data.matches) {
    const rows = idx.byMatch.get(m.id) ?? [];
    const priors = rolePriors(idx, m.date);
    for (const r of rows) {
      if (!r.stats.inAnnouncedXI && !r.stats.substituteIn) continue;
      const opponent = r.stats.team === m.team1 ? m.team2 : m.team1;
      const pf = buildFeatures(idx, { playerId: r.stats.playerId, matchId: m.id, targetDate: m.date, venue: m.venue, opponent, season: m.season });
      const bp = predictBaseline(pf, priors[pf.role.role]);
      const label = labels.get(`${m.id}|${r.stats.playerId}`);
      const vals = [
        competition, m.id, m.date, m.season, r.stats.playerId, split(competition, m.season, m.date), pf.role.role,
        label ?? "", r.points, bp.mean, bp.p10, bp.p90,
        ...FEATURE_ALLOWLIST.map((k) => { const v = pf.features[k]; return v == null ? "" : Math.round(v * 1000) / 1000; }),
      ];
      lines.push(vals.join(","));
    }
  }
  const out = path.join(PROCESSED_DIR, `features_${competition.toLowerCase()}.csv`);
  fs.writeFileSync(out, lines.join("\n"));
  console.log(`${competition}: ${lines.length - 1} rows -> ${out} (${((Date.now() - t) / 1000).toFixed(1)}s), rules ${rules.id}`);
}
