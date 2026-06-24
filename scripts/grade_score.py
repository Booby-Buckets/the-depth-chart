#!/usr/bin/env python3
"""
Train final model on all 653 labels, score the full history with the
conference-tier translation, and print top players per season as a
cross-era sanity check. No DB writes (use --write for that).
"""
import sys
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.linear_model import RidgeCV

import grade_features as gf
import grade_conf as gc

DATA = Path(__file__).parent / "data"
ZCOUNT = ["ppg", "rpg", "apg", "stl", "blk", "tpm", "tpa", "fta", "fga",
          "oreb", "dreb", "fgm", "ftm"]  # counting stats translated by tier


def tier_translate(df: pd.DataFrame) -> pd.DataFrame:
    """Scale counting production toward tier-1 equivalent by conference tier."""
    d = df.copy()
    tiers = d["team"].map(gc.tier).fillna(gc.DEFAULT_TIER).astype(int)
    d["_tier"] = tiers
    factor = tiers.map(gc.TIER_TO_T1).astype(float)
    for c in ZCOUNT:
        if c in d.columns:
            d[c] = pd.to_numeric(d[c], errors="coerce") * factor
    return d


def train_model(hist, pop):
    lab = pd.read_pickle(DATA / "players_labeled.pkl")
    lab = lab[lab.mpg.notna() & lab.grade_num.notna()].reset_index(drop=True)
    # training labels are ~all tier 1-2; translate them too for consistency
    lab_t = tier_translate(lab)
    X, names, _ = gf.build_matrix(lab_t, pop, default_season=2026)
    y = lab.grade_num.values.astype(float)
    mdl = RidgeCV(alphas=np.logspace(-2, 3, 30)).fit(X, y)
    return mdl, names


def main(write=False):
    hist = pd.read_pickle(DATA / "history_all.pkl")
    pop = gf.season_pop_stats(hist)
    mdl, names = train_model(hist, pop)

    score_df = hist[hist.mpg.notna()].copy()
    score_df = score_df[pd.to_numeric(score_df.mpg, errors="coerce") >= 8].copy()
    st = tier_translate(score_df)
    X, _, _ = gf.build_matrix(st, pop, season_col="season_year")
    raw = mdl.predict(X)
    score_df["grade"] = np.clip(np.round(raw, 0), 40, 99).astype(int)
    score_df["_tier"] = st["_tier"].values

    print(f"Scored {len(score_df)} player-seasons (mpg>=8)")
    print(f"grade dist: mean {score_df.grade.mean():.1f} "
          f"min {score_df.grade.min()} max {score_df.grade.max()}")

    for yr in [2013, 2015, 2017, 2019, 2022, 2025]:
        s = score_df[score_df.season_year == yr].nlargest(12, "grade")
        print(f"\n=== TOP 12 — {yr-1}-{str(yr)[2:]} ===")
        for _, r in s.iterrows():
            print(f"  {r.grade}  {str(r['name'])[:22]:22s} {str(r.team)[:20]:20s} "
                  f"T{r._tier} {r.position:3s} "
                  f"{r.ppg:.1f}/{r.rpg:.1f}/{r.apg:.1f}")

    if write:
        return score_df


if __name__ == "__main__":
    main(write="--write" in sys.argv)
