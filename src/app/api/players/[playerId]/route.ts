import { playerProfile } from "@/lib/players/profile";
import { loadWorkspaceMatch } from "@/lib/match/workspace";
import { getClock } from "@/lib/pipeline/clock";
import { HttpError, json, route } from "@/lib/http/handler";

/** GET /api/players/:id?matchId=… — career stats strictly before that match's date. */
export const GET = route<{ playerId: string }>(async ({ req, repo, params }) => {
  const matchId = new URL(req.url).searchParams.get("matchId");
  if (!matchId) throw new HttpError(400, "matchId is required");
  const loaded = await loadWorkspaceMatch(repo, matchId, await getClock(repo));
  if (!loaded) throw new HttpError(404, "Match not found");
  const profile = playerProfile(loaded.match.competition, decodeURIComponent(params.playerId), loaded.match.date);
  return json({ profile, competition: loaded.match.competition, beforeDate: loaded.match.date });
});
