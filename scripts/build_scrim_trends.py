#!/usr/bin/env python3
"""Preseason TRENDS: what each Reality-weighted scrimmage says about a player (and team), and exactly how
much it moved his 2026-27 projection.

Runs in rebuild-projections.yml right after build_stat_overall_projected.py, against a BASE run of the same
build with the scrimmages switched off (SCRIM_CAP=0 SCRIM_ROT_CAP=0 SOP_OUT_DIR=<base>):

    python3 scripts/build_scrim_trends.py --base <dir>    → scripts/data/scrim_trends_2027.json

    players[espn_id] / fresh["team|name"] = {
        name, team, trend (reality-weighted Game Score per 40 vs his pre-scrimmage projection, shrunk),
        moved: {ovr, mpg, ppg, rpg, apg}   (projection WITH scrimmages − WITHOUT),
        games: [{id, date, opp, site, res, reality, w, gs, min, pts, reb, ast, ..., exp: {min, pts, reb, ast, gmsc}, d40, notes: ["+ ...", "− ..."]}]
    }
    teams[full] = {adj, games: [{id, opp, pred, actual, resid, reality}]}
        adj = Σ reality·(actual − predicted margin) / (Σ reality + TEAM_PRIOR), capped ±TEAM_CAP — tdc-ratings.js
        adds it to the team's rating (scrimAdj). The predicted margin excludes any scrimAdj already published.
"""
import json, math, re, sys, urllib.request, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "scripts" / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1"
KEY = re.search(r"sb_publishable_[A-Za-z0-9_-]+", (ROOT / "player.html").read_text()).group(0)
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
TEAM_PRIOR, TEAM_CAP = 10.0, 2.5
OPP_K = 0.005            # each point of opponent rating trims (or adds) 0.5% to a player's expected output
HCA = 3.0
NEWC_OVR_K, NEWC_OVR_CAP = 0.45, 4.0   # newcomer OVR points per (shrunk) Game Score / 40 of trend
nk = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", (s or "").lower()))
n = lambda v, d=0.0: float(v) if isinstance(v, (int, float)) else d


def get(path):
    out, off = [], 0
    while True:
        rows = json.load(urllib.request.urlopen(urllib.request.Request(f"{SB}/{path}&limit=1000&offset={off}", headers=H), timeout=120))
        out += rows
        if len(rows) < 1000: return out
        off += 1000


def gmsc(x):
    """Hollinger Game Score without fouls (projected lines have none)"""
    return (n(x.get("pts")) + 0.4 * n(x.get("fgm")) - 0.7 * n(x.get("fga")) - 0.4 * (n(x.get("fta")) - n(x.get("ftm")))
            + 0.7 * n(x.get("oreb")) + 0.3 * n(x.get("dreb")) + n(x.get("stl")) + 0.7 * n(x.get("ast")) + 0.7 * n(x.get("blk")) - n(x.get("tov")))


