#!/usr/bin/env python3
"""Per-stat year-over-year development for RETURNING players, calibrated on 20 years of
player_history. Output: scripts/data/stat_dev.json, read by build_stat_overall_projected.py.

For each class step (so = fr->so, jr = so->jr, sr = jr->sr, gr = sr->5th year) and each per-40 rate
that usage does not already drive (rebounds, assists, steals, blocks, turnovers), fit

    next_per40 = a + b * this_per40          (weighted by the smaller of the two seasons' minutes)

on players who stayed at the same school and played 12+ mpg in both seasons. b < 1 is regression to
the mean (an outlier season cools off), a is the class step's development. Shooting percentages get
the same fit so a hot or cold shooting year moves back toward the player's level, not the league's.

Why: the projection copied these rates flat from last season, so a returning senior's line could only
shrink with his minutes (Thomas Haugh: every stat a little lower, which reads as "no prediction").
"""
import json, os, sys, urllib.request
import numpy as np

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
MIN_MPG, MIN_GP = 12.0, 10


def pull():
    cols = "espn_id,season_year,team,yr,gp,mpg,ppg,fga,tpa,fta,fg_pct,tp_pct,ft_pct,oreb,dreb,rpg,apg,stl,blk,tovs"
    out, off = [], 0
    while True:
        url = f"{SB}/rest/v1/player_history?select={cols}&mpg=gte.{MIN_MPG}&espn_id=not.is.null&order=id&offset={off}&limit=1000"
        rows = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=H)))
        out += rows
        if len(rows) < 1000:
            return out
        off += 1000


def pull_seasons():
    """every season a player logged real minutes (2+ mpg) -> class by count, since player_history's
    yr is blank for most past seasons (season 2 = sophomore, 3 = junior, 4 = senior, 5+ = 5th year)"""
    out, off = {}, 0
    while True:
        url = f"{SB}/rest/v1/player_history?select=espn_id,season_year&mpg=gt.2&espn_id=not.is.null&order=id&offset={off}&limit=1000"
        rows = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=H)))
        for r in rows:
            out.setdefault(int(r["espn_id"]), set()).add(int(r["season_year"]))
        if len(rows) < 1000:
            return out
        off += 1000


def step_of(n):
    return {2: "so", 3: "jr", 4: "sr"}.get(n, "gr" if n >= 5 else None)


def f(x):
    try:
        v = float(x)
        return v if np.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def main():
    rows = pull()
    seasons_of = pull_seasons()
    by = {}
    for r in rows:
        if (f(r["gp"]) or 0) < MIN_GP:
            continue
        by.setdefault(int(r["espn_id"]), {})[int(r["season_year"])] = r
    RATE = {"oreb": "oreb", "dreb": "dreb", "ast": "apg", "stl": "stl", "blk": "blk", "tov": "tovs"}
    PCT = {"fg": ("fg_pct", "fga", 3.0), "tp": ("tp_pct", "tpa", 1.5), "ft": ("ft_pct", "fta", 1.0)}
    pairs = {}
    for e, seasons in by.items():
        for y, a in seasons.items():
            b = seasons.get(y + 1)
            if not b or (a["team"] or "").strip().lower() != (b["team"] or "").strip().lower():
                continue
            # class of the NEXT season = how many seasons he had played by then (2007+ data: a player
            # whose career began before 2007 is left out rather than guessed)
            played = seasons_of.get(e, set())
            if min(played, default=y) <= 2007:
                continue
            st = step_of(len([s_ for s_ in played if s_ <= y + 1]))
            if not st:
                continue
            ma, mb = f(a["mpg"]), f(b["mpg"])
            w = min(ma * (f(a["gp"]) or 0), mb * (f(b["gp"]) or 0))
            rec = {"w": w}
            for k, col in RATE.items():
                x, z = f(a[col]), f(b[col])
                if x is not None and z is not None:
                    rec[k] = (x * 40 / ma, z * 40 / mb)
            for k, (col, att, mn) in PCT.items():
                x, z, ta, tb = f(a[col]), f(b[col]), f(a[att]), f(b[att])
                # both seasons need real volume, and the 2025-26 made/attempted swap is screened out
                if x is not None and z is not None and ta and tb and ta >= mn and tb >= mn and 0 < x <= 100 and 0 < z <= 100:
                    rec[k] = (x, z)
            pairs.setdefault(st, []).append(rec)
    out = {"meta": {"pairs": {k: len(v) for k, v in pairs.items()}, "min_mpg": MIN_MPG, "min_gp": MIN_GP,
                    "note": "next = a + b*this, per class step; same-school returners with 12+ mpg both seasons"},
           "rate": {}, "pct": {}}
    for st, recs in pairs.items():
        for grp, keys in (("rate", RATE), ("pct", PCT)):
            for k in keys:
                pts = [(r[k][0], r[k][1], r["w"]) for r in recs if k in r]
                if len(pts) < 200:
                    continue
                x = np.array([p[0] for p in pts]); z = np.array([p[1] for p in pts]); w = np.array([p[2] for p in pts])
                # trim the wild tails (tiny-sample or data-error seasons) before fitting
                lo, hi = np.percentile(x, [1, 99])
                m = (x >= lo) & (x <= hi)
                x, z, w = x[m], z[m], w[m]
                A = np.vstack([np.ones_like(x), x]).T * np.sqrt(w)[:, None]
                coef, *_ = np.linalg.lstsq(A, z * np.sqrt(w), rcond=None)
                a_, b_ = float(coef[0]), float(coef[1])
                mean_x = float(np.average(x, weights=w)); mean_z = float(np.average(z, weights=w))
                out[grp].setdefault(st, {})[k] = {"a": round(a_, 4), "b": round(b_, 4), "n": int(len(x)),
                                                   "mean_this": round(mean_x, 3), "mean_next": round(mean_z, 3)}
    json.dump(out, open(os.path.join(D, "stat_dev.json"), "w"), indent=1)
    for grp in ("rate", "pct"):
        for st in ("so", "jr", "sr", "gr"):
            row = out[grp].get(st, {})
            print(grp, st, {k: (v["a"], v["b"], f'{v["mean_this"]}->{v["mean_next"]}') for k, v in row.items()}, file=sys.stderr)
    print("pairs", out["meta"]["pairs"], file=sys.stderr)


if __name__ == "__main__":
    main()
