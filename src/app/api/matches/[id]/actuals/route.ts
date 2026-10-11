import { recordActuals } from "@/lib/match/actions";
import { parseActualsCsv } from "@/lib/providers/csv-import";
import { getReview } from "@/lib/match/actions";
import { body, HttpError, json, route } from "@/lib/http/handler";

type Body =
  | { mode: "manual"; includesMultiplier: boolean; entries: { playerId: string; points: number }[] }
  | { mode: "manual_csv"; includesMultiplier: boolean; csv: string }
  | { mode: "reconstructed" | "kaggle_label" };

export const POST = route<{ id: string }>(async ({ req, user, repo, params }) => {
  const b = await body<Body>(req);
  if (b.mode === "manual_csv") {
    const review = await getReview(repo, user, params.id);
    const parsed = parseActualsCsv(b.csv, new Set(review.unionPlayerIds));
    if (parsed.errors.length) throw new HttpError(400, "CSV has errors", parsed.errors);
    return json(await recordActuals(repo, user, params.id, { mode: "manual", includesMultiplier: b.includesMultiplier, entries: parsed.rows }));
  }
  if (b.mode === "manual" && typeof b.includesMultiplier !== "boolean") throw new HttpError(400, "Say whether the points include captain/vice-captain multipliers");
  if (!["manual", "reconstructed", "kaggle_label"].includes(b.mode)) throw new HttpError(400, "Unknown mode");
  return json(await recordActuals(repo, user, params.id, b));
});
