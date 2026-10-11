# Model benchmark (generated)

Generated 2026-10-11T15:15:27.296731+00:00 by `ml/train_benchmark.py`.

Men's IPL, target = Kaggle Dream11 `Total_FP`; chronological split train ≤2019 / validation 2020–21 / test 2022–23.
Rows: train 15341, validation 2458, test 3118.

| Model | Val MAE | Val RMSE | Val R² | Val Spearman | Test MAE | Test RMSE | Test bias | Test R² | Test Spearman | Test 80% PI coverage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Ridge regression | 25.741 | 32.753 | 0.0334 | 0.1751 | 26.463 | 34.093 | -1.642 | 0.0221 | 0.1294 | 0.8477 |
| HistGradientBoosting | 25.759 | 32.776 | 0.032 | 0.171 | 26.498 | 34.102 | -1.642 | 0.0216 | 0.127 | — |
| Random Forest | 25.83 | 32.78 | 0.0317 | 0.1711 | 26.622 | 34.153 | -1.299 | 0.0187 | 0.1121 | — |
| Train mean baseline | 26.205 | 33.316 | -0.0002 | None | 26.886 | 34.499 | -1.257 | -0.0013 | None | — |
| Recency baseline (recency-baseline-v1) | 25.927 | 33.038 | 0.0164 | 0.1684 | 26.967 | 34.5 | -0.929 | -0.0014 | 0.0978 | 0.8143 |

Selected on validation: **Ridge regression**. Test MAE 26.463 vs train-mean 26.886 (1.57% better).

## WPL research check (reconstructed_unverified target — not a fantasy-label evaluation)

| Season | Train-mean MAE | Recency baseline MAE | Baseline 80% PI coverage |
|---|---:|---:|---:|
| 2023/24 | 28.227 | 26.337 | 0.8557 |
| 2024/25 | 29.581 | 26.862 | 0.8492 |
| 2025/26 | 29.516 | 27.653 | 0.8368 |

## Caveats
- Weak signal: improvements over the train-mean baseline are small; this is not production-grade forecasting.
- Eligible-player pools, credits and roles are not in the historical data; roles are inferred.
- WPL figures are a research check against reconstructed_unverified points, not a fantasy-label evaluation.
