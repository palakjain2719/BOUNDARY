import { getWeightsOverview, recomputeRecommended, saveCandidate, submitProfile } from "@/lib/learning/weights";
import { body, HttpError, json, route } from "@/lib/http/handler";
import type { Competition } from "@/lib/data/types";

export const maxDuration = 60;

export const GET = route(async ({ req, user, repo }) => {
  const c = (new URL(req.url).searchParams.get("competition") ?? "IPL") as Competition;
  return json(await getWeightsOverview(repo, c, user.id));
});

type Body =
  | { action: "save"; competition: Competition; weights: Record<string, number>; name?: string }
  | { action: "submit"; profileId: string }
  | { action: "recompute"; competition: Competition };

export const POST = route(async ({ req, user, repo }) => {
  const b = await body<Body>(req);
  if (b.action === "save") {
    if (!b.weights || Object.values(b.weights).some((v) => typeof v !== "number" || v < 0)) throw new HttpError(400, "Weights must be non-negative numbers");
    if (Object.values(b.weights).reduce((a, c) => a + c, 0) <= 0) throw new HttpError(400, "At least one weight must be above zero");
    return json(await saveCandidate(repo, user.id, b.competition, b.weights, b.name ?? ""));
  }
  if (b.action === "submit") {
    try {
      return json(await submitProfile(repo, user.id, b.profileId));
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  if (b.action === "recompute") {
    if (!user.isAdmin) throw new HttpError(403, "Admin only");
    return json(await recomputeRecommended(repo, b.competition));
  }
  throw new HttpError(400, "Unknown action");
});
