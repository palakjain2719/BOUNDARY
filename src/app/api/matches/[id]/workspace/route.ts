import { buildWorkspace } from "@/lib/match/workspace";
import { HttpError, json, route } from "@/lib/http/handler";
import type { DecisionPhase } from "@/lib/data/types";

export const GET = route<{ id: string }>(async ({ req, repo, params }) => {
  const u = new URL(req.url);
  const ws = await buildWorkspace(repo, params.id, {
    phase: (u.searchParams.get("phase") as DecisionPhase) ?? undefined,
    teamRulesId: u.searchParams.get("teamRules") ?? undefined,
  });
  if (!ws) throw new HttpError(404, "Match not found");
  return json(ws);
});
