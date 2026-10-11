import { env } from "../env";
import { CricApiProvider } from "./cricapi";
import { CricsheetReplayProvider } from "./replay";
import type { CricketDataProvider } from "./types";

export function liveProvider(): CricketDataProvider | null {
  if (env.cricketProvider === "cricapi" && env.cricApiKey) return new CricApiProvider(env.cricApiKey);
  return null;
}
export const replayProvider = () => new CricsheetReplayProvider();
