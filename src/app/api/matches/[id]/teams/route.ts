import { saveUserTeam } from "@/lib/match/actions";
import { body, json, route } from "@/lib/http/handler";
import type { DecisionPhase } from "@/lib/data/types";

export const POST = route<{ id: string }>(async ({ req, user, repo, params }) => {
  const b = await body<{ phase?: DecisionPhase; teamRulesId?: string; playerIds: string[]; captainId: string | null; viceCaptainId: string | null }>(req);
  if (!Array.isArray(b.playerIds)) return json({ error: "playerIds required" }, 400);
  return json(await saveUserTeam(repo, user, params.id, b), 201);
});

export const GET = route<{ id: string }>(async ({ user, repo, params }) => json(await repo.listUserTeams(user.id, params.id)));
