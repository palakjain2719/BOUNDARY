/**
 * Match catalogue across sources: pipeline-discovered fixtures (provider or simulated replay), CSV imports,
 * and the Cricsheet archive. Each item states its origin so replay / simulated data is never shown as live.
 * Upcoming items carry the suitability assessment from their latest prepared analysis.
 */
import { loadCompetition } from "../data/historical";
import type { Competition, MatchOrigin, MatchStatus } from "../data/types";
import { statusAt, type ClockInfo } from "../pipeline/clock";
import type { PreparedAnalysis, Repository } from "../store/types";

export interface CatalogItem {
  id: string;
  competition: Competition;
  origin: MatchOrigin;
  status: MatchStatus;
  season: string;
  date: string;
  startTimeUtc: string | null;
  startTimeAssumed: boolean;
  timezone: string | null;
  venue: string;
  city: string | null;
  team1: string;
  team2: string;
  stage: string | null;
  analysis: Pick<PreparedAnalysis, "id" | "version" | "decisionPhase" | "clockAt" | "suitability" | "recommendationId" | "infeasibility"> | null;
}

export interface CatalogQuery {
  tab: MatchStatus;
  q?: string;
  competition?: Competition | "all";
  season?: string;
  page?: number;
  pageSize?: number;
  sort?: "date" | "suitability";
}

export interface CatalogResult {
  items: CatalogItem[];
  total: number;
  page: number;
  pageSize: number;
  seasons: Record<Competition, string[]>;
  counts: Record<MatchStatus, number>;
}

export async function listCatalog(repo: Repository, query: CatalogQuery, clock: ClockInfo): Promise<CatalogResult> {
  const fixtures = await repo.listFixtures();
  const prepared = await repo.listPreparedAnalyses();
  const latest = new Map<string, PreparedAnalysis>();
  for (const a of prepared) latest.set(a.matchId, a);
  const fixtureIds = new Set(fixtures.map((f) => f.id));
  const today = clock.now.toISOString().slice(0, 10);

  const all: CatalogItem[] = [];
  for (const f of fixtures) {
    const status = f.source === "sim_replay" && f.startTimeUtc ? statusAt(f.startTimeUtc, clock.now) : f.status;
    const m = loadCompetition(f.competition).matchById.get(f.id);
    const a = latest.get(f.id);
    all.push({
      id: f.id, competition: f.competition, origin: f.source === "csv_import" ? "csv_import" : f.source === "provider" ? "provider" : "sim_replay", status,
      season: m?.season ?? f.date.slice(0, 4), date: f.date, startTimeUtc: f.startTimeUtc, startTimeAssumed: f.startTimeAssumed, timezone: f.timezone,
      venue: f.venue, city: f.city, team1: f.team1, team2: f.team2, stage: m?.eventStage ?? null,
      analysis: a ? { id: a.id, version: a.version, decisionPhase: a.decisionPhase, clockAt: a.clockAt, suitability: a.suitability, recommendationId: a.recommendationId, infeasibility: a.infeasibility } : null,
    });
  }
  const seasons = { IPL: [] as string[], WPL: [] as string[] };
  for (const c of ["IPL", "WPL"] as Competition[]) {
    const d = loadCompetition(c);
    const visible = d.matches.filter((m) => !clock.simulated || m.date < today);
    seasons[c] = [...new Set(visible.map((m) => m.season))].sort().reverse();
    for (const m of visible) {
      if (fixtureIds.has(m.id)) continue;
      all.push({
        id: m.id, competition: c, origin: "cricsheet_replay", status: "completed", season: m.season, date: m.date, startTimeUtc: null, startTimeAssumed: false,
        timezone: "Asia/Kolkata", venue: m.venue, city: m.city, team1: m.team1, team2: m.team2, stage: m.eventStage, analysis: null,
      });
    }
  }

  const q = query.q?.trim().toLowerCase();
  const base = all
    .filter((m) => !query.competition || query.competition === "all" || m.competition === query.competition)
    .filter((m) => !query.season || m.season === query.season)
    .filter((m) => !q || [m.team1, m.team2, m.venue, m.city ?? "", m.season, m.date, m.competition === "IPL" ? "ipl men" : "wpl women"].some((s) => s.toLowerCase().includes(q)));
  const counts = { live: 0, upcoming: 0, completed: 0 } as Record<MatchStatus, number>;
  for (const m of base) counts[m.status]++;
  const filtered = base
    .filter((m) => m.status === query.tab)
    .sort((a, b) => {
      if (query.tab === "upcoming" && query.sort !== "date") return (b.analysis?.suitability.score ?? -1) - (a.analysis?.suitability.score ?? -1) || (a.startTimeUtc ?? a.date).localeCompare(b.startTimeUtc ?? b.date);
      if (query.tab === "upcoming") return (a.startTimeUtc ?? a.date).localeCompare(b.startTimeUtc ?? b.date);
      return b.date.localeCompare(a.date) || b.id.localeCompare(a.id, undefined, { numeric: true });
    });
  const pageSize = query.pageSize ?? 12;
  const page = Math.max(1, query.page ?? 1);
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize, seasons, counts };
}
