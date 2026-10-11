import { describe, expect, it } from "vitest";
import { parseMatch } from "@/lib/data/cricsheet";

const d = (batter: string, bowler: string, runs: number, extra: Record<string, unknown> = {}) => ({ batter, bowler, non_striker: "B2", runs: { batter: runs, extras: 0, total: runs }, ...extra });

const raw = {
  info: {
    dates: ["2024-04-01"], gender: "male", season: "2024", teams: ["A", "B"], venue: "Test Ground, City", city: "City",
    toss: { winner: "A", decision: "bat" }, outcome: { winner: "A", by: { runs: 5 } },
    players: { A: ["B1", "B2", "IMP"], B: ["W1", "F1", "F2"] },
    registry: { people: { B1: "id-b1", B2: "id-b2", IMP: "id-imp", W1: "id-w1", F1: "id-f1", F2: "id-f2" } },
  },
  innings: [
    {
      team: "A",
      overs: [
        { over: 0, deliveries: [d("B1", "W1", 0), d("B1", "W1", 0), d("B1", "W1", 0), d("B1", "W1", 0), d("B1", "W1", 0), d("B1", "W1", 0)] },
        {
          over: 1,
          deliveries: [
            d("B1", "W1", 4, { runs: { batter: 4, extras: 0, total: 4, non_boundary: true } }),
            d("B1", "W1", 0, { runs: { batter: 0, extras: 1, total: 1 }, extras: { wides: 1 } }),
            d("B1", "W1", 0, { runs: { batter: 0, extras: 1, total: 1 }, extras: { byes: 1 } }),
            d("B1", "W1", 6),
            d("B1", "W1", 0, { wickets: [{ player_out: "B1", kind: "run out", fielders: [{ name: "F1" }, { name: "F2" }] }], replacements: { match: [{ in: "IMP", out: "B1", team: "A", reason: "impact_player" }] } }),
            d("B2", "W1", 0, { wickets: [{ player_out: "B2", kind: "lbw" }] }),
            d("B2", "W1", 0, { wickets: [{ player_out: "B2", kind: "caught", fielders: [{ name: "SUB", substitute: true }] }] }),
          ],
        },
      ],
    },
    { team: "A", super_over: true, overs: [{ over: 0, deliveries: [d("B2", "W1", 6), d("B2", "W1", 6)] }] },
  ],
};

describe("Cricsheet ingestion", () => {
  const { match, rows } = parseMatch(raw, "t1", "IPL");
  const get = (id: string) => rows.find((r) => r.playerId === id)!;
  it("excludes Super Over events from player stats but flags the match", () => {
    expect(match.hasSuperOver).toBe(true);
    expect(get("id-b2").runs).toBe(0);
    expect(get("id-w1").runsConceded).toBe(4 + 1 + 6); // all-run four + wide + six; byes not charged
  });
  it("wides are not balls faced; all-run fours are not boundaries", () => {
    expect(get("id-b1").ballsFaced).toBe(6 + 4); // over 0 + 4 legal in over 1 (wide excluded)
    expect(get("id-b1").fours).toBe(0);
    expect(get("id-b1").sixes).toBe(1);
    expect(get("id-b1").runs).toBe(10);
  });
  it("maidens require a complete over with nothing conceded; dots exclude wides", () => {
    expect(get("id-w1").maidens).toBe(1);
    expect(get("id-w1").ballsBowled).toBe(12);
  });
  it("run-outs credit fielders, not the bowler; LBW is a bowler wicket with bonus; substitute fielders are skipped", () => {
    expect(get("id-w1").wickets).toBe(2);
    expect(get("id-w1").lbwBowledWickets).toBe(1);
    expect(get("id-f1").runOutsIndirect).toBe(1);
    expect(get("id-f2").runOutsIndirect).toBe(1);
    expect(rows.some((r) => r.playerId.includes("SUB"))).toBe(false);
  });
  it("impact substitute is not in the announced XI but is recorded as a substitute", () => {
    expect(get("id-imp").inAnnouncedXI).toBe(false);
    expect(get("id-imp").substituteIn).toBe("impact_player");
    expect(get("id-b1").inAnnouncedXI).toBe(true);
  });
});
