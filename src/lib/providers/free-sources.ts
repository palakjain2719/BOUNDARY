/**
 * Zero-cost live fixture provider (no API keys, no AI calls, no scraping of HTML pages):
 *
 * - Schedule (upcoming + completed): Wikipedia season pages via the MediaWiki API, parsing the structured
 *   {{Single-innings cricket match}} templates. Wikipedia permits automated API reads with a descriptive
 *   User-Agent; content is CC BY-SA and attributed in the UI.
 * - Live now: ESPNcricinfo's public live-scores RSS syndication feed (static.cricinfo.com/rss/livescores.xml),
 *   matched to IPL / WPL franchises. Attributed with a link back.
 *
 * Squads/XIs are not available from these sources; the workspace falls back to a labelled squad proxy from
 * Cricsheet history. Start times on Wikipedia are local (India) times and are converted from IST; this
 * assumption is stated in the UI. Results are cached (schedule 6 h, 24 h when nothing is found; RSS 2 min).
 */
import type { Competition } from "../data/types";
import { canonicalTeam } from "../data/normalize";
import type { CricketDataProvider, ProviderCoverage, ProviderFixture } from "./types";

export const USER_AGENT = "BOUNDARY-match-optimizer/1.0 (fixture discovery; https://github.com/palakjain2719/BOUNDARY)";
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const RSS_URL = "https://static.cricinfo.com/rss/livescores.xml";

export const IPL_TEAMS = [
  "Chennai Super Kings", "Mumbai Indians", "Royal Challengers Bengaluru", "Kolkata Knight Riders", "Delhi Capitals",
  "Punjab Kings", "Rajasthan Royals", "Sunrisers Hyderabad", "Gujarat Titans", "Lucknow Super Giants",
];
export const WPL_TEAMS = ["Mumbai Indians", "Royal Challengers Bengaluru", "Delhi Capitals", "Gujarat Giants", "UP Warriorz"];

export interface FreeFixture extends ProviderFixture {
  source: "wikipedia" | "cricinfo_rss";
  sourceUrl: string;
  cricinfoId: string | null;
  result: string | null;
  timeAssumedIst: boolean;
}

// ---------------------------------------------------------------------------------------------------------
// Pure parsers (unit-tested)
// ---------------------------------------------------------------------------------------------------------

/** Team codes from Wikipedia's Template:Cr-IND (used on season pages as {{cr-IND|miw}}). */
export const CR_IND: Record<string, string> = {
  csk: "Chennai Super Kings", dc: "Delhi Capitals", gt: "Gujarat Titans", kkr: "Kolkata Knight Riders", lsg: "Lucknow Super Giants",
  mi: "Mumbai Indians", pbks: "Punjab Kings", kxip: "Punjab Kings", rr: "Rajasthan Royals", rcb: "Royal Challengers Bengaluru", srh: "Sunrisers Hyderabad",
  dcw: "Delhi Capitals", ggw: "Gujarat Giants", miw: "Mumbai Indians", rcbw: "Royal Challengers Bengaluru", upw: "UP Warriorz",
};

/** "[[A|B]]" → "B", "[[A]]" → "A", strips refs, templates like {{nowrap|x}} → x, bold/italics and "(H)". */
export function plainWiki(s: string): string {
  return s
    .replace(/\{\{\s*cr-IND\s*\|\s*([a-z]+)[^}]*\}\}/gi, (_m, c: string) => CR_IND[c.toLowerCase()] ?? c)
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/\{\{(?:nowrap|flagicon|cr|abbr)\|([^}|]*)(?:\|[^}]*)?\}\}/gi, "$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s([^\]]*)\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/\(H\)/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a template body into its named params (handles nested {{…}} and [[…]]). */
export function templateParams(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0;
  let cur = "";
  const parts: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      depth++;
      cur += two;
      i++;
      continue;
    }
    if (two === "}}" || two === "]]") {
      depth--;
      cur += two;
      i++;
      continue;
    }
    if (body[i] === "|" && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += body[i];
  }
  parts.push(cur);
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq > 0) out[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return out;
}

/** Extract every {{Single-innings cricket match …}} template body from wikitext. */
export function matchTemplates(wikitext: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*Single-innings cricket match/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wikitext))) {
    let depth = 0;
    let i = m.index;
    for (; i < wikitext.length; i++) {
      if (wikitext.startsWith("{{", i)) {
        depth++;
        i++;
      } else if (wikitext.startsWith("}}", i)) {
        depth--;
        i++;
        if (depth === 0) break;
      }
    }
    out.push(wikitext.slice(m.index + 2, i - 1).replace(/^\s*Single-innings cricket match\s*/i, ""));
  }
  return out;
}

