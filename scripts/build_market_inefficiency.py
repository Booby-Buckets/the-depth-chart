#!/usr/bin/env python3
"""build_market_inefficiency.py — Moneyball: what the transfer market pays for vs what actually wins.

Every D-I transfer 2011-2026 (a player whose team changes between two seasons, 200+ minutes before the move):
  MARKET   = how strong a program took him: the destination's Power Rating the season before he arrived
             (the market's verdict on his value — better programs "pay" with a better job).
  OUTCOME  = what he produced after the move: owned BPM at the new school (the ratings engine's player value,
             team-context included), 150+ minutes.
Both are explained by the same pre-move traits (standardized), so each trait gets two numbers: how much the market
rewards it and how much it shows up in the result. Rewarded more than it produces = OVERVALUED; produces more than it
is rewarded = UNDERVALUED. Stability: the same fit on 2011-2018 and 2019-2026 moves separately.

Then the 2026-27 transfer class (data/portal_2027.json): each player's expected outcome from his 2025-26 traits vs the
level of program that took him → who landed below / above what his profile usually produces.

    python3 scripts/build_market_inefficiency.py     -> data/market_inefficiency.json
"""
import json, os, math, collections, urllib.request, datetime
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"; KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}

# owned BPM — the same model tdc-ratings.js uses (estBpm)
BPM_FEATS = ['ts_pct', 'efg_pct', 'tp_pct', 'ft_pct', 'pts40', 'reb40', 'ast40', 'usg_pct', 'ast_pct', 'tov_pct', 'orb_pct', 'drb_pct', 'stl_pct', 'blk_pct', 'ti40']
BPM_COEF = [0.32314, 1.29670, 2.03894, 0.99409, 0.21218, 0.13564, -2.82989, -0.39381, 0.64736, -0.07035, -0.13910, 0.02546, 0.42890, 0.09517, 0.47585]
BPM_B0, BPM_MU, BPM_K, BPM_SRS = -5.17252, -0.5627, 1.0590, 0.31069


def est_bpm(r, srs):
    s = BPM_B0 + BPM_SRS * (srs or 0)
    for f, c in zip(BPM_FEATS, BPM_COEF):
        v = r.get(f)
        if v is None: return None
        s += c * float(v)
    return BPM_MU + (s - BPM_MU) * BPM_K


def get(q, cache=None):
    if cache:
        p = "/tmp/mi_" + cache + ".json"
        if os.path.exists(p) and datetime.datetime.now().timestamp() - os.path.getmtime(p) < 86400: return json.load(open(p))
    out = []
    for off in range(0, 400000, 1000):
        for t in range(4):
            try:
                r = json.load(urllib.request.urlopen(urllib.request.Request(SB + q + f"&limit=1000&offset={off}", headers=H), timeout=90)); break
            except Exception:
                if t == 3: raise
        out += r
        if len(r) < 1000: break
    if cache: json.dump(out, open("/tmp/mi_" + cache + ".json", "w"))
    return out


def height_in(h):
    try:
        a, b = str(h).replace('"', '').split("-"); return int(a) * 12 + int(b)
    except Exception:
        return None


# traits a coach can see before the move (labels are what the page shows)
TRAITS = [
    ("bpm", "Overall impact (BPM)"), ("pts40", "Scoring volume (pts/40)"), ("usg_pct", "Usage rate"), ("ts_pct", "True shooting"),
    ("tp_pct", "3-point %"), ("r3", "3-point attempt rate"), ("ftr", "Free-throw rate"), ("orb_pct", "Off. rebounding %"),
    ("drb_pct", "Def. rebounding %"), ("ast_pct", "Assist rate"), ("tov_pct", "Turnover rate"), ("stl_pct", "Steal rate"),
    ("blk_pct", "Block rate"), ("ht", "Height"), ("mpg", "Minutes per game"), ("yrs", "Seasons played"), ("lvl", "Level he came from (team rating)"),
]


