/**
 * Local JSON-file repository for demo mode and tests. Not multi-user safe; labelled as demo storage in the UI.
 * Immutable collections (snapshots, user teams, recommendations, actual points, activations) are append-only.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ActualPoint, AuditLog, ErrorPattern, JobName, JobRun, PreparedAnalysis, WeightProfile, Fixture, ImportedPoolPlayer, ModelActivation, ModelChangeProposal,
  NotificationPreference, OptimizerRecommendation, Repository, ScheduledNotification, Snapshot, TeamEvaluation, UserTeam,
} from "./types";
import type { Competition } from "../data/types";

interface StoreShape {
  snapshots: Snapshot[];
  userTeams: UserTeam[];
  recommendations: OptimizerRecommendation[];
  actuals: ActualPoint[];
  evaluations: TeamEvaluation[];
  patterns: ErrorPattern[];
  proposals: ModelChangeProposal[];
  activations: ModelActivation[];
  fixtures: Fixture[];
  fixturePool: ImportedPoolPlayer[];
  notificationPrefs: NotificationPreference[];
  notifications: ScheduledNotification[];
  audit: AuditLog[];
  prepared: PreparedAnalysis[];
  jobRuns: JobRun[];
  state: Record<string, unknown>;
  weightProfiles: WeightProfile[];
}

const empty = (): StoreShape => ({
  snapshots: [], userTeams: [], recommendations: [], actuals: [], evaluations: [], patterns: [], proposals: [],
  activations: [], fixtures: [], fixturePool: [], notificationPrefs: [], notifications: [], audit: [],
  prepared: [], jobRuns: [], state: {}, weightProfiles: [],
});

export class ImmutableRecordError extends Error {}

export class LocalRepository implements Repository {
  readonly kind = "local" as const;
  readonly persistent: boolean;
  private _data: StoreShape;
  private mtime = 0;

  constructor(private file: string | null) {
    this.persistent = !!file;
    this._data = empty();
    this.reload();
  }

  /** Re-read the file if another process (e.g. the pipeline daemon) wrote it since we last looked. */
  private reload() {
    if (!this.file || !fs.existsSync(this.file)) return;
    const m = fs.statSync(this.file).mtimeMs;
    if (m === this.mtime) return;
    try {
      this._data = { ...empty(), ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
      this.mtime = m;
    } catch {
      /* partially written file: keep the previous in-memory copy */
    }
  }

  private get data(): StoreShape {
    this.reload();
    return this._data;
  }

  private flush() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this._data));
    fs.renameSync(tmp, this.file);
    this.mtime = fs.statSync(this.file).mtimeMs;
  }

  private appendOnly<T extends { id: string }>(list: T[], item: T, what: string): T {
    if (list.some((x) => x.id === item.id)) throw new ImmutableRecordError(`${what} ${item.id} already exists and is immutable`);
    list.push(structuredClone(item));
    this.flush();
    return item;
  }

  async saveSnapshot(s: Snapshot) { return this.appendOnly(this.data.snapshots, s, "Snapshot"); }
  async getSnapshot(id: string) { return structuredClone(this.data.snapshots.find((s) => s.id === id) ?? null); }
  async listSnapshots(matchId?: string) { return structuredClone(this.data.snapshots.filter((s) => !matchId || s.matchId === matchId)); }

  async saveUserTeam(t: UserTeam) { return this.appendOnly(this.data.userTeams, t, "User team"); }
  async listUserTeams(userId: string, matchId?: string) {
    return structuredClone(this.data.userTeams.filter((t) => t.userId === userId && (!matchId || t.matchId === matchId)));
  }

  async saveRecommendation(r: OptimizerRecommendation) { return this.appendOnly(this.data.recommendations, r, "Recommendation"); }
  async listRecommendations(userId: string, matchId?: string) {
    return structuredClone(this.data.recommendations.filter((r) => r.userId === userId && (!matchId || r.matchId === matchId)));
  }

  async addActuals(rows: ActualPoint[]) {
    for (const r of rows) this.appendOnly(this.data.actuals, r, "Actual point");
    return rows;
  }
  async listActuals(userId: string, matchId: string) {
    return structuredClone(this.data.actuals.filter((a) => a.userId === userId && a.matchId === matchId));
  }

  async saveEvaluation(e: TeamEvaluation) {
    this._data.evaluations = this.data.evaluations.filter((x) => !(x.userId === e.userId && x.matchId === e.matchId));
    this.data.evaluations.push(structuredClone(e));
    this.flush();
    return e;
  }
  async listEvaluations(userId: string) { return structuredClone(this.data.evaluations.filter((e) => e.userId === userId)); }

  async replacePatterns(competition: Competition, source: ErrorPattern["source"], p: ErrorPattern[]) {
    this._data.patterns = this.data.patterns.filter((x) => !(x.competition === competition && x.source === source)).concat(structuredClone(p));
    this.flush();
  }
  async listPatterns(competition?: Competition) { return structuredClone(this.data.patterns.filter((p) => !competition || p.competition === competition)); }

  async saveProposal(p: ModelChangeProposal) {
    const i = this.data.proposals.findIndex((x) => x.id === p.id);
    if (i >= 0) {
      const prev = this.data.proposals[i];
      // Evaluations are immutable once recorded.
      if (prev.evaluation && p.evaluation && prev.evaluation.id !== p.evaluation.id) throw new ImmutableRecordError("Proposal evaluation is immutable");
      this.data.proposals[i] = structuredClone(p);
    } else this.data.proposals.push(structuredClone(p));
    this.flush();
    return p;
  }
  async listProposals() { return structuredClone(this.data.proposals); }

  async addActivation(a: ModelActivation) { return this.appendOnly(this.data.activations, a, "Activation"); }
  async listActivations(competition?: Competition) { return structuredClone(this.data.activations.filter((a) => !competition || a.competition === competition)); }

  async upsertFixtures(f: Fixture[], pool: ImportedPoolPlayer[]) {
    const ids = new Set(f.map((x) => x.id));
    this._data.fixtures = this.data.fixtures.filter((x) => !ids.has(x.id)).concat(structuredClone(f));
    const poolIds = new Set(pool.map((p) => p.fixtureId));
    this._data.fixturePool = this.data.fixturePool.filter((x) => !poolIds.has(x.fixtureId)).concat(structuredClone(pool));
    this.flush();
  }
  async listFixtures() { return structuredClone(this.data.fixtures); }
  async getFixture(id: string) { return structuredClone(this.data.fixtures.find((f) => f.id === id) ?? null); }
  async listFixturePool(fixtureId: string) { return structuredClone(this.data.fixturePool.filter((p) => p.fixtureId === fixtureId)); }

  async getNotificationPreference(userId: string) { return structuredClone(this.data.notificationPrefs.find((p) => p.userId === userId) ?? null); }
  async saveNotificationPreference(p: NotificationPreference) {
    this._data.notificationPrefs = this.data.notificationPrefs.filter((x) => x.userId !== p.userId).concat(structuredClone(p));
    this.flush();
    return p;
  }
  async upsertScheduledNotification(n: ScheduledNotification) {
    const existing = this.data.notifications.find((x) => x.idempotencyKey === n.idempotencyKey);
    if (existing && existing.id !== n.id) {
      // Idempotency: one row per key. Keep the original id.
      Object.assign(existing, { ...structuredClone(n), id: existing.id });
      this.flush();
      return structuredClone(existing);
    }
    this._data.notifications = this.data.notifications.filter((x) => x.id !== n.id).concat(structuredClone(n));
    this.flush();
    return n;
  }
  async listScheduledNotifications(filter: { userId?: string; status?: ScheduledNotification["status"] } = {}) {
    return structuredClone(this.data.notifications.filter((n) => (!filter.userId || n.userId === filter.userId) && (!filter.status || n.status === filter.status)));
  }

  async savePreparedAnalysis(a: PreparedAnalysis) { return this.appendOnly(this.data.prepared, a, "Prepared analysis"); }
  async listPreparedAnalyses(matchId?: string) {
    return structuredClone(this.data.prepared.filter((a) => !matchId || a.matchId === matchId).sort((a, b) => a.preparedAt.localeCompare(b.preparedAt) || a.version - b.version));
  }

  async saveJobRun(r: JobRun) {
    const i = this.data.jobRuns.findIndex((x) => x.id === r.id);
    if (i >= 0) this.data.jobRuns[i] = structuredClone(r);
    else this.data.jobRuns.push(structuredClone(r));
    if (this.data.jobRuns.length > 5000) this._data.jobRuns = this.data.jobRuns.slice(-5000);
    this.flush();
    return r;
  }
  async listJobRuns(filter: { job?: JobName; key?: string; limit?: number } = {}) {
    const rows = this.data.jobRuns.filter((r) => (!filter.job || r.job === filter.job) && (!filter.key || r.key === filter.key));
    return structuredClone(rows.slice(-(filter.limit ?? 500)).reverse());
  }

  async getState<T = unknown>(key: string) { return structuredClone((this.data.state[key] as T) ?? null); }
  async setState(key: string, value: unknown) {
    this._data.state[key] = structuredClone(value);
    this.flush();
  }

  async saveWeightProfile(w: WeightProfile) {
    this._data.weightProfiles = this.data.weightProfiles.filter((x) => x.id !== w.id).concat(structuredClone(w));
    this.flush();
    return w;
  }
  async listWeightProfiles(competition?: Competition) { return structuredClone(this.data.weightProfiles.filter((w) => !competition || w.competition === competition)); }

  async listAllEvaluations() { return structuredClone(this.data.evaluations); }

  async audit(entry: Omit<AuditLog, "id" | "at">) {
    this.data.audit.push({ ...structuredClone(entry), id: randomUUID(), at: new Date().toISOString() });
    if (this.data.audit.length > 2000) this._data.audit = this.data.audit.slice(-2000);
    this.flush();
  }
  async listAudit(limit = 100) { return structuredClone(this.data.audit.slice(-limit).reverse()); }
}
