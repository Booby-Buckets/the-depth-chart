#!/usr/bin/env python3
"""
backtest_cbb_lines.py — does a ratings model add anything to college closing lines? (free data: scrape_espn_lines.py)

Walk-forward, no hindsight: each game is priced only from results BEFORE its date.
  prior     last season's final margin ratings (least squares over all its games), shrunk toward 0
  in-season a margin Elo: after each game both teams move by K x (actual margin − predicted margin)
  line      home margin = r_home − r_away + home court (0 on neutral courts)
Then, against the books' closing spread (median across the real books ESPN kept):
  - average miss of the market vs ours vs blends; the blend weight on ours that predicts margins best
  - against-the-spread record when we disagree with the close by 2 / 3 / 4 / 6+ points (52.4% breaks even at −110)

  python3 scripts/backtest_cbb_lines.py --seasons 2017,2018,...   (writes scripts/data/backtest_cbb_lines.json)
"""
import json, os, sys, gzip, math
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
NOT_BOOKS = {"consensus", "accuscore", "numberfire", "teamrankings", "Opening", "ESPN Bet - Live Odds"}


def arg(k, d=None):
    a = sys.argv[1:]
    return a[a.index(k) + 1] if k in a else d


def load_games():
    by = defaultdict(list)
    with open(os.path.join(DATA, "games.jsonl")) as f:
        for line in f:
            g = json.loads(line)
            if g.get("status") == "STATUS_FINAL" and g.get("home_score") is not None:
                by[g["season"]].append(g)
    for s in by:
        by[s].sort(key=lambda g: (g["date"], g["id"]))
    return by


def final_ratings(games, iters=200, hca=3.0):
    """Least-squares margin ratings for a whole season (Gauss–Seidel)."""
    r = defaultdict(float); opp = defaultdict(list)
    for g in games:
        h = 0 if g.get("neutral") else hca
        m = g["home_score"] - g["away_score"] - h
        opp[g["home"]].append((g["away"], m)); opp[g["away"]].append((g["home"], -m))
    for _ in range(iters):
        for t, lst in opp.items():
            r[t] = sum(m + r[o] for o, m in lst) / len(lst)
        mu = sum(r.values()) / len(r)
        for t in r:
            r[t] -= mu
    return r


def market(books):
    sp = sorted(b["spread"] for k, b in books.items() if k not in NOT_BOOKS and "Live" not in k and b.get("spread") is not None)
    if not sp:
        return None
    n = len(sp); return sp[n // 2] if n % 2 else (sp[n // 2 - 1] + sp[n // 2]) / 2


def main():
    seasons = [int(x) for x in arg("--seasons", "2017,2018,2019,2022,2023,2024").split(",")]
    G = load_games()
    K = float(arg("--k", "0.06")); PRIOR = float(arg("--prior", "0.6")); HCA = float(arg("--hca", "3.0"))
    rows = []
    for s in seasons:
        path = os.path.join(DATA, "hist", "espn_lines_%d.jsonl.gz" % s)
        if not os.path.exists(path) or s - 1 not in G:
            print("skip", s); continue
        lines, opens = {}, {}
        with gzip.open(path, "rt") as f:
            for line in f:
                x = json.loads(line); m = market(x["books"])
                if m is not None:
                    lines[x["id"]] = m
                o = (x["books"].get("Opening") or {}).get("spread")
                if o is not None:
                    opens[x["id"]] = o
        prev = final_ratings(G[s - 1])
        r = defaultdict(float, {t: PRIOR * v for t, v in prev.items()})
        for g in G[s]:                                    # walk forward: price, record, THEN update
            h = 0 if g.get("neutral") else HCA
            pred = r[g["home"]] - r[g["away"]] + h
            act = g["home_score"] - g["away_score"]
            if g["id"] in lines:
                rows.append({"s": s, "ours": pred, "mkt": -lines[g["id"]], "act": act,           # market home margin = −spread
                             "open": -opens[g["id"]] if g["id"] in opens else None})
            err = act - pred
            r[g["home"]] += K * err; r[g["away"]] -= K * err
        print("season %d: %d games with a closing line" % (s, sum(1 for x in rows if x["s"] == s)), flush=True)
    if not rows:
        return
    n = len(rows)
    mae = lambda f: sum(abs(f(x) - x["act"]) for x in rows) / n
    out = {"n": n, "seasons": seasons, "k": K, "prior": PRIOR, "hca": HCA,
           "mae_market": round(mae(lambda x: x["mkt"]), 3), "mae_ours": round(mae(lambda x: x["ours"]), 3), "blend": {}, "ats": {}}
    for w in [i / 20 for i in range(0, 11)]:
        out["blend"][str(w)] = round(mae(lambda x: w * x["ours"] + (1 - w) * x["mkt"]), 3)
    best = min(out["blend"].items(), key=lambda kv: kv[1])
    out["best_weight"] = float(best[0])
    for th in (1, 2, 3, 4, 6):
        sel = [x for x in rows if abs(x["ours"] - x["mkt"]) >= th]
        w = l = 0
        for x in sel:
            side = 1 if x["ours"] > x["mkt"] else -1           # +1 = we like the home side vs the close
            v = side * (x["act"] - x["mkt"])
            if v > 0: w += 1
            elif v < 0: l += 1
        out["ats"][str(th)] = {"n": w + l, "w": w, "l": l, "pct": round(w / (w + l), 4) if w + l else None}
    # against the OPENING line (2015-16 / 2016-17 only): beat the opener = closing-line value, the real test of a model
    ro = [x for x in rows if x["open"] is not None]
    out["vs_open"] = {"n": len(ro)}
    for th in (2, 3, 4, 6):
        sel = [x for x in ro if abs(x["ours"] - x["open"]) >= th]
        w = l = clv = 0
        for x in sel:
            side = 1 if x["ours"] > x["open"] else -1
            v = side * (x["act"] - x["open"])
            w += v > 0; l += v < 0
            clv += side * (x["mkt"] - x["open"]) > 0                # did the line move our way by the close?
        out["vs_open"][str(th)] = {"n": w + l, "pct": round(w / (w + l), 4) if w + l else None, "moved_our_way": round(clv / len(sel), 3) if sel else None}
    json.dump(out, open(os.path.join(DATA, "backtest_cbb_lines.json"), "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
