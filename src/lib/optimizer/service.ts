/**
 * Optimizer service: builds the independent optimizer team for a workspace, plus evidence-based reasoning
 * (picks, avoid, alternatives, captain / vice-captain, risks). Validity is decided only by validateTeam().
 */
import type { PoolPlayer, PlayerRole } from "../data/types";
import { teamAbbr } from "../data/normalize";
import type { Workspace } from "../match/workspace";
import type { AvoidReason, EvidenceItem, PickReason, SnapshotPrediction } from "../store/types";
import type { TeamRules } from "./rules";
import { alternativesFor, optimizeWithCorrection, type Candidate, type OptimizedTeam, type SwapAlternative } from "./solve";

export const RISK_PROFILES = {
  ceiling: { label: "Ceiling", riskAversion: -0.25, blurb: "Leans toward high-variance upside" },
  balanced: { label: "Balanced", riskAversion: 0.25, blurb: "Projection minus a quarter of the uncertainty" },
  safe: { label: "Safe", riskAversion: 0.6, blurb: "Penalises uncertain players more heavily" },
} as const;
export type RiskProfile = keyof typeof RISK_PROFILES;

export interface Infeasibility {
  reasons: string[];
}

export interface OptimizerResult {
  team: OptimizedTeam;
  picks: PickReason[];
  avoid: AvoidReason[];
  alternatives: SwapAlternative[];
  captainReason: string;
  viceCaptainReason: string;
  risks: string[];
  evidenceQuality: EvidenceItem[];
  riskAversion: number;
}

