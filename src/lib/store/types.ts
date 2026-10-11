import type { Competition, DecisionPhase, MatchOrigin, PlayerRole, PoolPlayer } from "../data/types";
import type { SwapAlternative } from "../optimizer/solve";
import type { ValidationResult } from "../optimizer/validate";

export interface SnapshotPrediction {
  playerId: string;
  name: string;
  team: string;
  role: PlayerRole;
  roleReason: string;
  credits: number | null;
  mean: number;
  p10: number;
  p90: number;
  sigma: number;
  sampleSize: number;
  explanation: string[];
  recentPoints: number[];
  venueMatches: number;
  venueMean: number | null;
  oppMatches: number;
  oppMean: number | null;
}

export interface MatchContextSnapshot {
  venue: string;
  city: string | null;
  date: string;
  startTimeUtc: string | null;
  toss: { winner: string; decision: string } | null;
  lineupStatus: "confirmed_xi" | "squad_proxy" | "imported_pool";
  venueHistory: { matches: number; avgFirstInningsProxy: number | null; avgPlayerPoints: number | null };
  pitchReport: string | null;
  weather: unknown | null;
  dataFreshness: string;
  sourceNotes: string[];
}

/** Immutable record of everything known at decision time. */
export interface Snapshot {
  id: string;
  matchId: string;
  competition: Competition;
  matchOrigin: MatchOrigin;
  decisionPhase: DecisionPhase;
  snapshotAt: string;
  /** Latest data date allowed into features (strictly before match date). */
  dataCutoffDate: string;
  modelId: string;
  modelParams: Record<string, unknown>;
  rulesId: string;
  rulesVersion: string;
  teamRulesId: string;
  pool: PoolPlayer[];
  predictions: SnapshotPrediction[];
  context: MatchContextSnapshot;
  contentHash: string;
  createdBy: string;
}

export interface UserTeam {
  id: string;
  userId: string;
  matchId: string;
  snapshotId: string;
  playerIds: string[];
  captainId: string;
  viceCaptainId: string;
  validation: ValidationResult;
  predictedTotal: number;
  createdAt: string;
}

export interface PickReason {
  playerId: string;
  reasons: string[];
}

export interface AvoidReason {
  playerId: string;
  reason: string;
}

export interface EvidenceItem {
  topic: string;
  level: "well_supported" | "preliminary" | "unavailable";
  basis: string;
}

export interface OptimizerRecommendation {
  id: string;
  userId: string;
  matchId: string;
  snapshotId: string;
  modelId: string;
  playerIds: string[];
  captainId: string;
  viceCaptainId: string;
  riskAversion: number;
  projectedBase: number;
  projectedTotal: number;
  validation: ValidationResult;
  picks: PickReason[];
  avoid: AvoidReason[];
  alternatives: SwapAlternative[];
  captainReason: string;
  viceCaptainReason: string;
  risks: string[];
  evidenceQuality: EvidenceItem[];
  explanationText: string;
  explanationSource: "gemini" | "template";
  createdAt: string;
}

export type ActualSource = "manual" | "provider" | "reconstructed" | "kaggle_label";
export type ActualVerification = "unverified" | "user_confirmed" | "verified" | "reconstructed_unverified";

export interface ActualPoint {
  id: string;
  userId: string;
  matchId: string;
  playerId: string;
  enteredValue: number;
  includesMultiplier: boolean;
  basePoints: number;
  source: ActualSource;
  verification: ActualVerification;
  rulesId: string | null;
  createdAt: string;
}

export interface PlayerEvaluation {
  playerId: string;
  name: string;
  role: PlayerRole;
  predicted: number;
  actual: number;
  error: number;
  insideInterval: boolean;
  inUserTeam: boolean;
  inOptimizerTeam: boolean;
  attribution: string;
}

export interface TeamEvaluationSide {
  teamId: string;
  predicted: number;
  actual: number | null;
  error: number | null;
  captainId: string;
  viceCaptainId: string;
  captainActualBase: number | null;
  missing: string[];
}

