import { loadWorkspaceMatch } from "@/lib/match/workspace";
import { matchWeather } from "@/lib/providers/weather";
import { HttpError, json, route } from "@/lib/http/handler";
import { getClock } from "@/lib/pipeline/clock";

export const GET = route<{ id: string }>(async ({ repo, params }) => {
  const clock = await getClock(repo);
  const m = await loadWorkspaceMatch(repo, params.id, clock);
  if (!m) throw new HttpError(404, "Match not found");
  return json(await matchWeather(m.match.venue, m.match.date, new Date(), fetch, clock));
});
