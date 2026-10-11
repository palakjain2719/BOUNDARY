/**
 * Idempotent seeding of Supabase reference tables: scoring and team rules configs, model versions, players and
 * archived Cricsheet matches. Existing rows are never overwritten (ignoreDuplicates), so pipeline-owned rows such
 * as simulated fixtures keep their state. Used by scripts/seed-supabase.ts and the first pipeline tick.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCompetition } from "../data/historical";
import { builtinModels } from "../models/registry";
import { listTeamRules } from "../optimizer/rules";
import { listRules } from "../scoring/registry";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

async function insertMissing(sb: Client, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict, ignoreDuplicates: true });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

export async function seedReferenceData(sb: Client): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out.rules_configs = await insertMissing(
    sb,
    "rules_configs",
    listRules().map((r) => ({
      id: r.id, version: r.version, name: r.name, competitions: r.competitions, format: r.format, effective_from: r.effectiveFrom, effective_to: r.effectiveTo,
      official_source_url: r.officialSourceUrl, verified_at: r.verifiedAt, status: r.status, config: r, notes: r.notes.join("\n"),
    })),
    "id,version",
  );
  out.team_rules_configs = await insertMissing(sb, "team_rules_configs", listTeamRules().map((t) => ({ id: t.id, version: t.version, status: t.status, config: t, verified_at: t.verifiedAt })), "id,version");
  out.model_versions = await insertMissing(
    sb,
    "model_versions",
    builtinModels().map((m) => ({
      id: m.id, name: m.name, kind: m.kind, competition: m.competition, status: m.status, training_cutoff: m.trainingCutoff, feature_schema_version: m.featureSchemaVersion,
      rule_target_id: m.ruleTargetId, target_label_source: m.targetLabelSource, metrics: m.metrics, artifact_path: m.artifactPath, servable: m.servable, notes: m.notes, created_at: m.createdAt,
    })),
    "id",
  );
  for (const c of ["IPL", "WPL"] as const) {
    const d = loadCompetition(c);
    out[`players_${c}`] = await insertMissing(sb, "players", Object.entries(d.names).map(([id, name]) => ({ id, name, gender: c === "IPL" ? "male" : "female", source: "cricsheet" })), "id");
    out[`matches_${c}`] = await insertMissing(
      sb,
      "matches",
      d.matches.map((m) => ({
        id: m.id, competition: c, origin: "cricsheet_replay", season: m.season, match_date: m.date, venue: m.venue, city: m.city, team1: m.team1, team2: m.team2,
        status: "completed", toss_winner: m.tossWinner, toss_decision: m.tossDecision, winner: m.winner, result: m.result, source: m.source,
      })),
      "id",
    );
  }
  return out;
}

/** True when every rules config and model version this build needs exists (cheap check before each tick). */
export async function referenceDataComplete(sb: Client): Promise<boolean> {
  const [{ count: rules }, { count: models }] = await Promise.all([
    sb.from("rules_configs").select("id", { count: "exact", head: true }),
    sb.from("model_versions").select("id", { count: "exact", head: true }),
  ]);
  return (rules ?? 0) >= listRules().length && (models ?? 0) >= builtinModels().length;
}
