#!/usr/bin/env python3
"""
Shared feature engineering for the overall-grade model.

Design:
  * Features come ONLY from box-score fields present in BOTH the players
    table and player_history, so a model trained on the 653 labeled
    (power-conference) players can score all ~75k historical rows.
  * Production/efficiency features are normalized WITHIN each season
    (z-score vs that year's qualified D1 population, mpg>=10) so a player
    is always graded relative to his own era.
  * Conference tier is handled as a post-hoc translation (see grade_model),
    NOT a learned feature, because the labeled set is ~all tier 1-2.
"""
import re
import numpy as np
import pandas as pd

# Counting / rate / efficiency features that get within-season z-scored
Z_FEATURES = [
    "ppg", "rpg", "apg", "stl", "blk", "tpm", "tpa", "fta", "fga",
    "oreb", "dreb", "tovs", "mpg", "fg_pct", "tp_pct", "ft_pct",
    "ts_pct", "efg", "ast_to", "pts_per_min", "reb_per_min", "stk_per_min",
]
POSITIONS = ["PG", "SG", "SF", "PF", "C"]
MIN_MPG = 10.0


def _num(s):
    return pd.to_numeric(s, errors="coerce")


def add_derived(df: pd.DataFrame) -> pd.DataFrame:
    """Add derived efficiency/rate columns. Mutates a copy, returns it."""
    d = df.copy()
    for c in ["ppg", "rpg", "apg", "stl", "blk", "tpm", "tpa", "fta", "fga",
              "fgm", "ftm", "oreb", "dreb", "tovs", "mpg", "gp",
              "fg_pct", "tp_pct", "ft_pct"]:
        if c in d.columns:
            d[c] = _num(d[c])
        else:
            d[c] = np.nan

    mpg = d["mpg"].clip(lower=1)
    d["ts_pct"] = (d["ppg"] / (2 * (d["fga"] + 0.44 * d["fta"]).clip(lower=0.1))) * 100
    d["efg"] = ((d["fgm"] + 0.5 * d["tpm"]) / d["fga"].clip(lower=0.1)) * 100
    d["ast_to"] = d["apg"] / (d["tovs"].fillna(0) + 0.5)
    d["pts_per_min"] = d["ppg"] / mpg
    d["reb_per_min"] = d["rpg"] / mpg
    d["stk_per_min"] = (d["stl"].fillna(0) + d["blk"].fillna(0)) / mpg
    # clip insane efficiency from tiny samples
    d["ts_pct"] = d["ts_pct"].clip(20, 90)
    d["efg"] = d["efg"].clip(20, 95)
    d["ast_to"] = d["ast_to"].clip(0, 6)
    return d


def season_pop_stats(hist: pd.DataFrame) -> dict:
    """Per-season mean/std for each z-feature, from qualified players."""
    h = add_derived(hist)
    h = h[h["mpg"] >= MIN_MPG]
    stats = {}
    for yr, grp in h.groupby("season_year"):
        s = {}
        for f in Z_FEATURES:
            col = grp[f].replace([np.inf, -np.inf], np.nan).dropna()
            mu = float(col.mean()) if len(col) else 0.0
            sd = float(col.std()) if len(col) > 1 else 1.0
            s[f] = (mu, sd if sd and sd > 1e-6 else 1.0)
        stats[int(yr)] = s
    return stats


def parse_height_in(h):
    """'6-9' -> 81. Garbage/None -> NaN (caller imputes by position)."""
    if not isinstance(h, str):
        return np.nan
    m = re.match(r"^\s*(\d)\s*-\s*(\d{1,2})\s*$", h)
    if not m:
        return np.nan
    return int(m.group(1)) * 12 + int(m.group(2))


_POS_HEIGHT = {"PG": 74, "SG": 76, "SF": 79, "PF": 81, "C": 83}


def norm_pos(p):
    if not isinstance(p, str):
        return "SF"
    p = p.upper().replace("0", "").strip()
    if p in ("PG", "G"):
        return "PG"
    if p in ("SG", "CG"):
        return "SG"
    if p in ("SF", "F", "GF"):
        return "SF"
    if p in ("PF", "FC"):
        return "PF"
    if p in ("C",):
        return "C"
    if p.startswith("G"):
        return "SG"
    if p.startswith("F"):
        return "SF"
    if p.startswith("C"):
        return "C"
    return "SF"


def build_matrix(df: pd.DataFrame, pop_stats: dict, season_col=None,
                 default_season=None):
    """
    Return (X, feature_names, meta_df).
    df rows are scored using their season's pop stats (season_col), or
    default_season if given.
    """
    d = add_derived(df)
    d["_pos"] = (d["position"] if "position" in d.columns else "SF").map(norm_pos)
    d["_ht"] = (d["height"] if "height" in d.columns else np.nan).map(parse_height_in)
    d["_ht"] = d.apply(
        lambda r: r["_ht"] if pd.notna(r["_ht"]) else _POS_HEIGHT[r["_pos"]], axis=1)

    if default_season is not None:
        seasons = pd.Series([default_season] * len(d), index=d.index)
    else:
        seasons = d[season_col].astype(int)

    rows = []
    for f in Z_FEATURES:
        vals = d[f].replace([np.inf, -np.inf], np.nan).values
        z = np.zeros(len(d))
        for i, (v, yr) in enumerate(zip(vals, seasons.values)):
            st = pop_stats.get(int(yr)) or pop_stats.get(default_season) or {}
            mu, sd = st.get(f, (0.0, 1.0))
            z[i] = 0.0 if (v is None or np.isnan(v)) else (v - mu) / sd
        rows.append(np.clip(z, -4, 4))
    Xz = np.array(rows).T  # (n, len(Z_FEATURES))

    # height (z-ish: center 78, scale 4)
    ht = ((d["_ht"].values - 78.0) / 4.0).reshape(-1, 1)
    # position one-hot
    pos_oh = np.zeros((len(d), len(POSITIONS)))
    for i, p in enumerate(d["_pos"].values):
        pos_oh[i, POSITIONS.index(p)] = 1.0

    X = np.hstack([Xz, ht, pos_oh])
    names = list(Z_FEATURES) + ["height"] + [f"pos_{p}" for p in POSITIONS]
    meta = d[["name"] + ([season_col] if season_col else [])].copy()
    meta["_pos"] = d["_pos"].values
    return X, names, meta
