#!/usr/bin/env python3
"""Backtest: were preseason lines systematically too tight (or too wide)?

For every completed game in a season, the PRESEASON line is built from the two
teams' preseason projections — the true prior-year-roster projection in
team_dna_proj.json (build_historical_projection.py), on a points-per-game scale
at the league's average pace — and regressed against the actual margin:

    actual margin = a + b · (projA − projB) + c · home   (neutral games: home = 0)

b is the calibration slope of the projected gap. b ≈ 1 → the spread scale is
right; b > 1 → projections are too compressed and gaps should be stretched by b;
b < 1 → too wide. c is the implied home edge. Reported per season, pooled, and
for the first 10 games of each team's season only (when preseason lines matter),
plus the same fit using last season's SRS as the "projection" for comparison.
Read-only; prints a table.
"""
import json, statistics as st
from collections import defaultdict
from pathlib import Path
import numpy as np

DATA = Path(__file__).parent / "data"
PACE = 68.0                     # league-average possessions → per-100 net to per-game points

proj = json.load(open(DATA / "team_dna_proj.json"))          # season → team → {net}
srs = {}
for line in open(DATA / "team_seasons.jsonl"):
    r = json.loads(line)
    if r.get("srs") is not None:
        srs[(r["team"], r.get("season_year") or r.get("season"))] = float(r["srs"])

games = defaultdict(list)
for line in open(DATA / "games.jsonl"):
    g = json.loads(line)
    if g.get("status") != "STATUS_FINAL" or g.get("home_score") is None:
        continue
    games[g.get("season") or g.get("season_year")].append(g)


def fit(rows):
    """rows: (gap, home, margin) → (b, c, n, rmse)"""
    if len(rows) < 200:
        return None
    X = np.array([[1.0, r[0], r[1]] for r in rows]); y = np.array([r[2] for r in rows])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    res = y - X @ beta
    return beta[1], beta[2], len(rows), float(np.sqrt(np.mean(res ** 2)))


def season_rows(yr, source):
    """source: 'proj' (preseason roster projection) or 'prior' (last season's SRS)"""
    rows, early = [], []
    seen = defaultdict(int)
    for g in sorted(games[yr], key=lambda g: g["date"]):
        h, a = g["home"], g["away"]
        if source == "proj":
            P = proj.get(str(yr), {})
            if h not in P or a not in P: continue
            gap = (P[h]["net"] - P[a]["net"]) * PACE / 100
        else:
            if (h, yr - 1) not in srs or (a, yr - 1) not in srs: continue
            gap = srs[(h, yr - 1)] - srs[(a, yr - 1)]
        home = 0.0 if g.get("neutral") else 1.0
        row = (gap, home, g["home_score"] - g["away_score"])
        rows.append(row)
        if seen[h] < 10 and seen[a] < 10: early.append(row)
        seen[h] += 1; seen[a] += 1
    return rows, early


print(f"{'season':7s} {'source':6s} {'games':>6s} {'slope b':>8s} {'home c':>7s} {'rmse':>6s}   {'first-10 b':>10s} {'n':>5s}")
pooled = {"proj": ([], []), "prior": ([], [])}
for yr in range(2013, 2027):
    for source in ("proj", "prior"):
        rows, early = season_rows(yr, source)
        f, fe = fit(rows), fit(early)
        if not f: continue
        pooled[source][0].extend(rows); pooled[source][1].extend(early)
        print(f"{yr-1}-{str(yr)[2:]:3s} {source:6s} {f[2]:6d} {f[0]:8.2f} {f[1]:7.2f} {f[3]:6.1f}   {fe[0] if fe else float('nan'):10.2f} {fe[2] if fe else 0:5d}")
print()
for source in ("proj", "prior"):
    f, fe = fit(pooled[source][0]), fit(pooled[source][1])
    sd = st.pstdev([r[0] for r in pooled[source][0]])
    print(f"POOLED {source:6s} games {f[2]:6d}  slope {f[0]:.2f}  home {f[1]:.2f}  rmse {f[3]:.1f}  | first-10 slope {fe[0]:.2f} (n={fe[2]})  | gap sd {sd:.1f}")
print("\nslope > 1: preseason gaps too tight by that factor; < 1: too wide. 'prior' = last season's SRS as the projection.")
