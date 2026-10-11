import { listCatalog } from "@/lib/match/catalog";
import { getClock } from "@/lib/pipeline/clock";
import { json, route } from "@/lib/http/handler";
import type { Competition, MatchStatus } from "@/lib/data/types";

export const GET = route(async ({ req, repo }) => {
  const u = new URL(req.url);
  const tab = (u.searchParams.get("tab") ?? "completed") as MatchStatus;
  const result = await listCatalog(repo, {
    tab,
    q: u.searchParams.get("q") ?? undefined,
    competition: (u.searchParams.get("competition") ?? "all") as Competition | "all",
    season: u.searchParams.get("season") ?? undefined,
    page: Number(u.searchParams.get("page") ?? 1),
  }, await getClock(repo));
  return json(result);
});
