-- Match Optimizer schema: reference data, immutable decision snapshots, user-owned teams, evaluation and
-- learning loop, notifications and audit. RLS is enabled on every table. Privileged writes use the
-- service role on the server only.
--
-- Everything lives in its own `boundary` schema so the app can share a Supabase project with other apps
-- (e.g. one that already has a public.matches table) without touching their tables or grants.
-- After running: Supabase Dashboard → Project Settings → Data API → Exposed schemas → add `boundary`.

create schema if not exists boundary;


-- ---------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------
create or replace function boundary.prevent_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is immutable: % is not allowed', tg_table_name, tg_op using errcode = '55000';
end $$;

create or replace function boundary.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------------------------------------
create table boundary.rules_configs (
  id text not null,
  version text not null,
  name text not null,
  competitions text[] not null,
  format text not null default 'T20',
  effective_from date,
  effective_to date,
  official_source_url text not null,
  verified_at timestamptz,
  status text not null check (status in ('draft', 'reviewed', 'verified')),
  config jsonb not null,
  notes text,
  created_at timestamptz not null default now(),
  primary key (id, version),
  constraint verified_needs_timestamp check (status <> 'verified' or verified_at is not null)
);

create table boundary.team_rules_configs (
  id text not null,
  version text not null,
  status text not null check (status in ('draft', 'reviewed', 'verified')),
  config jsonb not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (id, version)
);

create table boundary.teams (
  id text primary key,
  competition text not null check (competition in ('IPL', 'WPL')),
  name text not null,
  abbr text,
  unique (competition, name)
);

create table boundary.players (
  id text primary key,                    -- Cricsheet registry id, or provider id
  name text not null,
  gender text not null check (gender in ('male', 'female')),
  source text not null default 'cricsheet',
  created_at timestamptz not null default now()
);