export interface TeamEvaluation {
  id: string;
  userId: string;
  matchId: string;
  computedAt: string;
  user: TeamEvaluationSide | null;
  optimizer: TeamEvaluationSide | null;
  optimizerMinusUser: number | null;
  players: PlayerEvaluation[];
  metrics: { n: number; mae: number; rmse: number; bias: number; coverage80: number } | null;
  takeaways: string[];
  actualsSource: string;
  /** System (background) evaluations of prepared analyses carry these extra diagnostics. */
  scope?: "system" | "user";
  /** live = frozen before a real match by the pipeline; replay_backfill = rebuilt at decision time for a past match. */
  origin?: "live" | "replay_backfill";
  competition?: Competition;
  analysisId?: string;
  modelId?: string;
  decisionPhase?: DecisionPhase;
  /** Every pool player with an actual, not just the XI: MAE/RMSE/bias/coverage + mean Spearman. */
  poolMetrics?: { n: number; mae: number; rmse: number; bias: number; coverage80: number; spearman: number | null; complete: boolean } | null;
  captainError?: number | null;
  viceCaptainError?: number | null;
  byUncertainty?: { bucket: string; n: number; mae: number }[];
  invalidCandidates?: number;
  poolPlayers?: { playerId: string; role: PlayerRole; predicted: number; actual: number; sigma: number; sampleSize: number }[];
}

export interface ErrorPattern {
  id: string;
  competition: Competition;
  segmentType: string;
  segment: string;
  n: number;
  bias: number;
  mae: number;
  tStat: number;
  direction: "overpredict" | "underpredict";
  confidence: "insufficient" | "low" | "moderate" | "high";
  source: "historical_backtest" | "live_evaluations";
  modelId: string;
  detectedAt: string;
}

export type ProposalStatus = "proposed" | "backtested" | "accepted" | "rejected" | "rolled_back";

export interface ModelChangeProposal {
  id: string;
  competition: Competition;
  baseModelId: string;
  candidateModelId: string;
  candidateParams: Record<string, unknown>;
  rationale: string;
  patternIds: string[];
  status: ProposalStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  evaluation: ModelChangeEvaluation | null;
}

export interface ModelChangeEvaluation {
  id: string;
  proposalId: string;
  window: string;
  labelSource: string;
  n: number;
  baseMae: number;
  candidateMae: number;
  improvementPct: number;
  segmentRegressions: { segment: string; baseMae: number; candidateMae: number }[];
  passes: boolean;
  criteria: string[];
  computedAt: string;
}

export interface ModelActivation {
  id: string;
  competition: Competition;
  modelId: string;
  params: Record<string, unknown>;
  activatedAt: string;
  activatedBy: string;
  reason: string;
  previousModelId: string | null;
  previousParams: Record<string, unknown> | null;
}

export type FixtureSource = "csv_import" | "provider" | "sim_replay";

/** A discovered or imported fixture. Rows are upserted by id; every material change bumps `revision`. */
export interface Fixture {
  id: string;
  competition: Competition;
  date: string;
  startTimeUtc: string | null;
  /** True when the start time is an assumption (e.g. simulated replay), not from a source. */
  startTimeAssumed: boolean;
  timezone: string | null;
  venue: string;
  city: string | null;
  team1: string;
  team2: string;
  status: "upcoming" | "live" | "completed";
  source: FixtureSource;
  providerMatchId: string | null;
  importedAt: string;
  importedBy: string;
  lastSyncedAt: string;
  revision: number;
}

export interface ImportedPoolPlayer {
  fixtureId: string;
  playerName: string;
  playerId: string | null;
  team: string;
  role: PlayerRole;
  credits: number | null;
  announced: boolean | null;
}

export interface NotificationPreference {
  userId: string;
  email: string | null;
  phone: string | null;
  emailEnabled: boolean;
  smsEnabled: boolean;
  updatedAt: string;
}

export type NotificationStatus = "scheduled" | "sent" | "failed" | "cancelled" | "dead_letter";

export interface ScheduledNotification {
  id: string;
  userId: string;
  matchId: string;
  channel: "email" | "sms";
  scheduledFor: string;
  status: NotificationStatus;
  idempotencyKey: string;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  provider: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  details: Record<string, unknown>;
}

/** Records produced by background jobs (not a human user). */
export const SYSTEM_USER_ID = "system";

export type JobName =
  | "discover_fixtures"
  | "refresh_status"
  | "prepare_analysis"
  | "collect_actuals"
  | "evaluate_matches"
  | "detect_patterns"
  | "improve_models"
  | "send_reminders";

