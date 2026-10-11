/** Run one pipeline tick against the configured repository. Usage: npx tsx scripts/pipeline-tick.ts [--advance-hours N] */
import { runSimulation, runTick } from "../src/lib/pipeline/jobs";
import { getRepository } from "../src/lib/store";

const i = process.argv.indexOf("--advance-hours");
const hours = i >= 0 ? Number(process.argv[i + 1]) : 0;
(async () => {
  const repo = getRepository(null);
  const ticks = hours > 0 ? await runSimulation(repo, hours) : [await runTick(repo)];
  for (const t of ticks) console.log(t.clock, t.runs.map((r) => `${r.job}:${r.status}${r.error ? `(${r.error})` : ""}`).join(" "));
})();
