/**
 * Deterministic, versioned fantasy points calculator.
 *
 * - Pure function of (event stats, player role, rules config). No randomness, no LLM.
 * - Produces BASE player points only. Captain / vice-captain multipliers are applied by the
 *   team scorer (team.ts), exactly once.
 * - Every awarded rule is a line item with source evidence; every non-applied rule that was
 *   considered is listed in `omitted` with a reason.
 */
import type { PlayerMatchStats, PlayerRole } from "../data/types";
import type { Band, LineItem, LineItemCategory, OmittedRule, PlayerScore, RulesConfig, Threshold } from "./types";

export type ScoringInput = Pick<
  PlayerMatchStats,
  | "playerId"
  | "inAnnouncedXI"
  | "substituteIn"
  | "batted"
  | "runs"
  | "ballsFaced"
  | "fours"
  | "sixes"
  | "dismissed"
  | "dismissalKind"
  | "ballsBowled"
  | "runsConceded"
  | "wickets"
  | "lbwBowledWickets"
  | "dotBalls"
  | "maidens"
  | "catches"
  | "stumpings"
  | "runOutsDirect"
  | "runOutsIndirect"
>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function inBand(value: number, b: Band): boolean {
  if (b.gt !== undefined && !(value > b.gt)) return false;
  if (b.gte !== undefined && !(value >= b.gte)) return false;
  if (b.lt !== undefined && !(value < b.lt)) return false;
  if (b.lte !== undefined && !(value <= b.lte)) return false;
  return true;
}

function thresholdsReached(value: number, list: Threshold[], mode: "highest_only" | "cumulative"): Threshold[] {
  const reached = [...list].sort((a, b) => a.at - b.at).filter((t) => value >= t.at);
  if (mode === "cumulative") return reached;
  return reached.length ? [reached[reached.length - 1]] : [];
}

/** Dismissals that count as a duck. Retired hurt is not a dismissal. */
const DUCK_KINDS_EXCLUDED = new Set(["retired hurt", "retired not out"]);

