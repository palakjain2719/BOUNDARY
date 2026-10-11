/**
 * Pipeline clock. "real" uses wall-clock time and a live provider. "simulated" replays the Cricsheet archive
 * as if it were live: fixtures become upcoming/live/completed relative to a stored simulated time that only
 * moves forward when the scheduler (or an admin) advances it. Simulated mode is always labelled in the UI.
 */
import type { Repository } from "../store/types";
import { liveProvider } from "../providers";

export interface ClockInfo {
  now: Date;
  simulated: boolean;
}

export const SIM_CLOCK_KEY = "sim_clock";
export const DEFAULT_SIM_START = "2026-05-16T00:00:00.000Z";

export function clockMode(): "real" | "simulated" {
  const m = process.env.PIPELINE_CLOCK;
  if (m === "real" || m === "simulated") return m;
  return liveProvider() ? "real" : "simulated";
}

export async function getClock(repo: Repository): Promise<ClockInfo> {
  if (clockMode() === "real") return { now: new Date(), simulated: false };
  const stored = await repo.getState<string>(SIM_CLOCK_KEY);
  return { now: new Date(stored ?? process.env.DEMO_SIM_START ?? DEFAULT_SIM_START), simulated: true };
}

/** Move the simulated clock forward (never backwards: predictions already frozen must stay in the past). */
export async function advanceSimClock(repo: Repository, to: Date | { hours: number }): Promise<ClockInfo> {
  if (clockMode() !== "simulated") throw new Error("Clock is real-time; it cannot be advanced");
  const cur = await getClock(repo);
  const next = to instanceof Date ? to : new Date(cur.now.getTime() + to.hours * 3600_000);
  if (next.getTime() < cur.now.getTime()) throw new Error("The simulated clock only moves forward");
  await repo.setState(SIM_CLOCK_KEY, next.toISOString());
  await repo.audit({ actor: "scheduler", action: "clock.advanced", entity: "system_state", entityId: SIM_CLOCK_KEY, details: { from: cur.now.toISOString(), to: next.toISOString() } });
  return { now: next, simulated: true };
}

// ---- Simulated fixture timing (assumed: Cricsheet has dates but no start times) ----------------------------
export const TOSS_BEFORE_START_MIN = 30;
export const MATCH_DURATION_H = 4;

/** Assumed start: 14:00 UTC (19:30 IST); on double-header days the earlier id starts 10:00 UTC (15:30 IST). */
export function assumedStartUtc(date: string, isEarlierOfDoubleHeader: boolean) {
  return `${date}T${isEarlierOfDoubleHeader ? "10" : "14"}:00:00.000Z`;
}

export function tossTime(startTimeUtc: string) {
  return new Date(Date.parse(startTimeUtc) - TOSS_BEFORE_START_MIN * 60_000);
}

export function statusAt(startTimeUtc: string, now: Date): "upcoming" | "live" | "completed" {
  const start = Date.parse(startTimeUtc);
  if (now.getTime() < start) return "upcoming";
  if (now.getTime() < start + MATCH_DURATION_H * 3600_000) return "live";
  return "completed";
}
