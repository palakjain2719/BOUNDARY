import { z } from "zod";
import legacy from "./team-rules/dream11-t20-team-legacy.json";
import modern from "./team-rules/dream11-t20-team-modern-draft.json";
import type { PlayerRole } from "../data/types";

const limit = z.tuple([z.number().int().min(0), z.number().int().min(0)]);
export const teamRulesSchema = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string(),
  status: z.enum(["draft", "reviewed", "verified"]),
  officialSourceUrl: z.string().url(),
  verifiedAt: z.string().nullable(),
  provenance: z.string(),
  squadSize: z.number().int().positive(),
  creditCap: z.number().positive(),
  maxPerRealTeam: z.number().int().positive(),
  minPerRealTeam: z.number().int().min(0),
  roleLimits: z.object({ WK: limit, BAT: limit, AR: limit, BOWL: limit }),
  requireCaptain: z.boolean(),
  requireViceCaptain: z.boolean(),
  hasOfficialBench: z.boolean(),
});

export type TeamRules = z.infer<typeof teamRulesSchema> & { roleLimits: Record<PlayerRole, [number, number]> };

const ALL = [legacy, modern].map((r) => teamRulesSchema.parse(r) as TeamRules);

export const listTeamRules = () => ALL;
export function getTeamRules(id: string): TeamRules {
  const r = ALL.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown team rules ${id}`);
  return r;
}
/** Default team rules for a match date. Override with TEAM_RULES_DEFAULT. */
export function defaultTeamRulesFor(date: string): TeamRules {
  if (process.env.TEAM_RULES_DEFAULT) return getTeamRules(process.env.TEAM_RULES_DEFAULT);
  return getTeamRules(date < "2022-01-01" ? "dream11-t20-team-legacy" : "dream11-t20-team-modern-draft");
}