def main():
    base_dir = Path(sys.argv[sys.argv.index("--base") + 1]) if "--base" in sys.argv else None
    if not base_dir or not (base_dir / "stat_overall_projected.json").exists():
        sys.exit("need --base <dir> from the no-scrimmage build (SCRIM_CAP=0 SCRIM_ROT_CAP=0 SOP_OUT_DIR=<dir>)")
    B = json.load(open(base_dir / "stat_overall_projected.json"))["players"]; BF = json.load(open(base_dir / "fresh_fit.json"))
    F = json.load(open(D / "stat_overall_projected.json"))["players"]; FF = json.load(open(D / "fresh_fit.json"))
    R = json.load(open(D / "scrimmage_results_2027.json"))["results"]
    G = {g["id"]: g for g in json.load(open(D / "scrimmages_2027.json"))["games"]}
    pr = json.load(urllib.request.urlopen(urllib.request.Request(f"{SB}/predictive_ratings?season=eq.2027&select=data&limit=1", headers=H), timeout=60))
    T = {t["full"]: t for t in pr[0]["data"]["teams"]} if pr else {}
    rating = lambda full: (T[full]["rating"] - (T[full].get("scrimAdj") or 0)) if full in T else 0.0

    # newcomer lines have only mpg/ppg here: estimate Game Score from points with the returners' own relation
    xs = [(v["ppg"] / v["mpg"] * 40, gmsc(dict(v, pts=v["ppg"], ast=v.get("apg"), tov=v.get("tovs"))) / v["mpg"] * 40) for v in B.values() if n(v.get("mpg")) >= 12]
    mx = sum(a for a, _ in xs) / len(xs); my = sum(b for _, b in xs) / len(xs)
    slope = sum((a - mx) * (b - my) for a, b in xs) / sum((a - mx) ** 2 for a, _ in xs); icpt = my - slope * mx

    # PER-MINUTE projected rates for every stat. Returners: their own pre-scrimmage projected line.
    # Newcomers: the base run only fits minutes + points, so rebounds / assists / shooting come from their last
    # published full line (git HEAD fresh_fit, filled by build_team_projected_box.py), else the returners'
    # position average — scaled so the attempts still add up to his projected points.
    STAT = ("pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb")
    SRC = {"pts": "ppg", "reb": "rpg", "ast": "apg", "tov": "tovs"}
    def rates_of(line):
        mp = n(line.get("mpg"))
        return {k: n(line.get(SRC.get(k, k))) / mp for k in STAT} if mp > 0 else None
    try:
        import subprocess
        HEADFF = json.loads(subprocess.run(["git", "show", "HEAD:scripts/data/fresh_fit.json"], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    except Exception:
        HEADFF = {}
    grp = lambda pos: "big" if re.search(r"C|PF|F$", str(pos or "").upper()) and "G" not in str(pos or "").upper() else ("wing" if re.search(r"SF|F", str(pos or "").upper()) else "guard")
    POSAVG = {}
    for v in B.values():
        if n(v.get("mpg")) < 12 or not n(v.get("rpg")): continue
        r = rates_of(v); g_ = "big" if n(v.get("blk")) / n(v["mpg"]) > 0.035 or n(v.get("oreb")) / n(v["mpg"]) > 0.06 else "guard" if n(v.get("apg")) / n(v["mpg"]) > 0.09 else "wing"
        a = POSAVG.setdefault(g_, {k: 0.0 for k in STAT} | {"_n": 0}); a["_n"] += 1
        for k in STAT: a[k] += r[k]
    for a in POSAVG.values():
        for k in STAT: a[k] /= a["_n"]
    def newcomer_rates(p, bl):
        bmp = n(bl.get("mpg")); pts = n(bl.get("ppg")) / bmp if bmp else 0
        h = (HEADFF.get(p["team"]) or {}).get(p["name"])
        r = rates_of(h) if (h and n(h.get("rpg")) and n(h.get("mpg"))) else None
        if not r: r = dict(POSAVG.get(grp(p.get("position")), POSAVG.get("wing")))
        if r.get("pts"):
            kk = pts / r["pts"]
            for k in ("fgm", "fga", "tpm", "tpa", "ftm", "fta"): r[k] *= kk
        r["pts"] = pts
        return r

    rosters, out_p, out_f, teams = {}, {}, {}, {}
    def roster(full):
        if full not in rosters:
            short = (T.get(full) or {}).get("team")
            rosters[full] = get(f"players?select=name,espn_id,team,depth_order,position,height&team=eq.{urllib.parse.quote(short)}&order=depth_order.asc") if short else []
        return rosters[full]

    for gid, r in sorted(R.items(), key=lambda kv: (G.get(kv[0]) or {}).get("date", "")):
        g = G.get(gid); rl = r.get("reality") or {}
        if not g or r.get("hs") is None: continue
        for side, full, opp, ms, os_ in (("home", g["home"], g["away"], r["hs"], r["as"]), ("away", g["away"], g["home"], r["as"], r["hs"])):
            rs = rl.get(side) or {}; rw = (rs.get("score") or 0) / 100.0
            site = "N" if g.get("neutral") else ("H" if side == "home" else "A")
            # LINEUP-ADJUSTED line (scrim_reality.py miss_pts): each side's rating less the projected value of its
            # rotation players who sat — beating USC without Collins, Reibe and Lewis is not beating USC
            mp = (rl.get("miss_pts") or {}); my_miss = float(mp.get(side) or 0); opp_miss = float(mp.get("away" if side == "home" else "home") or 0)
            pred = (rating(full) - my_miss) - (rating(opp) - opp_miss) + (0 if site == "N" else HCA if site == "H" else -HCA)
            T_ = teams.setdefault(full, {"short": (T.get(full) or {}).get("team"), "games": []})
            T_["games"].append({"id": gid, "date": g["date"], "opp": opp, "site": site, "pred": round(pred, 1), "actual": ms - os_,
                                "resid": round(ms - os_ - pred, 1), "reality": rs.get("score"),
                                **({"opp_missing": (rl.get("away" if side == "home" else "home") or {}).get("missing"), "opp_miss_pts": opp_miss} if opp_miss else {}),
                                **({"my_miss_pts": my_miss} if my_miss else {})})
            box = (r.get("box") or {}).get(side) or {}
            if box.get("totals"): T_["games"][-1]["tot"] = box["totals"]       # team line (partial recaps carry totals too)
            if box.get("partial") or rs.get("boxless"): continue
            ros = roster(full); byk = {nk(p["name"]): p for p in ros}
            # projected starters before the scrimmages: the top 5 by base minutes
            def base_line(p):
                if p.get("espn_id") and str(p["espn_id"]) in B: return B[str(p["espn_id"])], "r"
                f = (BF.get(p["team"]) or {}).get(p["name"]); return (f, "f") if f else (None, None)
            bm = sorted(((n((base_line(p)[0] or {}).get("mpg")), nk(p["name"])) for p in ros), reverse=True)
            starters = {k for _, k in bm[:5]}
            T_["games"][-1]["gs"] = [q.get("rn") or q["name"] for q in box.get("players") or [] if q.get("gs")]
            T_["games"][-1]["proj_gs"] = [p["name"] for p in ros if nk(p["name"]) in starters]
            oppf = max(0.75, min(1.25, 1 - OPP_K * (rating(opp) - opp_miss)))   # the opponent as it actually took the floor
            for q in box.get("players") or []:
                p = byk.get(nk(q.get("rn") or q["name"]))
                if not p: continue
                bl, kind = base_line(p)
                if not bl or not n(bl.get("mpg")): continue
                m = n(q.get("min")); bmp = n(bl["mpg"]); k = m / bmp * oppf if bmp else 0
                rt = rates_of(bl) if kind == "r" else newcomer_rates(p, bl)
                # what we PROJECTED for this game (his projected minutes, adjusted for the opponent) and the same
                # projection at the minutes he actually played ("pace") — the fair yardstick for his production
                proj = {k2: rt[k2] * bmp * oppf for k2 in STAT}; proj["min"] = bmp; proj["gmsc"] = gmsc(proj)
                pace = {k2: rt[k2] * m * oppf for k2 in STAT}; pace["min"] = m; pace["gmsc"] = gmsc(pace)
                exp = {"pts": pace["pts"], "reb": pace["reb"], "ast": pace["ast"], "gmsc": pace["gmsc"]}
                gs = gmsc(q)
                d40 = (gs - exp["gmsc"]) / m * 40 if m >= 4 else None
                notes = []
                if m - bmp >= 5: notes.append(f"+ Played {m:.0f} min, {m - bmp:.0f} more than projected ({bmp:.0f})")
                elif bmp - m >= 5: notes.append(f"− Played {m:.0f} min, {bmp - m:.0f} fewer than projected ({bmp:.0f})")
                pk = nk(p["name"])
                if q.get("gs") and pk not in starters: notes.append("+ Started (projected off the bench)")
                if not q.get("gs") and pk in starters: notes.append("− Came off the bench (projected starter)")
                dp = n(q.get("pts")) - exp["pts"]
                if dp >= 4: notes.append(f"+ {q['pts']} pts, {dp:.0f} above expectation for his minutes")
                elif dp <= -4: notes.append(f"− {q['pts']} pts, {-dp:.0f} below expectation for his minutes")
                tsa = n(q.get("fga")) + 0.44 * n(q.get("fta"))
                if tsa >= 6:
                    ts = n(q.get("pts")) / (2 * tsa) * 100
                    bts = (n(bl.get("ppg")) / (2 * (n(bl.get("fga")) + 0.44 * n(bl.get("fta")))) * 100) if kind == "r" and n(bl.get("fga")) else 54.0
                    if ts - bts >= 10: notes.append(f"+ Efficient: {ts:.0f}% true shooting (projected {bts:.0f}%)")
                    elif bts - ts >= 10: notes.append(f"− Inefficient: {ts:.0f}% true shooting (projected {bts:.0f}%)")
                if exp["reb"] is not None:
                    if n(q.get("reb")) - exp["reb"] >= 3: notes.append(f"+ {q['reb']} rebounds ({exp['reb']:.1f} expected)")
                    elif exp["reb"] - n(q.get("reb")) >= 3: notes.append(f"− {q['reb']} rebounds ({exp['reb']:.1f} expected)")
                if exp["ast"] is not None and n(q.get("ast")) - exp["ast"] >= 3: notes.append(f"+ {q['ast']} assists ({exp['ast']:.1f} expected)")
                if n(q.get("tov")) >= 4: notes.append(f"− {q['tov']} turnovers")
                if n(q.get("pf")) >= 4 and m < 25: notes.append(f"− {q['pf']} fouls in {m:.0f} min")
                ent = {"id": gid, "date": g["date"], "opp": opp, "site": site, "res": ("W " if ms > os_ else "L ") + f"{ms}–{os_}",
                       "reality": rs.get("score"), "w": q.get("w"), "gs": bool(q.get("gs")),
                       **{k2: q.get(k2) for k2 in ("min", "pts", "reb", "ast", "stl", "blk", "tov", "pf", "fgm", "fga", "tpm", "tpa", "ftm", "fta")},
                       "gmsc": round(gs, 1), "exp": {k2: (round(v, 1) if v is not None else None) for k2, v in exp.items()},
                       "proj": {k2: round(v, 1) for k2, v in proj.items()}, "pace": {k2: round(v, 1) for k2, v in pace.items()},
                       "opp_adj": round((oppf - 1) * 100, 1), "opp_rating": round(rating(opp) - opp_miss, 1),
                       "exp_min": round(bmp, 1), "d40": round(d40, 1) if d40 is not None else None, "notes": notes}
                key = str(p["espn_id"]) if kind == "r" else f"{p['team']}|{p['name']}".lower()
                dst = out_p if kind == "r" else out_f
                P = dst.setdefault(key, {"name": p["name"], "team": p["team"], "full": full, "games": []})
                P["games"].append(ent)

    def finish(P, base, fin):
        # the trend as it stood after each scrimmage (timeline stamps)
        acc_w = acc = 0.0
        for e in sorted(P["games"], key=lambda e: e["date"]):
            if e.get("d40") is not None: acc_w += n(e.get("w")); acc += n(e.get("w")) * e["d40"]
            e["trend_after"] = round(acc / (acc_w + 1.0), 1) if acc_w > 0 else 0.0
        ws = [(n(e.get("w")), e["d40"]) for e in P["games"] if e.get("d40") is not None]
        W = sum(w for w, _ in ws)
        P["trend"] = round(sum(w * d for w, d in ws) / (W + 1.0), 1) if W > 0 else 0.0
        P["weight"] = round(W, 2)
        if base and fin:
            P["moved"] = {k: round(n(fin.get(k2)) - n(base.get(k2)), 1) for k, k2 in (("ovr", "ovr"), ("mpg", "mpg"), ("ppg", "ppg"), ("rpg", "rpg"), ("apg", "apg"))
                          if fin.get(k2) is not None and base.get(k2) is not None}
            P["base"] = {k: base.get(k) for k in ("ovr", "mpg", "ppg", "rpg", "apg") if base.get(k) is not None}
            P["now"] = {k: fin.get(k) for k in ("ovr", "mpg", "ppg", "rpg", "apg") if fin.get(k) is not None}
    for k, P in out_p.items(): finish(P, B.get(k), F.get(k))
    # NEWCOMERS: a returner's OVR follows his (scrimmage-blended) projected line, but a newcomer's OVR is
    # a recruiting / editor prior the line never feeds back into — so his trend moves it directly:
    # scrim_ovr = NEWC_OVR_K x trend (Game Score per 40, already shrunk by the Reality weights), capped.
    # Written onto his fresh_fit row (ovr includes it); tdc-projgrade adds it on top of an editor OVR too.
    for k, P in out_f.items():
        t, nm = P["team"], P["name"]; row = (FF.get(t) or {}).get(nm)
        ws = [(n(e.get("w")), e["d40"]) for e in P["games"] if e.get("d40") is not None]; W = sum(w for w, _ in ws)
        tr = sum(w * d for w, d in ws) / (W + 1.0) if W > 0 else 0.0
        if row is not None:
            adj = round(max(-NEWC_OVR_CAP, min(NEWC_OVR_CAP, NEWC_OVR_K * tr)), 1)
            if row.get("ovr") is not None: row["ovr"] = int(round(min(99, row["ovr"] - n(row.get("scrim_ovr")) + adj)))
            row["scrim_ovr"] = adj
        finish(P, (BF.get(t) or {}).get(nm), row)
    json.dump(FF, open(D / "fresh_fit.json", "w"), separators=(",", ":"))
    try: PBOX = json.load(open(D / "team_projected_box.json"))
    except Exception: PBOX = {}
    for full, X in teams.items():
        num = sum((x["reality"] or 0) / 100 * x["resid"] for x in X["games"]); den = sum((x["reality"] or 0) / 100 for x in X["games"])
        X["adj"] = round(max(-TEAM_CAP, min(TEAM_CAP, num / (den + TEAM_PRIOR))), 2)
        # team box vs projection: Reality-weighted scrimmage team line next to the projected per-game line
        tg = [(max(0.05, (x["reality"] or 0) / 100), x["tot"]) for x in X["games"] if x.get("tot")]
        if tg:
            W = sum(w for w, _ in tg)
            avg = lambda k: sum(w * n(t.get(k)) for w, t in tg) / W
            pct = lambda m, a: (sum(w * n(t.get(m)) for w, t in tg) / max(1e-9, sum(w * n(t.get(a)) for w, t in tg)) * 100) if sum(n(t.get(a)) for _, t in tg) else None
            sc = {"ppg": avg("pts"), "fg_pct": pct("fgm", "fga"), "tp_pct": pct("tpm", "tpa"), "ft_pct": pct("ftm", "fta"), "tpa": avg("tpa"), "fga": avg("fga"),
                  "rpg": avg("reb"), "apg": avg("ast"), "tov": avg("tov"), "stl": avg("stl"), "blk": avg("blk")}
            pb = PBOX.get(full) or {}
            X["box"] = {"scrim": {k: (round(v, 1) if v is not None else None) for k, v in sc.items()},
                        "proj": {k: pb.get(k) for k in sc if pb.get(k) is not None}, "n": len(tg)}
    json.dump({"season": 2027, "note": "Reality-weighted scrimmage trends (build_scrim_trends.py). trend = Game Score per 40 vs the pre-scrimmage projection, shrunk; moved = projection with − without scrimmages.",
               "players": out_p, "fresh": out_f, "teams": teams}, open(D / "scrim_trends_2027.json", "w"), separators=(",", ":"))
    print(f"scrim trends: {len(out_p)} returners, {len(out_f)} newcomers, {len(teams)} teams")
    for k, P in sorted(list(out_p.items()) + list(out_f.items()), key=lambda kv: kv[1]["trend"])[:6]:
        print(f"  {P['name']} ({P['team']}): trend {P['trend']:+.1f}  moved {P.get('moved')}")


if __name__ == "__main__":
    main()
