/**
 * Access-control tests: applies the real Supabase migration to an in-process Postgres (PGlite) with a stub
 * `auth` schema, then exercises RLS policies and immutability triggers as anon / authenticated users.
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";
let db: PGlite;

async function as<T>(role: "anon" | "authenticated" | "postgres", uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  if (role !== "postgres") await db.exec(`set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
  // Another app in the same Supabase project (e.g. movie-matchmaker) already owns public.matches.
  await db.exec(`create table public.matches (id uuid primary key, couple_id uuid, title_id int); insert into public.matches values ('99999999-9999-4999-8999-999999999999', null, 42);`);
  const dir = path.join(__dirname, "..", "supabase", "migrations");
  for (const f of fs.readdirSync(dir).sort()) await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  await db.exec(`insert into auth.users values ('${ALICE}'), ('${BOB}');
    insert into boundary.rules_configs (id, version, name, competitions, official_source_url, status, config) values ('r', '1.0.0', 'r', '{IPL}', 'https://example.com', 'draft', '{}');
    insert into boundary.match_data_snapshots (id, match_id, competition, match_origin, decision_phase, snapshot_at, data_cutoff_date, model_version_id, rules_config_id, rules_config_version, team_rules_id, pool, context, content_hash, created_by)
      values ('11111111-1111-4111-8111-111111111111', 'm1', 'IPL', 'sim_replay', 'pre_match', now(), '2026-01-01', 'model', 'r', '1.0.0', 't', '[]', '{}', 'h', 'system');
    insert into boundary.user_teams (id, user_id, match_id, snapshot_id, captain_id, vice_captain_id, validation, predicted_total)
      values ('22222222-2222-4222-8222-222222222222', '${ALICE}', 'm1', '11111111-1111-4111-8111-111111111111', 'a', 'b', '{}', 500);
    insert into boundary.actual_player_points (id, user_id, match_id, player_id, entered_value, includes_multiplier, base_points, source, verification)
      values ('33333333-3333-4333-8333-333333333333', null, 'm1', 'p', 10, false, 10, 'reconstructed', 'reconstructed_unverified'),
             ('44444444-4444-4444-8444-444444444444', '${ALICE}', 'm1', 'p', 12, false, 12, 'manual', 'user_confirmed');
    insert into boundary.audit_logs (actor, action, entity, entity_id) values ('system', 'x', 'y', 'z');`);
}, 120_000);

describe("shared Supabase project", () => {
  it("leaves another app's public.matches table and data untouched", async () => {
    const cols = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'matches' order by ordinal_position`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(["id", "couple_id", "title_id"]);
    expect((await db.query("select * from public.matches")).rows).toHaveLength(1);
    const ours = (await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_schema = 'boundary'`)).rows[0].n;
    expect(ours).toBe(28);
  });
});

describe("row level security", () => {
  it("a user sees only their own teams", async () => {
    expect((await as("authenticated", ALICE, () => db.query("select id from boundary.user_teams"))).rows).toHaveLength(1);
    expect((await as("authenticated", BOB, () => db.query("select id from boundary.user_teams"))).rows).toHaveLength(0);
  });
  it("anonymous users cannot read user-owned rows", async () => {
    expect((await as("anon", null, () => db.query("select id from boundary.user_teams"))).rows).toHaveLength(0);
    expect((await as("anon", null, () => db.query("select id from boundary.actual_player_points"))).rows).toHaveLength(0);
  });
  it("a user cannot insert a row owned by someone else", async () => {
    await expect(
      as("authenticated", BOB, () =>
        db.query(`insert into boundary.user_teams (id, user_id, match_id, snapshot_id, captain_id, vice_captain_id, validation, predicted_total) values ('55555555-5555-4555-8555-555555555555', '${ALICE}', 'm1', '11111111-1111-4111-8111-111111111111', 'a', 'b', '{}', 1)`),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("system-collected actuals are visible to signed-in users; other users' entries are not", async () => {
    const bob = (await as("authenticated", BOB, () => db.query<{ user_id: string | null }>("select user_id from boundary.actual_player_points"))).rows;
    expect(bob).toEqual([{ user_id: null }]);
    expect((await as("authenticated", ALICE, () => db.query("select id from boundary.actual_player_points"))).rows).toHaveLength(2);
  });
  it("users cannot delete another user's team and cannot read the audit log", async () => {
    const r = await as("authenticated", BOB, () => db.query(`delete from boundary.user_teams where id = '22222222-2222-4222-8222-222222222222'`));
    expect(r.affectedRows ?? 0).toBe(0);
    expect((await as("authenticated", ALICE, () => db.query("select * from boundary.audit_logs"))).rows).toHaveLength(0);
  });
});

describe("immutability triggers", () => {
  it("snapshots cannot be updated or deleted, even by the owner role", async () => {
    await expect(db.query(`update boundary.match_data_snapshots set content_hash = 'x'`)).rejects.toThrow(/immutable/);
    await expect(db.query(`delete from boundary.match_data_snapshots`)).rejects.toThrow(/immutable/);
  });
  it("saved teams and actual points cannot be edited by their owner (RLS has no update policy)", async () => {
    await as("authenticated", ALICE, () => db.query(`update boundary.user_teams set predicted_total = 1`));
    await as("authenticated", ALICE, () => db.query(`update boundary.actual_player_points set base_points = 99 where user_id = '${ALICE}'`));
    expect((await db.query<{ predicted_total: string }>("select predicted_total from boundary.user_teams")).rows[0].predicted_total).toBe("500");
    expect((await db.query<{ base_points: string }>(`select base_points from boundary.actual_player_points where user_id = '${ALICE}'`)).rows[0].base_points).toBe("12");
  });
  it("…and the immutability trigger blocks even privileged (service-role-like) updates", async () => {
    await expect(db.query(`update boundary.user_teams set predicted_total = 1`)).rejects.toThrow(/immutable/);
    await expect(db.query(`update boundary.actual_player_points set base_points = 99`)).rejects.toThrow(/immutable/);
  });
  it("a job key can succeed only once", async () => {
    await db.exec(`insert into boundary.job_runs (id, job, key, status, started_at, clock_at, tick_id) values (gen_random_uuid(), 'prepare_analysis', 'k1', 'succeeded', now(), now(), gen_random_uuid())`);
    await expect(db.query(`insert into boundary.job_runs (id, job, key, status, started_at, clock_at, tick_id) values (gen_random_uuid(), 'prepare_analysis', 'k1', 'succeeded', now(), now(), gen_random_uuid())`)).rejects.toThrow(/duplicate key/);
  });
});
