import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Components map", description: "Every part of BOUNDARY, what it does, and how the parts connect." };

const GH = "https://github.com/palakjain2719/BOUNDARY/blob/main/";

interface Comp {
  name: string;
  does: string;
  file?: string;
  href?: string;
}
interface Layer {
  title: string;
  tone: string;
  note: string;
  items: Comp[];
}

const LAYERS: Layer[] = [
  {
    title: "1 · Screens (what Aryan sees)",
    tone: "bg-pastel-yellow",
    note: "Next.js 15 App Router pages, React 19, Tailwind. Public, no sign-up: each browser gets a private anonymous session.",
    items: [
      { name: "Home", does: "Landing page with the match-day loop and headline data counts.", file: "src/app/page.tsx", href: "/" },
      { name: "Demo", does: "Treat a 2026 match as live: pick XI + C/VC, type Dream11 points, get a verdict.", file: "src/app/demo/page.tsx", href: "/demo" },
      { name: "Matches", does: "Upcoming and archived IPL / WPL fixtures, ranked by how well the model can analyse them.", file: "src/app/matches/page.tsx", href: "/matches" },
      { name: "Match workspace", does: "Optimizer XI with reasons, team builder with live rule checks, player projections, context (venue, toss, weather).", file: "src/app/matches/[id]/page.tsx" },
      { name: "Post-match review", does: "Enter actual points; predicted vs actual for both teams; takeaways and verdict.", file: "src/app/matches/[id]/review/page.tsx" },
      { name: "Performance", does: "Measured accuracy (live, replay, offline benchmark), error patterns, tested model changes.", file: "src/app/learning/page.tsx", href: "/learning" },
      { name: "Model weights", does: "Inspect and backtest the weighted-criteria model; propose weight changes.", file: "src/app/learning/weights/page.tsx", href: "/learning/weights" },
      { name: "My Teams · Settings · Play", does: "Saved teams history, integration status and reminders, super-over mini game.", file: "src/app/settings/page.tsx", href: "/settings" },
    ],
  },
  {
    title: "2 · API routes (server)",
    tone: "bg-pastel-blue",
    note: "Next.js route handlers on Vercel serverless functions. Every route resolves the viewer and uses row-level security.",
    items: [
      { name: "/api/matches/[id]/optimize", does: "Builds the snapshot, predicts, runs the optimizer and validator, stores the recommendation.", file: "src/app/api/matches/[id]/optimize/route.ts" },
      { name: "/api/matches/[id]/teams", does: "Validates and saves the user's XI + C/VC as an immutable version.", file: "src/app/api/matches/[id]/teams/route.ts" },
      { name: "/api/matches/[id]/actuals", does: "Stores Aryan's typed Dream11 points (append-only, latest wins).", file: "src/app/api/matches/[id]/actuals/route.ts" },
      { name: "/api/matches/[id]/review", does: "Evaluates predicted vs actual for both teams.", file: "src/app/api/matches/[id]/review/route.ts" },
      { name: "/api/learning · /api/weights", does: "Error patterns, proposals, backtests, approve / rollback.", file: "src/app/api/learning/route.ts" },
      { name: "/api/cron/pipeline", does: "Entry point for the scheduled background pipeline.", file: "src/app/api/cron/pipeline/route.ts" },
      { name: "/api/health", does: "Live status of Supabase, Gemini, data providers and weather.", file: "src/app/api/health/route.ts", href: "/api/health" },
    ],
  },
  {
    title: "3 · Core logic (deterministic, tested)",
    tone: "bg-pastel-green",
    note: "Pure TypeScript in src/lib. No LLM decides validity or scores; Gemini only phrases the evidence.",
    items: [
      { name: "Scoring rules + calculator", does: "Versioned Dream11 points rules (official T20 2026 default); every point is a line item with evidence.", file: "src/lib/scoring/calculator.ts" },
      { name: "Leakage-safe features", does: "Form, venue, opponent, role features from strictly earlier matches only.", file: "src/lib/features/history.ts" },
      { name: "Prediction models", does: "Ridge regression (served), recency baseline, weighted criteria; registry with activations and rollback.", file: "src/lib/models/registry.ts" },
      { name: "Optimizer", does: "Exact branch-and-bound search for the best XI + captain + vice-captain under credits, roles and team limits.", file: "src/lib/optimizer/solve.ts" },
      { name: "Validator", does: "Checks every Dream11 rule; failed lineups are forbidden and re-solved.", file: "src/lib/optimizer/validate.ts" },
      { name: "Evaluation", does: "MAE, bias, rank correlation, interval coverage, captain error, per-player attribution.", file: "src/lib/evaluation/evaluate.ts" },
      { name: "Learning loop", does: "Finds consistent errors (n ≥ 30, |t| ≥ 2), proposes weight changes, promotes only if backtests pass.", file: "src/lib/learning/loop.ts" },
    ],
  },
  {
    title: "4 · Background pipeline (runs without anyone logged in)",
    tone: "bg-pastel-lilac",
    note: "Vercel Cron + GitHub Actions call one tick; each job is idempotent, retried, and locked against overlap.",
    items: [
      { name: "discover_fixtures → refresh_status", does: "Finds upcoming IPL / WPL matches and tracks toss / live / completed.", file: "src/lib/pipeline/jobs.ts" },
      { name: "prepare_analysis", does: "Prepares predictions and the optimizer team before anyone opens the match.", file: "src/lib/pipeline/jobs.ts" },
      { name: "collect_actuals → evaluate_matches", does: "Collects results after the match and scores the frozen prediction.", file: "src/lib/pipeline/jobs.ts" },
      { name: "detect_patterns → improve_models", does: "Turns repeated errors into tested, gated model updates.", file: "src/lib/pipeline/jobs.ts" },
      { name: "send_reminders", does: "Match-day reminders (email / SMS when configured).", file: "src/lib/notifications/index.ts" },
    ],
  },
  {
    title: "5 · External services and data",
    tone: "bg-pastel-orange",
    note: "Free sources only for cricket data; Gemini Flash is the only LLM (no Claude API).",
    items: [
      { name: "Supabase (Postgres + Auth)", does: "All teams, points, predictions, evaluations and model history in a dedicated `boundary` schema with row-level security.", file: "supabase/migrations/20261011000000_init.sql" },
      { name: "Gemini Flash", does: "Turns the optimizer's evidence into plain-English captain / VC reasons. Capped per day, with a template fallback.", file: "src/lib/ai/gemini.ts" },
      { name: "Cricsheet", does: "Ball-by-ball history: 1,243 IPL and 88 WPL matches (2008 → May 2026).", file: "scripts/ingest-cricsheet.ts" },
      { name: "Kaggle Dream11 labels", does: "Real Dream11 points 2008–2023 used to benchmark the model.", file: "scripts/reconcile-kaggle.ts" },
      { name: "Wikipedia + ESPNcricinfo RSS", does: "Live fixture detection and live-score status at zero cost.", file: "src/lib/providers/free-sources.ts" },
      { name: "Open-Meteo", does: "Match-time weather (context only).", file: "src/lib/providers/weather.ts" },
      { name: "Vercel + GitHub", does: "Hosting, serverless functions, cron; every push to main deploys.", href: "https://github.com/palakjain2719/BOUNDARY" },
    ],
  },
];