export function diagnoseInfeasible(pool: PoolPlayer[], rules: TeamRules): Infeasibility {
  const reasons: string[] = [];
  const roles: Record<PlayerRole, number> = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  for (const p of pool) roles[p.role]++;
  for (const r of Object.keys(roles) as PlayerRole[]) {
    if (roles[r] < rules.roleLimits[r][0]) reasons.push(`Pool has ${roles[r]} ${r} but at least ${rules.roleLimits[r][0]} are required${pool.some((p) => p.roleSource === "inferred_history") ? " (roles are inferred from history; players without history default to BAT)" : ""}.`);
  }
  if (pool.length < rules.squadSize) reasons.push(`Pool has ${pool.length} players; ${rules.squadSize} needed.`);
  const credits = pool.map((p) => p.credits).filter((c): c is number => c != null).sort((a, b) => a - b);
  if (credits.length >= rules.squadSize) {
    const cheapest = credits.slice(0, rules.squadSize).reduce((a, b) => a + b, 0);
    if (cheapest > rules.creditCap) reasons.push(`Cheapest possible XI costs ${cheapest} credits (cap ${rules.creditCap}).`);
  }
  if (!reasons.length) reasons.push("No combination satisfies the role, team and credit constraints together.");
  return { reasons };
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

function form(p: SnapshotPrediction) {
  const r = p.recentPoints.slice(-5);
  if (!r.length) return "no earlier matches in this competition";
  return `last ${r.length}: ${r.map((x) => Math.round(x)).join(", ")}`;
}

function pickReasons(p: SnapshotPrediction, ws: Workspace): string[] {
  const out = [`Projected ${fmt(p.mean)} pts (80% range ${fmt(p.p10)} to ${fmt(p.p90)}), ${form(p)}.`];
  if (p.venueMatches >= 3 && p.venueMean != null) out.push(`${p.venueMatches} earlier matches at ${ws.match.venue.split(",")[0]}, averaging ${fmt(p.venueMean)}.`);
  const opp = p.team === ws.match.team1 ? ws.match.team2 : ws.match.team1;
  if (p.oppMatches >= 3 && p.oppMean != null) out.push(`Averages ${fmt(p.oppMean)} in ${p.oppMatches} games against ${teamAbbr(opp)}.`);
  if (p.credits != null) out.push(`${(p.mean / p.credits).toFixed(1)} projected pts per credit.`);
  if (p.sampleSize < 5) out.push(`Small sample (${p.sampleSize} earlier matches): treat the projection cautiously.`);
  return out;
}

export function runOptimizer(ws: Workspace, profile: RiskProfile = "balanced", opts: { exclude?: string[] } = {}): OptimizerResult | Infeasibility {
  const ra = RISK_PROFILES[profile].riskAversion;
  const predById = new Map(ws.predictions.map((p) => [p.playerId, p]));
  const cands: Candidate[] = ws.pool.map((pl) => ({ player: pl, mean: predById.get(pl.playerId)?.mean ?? 0, sigma: predById.get(pl.playerId)?.sigma ?? 30 }));
  const ignoreCredits = ws.pool.some((p) => p.credits == null);

  const exclude = [...(opts.exclude ?? [])];
  // Joint (XI, C, VC) optimisation over the whole pool, then deterministic validation; a failing lineup is
  // forbidden and re-solved (see optimizeWithCorrection).
  const team: OptimizedTeam | null = optimizeWithCorrection(cands, ws.teamRules, {
    riskAversion: ra,
    captainMultiplier: ws.rules.multipliers.captain,
    viceCaptainMultiplier: ws.rules.multipliers.viceCaptain,
    ignoreCredits,
    exclude,
    maxAttempts: 5,
  });
  if (!team) return diagnoseInfeasible(ws.pool.filter((p) => !exclude.includes(p.playerId)), ws.teamRules);

  const picks: PickReason[] = team.playerIds.map((id) => ({ playerId: id, reasons: pickReasons(predById.get(id)!, ws) }));
  const alternatives = alternativesFor(team, cands, ws.teamRules, ra);

  // Avoid: strongest non-picked players, explained relative to the feasible alternative that took their slot.
  const notPicked = ws.predictions.filter((p) => !team!.playerIds.includes(p.playerId)).sort((a, b) => b.mean - a.mean);
  const picked = team.playerIds.map((id) => predById.get(id)!);
  const avoid: AvoidReason[] = notPicked.slice(0, 5).map((p) => {
    const sameRole = picked.filter((x) => x.role === p.role).sort((a, b) => a.mean - b.mean)[0];
    const parts: string[] = [];
    if (ra > 0 && ra * p.sigma > 8) parts.push(`wide range (${fmt(p.p10)}–${fmt(p.p90)})`);
    if (p.sampleSize < 5) parts.push(`only ${p.sampleSize} earlier matches`);
    if (p.credits != null && sameRole?.credits != null && p.credits > sameRole.credits) parts.push(`${p.credits} credits vs ${sameRole.credits} for ${sameRole.name}`);
    const rel = sameRole
      ? `Closest selected ${p.role}: ${sameRole.name} (${fmt(sameRole.mean)}${sameRole.credits != null ? `, ${sameRole.credits} cr` : ""}). Projection gap ${fmt(p.mean - sameRole.mean)} pts.`
      : `No ${p.role} selected; the role limits favoured other roles.`;
    return {
      playerId: p.playerId,
      reason: `Projected ${fmt(p.mean)}${parts.length ? `; ${parts.join(", ")}` : ""}. Left out because the role, team and credit limits produce a higher total without them. ${rel}`.trim(),
    };
  });

  const cap = predById.get(team.captainId)!;
  const vc = predById.get(team.viceCaptainId)!;
  const captainReason = `${cap.name}: highest risk-adjusted projection in the XI (${fmt(cap.mean)} base, ${fmt(cap.mean * ws.rules.multipliers.captain)} as captain). ${form(cap)}.`;
  const viceCaptainReason = `${vc.name}: next-best risk-adjusted projection (${fmt(vc.mean)} base, ${fmt(vc.mean * ws.rules.multipliers.viceCaptain)} as vice-captain). ${form(vc)}.`;

  const risks: string[] = [];
  const lowSample = picked.filter((p) => p.sampleSize < 5);
  if (lowSample.length) risks.push(`${lowSample.length} picked player(s) have fewer than 5 earlier matches: ${lowSample.map((p) => p.name).join(", ")}.`);
  if (ws.context.lineupStatus !== "confirmed_xi" && ws.context.lineupStatus !== "imported_pool") risks.push("Playing XI not confirmed: re-run after the toss.");
  if (ws.pool.some((p) => p.roleSource === "inferred_history")) risks.push("Roles are inferred from history and may differ from the platform's listed roles.");
  if (ws.pool.some((p) => p.creditSource === "estimated_demo")) risks.push("Credits are demo estimates; the real credit cap check needs imported credits.");
  if (ws.match.competition === "WPL") risks.push("WPL projections are trained on reconstructed_unverified points.");
  risks.push("Model signal is weak (≈1–2% better than a constant baseline on held-out seasons); treat projections as a starting point.");

  const deep = picked.filter((p) => p.sampleSize >= 10).length;
  const venueKnown = picked.filter((p) => p.venueMatches >= 3).length;
  const evidenceQuality: EvidenceItem[] = [
    { topic: "Player form", level: deep >= 8 ? "well_supported" : deep >= 5 ? "preliminary" : "unavailable", basis: `${deep}/11 picks have 10+ earlier matches in this competition.` },
    { topic: "Venue history", level: venueKnown >= 6 ? "well_supported" : venueKnown >= 2 ? "preliminary" : "unavailable", basis: `${venueKnown}/11 picks have 3+ earlier matches at this venue; ground has ${ws.context.venueHistory.matches} earlier matches.` },
    { topic: "Playing XI", level: ws.context.lineupStatus === "confirmed_xi" ? "well_supported" : ws.context.lineupStatus === "imported_pool" ? "preliminary" : "unavailable", basis: ws.context.lineupStatus === "confirmed_xi" ? "Announced XI known at decision time." : ws.context.lineupStatus === "imported_pool" ? "Pool imported; announcement status as provided." : "Not announced yet; pool is a squad proxy." },
    { topic: "Toss", level: ws.context.toss ? "well_supported" : "unavailable", basis: ws.context.toss ? `${ws.context.toss.winner} chose to ${ws.context.toss.decision}.` : "Toss not known at decision time." },
    { topic: "Pitch report", level: ws.context.pitchReport ? "preliminary" : "unavailable", basis: ws.context.pitchReport ?? "No authorised pitch-report source configured; nothing is inferred." },
    { topic: "Roles and credits", level: ws.pool.every((p) => p.roleSource !== "inferred_history" && p.creditSource !== "estimated_demo") ? "well_supported" : "preliminary", basis: ws.pool.some((p) => p.creditSource === "estimated_demo") ? "Roles inferred from history; credits are demo estimates." : "From imported/provider data." },
    { topic: "Point projections", level: "preliminary", basis: "Held-out error is only slightly better than a constant baseline; ranges are shown for every player." },
  ];
  return { team, picks, avoid, alternatives, captainReason, viceCaptainReason, risks, evidenceQuality, riskAversion: ra };
}

export function isInfeasible(r: OptimizerResult | Infeasibility): r is Infeasibility {
  return !("team" in r);
}