def main():
    adv = get("player_advanced?select=espn_id,season_year,team,name,g,min,ppg,ts_pct,efg_pct,tp_pct,ft_pct,pts40,reb40,ast40,usg_pct,ast_pct,tov_pct,orb_pct,drb_pct,stl_pct,blk_pct,ti40,owa,dwa&espn_id=not.is.null&order=season_year,espn_id,team", "adv")
    hist = get("player_history?select=espn_id,season_year,height,fga,tpa,fta,mpg,gp&espn_id=not.is.null&order=season_year,espn_id,id", "hist")
    ts = get("team_seasons?select=season_year,team,srs,conference&order=season_year,team", "ts")
    SRS = {(r["season_year"], r["team"]): r["srs"] for r in ts if r["srs"] is not None}
    H_ = {}
    for r in hist:
        k = (r["espn_id"], r["season_year"])
        if k not in H_ or (r.get("mpg") or 0) > (H_[k].get("mpg") or 0): H_[k] = r
    first = {}
    P = {}
    for r in adv:
        e, y = r["espn_id"], r["season_year"]; first[e] = min(first.get(e, 9999), y)
        if (r.get("min") or 0) <= (P.get((e, y), {}).get("min") or 0): continue
        P[(e, y)] = r

    def traits(e, y):
        r = P.get((e, y)); h = H_.get((e, y), {})
        if not r or (r.get("min") or 0) < 200: return None
        b = est_bpm(r, SRS.get((y, r["team"])))
        if b is None: return None
        fga = h.get("fga") or 0
        x = {"bpm": b, "pts40": r["pts40"], "usg_pct": r["usg_pct"], "ts_pct": r["ts_pct"], "tp_pct": r["tp_pct"],
             "r3": (h.get("tpa") or 0) / fga if fga else None, "ftr": (h.get("fta") or 0) / fga if fga else None,
             "orb_pct": r["orb_pct"], "drb_pct": r["drb_pct"], "ast_pct": r["ast_pct"], "tov_pct": r["tov_pct"], "stl_pct": r["stl_pct"],
             "blk_pct": r["blk_pct"], "ht": height_in(h.get("height")), "mpg": (r["min"] / r["g"]) if r.get("g") else None,
             "yrs": y - first.get(e, y) + 1, "lvl": SRS.get((y, r["team"]))}
        return x

    # ── every transfer 2011-2026 ──
    moves = []
    for (e, y), r in P.items():
        gap_yr = 1; n = P.get((e, y + 1))
        if not n and y + 2 <= 2026 and (e, y + 2) in P: gap_yr, n = 2, P[(e, y + 2)]   # pre-2021 transfers sat out a year
        if not n or n["team"] == r["team"]: continue
        x = traits(e, y)
        if not x or any(v is None for v in x.values()): continue
        ya = y + gap_yr                                       # the season he played at the new school
        dest = SRS.get((ya - 1, n["team"]))                   # the destination's rating the season before he arrived
        if dest is None: continue
        out = est_bpm(n, SRS.get((ya, n["team"]))) if (n.get("min") or 0) >= 150 else None
        moves.append({"e": e, "y": ya, "sat": gap_yr == 2, "name": r["name"], "from": r["team"], "to": n["team"], "x": x, "demand": dest, "out": out,
                      "min_next": n.get("min") or 0, "wa_next": (n.get("owa") or 0) + (n.get("dwa") or 0)})
    print(f"{len(moves)} transfers with full traits; {sum(m['out'] is not None for m in moves)} with a 150+ minute season after")

    keys = [k for k, _ in TRAITS]
    def fit(rows, target):
        X = np.array([[m["x"][k] for k in keys] for m in rows], float); yv = np.array([m[target] for m in rows], float)
        mu, sd = X.mean(0), X.std(0); Z = (X - mu) / sd; ym, ys = yv.mean(), yv.std()
        A = np.hstack([np.ones((len(Z), 1)), Z]); L = np.eye(A.shape[1]) * 5.0; L[0, 0] = 0
        b = np.linalg.solve(A.T @ A + L, A.T @ ((yv - ym) / ys))
        pred = A @ b; r2 = 1 - ((yv - ym) / ys - pred).var() / ((yv - ym) / ys).var()
        return b[1:], mu, sd, (ym, ys), r2

    both = [m for m in moves if m["out"] is not None]
    res = {}
    for name, rows in (("all", both), ("early", [m for m in both if m["y"] <= 2021]), ("late", [m for m in both if m["y"] >= 2022])):
        bd, mu, sd, dm, r2d = fit(rows, "demand"); bo, _, _, om, r2o = fit(rows, "out")
        res[name] = dict(n=len(rows), bd=bd, bo=bo, r2d=r2d, r2o=r2o, mu=mu, sd=sd, dm=dm, om=om)
        print(f"{name:6} n={len(rows):5}  market R2 {r2d:.2f}  outcome R2 {r2o:.2f}")
    A = res["all"]
    rng = np.random.default_rng(7); boots = []
    for _ in range(200):
        smp = [both[i] for i in rng.integers(0, len(both), len(both))]
        boots.append(fit(smp, "out")[0] - fit(smp, "demand")[0])
    lo, hi = np.percentile(np.array(boots), [2.5, 97.5], axis=0)
    rows = []
    for i, (k, lab) in enumerate(TRAITS):
        gap = A["bo"][i] - A["bd"][i]
        stable = np.sign(res["early"]["bo"][i] - res["early"]["bd"][i]) == np.sign(res["late"]["bo"][i] - res["late"]["bd"][i])
        rows.append({"k": k, "label": lab, "market": round(float(A["bd"][i]), 3), "wins": round(float(A["bo"][i]), 3), "gap": round(float(gap), 3),
                     "early_gap": round(float(res["early"]["bo"][i] - res["early"]["bd"][i]), 3), "late_gap": round(float(res["late"]["bo"][i] - res["late"]["bd"][i]), 3),
                     "stable": bool(stable), "lo": round(float(lo[i]), 3), "hi": round(float(hi[i]), 3),
                     "sig": bool(lo[i] > 0 or hi[i] < 0)})
    rows.sort(key=lambda r: r["gap"])
    print("\ntrait                              market   wins    gap   (early / late)")
    for r in rows: print(f"  {r['label']:32} {r['market']:+.3f} {r['wins']:+.3f} {r['gap']:+.3f} [{r['lo']:+.3f},{r['hi']:+.3f}] ({r['early_gap']:+.3f} / {r['late_gap']:+.3f}){'' if r['stable'] else '  unstable'}{'  *' if r['sig'] else ''}")

    # does the market know something the stats don't? outcome ~ trait prediction + destination level
    Z = np.array([[(m["x"][k] - A["mu"][j]) / A["sd"][j] for j, k in enumerate(keys)] for m in both])
    predO = Z @ A["bo"]
    dz = (np.array([m["demand"] for m in both]) - A["dm"][0]) / A["dm"][1]
    oz = (np.array([m["out"] for m in both]) - A["om"][0]) / A["om"][1]
    M = np.vstack([np.ones(len(oz)), predO, dz]).T
    cf = np.linalg.lstsq(M, oz, rcond=None)[0]
    print(f"\noutcome_z ≈ {cf[0]:+.2f} + {cf[1]:.2f}·traits + {cf[2]:.2f}·destination level")

    # pickups judged against their NEW level: the full model (traits + destination level) vs what transfers to a program of
    # that level typically produce (destination level alone) — both in BPM, so the gap reads as BPM over a typical pickup
    Mf = np.hstack([np.ones((len(Z), 1)), Z, dz[:, None]]); Lf = np.eye(Mf.shape[1]) * 5.0; Lf[0, 0] = 0
    bfull = np.linalg.solve(Mf.T @ Mf + Lf, Mf.T @ oz)
    btyp = np.linalg.lstsq(np.vstack([np.ones(len(dz)), dz]).T, oz, rcond=None)[0]
    pred_full = Mf @ bfull; typ = btyp[0] + btyp[1] * dz
    hit = np.corrcoef(pred_full - typ, oz - typ)[0, 1]
    print(f"pickup gap vs actual over-typical: r={hit:.2f}")

    # ── the 2026-27 transfer class ──
    portal = json.load(open(os.path.join(ROOT, "data", "portal_2027.json")))["players"]
    cur = []
    for p in portal:
        try: e = int(p.get("espn") or 0)
        except ValueError: continue
        x = traits(e, 2026)
        if not x or any(v is None for v in x.values()) or not p.get("to"): continue
        dest = SRS.get((2026, p["to"]))
        if dest is None: continue
        z = np.array([(x[k] - A["mu"][j]) / A["sd"][j] for j, k in enumerate(keys)])
        act_mkt = (dest - A["dm"][0]) / A["dm"][1]
        full = float(bfull[0] + z @ bfull[1:-1] + bfull[-1] * act_mkt); tp_ = float(btyp[0] + btyp[1] * act_mkt)
        cur.append({"espn": e, "name": p["name"], "pos": p.get("pos"), "from": p["from"], "to": p["to"], "toConf": p.get("toConf"),
                    "bpm": round(x["bpm"], 1), "pts40": round(x["pts40"], 1), "ts": round(100 * x["ts_pct"], 1), "mpg": round(x["mpg"], 1),
                    "from_lvl": round(x["lvl"], 1), "to_lvl": round(dest, 1),
                    "exp_bpm": round(A["om"][0] + full * A["om"][1], 1), "typ_bpm": round(A["om"][0] + tp_ * A["om"][1], 1),
                    "gap": round((full - tp_) * A["om"][1], 1)})   # BPM above a typical transfer to a program of this level
    cur.sort(key=lambda r: -r["gap"])
    print(f"\n2026-27 class scored: {len(cur)}")
    for r in cur[:8]: print("  under-rewarded", r["name"], r["from"], "->", r["to"], r["exp_bpm"], r["gap"])
    for r in cur[-5:]: print("  over-rewarded ", r["name"], r["from"], "->", r["to"], r["exp_bpm"], r["gap"])

    # ── market blind-spot index for every 2025-26 player (GM Mode): the significant, era-stable gaps as weights on his
    # standardized traits — positive = a profile the transfer market has historically under-paid for. Percentile vs D-I.
    W = {r["k"]: r["gap"] for r in rows if r["sig"] and r["stable"]}
    allx = {}
    for (e, y) in list(P.keys()):
        if y != 2026: continue
        x = traits(e, 2026)
        if x and all(x.get(k) is not None for k in W): allx[e] = x
    if allx and W:
        mu = {k: np.mean([x[k] for x in allx.values()]) for k in W}; sd = {k: np.std([x[k] for x in allx.values()]) or 1 for k in W}
        raw = {e: sum(W[k] * (x[k] - mu[k]) / sd[k] for k in W) for e, x in allx.items()}
        vals = sorted(raw.values())
        idx = {str(e): int(round(100 * np.searchsorted(vals, v, side="right") / len(vals))) for e, v in raw.items()}   # espn -> percentile
        json.dump({"built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "season": 2026,
                   "weights": {k: round(v, 3) for k, v in W.items()}, "labels": {k: l for k, l in TRAITS if k in W}, "players": idx},
                  open(os.path.join(ROOT, "data", "market_index_2026.json"), "w"), separators=(",", ":"))
        print(f"blind-spot index: {len(idx)} players · weights {W}")

    json.dump({"built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
               "n_moves": len(both), "seasons": [min(m["y"] for m in both), max(m["y"] for m in both)],
               "r2": {"market": round(A["r2d"], 3), "wins": round(A["r2o"], 3)},
               "market_info": {"traits": round(float(cf[1]), 3), "destination": round(float(cf[2]), 3)},
               "pickup_check": round(float(hit), 3),
               "scale": {"dest_sd": round(float(A["dm"][1]), 2), "bpm_sd": round(float(A["om"][1]), 2)},
               "eras": {"early": [min(m["y"] for m in both if m["y"] <= 2021), 2021, res["early"]["n"]], "late": [2022, 2026, res["late"]["n"]]},
               "traits": rows, "class2027": cur}, open(os.path.join(ROOT, "data", "market_inefficiency.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
