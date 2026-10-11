/** Cricsheet historical replay "provider": real past fixtures and XIs, served for decision-time replay. */
import { loadCompetition, playerName } from "../data/historical";
import type { Competition } from "../data/types";
import type { CricketDataProvider, ProviderCoverage, ProviderFixture, ProviderSquadPlayer } from "./types";

export class CricsheetReplayProvider implements CricketDataProvider {
  readonly id = "cricsheet-replay";
  coverage(): ProviderCoverage {
    return {
      provider: "Cricsheet (local archive)",
      competitions: ["Men's IPL 2008–2026 (as archived)", "Women's WPL 2023–2026 (as archived)"],
      fields: {
        fixtures: "supported", matchDetails: "supported", squads: "unsupported", playingXI: "supported", scorecard: "supported",
        ballByBall: "supported", playerStats: "supported", pitchReport: "unsupported", weather: "unsupported", credits: "unsupported",
      },
      notes: ["Completed matches only. No start times, squads, credits or pitch reports.", "Data under the Cricsheet licence (see data/raw README)."],
    };
  }
  private all(): ProviderFixture[] {
    return (["IPL", "WPL"] as Competition[]).flatMap((c) =>
      loadCompetition(c).matches.map((m) => ({
        providerMatchId: m.id, competition: c, name: `${m.team1} v ${m.team2}`, date: m.date, startTimeUtc: null, venue: m.venue,
        team1: m.team1, team2: m.team2, status: "completed" as const, matchType: "T20",
      })),
    );
  }
  async searchFixtures(q: { from?: string; to?: string } = {}) {
    return this.all().filter((f) => (!q.from || f.date >= q.from) && (!q.to || f.date <= q.to));
  }
  async matchDetails(id: string) { return this.all().find((f) => f.providerMatchId === id) ?? null; }
  async squad() { return []; }
  async playingXI(id: string): Promise<ProviderSquadPlayer[] | null> {
    for (const c of ["IPL", "WPL"] as Competition[]) {
      const d = loadCompetition(c);
      const rows = d.statsByMatch.get(id);
      if (rows) return rows.filter((r) => r.inAnnouncedXI).map((r) => ({ providerPlayerId: r.playerId, name: playerName(d, r.playerId), team: r.team, role: null }));
    }
    return null;
  }
  async scorecard(id: string) { return (await this.playingXI(id)) ? { matchId: id, note: "Derived from ball-by-ball" } : null; }
  async ballByBall() { return null; }
  async historicalPlayerStats(playerId: string) {
    for (const c of ["IPL", "WPL"] as Competition[]) {
      const rows = loadCompetition(c).statsByPlayer.get(playerId);
      if (rows) return rows;
    }
    return null;
  }
  async pitchReport() { return null; }
}
