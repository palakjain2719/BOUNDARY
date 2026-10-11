import Link from "next/link";
import { getClock } from "@/lib/pipeline/clock";
import { formatClock, relativeTo } from "@/lib/format";
import { getRepository } from "@/lib/store";
import { isDemoMode } from "@/lib/env";

/** States the pipeline clock and last run plainly so simulated or demo data is never mistaken for live. */
export async function ClockBanner() {
  const repo = getRepository(null);
  const clock = await getClock(repo);
  const last = await repo.getState<{ at: string; clock: string; statuses: string[] }>("last_tick");
  const failed = last?.statuses.filter((s) => s.endsWith(":failed")) ?? [];
  return (
    <div role="status" className={`border-b border-line text-xs ${clock.simulated ? "bg-pastel-lilac" : "bg-pastel-green"}`}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
        <span className="font-semibold">{clock.simulated ? "Simulated replay clock" : "Live clock"}: {formatClock(clock.now.toISOString())}</span>
        {clock.simulated && <span>Archived Cricsheet fixtures are replayed as if live; results stay hidden until the simulated clock passes them.</span>}
        <span>
          Background pipeline: {last ? `last run ${relativeTo(last.at, new Date())}` : "not run yet"}
          {failed.length ? ` · ${failed.length} job(s) failed` : ""}
        </span>
        {isDemoMode() && <span>Storage: local demo store (no Supabase credentials).</span>}
        <Link href="/settings#pipeline" className="ml-auto font-semibold underline">
          Pipeline status
        </Link>
      </div>
    </div>
  );
}
