# Data, scoring rules and coverage

## Sources

| Source | Coverage | Use |
|---|---|---|
| Cricsheet `ipl_male_json` | 1,243 men's IPL matches, 2008-04-18 → 2026-05-31; 27,909 player-match rows; 16 with Super Overs | Events, XIs, substitutes, toss (post-toss only), results (post-match only) |
| Cricsheet `wpl_json` | 88 WPL matches, 2023-03-04 → 2026-02-05; 1,937 player-match rows; 1 with Super Overs | Same, separate competition |
| Kaggle Dream11 IPL dataset | 1,024 matches, 2008–2023; 22,362 rows, 154 substitute placeholders excluded; 20,917 mapped with high confidence, 1,291 not used | Fantasy-point **labels** (targets), retrospective Dream Team/C/VC flags (never features) |
| Open-Meteo | Curated venue coordinates only | Weather context (never a model input) |

Ingestion differs slightly from the supplied package (e.g. 1,937 vs 1,941 WPL rows): substitute fielders are not credited as players, and only ball-by-ball participants or listed players are counted.

## Scoring rules

Both configs live in `src/lib/scoring/rules/` and are validated with zod plus a band-overlap check. **Neither is `verified`.** The official page (https://www.dream11.com/fantasy-cricket/point-system) returned HTTP 502 when checked on 2026-10-11.

- `kaggle-ipl-legacy-inferred` v1.1.0 (`draft`): reverse-engineered from Kaggle component arithmetic. 4-point participation (once), run 1, four +1, six +2, 30/50/100 bonuses (highest only), duck −2 (bowlers exempt), wicket 25, LBW/bowled +8, 3/4/5-wicket +4/+8/+16 (highest only), maiden 12, catch 8, 3-catch +4, stumping 12, run-out 12/6, strike-rate and economy bands. Reproduces **96.85%** of 20,917 Kaggle totals exactly (MAE 0.205). Residual mismatches come from inferred roles, the run-out convention and fielding attribution. Full report: `data/processed/reconciliation_kaggle-ipl-legacy-inferred.json`.
- `dream11-t20-modern-draft` v0.1.0 (`draft`): post-2023 values from secondary recollection. **Unverified.** It reproduces only 12.6% of the 2008–2023 labels, which confirms those labels follow the legacy rules.
- Run-outs: Cricsheet doesn't mark direct hits. One named fielder = direct; two or more = each non-direct.
- Super Overs are excluded from all fantasy stats.
- Default reconstruction config for both competitions is the legacy one (`RULES_DEFAULT_IPL` / `RULES_DEFAULT_WPL`). Reconstructed points are always labelled `reconstructed_unverified`. WPL has no real fantasy labels in the data.

## Team composition rules

`src/lib/optimizer/team-rules/`: legacy (max 7 per team, WK 1–4, BAT 3–6, AR 1–4, BOWL 3–6) and modern draft (max 10 per team, 1–8 per role). Both are `draft`. Credits aren't in any supplied dataset, so archive/simulated matches use **demo credits estimated from projections**, labelled everywhere. A team is labelled **“Rules validated”** only with verified team rules, imported/provider credits and non-inferred roles. Otherwise it is “Valid under draft rules / demo inputs”.

## Measured vs illustrative

Every metric shown in the app is measured from stored data:

- **Offline benchmark** (`docs/MODEL_BENCHMARK.md`): men's IPL, Kaggle labels, train ≤2019 / validation 2020–21 / test 2022–23.
- **Live metrics** (Performance page): evaluations of frozen predictions after simulated or real matches. In the simulated replay these are 2026 IPL / WPL matches scored with **reconstructed** points, not Dream11 totals.
- **WPL research table**: recency baseline vs train-mean on reconstructed_unverified points. Not a fantasy-label evaluation.

Nothing on the landing page or elsewhere is hardcoded. Coverage numbers come from `manifest.json`, model numbers from `model_benchmark.json`.

## Provider coverage

- No live provider is configured by default. The CricAPI adapter (`src/lib/providers/cricapi.ts`) follows the public v1 endpoints, but its response mapping is unverified until run with a key. It provides no fantasy credits.
- Actual-result collection for provider fixtures needs a scorecard-to-events mapping that is **not implemented**. For those matches, import actuals via CSV on the review page. Cricsheet-archived matches are reconstructed automatically.
- Pitch reports: no authorised source configured. The UI says so and nothing is inferred.
