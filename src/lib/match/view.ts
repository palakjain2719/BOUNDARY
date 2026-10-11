/**
 * Server-side view model for the match dashboard. For pipeline fixtures it loads the latest PREPARED analysis
 * (no recomputation) plus a freshness check. For archived replays (not prepared by the pipeline) it builds the
 * workspace on demand.
 */
import type { SessionUser } from "../auth";
import type { DecisionPhase, PoolPlayer } from "../data/types";
import { getClock } from "../pipeline/clock";
import { analysisFreshness, type Freshness } from "../pipeline/freshness";
import { getRules } from "../scoring/registry";
import { getTeamRules, type TeamRules } from "../optimizer/rules";
import type { MatchContextSnapshot, OptimizerRecommendation, Repository, SnapshotPrediction, UserTeam } from "../store/types";
import { SYSTEM_USER_ID } from "../store/types";
import { buildWorkspace, headToHead, loadWorkspaceMatch, type HeadToHead, type WorkspaceMatch } from "./workspace";
import { findMatch } from "../data/historical";

export interface MatchView {
  match: WorkspaceMatch;
  clockIso: string;
  simulated: boolean;
  source: "prepared" | "on_demand";
  phase: DecisionPhase;
  availablePhases: DecisionPhase[];
  freshness: Freshness | null;
  snapshotId: string | null;
  snapshotAt: string | null;
  modelId: string;
  rulesId: string;
  rulesStatus: string;
  multipliers: { captain: number; viceCaptain: number };
  teamRules: TeamRules;
  pool: PoolPlayer[];
  predictions: SnapshotPrediction[];
  context: MatchContextSnapshot;
  headToHead: HeadToHead;
  recommendation: OptimizerRecommendation | null;
  infeasibility: string[] | null;
  suitability: { score: number; reasons: string[] } | null;
  versions: { version: number; phase: DecisionPhase; clockAt: string; trigger: string }[];
  userTeams: UserTeam[];
  warnings: string[];
}

export async function loadMatchView(repo: Repository, user: SessionUser, id: string, phase?: DecisionPhase): Promise<MatchView | null> {
  const clock = await getClock(repo);
  const loaded = await loadWorkspaceMatch(repo, id, clock);
  if (!loaded) return null;
  const userTeams = await repo.listUserTeams(user.id, id);
  const freshness = loaded.fixture ? await analysisFreshness(repo, id, clock) : null;
  const versions = (await repo.listPreparedAnalyses(id)).map((v) => ({ version: v.version, phase: v.decisionPhase, clockAt: v.clockAt, trigger: v.trigger }));
  const hist = findMatch(id);

  if (freshness?.analysis && (!phase || phase === freshness.analysis.decisionPhase)) {
    const a = freshness.analysis;
    const snap = await repo.getSnapshot(a.snapshotId);
    if (snap) {
      const rec = a.recommendationId ? (await repo.listRecommendations(SYSTEM_USER_ID, id)).find((r) => r.id === a.recommendationId) ?? null : null;
      const rules = getRules(snap.rulesId);
      const userRecs = await repo.listRecommendations(user.id, id);
      const ownRec = userRecs.filter((r) => r.snapshotId === snap.id).pop() ?? null;
      return {
        match: loaded.match, clockIso: clock.now.toISOString(), simulated: clock.simulated, source: "prepared", phase: snap.decisionPhase,
        availablePhases: [snap.decisionPhase], freshness, snapshotId: snap.id, snapshotAt: snap.snapshotAt, modelId: snap.modelId, rulesId: rules.id,
        rulesStatus: rules.status, multipliers: rules.multipliers, teamRules: getTeamRules(snap.teamRulesId), pool: snap.pool, predictions: snap.predictions,
        context: snap.context, headToHead: hist ? headToHead(hist.data, loaded.match.team1, loaded.match.team2, loaded.match.date) : { matches: 0, team1Wins: 0, team2Wins: 0, noResult: 0, last: [] },
        recommendation: ownRec ?? rec, infeasibility: a.infeasibility, suitability: { score: a.suitability.score, reasons: a.suitability.reasons }, versions, userTeams,
        warnings: [],
      };
    }
  }

  const ws = await buildWorkspace(repo, id, { phase, clock });
  if (!ws) return null;
  const userRecs = (await repo.listRecommendations(user.id, id)).filter((r) => r.modelId === ws.model.model.id);
  const ownRec = [...userRecs].reverse().find((r) => r.validation.teamRulesId === ws.teamRules.id) ?? null;
  return {
    match: loaded.match, clockIso: clock.now.toISOString(), simulated: clock.simulated, source: "on_demand", phase: ws.phase, availablePhases: ws.availablePhases,
    freshness, snapshotId: null, snapshotAt: null, modelId: ws.model.model.id, rulesId: ws.rules.id, rulesStatus: ws.rules.status, multipliers: ws.rules.multipliers,
    teamRules: ws.teamRules, pool: ws.pool, predictions: ws.predictions, context: ws.context, headToHead: ws.headToHead, recommendation: ownRec, infeasibility: null,
    suitability: null, versions, userTeams, warnings: ws.warnings,
  };
}
