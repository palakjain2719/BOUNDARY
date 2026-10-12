import type { Competition, PlayerRole } from "../data/types";

export type RulesStatus = "draft" | "reviewed" | "verified";

/** A numeric band. Bounds are optional; `gt`/`lt` are exclusive, `gte`/`lte` inclusive. */
export interface Band {
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  points: number;
  label: string;
}

export interface Threshold {
  at: number;
  points: number;
  label: string;
}

export interface RulesConfig {
  id: string;
  version: string;
  name: string;
  competitions: Competition[];
  format: "T20";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  officialSourceUrl: string;
  verifiedAt: string | null;
  status: RulesStatus;
  provenance: string;
  notes: string[];
  participation: {
    /** Points for being in the announced XI. */
    announcedXI: number;
    /** Points for a substitute (impact / concussion) who enters the match. */
    substitutePlayed: number;
  };
  batting: {
    run: number;
    boundaryBonus: number;
    sixBonus: number;
    milestones: Threshold[];
    /**
     * highest_only: only the largest milestone reached. cumulative: every milestone reached.
     * cumulative_top_exclusive: lower milestones stack, but reaching the top one (e.g. a century) awards only it.
     */
    milestoneMode: "highest_only" | "cumulative" | "cumulative_top_exclusive";
    duck: number;
    duckExemptRoles: PlayerRole[];
  };
  bowling: {
    wicket: number;
    lbwBowledBonus: number;
    haulBonuses: Threshold[];
    haulMode: "highest_only" | "cumulative";
    maiden: number;
    dotBall: number;
  };
  fielding: {
    catch: number;
    catchBonus: Threshold | null;
    stumping: number;
    runOutDirect: number;
    runOutIndirect: number;
  };
  strikeRate: {
    minBalls: number;
    exemptRoles: PlayerRole[];
    bands: Band[];
  };
  economy: {
    minBalls: number;
    bands: Band[];
  };
  multipliers: {
    captain: number;
    viceCaptain: number;
  };
  superOver: "excluded";
}

export type LineItemCategory = "participation" | "batting" | "bowling" | "fielding" | "strike_rate" | "economy";

export interface LineItem {
  code: string;
  category: LineItemCategory;
  label: string;
  /** Source event count or value the rule was applied to. */
  quantity: number;
  pointsEach: number | null;
  points: number;
  evidence: string;
}

export interface OmittedRule {
  code: string;
  reason: string;
}

export interface PlayerScore {
  playerId: string;
  rulesId: string;
  rulesVersion: string;
  rulesStatus: RulesStatus;
  basePoints: number;
  byCategory: Record<LineItemCategory, number>;
  lineItems: LineItem[];
  omitted: OmittedRule[];
}
