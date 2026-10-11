/** Cross-check Wikipedia-parsed fixtures against the Cricsheet archive (ids, dates, teams). */
import { loadCompetition } from "../src/lib/data/historical";
import { canonicalTeam } from "../src/lib/data/normalize";
import { parseSeasonWikitext, USER_AGENT } from "../src/lib/providers/free-sources";

(async () => {
  for (const title of ["2025 Women's Premier League (cricket)", "2026 Women's Premier League (cricket)", "2025 Indian Premier League", "2026 Indian Premier League"]) {
    const comp = /women/i.test(title) ? "WPL" : "IPL";
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&formatversion=2`;
    const j = (await (await fetch(url, { headers: { "User-Agent": USER_AGENT } })).json()) as { parse: { wikitext: string } };
    const fx = parseSeasonWikitext(j.parse.wikitext, comp, url, new Date(), Number(title.slice(0, 4)));
    const data = loadCompetition(comp);
    let idHit = 0, dateOk = 0, teamsOk = 0;
    const bad: string[] = [];
    for (const f of fx) {
      const m = f.cricinfoId ? data.matchById.get(f.cricinfoId) : undefined;
      if (!m) continue;
      idHit++;
      if (m.date === f.date) dateOk++;
      else bad.push(`${f.cricinfoId} date wiki ${f.date} vs cricsheet ${m.date}`);
      const a = new Set([canonicalTeam(m.team1), canonicalTeam(m.team2)]);
      if (a.has(f.team1) && a.has(f.team2)) teamsOk++;
      else bad.push(`${f.cricinfoId} teams ${f.name} vs ${m.team1} v ${m.team2}`);
    }
    console.log(`${title}: wiki ${fx.length} | in Cricsheet ${idHit} | same date ${dateOk} | same teams ${teamsOk}${bad.length ? " | " + bad.slice(0, 3).join("; ") : ""}`);
  }
})();
