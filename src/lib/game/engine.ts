/**
 * Super Over mini-game: pure, deterministic game logic (no DOM), so outcomes can be unit-tested.
 * World units are metres: x = lateral (+ = off side for a right-hander), z = distance from the batter's
 * crease towards the bowler (0 … 20), y = height.
 */

export type Difficulty = "easy" | "medium" | "hard";
export type ShotKind = "ground" | "loft";

export interface Delivery {
  /** Lateral line at release and at the batter (swing/seam drift). */
  releaseX: number;
  pitchX: number;
  arriveX: number;
  /** Where the ball pitches (metres from the batter). */
  pitchZ: number;
  /** Total flight time release → batter, seconds. */
  flight: number;
  /** Fraction of the flight at which the ball pitches. */
  pitchAt: number;
  /** Shown target ring (an estimate with difficulty-dependent error). */
  ringX: number;
  ringZ: number;
  label: string;
}

export interface Outcome {
  runs: number;
  wicket: boolean;
  kind: "dot" | "beaten" | "bowled" | "caught" | "edge" | "single" | "double" | "triple" | "four" | "six";
  /** Direction of the shot in degrees: 0 = straight back past the bowler, − = leg side, + = off side. */
  angle: number;
  /** 0..1 quality used for animation distance. */
  quality: number;
  text: string;
}

export const DIFFICULTY: Record<Difficulty, { flight: [number, number]; drift: number; ringError: number; window: number }> = {
  easy: { flight: [0.95, 1.1], drift: 0.12, ringError: 0.05, window: 1.25 },
  medium: { flight: [0.78, 0.92], drift: 0.22, ringError: 0.12, window: 1 },
  hard: { flight: [0.62, 0.76], drift: 0.32, ringError: 0.22, window: 0.85 },
};

export const STUMPS_HALF_WIDTH = 0.12; // metres either side of middle stump
export const BATTER_REACH = 0.55; // how far from the batter's centre the bat can meet the ball

/** Seeded PRNG (mulberry32) so a run can be replayed and tests are deterministic. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LENGTHS = [
  { name: "yorker", z: [0.6, 1.4] },
  { name: "full", z: [2, 3.5] },
  { name: "good length", z: [4.5, 6.5] },
  { name: "short", z: [7.5, 9.5] },
] as const;

export function makeDelivery(r: () => number, difficulty: Difficulty): Delivery {
  const d = DIFFICULTY[difficulty];
  const len = LENGTHS[Math.floor(r() * LENGTHS.length)];
  const pitchZ = len.z[0] + r() * (len.z[1] - len.z[0]);
  const line = (r() - 0.45) * 0.9; // slightly off-side biased
  const drift = (r() - 0.5) * 2 * d.drift;
  const flight = d.flight[0] + r() * (d.flight[1] - d.flight[0]);
  const ringX = line + (r() - 0.5) * 2 * d.ringError;
  const ringZ = pitchZ + (r() - 0.5) * 2 * d.ringError * 4;
  const side = line > 0.25 ? "outside off" : line < -0.25 ? "down leg" : "on the stumps";
  return {
    releaseX: 0.4 * (r() - 0.5),
    pitchX: line,
    arriveX: line + drift,
    pitchZ,
    flight,
    pitchAt: 1 - pitchZ / 20,
    ringX,
    ringZ,
    label: `${len.name}, ${side}${Math.abs(drift) > 0.15 ? (drift > 0 ? ", swinging away" : ", swinging in") : ""}`,
  };
}

/** Ball position at time t (seconds since release). */
export function ballAt(del: Delivery, t: number): { x: number; y: number; z: number } {
  const u = Math.min(Math.max(t / del.flight, 0), 1.15);
  const z = 20 * (1 - u);
  if (u <= del.pitchAt) {
    const k = u / del.pitchAt;
    return { x: del.releaseX + (del.pitchX - del.releaseX) * k, y: 2.1 * (1 - k) + 0.05, z };
  }
  const k = (u - del.pitchAt) / Math.max(0.0001, 1 - del.pitchAt);
  const bounce = Math.min(1.6, 0.25 + del.pitchZ * 0.12);
  return { x: del.pitchX + (del.arriveX - del.pitchX) * k, y: 0.05 + bounce * Math.sin(Math.min(k, 1) * Math.PI * 0.55), z };
}

/**
 * Resolve a ball.
 * @param swingAt seconds since release when the player swung (null = no shot)
 * @param batterX batter's lateral position when the ball arrives
 * @param kind ground or lofted shot
 * @param r random source for risk outcomes (catches, edges)
 */