export function scorePlayer(input: ScoringInput, role: PlayerRole, rules: RulesConfig): PlayerScore {
  const items: LineItem[] = [];
  const omitted: OmittedRule[] = [];
  const add = (
    code: string,
    category: LineItemCategory,
    label: string,
    quantity: number,
    pointsEach: number | null,
    points: number,
    evidence: string,
  ) => {
    if (points === 0) return;
    items.push({ code, category, label, quantity, pointsEach, points: round2(points), evidence });
  };

  // Participation: announced XI or a substitute who entered. Awarded once, never both.
  const played = input.inAnnouncedXI || !!input.substituteIn;
  if (input.inAnnouncedXI) {
    add("participation.announced_xi", "participation", "Announced in playing XI", 1, rules.participation.announcedXI, rules.participation.announcedXI, "Listed in starting XI");
  } else if (input.substituteIn) {
    add(
      "participation.substitute",
      "participation",
      "Substitute who entered the match",
      1,
      rules.participation.substitutePlayed,
      rules.participation.substitutePlayed,
      `Came in as ${input.substituteIn.replace(/_/g, " ")}`,
    );
  } else {
    omitted.push({ code: "participation", reason: "Not in announced XI and no recorded substitution" });
  }

  // Batting
  const b = rules.batting;
  add("batting.runs", "batting", "Runs", input.runs, b.run, input.runs * b.run, `${input.runs} runs off ${input.ballsFaced} balls`);
  add("batting.boundary_bonus", "batting", "Boundary bonus", input.fours, b.boundaryBonus, input.fours * b.boundaryBonus, `${input.fours} fours (all-run 4s excluded)`);
  add("batting.six_bonus", "batting", "Six bonus", input.sixes, b.sixBonus, input.sixes * b.sixBonus, `${input.sixes} sixes`);
  for (const t of thresholdsReached(input.runs, b.milestones, b.milestoneMode)) {
    add(`batting.milestone_${t.at}`, "batting", t.label, 1, t.points, t.points, `Reached ${t.at} (scored ${input.runs})`);
  }
  if (b.milestoneMode === "highest_only") {
    const reached = b.milestones.filter((t) => input.runs >= t.at);
    if (reached.length > 1) {
      omitted.push({
        code: "batting.lower_milestones",
        reason: `Only the highest milestone is awarded (highest_only); lower milestones ${reached
          .slice(0, -1)
          .map((t) => t.at)
          .join(", ")} not added`,
      });
    }
  }
  const isDuck = input.dismissed && input.runs === 0 && input.batted && !DUCK_KINDS_EXCLUDED.has(input.dismissalKind ?? "");
  if (isDuck) {
    if (b.duckExemptRoles.includes(role)) omitted.push({ code: "batting.duck", reason: `Duck penalty not applied to role ${role}` });
    else add("batting.duck", "batting", "Duck", 1, b.duck, b.duck, `Dismissed for 0 (${input.dismissalKind})`);
  }

  // Bowling
  const w = rules.bowling;
  add("bowling.wickets", "bowling", "Wickets (excl. run-outs)", input.wickets, w.wicket, input.wickets * w.wicket, `${input.wickets} bowler-credited wickets`);
  add("bowling.lbw_bowled", "bowling", "LBW / bowled bonus", input.lbwBowledWickets, w.lbwBowledBonus, input.lbwBowledWickets * w.lbwBowledBonus, `${input.lbwBowledWickets} LBW or bowled`);
  for (const t of thresholdsReached(input.wickets, w.haulBonuses, w.haulMode)) {
    add(`bowling.haul_${t.at}`, "bowling", t.label, 1, t.points, t.points, `${input.wickets} wickets`);
  }
  add("bowling.maidens", "bowling", "Maiden overs", input.maidens, w.maiden, input.maidens * w.maiden, `${input.maidens} maidens`);
  if (w.dotBall) add("bowling.dot_balls", "bowling", "Dot balls", input.dotBalls, w.dotBall, input.dotBalls * w.dotBall, `${input.dotBalls} dot balls`);
  else if (input.dotBalls) omitted.push({ code: "bowling.dot_balls", reason: "Dot balls are not scored in this rules version" });

  // Fielding
  const f = rules.fielding;
  add("fielding.catches", "fielding", "Catches", input.catches, f.catch, input.catches * f.catch, `${input.catches} catches`);
  if (f.catchBonus && input.catches >= f.catchBonus.at) {
    add("fielding.catch_bonus", "fielding", f.catchBonus.label, 1, f.catchBonus.points, f.catchBonus.points, `${input.catches} catches`);
  }
  add("fielding.stumpings", "fielding", "Stumpings", input.stumpings, f.stumping, input.stumpings * f.stumping, `${input.stumpings} stumpings`);
  add("fielding.run_out_direct", "fielding", "Run-out (direct)", input.runOutsDirect, f.runOutDirect, input.runOutsDirect * f.runOutDirect, `${input.runOutsDirect} sole-fielder run-outs`);
  add("fielding.run_out_indirect", "fielding", "Run-out (not direct)", input.runOutsIndirect, f.runOutIndirect, input.runOutsIndirect * f.runOutIndirect, `${input.runOutsIndirect} shared run-outs`);

  // Strike rate
  const sr = rules.strikeRate;
  if (input.ballsFaced > 0) {
    if (sr.exemptRoles.includes(role)) {
      omitted.push({ code: "strike_rate", reason: `Strike-rate rule does not apply to role ${role}` });
    } else if (input.ballsFaced < sr.minBalls) {
      omitted.push({ code: "strike_rate", reason: `${input.ballsFaced} balls faced is below the ${sr.minBalls}-ball minimum` });
    } else {
      const rate = round2((input.runs / input.ballsFaced) * 100);
      const band = sr.bands.find((x) => inBand(rate, x));
      if (band) add("strike_rate", "strike_rate", band.label, rate, null, band.points, `SR ${rate} (${input.runs}/${input.ballsFaced})`);
    }
  }

  // Economy
  const ec = rules.economy;
  if (input.ballsBowled > 0) {
    if (input.ballsBowled < ec.minBalls) {
      omitted.push({ code: "economy", reason: `${input.ballsBowled} legal balls bowled is below the ${ec.minBalls}-ball minimum` });
    } else {
      const econ = round2((input.runsConceded / input.ballsBowled) * 6);
      const band = ec.bands.find((x) => inBand(econ, x));
      if (band) add("economy", "economy", band.label, econ, null, band.points, `Economy ${econ} (${input.runsConceded} runs, ${input.ballsBowled} balls)`);
    }
  }

  if (!played && items.length > 0) {
    omitted.push({ code: "participation.check", reason: "Events recorded for a player not listed in XI; check source data" });
  }

  const byCategory: Record<LineItemCategory, number> = {
    participation: 0,
    batting: 0,
    bowling: 0,
    fielding: 0,
    strike_rate: 0,
    economy: 0,
  };
  for (const it of items) byCategory[it.category] = round2(byCategory[it.category] + it.points);
  const basePoints = round2(items.reduce((s, it) => s + it.points, 0));

  return {
    playerId: input.playerId,
    rulesId: rules.id,
    rulesVersion: rules.version,
    rulesStatus: rules.status,
    basePoints,
    byCategory,
    lineItems: items,
    omitted,
  };
}
