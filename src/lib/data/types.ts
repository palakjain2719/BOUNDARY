// Core domain types shared by ingestion, scoring, modelling and UI.

export type Competition = "IPL" | "WPL";
export const COMPETITION_LABEL: Record<Competition, string> = {
  IPL: "Men's IPL",
  WPL: "Women's WPL",
};

export type MatchStatus = "live" | "upcoming" | "completed";

/**
 * Where a match record came from. cricsheet_replay = archived match re-opened at its decision time;
 * sim_replay = archived match served as live by the simulated pipeline clock (demo).
 */
export type MatchOrigin = "cricsheet_replay" | "provider" | "csv_import" | "sim_replay";

export interface MatchRecord {
  id: string;
  competition: Competition;
  gender: "male" | "female";
  season: string;
  /** Local match date (Cricsheet gives date only, no start time). */
  date: string;
  venue: string;
  city: string | null;
  team1: string;
  team2: string;
  eventStage: string | null;
  // Post-toss / post-match facts. Never used as pre-match features.
  tossWinner: string | null;
  tossDecision: string | null;
  winner: string | null;
  result: string;
  hasSuperOver: boolean;
  source: string;
  sourceRevision: number | null;
}

/** Event-level stats for one player in one match, excluding Super Overs. Inputs to the scoring calculator. */
export interface PlayerMatchStats {
  matchId: string;
  playerId: string;
  team: string;
  competition: Competition;
  inAnnouncedXI: boolean;
  /** Substitution reason if the player came in as a substitute (e.g. impact_player, concussion_substitute). */
  substituteIn: string | null;
  batted: boolean;
  battingPosition: number | null;
  runs: number;
  ballsFaced: number;
  fours: number;
  sixes: number;
  dismissed: boolean;
  dismissalKind: string | null;
  ballsBowled: number;
  runsConceded: number;
  wickets: number;
  lbwBowledWickets: number;
  dotBalls: number;
  maidens: number;
  catches: number;
  stumpings: number;
  runOutsDirect: number;
  runOutsIndirect: number;
}

export interface KaggleLabel {
  matchId: string;
  season: string;
  kaggleName: string;
  playerId: string | null;
  mappingConfidence: string;
  startingPoints: number;
  battingFP: number;
  bowlingFP: number;
  fieldingFP: number;
  totalFP: number;
  // Retrospective labels only. Never pre-match features.
  retroDreamTeam: boolean;
  retroCaptain: boolean;
  retroViceCaptain: boolean;
}

export type PlayerRole = "WK" | "BAT" | "AR" | "BOWL";
export const ROLES: PlayerRole[] = ["WK", "BAT", "AR", "BOWL"];
export const ROLE_LABEL: Record<PlayerRole, string> = {
  WK: "Wicket-keeper",
  BAT: "Batter",
  AR: "All-rounder",
  BOWL: "Bowler",
};

export type CreditSource = "imported" | "provider" | "estimated_demo" | "none";
export type RoleSource = "imported" | "provider" | "inferred_history";
export type DecisionPhase = "pre_match" | "post_toss";

export interface PoolPlayer {
  playerId: string;
  name: string;
  team: string;
  role: PlayerRole;
  roleSource: RoleSource;
  credits: number | null;
  creditSource: CreditSource;
  /** Announced XI (post-toss only) */
  announced: boolean | null;
  isSubstitute?: boolean;
}
