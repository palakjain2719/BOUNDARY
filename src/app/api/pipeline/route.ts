import { runSimulation, runTick } from "@/lib/pipeline/jobs";
import { clockMode, getClock } from "@/lib/pipeline/clock";
import { body, HttpError, json, route } from "@/lib/http/handler";

export const maxDuration = 60;

export const GET = route(async ({ repo }) => {
  const clock = await getClock(repo);
  return json({ clock: clock.now.toISOString(), mode: clockMode(), lastTick: await repo.getState("last_tick"), runs: (await repo.listJobRuns({ limit: 80 })) });
});

/** Admin: run one tick now, or advance the simulated clock (in 30-minute ticks). */
export const POST = route(
  async ({ req, repo }) => {
    const b = await body<{ action: "tick" } | { action: "advance"; hours: number }>(req);
    if (b.action === "tick") return json(await runTick(repo));
    if (b.action === "advance") {
      if (clockMode() !== "simulated") throw new HttpError(409, "The clock is real-time");
      if (!(b.hours > 0 && b.hours <= 72)) throw new HttpError(400, "hours must be between 0 and 72");
      const ticks = await runSimulation(repo, b.hours);
      return json({ ticks: ticks.length, clock: ticks[ticks.length - 1]?.clock, failures: ticks.flatMap((t) => t.runs.filter((r) => r.status === "failed").map((r) => `${r.job}: ${r.error}`)) });
    }
    throw new HttpError(400, "Unknown action");
  },
  { admin: true },
);
