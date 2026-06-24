#!/usr/bin/env python3
"""
Train and cross-validate the overall-grade model on the 653 labeled
(power-conference) players. Reports MAE / R² / correlation and compares
Ridge vs Gradient Boosting. No DB writes.
"""
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.linear_model import RidgeCV
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import KFold, cross_val_predict

import grade_features as gf

DATA = Path(__file__).parent / "data"


def main():
    hist = pd.read_pickle(DATA / "history_all.pkl")
    lab = pd.read_pickle(DATA / "players_labeled.pkl")
    lab = lab[lab.mpg.notna() & lab.grade_num.notna()].reset_index(drop=True)
    print(f"Training rows: {len(lab)}")

    pop = gf.season_pop_stats(hist)
    X, names, meta = gf.build_matrix(lab, pop, default_season=2026)
    y = lab.grade_num.values.astype(float)
    print(f"Features: {X.shape[1]}  ({', '.join(names)})")

    kf = KFold(n_splits=5, shuffle=True, random_state=42)

    models = {
        "Ridge": RidgeCV(alphas=np.logspace(-2, 3, 30)),
        "GBM": GradientBoostingRegressor(
            n_estimators=400, max_depth=3, learning_rate=0.03,
            subsample=0.8, min_samples_leaf=12, random_state=42),
    }
    for name, mdl in models.items():
        pred = cross_val_predict(mdl, X, y, cv=kf)
        mae = np.mean(np.abs(pred - y))
        rmse = np.sqrt(np.mean((pred - y) ** 2))
        r = np.corrcoef(pred, y)[0, 1]
        within2 = np.mean(np.abs(pred - y) <= 2) * 100
        within3 = np.mean(np.abs(pred - y) <= 3) * 100
        print(f"\n=== {name} (5-fold CV) ===")
        print(f"  MAE   {mae:.2f} grade points")
        print(f"  RMSE  {rmse:.2f}")
        print(f"  corr  {r:.3f}   R²={r**2:.3f}")
        print(f"  within ±2: {within2:.0f}%   within ±3: {within3:.0f}%")

    # Ridge coefficients for interpretability
    ridge = RidgeCV(alphas=np.logspace(-2, 3, 30)).fit(X, y)
    print(f"\n=== Ridge intercept {ridge.intercept_:.1f}, top weights ===")
    coef = sorted(zip(names, ridge.coef_), key=lambda t: -abs(t[1]))
    for n, c in coef[:14]:
        print(f"  {n:14s} {c:+.2f}")

    # worst misses (GBM)
    gbm = models["GBM"]
    pred = cross_val_predict(gbm, X, y, cv=kf)
    lab2 = lab.copy()
    lab2["pred"] = np.round(pred, 1)
    lab2["err"] = lab2.pred - lab2.grade_num
    print("\n=== biggest CV misses (GBM) ===")
    worst = lab2.reindex(lab2.err.abs().sort_values(ascending=False).index).head(12)
    for _, r in worst.iterrows():
        print(f"  {r['name'][:22]:22s} {r['team'][:14]:14s} {r['position']:3s} "
              f"actual {r.grade_num:.0f}  pred {r.pred:.0f}  ({r.err:+.0f})  "
              f"{r.ppg:.1f}/{r.rpg:.1f}/{r.apg:.1f}")


if __name__ == "__main__":
    main()
