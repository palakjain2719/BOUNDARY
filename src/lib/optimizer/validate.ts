/**
 * Deterministic team validation. This is the only place that decides validity — never an LLM.
 */
import type { PlayerRole, PoolPlayer } from "../data/types";
import type { TeamRules } from "./rules";

export type ViolationCode =
  | "squad_size"
  | "duplicate_player"
  | "not_in_pool"
  | "credit_cap"
  | "credits_unknown"
  | "role_min"
  | "role_max"
  | "team_max"
  | "team_min"
  | "captain_missing"
  | "vice_captain_missing"
  | "captain_equals_vice"
  | "captain_not_in_team"
  | "vice_captain_not_in_team";

export interface Violation {
  code: ViolationCode;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  /** valid AND every check could be evaluated with platform data (credits from imported/provider source). */
  fullyVerifiable: boolean;
  label: string;
  violations: Violation[];
  warnings: string[];
  creditsUsed: number | null;
  roleCounts: Record<PlayerRole, number>;
  teamCounts: Record<string, number>;
  teamRulesId: string;
  teamRulesStatus: string;
}

export interface TeamSelection {
  playerIds: string[];
  captainId: string | null;
  viceCaptainId: string | null;
}

export function validateTeam(sel: TeamSelection, pool: PoolPlayer[], rules: TeamRules, opts: { partial?: boolean } = {}): ValidationResult {
  const violations: Violation[] = [];
  const warnings: string[] = [];
  const byId = new Map(pool.map((p) => [p.playerId, p]));
  const ids = sel.playerIds;

  if (new Set(ids).size !== ids.length) violations.push({ code: "duplicate_player", message: "A player is selected more than once" });
  const chosen = ids.map((id) => byId.get(id)).filter((p): p is PoolPlayer => !!p);
  for (const id of ids) if (!byId.has(id)) violations.push({ code: "not_in_pool", message: `Player ${id} is not in this match's eligible pool` });

  if (!opts.partial && ids.length !== rules.squadSize) {
    violations.push({ code: "squad_size", message: `Team has ${ids.length} players; exactly ${rules.squadSize} required` });
  } else if (opts.partial && ids.length > rules.squadSize) {
    violations.push({ code: "squad_size", message: `Team has ${ids.length} players; maximum ${rules.squadSize}` });
  }

  const roleCounts: Record<PlayerRole, number> = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  const teamCounts: Record<string, number> = {};
  for (const p of chosen) {
    roleCounts[p.role] += 1;
    teamCounts[p.team] = (teamCounts[p.team] ?? 0) + 1;
  }
  for (const role of Object.keys(rules.roleLimits) as PlayerRole[]) {
    const [min, max] = rules.roleLimits[role];
    if (roleCounts[role] > max) violations.push({ code: "role_max", message: `${roleCounts[role]} ${role} selected; maximum ${max}` });
    if (!opts.partial && roleCounts[role] < min) violations.push({ code: "role_min", message: `${roleCounts[role]} ${role} selected; minimum ${min}` });
  }
  const realTeams = [...new Set(pool.map((p) => p.team))];
  for (const t of realTeams) {
    const c = teamCounts[t] ?? 0;
    if (c > rules.maxPerRealTeam) violations.push({ code: "team_max", message: `${c} players from ${t}; maximum ${rules.maxPerRealTeam}` });
    if (!opts.partial && c < rules.minPerRealTeam) violations.push({ code: "team_min", message: `${c} players from ${t}; minimum ${rules.minPerRealTeam}` });
  }

  let creditsUsed: number | null = null;
  const unknownCredits = chosen.some((p) => p.credits == null);
  if (unknownCredits) {
    violations.push({ code: "credits_unknown", message: "Credits are unavailable for some players, so the credit cap cannot be checked" });
  } else {
    creditsUsed = Math.round(chosen.reduce((s, p) => s + (p.credits ?? 0), 0) * 10) / 10;
    if (creditsUsed > rules.creditCap + 1e-9) violations.push({ code: "credit_cap", message: `${creditsUsed} credits used; cap ${rules.creditCap}` });
  }

  if (!opts.partial) {
    if (rules.requireCaptain && !sel.captainId) violations.push({ code: "captain_missing", message: "Choose a captain" });
    if (rules.requireViceCaptain && !sel.viceCaptainId) violations.push({ code: "vice_captain_missing", message: "Choose a vice-captain" });
  }
  if (sel.captainId && sel.captainId === sel.viceCaptainId) violations.push({ code: "captain_equals_vice", message: "Captain and vice-captain must be different" });
  if (sel.captainId && !ids.includes(sel.captainId)) violations.push({ code: "captain_not_in_team", message: "Captain is not in the team" });
  if (sel.viceCaptainId && !ids.includes(sel.viceCaptainId)) violations.push({ code: "vice_captain_not_in_team", message: "Vice-captain is not in the team" });

  const creditSources = new Set(chosen.map((p) => p.creditSource));
  if (creditSources.has("estimated_demo")) warnings.push("Credits are demo estimates, not Dream11 credits");
  if (chosen.some((p) => p.roleSource === "inferred_history")) warnings.push("Some roles are inferred from history, not the platform's listed roles");
  if (rules.status !== "verified") warnings.push(`Team rules '${rules.id}' are ${rules.status}, not verified`);

  const valid = violations.length === 0;
  const fullyVerifiable = valid && !creditSources.has("estimated_demo") && !creditSources.has("none") && rules.status === "verified" && chosen.every((p) => p.roleSource !== "inferred_history");
  const label = !valid ? "Not valid" : fullyVerifiable ? "Rules validated" : "Valid under draft rules / demo inputs";
  return { valid, fullyVerifiable, label, violations, warnings, creditsUsed, roleCounts, teamCounts, teamRulesId: rules.id, teamRulesStatus: rules.status };
}
