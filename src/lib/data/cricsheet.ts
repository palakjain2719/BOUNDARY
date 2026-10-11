/**
 * Cricsheet JSON → per-player event stats (Super Overs excluded) and match metadata.
 * Pure function of the parsed JSON so it can be unit-tested.
 */
import type { Competition, MatchRecord, PlayerMatchStats } from "./types";

const BOWLER_CREDITED = new Set(["bowled", "caught", "lbw", "stumped", "caught and bowled", "hit wicket"]);

type Delivery = {
  batter: string;
  bowler: string;
  runs: { batter: number; extras: number; total: number; non_boundary?: boolean };
  extras?: { wides?: number; noballs?: number; byes?: number; legbyes?: number; penalty?: number };
  wickets?: { player_out: string; kind: string; fielders?: { name?: string; substitute?: boolean }[] }[];
  replacements?: { match?: { in: string; out: string; team: string; reason: string }[] };
};

export function emptyStats(): Omit<PlayerMatchStats, "matchId" | "playerId" | "team" | "competition"> {
  return {
    inAnnouncedXI: false,
    substituteIn: null,
    batted: false,
    battingPosition: null,
    runs: 0,
    ballsFaced: 0,
    fours: 0,
    sixes: 0,
    dismissed: false,
    dismissalKind: null,
    ballsBowled: 0,
    runsConceded: 0,
    wickets: 0,
    lbwBowledWickets: 0,
    dotBalls: 0,
    maidens: 0,
    catches: 0,
    stumpings: 0,
    runOutsDirect: 0,
    runOutsIndirect: 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseMatch(raw: any, id: string, competition: Competition) {
  const info = raw.info;
  const people: Record<string, string> = info.registry?.people ?? {};
  const pid = (name: string) => people[name] ?? `name:${name}`;
  const teams: string[] = info.teams;

  const stats = new Map<string, ReturnType<typeof emptyStats> & { team: string }>();
  const get = (name: string, team: string) => {
    const k = pid(name);
    if (!stats.has(k)) stats.set(k, { ...emptyStats(), team });
    return stats.get(k)!;
  };

  // Announced players list. From 2023 IPL, lists include the impact player who later came in.
  const listed: Record<string, string[]> = info.players ?? {};
  for (const team of Object.keys(listed)) for (const n of listed[team]) get(n, team);

  const subsIn = new Map<string, string>(); // player id -> reason
  let hasSuperOver = false;

  for (const inn of raw.innings ?? []) {
    if (inn.super_over) {
      hasSuperOver = true;
      // Still record substitutions announced during super overs; skip performance stats.
      continue;
    }
    const battingTeam: string = inn.team;
    const bowlingTeam = teams.find((t) => t !== battingTeam) ?? "";
    let battingOrder = 0;
    const seenBatter = new Set<string>();

    for (const over of inn.overs ?? []) {
      const overByBowler = new Map<string, { legal: number; conceded: number }>();
      for (const d of over.deliveries as Delivery[]) {
        for (const r of d.replacements?.match ?? []) {
          subsIn.set(pid(r.in), r.reason);
          get(r.in, r.team);
        }
        for (const name of [d.batter]) {
          if (!seenBatter.has(name)) {
            seenBatter.add(name);
            battingOrder += 1;
            const s = get(name, battingTeam);
            s.batted = true;
            s.battingPosition = battingOrder;
          }
        }
        const ns = (d as unknown as { non_striker: string }).non_striker;
        if (ns && !seenBatter.has(ns)) {
          seenBatter.add(ns);
          battingOrder += 1;
          const s = get(ns, battingTeam);
          s.batted = true;
          s.battingPosition = battingOrder;
        }

        const ex = d.extras ?? {};
        const isWide = (ex.wides ?? 0) > 0;
        const isNoball = (ex.noballs ?? 0) > 0;
        const bat = get(d.batter, battingTeam);
        bat.runs += d.runs.batter;
        if (!isWide) bat.ballsFaced += 1;
        if (!d.runs.non_boundary) {
          if (d.runs.batter === 4) bat.fours += 1;
          if (d.runs.batter === 6) bat.sixes += 1;
        }

        const bowl = get(d.bowler, bowlingTeam);
        const conceded = d.runs.batter + (ex.wides ?? 0) + (ex.noballs ?? 0);
        bowl.runsConceded += conceded;
        const legal = !isWide && !isNoball;
        if (legal) bowl.ballsBowled += 1;
        if (legal && conceded === 0) bowl.dotBalls += 1;
        const o = overByBowler.get(d.bowler) ?? { legal: 0, conceded: 0 };
        if (legal) o.legal += 1;
        o.conceded += conceded;
        overByBowler.set(d.bowler, o);

        for (const w of d.wickets ?? []) {
          const out = get(w.player_out, battingTeam);
          if (w.kind !== "retired hurt") {
            out.dismissed = true;
            out.dismissalKind = w.kind;
          }
          if (BOWLER_CREDITED.has(w.kind)) {
            bowl.wickets += 1;
            if (w.kind === "lbw" || w.kind === "bowled") bowl.lbwBowledWickets += 1;
          }
          const fielders = (w.fielders ?? []).filter((f) => f.name && !f.substitute);
          if (w.kind === "caught") for (const f of fielders) get(f.name!, bowlingTeam).catches += 1;
          if (w.kind === "caught and bowled") bowl.catches += 1;
          if (w.kind === "stumped") for (const f of fielders) get(f.name!, bowlingTeam).stumpings += 1;
          if (w.kind === "run out") {
            // Cricsheet does not mark direct hits. Convention (documented in rules notes):
            // one named fielder => direct; two or more => each gets a non-direct credit.
            if (fielders.length === 1) get(fielders[0].name!, bowlingTeam).runOutsDirect += 1;
            else for (const f of fielders) get(f.name!, bowlingTeam).runOutsIndirect += 1;
          }
        }
      }
      // Maiden: bowler delivered a complete 6-legal-ball over conceding nothing.
      for (const [name, o] of overByBowler) if (o.legal >= 6 && o.conceded === 0) get(name, bowlingTeam).maidens += 1;
    }
  }

  const rows: PlayerMatchStats[] = [];
  for (const [playerId, s] of stats) {
    const sub = subsIn.get(playerId) ?? null;
    const inList = Object.values(listed).some((names) => names.some((n) => pid(n) === playerId));
    rows.push({
      ...s,
      matchId: id,
      playerId,
      competition,
      substituteIn: sub,
      inAnnouncedXI: inList && !sub,
    });
  }

  const outcome = info.outcome ?? {};
  const result = outcome.winner
    ? `${outcome.winner} won by ${outcome.by?.runs ? `${outcome.by.runs} runs` : `${outcome.by?.wickets ?? "?"} wickets`}${outcome.method ? ` (${outcome.method})` : ""}`
    : outcome.result ?? "No result";

  const match: MatchRecord = {
    id,
    competition,
    gender: info.gender,
    season: String(info.season),
    date: info.dates[0],
    venue: info.venue,
    city: info.city ?? null,
    team1: teams[0],
    team2: teams[1],
    eventStage: info.event?.stage ?? (info.event?.match_number ? `Match ${info.event.match_number}` : null),
    tossWinner: info.toss?.winner ?? null,
    tossDecision: info.toss?.decision ?? null,
    winner: outcome.winner ?? null,
    result,
    hasSuperOver,
    source: competition === "IPL" ? "Cricsheet ipl_male_json" : "Cricsheet wpl_json",
    sourceRevision: info.revision ?? null,
  };
  const names: Record<string, string> = {};
  for (const [n, p] of Object.entries(people)) names[p] = n;
  return { match, rows, names };
}

