/**
 * CSV import paths for data that no configured provider supplies: fixtures, player pools (roles + credits)
 * and actual points. Validates every row and returns row-level errors instead of guessing.
 */
import Papa from "papaparse";
import type { Competition, PlayerRole } from "../data/types";
import type { Fixture, ImportedPoolPlayer } from "../store/types";

export interface ImportResult<T> {
  rows: T[];
  errors: { line: number; message: string }[];
}

const ROLE_ALIASES: Record<string, PlayerRole> = { wk: "WK", "wicket-keeper": "WK", keeper: "WK", bat: "BAT", batter: "BAT", ar: "AR", "all-rounder": "AR", allrounder: "AR", bowl: "BOWL", bowler: "BOWL" };

function parse(text: string) {
  return Papa.parse<Record<string, string>>(text.replace(/^﻿/, "").trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
}

export const FIXTURE_CSV_HEADER = "match_id,competition,date,start_time_utc,timezone,venue,city,team1,team2,status";
export const POOL_CSV_HEADER = "match_id,player_name,team,role,credits,announced,cricsheet_player_id";
export const ACTUALS_CSV_HEADER = "player_id,points";

export function parseFixturesCsv(text: string, importedBy: string, now = new Date()): ImportResult<Fixture> {
  const p = parse(text);
  const rows: Fixture[] = [];
  const errors: ImportResult<Fixture>["errors"] = [];
  p.data.forEach((r, i) => {
    const line = i + 2;
    const comp = (r.competition ?? "").toUpperCase() as Competition;
    if (!r.match_id) return errors.push({ line, message: "match_id is required" });
    if (!["IPL", "WPL"].includes(comp)) return errors.push({ line, message: "competition must be IPL or WPL" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "")) return errors.push({ line, message: "date must be YYYY-MM-DD" });
    if (r.start_time_utc && Number.isNaN(Date.parse(r.start_time_utc))) return errors.push({ line, message: "start_time_utc must be ISO 8601" });
    if (!r.team1 || !r.team2 || !r.venue) return errors.push({ line, message: "team1, team2 and venue are required" });
    const status = (r.status || "upcoming").toLowerCase();
    if (!["upcoming", "live", "completed"].includes(status)) return errors.push({ line, message: "status must be upcoming, live or completed" });
    if (/^\d+$/.test(r.match_id)) return errors.push({ line, message: "Use a prefixed id (e.g. fx-2026-01) to avoid clashing with Cricsheet ids" });
    rows.push({
      id: r.match_id, competition: comp, date: r.date, startTimeUtc: r.start_time_utc ? new Date(r.start_time_utc).toISOString() : null,
      startTimeAssumed: false, timezone: r.timezone || null, venue: r.venue, city: r.city || null, team1: r.team1, team2: r.team2,
      status: status as Fixture["status"], source: "csv_import", providerMatchId: null, importedAt: now.toISOString(), importedBy,
      lastSyncedAt: now.toISOString(), revision: 1,
    });
  });
  return { rows, errors };
}

export function parsePoolCsv(text: string, knownFixtureIds: Set<string>): ImportResult<ImportedPoolPlayer> {
  const p = parse(text);
  const rows: ImportedPoolPlayer[] = [];
  const errors: ImportResult<ImportedPoolPlayer>["errors"] = [];
  p.data.forEach((r, i) => {
    const line = i + 2;
    if (!knownFixtureIds.has(r.match_id)) return errors.push({ line, message: `Unknown fixture ${r.match_id}; import fixtures first` });
    const role = ROLE_ALIASES[(r.role ?? "").toLowerCase()];
    if (!role) return errors.push({ line, message: "role must be WK, BAT, AR or BOWL" });
    if (!r.player_name || !r.team) return errors.push({ line, message: "player_name and team are required" });
    let credits: number | null = null;
    if (r.credits) {
      credits = Number(r.credits);
      if (!Number.isFinite(credits) || credits <= 0 || credits > 15) return errors.push({ line, message: "credits must be a number between 0 and 15" });
    }
    const ann = (r.announced ?? "").toLowerCase();
    rows.push({
      fixtureId: r.match_id, playerName: r.player_name.trim(), playerId: r.cricsheet_player_id || null, team: r.team.trim(), role, credits,
      announced: ann === "" ? null : ["1", "true", "yes", "y"].includes(ann),
    });
  });
  return { rows, errors };
}

export function parseActualsCsv(text: string, allowed: Set<string>): ImportResult<{ playerId: string; points: number }> {
  const p = parse(text);
  const rows: { playerId: string; points: number }[] = [];
  const errors: { line: number; message: string }[] = [];
  const seen = new Set<string>();
  p.data.forEach((r, i) => {
    const line = i + 2;
    if (!allowed.has(r.player_id)) return errors.push({ line, message: `Player ${r.player_id} is not in either team for this match` });
    if (seen.has(r.player_id)) return errors.push({ line, message: `Duplicate player ${r.player_id}` });
    const n = Number(r.points);
    if (!Number.isFinite(n)) return errors.push({ line, message: "points must be a number" });
    seen.add(r.player_id);
    rows.push({ playerId: r.player_id, points: n });
  });
  return { rows, errors };
}
