import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runTick } from "@/lib/pipeline/jobs";
import { clockMode } from "@/lib/pipeline/clock";
import { getRepository } from "@/lib/store";

export const maxDuration = 60;

/**
 * Scheduler entry point (Vercel Cron or any external scheduler). Requires Authorization: Bearer $CRON_SECRET.
 * In simulated-clock mode each tick advances the clock by SIM_AUTO_ADVANCE_MINUTES (default 30).
 */
export async function GET(req: Request) {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const repo = getRepository(null);
  const advance = clockMode() === "simulated" ? Number(process.env.SIM_AUTO_ADVANCE_MINUTES ?? 30) / 60 : 0;
  const result = await runTick(repo, { advanceHours: advance });
  return NextResponse.json({ ...result, runs: result.runs.map((r) => ({ job: r.job, status: r.status, error: r.error })) });
}
