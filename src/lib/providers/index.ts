import { env } from "../env";
import { CricApiProvider } from "./cricapi";
import { GoogleSearchGroundedProvider } from "./google-search";
import { CricsheetReplayProvider } from "./replay";
import type { CricketDataProvider } from "./types";

let grounded: GoogleSearchGroundedProvider | null = null;

/**
 * The configured live provider, or null (demo / simulated clock).
 * CRICKET_PROVIDER=google-search uses Gemini Google Search grounding (needs GEMINI_API_KEY + GEMINI_MODEL).
 * CRICKET_PROVIDER=cricapi uses the CricAPI adapter (needs CRICAPI_KEY).
 */
export function liveProvider(): CricketDataProvider | null {
  if (env.cricketProvider === "cricapi" && env.cricApiKey) return new CricApiProvider(env.cricApiKey);
  if (env.cricketProvider === "google-search" && env.geminiApiKey && env.geminiModel) {
    grounded ??= new GoogleSearchGroundedProvider();
    return grounded;
  }
  return null;
}
export const replayProvider = () => new CricsheetReplayProvider();

/** Stable fixture id for a provider match. */
export function providerFixtureId(providerId: string, providerMatchId: string) {
  return providerMatchId.startsWith("gs-") ? providerMatchId : `${providerId === "cricapi" ? "cricapi" : providerId}-${providerMatchId}`;
}
