"""
Chronological model benchmark for player-level base fantasy points.

Inputs : data/processed/features_ipl.csv, features_wpl.csv (scripts/export-features.ts)
Outputs: data/processed/model_benchmark.json
         src/lib/models/artifacts/ridge-ipl-v1.json   (servable Ridge coefficients for the TS app)
         docs/MODEL_BENCHMARK.md

Rules followed:
- Men's IPL target = Kaggle Dream11 Total_FP (2008-2023). Split: train <=2019, validation 2020-21, test 2022-23.
- All preprocessing (imputation, scaling) is fitted inside sklearn Pipelines on the training split only.
- Feature columns are checked against an allowlist and forbidden patterns before training.
- WPL has no verified labels: only a clearly-labelled research evaluation against reconstructed_unverified
  points is produced, and no WPL model is trained or registered as servable.

Run: .venv/bin/python -I ml/train_benchmark.py
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
ARTIFACTS = ROOT / "src" / "lib" / "models" / "artifacts"
DOCS = ROOT / "docs"

FEATURES = [
    "matches_before", "days_since_previous", "pts_prev", "pts_mean_last3", "pts_mean_last5", "pts_mean_last10",
    "pts_std_last10", "pts_ewm_hl5", "pts_mean_all", "pts_mean_season_prior", "runs_mean_last5",
    "balls_faced_mean_last5", "bat_pos_mean_last5", "sr_last10", "balls_bowled_mean_last5", "wickets_mean_last5",
    "econ_last10", "catches_mean_last10", "xi_rate_last10", "player_venue_matches", "player_venue_pts_mean",
    "venue_pts_mean_prior", "player_vs_opp_matches", "player_vs_opp_pts_mean", "role_WK", "role_BAT", "role_AR",
    "role_BOWL",
]
FORBIDDEN = [r"target", r"total_fp", r"dream_?team", r"captain", r"winner", r"player_of_match", r"toss",
             r"same_match", r"^actual_", r"^runs$", r"^wickets$", r"result", r"baseline_"]


def assert_no_leakage(cols: list[str]) -> None:
    for c in cols:
        if c not in FEATURES:
            raise ValueError(f"Column {c} not in feature allowlist")
        for p in FORBIDDEN:
            if re.search(p, c, flags=re.I):
                raise ValueError(f"Column {c} matches forbidden pattern {p}")


def metrics(df: pd.DataFrame, pred_col: str, target_col: str, split: str, p10: str | None = None, p90: str | None = None) -> dict:
    y = df[target_col].to_numpy(float)
    p = df[pred_col].to_numpy(float)
    err = p - y
    ss_res = float(np.sum((y - p) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    rhos = []
    for _, g in df.groupby("match_id"):
        if len(g) >= 5 and g[pred_col].nunique() > 1 and g[target_col].nunique() > 1:
            rhos.append(spearmanr(g[pred_col], g[target_col]).statistic)
    out = {
        "split": split,
        "n": int(len(df)),
        "mae": round(float(np.mean(np.abs(err))), 3),
        "rmse": round(float(np.sqrt(np.mean(err ** 2))), 3),
        "bias": round(float(np.mean(err)), 3),
        "r2": round(1 - ss_res / ss_tot, 4) if ss_tot else None,
        "spearman": round(float(np.nanmean(rhos)), 4) if rhos else None,
        "matchesWithRank": len(rhos),
    }
    if p10 and p90:
        inside = (df[target_col] >= df[p10]) & (df[target_col] <= df[p90])
        out["intervalCoverage80"] = round(float(inside.mean()), 4)
    return out


def segment(df: pd.DataFrame, pred_col: str, target_col: str, by: str) -> list[dict]:
    rows = []
    for k, g in df.groupby(by):
        e = g[pred_col] - g[target_col]
        rows.append({"segment": str(k), "n": int(len(g)), "mae": round(float(e.abs().mean()), 3), "bias": round(float(e.mean()), 3)})
    return rows


def main() -> int:
    ipl = pd.read_csv(PROCESSED / "features_ipl.csv", dtype={"match_id": str, "player_id": str, "season": str})
    assert_no_leakage(FEATURES)
    lab = ipl[ipl["target_kaggle_total"].notna() & ipl["split"].isin(["train", "validation", "test"])].copy()
    tr, va, te = (lab[lab.split == s] for s in ("train", "validation", "test"))
    T = "target_kaggle_total"
    # Sanity: chronological ordering of splits.
    assert tr.match_date.max() < va.match_date.min() <= va.match_date.max() < te.match_date.min(), "Splits overlap in time"

    results: dict[str, dict] = {}
    train_mean = float(tr[T].mean())
    for d in (va, te):
        d["pred_train_mean"] = train_mean
    results["Train mean baseline"] = {"kind": "train_mean", "validation": metrics(va, "pred_train_mean", T, "validation"), "test": metrics(te, "pred_train_mean", T, "test")}
    results["Recency baseline (recency-baseline-v1)"] = {
        "kind": "recency_baseline",
        "validation": metrics(va, "baseline_pred", T, "validation", "baseline_p10", "baseline_p90"),
        "test": metrics(te, "baseline_pred", T, "test", "baseline_p10", "baseline_p90"),
    }

    X = lambda d: d[FEATURES].astype(float)  # noqa: E731
    models = {
        "Ridge regression": ("ridge", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler()), ("m", Ridge(alpha=10.0))])),
        "Random Forest": ("random_forest", Pipeline([("imp", SimpleImputer(strategy="median")), ("m", RandomForestRegressor(n_estimators=200, min_samples_leaf=20, max_features=0.5, n_jobs=-1, random_state=7))])),
        "HistGradientBoosting": ("hist_gradient_boosting", Pipeline([("m", HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, min_samples_leaf=40, l2_regularization=1.0, random_state=7))])),
    }
    fitted = {}
    for name, (kind, pipe) in models.items():
        pipe.fit(X(tr), tr[T])  # fitted on TRAIN only
        fitted[name] = pipe
        va[f"pred_{kind}"] = pipe.predict(X(va))
        te[f"pred_{kind}"] = pipe.predict(X(te))
        results[name] = {"kind": kind, "validation": metrics(va, f"pred_{kind}", T, "validation"), "test": metrics(te, f"pred_{kind}", T, "test")}

    # Ridge artifact for TS serving, with role residual std from VALIDATION for intervals.
    ridge = fitted["Ridge regression"]
    imp, sc, m = ridge.named_steps["imp"], ridge.named_steps["sc"], ridge.named_steps["m"]
    resid = va["pred_ridge"] - va[T]
    role_std = {r: round(float(resid[va.role_inferred == r].std()), 3) for r in ["WK", "BAT", "AR", "BOWL"] if (va.role_inferred == r).sum() > 30}
    role_std["ALL"] = round(float(resid.std()), 3)
    # Interval coverage for ridge on test using validation-derived sigma.
    sig = te.role_inferred.map(role_std).fillna(role_std["ALL"])
    te["ridge_p10"] = te["pred_ridge"] - 1.2816 * sig
    te["ridge_p90"] = te["pred_ridge"] + 1.2816 * sig
    results["Ridge regression"]["test"] = metrics(te, "pred_ridge", T, "test", "ridge_p10", "ridge_p90")

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    artifact = {
        "modelId": "ridge-ipl-v1",
        "features": FEATURES,
        "medians": [float(x) for x in imp.statistics_],
        "means": [float(x) for x in sc.mean_],
        "scales": [float(x) for x in sc.scale_],
        "coef": [float(x) for x in m.coef_],
        "intercept": float(m.intercept_),
        "residualStdByRole": role_std,
        "trainingCutoff": str(tr.match_date.max()),
        "target": "Kaggle Dream11 Total_FP (men's IPL, legacy rules)",
    }
    (ARTIFACTS / "ridge-ipl-v1.json").write_text(json.dumps(artifact, indent=1))

    best = min((k for k in results), key=lambda k: results[k]["validation"]["mae"])
    best_kind = results[best]["kind"]
    pred_col = {"train_mean": "pred_train_mean", "recency_baseline": "baseline_pred"}.get(best_kind, f"pred_{best_kind}")
    seg = {
        "byRole": segment(te, pred_col, T, "role_inferred"),
        "bySeason": segment(te, pred_col, T, "season"),
        "byHistory": segment(te.assign(hist=pd.cut(te.matches_before, [-1, 0, 5, 20, 1000], labels=["0", "1-5", "6-20", "21+"])), pred_col, T, "hist"),
    }

    # WPL research evaluation (reconstructed_unverified target). No model trained or served.
    wpl = pd.read_csv(PROCESSED / "features_wpl.csv", dtype={"match_id": str, "player_id": str, "season": str})
    wpl_research = []
    seasons = sorted(wpl.season.unique())
    for i, s in enumerate(seasons[1:], start=1):
        hist = wpl[wpl.season.isin(seasons[:i])]
        cur = wpl[wpl.season == s].copy()
        cur["pred_mean"] = hist["target_reconstructed"].mean()
        wpl_research.append({
            "season": s,
            "labelStatus": "reconstructed_unverified",
            "trainMean": metrics(cur, "pred_mean", "target_reconstructed", s),
            "recencyBaseline": metrics(cur, "baseline_pred", "target_reconstructed", s, "baseline_p10", "baseline_p90"),
        })

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "competition": "IPL",
        "target": "Kaggle Dream11 Total_FP (high-confidence player mapping only)",
        "split": {"train": "<=2019", "validation": "2020-2021", "test": "2022-2023"},
        "rows": {"train": int(len(tr)), "validation": int(len(va)), "test": int(len(te))},
        "features": FEATURES,
        "results": results,
        "selectedOnValidation": best,
        "testSegmentsForSelected": seg,
        "wplResearch": wpl_research,
        "caveats": [
            "Weak signal: improvements over the train-mean baseline are small; this is not production-grade forecasting.",
            "Eligible-player pools, credits and roles are not in the historical data; roles are inferred.",
            "WPL figures are a research check against reconstructed_unverified points, not a fantasy-label evaluation.",
        ],
    }
    (PROCESSED / "model_benchmark.json").write_text(json.dumps(report, indent=1))

    DOCS.mkdir(exist_ok=True)
    lines = ["# Model benchmark (generated)", "", f"Generated {report['generatedAt']} by `ml/train_benchmark.py`.", "",
             "Men's IPL, target = Kaggle Dream11 `Total_FP`; chronological split train ≤2019 / validation 2020–21 / test 2022–23.",
             f"Rows: train {len(tr)}, validation {len(va)}, test {len(te)}.", "",
             "| Model | Val MAE | Val RMSE | Val R² | Val Spearman | Test MAE | Test RMSE | Test bias | Test R² | Test Spearman | Test 80% PI coverage |",
             "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for k, v in sorted(results.items(), key=lambda kv: kv[1]["test"]["mae"]):
        a, b = v["validation"], v["test"]
        lines.append(f"| {k} | {a['mae']} | {a['rmse']} | {a['r2']} | {a['spearman']} | {b['mae']} | {b['rmse']} | {b['bias']} | {b['r2']} | {b['spearman']} | {b.get('intervalCoverage80', '—')} |")
    tm = results["Train mean baseline"]["test"]["mae"]
    bt = results[best]["test"]["mae"]
    lines += ["", f"Selected on validation: **{best}**. Test MAE {bt} vs train-mean {tm} ({100 * (tm - bt) / tm:.2f}% better).", "",
              "## WPL research check (reconstructed_unverified target — not a fantasy-label evaluation)", "",
              "| Season | Train-mean MAE | Recency baseline MAE | Baseline 80% PI coverage |", "|---|---:|---:|---:|"]
    for w in wpl_research:
        lines.append(f"| {w['season']} | {w['trainMean']['mae']} | {w['recencyBaseline']['mae']} | {w['recencyBaseline'].get('intervalCoverage80')} |")
    lines += ["", "## Caveats", *[f"- {c}" for c in report["caveats"]]]
    (DOCS / "MODEL_BENCHMARK.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
