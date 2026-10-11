/**
 * Live fixture detection through Gemini "Grounding with Google Search" — an authorised Google API, not a scraper.
 * Gemini performs the Google searches server-side and returns grounding metadata (queries + source pages).
 *
 * Safeguards:
 * - An answer is only accepted when grounding actually happened (search queries and web sources present);
 *   ungrounded model-memory answers are rejected.
 * - Every fixture must cite a source URL from those grounding sources.
 * - Results are labelled unverified (search-derived); nothing here is used as an actual-points source.
 * - Discovery is cached (GOOGLE_SEARCH_DISCOVERY_TTL_MIN, default 360) to limit billed grounded queries.
 */
import { env } from "../env";
import type { Competition, PlayerRole } from "../data/types";
import type { CricketDataProvider, ProviderCoverage, ProviderFixture, ProviderSquadPlayer } from "./types";
import type { Repository } from "../store/types";
import { blockForToday, tryConsume } from "../ai/budget";

export interface GroundedFixture extends ProviderFixture {
  sourceUrl: string;
  sourceTitle: string | null;
}

interface GroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiResponse {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
    groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: GroundingChunk[] };
  }[];
  error?: { message?: string };
}

export interface GroundedAnswer<T> {
  data: T;
  queries: string[];
  sources: { url: string; title: string | null }[];
}

const COMPETITION_QUERY: Record<Competition, string> = {
  IPL: "the men's Indian Premier League (IPL, T20)",
  WPL: "the Women's Premier League (WPL, T20)",
};

/** Pull the first JSON object out of a model reply (handles ```json fences and surrounding prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in grounded answer");
  return JSON.parse(body.slice(start, end + 1));
}

const FIXTURE_SCHEMA = '{"fixtures":[{"team1":"","team2":"","startTimeUtc":"ISO 8601 in UTC","venue":"","status":"upcoming|live|completed","sourceUrl":""}]} (empty fixtures list if none)';

const VALID_STATUS = new Set(["upcoming", "live", "completed"]);

/** Validate model-proposed fixtures against the grounding sources. Pure function, unit-tested. */
export function validateFixtures(raw: unknown, competition: Competition, sources: { url: string; title: string | null }[], now: Date): GroundedFixture[] {
  const list = (raw as { fixtures?: unknown[] })?.fixtures;
  if (!Array.isArray(list)) return [];
  const hosts = new Set(sources.map((s) => safeHost(s.url)).filter(Boolean));
  const out: GroundedFixture[] = [];
  for (const f of list as Record<string, unknown>[]) {
    const team1 = String(f.team1 ?? "").trim();
    const team2 = String(f.team2 ?? "").trim();
    const start = String(f.startTimeUtc ?? "").trim();
    const startMs = Date.parse(start);
    if (!team1 || !team2 || team1 === team2 || Number.isNaN(startMs)) continue;
    // Must cite one of the pages Google actually returned (grounding redirect URLs are matched by source title/host).
    const cited = String(f.sourceUrl ?? "");
    const src = sources.find((s) => s.url === cited) ?? sources.find((s) => (s.title && cited.includes(s.title)) || hosts.has(safeHost(cited)));
    if (!src) continue;
    const status = VALID_STATUS.has(String(f.status)) ? (String(f.status) as ProviderFixture["status"]) : startMs > now.getTime() ? "upcoming" : "completed";
    const date = new Date(startMs).toISOString().slice(0, 10);
    out.push({
      providerMatchId: `gs-${competition.toLowerCase()}-${date}-${slug(team1)}-${slug(team2)}`,
      competition,
      name: `${team1} v ${team2}`,
      date,
      startTimeUtc: new Date(startMs).toISOString(),
      venue: String(f.venue ?? "").trim(),
      team1,
      team2,
      status,
      matchType: "T20",
      sourceUrl: src.url,
      sourceTitle: src.title,
    });
  }
  return out;
}