create table boundary.matches (
  id text primary key,
  competition text not null check (competition in ('IPL', 'WPL')),
  origin text not null check (origin in ('cricsheet_replay', 'provider', 'csv_import', 'sim_replay')),
  provider_match_id text,
  start_time_assumed boolean not null default false,
  revision int not null default 1,
  last_synced_at timestamptz not null default now(),
  season text,
  match_date date not null,
  start_time_utc timestamptz,
  timezone text,
  venue text not null,
  city text,
  team1 text not null,
  team2 text not null,
  status text not null check (status in ('upcoming', 'live', 'completed')),
  toss_winner text,
  toss_decision text,
  winner text,
  result text,
  source text not null,
  provider_coverage jsonb,
  imported_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index matches_competition_date_idx on boundary.matches (competition, match_date);
create index matches_status_idx on boundary.matches (status, start_time_utc);
create trigger matches_touch before update on boundary.matches for each row execute function boundary.touch_updated_at();

create table boundary.match_player_pool (
  match_id text not null references boundary.matches (id) on delete cascade,
  player_id text not null,
  player_name text not null,
  team text not null,
  role text not null check (role in ('WK', 'BAT', 'AR', 'BOWL')),
  role_source text not null check (role_source in ('imported', 'provider', 'inferred_history')),
  credits numeric(4, 1),
  credit_source text not null check (credit_source in ('imported', 'provider', 'estimated_demo', 'none')),
  announced boolean,
  primary key (match_id, player_id)
);

create table boundary.model_versions (
  id text primary key,
  name text not null,
  kind text not null,
  competition text not null check (competition in ('IPL', 'WPL')),
  status text not null check (status in ('active', 'candidate', 'retired', 'benchmark_only')),
  training_cutoff date,
  feature_schema_version text not null,
  rule_target_id text not null,
  target_label_source text not null,
  params jsonb not null default '{}',
  metrics jsonb not null default '[]',
  artifact_path text,
  servable boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table boundary.model_activations (
  id uuid primary key default gen_random_uuid(),
  competition text not null check (competition in ('IPL', 'WPL')),
  model_version_id text not null references boundary.model_versions (id),
  params jsonb not null default '{}',
  activated_at timestamptz not null default now(),
  activated_by text not null,
  reason text not null,
  previous_model_version_id text references boundary.model_versions (id),
  previous_params jsonb
);
create index model_activations_comp_idx on boundary.model_activations (competition, activated_at desc);

-- ---------------------------------------------------------------------------------------------------------
-- Immutable decision-time snapshots and predictions
-- ---------------------------------------------------------------------------------------------------------
create table boundary.match_data_snapshots (
  id uuid primary key,
  match_id text not null,
  competition text not null check (competition in ('IPL', 'WPL')),
  match_origin text not null,
  decision_phase text not null check (decision_phase in ('pre_match', 'post_toss')),
  snapshot_at timestamptz not null,
  data_cutoff_date date not null,
  model_version_id text not null,
  model_params jsonb not null default '{}',
  rules_config_id text not null,
  rules_config_version text not null,
  team_rules_id text not null,
  pool jsonb not null,
  context jsonb not null,
  content_hash text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  foreign key (rules_config_id, rules_config_version) references boundary.rules_configs (id, version)
);
create index snapshots_match_idx on boundary.match_data_snapshots (match_id, snapshot_at desc);

create table boundary.player_match_features (
  snapshot_id uuid not null references boundary.match_data_snapshots (id),
  player_id text not null,
  feature_schema_version text not null,
  features jsonb not null,
  primary key (snapshot_id, player_id)
);

create table boundary.player_predictions (
  snapshot_id uuid not null references boundary.match_data_snapshots (id),
  player_id text not null,
  model_version_id text not null,
  mean numeric not null,
  p10 numeric,
  p90 numeric,
  sigma numeric,
  sample_size int not null,
  payload jsonb not null,
  primary key (snapshot_id, player_id)
);

-- ---------------------------------------------------------------------------------------------------------
-- User-owned teams and optimizer recommendations (immutable versions)
-- ---------------------------------------------------------------------------------------------------------
create table boundary.user_teams (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id text not null,
  snapshot_id uuid not null references boundary.match_data_snapshots (id),
  captain_id text not null,
  vice_captain_id text not null,
  validation jsonb not null,
  predicted_total numeric not null,
  created_at timestamptz not null default now(),
  check (captain_id <> vice_captain_id)
);
create index user_teams_user_match_idx on boundary.user_teams (user_id, match_id, created_at desc);

create table boundary.user_team_players (
  user_team_id uuid not null references boundary.user_teams (id) on delete cascade,
  player_id text not null,
  multiplier numeric not null default 1,
  primary key (user_team_id, player_id)
);

create table boundary.optimizer_recommendations (
  id uuid primary key,
  user_id uuid references auth.users (id) on delete cascade, -- null = produced by background jobs
  match_id text not null,
  snapshot_id uuid not null references boundary.match_data_snapshots (id),
  model_version_id text not null,
  captain_id text not null,
  vice_captain_id text not null,
  risk_aversion numeric not null,
  projected_base numeric not null,
  projected_total numeric not null,
  validation jsonb not null,
  picks jsonb not null,
  avoid jsonb not null,
  alternatives jsonb not null,
  captain_reason text not null,
  vice_captain_reason text not null,
  risks jsonb not null,
  evidence_quality jsonb not null default '[]',
  explanation_text text not null,
  explanation_source text not null check (explanation_source in ('gemini', 'template')),
  created_at timestamptz not null default now(),
  check (captain_id <> vice_captain_id)
);
create index optimizer_recs_user_match_idx on boundary.optimizer_recommendations (user_id, match_id, created_at desc);

create table boundary.recommendation_players (
  recommendation_id uuid not null references boundary.optimizer_recommendations (id) on delete cascade,
  player_id text not null,
  multiplier numeric not null default 1,
  primary key (recommendation_id, player_id)
);

-- ---------------------------------------------------------------------------------------------------------
-- Post-match actuals and evaluations
-- ---------------------------------------------------------------------------------------------------------
create table boundary.actual_player_points (
  id uuid primary key,
  user_id uuid references auth.users (id) on delete cascade, -- null = produced by background jobs
  match_id text not null,
  player_id text not null,
  entered_value numeric not null,
  includes_multiplier boolean not null,
  base_points numeric not null,
  source text not null check (source in ('manual', 'provider', 'reconstructed', 'kaggle_label')),
  verification text not null check (verification in ('unverified', 'user_confirmed', 'verified', 'reconstructed_unverified')),
  rules_config_id text,
  created_at timestamptz not null default now()
);
create index actual_points_lookup_idx on boundary.actual_player_points (user_id, match_id, player_id, created_at desc);

create table boundary.team_evaluations (
  id uuid primary key,
  user_id uuid references auth.users (id) on delete cascade, -- null = produced by background jobs
  match_id text not null,
  computed_at timestamptz not null default now(),
  payload jsonb not null,
  unique nulls not distinct (user_id, match_id)
);

create table boundary.player_evaluations (
  evaluation_id uuid not null references boundary.team_evaluations (id) on delete cascade,
  player_id text not null,
  predicted numeric not null,
  actual numeric not null,
  error numeric not null,
  inside_interval boolean,
  attribution text,
  primary key (evaluation_id, player_id)
);

-- ---------------------------------------------------------------------------------------------------------
-- Learning loop
-- ---------------------------------------------------------------------------------------------------------
create table boundary.error_patterns (
  id uuid primary key,
  competition text not null check (competition in ('IPL', 'WPL')),
  segment_type text not null,
  segment text not null,
  n int not null check (n >= 0),
  bias numeric not null,
  mae numeric not null,
  t_stat numeric not null,
  direction text not null check (direction in ('overpredict', 'underpredict')),
  confidence text not null check (confidence in ('insufficient', 'low', 'moderate', 'high')),
  source text not null check (source in ('historical_backtest', 'live_evaluations')),
  model_version_id text not null,
  detected_at timestamptz not null default now()
);
create index error_patterns_comp_idx on boundary.error_patterns (competition, source);

create table boundary.model_change_proposals (
  id uuid primary key,
  competition text not null check (competition in ('IPL', 'WPL')),
  base_model_version_id text not null,
  candidate_model_version_id text not null,
  candidate_params jsonb not null,
  rationale text not null,
  pattern_ids uuid[] not null default '{}',
  status text not null check (status in ('proposed', 'backtested', 'accepted', 'rejected', 'rolled_back')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);

create table boundary.model_change_evaluations (
  id uuid primary key,
  proposal_id uuid not null references boundary.model_change_proposals (id),
  eval_window text not null,
  label_source text not null,
  n int not null,
  base_mae numeric not null,
  candidate_mae numeric not null,
  improvement_pct numeric not null,
  segment_regressions jsonb not null,
  passes boolean not null,
  criteria jsonb not null,
  computed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------------
-- Autonomous pipeline: prepared analyses, job runs, system state, weight profiles
-- ---------------------------------------------------------------------------------------------------------
create table boundary.prepared_analyses (
  id uuid primary key,
  match_id text not null,
  competition text not null check (competition in ('IPL', 'WPL')),
  version int not null,
  decision_phase text not null check (decision_phase in ('pre_match', 'post_toss')),
  prepared_at timestamptz not null,
  clock_at timestamptz not null,
  trigger text not null check (trigger in ('scheduled', 'fixture_change', 'lineup_announced', 'model_change', 'manual')),
  snapshot_id uuid not null references boundary.match_data_snapshots (id),
  recommendation_id uuid references boundary.optimizer_recommendations (id),
  infeasibility jsonb,
  suitability jsonb not null,
  inputs_hash text not null,
  fixture_revision int not null,
  model_version_id text not null,
  unique (match_id, version)
);
create index prepared_analyses_match_idx on boundary.prepared_analyses (match_id, prepared_at desc);

create table boundary.job_runs (
  id uuid primary key,
  job text not null,
  key text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  attempt int not null default 1,
  started_at timestamptz not null,
  finished_at timestamptz,
  clock_at timestamptz not null,
  summary jsonb not null default '{}',
  error text,
  tick_id uuid not null
);
create index job_runs_job_idx on boundary.job_runs (job, started_at desc);
create unique index job_runs_success_once on boundary.job_runs (job, key) where status = 'succeeded';

create table boundary.system_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table boundary.weight_profiles (
  id uuid primary key,
  competition text not null check (competition in ('IPL', 'WPL')),
  owner text not null,
  name text not null,
  weights jsonb not null,
  status text not null check (status in ('recommended', 'candidate', 'submitted', 'promoted', 'rejected')),
  evaluation jsonb,
  proposal_id uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------------
-- Notifications and audit
-- ---------------------------------------------------------------------------------------------------------
create table boundary.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  phone text,
  email_enabled boolean not null default false,
  sms_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table boundary.scheduled_notifications (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id text not null,
  channel text not null check (channel in ('email', 'sms')),
  scheduled_for timestamptz not null,
  status text not null check (status in ('scheduled', 'sent', 'failed', 'cancelled', 'dead_letter')),
  idempotency_key text not null unique,
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  provider text,
  created_at timestamptz not null default now()
);
create index scheduled_notifications_due_idx on boundary.scheduled_notifications (status, scheduled_for);

create table boundary.audit_logs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text not null,
  details jsonb not null default '{}'
);
create index audit_logs_at_idx on boundary.audit_logs (at desc);

-- ---------------------------------------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------------------------------------
create trigger snapshots_immutable before update or delete on boundary.match_data_snapshots for each row execute function boundary.prevent_mutation();
create trigger features_immutable before update or delete on boundary.player_match_features for each row execute function boundary.prevent_mutation();
create trigger predictions_immutable before update or delete on boundary.player_predictions for each row execute function boundary.prevent_mutation();
create trigger user_teams_immutable before update on boundary.user_teams for each row execute function boundary.prevent_mutation();
create trigger user_team_players_immutable before update on boundary.user_team_players for each row execute function boundary.prevent_mutation();
create trigger recs_immutable before update on boundary.optimizer_recommendations for each row execute function boundary.prevent_mutation();
create trigger rec_players_immutable before update on boundary.recommendation_players for each row execute function boundary.prevent_mutation();
create trigger actuals_immutable before update on boundary.actual_player_points for each row execute function boundary.prevent_mutation();
create trigger model_evals_immutable before update or delete on boundary.model_change_evaluations for each row execute function boundary.prevent_mutation();
create trigger prepared_immutable before update or delete on boundary.prepared_analyses for each row execute function boundary.prevent_mutation();
create trigger activations_immutable before update or delete on boundary.model_activations for each row execute function boundary.prevent_mutation();

-- ---------------------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------------------
alter table boundary.rules_configs enable row level security;
alter table boundary.team_rules_configs enable row level security;
alter table boundary.teams enable row level security;
alter table boundary.players enable row level security;
alter table boundary.matches enable row level security;
alter table boundary.match_player_pool enable row level security;
alter table boundary.model_versions enable row level security;
alter table boundary.model_activations enable row level security;
alter table boundary.match_data_snapshots enable row level security;
alter table boundary.player_match_features enable row level security;
alter table boundary.player_predictions enable row level security;
alter table boundary.user_teams enable row level security;
alter table boundary.user_team_players enable row level security;
alter table boundary.optimizer_recommendations enable row level security;
alter table boundary.recommendation_players enable row level security;
alter table boundary.actual_player_points enable row level security;
alter table boundary.team_evaluations enable row level security;
alter table boundary.player_evaluations enable row level security;
alter table boundary.error_patterns enable row level security;
alter table boundary.model_change_proposals enable row level security;
alter table boundary.model_change_evaluations enable row level security;
alter table boundary.notification_preferences enable row level security;
alter table boundary.scheduled_notifications enable row level security;
alter table boundary.audit_logs enable row level security;
alter table boundary.prepared_analyses enable row level security;
alter table boundary.job_runs enable row level security;
alter table boundary.system_state enable row level security;
alter table boundary.weight_profiles enable row level security;

-- Public, read-only reference data (writes via service role only).
create policy "read rules" on boundary.rules_configs for select to anon, authenticated using (true);
create policy "read team rules" on boundary.team_rules_configs for select to anon, authenticated using (true);
create policy "read teams" on boundary.teams for select to anon, authenticated using (true);
create policy "read players" on boundary.players for select to anon, authenticated using (true);
create policy "read matches" on boundary.matches for select to anon, authenticated using (true);
create policy "read pool" on boundary.match_player_pool for select to anon, authenticated using (true);
create policy "read models" on boundary.model_versions for select to anon, authenticated using (true);
create policy "read activations" on boundary.model_activations for select to authenticated using (true);
create policy "read snapshots" on boundary.match_data_snapshots for select to authenticated using (true);
create policy "read features" on boundary.player_match_features for select to authenticated using (true);
create policy "read predictions" on boundary.player_predictions for select to authenticated using (true);
create policy "read patterns" on boundary.error_patterns for select to authenticated using (true);
create policy "read proposals" on boundary.model_change_proposals for select to authenticated using (true);
create policy "read model evals" on boundary.model_change_evaluations for select to authenticated using (true);

-- User-owned rows: a user can read and create only their own rows. No update/delete of immutable rows.
create policy "own teams select" on boundary.user_teams for select to authenticated using (user_id = auth.uid());
create policy "own teams insert" on boundary.user_teams for insert to authenticated with check (user_id = auth.uid());
create policy "own team players select" on boundary.user_team_players for select to authenticated
  using (exists (select 1 from boundary.user_teams t where t.id = user_team_id and t.user_id = auth.uid()));
create policy "own team players insert" on boundary.user_team_players for insert to authenticated
  with check (exists (select 1 from boundary.user_teams t where t.id = user_team_id and t.user_id = auth.uid()));

create policy "own or system recs select" on boundary.optimizer_recommendations for select to authenticated using (user_id = auth.uid() or user_id is null);
create policy "own recs insert" on boundary.optimizer_recommendations for insert to authenticated with check (user_id = auth.uid());
create policy "own rec players select" on boundary.recommendation_players for select to authenticated
  using (exists (select 1 from boundary.optimizer_recommendations r where r.id = recommendation_id and (r.user_id = auth.uid() or r.user_id is null)));
create policy "own rec players insert" on boundary.recommendation_players for insert to authenticated
  with check (exists (select 1 from boundary.optimizer_recommendations r where r.id = recommendation_id and r.user_id = auth.uid()));

create policy "own or system actuals select" on boundary.actual_player_points for select to authenticated using (user_id = auth.uid() or user_id is null);
create policy "own actuals insert" on boundary.actual_player_points for insert to authenticated with check (user_id = auth.uid());

create policy "own or system evals select" on boundary.team_evaluations for select to authenticated using (user_id = auth.uid() or user_id is null);
create policy "own evals insert" on boundary.team_evaluations for insert to authenticated with check (user_id = auth.uid());
create policy "own evals update" on boundary.team_evaluations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own player evals select" on boundary.player_evaluations for select to authenticated
  using (exists (select 1 from boundary.team_evaluations e where e.id = evaluation_id and e.user_id = auth.uid()));
create policy "own player evals write" on boundary.player_evaluations for insert to authenticated
  with check (exists (select 1 from boundary.team_evaluations e where e.id = evaluation_id and e.user_id = auth.uid()));
create policy "own player evals delete" on boundary.player_evaluations for delete to authenticated
  using (exists (select 1 from boundary.team_evaluations e where e.id = evaluation_id and e.user_id = auth.uid()));

create policy "own prefs" on boundary.notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notifications select" on boundary.scheduled_notifications for select to authenticated using (user_id = auth.uid());
create policy "read prepared" on boundary.prepared_analyses for select to authenticated using (true);
create policy "read job runs" on boundary.job_runs for select to authenticated using (true);
create policy "read weight profiles" on boundary.weight_profiles for select to authenticated using (owner = 'system' or owner = auth.uid()::text);
create policy "own weight profiles insert" on boundary.weight_profiles for insert to authenticated with check (owner = auth.uid()::text and status = 'candidate');
-- audit_logs, system_state: no policies => only the service role can read/write.

-- Table privileges (Supabase grants these by default; explicit for portability). RLS still applies.
grant usage on schema boundary to anon, authenticated, service_role;
grant select on all tables in schema boundary to anon, authenticated;
grant all on all tables in schema boundary to service_role;
grant all on all routines in schema boundary to service_role;
grant insert on boundary.weight_profiles, boundary.user_teams, boundary.user_team_players, boundary.optimizer_recommendations, boundary.recommendation_players,
  boundary.actual_player_points, boundary.team_evaluations, boundary.player_evaluations, boundary.notification_preferences to authenticated;
grant update on boundary.team_evaluations, boundary.notification_preferences, boundary.user_teams, boundary.actual_player_points to authenticated;
grant delete on boundary.player_evaluations, boundary.notification_preferences, boundary.user_teams to authenticated;
