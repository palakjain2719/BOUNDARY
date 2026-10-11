/**
 * Seed Supabase reference tables (service role): scoring and team rules configs, model versions, players and
 * the archived Cricsheet matches. Idempotent (upserts). Usage: npm run db:seed
 */
import { createClient } from "@supabase/supabase-js";
import { loadCompetition } from "../src/lib/data/historical";
import { builtinModels } from "../src/lib/models/registry";
import { listTeamRules } from "../src/lib/optimizer/rules";
import { listRules } from "../src/lib/scoring/registry";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side only) to seed.");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

async function upsert(table: string, rows: Record<string, unknown>[], onConflict?: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), onConflict ? { onConflict } : undefined);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  console.log(`${table}: ${rows.length} rows`);
}

(async () => {
  await upsert(
    "rules_configs",
    listRules().map((r) => ({
      id: r.id, version: r.version, name: r.name, competitions: r.competitions, format: r.format, effective_from: r.effectiveFrom, effective_to: r.effectiveTo,
      official_source_url: r.officialSourceUrl, verified_at: r.verifiedAt, status: r.status, config: r, notes: r.notes.join("\n"),
    })),
    "id,version",
  );
  await upsert("team_rules_configs", listTeamRules().map((t) => ({ id: t.id, version: t.version, status: t.status, config: t, verified_at: t.verifiedAt })), "id,version");
  await upsert(
    "model_versions",
    builtinModels().map((m) => ({
      id: m.id, name: m.name, kind: m.kind, competition: m.competition, status: m.status, training_cutoff: m.trainingCutoff, feature_schema_version: m.featureSchemaVersion,
      rule_target_id: m.ruleTargetId, target_label_source: m.targetLabelSource, metrics: m.metrics, artifact_path: m.artifactPath, servable: m.servable, notes: m.notes, created_at: m.createdAt,
    })),
  );
  for (const c of ["IPL", "WPL"] as const) {
    const d = loadCompetition(c);
    await upsert("players", Object.entries(d.names).map(([id, name]) => ({ id, name, gender: c === "IPL" ? "male" : "female", source: "cricsheet" })));
    await upsert(
      "matches",
      d.matches.map((m) => ({
        id: m.id, competition: c, origin: "cricsheet_replay", season: m.season, match_date: m.date, venue: m.venue, city: m.city, team1: m.team1, team2: m.team2,
        status: "completed", toss_winner: m.tossWinner, toss_decision: m.tossDecision, winner: m.winner, result: m.result, source: m.source,
      })),
    );
  }
  console.log("Seed complete.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
