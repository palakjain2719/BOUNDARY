# Architecture

```
            ┌──────────── scheduler (Vercel Cron / GitHub Actions / npm run pipeline:daemon) ────────────┐
            ▼                                                                                            │
 /api/cron/pipeline ─► runTick() ─► discover_fixtures ─► refresh_status ─► prepare_analysis ─► collect_actuals
                                                                   │                                 │
                                                                   ▼                                 ▼
                                    workspace ─► features ─► model ─► optimizer ─► validator     evaluate_matches
                                         │                                │           │              │
                                         ▼                                ▼           ▼              ▼
                                   frozen Snapshot  ◄──────────── Recommendation + explanation   detect_patterns
                                         │                                                           │
                                         ▼                                                           ▼
                                  PreparedAnalysis (versioned) ──► dashboard (freshness check)   improve_models ─► gated activation
                                                                                                     (rollback kept)
```

Every job run is recorded (`job_runs`) with an idempotency key, retried once on failure, and isolated: a failing provider or notification service doesn't block the other jobs. A state-based lock prevents overlapping ticks.

## Layers (`src/lib`)

| Module | Responsibility |
|---|---|
| `data/cricsheet.ts`, `scripts/ingest-cricsheet.ts` | Cricsheet JSON → per-player event stats (Super Overs excluded), match metadata; Kaggle labels with high-confidence identity mapping only |
| `data/historical.ts` | Read-only processed data, indexed per competition (IPL and WPL never mixed) |
| `data/roles.ts`, `data/normalize.ts` | Role inference from earlier matches; team/venue canonicalisation |
| `scoring/` | Versioned rules configs (JSON + zod), deterministic calculator with line items, team scorer (multipliers applied once) |
| `features/history.ts` | Leakage-safe pre-match features (strictly earlier dates), allowlist + forbidden patterns |
| `models/` | Recency baseline, Ridge (served from exported coefficients), weighted-criteria model, registry + activations |
| `optimizer/` | Team rules configs, deterministic validator, exact branch-and-bound joint (XI, C, VC) solver with correction loop, reasoning |
| `match/workspace.ts` | Clock-aware match resolution, pool, phase gating (toss/XI only post-toss), predictions, immutable snapshots |
| `match/view.ts` | Dashboard view model: loads the latest **prepared** analysis (no recompute) + freshness |
| `match/actions.ts` | Shared recommendation builder (pipeline and on-demand), user team save, actuals, review |
| `pipeline/` | Clock (real/simulated), jobs + orchestrator, freshness check |
| `evaluation/evaluate.ts` | Team and pool evaluation (MAE, RMSE, bias, coverage, Spearman, C/VC error), attribution only when data supports it |
| `learning/loop.ts`, `learning/weights.ts` | Patterns with minimum support, proposals, chronological backtests, release gates, accept/reject/rollback; weight profiles |
| `providers/` | `CricketDataProvider` interface, Cricsheet replay, CricAPI adapter, Open-Meteo weather, CSV import |
| `notifications/` | Reminder scheduling (idempotency key), processing with retries and dead-letter, demo outbox / Resend / Twilio |
| `ai/gemini.ts` | Gemini Flash REST adapter; phrases evidence only; deterministic fallback |
| `store/` | `Repository` interface; `LocalRepository` (demo JSON file) and `SupabaseRepository` (user JWT for RLS, service role for system rows) |

## Chronology and leakage rules

- Features for a match use only matches on **strictly earlier dates** (same-day matches excluded: no reliable start times).
- Toss and announced XI exist only in `post_toss` snapshots, created after the (simulated or real) toss time.
- Kaggle `Dream Team`/`Captain`/`Vice Captain` flags, `Total_FP` and same-match stats are never features (allowlist test in TS and Python).
- Evaluation always uses the last analysis prepared **before** the start time. Later versions can't replace it.
- Under the simulated clock, archived matches on or after the simulated date are hidden, and observed weather is withheld.

## Model windows

| Window | IPL | WPL |
|---|---|---|
| fit (weights) | 2016–2019 (Kaggle labels) | 2022/23 (reconstructed) |
| calibrate (patterns, profile comparison) | 2020–2021 | 2023/24–2024/25 |
| evaluate (release gate) | 2022–2023 | 2025/26 |
| recent (no-regression gate) | last 120 days before the pipeline clock, reconstructed | same |

## Screens

`/` landing · `/matches` catalogue (live/upcoming/completed, suitability ranking, per-match themes) · `/matches/[id]` dashboard (context rail, optimizer XI on a field, builder, projections, reasoning, versions) · `/matches/[id]/players/[playerId]` · `/matches/[id]/review` · `/history` · `/learning` · `/learning/weights` · `/settings` · `/how-it-works` · `/login`.
