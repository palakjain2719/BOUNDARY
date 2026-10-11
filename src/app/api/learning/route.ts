import { backtestProposal, decideProposal, proposeChanges, refreshPatterns, refreshLivePatterns, rollback } from "@/lib/learning/loop";
import { getActiveModel } from "@/lib/models/registry";
import { body, HttpError, json, route } from "@/lib/http/handler";
import type { Competition } from "@/lib/data/types";

export const maxDuration = 60;

type Body =
  | { action: "refresh"; competition: Competition }
  | { action: "propose"; competition: Competition }
  | { action: "backtest"; proposalId: string }
  | { action: "decide"; proposalId: string; decision: "accept" | "reject" }
  | { action: "rollback"; competition: Competition };

export const POST = route(
  async ({ req, user, repo }) => {
    const b = await body<Body>(req);
    switch (b.action) {
      case "refresh": {
        const r = await refreshPatterns(repo, b.competition);
        const active = await getActiveModel(repo, b.competition);
        const evals = (await repo.listAllEvaluations()).filter((e) => e.scope === "system");
        const live = await refreshLivePatterns(repo, b.competition, evals.filter((e) => e.poolPlayers?.length), active.model.id);
        return json({ ...r, livePatterns: live });
      }
      case "propose":
        return json(await proposeChanges(repo, b.competition));
      case "backtest": {
        const p = (await repo.listProposals()).find((x) => x.id === b.proposalId);
        if (!p) throw new HttpError(404, "Proposal not found");
        return json(await backtestProposal(repo, p, user.id));
      }
      case "decide":
        try {
          return json(await decideProposal(repo, b.proposalId, b.decision, user.id));
        } catch (e) {
          throw new HttpError(409, e instanceof Error ? e.message : String(e));
        }
      case "rollback":
        return json(await rollback(repo, b.competition, user.id));
      default:
        throw new HttpError(400, "Unknown action");
    }
  },
  { admin: true },
);
