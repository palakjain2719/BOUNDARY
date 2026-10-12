"""
2026 hold-out test: train only on matches up to 31 Dec 2025, predict every 2026 match, score against actuals.

Target: points reconstructed from Cricsheet ball-by-ball under the official Dream11 T20 rules (dream11-t20-2026).
Features are pre-match only (built from strictly earlier matches), so a 2026 prediction never sees its own match.
Pool per match = players who took part (post-toss view, same as the replay backfill).

Team check (per match): pick 11 by predicted points with Dream11 shape limits (1-8 per role, max 10 per side*,
both sides represented), captain = highest prediction, vice-captain = second. Compared with the best possible XI
picked in hindsight from the actual points under the same limits. Credits are not in the historical data, so the
100-credit cap is not applied (* 10 per side for the 2026 rules; 7 under older rules).

Run: .venv/bin/python -I ml/holdout_2026.py
Outputs: data/processed/holdout_2026.json, docs/HOLDOUT_2026.md
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.ensemble import HistGradientBoostingRegressor  # noqa: E402
from sklearn.impute import SimpleImputer  # noqa: E402
from sklearn.linear_model import Ridge  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402

from train_benchmark import DOCS, FEATURES, PROCESSED, assert_no_leakage, metrics  # noqa: E402

T = "target_reconstructed"
ROLES = ["WK", "BAT", "AR", "BOWL"]
MAX_PER_SIDE = 10


def pick_xi(g: pd.DataFrame, col: str) -> list[int]:
    """Greedy XI by `col` under role 1-8 and per-side limits; guarantees one of each role and both sides."""
    g = g.sort_values(col, ascending=False)
    chosen: list[int] = []
    roles = {r: 0 for r in ROLES}
    sides: dict[str, int] = {}
    # Seed one per role and one per side so the XI is always valid.
    for r in ROLES:
        sub = g[(g.role_inferred == r) & ~g.index.isin(chosen)]
        if len(sub):
            i = sub.index[0]
            chosen.append(i); roles[r] += 1; sides[g.at[i, "team"]] = sides.get(g.at[i, "team"], 0) + 1
    for t in g.team.unique():
        if sides.get(t, 0) == 0:
            i = g[(g.team == t) & ~g.index.isin(chosen)].index[0]
            chosen.append(i); roles[g.at[i, "role_inferred"]] += 1; sides[t] = 1
    for i in g.index:
        if len(chosen) >= 11:
            break
        if i in chosen:
            continue
        r, t = g.at[i, "role_inferred"], g.at[i, "team"]
        if roles[r] >= 8 or sides.get(t, 0) >= MAX_PER_SIDE:
            continue
        chosen.append(i); roles[r] += 1; sides[t] = sides.get(t, 0) + 1
    return chosen


def team_points(g: pd.DataFrame, xi: list[int], col: str) -> tuple[float, int, int]:
    ranked = g.loc[xi].sort_values(col, ascending=False).index
    c, vc = ranked[0], ranked[1]
    return float(g.loc[xi, T].sum() + g.at[c, T] * 1.0 + g.at[vc, T] * 0.5), c, vc


def team_eval(test: pd.DataFrame, col: str) -> dict:
    rows = []
    for mid, g in test.groupby("match_id"):
        if len(g) < 15 or g.team.nunique() < 2:
            continue
        xi = pick_xi(g, col)
        got, c, vc = team_points(g, xi, col)
        best_xi = pick_xi(g, T)
        best, _, _ = team_points(g, best_xi, T)
        actual_rank = g[T].rank(ascending=False, method="min")
        rows.append({
            "match_id": mid, "date": g.match_date.iloc[0], "teamActual": got, "bestPossible": best,
            "pctOfBest": got / best if best else None, "overlapWithBestXI": len(set(xi) & set(best_xi)),
            "captainActual": float(g.at[c, T]), "captainTop3": bool(actual_rank[c] <= 3),
            "predictedTeam": float(g.loc[xi, col].sum() + g.at[c, col] + 0.5 * g.at[vc, col]),
        })
    d = pd.DataFrame(rows)
    return {
        "matches": int(len(d)),
        "avgTeamPoints": round(float(d.teamActual.mean()), 1),
        "avgBestPossible": round(float(d.bestPossible.mean()), 1),
        "avgPctOfBest": round(float(d.pctOfBest.mean()) * 100, 1),
        "avgOverlapWithBestXI": round(float(d.overlapWithBestXI.mean()), 2),
        "captainInActualTop3": round(float(d.captainTop3.mean()) * 100, 1),
        "avgCaptainPoints": round(float(d.captainActual.mean()), 1),
        "teamTotalAbsError": round(float((d.predictedTeam - d.teamActual).abs().mean()), 1),
    }


def run(comp: str, csv: str) -> dict:
    df = pd.read_csv(PROCESSED / csv, dtype={"match_id": str, "player_id": str, "season": str})
    df["year"] = df.match_date.str.slice(0, 4).astype(int)
    raw = json.loads((PROCESSED / f"{comp.lower()}_player_stats.json").read_text())
    stats = pd.DataFrame(raw["rows"], columns=raw["columns"]).astype({"matchId": str, "playerId": str})
    df = df.merge(stats[["matchId", "playerId", "team"]].rename(columns={"matchId": "match_id", "playerId": "player_id"}), on=["match_id", "player_id"], how="left")
    train, test = df[df.year <= 2025].copy(), df[df.year == 2026].copy()
    assert train.match_date.max() < test.match_date.min(), "train/test overlap"
    X = lambda d: d[FEATURES].astype(float)  # noqa: E731
    out: dict = {"competition": comp, "trainRows": int(len(train)), "trainMatches": int(train.match_id.nunique()),
                 "trainCutoff": str(train.match_date.max()), "testRows": int(len(test)), "testMatches": int(test.match_id.nunique()),
                 "testRange": [str(test.match_date.min()), str(test.match_date.max())], "players": {}, "teams": {}}
    test["pred_mean"] = float(train[T].mean())
    ridge = Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler()), ("m", Ridge(alpha=10.0))]).fit(X(train), train[T])
    hgb = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, min_samples_leaf=40, l2_regularization=1.0, random_state=7).fit(X(train), train[T])
    test["pred_ridge"] = ridge.predict(X(test))
    test["pred_hgb"] = hgb.predict(X(test))
    # 80% interval from training residual spread by role
    res = pd.Series(ridge.predict(X(train)) - train[T].to_numpy(), index=train.index)
    sig = train.assign(r=res).groupby("role_inferred").r.std()
    test["ridge_p10"] = test.pred_ridge - 1.2816 * test.role_inferred.map(sig)
    test["ridge_p90"] = test.pred_ridge + 1.2816 * test.role_inferred.map(sig)
    models = {"Train mean (guess the average)": ("pred_mean", None), "Recency baseline": ("baseline_pred", ("baseline_p10", "baseline_p90")),
              "Ridge regression": ("pred_ridge", ("ridge_p10", "ridge_p90")), "HistGradientBoosting": ("pred_hgb", None)}
    for name, (col, iv) in models.items():
        out["players"][name] = metrics(test, col, T, "2026", *(iv or (None, None)))
        out["teams"][name] = team_eval(test, col) if col != "pred_mean" else None
    # Reference: random valid XIs (average of 20 seeds) — what picking without any model gets you.
    rand = []
    for seed in range(20):
        test["pred_random"] = np.random.default_rng(seed).random(len(test))
        rand.append(team_eval(test, "pred_random"))
    out["teams"]["Random valid XI (reference)"] = {k: (round(float(np.mean([r[k] for r in rand])), 1) if k != "matches" else rand[0][k]) for k in rand[0]}
    out["teams"]["Random valid XI (reference)"]["teamTotalAbsError"] = "—"
    by_role = {r: round(float((test[test.role_inferred == r].pred_ridge - test[test.role_inferred == r][T]).abs().mean()), 2) for r in ROLES if (test.role_inferred == r).any()}
    out["ridgeMaeByRole"] = by_role
    return out


def main() -> int:
    assert_no_leakage(FEATURES)
    results = [run("IPL", "features_ipl.csv"), run("WPL", "features_wpl.csv")]
    (PROCESSED / "holdout_2026.json").write_text(json.dumps({"generatedAt": datetime.now(timezone.utc).isoformat(), "rulesId": "dream11-t20-2026", "results": results}, indent=1, default=str))
    L = ["# 2026 hold-out test", "", "Trained on matches up to 31 Dec 2025 only; every 2026 match predicted before the fact (features use earlier matches only) and scored against actual points.",
         "Actual points are reconstructed from ball-by-ball data under the official Dream11 T20 rules (`dream11-t20-2026`); WPL points are `reconstructed_unverified`.", ""]
    for r in results:
        L += [f"## {r['competition']}", "", f"Train: {r['trainMatches']} matches (to {r['trainCutoff']}). Test: {r['testMatches']} matches, {r['testRows']} player rows ({r['testRange'][0]} → {r['testRange'][1]}).", "",
              "| Model | Player MAE | Bias | Rank ρ per match | 80% range coverage |", "|---|---:|---:|---:|---:|"]
        for k, v in r["players"].items():
            cov = f"{v['intervalCoverage80'] * 100:.0f}%" if "intervalCoverage80" in v else "—"
            rho = v["spearman"] if v["spearman"] is not None else "—"
            L.append(f"| {k} | {v['mae']} | {v['bias']} | {rho} | {cov} |")
        L += ["", "| Team pick (11 + C/VC) | Avg actual pts | Best possible | % of best | Overlap with best XI | Captain in actual top 3 | Team total |error| |", "|---|---:|---:|---:|---:|---:|---:|"]
        for k, v in r["teams"].items():
            if v:
                L.append(f"| {k} | {v['avgTeamPoints']} | {v['avgBestPossible']} | {v['avgPctOfBest']}% | {v['avgOverlapWithBestXI']}/11 | {v['captainInActualTop3']}% | {v['teamTotalAbsError']} |")
        L += ["", f"Ridge MAE by role: {', '.join(f'{k} {v}' for k, v in r['ridgeMaeByRole'].items())}", ""]
    L += ["Caveats: credits are not in historical data, so the 100-credit cap is not applied to the team check; roles are inferred; the pool is the players who took part (post-toss view)."]
    (DOCS / "HOLDOUT_2026.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
