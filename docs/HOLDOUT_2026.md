# 2026 hold-out test

Trained on matches up to 31 Dec 2025 only; every 2026 match predicted before the fact (features use earlier matches only) and scored against actual points.
Actual points are reconstructed from ball-by-ball data under the official Dream11 T20 rules (`dream11-t20-2026`); WPL points are `reconstructed_unverified`.

## IPL

Train: 1169 matches (to 2025-06-03). Test: 74 matches, 1772 player rows (2026-03-28 → 2026-05-31).

| Model | Player MAE | Bias | Rank ρ per match | 80% range coverage |
|---|---:|---:|---:|---:|
| Train mean (guess the average) | 37.061 | -1.723 | — | — |
| Recency baseline | 36.26 | -0.098 | 0.2101 | 82% |
| Ridge regression | 35.959 | -1.659 | 0.2105 | 83% |
| HistGradientBoosting | 35.814 | -1.354 | 0.2295 | — |

| Team pick (11 + C/VC) | Avg actual pts | Best possible | % of best | Overlap with best XI | Captain in actual top 3 | Team total |error| |
|---|---:|---:|---:|---:|---:|---:|
| Recency baseline | 786.7 | 1245.0 | 62.9% | 5.92/11 | 18.9% | 155.2 |
| Ridge regression | 799.1 | 1245.0 | 63.8% | 6.03/11 | 24.3% | 163.4 |
| HistGradientBoosting | 811.7 | 1245.0 | 64.7% | 6.01/11 | 29.7% | 163.1 |
| Random valid XI (reference) | 659.1 | 1245.0 | 53.0% | 5.2/11 | 13.2% | — |

Ridge MAE by role: WK 45.08, BAT 37.42, AR 34.56, BOWL 32.52

## WPL

Train: 66 matches (to 2025-03-15). Test: 22 matches, 484 player rows (2026-01-09 → 2026-02-05).

| Model | Player MAE | Bias | Rank ρ per match | 80% range coverage |
|---|---:|---:|---:|---:|
| Train mean (guess the average) | 39.664 | -1.289 | — | — |
| Recency baseline | 36.715 | 1.788 | 0.4252 | 85% |
| Ridge regression | 37.81 | 3.756 | 0.3588 | 82% |
| HistGradientBoosting | 40.298 | 4.575 | 0.2627 | — |

| Team pick (11 + C/VC) | Avg actual pts | Best possible | % of best | Overlap with best XI | Captain in actual top 3 | Team total |error| |
|---|---:|---:|---:|---:|---:|---:|
| Recency baseline | 926.8 | 1265.8 | 73.4% | 7.68/11 | 36.4% | 169.5 |
| Ridge regression | 901.8 | 1265.8 | 72.0% | 7.18/11 | 40.9% | 136.2 |
| HistGradientBoosting | 854.8 | 1265.8 | 67.9% | 6.59/11 | 31.8% | 250.2 |
| Random valid XI (reference) | 689.2 | 1265.8 | 54.6% | 5.6/11 | 14.5% | — |

Ridge MAE by role: WK 40.78, BAT 33.93, AR 49.89, BOWL 34.12

Caveats: credits are not in historical data, so the 100-credit cap is not applied to the team check; roles are inferred; the pool is the players who took part (post-toss view).
