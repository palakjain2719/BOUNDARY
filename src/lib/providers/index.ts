import { env } from "../env";
import { CricApiProvider } from "./cricapi";
import { FreeSourcesProvider } from "./free-sources";
import { GoogleSearchGroundedProvider } from "./google-search";
import { CricsheetReplayProvider } from "./replay";
import type { CricketDataProvider } from "./types";

let grounded: GoogleSearchGroundedProvider | null = null;
let free: FreeSourcesProvider | null = null;

/**
 * The configured live provider, or null (demo / simulated clock).
 * CRICKET_PROVIDER=free uses Wikipedia season pages + ESPNcricinfo live RSS (zero cost, no keys).
 * CRICKET_PROVIDER=google-search uses Gemini Google Search grounding (needs GEMINI_API_KEY + GEMINI_MODEL).
 * CRICKET_PROVIDER=cricapi uses the CricAPI adapter (needs CRICAPI_KEY).
 */
export function liveProvider(): CricketDataProvider | null {
  if (env.cricketProvider === "free") {
    free ??= new FreeSourcesProvider();
    return free;
  }
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
  return /^(gs|ci|wk|rss)-/.test(providerMatchId) ? providerMatchId : `${providerId === "cricapi" ? "cricapi" : providerId}-${providerMatchId}`;
}