function safeHost(u: string) {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export class GoogleSearchGroundedProvider implements CricketDataProvider {
  readonly id = "google-search-grounded";
  private cache: { at: number; fixtures: GroundedFixture[] } | null = null;
  /** Repository used to share the zero-cost daily budget across instances (set by the pipeline). */
  budgetRepo: Repository | null = null;

  constructor(
    private apiKey: string = env.geminiApiKey,
    private model: string = env.geminiModel,
    private fetchImpl: typeof fetch = fetch,
    private now: () => Date = () => new Date(),
    private ttlMin = Number(process.env.GOOGLE_SEARCH_DISCOVERY_TTL_MIN ?? 360),
  ) {}

  coverage(): ProviderCoverage {
    return {
      provider: "Google Search (via Gemini grounding)",
      competitions: ["Men's IPL and women's WPL fixtures found by Google Search — unverified, source-cited"],
      fields: {
        fixtures: "unverified", matchDetails: "unverified", squads: "unverified", playingXI: "unverified", scorecard: "unsupported",
        ballByBall: "unsupported", playerStats: "unsupported", pitchReport: "unsupported", weather: "unsupported", credits: "unsupported",
      },
      notes: [
        "Authorised Google API (Gemini grounding), not scraping. Each fixture must cite a page Google returned.",
        "Search results can be wrong or stale; treat fixtures and lineups as unverified.",
        "No player-level results: import actual points via CSV after a match.",
        "Grounded queries are billed by Google beyond the free tier; discovery is cached.",
      ],
    };
  }

  private async call(body: unknown): Promise<GeminiResponse["candidates"]> {
    if (!this.apiKey || !this.model) throw new Error("GEMINI_API_KEY and GEMINI_MODEL are required for Google Search grounding");
    if (!(await tryConsume("google_search", this.budgetRepo, this.now()))) throw new Error("Daily Google Search cap reached (zero-cost guard); skipping until tomorrow");
    const res = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      blockForToday("google_search", this.now());
      throw new Error("Google quota exhausted (HTTP 429); no further calls today");
    }
    const j = (await res.json()) as GeminiResponse;
    if (!res.ok || j.error) throw new Error(`Gemini HTTP ${res.status}: ${j.error?.message ?? ""}`);
    return j.candidates;
  }

  /**
   * Step 1: ask Google a plain question (this reliably triggers search) and keep the cited sources.
   * Retries when the model answers from memory; an ungrounded answer is never accepted.
   */
  async groundedText(question: string, attempts = 3): Promise<{ text: string; queries: string[]; sources: { url: string; title: string | null }[] }> {
    for (let i = 0; i < attempts; i++) {
      const c = (await this.call({
        contents: [{ role: "user", parts: [{ text: question }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: "low" } },
      }))?.[0];
      if (c?.finishReason && c.finishReason !== "STOP") continue;
      const queries = c?.groundingMetadata?.webSearchQueries ?? [];
      const sources = (c?.groundingMetadata?.groundingChunks ?? []).map((x) => ({ url: x.web?.uri ?? "", title: x.web?.title ?? null })).filter((s) => s.url);
      const text = (c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
      if (queries.length && sources.length && text) return { text, queries, sources };
    }
    throw new Error("Answer was not grounded in Google Search results; rejected");
  }

  /** Step 2: convert the cited answer to JSON. No tools, no new facts. */
  async structure<T>(answer: string, sources: { url: string; title: string | null }[], schema: string): Promise<T> {
    const c = (await this.call({
      contents: [{
        role: "user",
        parts: [{
          text: [
            "Convert the ANSWER below into JSON. Use only facts stated in the ANSWER; do not add, infer or correct anything.",
            "For sourceUrl, choose the SOURCES entry the ANSWER relied on for that item.",
            `SOURCES:\n${sources.map((s, i) => `${i + 1}. ${s.title ?? ""} ${s.url}`).join("\n")}`,
            `ANSWER:\n${answer}`,
            `Reply with JSON only, shaped exactly like: ${schema}`,
          ].join("\n\n"),
        }],
      }],
      generationConfig: { maxOutputTokens: 4096, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } },
    }))?.[0];
    if (c?.finishReason && c.finishReason !== "STOP") throw new Error(`Structuring incomplete (${c.finishReason})`);
    return extractJson((c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("")) as T;
  }

  async grounded<T>(question: string, schema: string): Promise<GroundedAnswer<T>> {
    const g = await this.groundedText(question);
    return { data: await this.structure<T>(g.text, g.sources, schema), queries: g.queries, sources: g.sources };
  }

  fixtureQuestion(competition: Competition) {
    const now = this.now();
    const d = (days: number) => new Date(now.getTime() + days * 86400_000).toISOString().slice(0, 10);
    return `Search Google: which ${COMPETITION_QUERY[competition]} matches are being played between ${d(-3)} and ${d(14)} (today is ${d(0)})? For each match give the two teams, the date and start time with timezone, the venue, and whether it is completed, live or upcoming. Use official or reputable sources (BCCI, iplt20.com, wplt20.com, ESPNcricinfo, Cricbuzz) and cite them. If no matches are scheduled in that window, say so and say when the next season starts.`;
  }

  async searchFixtures(): Promise<ProviderFixture[]> {
    const now = this.now();
    // Off-season (nothing found last time): search at most once a day.
    const ttl = this.cache && this.cache.fixtures.length === 0 ? Math.max(this.ttlMin, 24 * 60) : this.ttlMin;
    if (this.cache && now.getTime() - this.cache.at < ttl * 60_000) return this.cache.fixtures;
    const all: GroundedFixture[] = [];
    for (const c of ["IPL", "WPL"] as Competition[]) {
      const a = await this.grounded<unknown>(this.fixtureQuestion(c), FIXTURE_SCHEMA);
      all.push(...validateFixtures(a.data, c, a.sources, now));
    }
    this.cache = { at: now.getTime(), fixtures: all };
    return all;
  }

  async matchDetails(id: string) {
    return (await this.searchFixtures()).find((f) => f.providerMatchId === id) ?? null;
  }

  private async lineup(id: string, kind: "squad" | "xi"): Promise<ProviderSquadPlayer[] | null> {
    const f = (await this.searchFixtures()).find((x) => x.providerMatchId === id);
    if (!f) return null;
    const ask =
      kind === "xi"
        ? `the announced playing XIs (after the toss) for ${f.team1} v ${f.team2} on ${f.date}. If the toss has not happened or XIs are not announced, return an empty list.`
        : `the current squads of ${f.team1} and ${f.team2} for the ${f.competition === "IPL" ? "IPL" : "WPL"} season of ${f.date.slice(0, 4)}.`;
    const a = await this.grounded<{ players?: { name?: string; team?: string; role?: string }[] }>(
      `Search Google: what are ${ask} Use official or reputable sources and cite them; do not guess.`,
      '{"players":[{"name":"","team":"","role":"WK|BAT|AR|BOWL"}]}',
    );
    const roles = new Set(["WK", "BAT", "AR", "BOWL"]);
    return (a.data.players ?? [])
      .filter((p) => p.name && p.team && (p.team === f.team1 || p.team === f.team2))
      .map((p) => ({ providerPlayerId: `gs:${p.name}`, name: String(p.name), team: String(p.team), role: roles.has(String(p.role)) ? (String(p.role) as PlayerRole) : null }));
  }

  async squad(id: string) {
    return (await this.lineup(id, "squad")) ?? [];
  }
  async playingXI(id: string) {
    return this.lineup(id, "xi");
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