export interface JobRun {
  id: string;
  job: JobName;
  /** Idempotency key: the same key is never executed twice successfully. */
  key: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  clockAt: string;
  summary: Record<string, unknown>;
  error: string | null;
  tickId: string;
}

export interface PreparedAnalysis {
  id: string;
  matchId: string;
  competition: Competition;
  version: number;
  decisionPhase: DecisionPhase;
  preparedAt: string;
  /** Pipeline clock time (real or simulated) the analysis was prepared for. */
  clockAt: string;
  trigger: "scheduled" | "fixture_change" | "lineup_announced" | "model_change" | "manual";
  snapshotId: string;
  recommendationId: string | null;
  infeasibility: string[] | null;
  suitability: { score: number; components: Record<string, number>; reasons: string[] };
  inputsHash: string;
  fixtureRevision: number;
  modelId: string;
}

export interface WeightProfile {
  id: string;
  competition: Competition;
  owner: "system" | string;
  name: string;
  weights: Record<string, number>;
  status: "recommended" | "candidate" | "submitted" | "promoted" | "rejected";
  createdAt: string;
  evaluation: { window: string; n: number; mae: number; baselineMae: number; labelSource: string } | null;
  proposalId: string | null;
}

export interface Repository {
  readonly kind: "local" | "supabase";
  readonly persistent: boolean;

  saveSnapshot(s: Snapshot): Promise<Snapshot>;
  getSnapshot(id: string): Promise<Snapshot | null>;
  listSnapshots(matchId?: string): Promise<Snapshot[]>;

  saveUserTeam(t: UserTeam): Promise<UserTeam>;
  listUserTeams(userId: string, matchId?: string): Promise<UserTeam[]>;

  saveRecommendation(r: OptimizerRecommendation): Promise<OptimizerRecommendation>;
  listRecommendations(userId: string, matchId?: string): Promise<OptimizerRecommendation[]>;

  addActuals(rows: ActualPoint[]): Promise<ActualPoint[]>;
  listActuals(userId: string, matchId: string): Promise<ActualPoint[]>;

  saveEvaluation(e: TeamEvaluation): Promise<TeamEvaluation>;
  listEvaluations(userId: string): Promise<TeamEvaluation[]>;

  replacePatterns(competition: Competition, source: ErrorPattern["source"], p: ErrorPattern[]): Promise<void>;
  listPatterns(competition?: Competition): Promise<ErrorPattern[]>;

  saveProposal(p: ModelChangeProposal): Promise<ModelChangeProposal>;
  listProposals(): Promise<ModelChangeProposal[]>;

  addActivation(a: ModelActivation): Promise<ModelActivation>;
  listActivations(competition?: Competition): Promise<ModelActivation[]>;

  upsertFixtures(f: Fixture[], pool: ImportedPoolPlayer[]): Promise<void>;
  getFixture(id: string): Promise<Fixture | null>;
  listFixtures(): Promise<Fixture[]>;
  listFixturePool(fixtureId: string): Promise<ImportedPoolPlayer[]>;

  getNotificationPreference(userId: string): Promise<NotificationPreference | null>;
  saveNotificationPreference(p: NotificationPreference): Promise<NotificationPreference>;
  upsertScheduledNotification(n: ScheduledNotification): Promise<ScheduledNotification>;
  listScheduledNotifications(filter?: { userId?: string; status?: NotificationStatus }): Promise<ScheduledNotification[]>;

  savePreparedAnalysis(a: PreparedAnalysis): Promise<PreparedAnalysis>;
  listPreparedAnalyses(matchId?: string): Promise<PreparedAnalysis[]>;

  saveJobRun(r: JobRun): Promise<JobRun>;
  listJobRuns(filter?: { job?: JobName; key?: string; limit?: number }): Promise<JobRun[]>;

  getState<T = unknown>(key: string): Promise<T | null>;
  setState(key: string, value: unknown): Promise<void>;

  saveWeightProfile(w: WeightProfile): Promise<WeightProfile>;
  listWeightProfiles(competition?: Competition): Promise<WeightProfile[]>;

  listAllEvaluations(): Promise<TeamEvaluation[]>;

  audit(entry: Omit<AuditLog, "id" | "at">): Promise<void>;
  listAudit(limit?: number): Promise<AuditLog[]>;
}