const FLOW = [
  ["Discover", "Pipeline finds the match from free live sources"],
  ["Prepare", "Features from earlier matches → model predicts each player"],
  ["Optimize", "Best valid XI + C/VC under 100 credits; validator checks rules"],
  ["Explain", "Gemini Flash phrases the reasons from evidence"],
  ["Pick", "Aryan builds or compares his own XI (auto-saved to Supabase)"],
  ["Score", "Aryan types actual Dream11 points after the match"],
  ["Evaluate", "Predicted vs actual for both teams; errors stored"],
  ["Improve", "Consistent errors → weight changes, promoted only if backtests pass"],
];

export default function ComponentsMapPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 pb-12 sm:px-6">
      <header>
        <h1 className="font-display text-4xl sm:text-5xl">Components map</h1>
        <p className="mt-2 max-w-3xl text-muted">Every part of BOUNDARY, what it does, and how the parts connect. Each card links to its source file on GitHub.</p>
      </header>

      <section className="mt-6 rounded-3xl bg-ink p-5 text-white" aria-labelledby="flow">
        <h2 id="flow" className="font-display text-2xl">
          Match-day flow
        </h2>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map(([t, d], i) => (
            <li key={t} className="relative rounded-2xl bg-white/10 p-3">
              <span className="text-xs text-white/60">Step {i + 1}</span>
              <p className="font-semibold">{t}</p>
              <p className="text-sm text-white/80">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-6 space-y-2">
        {LAYERS.map((l, i) => (
          <div key={l.title}>
            <section className={`rounded-3xl p-5 ${l.tone}`} aria-labelledby={`layer-${i}`}>
              <h2 id={`layer-${i}`} className="font-display text-2xl">
                {l.title}
              </h2>
              <p className="mt-1 text-sm">{l.note}</p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {l.items.map((c) => (
                  <li key={c.name} className="flex flex-col rounded-2xl bg-white/85 p-3">
                    <p className="font-semibold">{c.name}</p>
                    <p className="mt-1 flex-1 text-sm text-muted">{c.does}</p>
                    <p className="mt-2 flex flex-wrap gap-x-3 text-xs">
                      {c.href && (
                        <Link className="font-semibold underline" href={c.href}>
                          Open
                        </Link>
                      )}
                      {c.file && (
                        <a className="underline" href={`${GH}${c.file}`} target="_blank" rel="noreferrer">
                          {c.file.split("/").slice(-2).join("/")}
                        </a>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
            {i < LAYERS.length - 1 && (
              <p className="py-1 text-center text-2xl text-muted" aria-hidden>
                ↓ ↑
              </p>
            )}
          </div>
        ))}
      </div>

      <section className="card mt-6 p-5 text-sm">
        <h2 className="font-semibold">Guarantees built into the design</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>No post-match leakage: predictions use only matches on earlier dates; toss and XI only after the toss.</li>
          <li>Every saved team, prediction and typed point is immutable and versioned; corrections append, never overwrite.</li>
          <li>Model changes are promoted only when chronological backtests pass, and every change can be rolled back.</li>
          <li>IPL and WPL data are never mixed; WPL points are labelled reconstructed and unverified.</li>
        </ul>
      </section>
    </div>
  );
}
