import { describe, expect, it } from "vitest";
import { classifyLive, cricinfoIdFrom, FreeSourcesProvider, istToUtc, parseLiveRss, parseSeasonWikitext, parseWikiDate, plainWiki } from "@/lib/providers/free-sources";
import { archiveMatchId } from "@/lib/evaluation/evaluate";

const IPL_WIKI = `==Fixtures==
{{Single-innings cricket match
| round = {{anchor|match1}}'''Match 1'''
| date = {{Start date|2027|03|26|df=y}}
| time = 19:30
| team1 = [[Sunrisers Hyderabad]]
| team2 = [[Royal Challengers Bengaluru]] (H)
| report = [http://espncricinfo.com/ci/engine/match/1600001.html Scorecard]
| venue = [[M. Chinnaswamy Stadium]], [[Bengaluru]]
}}
{{Single-innings cricket match
| date = {{Start date|2027|03|20|df=y}}
| time = 15:30
| team1 = [[Mumbai Indians]]
| team2 = [[Chennai Super Kings]]
| result = Mumbai Indians won by 5 runs
| venue = [[Wankhede Stadium]], [[Mumbai]]
}}
{{Single-innings cricket match
| date = {{Start date|2027|03|27|df=y}}
| team1 = [[Somerset]]
| team2 = [[Mumbai Indians]]
}}`;

const WPL_WIKI = `{{Single-innings cricket match
| date = 14 January
| time = 19:30
| team1 = {{cr-IND|miw}}
| team2 = {{cr-IND|upw}}
| venue = [[DY Patil Stadium]], [[Navi Mumbai]]
| report = [https://www.espncricinfo.com/ci/engine/match/1600100.html Scorecard]
}}`;

const RSS = `<rss><channel>
<item><title>Mumbai Indians Women 120/3 * v Gujarat Giants Women</title><link>http://www.cricinfo.com/ci/engine/match/1600101.html?CMP=OTC-RSS</link></item>
<item><title>Chennai Super Kings v Kolkata Knight Riders 150/6 *</title><link>http://www.cricinfo.com/ci/engine/match/1600002.html?CMP=OTC-RSS</link></item>
<item><title>Bihar v Uttar Pradesh 287/3 *</title><link>http://www.cricinfo.com/ci/engine/match/1555000.html</link></item>
</channel></rss>`;

const now = new Date("2027-03-25T00:00:00Z");

describe("Wikipedia season parsing", () => {
  it("parses IPL match templates with IST times, results and Cricinfo ids, skipping non-franchise rows", () => {
    const f = parseSeasonWikitext(IPL_WIKI, "IPL", "https://en.wikipedia.org/wiki/2027_Indian_Premier_League", now, 2027);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ team1: "Sunrisers Hyderabad", team2: "Royal Challengers Bengaluru", startTimeUtc: "2027-03-26T14:00:00.000Z", status: "upcoming", providerMatchId: "ci-1600001", venue: "M. Chinnaswamy Stadium, Bengaluru" });
    expect(f[1]).toMatchObject({ status: "completed", result: "Mumbai Indians won by 5 runs", startTimeUtc: "2027-03-20T10:00:00.000Z" });
  });
  it("parses WPL rows with Cr-IND team codes and year-less dates", () => {
    const [f] = parseSeasonWikitext(WPL_WIKI, "WPL", "u", new Date("2027-01-10T00:00:00Z"), 2027);
    expect(f).toMatchObject({ team1: "Mumbai Indians", team2: "UP Warriorz", date: "2027-01-14", startTimeUtc: "2027-01-14T14:00:00.000Z", status: "upcoming", providerMatchId: "ci-1600100" });
  });
  it("helpers", () => {
    expect(plainWiki("[[Delhi Capitals (WPL)|Delhi Capitals]] (H)")).toBe("Delhi Capitals");
    expect(parseWikiDate("{{Start date|2027|3|5}}")).toBe("2027-03-05");
    expect(parseWikiDate("9 January", 2027)).toBe("2027-01-09");
    expect(istToUtc("2027-01-09", "19:30")).toBe("2027-01-09T14:00:00.000Z");
    expect(cricinfoIdFrom("[https://www.espncricinfo.com/ci/engine/match/1513682.html Scorecard]")).toBe("1513682");
    expect(archiveMatchId("ci-1513682")).toBe("1513682");
  });
});

describe("Cricinfo live RSS", () => {
  it("detects in-play IPL/WPL matches and ignores other cricket", () => {
    const items = parseLiveRss(RSS);
    expect(items).toHaveLength(3);
    expect(items.map(classifyLive)).toEqual([
      { competition: "WPL", team1: "Mumbai Indians", team2: "Gujarat Giants" },
      { competition: "IPL", team1: "Chennai Super Kings", team2: "Kolkata Knight Riders" },
      null,
    ]);
  });
});

describe("FreeSourcesProvider", () => {
  it("merges the Wikipedia schedule with live RSS, filters the window and caches", async () => {
    let wiki = 0;
    let rss = 0;
    const f = (async (url: string) => {
      if (url.includes("wikipedia")) {
        wiki++;
        const isIpl2027 = decodeURIComponent(url).includes("2027 Indian Premier League");
        return { ok: true, status: 200, json: async () => (isIpl2027 ? { parse: { title: "2027 Indian Premier League", wikitext: IPL_WIKI } } : { error: { code: "missingtitle" } }) };
      }
      rss++;
      return { ok: true, status: 200, text: async () => RSS };
    }) as unknown as typeof fetch;
    const p = new FreeSourcesProvider(f, () => now);
    const out = await p.searchFixtures();
    // MI v CSK finished 5 days ago: outside the 3-day "recent" window.
    expect(out.map((x) => x.name)).toEqual(["Sunrisers Hyderabad v Royal Challengers Bengaluru", "Mumbai Indians v Gujarat Giants", "Chennai Super Kings v Kolkata Knight Riders"]);
    expect(out.filter((x) => x.status === "live")).toHaveLength(2);
    await p.searchFixtures();
    expect(wiki).toBe(4); // 2 competitions × this year and next, once (cached afterwards)
    expect(rss).toBe(1);
  });
});
