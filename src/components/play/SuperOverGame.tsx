"use client";
/**
 * Super Over — a small batting game. Canvas renders a behind-the-batter view of the pitch; React renders the
 * HUD, menus and accessible commentary. All game rules live in src/lib/game/engine.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { teamAbbr } from "@/lib/data/normalize";
import {
  applyOutcome, ballAt, inningsResult, makeDelivery, newInnings, opponentScore, resolveBall, rng,
  type Delivery, type Difficulty, type Innings, type Outcome, type ShotKind,
} from "@/lib/game/engine";
import { teamColors } from "../TeamMark";

const TEAMS = [
  "Chennai Super Kings", "Mumbai Indians", "Royal Challengers Bengaluru", "Kolkata Knight Riders", "Delhi Capitals",
  "Punjab Kings", "Rajasthan Royals", "Sunrisers Hyderabad", "Gujarat Titans", "Lucknow Super Giants", "Gujarat Giants", "UP Warriorz",
];

type Phase = "menu" | "ready" | "runup" | "delivery" | "result" | "over";

interface Sim {
  phase: Phase;
  phaseStart: number;
  delivery: Delivery | null;
  releaseAt: number;
  batterX: number;
  swing: { at: number; kind: ShotKind } | null;
  outcome: Outcome | null;
  contact: { x: number; y: number; z: number; t: number } | null;
  keys: Set<string>;
  shake: number;
}

const BEST_KEY = "boundary.superover.best";
const W = 960;
const H = 540;
const HORIZON = H * 0.34;
const F = H * 1.1;
const CAM_Y = 2.5;
const CAM_X = 0.45;
const CAM_BACK = 6;

function project(x: number, y: number, z: number) {
  const d = Math.max(0.6, z + CAM_BACK);
  return { sx: W / 2 + ((x - CAM_X) * F) / d, sy: HORIZON + ((CAM_Y - y) * F) / d, s: F / d };
}

// ---------------- audio (generated, no assets) ----------------
function useAudio(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const ensure = () => {
    if (!enabled) return null;
    if (!ctxRef.current) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctxRef.current = new C();
    }
    return ctxRef.current;
  };
  const noise = (dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = "bandpass") => {
    const ctx = ensure();
    if (!ctx) return;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filt).connect(g).connect(ctx.destination);
    src.start();
  };
  return {
    unlock: () => void ensure()?.resume(),
    bat: () => noise(0.09, 1800, 4, 0.9),
    crowd: (big: boolean) => noise(big ? 1.8 : 1.1, 700, 0.6, big ? 0.35 : 0.2, "lowpass"),
    wicket: () => noise(0.35, 220, 1.2, 0.8, "lowpass"),
  };
}

export function SuperOverGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Sim>({ phase: "menu", phaseStart: 0, delivery: null, releaseAt: 0, batterX: 0, swing: null, outcome: null, contact: null, keys: new Set(), shake: 0 });
  const rngRef = useRef(rng(Date.now() % 2147483647));
  const [phase, setPhase] = useState<Phase>("menu");
  const [team, setTeam] = useState(TEAMS[1]);
  const [opponent, setOpponent] = useState(TEAMS[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [inn, setInn] = useState<Innings>(newInnings(12));
  const [banner, setBanner] = useState<{ text: string; tone: "good" | "bad" | "neutral" } | null>(null);
  const [commentary, setCommentary] = useState("Choose your team and difficulty, then press Start.");
  const [sound, setSound] = useState(true);
  const [best, setBest] = useState<number | null>(null);
  const [reduced, setReduced] = useState(false);
  const innRef = useRef(inn);
  innRef.current = inn;
  const audio = useAudio(sound);
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const teamRef = useRef(team);
  teamRef.current = team;
  const diffRef = useRef(difficulty);
  diffRef.current = difficulty;

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(BEST_KEY);
      if (v) setBest(Number(v));
    } catch {
      /* storage unavailable: no best score */
    }
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const setSimPhase = useCallback((p: Phase) => {
    const s = simRef.current;
    s.phase = p;
    s.phaseStart = performance.now();
    setPhase(p);
  }, []);

  const nextBall = useCallback(() => {
    const s = simRef.current;
    s.delivery = makeDelivery(rngRef.current, diffRef.current);
    s.swing = null;
    s.outcome = null;
    s.contact = null;
    setBanner(null);
    const i = innRef.current;
    setCommentary(`Ball ${i.balls + 1} of ${i.maxBalls}: ${i.target - i.runs} needed. Watch the ring — ${s.delivery.label}.`);
    setSimPhase("ready");
  }, [setSimPhase]);

  const start = () => {
    audio.unlock();
    const others = TEAMS.filter((t) => t !== team);
    const opp = others[Math.floor(rngRef.current() * others.length)];
    setOpponent(opp);
    const score = opponentScore(rngRef.current, difficulty);
    const fresh = newInnings(score + 1);
    setInn(fresh);
    innRef.current = fresh;
    simRef.current.batterX = 0;
    frameRef.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    setCommentary(`${opp} made ${score} in their super over. ${team} need ${score + 1} off 6 balls with 2 wickets.`);
    nextBall();
  };

  const swing = useCallback((kind: ShotKind) => {
    const s = simRef.current;
    if (s.phase !== "delivery" || s.swing || !s.delivery) return;
    const t = (performance.now() - s.releaseAt) / 1000;
    s.swing = { at: t, kind };
    const o = resolveBall(s.delivery, t, s.batterX, kind, diffRef.current, rngRef.current);
    if (o.runs > 0 || o.kind === "caught" || o.kind === "edge") {
      const b = ballAt(s.delivery, Math.min(t, s.delivery.flight));
      s.contact = { ...b, t: performance.now() };
      s.outcome = o;
      audioRef.current.bat();
    } else {
      s.outcome = o; // resolved when the ball reaches the stumps
    }
  }, []);

  // Development-only test hook (stripped from production builds): lets automated checks time a shot.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __superOver?: unknown }).__superOver = {
      state: () => ({ phase: simRef.current.phase, releaseAt: simRef.current.releaseAt, flight: simRef.current.delivery?.flight ?? null, arriveX: simRef.current.delivery?.arriveX ?? null }),
      setBatterX: (x: number) => (simRef.current.batterX = x),
      swing,
      /** Freeze a perfectly timed shot at `progress` (0..1) of its flight, for visual checks. */
      previewShot: (kind: ShotKind, progress = 0.5) => {
        const s = simRef.current;
        if (!s.delivery) return "no delivery";
        s.phase = "delivery";
        s.batterX = s.delivery.arriveX;
        s.swing = { at: s.delivery.flight, kind };
        s.outcome = resolveBall(s.delivery, s.delivery.flight, s.delivery.arriveX, kind, diffRef.current, rngRef.current);
        s.contact = { ...ballAt(s.delivery, s.delivery.flight), t: performance.now() - progress * 900 };
        s.releaseAt = performance.now() - s.delivery.flight * 1000;
        return s.outcome.kind;
      },
    };
  }, [swing]);

  // keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const s = simRef.current;
      if (s.phase === "menu" || s.phase === "over") return;
      const k = e.key.toLowerCase();
      if (["arrowleft", "arrowright", "a", "d", " ", "l", "k", "j"].includes(k)) e.preventDefault();
      if (k === "arrowleft" || k === "a") s.keys.add("left");
      if (k === "arrowright" || k === "d") s.keys.add("right");
      if (k === " " || k === "j") swing("ground");
      if (k === "l" || k === "k") swing("loft");
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") simRef.current.keys.delete("left");
      if (k === "arrowright" || k === "d") simRef.current.keys.delete("right");
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [swing]);

  // main loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Pre-rendered crowd band.
    const crowd = document.createElement("canvas");
    crowd.width = W;
    crowd.height = 120;
    const cg = crowd.getContext("2d")!;
    const r = rng(7);
    const palette = ["#f2c14e", "#e86a5b", "#4b8fd1", "#f6f1e3", "#7c5cbf", "#3aa17e", "#ef8fb4"];
    for (let i = 0; i < 1400; i++) {
      cg.fillStyle = palette[Math.floor(r() * palette.length)];
      cg.beginPath();
      cg.arc(r() * W, 20 + r() * 95, 2 + r() * 2.2, 0, Math.PI * 2);
      cg.fill();
    }

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      // Frames stall when the tab is hidden: freeze game time instead of letting the ball fly past.
      const gap = now - last;
      if (gap > 250) {
        const s = simRef.current;
        const pause = gap - 16;
        s.phaseStart += pause;
        s.releaseAt += pause;
        if (s.contact) s.contact.t += pause;
      }
      const dt = Math.min(0.05, gap / 1000);
      last = now;
      step(now, dt);
      draw(ctx, crowd, now);
      raf = requestAnimationFrame(loop);
    };

    const finishBall = (o: Outcome) => {
      const next = applyOutcome(innRef.current, o);
      innRef.current = next;
      setInn(next);
      setBanner({
        text: o.kind === "six" ? "SIX!" : o.kind === "four" ? "FOUR!" : o.wicket ? (o.kind === "bowled" ? "BOWLED!" : "OUT!") : o.runs ? `${o.runs} RUN${o.runs > 1 ? "S" : ""}` : "DOT BALL",
        tone: o.wicket ? "bad" : o.runs >= 4 ? "good" : "neutral",
      });
      setCommentary(o.text);
      if (o.runs >= 4) audioRef.current.crowd(o.runs === 6);
      if (o.wicket) audioRef.current.wicket();
      if (o.runs >= 4 || o.wicket) simRef.current.shake = 1;
      setSimPhase("result");
    };

    const step = (now: number, dt: number) => {
      const s = simRef.current;
      const el = (now - s.phaseStart) / 1000;
      const move = (s.keys.has("right") ? 1 : 0) - (s.keys.has("left") ? 1 : 0);
      if (s.phase === "ready" || s.phase === "runup" || (s.phase === "delivery" && !s.contact)) s.batterX = Math.max(-1.1, Math.min(1.2, s.batterX + move * 2.3 * dt));
      s.shake = Math.max(0, s.shake - dt * 2.5);
      if (s.phase === "ready" && el > 1.1) setSimPhase("runup");
      else if (s.phase === "runup" && el > 0.75) {
        s.releaseAt = now;
        setSimPhase("delivery");
      } else if (s.phase === "delivery" && s.delivery) {
        const t = (now - s.releaseAt) / 1000;
        if (s.contact && now - s.contact.t > 900) finishBall(s.outcome!);
        else if (!s.contact && t > s.delivery.flight + 0.28) {
          const o = s.outcome ?? resolveBall(s.delivery, null, s.batterX, "ground", diffRef.current, rngRef.current);
          finishBall(o);
        }
      } else if (s.phase === "result" && el > 1.7) {
        const res = inningsResult(innRef.current);
        if (res) {
          setSimPhase("over");
          const score = innRef.current.runs;
          try {
            const prev = Number(window.localStorage.getItem(BEST_KEY) ?? "0");
            if (score > prev) window.localStorage.setItem(BEST_KEY, String(score));
            setBest(Math.max(prev, score));
          } catch {
            /* ignore */
          }
          setCommentary(res === "won" ? `${teamRef.current} win the super over!` : res === "tied" ? "Scores level — it's a tie!" : `Fell short by ${innRef.current.target - 1 - innRef.current.runs} run${innRef.current.target - 1 - innRef.current.runs === 1 ? "" : "s"}.`);
        } else nextBall();
      }
    };

    const draw = (g: CanvasRenderingContext2D, crowdImg: HTMLCanvasElement, now: number) => {
      const s = simRef.current;
      const [primary, secondary] = teamColors(teamRef.current);
      g.save();
      if (s.shake > 0 && !reduced) g.translate((Math.random() - 0.5) * 8 * s.shake, (Math.random() - 0.5) * 6 * s.shake);
      // sky
      const sky = g.createLinearGradient(0, 0, 0, HORIZON);
      sky.addColorStop(0, "#8fd3f4");
      sky.addColorStop(1, "#d6f0f7");
      g.fillStyle = sky;
      g.fillRect(-10, -10, W + 20, HORIZON + 10);
      // floodlights
      g.fillStyle = "#2d4a33";
      for (const x of [90, 300, 660, 870]) {
        g.fillRect(x - 2, 30, 4, HORIZON - 70);
        g.fillRect(x - 22, 18, 44, 22);
        g.fillStyle = "#f6f1df";
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) g.fillRect(x - 19 + i * 10, 21 + j * 9, 7, 6);
        g.fillStyle = "#2d4a33";
      }
      // stands + crowd
      g.fillStyle = "#355e3b";
      g.fillRect(-10, HORIZON - 95, W + 20, 100);
      g.globalAlpha = 0.9;
      g.drawImage(crowdImg, 0, HORIZON - 108);
      g.globalAlpha = 1;
      g.fillStyle = "#24402a";
      g.fillRect(-10, HORIZON - 6, W + 20, 8);
      // outfield with stripes
      g.fillStyle = "#79b552";
      g.fillRect(-10, HORIZON, W + 20, H - HORIZON + 10);
      for (let i = -8; i < 9; i++) {
        const a = project(i * 4, 0, 0);
        const b = project(i * 4 + 2, 0, 0);
        const c = project(i * 4 + 2, 0, 120);
        const d = project(i * 4, 0, 120);
        g.fillStyle = "rgba(255,255,255,0.07)";
        g.beginPath();
        g.moveTo(a.sx, H + 200);
        g.lineTo(b.sx, H + 200);
        g.lineTo(c.sx, c.sy);
        g.lineTo(d.sx, d.sy);
        g.fill();
      }
      // pitch
      const pc = [project(-1.5, 0, -2), project(1.5, 0, -2), project(1.5, 0, 22), project(-1.5, 0, 22)];
      g.fillStyle = "#d9c08a";
      g.beginPath();
      pc.forEach((p, i) => (i ? g.lineTo(p.sx, p.sy) : g.moveTo(p.sx, p.sy)));
      g.fill();
      // creases
      g.strokeStyle = "#ffffff";
      for (const z of [1.2, 18.8]) {
        const a = project(-1.3, 0, z);
        const b = project(1.3, 0, z);
        g.lineWidth = Math.max(1, a.s * 0.05);
        g.beginPath();
        g.moveTo(a.sx, a.sy);
        g.lineTo(b.sx, b.sy);
        g.stroke();
      }
      // target ring
      if (s.delivery && (s.phase === "ready" || s.phase === "runup" || s.phase === "delivery")) {
        const c = project(s.delivery.ringX, 0, s.delivery.ringZ);
        g.strokeStyle = "rgba(255,255,255,0.95)";
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(c.sx, c.sy, 0.38 * c.s, 0.12 * c.s, 0, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = "rgba(255,255,255,0.18)";
        g.fill();
      }
      // far stumps + bowler
      drawStumps(g, 0, 20, false);
      if (s.phase === "ready" || s.phase === "runup" || s.phase === "delivery") {
        const el = (now - s.phaseStart) / 1000;
        const bz = s.phase === "ready" ? 27 : s.phase === "runup" ? 27 - Math.min(1, el / 0.75) * 6.5 : 20.3;
        drawPerson(g, 0.35, bz, "#f4f6fb", secondaryFor(primary), s.phase === "delivery" ? 1 : 0);
      }
      // fielders
      for (const [fx, fz] of [[-9, 12], [10, 9], [-14, 28], [15, 30], [2, 40], [-4, -3], [1.2, -4.5]] as const) drawPerson(g, fx, fz, "#f4f6fb", secondaryFor(primary), 0, 0.7);
      // near stumps (behind batter)
      const bowled = s.outcome?.kind === "bowled" && s.phase === "result";
      drawStumps(g, 0, 0.6, bowled);
      // ball before contact
      let ball: { x: number; y: number; z: number } | null = null;
      if (s.delivery && s.phase === "delivery" && !s.contact) ball = ballAt(s.delivery, (now - s.releaseAt) / 1000);
      if (ball && ball.z > 0.9) drawBall(g, ball);
      // batter
      const swingEl = s.swing ? (now - s.releaseAt) / 1000 - s.swing.at : -1;
      drawBatter(g, s.batterX, primary, secondary, swingEl);
      if (ball && ball.z <= 0.9) drawBall(g, ball);
      // shot flight
      if (s.contact && s.outcome) {
        const k = Math.min(1, (now - s.contact.t) / 900);
        const o = s.outcome;
        const dist = o.kind === "six" ? 80 : o.kind === "four" ? 68 : o.kind === "caught" ? 38 : o.kind === "edge" ? 4 : 15 + o.quality * 30;
        const behind = o.kind === "edge" || (o.kind === "caught" && o.quality < 0.42 && o.angle > 0);
        const ang = (o.angle * Math.PI) / 180;
        // Arc heights tuned to stay inside the camera view (a six still clears the rope into the stands).
        const hMax = o.kind === "six" ? 11 : o.kind === "caught" ? 8 : o.runs === 4 && s.swing?.kind === "loft" ? 6 : 1.2;
        const pos = (kk: number) => {
          const D = dist * (reduced ? 1 : easeOut(kk));
          return {
            x: s.contact!.x + Math.sin(ang) * D,
            z: behind ? s.contact!.z - D * 0.4 : s.contact!.z + Math.cos(ang) * D,
            y: 0.3 + hMax * Math.sin(Math.PI * Math.min(1, kk * (o.kind === "six" ? 0.8 : 1))),
          };
        };
        // Fading trail so the shot stays readable at distance.
        if (!reduced) {
          for (let i = 6; i >= 1; i--) {
            const p = pos(Math.max(0, k - i * 0.035));
            const q = project(p.x, p.y, p.z);
            g.fillStyle = `rgba(255,255,255,${0.5 - i * 0.07})`;
            g.beginPath();
            g.arc(q.sx, q.sy, Math.max(2, 4.5 - i * 0.4), 0, Math.PI * 2);
            g.fill();
          }
        }
        drawBall(g, pos(k), true);
      }
      g.restore();
      // radar (top-right)
      drawRadar(g, s);
    };

    const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
    const secondaryFor = (c: string) => c;

    const drawStumps = (g: CanvasRenderingContext2D, x: number, z: number, broken: boolean) => {
      for (const dx of [-0.11, 0, 0.11]) {
        const base = project(x + dx, 0, z);
        const top = project(x + dx + (broken ? dx * 3 + 0.08 : 0), 0.71, z + (broken ? 0.4 : 0));
        g.strokeStyle = "#f6f1e3";
        g.lineWidth = Math.max(1.5, base.s * 0.04);
        g.beginPath();
        g.moveTo(base.sx, base.sy);
        g.lineTo(top.sx, top.sy);
        g.stroke();
      }
    };

    const drawPerson = (g: CanvasRenderingContext2D, x: number, z: number, kit: string, accent: string, armUp: number, scale = 1) => {
      const feet = project(x, 0, z);
      const head = project(x, 1.75 * scale, z);
      const h = feet.sy - head.sy;
      const w = Math.max(2, h * 0.28);
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.beginPath();
      g.ellipse(feet.sx, feet.sy, w * 0.9, w * 0.25, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = kit;
      g.fillRect(feet.sx - w * 0.45, head.sy + h * 0.5, w * 0.35, h * 0.5);
      g.fillRect(feet.sx + w * 0.1, head.sy + h * 0.5, w * 0.35, h * 0.5);
      g.fillStyle = accent;
      g.fillRect(feet.sx - w / 2, head.sy + h * 0.18, w, h * 0.36);
      if (armUp) {
        g.fillRect(feet.sx + w * 0.3, head.sy - h * 0.1, w * 0.22, h * 0.32);
      }
      g.fillStyle = "#f0c9a2";
      g.beginPath();
      g.arc(feet.sx, head.sy + h * 0.09, Math.max(1.5, w * 0.32), 0, Math.PI * 2);
      g.fill();
    };

    const drawBall = (g: CanvasRenderingContext2D, b: { x: number; y: number; z: number }, hit = false) => {
      const shadow = project(b.x, 0, b.z);
      const p = project(b.x, b.y, b.z);
      const r = Math.max(hit ? 5 : 3, 0.075 * p.s);
      if (hit) {
        g.strokeStyle = "rgba(255,255,255,0.9)";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(p.sx, p.sy, r + 1.5, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = "rgba(0,0,0,0.22)";
      g.beginPath();
      g.ellipse(shadow.sx, shadow.sy, r * 1.1, r * 0.35, 0, 0, Math.PI * 2);
      g.fill();
      const grad = g.createRadialGradient(p.sx - r * 0.3, p.sy - r * 0.3, r * 0.1, p.sx, p.sy, r);
      grad.addColorStop(0, "#ff9a6b");
      grad.addColorStop(1, "#b8361a");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(p.sx, p.sy, r, 0, Math.PI * 2);
      g.fill();
    };

    const drawBatter = (g: CanvasRenderingContext2D, x: number, primary: string, secondary: string, swingEl: number) => {
      const z = -0.6;
      const feet = project(x - 0.25, 0, z);
      const head = project(x - 0.25, 1.78, z);
      const h = feet.sy - head.sy;
      const w = h * 0.3;
      const cx = feet.sx;
      g.fillStyle = "rgba(0,0,0,0.22)";
      g.beginPath();
      g.ellipse(cx, feet.sy, w, w * 0.22, 0, 0, Math.PI * 2);
      g.fill();
      // pads
      g.fillStyle = "#f4f6fb";
      g.strokeStyle = "#c9d3e6";
      g.lineWidth = 2;
      for (const dx of [-0.42, 0.08]) {
        g.beginPath();
        g.roundRect(cx + dx * w, head.sy + h * 0.52, w * 0.34, h * 0.48, 6);
        g.fill();
        g.stroke();
      }
      // torso
      g.fillStyle = primary;
      g.beginPath();
      g.roundRect(cx - w * 0.5, head.sy + h * 0.2, w, h * 0.36, 10);
      g.fill();
      g.fillStyle = secondary;
      g.fillRect(cx - w * 0.5, head.sy + h * 0.38, w, h * 0.04);
      // helmet
      g.fillStyle = primary;
      g.beginPath();
      g.arc(cx, head.sy + h * 0.1, w * 0.3, Math.PI, 0);
      g.fill();
      g.fillStyle = "#1d1a14";
      g.fillRect(cx - w * 0.3, head.sy + h * 0.1, w * 0.6, h * 0.06);
      // bat: resting → swing arc
      const k = swingEl < 0 ? 0 : Math.min(1, swingEl / 0.22);
      const angle = -2.2 + k * 3.4; // radians
      const px = cx + w * 0.45;
      const py = head.sy + h * 0.4;
      g.save();
      g.translate(px, py);
      g.rotate(angle);
      g.fillStyle = "#e2c08d";
      g.fillRect(-w * 0.07, 0, w * 0.14, h * 0.5);
      g.fillStyle = "#3b2a1a";
      g.fillRect(-w * 0.04, -h * 0.08, w * 0.08, h * 0.1);
      g.restore();
    };

    const drawRadar = (g: CanvasRenderingContext2D, s: Sim) => {
      const R = 52;
      const cx = W - R - 16;
      const cy = R + 16;
      g.fillStyle = "rgba(20,40,20,0.55)";
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.6)";
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = "#d9c08a";
      g.fillRect(cx - 2, cy - 9, 4, 18);
      if (s.outcome && s.contact) {
        const o = s.outcome;
        const len = o.kind === "six" || o.kind === "four" ? R : o.kind === "edge" ? 8 : Math.max(10, o.quality * R * 0.8);
        const a = (o.angle * Math.PI) / 180;
        const bx = cx + Math.sin(a) * len;
        const by = cy + 6 - Math.cos(a) * len * (o.kind === "edge" ? -1 : 1);
        g.strokeStyle = o.wicket ? "#ff8a80" : "#ffe08a";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cx, cy + 6);
        g.lineTo(bx, by);
        g.stroke();
        g.fillStyle = "#fff";
        g.beginPath();
        g.arc(bx, by, 3, 0, Math.PI * 2);
        g.fill();
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [nextBall, setSimPhase, reduced]);

  const hold = (dir: "left" | "right", on: boolean) => {
    if (on) simRef.current.keys.add(dir);
    else simRef.current.keys.delete(dir);
  };

  const [p1, p2] = teamColors(team);
  const result = phase === "over" ? inningsResult(inn) : null;
  const needed = Math.max(0, inn.target - inn.runs);

  return (
    <div className="mx-auto max-w-5xl">
      <div ref={frameRef} className="relative scroll-mt-20 overflow-hidden rounded-3xl border border-line bg-[#0b1530] shadow-lg">
        {/* HUD */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0b1530] px-4 py-2 text-white">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full font-display text-[11px]" style={{ background: p1, color: "#fff" }}>{teamAbbr(team)}</span>
            <div className="leading-tight">
              <p className="font-display text-xl">
                {inn.runs}/{inn.wickets}
              </p>
              <p className="text-[11px] text-[#b9cbff]">
                {inn.balls}/{inn.maxBalls} balls
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5" aria-label={`Balls: ${inn.log.map((o) => (o.wicket ? "W" : o.runs)).join(", ") || "none yet"}`}>
            {Array.from({ length: inn.maxBalls }).map((_, i) => {
              const o = inn.log[i];
              return (
                <span key={i} className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${!o ? "border border-white/40" : o.wicket ? "bg-[#e5484d]" : o.runs >= 4 ? "bg-[#f5c542] text-ink" : "bg-white/85 text-ink"}`}>
                  {o ? (o.wicket ? "W" : o.runs) : ""}
                </span>
              );
            })}
          </div>
          <div className="text-right leading-tight">
            <p className="font-display text-xl">{phase === "menu" ? "—" : `Need ${needed}`}</p>
            <p className="text-[11px] text-[#b9cbff]">vs {teamAbbr(opponent)} · target {inn.target}</p>
          </div>
        </div>

        <div className="relative">
          <canvas ref={canvasRef} className="block aspect-video w-full touch-none" aria-label="Super Over batting game view" role="img" onPointerDown={() => swing("ground")} />
          {banner && phase === "result" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <p className={`rounded-2xl px-6 py-2 font-display text-5xl text-white shadow-xl sm:text-7xl ${banner.tone === "good" ? "bg-[#c2410c]/90" : banner.tone === "bad" ? "bg-[#9f1239]/90" : "bg-[#0b1530]/80"}`}>{banner.text}</p>
            </div>
          )}
          {phase === "ready" && (
            <p className="pointer-events-none absolute inset-x-0 top-4 text-center font-display text-lg text-white [text-shadow:0_2px_6px_rgba(0,0,0,0.7)] sm:text-2xl">
              BALL {inn.balls + 1}/{inn.maxBalls} — GET READY TO BAT!
            </p>
          )}

          {(phase === "menu" || phase === "over") && (
            <div className="absolute inset-0 grid place-items-center bg-[#0b1530]/75 p-4 backdrop-blur-[2px]">
              <div className="w-full max-w-md rounded-3xl bg-paper p-5 text-ink shadow-2xl">
                {phase === "over" ? (
                  <>
                    <p className="label-xs text-muted">Result</p>
                    <h2 className="font-display text-3xl">{result === "won" ? "You won the super over!" : result === "tied" ? "It's a tie!" : "Not this time"}</h2>
                    <p className="mt-1 text-sm">
                      {teamAbbr(team)} {inn.runs}/{inn.wickets} in {inn.balls} balls · target {inn.target}
                      {best != null && <> · your best {best}</>}
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="font-display text-3xl">Super Over</h2>
                    <p className="mt-1 text-sm text-muted">Bat one over, chase the target, don&apos;t lose two wickets.</p>
                  </>
                )}
                <label className="mt-4 block text-sm font-medium">
                  Your team
                  <select value={team} onChange={(e) => setTeam(e.target.value)} className="mt-1 w-full rounded-full border border-line bg-white px-3 py-2">
                    {TEAMS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <fieldset className="mt-3">
                  <legend className="text-sm font-medium">Difficulty</legend>
                  <div className="mt-1 flex gap-2">
                    {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
                      <button key={d} type="button" onClick={() => setDifficulty(d)} aria-pressed={difficulty === d} className={`chip px-3 py-1.5 text-sm capitalize ${difficulty === d ? "bg-ink text-white" : "bg-cream"}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <button type="button" onClick={start} className="btn btn-primary mt-5 w-full justify-center py-3 text-base" autoFocus>
                  {phase === "over" ? "Play again" : "Start"}
                </button>
                <p className="mt-3 text-xs text-muted">
                  ← → or A / D to move · <strong>Space</strong> ground shot · <strong>L</strong> lofted shot. Hit when the ball reaches you; early pulls to leg, late steers to off.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* touch controls */}
        <div className="grid grid-cols-4 gap-2 bg-[#0b1530] p-3">
          {(["left", "right"] as const).map((d) => (
            <button
              key={d}
              type="button"
              className="rounded-2xl bg-white/10 py-3 font-semibold text-white active:bg-white/25"
              onPointerDown={() => hold(d, true)}
              onPointerUp={() => hold(d, false)}
              onPointerLeave={() => hold(d, false)}
              aria-label={d === "left" ? "Move left (hold)" : "Move right (hold)"}
            >
              {d === "left" ? "◀ Move" : "Move ▶"}
            </button>
          ))}
          <button type="button" className="rounded-2xl py-3 font-semibold text-white" style={{ background: p2 === "#111111" ? "#334155" : "#1d4ed8" }} onClick={() => swing("ground")}>
            Hit (Space)
          </button>
          <button type="button" className="rounded-2xl bg-[#c2410c] py-3 font-semibold text-white" onClick={() => swing("loft")}>
            Loft (L)
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p role="status" aria-live="polite" className="min-h-[1.5rem] flex-1">
          {commentary}
        </p>
        <button type="button" className="btn btn-soft" onClick={() => setSound((v) => !v)} aria-pressed={sound}>
          Sound {sound ? "on" : "off"}
        </button>
      </div>
    </div>
  );
}
