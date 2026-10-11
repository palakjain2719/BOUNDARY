/** Run Google Search grounded fixture discovery once and print what was found. Usage: npm run live:check */
import { GoogleSearchGroundedProvider } from "../src/lib/providers/google-search";

(async () => {
  const p = new GoogleSearchGroundedProvider(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL || "gemini-3.8-flash");
  for (const c of ["IPL", "WPL"] as const) {
    try {
      const g = await p.groundedText(p.fixtureQuestion(c));
      console.log(`${c}: searches: ${g.queries.join(" | ")}\n   sources: ${g.sources.map((s) => s.title).join(", ")}\n   answer: ${g.text.replace(/\s+/g, " ").slice(0, 400)}`);
    } catch (e) {
      console.log(`${c}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const all = await p.searchFixtures().catch((e) => (console.log("discovery error:", e.message), []));
  console.log(`Accepted (validated, source-cited): ${all.length}`);
  for (const f of all) console.log(" -", f.competition, f.name, f.startTimeUtc, f.status);
})();
