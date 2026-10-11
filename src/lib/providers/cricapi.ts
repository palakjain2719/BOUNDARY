/**
 * CricAPI (cricketdata.org) adapter. Enabled only when CRICKET_PROVIDER=cricapi and CRICAPI_KEY are set.
 * Endpoints follow the public v1 docs (https://cricketdata.org/how-to-use-cricket-data-api.aspx). The
 * response mapping is UNVERIFIED until run with a real key — check provider coverage on Settings first.
 */
import type { CricketDataProvider, ProviderCoverage, ProviderFixture, ProviderSquadPlayer } from "./types";
import type { PlayerRole } from "../data/types";

type Json = Record<string, unknown>;

export class CricApiProvider implements CricketDataProvider {
  readonly id = "cricapi";
  constructor(private key: string, private fetchImpl: typeof fetch = fetch, private base = "https://api.cricapi.com/v1") {}

  coverage(): ProviderCoverage {
    return {
      provider: "CricAPI / cricketdata.org",
      competitions: ["Depends on plan — not verified in this deployment"],
      fields: {
        fixtures: "unverified", matchDetails: "unverified", squads: "unverified", playingXI: "unverified", scorecard: "unverified",
        ballByBall: "unverified", playerStats: "unverified", pitchReport: "unsupported", weather: "unsupported", credits: "unsupported",
      },
      notes: ["Fantasy credits are not provided by this API; import them via CSV.", "Respect the plan's rate limits and attribution terms."],
    };
  }

  private async get(path: string, params: Record<string, string> = {}): Promise<Json | null> {
    const u = new URL(`${this.base}/${path}`);
    u.searchParams.set("apikey", this.key);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await this.fetchImpl(u, { headers: { accept: "application/json" }, next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) throw new Error(`CricAPI ${path} HTTP ${res.status}`);
    const j = (await res.json()) as Json;
    if (j.status && j.status !== "success") throw new Error(`CricAPI ${path}: ${String(j.reason ?? j.status)}`);
    return j;
  }

  private mapMatch(m: Json): ProviderFixture {
    const teams = (m.teams as string[]) ?? [];
    const name = String(m.name ?? "");
    const comp = /women'?s premier league|wpl/i.test(name) ? "WPL" : /indian premier league|ipl/i.test(name) ? "IPL" : "other";
    const started = Boolean(m.matchStarted);
    const ended = Boolean(m.matchEnded);
    return {
      providerMatchId: String(m.id), competition: comp, name, date: String(m.date ?? "").slice(0, 10),
      startTimeUtc: m.dateTimeGMT ? `${String(m.dateTimeGMT).replace(/Z?$/, "Z")}` : null, venue: String(m.venue ?? ""),
      team1: teams[0] ?? "", team2: teams[1] ?? "", status: ended ? "completed" : started ? "live" : "upcoming", matchType: String(m.matchType ?? ""),
    };
  }

  async searchFixtures() {
    const j = await this.get("matches", { offset: "0" });
    return ((j?.data as Json[]) ?? []).map((m) => this.mapMatch(m)).filter((m) => m.matchType.toLowerCase() === "t20");
  }
  async matchDetails(id: string) {
    const j = await this.get("match_info", { id });
    return j?.data ? this.mapMatch(j.data as Json) : null;
  }
  async squad(id: string): Promise<ProviderSquadPlayer[]> {
    const j = await this.get("match_squad", { id });
    const roleMap = (r: string): PlayerRole | null =>
      /wk|keeper/i.test(r) ? "WK" : /allrounder|all-rounder/i.test(r) ? "AR" : /bowl/i.test(r) ? "BOWL" : /bat/i.test(r) ? "BAT" : null;
    return ((j?.data as Json[]) ?? []).flatMap((t) =>
      ((t.players as Json[]) ?? []).map((p) => ({ providerPlayerId: String(p.id), name: String(p.name), team: String(t.teamName), role: roleMap(String(p.role ?? "")) })),
    );
  }
  async playingXI() { return null; }
  async scorecard(id: string) { return (await this.get("match_scorecard", { id }))?.data ?? null; }
  async ballByBall(id: string) { return (await this.get("match_bbb", { id }))?.data ?? null; }
  async historicalPlayerStats(playerId: string) { return (await this.get("players_info", { id: playerId }))?.data ?? null; }
  async pitchReport() { return null; }
}