/** {{Start date|2026|03|28|df=y}}, "28 March 2026" or "9 January" (+ season year) → ISO date. */
export function parseWikiDate(v: string, seasonYear?: number): string | null {
  const t = v.match(/\{\{\s*(?:start date|date)\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i);
  if (t) return `${t[1]}-${t[2].padStart(2, "0")}-${t[3].padStart(2, "0")}`;
  let plain = plainWiki(v);
  if (!/\d{4}/.test(plain) && seasonYear) plain = `${plain} ${seasonYear}`;
  const d = Date.parse(`${plain} 00:00 UTC`);
  return Number.isNaN(d) ? null : new Date(d).toISOString().slice(0, 10);
}

/** Local India time → UTC ISO. Wikipedia IPL/WPL times are IST (UTC+05:30). */
export function istToUtc(date: string, time: string | null): string | null {
  const m = time?.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const ms = Date.parse(`${date}T${m[1].padStart(2, "0")}:${m[2]}:00+05:30`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function cricinfoIdFrom(s: string | undefined | null): string | null {
  const m = s?.match(/(?:espncricinfo\.com|cricinfo\.com)[^\s\]]*?(?:\/match\/|-)(\d{6,8})(?:\.html|\/|\b)/i);
  return m ? m[1] : null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function parseSeasonWikitext(wikitext: string, competition: Competition, pageUrl: string, now: Date, seasonYear?: number): FreeFixture[] {
  const teams = new Set(competition === "IPL" ? IPL_TEAMS : WPL_TEAMS);
  const out: FreeFixture[] = [];
  for (const body of matchTemplates(wikitext)) {
    const p = templateParams(body);
    const date = p.date ? parseWikiDate(p.date, seasonYear) : null;
    const team1 = canonicalTeam(plainWiki(p.team1 ?? ""));
    const team2 = canonicalTeam(plainWiki(p.team2 ?? ""));
    if (!date || !teams.has(team1) || !teams.has(team2) || team1 === team2) continue;
    const startUtc = istToUtc(date, p.time ?? null);
    const result = plainWiki(p.result ?? "") || null;
    const startMs = startUtc ? Date.parse(startUtc) : Date.parse(`${date}T14:00:00Z`);
    const cricinfoId = cricinfoIdFrom(p.report);
    const status: FreeFixture["status"] = result ? "completed" : startMs + 4 * 3600_000 < now.getTime() ? "completed" : startMs <= now.getTime() ? "live" : "upcoming";
    out.push({
      providerMatchId: cricinfoId ? `ci-${cricinfoId}` : `wk-${competition.toLowerCase()}-${date}-${slug(team1)}-${slug(team2)}`,
      competition,
      name: `${team1} v ${team2}`,
      date,
      startTimeUtc: startUtc,
      venue: plainWiki(p.venue ?? ""),
      team1,
      team2,
      status,
      matchType: "T20",
      source: "wikipedia",
      sourceUrl: pageUrl,
      cricinfoId,
      result,
      timeAssumedIst: !!startUtc,
    });
  }
  return out;
}

export interface LiveRssItem {
  title: string;
  link: string;
  team1: string;
  team2: string;
  cricinfoId: string | null;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Parse the Cricinfo live-scores RSS: "Team A 150/3 * v Team B" → teams (scores stripped). */
export function parseLiveRss(xml: string): LiveRssItem[] {
  const out: LiveRssItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = decode((m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").trim());
    const link = (m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    const [a, b] = title.split(/\s+v\s+/);
    if (!a || !b) continue;
    const clean = (s: string) => s.replace(/\d+\/\d+.*$/, "").replace(/\*/g, "").replace(/&\s*$/, "").trim();
    out.push({ title, link, team1: clean(a), team2: clean(b), cricinfoId: cricinfoIdFrom(link) });
  }
  return out;
}

/** Which competition (if any) a live RSS item belongs to. WPL teams appear with a "Women" suffix on Cricinfo. */
export function classifyLive(item: LiveRssItem): { competition: Competition; team1: string; team2: string } | null {
  const women = /\bwomen\b/i.test(item.team1) || /\bwomen\b/i.test(item.team2);
  const strip = (s: string) => canonicalTeam(s.replace(/\s*women\b/i, "").trim());
  const t1 = strip(item.team1);
  const t2 = strip(item.team2);
  const list = women ? WPL_TEAMS : IPL_TEAMS;
  if (list.includes(t1) && list.includes(t2) && t1 !== t2) return { competition: women ? "WPL" : "IPL", team1: t1, team2: t2 };
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------------------------------------

export class FreeSourcesProvider implements CricketDataProvider {
  readonly id = "free-sources";
  private schedule: { at: number; fixtures: FreeFixture[]; pages: string[] } | null = null;
  private rss: { at: number; items: LiveRssItem[] } | null = null;

  constructor(private fetchImpl: typeof fetch = fetch, private now: () => Date = () => new Date(), private ttlMin = Number(process.env.FIXTURE_SCHEDULE_TTL_MIN ?? 360)) {}

  coverage(): ProviderCoverage {
    return {
      provider: "Wikipedia (schedule) + ESPNcricinfo live RSS (in-play) — free, no keys",
      competitions: ["Men's IPL and women's WPL, as listed on Wikipedia season pages"],
      fields: {
        fixtures: "supported", matchDetails: "supported", squads: "unsupported", playingXI: "unsupported", scorecard: "unsupported",
        ballByBall: "unsupported", playerStats: "unsupported", pitchReport: "unsupported", weather: "unsupported", credits: "unsupported",
      },
      notes: [
        "Schedule: Wikipedia (CC BY-SA) via the MediaWiki API; fixtures appear once editors add them. Start times are Indian local time converted from IST.",
        "Live: ESPNcricinfo live-scores RSS (© ESPNcricinfo), linked back on each match.",
        "No squads/XIs or player results from these sources: the pool is a squad proxy from Cricsheet history; actual points come from Cricsheet once published or CSV import.",
      ],
    };
  }

  private async get(url: string, accept: string) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await this.fetchImpl(url, { headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT, Accept: accept }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  /** Season pages for this year and next, e.g. "2027 Women's Premier League (cricket)". */
  seasonTitles(): { competition: Competition; title: string; year: number }[] {
    const y = this.now().getUTCFullYear();
    return [y, y + 1].flatMap((year) => [
      { competition: "IPL" as Competition, title: `${year} Indian Premier League`, year },
      { competition: "WPL" as Competition, title: `${year} Women's Premier League (cricket)`, year },
    ]);
  }

  async loadSchedule(): Promise<{ fixtures: FreeFixture[]; pages: string[] }> {
    const now = this.now();
    const ttl = this.schedule && this.schedule.fixtures.length === 0 ? Math.max(this.ttlMin, 24 * 60) : this.ttlMin;
    if (this.schedule && now.getTime() - this.schedule.at < ttl * 60_000) return this.schedule;
    const fixtures: FreeFixture[] = [];
    const pages: string[] = [];
    for (const { competition, title, year } of this.seasonTitles()) {
      const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&formatversion=2&origin=*`;
      const res = await this.get(url, "application/json");
      const j = (await res.json()) as { parse?: { wikitext?: string; title?: string }; error?: { code?: string } };
      if (j.error?.code === "missingtitle" || !j.parse?.wikitext) continue;
      const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent((j.parse.title ?? title).replace(/ /g, "_"))}`;
      pages.push(pageUrl);
      fixtures.push(...parseSeasonWikitext(j.parse.wikitext, competition, pageUrl, now, year));
    }
    this.schedule = { at: now.getTime(), fixtures, pages };
    return this.schedule;
  }

  async liveItems(): Promise<LiveRssItem[]> {
    const now = this.now();
    if (this.rss && now.getTime() - this.rss.at < 2 * 60_000) return this.rss.items;
    const res = await this.get(RSS_URL, "application/rss+xml, application/xml");
    this.rss = { at: now.getTime(), items: parseLiveRss(await res.text()) };
    return this.rss.items;
  }

  /** Window: completed in the last 3 days, live, or starting within 30 days. Live RSS overrides status. */
  async searchFixtures(): Promise<ProviderFixture[]> {
    const now = this.now();
    const { fixtures } = await this.loadSchedule();
    const live = await this.liveItems().catch(() => [] as LiveRssItem[]);
    const byKey = new Map(fixtures.map((f) => [`${f.competition}|${f.team1}|${f.team2}`, f]));
    const out = fixtures.filter((f) => {
      const t = Date.parse(f.startTimeUtc ?? `${f.date}T14:00:00Z`);
      return t >= now.getTime() - 3 * 86400_000 && t <= now.getTime() + 30 * 86400_000;
    });
    for (const item of live) {
      const c = classifyLive(item);
      if (!c) continue;
      const today = now.toISOString().slice(0, 10);
      const match = [byKey.get(`${c.competition}|${c.team1}|${c.team2}`), byKey.get(`${c.competition}|${c.team2}|${c.team1}`)].find((f) => f && Math.abs(Date.parse(f.date) - Date.parse(today)) <= 86400_000);
      if (match) {
        match.status = "live";
        if (!out.includes(match)) out.push(match);
      } else {
        out.push({
          providerMatchId: item.cricinfoId ? `ci-${item.cricinfoId}` : `rss-${c.competition.toLowerCase()}-${today}-${slug(c.team1)}-${slug(c.team2)}`,
          competition: c.competition, name: `${c.team1} v ${c.team2}`, date: today, startTimeUtc: null, venue: "", team1: c.team1, team2: c.team2,
          status: "live", matchType: "T20", source: "cricinfo_rss", sourceUrl: item.link, cricinfoId: item.cricinfoId, result: null, timeAssumedIst: false,
        } as FreeFixture);
      }
    }
    return out;
  }

  async matchDetails(id: string) {
    return (await this.searchFixtures()).find((f) => f.providerMatchId === id) ?? null;
  }
  async squad() {
    return [];
  }
  async playingXI() {
    return null;
  }
  async scorecard() {
    return null;
  }
  async ballByBall() {
    return null;
  }
  async historicalPlayerStats() {
    return null;
  }
  async pitchReport() {
    return null;
  }
}
