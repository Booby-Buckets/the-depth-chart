#!/usr/bin/env python3
"""backtest_rating_net.py — should the ranking number blend Power Rating with projected NET?

Reuses backtest_preseason.build_rows(): every D-I team-season 2011-2026 with preseason-knowable signals and
rolling-origin predictions of its FINAL Power Rating (team_seasons.srs). "roster+program" is the stand-in for
our live Power Rating (roster value + 3 years of program history). Adds the projected NET from
team_dna_proj.json (build_historical_projection.py: each roster's PRIOR-year player DNA → net per 100
possessions), put on the per-game scale (× 0.68 possessions/100), and scores, out of sample (2016-2026):

  · Power Rating proxy alone   · NET alone (raw, and refit linearly)   · rolling-fit Power+NET
  · fixed blends  w·Power + (1−w)·NET  for w = 0 … 1   (what we'd ship: one weight, same scale)

Caveat: the NET model's coefficients were fit on all seasons at once (a mild in-sample edge for NET), and both
signals use who actually played that season (the same small leak for every model).

    python3 scripts/backtest_rating_net.py    -> scripts/data/rating_net_backtest.json
"""
import json, math, os
import numpy as np
from backtest_preseason import build_rows, TEST0, TEST1, D

PACE = 0.68


def main():
    rows = build_rows()[0]
    proj = json.load(open(os.path.join(D, "team_dna_proj.json")))
    for r in rows:
        x = proj.get(str(r["y"]), {}).get(r["t"])
        r["net"] = x["net"] * PACE if x and x.get("net") is not None else None
    base = [r for r in rows if TEST0 + 3 <= r["y"] <= TEST1 and "pr_roster+program" in r]
    test = [r for r in base if r["net"] is not None]
    print(f"{len(test)} of {len(base)} out-of-sample team-seasons have a projected NET")

    # rolling-origin linear fits on NET alone and on Power proxy + NET (train = seasons before y that have both)
    for y in range(TEST0 + 3, TEST1 + 1):
        tr = [r for r in rows if r["y"] < y and r["net"] is not None and "pr_roster+program" in r]
        if len(tr) < 200: continue
        yv = np.array([r["srs"] for r in tr])
        b1 = np.linalg.lstsq(np.array([[1, r["net"]] for r in tr]), yv, rcond=None)[0]
        b2 = np.linalg.lstsq(np.array([[1, r["pr_roster+program"], r["net"]] for r in tr]), yv, rcond=None)[0]
        for r in test:
            if r["y"] == y:
                r["p_netfit"] = b1[0] + b1[1] * r["net"]
                r["p_both"] = b2[0] + b2[1] * r["pr_roster+program"] + b2[2] * r["net"]
                r["w_both"] = (round(float(b2[1]), 3), round(float(b2[2]), 3))
    test = [r for r in test if "p_both" in r]

    def score(f, sub):
        e = np.array([r["srs"] - f(r) for r in sub]); return math.sqrt((e ** 2).mean()), float(abs(e).mean())
    def rank_r(f, sub):
        out = []
        for y in sorted({r["y"] for r in sub}):
            s = [r for r in sub if r["y"] == y]
            a = np.argsort(np.argsort([f(r) for r in s])); b = np.argsort(np.argsort([r["srs"] for r in s]))
            out.append(np.corrcoef(a, b)[0, 1])
        return float(np.mean(out))
    # top-100ish by last season's rating, and the final top 40 (what a Top 25 graphic is judged on)
    top = [r for r in test if r["p1"] > 5]
    def top40_hits(f):   # avg overlap between predicted and actual top 40, per season
        h = []
        for y in sorted({r["y"] for r in test}):
            s = [r for r in test if r["y"] == y]
            P = {r["t"] for r in sorted(s, key=f, reverse=True)[:40]}; A = {r["t"] for r in sorted(s, key=lambda r: r["srs"], reverse=True)[:40]}
            h.append(len(P & A))
        return float(np.mean(h))

    models = {
        "Power Rating (proxy)": lambda r: r["pr_roster+program"],
        "NET alone (raw)": lambda r: r["net"],
        "NET alone (refit)": lambda r: r["p_netfit"],
        "Power + NET (rolling fit)": lambda r: r["p_both"],
    }
    for w in [0.9, 0.8, 0.7, 0.6, 0.5]:
        models[f"blend {int(w*100)}/{int(round((1-w)*100))}"] = (lambda w: lambda r: w * r["pr_roster+program"] + (1 - w) * r["p_netfit"])(w)

    print(f"\nOut-of-sample {TEST0 + 3}-{TEST1}: {len(test)} team-seasons ({len(top)} top-100ish)")
    print(f"{'model':28} {'RMSE':>6} {'MAE':>6} {'rank r':>7} | top100 RMSE   MAE | top-40 hits")
    res = {}
    for k, f in models.items():
        a, m = score(f, test); a2, m2 = score(f, top); rr = rank_r(f, test); hits = top40_hits(f)
        res[k] = dict(rmse=round(a, 3), mae=round(m, 3), rank_r=round(rr, 3), top_rmse=round(a2, 3), top_mae=round(m2, 3), top40_hits=round(hits, 2))
        print(f"{k:28} {a:6.2f} {m:6.2f} {rr:7.3f} |   {a2:6.2f} {m2:6.2f} |  {hits:5.1f}/40")
    # best fixed blend over a fine grid, and the rolling fit's latest weights
    grid = []
    for w in np.linspace(0, 1, 21):
        f = lambda r, w=w: w * r["pr_roster+program"] + (1 - w) * r["p_netfit"]
        grid.append((float(w), score(f, test)[0], score(f, top)[0]))
    bw = min(grid, key=lambda g: g[1]); bwt = min(grid, key=lambda g: g[2])
    last = max(test, key=lambda r: r["y"])["w_both"]
    print(f"\nbest fixed blend (all teams):   {bw[0]:.2f}·Power + {1-bw[0]:.2f}·NET  RMSE {bw[1]:.3f}")
    print(f"best fixed blend (top-100ish):  {bwt[0]:.2f}·Power + {1-bwt[0]:.2f}·NET  RMSE {bwt[2]:.3f}")
    print(f"rolling fit, latest season: final ≈ c + {last[0]}·Power + {last[1]}·NET")
    # per-season: does the best blend beat Power alone consistently?
    wins = 0; yrs = sorted({r["y"] for r in test})
    for y in yrs:
        s = [r for r in test if r["y"] == y]
        if score(lambda r: bw[0] * r["pr_roster+program"] + (1 - bw[0]) * r["p_netfit"], s)[0] < score(models["Power Rating (proxy)"], s)[0]: wins += 1
    print(f"best blend beats Power alone in {wins} of {len(yrs)} seasons")
    json.dump({"n": len(test), "models": res, "best_blend_all": bw, "best_blend_top": bwt, "rolling_latest": last,
               "seasons_won": [wins, len(yrs)]}, open(os.path.join(D, "rating_net_backtest.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
