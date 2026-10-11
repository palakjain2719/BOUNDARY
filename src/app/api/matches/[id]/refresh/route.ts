import { prepareMatch } from "@/lib/pipeline/jobs";
import { getClock } from "@/lib/pipeline/clock";
import { HttpError, json, route } from "@/lib/http/handler";

/** Targeted refresh of one upcoming match (does not run the whole pipeline). */
export const POST = route<{ id: string }>(async ({ repo, params }) => {
  const f = await repo.getFixture(params.id);
  if (!f) throw new HttpError(404, "Only discovered or imported fixtures are prepared by the pipeline");
  if (f.status !== "upcoming") throw new HttpError(409, "Predictions are frozen once a match starts");
  return json(await prepareMatch(repo, await getClock(repo), f));
});
