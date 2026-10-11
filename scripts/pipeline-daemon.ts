/**
 * Local background scheduler: runs a pipeline tick every --interval seconds (default 60). In simulated mode
 * each tick advances the clock by --sim-minutes (default 30). Usage: npm run pipeline:daemon
 */
import { runTick } from "../src/lib/pipeline/jobs";
import { clockMode } from "../src/lib/pipeline/clock";
import { getRepository } from "../src/lib/store";

const arg = (n: string, d: number) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const interval = arg("interval", 60);
const simMinutes = arg("sim-minutes", 30);

async function loop() {
  const repo = getRepository(null);
  const t = await runTick(repo, { advanceHours: clockMode() === "simulated" ? simMinutes / 60 : 0 });
  console.log(new Date().toISOString(), t.locked ? "locked (another tick running)" : `clock ${t.clock} ${t.runs.map((r) => `${r.job}:${r.status}`).join(" ")}`);
}
console.log(`Pipeline daemon: every ${interval}s, clock mode ${clockMode()}${clockMode() === "simulated" ? `, +${simMinutes} sim-min per tick` : ""}`);
loop();
setInterval(loop, interval * 1000);
