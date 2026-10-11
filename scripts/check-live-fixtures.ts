/**
 * Check the zero-cost fixture sources. Usage: npm run live:check [-- --season "2026 Indian Premier League"]
 * Without --season it runs the provider as of now (Wikipedia schedule + Cricinfo live RSS).
 */
import { FreeSourcesProvider, parseSeasonWikitext, USER_AGENT, classifyLive } from "../src/lib/providers/free-sources";

(async () => {
  const i = process.argv.indexOf("--season");
  if (i >= 0) {
    const title = process.argv[i + 1];
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&formatversion=2`;
    const j = (await (await fetch(url, { headers: { "User-Agent": USER_AGENT } })).json()) as { parse: { wikitext: string } };
    const comp = /women/i.test(title) ? "WPL" : "IPL";
    const f = parseSeasonWikitext(j.parse.wikitext, comp, url, new Date(), Number(title.slice(0, 4)));
    console.log(`${title}: ${f.length} fixtures parsed; with start time ${f.filter((x) => x.startTimeUtc).length}; with Cricinfo id ${f.filter((x) => x.cricinfoId).length}; completed ${f.filter((x) => x.status === "completed").length}`);
    for (const x of [f[0], f[1], f[f.length - 1]]) console.log(" -", x?.date, x?.startTimeUtc, x?.name, "@", x?.venue, "|", x?.result, "| id", x?.providerMatchId);
    return;
  }
  const p = new FreeSourcesProvider();
  const s = await p.loadSchedule();
  console.log("Season pages found:", s.pages.join(", ") || "none");
  console.log("Fixtures on those pages:", s.fixtures.length);
  const live = await p.liveItems();
  console.log(`Cricinfo live feed: ${live.length} matches in play worldwide; IPL/WPL among them: ${live.filter((x) => classifyLive(x)).length}`);
  const window = await p.searchFixtures();
  console.log(`In discovery window (−3 to +30 days): ${window.length}`);
  for (const f of window) console.log(" -", f.competition, f.status, f.startTimeUtc ?? f.date, f.name);
})();
