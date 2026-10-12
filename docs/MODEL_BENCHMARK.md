# Model benchmark (generated)

Generated 2026-10-11T20:09:28.453826+00:00 by `ml/train_benchmark.py`.

Men's IPL, target = Kaggle Dream11 `Total_FP`; chronological split train ≤2019 / validation 2020–21 / test 2022–23.
Rows: train 15341, validation 2458, test 3118.

| Model | Val MAE | Val RMSE | Val R² | Val Spearman | Test MAE | Test RMSE | Test bias | Test R² | Test Spearman | Test 80% PI coverage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Ridge regression | 25.742 | 32.743 | 0.0339 | 0.1787 | 26.469 | 34.083 | -1.58 | 0.0226 | 0.1286 | 0.8461 |
| HistGradientBoosting | 25.766 | 32.734 | 0.0344 | 0.1852 | 26.538 | 34.119 | -1.453 | 0.0206 | 0.1235 | — |
| Random Forest | 25.812 | 32.756 | 0.0332 | 0.1792 | 26.697 | 34.207 | -1.215 | 0.0156 | 0.1092 | — |
| Train mean baseline | 26.205 | 33.316 | -0.0002 | None | 26.886 | 34.499 | -1.257 | -0.0013 | None | — |
| Recency baseline (recency-baseline-v1) | 29.957 | 35.963 | -0.1654 | 0.1752 | 30.732 | 37.131 | 12.148 | -0.16 | 0.0931 | 0.8717 |

Selected on validation: **Ridge regression**. Test MAE 26.469 vs train-mean 26.886 (1.55% better).

## Current official rules (dream11-t20-2026) — served model

Target: points reconstructed from Cricsheet events under the official T20 rules (larger point scale). Same chronological split.

| Model | Val MAE | Test MAE | Test RMSE | Test bias | Test R² | Test Spearman | Test 80% PI coverage |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ridge regression | 32.989 | 34.617 | 44.977 | -2.529 | 0.0295 | 0.1599 | 0.8433 |
| HistGradientBoosting | 33.001 | 34.834 | 45.063 | -2.324 | 0.0258 | 0.138 | — |
| Train mean baseline | 33.776 | 35.306 | 45.705 | -2.157 | -0.0022 | None | — |
| Recency baseline (recency-baseline-v1) | 33.474 | 35.477 | 45.454 | -0.577 | 0.0088 | 0.1273 | 0.8201 |

## WPL research check (reconstructed_unverified target — not a fantasy-label evaluation)

| Season | Train-mean MAE | Recency baseline MAE | Baseline 80% PI coverage |
|---|---:|---:|---:|
| 2023/24 | 37.594 | 34.672 | 0.8598 |
| 2024/25 | 40.012 | 35.583 | 0.8512 |
| 2025/26 | 39.664 | 36.715 | 0.8492 |

## Caveats
- Weak signal: improvements over the train-mean baseline are small; this is not production-grade forecasting.
- Eligible-player pools, credits and roles are not in the historical data; roles are inferred.
- WPL figures are a research check against reconstructed_unverified points, not a fantasy-label evaluation.
