import { describe, expect, it } from "vitest";
import { extractJson, GoogleSearchGroundedProvider, validateFixtures, type GroundedFixture } from "@/lib/providers/google-search";

const now = new Date("2027-01-10T00:00:00Z");
const sources = [{ url: "https://www.wplt20.com/schedule", title: "wplt20.com" }];

describe("Google Search grounded fixture detection", () => {
  it("extracts JSON from fenced replies", () => {
    expect(extractJson('Here:\n```json\n{"fixtures":[]}\n```')).toEqual({ fixtures: [] });
  });
  it("keeps only complete fixtures that cite a returned source", () => {
    const raw = {
      fixtures: [
        { team1: "Mumbai Indians", team2: "Delhi Capitals", startTimeUtc: "2027-01-14T14:00:00Z", venue: "Navi Mumbai", status: "upcoming", sourceUrl: "https://www.wplt20.com/schedule" },
        { team1: "Mumbai Indians", team2: "UP Warriorz", startTimeUtc: "not a date", sourceUrl: "https://www.wplt20.com/schedule" },
        { team1: "Gujarat Giants", team2: "UP Warriorz", startTimeUtc: "2027-01-15T14:00:00Z", sourceUrl: "https://random-blog.example/guess" },
      ],
    };
    const out = validateFixtures(raw, "WPL", sources, now);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ team1: "Mumbai Indians", competition: "WPL", status: "upcoming", sourceTitle: "wplt20.com" });
    expect(out[0].providerMatchId).toBe("gs-wpl-2027-01-14-mumbai-indians-delhi-capitals");
  });
  it("retries, then rejects answers that were not grounded in Google Search", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "From memory: none." }] } }] }) };
    }) as unknown as typeof fetch;
    const p = new GoogleSearchGroundedProvider("k", "m", f, () => now);
    await expect(p.searchFixtures()).rejects.toThrow(/not grounded/);
    expect(calls).toBe(3);
  });
  it("searches, structures the cited answer, validates sources and caches discovery", async () => {
    let calls = 0;
    const grounded = {
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: "Mumbai Indians play Delhi Capitals on 14 Jan 2027 at 19:30 IST in Navi Mumbai (wplt20.com)." }] },
        groundingMetadata: { webSearchQueries: ["WPL 2027 schedule"], groundingChunks: [{ web: { uri: "https://www.wplt20.com/schedule", title: "wplt20.com" } }] },
      }],
    };
    const structured = {
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"fixtures":[{"team1":"Mumbai Indians","team2":"Delhi Capitals","startTimeUtc":"2027-01-14T14:00:00Z","venue":"Navi Mumbai","status":"upcoming","sourceUrl":"https://www.wplt20.com/schedule"}]}' }] } }],
    };
    const f = (async (_u: string, init: { body: string }) => {
      calls++;
      const usesSearch = JSON.parse(init.body).tools;
      return { ok: true, status: 200, json: async () => (usesSearch ? grounded : structured) };
    }) as unknown as typeof fetch;
    const p = new GoogleSearchGroundedProvider("k", "m", f, () => now, 60);
    const a = (await p.searchFixtures()) as GroundedFixture[];
    await p.searchFixtures();
    expect(a).toHaveLength(2); // same mocked answer for IPL and WPL, each validated against its sources
    expect(a.every((x) => x.sourceUrl === "https://www.wplt20.com/schedule")).toBe(true);
    expect(calls).toBe(4); // search + structure per competition, then served from cache
  });
});

describe("zero-cost guard", () => {
  it("stops calling Google once the daily cap is reached and after a 429", async () => {
    const { resetBudgetsForTests, tryConsume } = await import("@/lib/ai/budget");
    resetBudgetsForTests();
    process.env.GOOGLE_SEARCH_MAX_PER_DAY = "2";
    const day = new Date("2027-01-10T00:00:00Z");
    expect(await tryConsume("google_search", null, day)).toBe(true);
    expect(await tryConsume("google_search", null, day)).toBe(true);
    expect(await tryConsume("google_search", null, day)).toBe(false);
    expect(await tryConsume("google_search", null, new Date("2027-01-11T00:00:00Z"))).toBe(true); // new UTC day

    resetBudgetsForTests();
    process.env.GOOGLE_SEARCH_MAX_PER_DAY = "20";
    let calls = 0;
    const f = (async () => {
      calls++;
      return { ok: false, status: 429, json: async () => ({ error: { message: "quota" } }) };
    }) as unknown as typeof fetch;
    const p = new GoogleSearchGroundedProvider("k", "m", f, () => now);
    await expect(p.searchFixtures()).rejects.toThrow(/quota exhausted/);
    await expect(p.searchFixtures()).rejects.toThrow(/cap reached/);
    expect(calls).toBe(1); // no retries after a 429
    delete process.env.GOOGLE_SEARCH_MAX_PER_DAY;
    resetBudgetsForTests();
  });
});
