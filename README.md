# BOUNDARY — Fantasy Cricket Match Optimizer

An autonomous match-day intelligence app for men's IPL and women's WPL. A background pipeline discovers fixtures, ranks them by data suitability, prepares player projections and an optimizer XI with captain/vice-captain, validates it deterministically, explains it, collects actual results, evaluates the frozen predictions and tests model improvements behind release gates. The dashboard is for reviewing prepared intelligence, not for triggering each step.

> `BOUNDARY` is a placeholder brand (`NEXT_PUBLIC_BRAND_NAME`).

## Status at a glance

| Area | State |
|---|---|
| Historical ingestion (Cricsheet IPL 1,243 / WPL 88 matches, Kaggle Dream11 IPL labels 1,024 matches) | **Working**, audited (`data/processed/manifest.json`) |
| Versioned scoring calculator with line-item audit | **Working**. Legacy config reproduces **96.85%** of 20,917 Kaggle totals exactly (MAE 0.205). Both configs are `draft` — none verified against the official Dream11 page (it returned HTTP 502 on 2026-10-11). |
| Model benchmark (baseline, Ridge, RF, HistGB; chronological) | **Working, measured, weak**: Ridge test MAE 26.46 vs 26.89 train-mean (1.57% better, R² 0.022). |
| Background pipeline (discover → prepare → collect → evaluate → patterns → gated promotion → reminders) | **Working** with the simulated replay clock; real-time mode needs a provider key. |
| Optimizer (exact joint XI + C + VC, correction loop) | **Working**; validated against brute force in tests. |
| Supabase schema, RLS, immutability | Migration **tested on PGlite** (Postgres in WASM). Not yet run against a live Supabase project. |
| Supabase repository / auth | Implemented; **untested without credentials**. Demo mode uses a local JSON store. |
| Gemini explanations | Implemented; **needs `GEMINI_API_KEY` + `GEMINI_MODEL`**. Falls back to a deterministic evidence template. |
| Live fixtures (CricAPI adapter) | Implemented; **unverified without a key**. CSV import works today. |
| Weather (Open-Meteo, keyless) | **Working** for curated venues. Hidden under the simulated clock to avoid leaking observed weather. |
| Email/SMS reminders | Scheduling, idempotency, retries, dead-letter **working**; real sending needs Resend/Twilio keys + `NOTIFICATIONS_LIVE=true`. |

## Quick start (demo mode, no credentials)

```bash
npm install
```

```bash
npm run pipeline:tick -- --advance-hours 36
```

```bash
npm run dev
```

Open http://localhost:3000. Without credentials you are the single demo user “Aryan (demo)”, data lives in `.data/demo-store.json`, and a purple banner shows the **simulated replay clock**: archived Cricsheet fixtures are replayed as if live; the XI and toss appear only at the simulated toss time and results only after the simulated match ends. Advance the clock from **Settings → Background pipeline**, or run the local scheduler:

```bash
npm run pipeline:daemon
```

The processed data in `data/processed/` is included, so you don't need the raw archives to run the app.

## Rebuilding data and models

Put the raw archives in `data/raw/` (gitignored): `ipl_json/`, `wpl_json/`, `kaggle_ipl/` (the five Kaggle CSVs) and `training_v3/` (the supplied training package, for the player identity mapping). Then:

```bash
python3 -m venv .venv && .venv/bin/pip install pandas scikit-learn scipy
```

```bash
npm run data:build
```

`data:build` = `data:ingest` (Cricsheet → event stats, Kaggle labels) → `data:reconcile` (calculator vs Kaggle) → `data:features` (leakage-safe feature matrix) → `ml:benchmark` (chronological benchmark, writes `src/lib/models/artifacts/ridge-ipl-v1.json` and `docs/MODEL_BENCHMARK.md`).

## Tests

```bash
npm test
```

```bash
npm run ml:test
```

```bash
npm run lint && npm run typecheck && npm run build
```

`npm test` runs 70 Vitest tests: scoring rules and edge cases, rules versioning, Cricsheet ingestion edge cases (Super Overs, wides, all-run fours, maidens, substitutes), optimizer constraints and brute-force optimality, temporal leakage guards, reminder idempotency, immutability, RLS on the real migration (PGlite), and the **12-step end-to-end acceptance test** (`tests/acceptance.test.ts`).

## Environment variables

See [`.env.example`](.env.example). Summary:

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Persistent storage, auth, RLS (all three leave demo mode) |
| `ADMIN_USER_IDS` | Who may run pipeline/learning/import admin actions in Supabase mode |
| `CRON_SECRET` | Scheduler endpoint `/api/cron/pipeline` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini Flash explanations |
| `CRICKET_PROVIDER=cricapi`, `CRICAPI_KEY` | Live fixture discovery (switches the clock to real time) |
| `NOTIFICATIONS_LIVE`, `RESEND_API_KEY`, `NOTIFICATION_EMAIL_FROM`, `TWILIO_*` | Real email/SMS reminders |
| `PIPELINE_CLOCK`, `DEMO_SIM_START`, `SIM_AUTO_ADVANCE_MINUTES` | Clock mode and simulation |

## Docs

- [Architecture and component map](docs/ARCHITECTURE.md)
- [Deployment (Supabase + Vercel)](docs/DEPLOYMENT.md)
- [Data, scoring rules and coverage notes](docs/DATA_AND_COVERAGE.md)
- [Model benchmark (generated)](docs/MODEL_BENCHMARK.md)
