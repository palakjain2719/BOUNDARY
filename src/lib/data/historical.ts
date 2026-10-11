/**
 * Read-only access to the processed historical dataset (data/processed, produced by scripts/ingest-cricsheet.ts).
 * Competitions are loaded and indexed separately; nothing here merges IPL and WPL rows.
 */
import fs from "node:fs";
import path from "node:path";
import type { Competition, KaggleLabel, MatchRecord, PlayerMatchStats } from "./types";

export const PROCESSED_DIR = process.env.PROCESSED_DATA_DIR || path.join(process.cwd(), "data", "processed");

export interface CompetitionData {
  competition: Competition;
  matches: MatchRecord[];
  matchById: Map<string, MatchRecord>;
  /** Chronological index (date, then id) of each match. */
  matchOrder: Map<string, number>;
  stats: PlayerMatchStats[];
  statsByMatch: Map<string, PlayerMatchStats[]>;
  /** Player stats in chronological order. */
  statsByPlayer: Map<string, PlayerMatchStats[]>;
  names: Record<string, string>;
}

export interface Manifest {
  generatedAt: string;
  competitions: Record<
    Competition,
    { matches: number; playerMatchRows: number; players: number; dateRange: { from: string; to: string } | null; superOverMatches: number; source: string }
  >;
  kaggleIplLabels: { rows: number; placeholderRows: number; high: number; notHigh: number; labelledMatches: number; seasons: { from: string; to: string } | null; source: string };
}

type Columnar = { columns: string[]; rows: unknown[][] };

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, file), "utf8")) as T;
}

function decode<T>(c: Columnar, extra: Partial<T> = {}): T[] {
  return c.rows.map((r) => {
    const o: Record<string, unknown> = { ...extra };
    c.columns.forEach((col, i) => (o[col] = r[i]));
    return o as T;
  });
}

const cache = new Map<Competition, CompetitionData>();
let labelCache: KaggleLabel[] | null = null;

export function hasProcessedData(): boolean {
  return fs.existsSync(path.join(PROCESSED_DIR, "manifest.json"));
}

export function loadManifest(): Manifest | null {
  return hasProcessedData() ? readJson<Manifest>("manifest.json") : null;
}

export function buildCompetitionData(competition: Competition, matches: MatchRecord[], stats: PlayerMatchStats[], names: Record<string, string>): CompetitionData {
  const sorted = [...matches].sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id, undefined, { numeric: true }) : a.date.localeCompare(b.date)));
  const matchById = new Map(sorted.map((m) => [m.id, m]));
  const matchOrder = new Map(sorted.map((m, i) => [m.id, i]));
  const statsByMatch = new Map<string, PlayerMatchStats[]>();
  const statsByPlayer = new Map<string, PlayerMatchStats[]>();
  for (const s of stats) {
    if (s.competition !== competition) throw new Error(`Row for ${s.competition} loaded into ${competition}`);
    if (!statsByMatch.has(s.matchId)) statsByMatch.set(s.matchId, []);
    statsByMatch.get(s.matchId)!.push(s);
    if (!statsByPlayer.has(s.playerId)) statsByPlayer.set(s.playerId, []);
    statsByPlayer.get(s.playerId)!.push(s);
  }
  for (const list of statsByPlayer.values()) list.sort((a, b) => (matchOrder.get(a.matchId) ?? 0) - (matchOrder.get(b.matchId) ?? 0));
  return { competition, matches: sorted, matchById, matchOrder, stats, statsByMatch, statsByPlayer, names };
}

export function loadCompetition(competition: Competition): CompetitionData {
  const hit = cache.get(competition);
  if (hit) return hit;
  const prefix = competition.toLowerCase();
  if (!hasProcessedData()) {
    const empty = buildCompetitionData(competition, [], [], {});
    cache.set(competition, empty);
    return empty;
  }
  const matches = readJson<MatchRecord[]>(`${prefix}_matches.json`);
  const stats = decode<PlayerMatchStats>(readJson<Columnar>(`${prefix}_player_stats.json`), { competition });
  const names = readJson<Record<string, string>>(`${prefix}_players.json`);
  const data = buildCompetitionData(competition, matches, stats, names);
  cache.set(competition, data);
  return data;
}

export function loadKaggleLabels(): KaggleLabel[] {
  if (labelCache) return labelCache;
  if (!fs.existsSync(path.join(PROCESSED_DIR, "ipl_kaggle_labels.json"))) return (labelCache = []);
  labelCache = decode<KaggleLabel>(readJson<Columnar>("ipl_kaggle_labels.json"));
  return labelCache;
}

export function findMatch(id: string): { data: CompetitionData; match: MatchRecord } | null {
  for (const c of ["IPL", "WPL"] as Competition[]) {
    const data = loadCompetition(c);
    const match = data.matchById.get(id);
    if (match) return { data, match };
  }
  return null;
}

export function playerName(data: CompetitionData, playerId: string) {
  return data.names[playerId] ?? playerId.replace(/^name:/, "");
}

/** Matches strictly before the target match date. Same-day matches are excluded (no reliable start times). */
export function isStrictlyBefore(data: CompetitionData, candidateMatchId: string, targetDate: string) {
  const m = data.matchById.get(candidateMatchId);
  return !!m && m.date < targetDate;
}
