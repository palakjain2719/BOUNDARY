/**
 * Player status card data: career stats in one competition from matches strictly BEFORE a given date
 * (so a pop-up on an upcoming or replayed match never reveals later results).
 */
import { loadCompetition, playerName } from "../data/historical";
import type { Competition } from "../data/types";
import { canonicalTeam } from "../data/normalize";
import { buildHistoryIndex, priorRows } from "../features/history";
import { defaultRulesFor } from "../scoring/registry";

export interface PlayerProfile {
  playerId: string;
  name: string;
  competition: Competition;
  beforeDate: string;
  teams: string[];
  matches: number;
  firstMatch: string | null;
  lastMatch: string | null;
  batting: { innings: number; runs: number; balls: number; fours: number; sixes: number; highScore: number; fifties: number; strikeRate: number | null; average: number | null; dismissals: number };
  bowling: { innings: number; balls: number; runs: number; wickets: number; dotBalls: number; maidens: number; economy: number | null; best: string | null };
  fielding: { catches: number; stumpings: number; runOuts: number };
  fantasy: { average: number | null; best: number | null; last5: { date: string; points: number; opponent: string }[] };
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function playerProfile(competition: Competition, playerId: string, beforeDate: string): PlayerProfile | null {
  const data = loadCompetition(competition);
  if (!data.statsByPlayer.has(playerId)) return null;
  const idx = buildHistoryIndex(data, defaultRulesFor(competition));
  const rows = priorRows(idx, playerId, beforeDate);
  const s = rows.map((r) => r.stats);
  const bat = s.filter((x) => x.batted);
  const bowl = s.filter((x) => x.ballsBowled > 0);
  const runs = bat.reduce((a, x) => a + x.runs, 0);
  const balls = bat.reduce((a, x) => a + x.ballsFaced, 0);
  const outs = bat.filter((x) => x.dismissed).length;
  const bBalls = bowl.reduce((a, x) => a + x.ballsBowled, 0);
  const bRuns = bowl.reduce((a, x) => a + x.runsConceded, 0);
  const best = [...bowl].sort((a, b) => b.wickets - a.wickets || a.runsConceded - b.runsConceded)[0];
  const pts = rows.map((r) => r.points);
  return {
    playerId,
    name: playerName(data, playerId),
    competition,
    beforeDate,
    teams: [...new Set(s.map((x) => canonicalTeam(x.team)))],
    matches: rows.length,
    firstMatch: rows[0]?.date ?? null,
    lastMatch: rows[rows.length - 1]?.date ?? null,
    batting: {
      innings: bat.length, runs, balls, fours: bat.reduce((a, x) => a + x.fours, 0), sixes: bat.reduce((a, x) => a + x.sixes, 0),
      highScore: bat.reduce((a, x) => Math.max(a, x.runs), 0), fifties: bat.filter((x) => x.runs >= 50).length,
      strikeRate: balls ? r1((100 * runs) / balls) : null, average: outs ? r1(runs / outs) : null, dismissals: outs,
    },
    bowling: {
      innings: bowl.length, balls: bBalls, runs: bRuns, wickets: bowl.reduce((a, x) => a + x.wickets, 0), dotBalls: bowl.reduce((a, x) => a + x.dotBalls, 0),
      maidens: bowl.reduce((a, x) => a + x.maidens, 0), economy: bBalls ? r1((6 * bRuns) / bBalls) : null, best: best && best.wickets ? `${best.wickets}/${best.runsConceded}` : null,
    },
    fielding: { catches: s.reduce((a, x) => a + x.catches, 0), stumpings: s.reduce((a, x) => a + x.stumpings, 0), runOuts: s.reduce((a, x) => a + x.runOutsDirect + x.runOutsIndirect, 0) },
    fantasy: {
      average: pts.length ? r1(pts.reduce((a, b) => a + b, 0) / pts.length) : null,
      best: pts.length ? Math.max(...pts) : null,
      last5: rows.slice(-5).map((r) => ({ date: r.date, points: r.points, opponent: r.opponent })),
    },
  };
}
