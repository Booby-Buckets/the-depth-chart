#!/usr/bin/env python3
"""Backtest the returner projection on a season it never saw.

Train: the per-stat development fits (same method as build_stat_dev.py) on season pairs whose second
season is 2024-25 or earlier. Test: every same-school returner of 2025-26 with 10+ games and 10+ mpg,
projected from his 2024-25 line only. Output: scripts/data/projection_backtest.json (the accuracy
page reads it).

What is replayed: the player half of build_stat_overall_projected.py — per-40 rates developed by class
step, shooting % regressed by sample (same constants), shot volume at his shown usage — scaled to his
ACTUAL 2025-26 minutes. Minutes are scored separately (the returner minutes rule vs "same as last
year"), because last season's depth charts were never saved. Usage redistribution after departures
and the team scoring fit are not replayed (they need last season's full rosters and team ratings).

Baselines: "same as last year" (last season's per-game line) and "same per minute" (last season's
per-40 rates at this season's minutes, i.e. the model with no development or regression).
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_stat_dev as B

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
TEST = 2026                       # 2025-26, projected from 2024-25
POS_FG, POS_TP, POS_FT = 45.0, 34.0, 71.0   # league-average anchors (the build uses positional ones)
REG_FG, REG_FT, REG_TPA_K = 0.15, 0.20, 150.0
TRUST_KEEP, TRUST_MIN = 0.97, 20.0


def fit(pairs):
    """next = a + b*this per stat, weighted — the build_stat_dev.py fit, on the training pairs only"""
    out = {}
    for k in pairs[0]["v"]:
        pts = [(p["v"][k][0], p["v"][k][1], p["w"]) for p in pairs if k in p["v"]]
        x = np.array([q[0] for q in pts]); z = np.array([q[1] for q in pts]); w = np.array([q[2] for q in pts])
        lo, hi = np.percentile(x, [1, 99]); m = (x >= lo) & (x <= hi)
        A = np.vstack([np.ones(m.sum()), x[m]]).T * np.sqrt(w[m])[:, None]
        c, *_ = np.linalg.lstsq(A, z[m] * np.sqrt(w[m]), rcond=None)
        out[k] = (float(c[0]), float(c[1]), float(np.average(x[m], weights=w[m])), float(np.average(z[m], weights=w[m])))
    return out


def main():
    rows = B.pull(); seasons = B.pull_seasons()
    by = {}
    for r in rows:
        if (B.f(r["gp"]) or 0) < 10:
            continue
        by.setdefault(int(r["espn_id"]), {})[int(r["season_year"])] = r
    RATE = {"pts": "ppg", "oreb": "oreb", "dreb": "dreb", "ast": "apg", "stl": "stl", "blk": "blk", "tov": "tovs"}
    train, test, mtrain = {}, [], {}
    for e, S in by.items():
        played = seasons.get(e, set())
        if min(played, default=0) <= 2007:
            continue
        for y, a in S.items():
            b = S.get(y + 1)
            if not b or (a["team"] or "").strip().lower() != (b["team"] or "").strip().lower():
                continue
            st = B.step_of(len([s for s in played if s <= y + 1]))
            if not st:
                continue
            ma, mb = B.f(a["mpg"]), B.f(b["mpg"])
            if y + 1 == TEST:
                test.append((st, a, b)); continue
            w = min(ma * B.f(a["gp"]), mb * B.f(b["gp"]))
            mtrain.setdefault(st, []).append((ma, mb))
            v = {}
            for k, col in RATE.items():
                x, z = B.f(a[col]), B.f(b[col])
                if x is not None and z is not None:
                    v[k] = (x * 40 / ma, z * 40 / mb)
            x, z = B.f(a["ft_pct"]), B.f(b["ft_pct"])
            if x and z and (B.f(a["fta"]) or 0) >= 1 and (B.f(b["fta"]) or 0) >= 1 and x <= 100 and z <= 100:
                v["ft"] = (x, z)
            train.setdefault(st, []).append({"w": w, "v": v})
    fits = {st: fit(p) for st, p in train.items()}
    # minutes: next mpg = a + b*this per class step, same training seasons
    MFIT = {}
    for st, recs in mtrain.items():
        x = np.array([q[0] for q in recs]); z = np.array([q[1] for q in recs])
        c, *_ = np.linalg.lstsq(np.vstack([np.ones_like(x), x]).T, z, rcond=None); MFIT[st] = (float(c[0]), float(c[1]))

    def proj(st, a, mpg):
        """the returner line at `mpg` minutes, from last season `a` only"""
        F = fits.get(st, {}); ma = B.f(a["mpg"])
        p40 = lambda col: (B.f(a[col]) or 0) * 40 / ma
        rate = lambda k, col: max(0.0, F[k][0] + F[k][1] * p40(col)) if k in F else p40(col)
        fga40, tpa40, fta40 = p40("fga"), p40("tpa"), p40("fta")
        fg = B.f(a["fg_pct"]) or POS_FG; tp = B.f(a["tp_pct"]) or POS_TP; ft = B.f(a["ft_pct"]) or POS_FT
        tpa_tot = (B.f(a["tpa"]) or 0) * (B.f(a["gp"]) or 0); cred = tpa_tot / (tpa_tot + REG_TPA_K)
        fg_p = (1 - REG_FG) * fg + REG_FG * POS_FG
        tp_p = cred * tp + (1 - cred) * POS_TP
        ft_p = (1 - REG_FT) * ft + REG_FT * POS_FT + ((F["ft"][3] - F["ft"][2]) if "ft" in F else 0)
        tp_p = min(48, max(20, tp_p)); fg_p = min(72, max(30, fg_p)); ft_p = min(95, max(45, ft_p))
        sc = mpg / 40.0
        fga, tpa, fta = fga40 * sc, tpa40 * sc, fta40 * sc
        pts = 2 * fga * fg_p / 100 + tpa * tp_p / 100 + fta * ft_p / 100   # 2*fgm counts every make as 2; +tpm adds the 3rd point
        if "pts" in F: pts = rate("pts", "ppg") * sc   # the build's returner scoring: points per 40 fit directly
        return {"ppg": pts, "rpg": (rate("oreb", "oreb") + rate("dreb", "dreb")) * sc, "apg": rate("ast", "apg") * sc,
                "stl": rate("stl", "stl") * sc, "blk": rate("blk", "blk") * sc, "tovs": rate("tov", "tovs") * sc,
                "ft_pct": ft_p, "tp_pct": tp_p}

    STATS = ["ppg", "rpg", "apg", "stl", "blk", "tovs", "ft_pct", "tp_pct"]
    err = {s: {"model": [], "last": [], "rate": []} for s in STATS}
    mins = {"model": [], "last": []}
    blind = {s_: {"model": [], "last": [], "wins": 0} for s_ in ("ppg", "rpg", "apg")}
    n = 0
    examples = []
    for st, a, b in test:
        mb, ma = B.f(b["mpg"]), B.f(a["mpg"])
        if mb < 10:
            continue
        n += 1
        m = proj(st, a, mb)
        for s in STATS:
            act = B.f(b[s])
            if act is None:
                continue
            if s in ("ft_pct", "tp_pct"):
                att = "fta" if s == "ft_pct" else "tpa"
                if (B.f(a[att]) or 0) < 1.5 or (B.f(b[att]) or 0) < 1.5 or act > 100:
                    continue
            last = B.f(a[s])
            per_min = last if s.endswith("pct") else (last or 0) * mb / ma
            err[s]["model"].append(abs(m[s] - act)); err[s]["last"].append(abs((last or 0) - act)); err[s]["rate"].append(abs(per_min - act))
        # minutes: the returner rule (proven 20+ mpg keeps 97%, else last year) vs same as last year
        mm = MFIT[st][0] + MFIT[st][1] * ma if st in MFIT else ma
        mins["model"].append(abs(mm - mb)); mins["last"].append(abs(ma - mb))
        # fully blind: minutes predicted too, vs "same as last year"
        mf = proj(st, a, mm)
        for s_ in ("ppg", "rpg", "apg"):
            act = B.f(b[s_])
            if act is not None:
                blind[s_]["model"].append(abs(mf[s_] - act)); blind[s_]["last"].append(abs((B.f(a[s_]) or 0) - act))
                if abs(mf[s_] - act) < abs((B.f(a[s_]) or 0) - act): blind[s_]["wins"] += 1
        examples.append({"name": b.get("name"), "team": b["team"], "step": st, "last_ppg": B.f(a["ppg"]), "proj_ppg": round(m["ppg"], 1), "act_ppg": B.f(b["ppg"]),
                         "last_rpg": B.f(a["rpg"]), "proj_rpg": round(m["rpg"], 1), "act_rpg": B.f(b["rpg"])})
    res = {"season": "2025-26", "trained_through": "2024-25", "n_players": n,
           "note": "Same-school returners with 10+ games and 10+ mpg in 2025-26, projected from 2024-25 only. "
                   "Rates are scored at each player's actual 2025-26 minutes; minutes are scored separately.",
           "stats": {}, "minutes": {k: round(float(np.mean(v)), 2) for k, v in mins.items()}, "minutes_fit": {k: [round(v[0], 2), round(v[1], 3)] for k, v in MFIT.items()},
           "blind": {s_: {"mae_model": round(float(np.mean(v["model"])), 3), "mae_last": round(float(np.mean(v["last"])), 3),
                          "closer_share": round(v["wins"] / max(1, len(v["model"])), 3)} for s_, v in blind.items()}}
    for s in STATS:
        e = err[s]
        if not e["model"]:
            continue
        res["stats"][s] = {"n": len(e["model"]), "mae_model": round(float(np.mean(e["model"])), 3),
                           "mae_last": round(float(np.mean(e["last"])), 3), "mae_rate": round(float(np.mean(e["rate"])), 3)}
    json.dump(res, open(os.path.join(D, "projection_backtest.json"), "w"), indent=1)
    print(json.dumps(res, indent=1), file=sys.stderr)


if __name__ == "__main__":
    main()
