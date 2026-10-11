/**
 * Supabase repository. User-owned rows are written with a client scoped to the user's JWT so RLS applies;
 * reference / system rows (snapshots, model registry, patterns, notifications, audit) use the service role
 * on the server only. This module must never be imported by client components.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";
import type {
  ActualPoint, AuditLog, ErrorPattern, Fixture, ImportedPoolPlayer, ModelActivation, ModelChangeEvaluation, ModelChangeProposal,
  JobName, JobRun, NotificationPreference, OptimizerRecommendation, PreparedAnalysis, Repository, WeightProfile, ScheduledNotification, Snapshot, TeamEvaluation, UserTeam,
} from "./types";
import { SYSTEM_USER_ID } from "./types";
import { referenceDataComplete, seedReferenceData } from "./seed";
import type { Competition } from "../data/types";

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Supabase ${what}: ${res.error.message}`);
  return res.data as T;
}

export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;
  readonly persistent = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private service: SupabaseClient<any, any, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private user: SupabaseClient<any, any, any>;

  constructor(private accessToken: string | null) {
    this.service = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false }, db: { schema: env.supabaseSchema } });
    this.user = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
      db: { schema: env.supabaseSchema },
      global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
    });
  }

  /** Seed reference tables if this build's rules/model versions are missing. Returns what was done. */
  async ensureReferenceData(): Promise<Record<string, unknown>> {
    if (await referenceDataComplete(this.service)) return { seeded: false };
    return { seeded: true, ...(await seedReferenceData(this.service)) };
  }

  /** Background-job rows are stored with user_id null and written with the service role. */
  private uid(userId: string) {
    return userId === SYSTEM_USER_ID ? null : userId;
  }
  private db(userId: string) {
    return userId === SYSTEM_USER_ID ? this.service : this.user;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private scoped(q: any, userId: string): any {
    return userId === SYSTEM_USER_ID ? q.is("user_id", null) : q.eq("user_id", userId);
  }

  async saveSnapshot(s: Snapshot) {
    must(
      await this.service.from("match_data_snapshots").insert({
        id: s.id, match_id: s.matchId, competition: s.competition, match_origin: s.matchOrigin, decision_phase: s.decisionPhase,
        snapshot_at: s.snapshotAt, data_cutoff_date: s.dataCutoffDate, model_version_id: s.modelId, model_params: s.modelParams,
        rules_config_id: s.rulesId, rules_config_version: s.rulesVersion, team_rules_id: s.teamRulesId, pool: s.pool,
        context: s.context, content_hash: s.contentHash, created_by: s.createdBy,
      }),
      "insert snapshot",
    );
    must(
      await this.service.from("player_predictions").insert(
        s.predictions.map((p) => ({
          snapshot_id: s.id, player_id: p.playerId, model_version_id: s.modelId, mean: p.mean, p10: p.p10, p90: p.p90,
          sigma: p.sigma, sample_size: p.sampleSize, payload: p,
        })),
      ),
      "insert predictions",
    );
    return s;
  }

  private rowToSnapshot = (r: Record<string, unknown>, preds: Record<string, unknown>[]): Snapshot => ({
    id: r.id as string, matchId: r.match_id as string, competition: r.competition as Competition,
    matchOrigin: r.match_origin as Snapshot["matchOrigin"], decisionPhase: r.decision_phase as Snapshot["decisionPhase"],
    snapshotAt: r.snapshot_at as string, dataCutoffDate: r.data_cutoff_date as string, modelId: r.model_version_id as string,
    modelParams: r.model_params as Record<string, unknown>, rulesId: r.rules_config_id as string, rulesVersion: r.rules_config_version as string,
    teamRulesId: r.team_rules_id as string, pool: r.pool as Snapshot["pool"], context: r.context as Snapshot["context"],
    contentHash: r.content_hash as string, createdBy: r.created_by as string,
    predictions: preds.map((p) => p.payload as Snapshot["predictions"][number]),
  });

  async getSnapshot(id: string) {
    const r = must(await this.service.from("match_data_snapshots").select("*").eq("id", id).maybeSingle(), "get snapshot");
    if (!r) return null;
    const preds = must(await this.service.from("player_predictions").select("payload").eq("snapshot_id", id), "get predictions");
    return this.rowToSnapshot(r, preds);
  }

  async listSnapshots(matchId?: string) {
    let q = this.service.from("match_data_snapshots").select("*").order("snapshot_at", { ascending: true });
    if (matchId) q = q.eq("match_id", matchId);
    const rows = must(await q, "list snapshots") as Record<string, unknown>[];
    const out: Snapshot[] = [];
    for (const r of rows) {
      const preds = must(await this.service.from("player_predictions").select("payload").eq("snapshot_id", r.id as string), "get predictions");
      out.push(this.rowToSnapshot(r, preds));
    }
    return out;
  }

  async saveUserTeam(t: UserTeam) {
    must(
      await this.user.from("user_teams").insert({
        id: t.id, user_id: t.userId, match_id: t.matchId, snapshot_id: t.snapshotId, captain_id: t.captainId,
        vice_captain_id: t.viceCaptainId, validation: t.validation, predicted_total: t.predictedTotal, created_at: t.createdAt,
      }),
      "insert user team",
    );
    must(
      await this.user.from("user_team_players").insert(
        t.playerIds.map((p) => ({ user_team_id: t.id, player_id: p, multiplier: p === t.captainId ? 2 : p === t.viceCaptainId ? 1.5 : 1 })),
      ),
      "insert user team players",
    );
    return t;
  }

  async listUserTeams(userId: string, matchId?: string) {
    let q = this.user.from("user_teams").select("*, user_team_players(player_id)").eq("user_id", userId).order("created_at");
    if (matchId) q = q.eq("match_id", matchId);
    const rows = must(await q, "list user teams") as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string, userId: r.user_id as string, matchId: r.match_id as string, snapshotId: r.snapshot_id as string,
      playerIds: (r.user_team_players as { player_id: string }[]).map((p) => p.player_id), captainId: r.captain_id as string,
      viceCaptainId: r.vice_captain_id as string, validation: r.validation as UserTeam["validation"],
      predictedTotal: Number(r.predicted_total), createdAt: r.created_at as string,
    }));
  }

  async saveRecommendation(r: OptimizerRecommendation) {
    must(
      await this.db(r.userId).from("optimizer_recommendations").insert({
        id: r.id, user_id: this.uid(r.userId), match_id: r.matchId, snapshot_id: r.snapshotId, model_version_id: r.modelId,
        captain_id: r.captainId, vice_captain_id: r.viceCaptainId, risk_aversion: r.riskAversion, projected_base: r.projectedBase,
        projected_total: r.projectedTotal, validation: r.validation, picks: r.picks, avoid: r.avoid, alternatives: r.alternatives,
        captain_reason: r.captainReason, vice_captain_reason: r.viceCaptainReason, risks: r.risks, evidence_quality: r.evidenceQuality, explanation_text: r.explanationText,
        explanation_source: r.explanationSource, created_at: r.createdAt,
      }),
      "insert recommendation",
    );
    must(
      await this.db(r.userId).from("recommendation_players").insert(
        r.playerIds.map((p) => ({ recommendation_id: r.id, player_id: p, multiplier: p === r.captainId ? 2 : p === r.viceCaptainId ? 1.5 : 1 })),
      ),
      "insert recommendation players",
    );
    return r;
  }

  async listRecommendations(userId: string, matchId?: string) {
    let q = this.scoped(this.db(userId).from("optimizer_recommendations").select("*, recommendation_players(player_id)"), userId).order("created_at");
    if (matchId) q = q.eq("match_id", matchId);
    const rows = must(await q, "list recommendations") as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string, userId: (r.user_id as string) ?? SYSTEM_USER_ID, matchId: r.match_id as string, snapshotId: r.snapshot_id as string,
      modelId: r.model_version_id as string, playerIds: (r.recommendation_players as { player_id: string }[]).map((p) => p.player_id),
      captainId: r.captain_id as string, viceCaptainId: r.vice_captain_id as string, riskAversion: Number(r.risk_aversion),
      projectedBase: Number(r.projected_base), projectedTotal: Number(r.projected_total), validation: r.validation as OptimizerRecommendation["validation"],
      picks: r.picks as OptimizerRecommendation["picks"], avoid: r.avoid as OptimizerRecommendation["avoid"],
      alternatives: r.alternatives as OptimizerRecommendation["alternatives"], captainReason: r.captain_reason as string,
      viceCaptainReason: r.vice_captain_reason as string, risks: r.risks as string[], evidenceQuality: (r.evidence_quality as OptimizerRecommendation["evidenceQuality"]) ?? [], explanationText: r.explanation_text as string,
      explanationSource: r.explanation_source as OptimizerRecommendation["explanationSource"], createdAt: r.created_at as string,
    }));
  }

  async addActuals(rows: ActualPoint[]) {
    must(
      await this.db(rows[0]?.userId ?? "").from("actual_player_points").insert(
        rows.map((a) => ({
          id: a.id, user_id: this.uid(a.userId), match_id: a.matchId, player_id: a.playerId, entered_value: a.enteredValue,
          includes_multiplier: a.includesMultiplier, base_points: a.basePoints, source: a.source, verification: a.verification,
          rules_config_id: a.rulesId, created_at: a.createdAt,
        })),
      ),
      "insert actuals",
    );
    return rows;
  }

  async listActuals(userId: string, matchId: string) {
    const rows = must(await this.scoped(this.db(userId).from("actual_player_points").select("*"), userId).eq("match_id", matchId).order("created_at"), "list actuals") as Record<string, unknown>[];
    return rows.map((a) => ({
      id: a.id as string, userId: (a.user_id as string) ?? SYSTEM_USER_ID, matchId: a.match_id as string, playerId: a.player_id as string,
      enteredValue: Number(a.entered_value), includesMultiplier: a.includes_multiplier as boolean, basePoints: Number(a.base_points),
      source: a.source as ActualPoint["source"], verification: a.verification as ActualPoint["verification"],
      rulesId: (a.rules_config_id as string) ?? null, createdAt: a.created_at as string,
    }));
  }

  async saveEvaluation(e: TeamEvaluation) {
    const db = this.db(e.userId);
    must(await db.from("team_evaluations").upsert({ id: e.id, user_id: this.uid(e.userId), match_id: e.matchId, computed_at: e.computedAt, payload: e }, { onConflict: "user_id,match_id" }), "upsert evaluation");
    const saved = must(await this.scoped(db.from("team_evaluations").select("id"), e.userId).eq("match_id", e.matchId).single(), "get evaluation id") as { id: string };
    must(await db.from("player_evaluations").delete().eq("evaluation_id", saved.id), "clear player evaluations");
    if (e.players.length) {
      must(
        await db.from("player_evaluations").insert(
          e.players.map((p) => ({ evaluation_id: saved.id, player_id: p.playerId, predicted: p.predicted, actual: p.actual, error: p.error, inside_interval: p.insideInterval, attribution: p.attribution })),
        ),
        "insert player evaluations",
      );
    }
    return e;
  }

  async listEvaluations(userId: string) {
    const rows = must(await this.scoped(this.db(userId).from("team_evaluations").select("payload"), userId), "list evaluations") as { payload: TeamEvaluation }[];
    return rows.map((r) => r.payload);
  }

  async listAllEvaluations() {
    const rows = must(await this.service.from("team_evaluations").select("payload"), "list all evaluations") as { payload: TeamEvaluation }[];
    return rows.map((r) => r.payload);
  }

  async replacePatterns(competition: Competition, source: ErrorPattern["source"], p: ErrorPattern[]) {
    must(await this.service.from("error_patterns").delete().eq("competition", competition).eq("source", source), "clear patterns");
    if (p.length)
      must(
        await this.service.from("error_patterns").insert(
          p.map((x) => ({
            id: x.id, competition: x.competition, segment_type: x.segmentType, segment: x.segment, n: x.n, bias: x.bias, mae: x.mae,
            t_stat: x.tStat, direction: x.direction, confidence: x.confidence, source: x.source, model_version_id: x.modelId, detected_at: x.detectedAt,
          })),
        ),
        "insert patterns",
      );
  }

  async listPatterns(competition?: Competition) {
    let q = this.service.from("error_patterns").select("*");
    if (competition) q = q.eq("competition", competition);
    const rows = must(await q, "list patterns") as Record<string, unknown>[];
    return rows.map((x) => ({
      id: x.id as string, competition: x.competition as Competition, segmentType: x.segment_type as string, segment: x.segment as string,
      n: Number(x.n), bias: Number(x.bias), mae: Number(x.mae), tStat: Number(x.t_stat), direction: x.direction as ErrorPattern["direction"],
      confidence: x.confidence as ErrorPattern["confidence"], source: x.source as ErrorPattern["source"], modelId: x.model_version_id as string,
      detectedAt: x.detected_at as string,
    }));
  }

  async saveProposal(p: ModelChangeProposal) {
    must(
      await this.service.from("model_change_proposals").upsert({
        id: p.id, competition: p.competition, base_model_version_id: p.baseModelId, candidate_model_version_id: p.candidateModelId,
        candidate_params: p.candidateParams, rationale: p.rationale, pattern_ids: p.patternIds, status: p.status, created_at: p.createdAt,
        decided_at: p.decidedAt, decided_by: p.decidedBy,
      }),
      "upsert proposal",
    );
    if (p.evaluation) {
      const exists = must(await this.service.from("model_change_evaluations").select("id").eq("id", p.evaluation.id).maybeSingle(), "check evaluation");
      if (!exists) {
        const e = p.evaluation;
        must(
          await this.service.from("model_change_evaluations").insert({
            id: e.id, proposal_id: p.id, eval_window: e.window, label_source: e.labelSource, n: e.n, base_mae: e.baseMae,
            candidate_mae: e.candidateMae, improvement_pct: e.improvementPct, segment_regressions: e.segmentRegressions, passes: e.passes,
            criteria: e.criteria, computed_at: e.computedAt,
          }),
          "insert evaluation",
        );
      }
    }
    return p;
  }

  async listProposals() {
    const rows = must(await this.service.from("model_change_proposals").select("*, model_change_evaluations(*)").order("created_at"), "list proposals") as Record<string, unknown>[];
    return rows.map((p) => {
      const e = (p.model_change_evaluations as Record<string, unknown>[])[0];
      return {
        id: p.id as string, competition: p.competition as Competition, baseModelId: p.base_model_version_id as string,
        candidateModelId: p.candidate_model_version_id as string, candidateParams: p.candidate_params as Record<string, unknown>,
        rationale: p.rationale as string, patternIds: p.pattern_ids as string[], status: p.status as ModelChangeProposal["status"],
        createdAt: p.created_at as string, decidedAt: (p.decided_at as string) ?? null, decidedBy: (p.decided_by as string) ?? null,
        evaluation: e
          ? {
              id: e.id as string, proposalId: p.id as string, window: e.eval_window as string, labelSource: e.label_source as string, n: Number(e.n),
              baseMae: Number(e.base_mae), candidateMae: Number(e.candidate_mae), improvementPct: Number(e.improvement_pct),
              segmentRegressions: e.segment_regressions as ModelChangeEvaluation["segmentRegressions"],
              passes: e.passes as boolean, criteria: e.criteria as string[], computedAt: e.computed_at as string,
            }
          : null,
      };
    });
  }

  async addActivation(a: ModelActivation) {
    must(
      await this.service.from("model_activations").insert({
        id: a.id, competition: a.competition, model_version_id: a.modelId, params: a.params, activated_at: a.activatedAt,
        activated_by: a.activatedBy, reason: a.reason, previous_model_version_id: a.previousModelId, previous_params: a.previousParams,
      }),
      "insert activation",
    );
    return a;
  }

  async listActivations(competition?: Competition) {
    let q = this.service.from("model_activations").select("*").order("activated_at");
    if (competition) q = q.eq("competition", competition);
    const rows = must(await q, "list activations") as Record<string, unknown>[];
    return rows.map((a) => ({
      id: a.id as string, competition: a.competition as Competition, modelId: a.model_version_id as string, params: a.params as Record<string, unknown>,
      activatedAt: a.activated_at as string, activatedBy: a.activated_by as string, reason: a.reason as string,
      previousModelId: (a.previous_model_version_id as string) ?? null, previousParams: (a.previous_params as Record<string, unknown>) ?? null,
    }));
  }

  async upsertFixtures(f: Fixture[], pool: ImportedPoolPlayer[]) {
    if (f.length)
      must(
        await this.service.from("matches").upsert(
          f.map((x) => ({
            id: x.id, competition: x.competition, origin: x.source, match_date: x.date, start_time_utc: x.startTimeUtc, start_time_assumed: x.startTimeAssumed,
            timezone: x.timezone, venue: x.venue, city: x.city, team1: x.team1, team2: x.team2, status: x.status, provider_match_id: x.providerMatchId,
            source: x.importedBy, revision: x.revision, last_synced_at: x.lastSyncedAt, created_at: x.importedAt,
          })),
        ),
        "upsert fixtures",
      );
    const ids = [...new Set(pool.map((p) => p.fixtureId))];
    if (ids.length) must(await this.service.from("match_player_pool").delete().in("match_id", ids), "clear pool");
    if (pool.length)
      must(
        await this.service.from("match_player_pool").insert(
          pool.map((p) => ({
            match_id: p.fixtureId, player_id: p.playerId ?? `import:${p.playerName}`, player_name: p.playerName, team: p.team, role: p.role,
            role_source: "imported", credits: p.credits, credit_source: p.credits == null ? "none" : "imported", announced: p.announced,
          })),
        ),
        "insert pool",
      );
  }

  private rowToFixture = (x: Record<string, unknown>): Fixture => ({
    id: x.id as string, competition: x.competition as Competition, date: x.match_date as string, startTimeUtc: (x.start_time_utc as string) ?? null,
    startTimeAssumed: !!x.start_time_assumed, timezone: (x.timezone as string) ?? null, venue: x.venue as string, city: (x.city as string) ?? null,
    team1: x.team1 as string, team2: x.team2 as string, status: x.status as Fixture["status"], source: x.origin as Fixture["source"],
    providerMatchId: (x.provider_match_id as string) ?? null, importedAt: x.created_at as string, importedBy: String(x.source ?? ""),
    lastSyncedAt: x.last_synced_at as string, revision: Number(x.revision ?? 1),
  });

  async listFixtures() {
    const rows = must(await this.service.from("matches").select("*").in("origin", ["csv_import", "provider", "sim_replay"]), "list fixtures") as Record<string, unknown>[];
    return rows.map(this.rowToFixture);
  }

  async getFixture(id: string) {
    const r = must(await this.service.from("matches").select("*").eq("id", id).maybeSingle(), "get fixture") as Record<string, unknown> | null;
    return r && r.origin !== "cricsheet_replay" ? this.rowToFixture(r) : null;
  }

  async listFixturePool(fixtureId: string) {
    const rows = must(await this.service.from("match_player_pool").select("*").eq("match_id", fixtureId), "list pool") as Record<string, unknown>[];
    return rows.map((p) => ({
      fixtureId, playerName: p.player_name as string, playerId: String(p.player_id).startsWith("import:") ? null : (p.player_id as string),
      team: p.team as string, role: p.role as ImportedPoolPlayer["role"], credits: p.credits == null ? null : Number(p.credits), announced: (p.announced as boolean) ?? null,
    }));
  }

  async getNotificationPreference(userId: string) {
    const r = must(await this.user.from("notification_preferences").select("*").eq("user_id", userId).maybeSingle(), "get prefs") as Record<string, unknown> | null;
    return r
      ? { userId, email: (r.email as string) ?? null, phone: (r.phone as string) ?? null, emailEnabled: r.email_enabled as boolean, smsEnabled: r.sms_enabled as boolean, updatedAt: r.updated_at as string }
      : null;
  }

  async saveNotificationPreference(p: NotificationPreference) {
    must(
      await this.user.from("notification_preferences").upsert({ user_id: p.userId, email: p.email, phone: p.phone, email_enabled: p.emailEnabled, sms_enabled: p.smsEnabled, updated_at: p.updatedAt }),
      "save prefs",
    );
    return p;
  }

  async upsertScheduledNotification(n: ScheduledNotification) {
    const row = {
      id: n.id, user_id: n.userId, match_id: n.matchId, channel: n.channel, scheduled_for: n.scheduledFor, status: n.status,
      idempotency_key: n.idempotencyKey, attempts: n.attempts, last_error: n.lastError, sent_at: n.sentAt, provider: n.provider, created_at: n.createdAt,
    };
    const { id: _id, ...rest } = row;
    void _id;
    // Conflict on idempotency_key keeps the original row id (no duplicate reminders).
    const saved = must(await this.service.from("scheduled_notifications").upsert({ ...rest, id: n.id }, { onConflict: "idempotency_key" }).select().single(), "upsert notification") as Record<string, unknown>;
    return { ...n, id: saved.id as string };
  }

  async listScheduledNotifications(filter: { userId?: string; status?: ScheduledNotification["status"] } = {}) {
    let q = this.service.from("scheduled_notifications").select("*");
    if (filter.userId) q = q.eq("user_id", filter.userId);
    if (filter.status) q = q.eq("status", filter.status);
    const rows = must(await q, "list notifications") as Record<string, unknown>[];
    return rows.map((n) => ({
      id: n.id as string, userId: n.user_id as string, matchId: n.match_id as string, channel: n.channel as ScheduledNotification["channel"],
      scheduledFor: n.scheduled_for as string, status: n.status as ScheduledNotification["status"], idempotencyKey: n.idempotency_key as string,
      attempts: Number(n.attempts), lastError: (n.last_error as string) ?? null, sentAt: (n.sent_at as string) ?? null, provider: (n.provider as string) ?? null,
      createdAt: n.created_at as string,
    }));
  }

  async savePreparedAnalysis(a: PreparedAnalysis) {
    must(
      await this.service.from("prepared_analyses").insert({
        id: a.id, match_id: a.matchId, competition: a.competition, version: a.version, decision_phase: a.decisionPhase, prepared_at: a.preparedAt,
        clock_at: a.clockAt, trigger: a.trigger, snapshot_id: a.snapshotId, recommendation_id: a.recommendationId, infeasibility: a.infeasibility,
        suitability: a.suitability, inputs_hash: a.inputsHash, fixture_revision: a.fixtureRevision, model_version_id: a.modelId,
      }),
      "insert prepared analysis",
    );
    return a;
  }

  async listPreparedAnalyses(matchId?: string) {
    let q = this.service.from("prepared_analyses").select("*").order("prepared_at");
    if (matchId) q = q.eq("match_id", matchId);
    const rows = must(await q, "list prepared analyses") as Record<string, unknown>[];
    return rows.map((a) => ({
      id: a.id as string, matchId: a.match_id as string, competition: a.competition as Competition, version: Number(a.version),
      decisionPhase: a.decision_phase as PreparedAnalysis["decisionPhase"], preparedAt: a.prepared_at as string, clockAt: a.clock_at as string,
      trigger: a.trigger as PreparedAnalysis["trigger"], snapshotId: a.snapshot_id as string, recommendationId: (a.recommendation_id as string) ?? null,
      infeasibility: (a.infeasibility as string[]) ?? null, suitability: a.suitability as PreparedAnalysis["suitability"], inputsHash: a.inputs_hash as string,
      fixtureRevision: Number(a.fixture_revision), modelId: a.model_version_id as string,
    }));
  }

  async saveJobRun(r: JobRun) {
    must(
      await this.service.from("job_runs").upsert({
        id: r.id, job: r.job, key: r.key, status: r.status, attempt: r.attempt, started_at: r.startedAt, finished_at: r.finishedAt,
        clock_at: r.clockAt, summary: r.summary, error: r.error, tick_id: r.tickId,
      }),
      "save job run",
    );
    return r;
  }

  async listJobRuns(filter: { job?: JobName; key?: string; limit?: number } = {}) {
    let q = this.service.from("job_runs").select("*").order("started_at", { ascending: false }).limit(filter.limit ?? 500);
    if (filter.job) q = q.eq("job", filter.job);
    if (filter.key) q = q.eq("key", filter.key);
    const rows = must(await q, "list job runs") as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string, job: r.job as JobName, key: r.key as string, status: r.status as JobRun["status"], attempt: Number(r.attempt),
      startedAt: r.started_at as string, finishedAt: (r.finished_at as string) ?? null, clockAt: r.clock_at as string,
      summary: r.summary as Record<string, unknown>, error: (r.error as string) ?? null, tickId: r.tick_id as string,
    }));
  }

  async getState<T = unknown>(key: string) {
    const r = must(await this.service.from("system_state").select("value").eq("key", key).maybeSingle(), "get state") as { value: T } | null;
    return r ? r.value : null;
  }

  async setState(key: string, value: unknown) {
    must(await this.service.from("system_state").upsert({ key, value, updated_at: new Date().toISOString() }), "set state");
  }

  async saveWeightProfile(w: WeightProfile) {
    must(
      await this.service.from("weight_profiles").upsert({
        id: w.id, competition: w.competition, owner: w.owner, name: w.name, weights: w.weights, status: w.status, evaluation: w.evaluation,
        proposal_id: w.proposalId, created_at: w.createdAt,
      }),
      "save weight profile",
    );
    return w;
  }

  async listWeightProfiles(competition?: Competition) {
    let q = this.service.from("weight_profiles").select("*").order("created_at");
    if (competition) q = q.eq("competition", competition);
    const rows = must(await q, "list weight profiles") as Record<string, unknown>[];
    return rows.map((w) => ({
      id: w.id as string, competition: w.competition as Competition, owner: w.owner as string, name: w.name as string,
      weights: w.weights as Record<string, number>, status: w.status as WeightProfile["status"], createdAt: w.created_at as string,
      evaluation: (w.evaluation as WeightProfile["evaluation"]) ?? null, proposalId: (w.proposal_id as string) ?? null,
    }));
  }

  async audit(entry: Omit<AuditLog, "id" | "at">) {
    must(await this.service.from("audit_logs").insert({ actor: entry.actor, action: entry.action, entity: entry.entity, entity_id: entry.entityId, details: entry.details }), "audit");
  }

  async listAudit(limit = 100) {
    const rows = must(await this.service.from("audit_logs").select("*").order("at", { ascending: false }).limit(limit), "list audit") as Record<string, unknown>[];
    return rows.map((a) => ({ id: a.id as string, at: a.at as string, actor: a.actor as string, action: a.action as string, entity: a.entity as string, entityId: a.entity_id as string, details: a.details as Record<string, unknown> }));
  }
}
