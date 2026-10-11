/**
 * Cricket data provider boundary. Implementations must only use authorised APIs (no consumer-app scraping)
 * and must report the coverage they actually support.
 */
import type { Competition, PlayerRole } from "../data/types";

export interface ProviderFixture {
  providerMatchId: string;
  competition: Competition | "other";
  name: string;
  date: string;
  startTimeUtc: string | null;
  venue: string;
  team1: string;
  team2: string;
  status: "upcoming" | "live" | "completed";
  matchType: string;
}

export interface ProviderSquadPlayer {
  providerPlayerId: string;
  name: string;
  team: string;
  role: PlayerRole | null;
}

export interface ProviderCoverage {
  provider: string;
  competitions: string[];
  fields: Record<
    "fixtures" | "matchDetails" | "squads" | "playingXI" | "scorecard" | "ballByBall" | "playerStats" | "pitchReport" | "weather" | "credits",
    "supported" | "unsupported" | "unverified"
  >;
  notes: string[];
}

export interface CricketDataProvider {
  readonly id: string;
  coverage(): ProviderCoverage;
  searchFixtures(q?: { from?: string; to?: string }): Promise<ProviderFixture[]>;
  matchDetails(id: string): Promise<ProviderFixture | null>;
  squad(id: string): Promise<ProviderSquadPlayer[]>;
  playingXI(id: string): Promise<ProviderSquadPlayer[] | null>;
  scorecard(id: string): Promise<unknown | null>;
  ballByBall(id: string): Promise<unknown | null>;
  historicalPlayerStats(playerId: string): Promise<unknown | null>;
  pitchReport(id: string): Promise<string | null>;
}