export function resolveBall(del: Delivery, swingAt: number | null, batterX: number, kind: ShotKind, difficulty: Difficulty, r: () => number): Outcome {
  const window = DIFFICULTY[difficulty].window;
  const ballX = del.arriveX;
  const onStumps = Math.abs(ballX) <= STUMPS_HALF_WIDTH + 0.04;
  const align = Math.abs(batterX - ballX); // 0 = perfectly in line
  // Leaving the ball, or swinging hopelessly early / late / far from the line.
  const err = swingAt == null ? Infinity : swingAt - del.flight; // seconds; − early, + late
  const reachable = align <= BATTER_REACH;
  if (swingAt == null || Math.abs(err) > 0.24 * window || !reachable) {
    // A batter standing in front of the stumps can't be bowled by a ball they're covering.
    const covered = Math.abs(batterX) <= 0.18 && align <= 0.2;
    if (onStumps && !covered) return { runs: 0, wicket: true, kind: "bowled", angle: 0, quality: 0, text: swingAt == null ? "Left it — and it's crashed into the stumps. BOWLED!" : "Swing and a miss… BOWLED!" };
    return { runs: 0, wicket: false, kind: "beaten", angle: 0, quality: 0, text: swingAt == null ? "Shouldered arms. Dot ball." : "Beaten! Dot ball." };
  }
  const timing = Math.max(0, 1 - Math.abs(err) / (0.24 * window));
  const alignment = Math.max(0, 1 - align / BATTER_REACH);
  const quality = Math.round(Math.pow(timing, 0.8) * Math.pow(alignment, 0.6) * 1000) / 1000;
  // Early → pulled through leg side, late → steered to the off side.
  const angle = Math.max(-75, Math.min(75, (err / (0.24 * window)) * 80 + (ballX - batterX) * 40));
  const side = angle < -15 ? "leg side" : angle > 15 ? "off side" : "straight";

  if (kind === "loft") {
    if (quality >= 0.8) return { runs: 6, wicket: false, kind: "six", angle, quality, text: `SIX! Launched ${side === "straight" ? "straight back over the bowler" : `over the ${side} boundary`}!` };
    if (quality >= 0.62) return { runs: 4, wicket: false, kind: "four", angle, quality, text: `FOUR! Lofted ${side}, one bounce into the rope.` };
    if (quality >= 0.42) {
      if (r() < 0.45) return { runs: 0, wicket: true, kind: "caught", angle, quality, text: `Up in the air… taken! Caught on the ${side}.` };
      return { runs: 2, wicket: false, kind: "double", angle, quality, text: "Skied, but it drops safe. Two runs." };
    }
    return { runs: 0, wicket: true, kind: "caught", angle, quality, text: "Top edge… straight down a fielder's throat. CAUGHT!" };
  }

  // Ground shot: safer, fewer big runs.
  if (quality >= 0.86) return { runs: 4, wicket: false, kind: "four", angle, quality, text: `FOUR! Timed beautifully ${side === "straight" ? "down the ground" : `through the ${side}`}.` };
  if (quality >= 0.66) return { runs: r() < 0.5 ? 3 : 2, wicket: false, kind: "double", angle, quality, text: "Into the gap — they come back for more." };
  if (quality >= 0.4) return { runs: 1, wicket: false, kind: "single", angle, quality, text: `Worked ${side === "straight" ? "back down the pitch" : `to the ${side}`} for a single.` };
  if (quality >= 0.22 && r() < 0.18) return { runs: 0, wicket: true, kind: "caught", angle, quality, text: "Thick edge… and the keeper takes it. CAUGHT BEHIND!" };
  return { runs: 0, wicket: false, kind: "edge", angle, quality, text: "Inside edge onto the pad. Dot ball." };
}

export interface Innings {
  balls: number;
  maxBalls: number;
  wickets: number;
  maxWickets: number;
  runs: number;
  target: number;
  log: Outcome[];
}

export function newInnings(target: number, maxBalls = 6, maxWickets = 2): Innings {
  return { balls: 0, maxBalls, wickets: 0, maxWickets, runs: 0, target, log: [] };
}

export function applyOutcome(inn: Innings, o: Outcome): Innings {
  const runs = inn.runs + o.runs;
  return { ...inn, balls: inn.balls + 1, wickets: inn.wickets + (o.wicket ? 1 : 0), runs, log: [...inn.log, o] };
}

export function inningsResult(inn: Innings): "won" | "lost" | "tied" | null {
  if (inn.runs >= inn.target) return "won";
  if (inn.balls >= inn.maxBalls || inn.wickets >= inn.maxWickets) return inn.runs === inn.target - 1 ? "tied" : "lost";
  return null;
}

/** Opponent's super-over score to chase, by difficulty. */
export function opponentScore(r: () => number, difficulty: Difficulty) {
  const [lo, hi] = difficulty === "easy" ? [6, 12] : difficulty === "medium" ? [10, 17] : [14, 22];
  return lo + Math.floor(r() * (hi - lo + 1));
}
