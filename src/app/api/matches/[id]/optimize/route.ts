import { generateRecommendation } from "@/lib/match/actions";
import { body, json, route } from "@/lib/http/handler";
import type { DecisionPhase } from "@/lib/data/types";
import type { RiskProfile } from "@/lib/optimizer/service";

export const maxDuration = 30;

export const POST = route<{ id: string }>(async ({ req, user, repo, params }) => {
  const b = await body<{ phase?: DecisionPhase; profile?: RiskProfile; teamRulesId?: string; exclude?: string[] }>(req);
  const r = await generateRecommendation(repo, user, params.id, b);
  if (r.infeasible) return json({ infeasible: r.infeasible }, 422);
  return json(r);
});

export const GET = route<{ id: string }>(async ({ user, repo, params }) => json(await repo.listRecommendations(user.id, params.id)));
