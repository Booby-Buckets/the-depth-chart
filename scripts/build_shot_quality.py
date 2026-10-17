#!/usr/bin/env python3
"""build_shot_quality.py — Shot Quality v2 (shot-quality.html + its drill-down panel).

Every D-I player-season (200+ minutes) and team-season (offense and defense), 2009-10 on, from ESPN play-by-play:

  SHOT QUALITY  points per shot the diet SHOULD score: every attempt at the season's D-I make rate for its shot
                family, and free-throw trips count as shots (a trip is worth ~1.45, the best look in the sport).
                A "shot" = FGA + 0.44·FTA, the true-shooting attempt. Families = rim / floater / post / pull-up 2 /
                other 2s (by distance) / pull-up 3 / other 3s where the feed tags them (2025-26 on), else rim / jumper / 3.
  SHOT-MAKING   actual points per shot minus quality, then
                  · schedule-adjusted: minus the average making the team's opponents ALLOW (and quality minus the
                    looks they allow), solved iteratively over every D-I vs D-I game, offense and defense together;
                  · shrunk (empirical Bayes): each value is pulled toward 0 by its own sampling noise, so a hot
                    300-shot season does not outrank a proven 900-shot one.
  SELF-CREATED  share of made field goals that were unassisted (from the mastery feed, 2011-12 on).

Inputs (all already built): shot_aftermath/prof_<y>.json + tprof_<y>.json (zones, minutes, possessions),
mastery/<y>.json (shot families + assisted makes), Supabase games (schedule) + team_seasons (names, conferences).

    python3 scripts/build_shot_quality.py [season ...]   -> scripts/data/shot_quality/<y>.json, index.json, careers/<0-9>.json

A season in progress (2026-27, nightly in shot-analytics.yml) is skipped until SQ_MIN_GAMES D-I games are final,
so the page's season picker (index.json = the season files on disk) only offers it once teams clear TEAM_POSS and
regulars clear MIN_MIN. Files whose data didn't change keep their bytes (and built stamp): a quiet night commits nothing.
"""
import json, os, sys, glob, math, urllib.request, datetime

HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, "data")
SA, MA, OUT = os.path.join(DATA, "shot_aftermath"), os.path.join(DATA, "mastery"), os.path.join(DATA, "shot_quality")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"; KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
MIN_MIN, MIN_SHOTS, TEAM_POSS = 200, 40, 500
SQ_MIN_GAMES = int(os.environ.get("SQ_MIN_GAMES", 1500))   # ~9 games a team: most teams past TEAM_POSS, starters past MIN_MIN
FAM = ["rim", "float", "post", "pull2", "short", "long", "mid", "pull3", "three"]
SV = {"pull3": 3, "three": 3}
# display groups for the drill-down: the fine families above fold into these
GROUPS = ["rim", "float", "post", "pull2", "j2", "pull3", "three"]
TO_GROUP = {"rim": "rim", "float": "float", "post": "post", "pull2": "pull2", "short": "j2", "long": "j2", "mid": "j2", "pull3": "pull3", "three": "three"}
r3 = lambda v: None if v is None else round(v, 3)


def get(q):
    out = []
    for off in range(0, 100000, 1000):
        for tries in range(4):
            try:
                r = json.load(urllib.request.urlopen(urllib.request.Request(SB + q + f"&limit=1000&offset={off}", headers=H), timeout=60)); break
            except Exception:
                if tries == 3: raise
        out += r
        if len(r) < 1000: return out
    return out


def diet(counts, fams):
    """counts: {fam: [att, made]} (+ 'ft': [fta, ftm]) -> (fga, pts, shots)"""
    fga = sum(counts[f][0] for f in fams); pts = sum(counts[f][1] * SV.get(f, 2) for f in fams) + counts["ft"][1]
    return fga, pts, fga + 0.44 * counts["ft"][0]


def model(counts, fams, LG):
    """quality (expected points per shot), actual points per shot, sampling variance of the difference"""
    fga, pts, shots = diet(counts, fams)
    if shots <= 0: return None
    xp = sum(counts[f][0] * SV.get(f, 2) * LG[f] for f in fams) + counts["ft"][0] * LG["ft"]
    var = sum(counts[f][0] * SV.get(f, 2) ** 2 * LG[f] * (1 - LG[f]) for f in fams) + counts["ft"][0] * LG["ft"] * (1 - LG["ft"])
    return xp / shots, pts / shots, var / shots ** 2, shots, fga


def put(path, obj):
    """write JSON only when the data (not the built stamp) changed"""
    try:
        old = json.load(open(path))
        if {**old, "built": 0} == {**obj, "built": 0}: return
    except Exception:
        pass
    json.dump(obj, open(path, "w"), separators=(",", ":"))


def season(y):
    if not os.path.exists(os.path.join(SA, f"prof_{y}.json")):
        print(f"{y}: no shot_aftermath/prof_{y}.json yet — skipped"); return
    prof = json.load(open(os.path.join(SA, f"prof_{y}.json")))
    tprof = json.load(open(os.path.join(SA, f"tprof_{y}.json")))
    mp = os.path.join(MA, f"{y}.json"); M = json.load(open(mp)) if os.path.exists(mp) else None
    ts = get(f"team_seasons?season_year=eq.{y}&select=team_id,team,conference&order=team_id")
    live = not ts   # season in progress: team_seasons only gains its rows after it ends
    if live: ts = get(f"team_seasons?season_year=eq.{y - 1}&select=team_id,team,conference&order=team_id")
    names = {str(t["team_id"]): t["team"] for t in ts}; confs = {str(t["team_id"]): t.get("conference") or "" for t in ts}
    if live and M:   # the mastery feed's teams carry this season's conferences (realignment, via d1Teams)
        for tid, t in M["teams"].items():
            if t[1]: confs[tid] = t[1]
    if M:
        for tid, t in M["teams"].items():
            names.setdefault(tid, t[0]); confs.setdefault(tid, t[1] or "")

    # ---- which families this season's feed supports: tagged ones only when the league actually has them (>=1% of FGA)
    if M:
        lgA = {f: M["league"][i][0] for i, f in enumerate(FAM)}; tot = sum(lgA.values())
        fams = [f for f in FAM if lgA[f] >= 0.01 * tot]
        fold = {f: (f if f in fams else ("three" if SV.get(f) else "mid")) for f in FAM}   # rare tags fold into a jumper / three
        if "mid" not in fams: fams.append("mid")
    else:
        fams = ["rim", "mid", "three"]; fold = None

    def mcounts(c, fta, ftm):
        out = {f: [0, 0] for f in fams}; ast = made = 0
        for i, f in enumerate(FAM):
            a, m, s = c[3 * i], c[3 * i + 1], c[3 * i + 2]
            out[fold[f]][0] += a; out[fold[f]][1] += m; ast += s; made += m
        out["ft"] = [fta, ftm]
        return out, (1 - ast / made) if made >= 20 else None

    def zcounts(r):   # prof / tprof zones: [.., .., fta, ftm, rimA, rimM, midA, midM, 3A, 3M]
        return {"rim": [r[4], r[5]], "mid": [r[6], r[7]], "three": [r[8], r[9]], "ft": [r[2], r[3]]}

    # ---- players: zones/minutes from prof, families + assists from mastery where it has the player
    mrow = {p[0]: p for p in M["players"]} if M else {}
    P = []
    for pid, r in prof["players"].items():
        if r[0] < MIN_MIN or r[1] <= 0: continue
        if pid in mrow:
            p = mrow[pid]; c, selfp = mcounts(p[8:], p[6], p[7]); pf = fams
        else:
            c, selfp, pf = zcounts(r), None, ["rim", "mid", "three"]
        P.append(dict(id=pid, name=prof["names"].get(pid), team=prof["team"].get(pid), pos=prof["pos"].get(pid, ""), min=r[0], poss=r[1], c=c, f=pf, self=selfp))

    # ---- teams: offense families from mastery teamRows when available, defense always zones (no opponent family tags)
    TO = {}
    trow = {t[0]: t for t in M["teamRows"]} if M else {}
    for side in ("off", "def"):
        for tid, r in tprof[side].items():
            if r[1] < TEAM_POSS or tid not in names: continue
            if side == "off" and tid in trow:
                t = trow[tid]; c, selfp = mcounts(t[4:], t[2], t[3]); tf = fams
            else:
                c, selfp, tf = zcounts(r), None, ["rim", "mid", "three"]
            TO.setdefault(side, {})[tid] = dict(id=tid, name=names[tid], conf=confs.get(tid, ""), g=r[0], poss=r[1], c=c, f=tf, self=selfp)

    # ---- league make rates per family (players' pooled counts; zones for the 3-zone fallback)
    def league(rows, keys):
        LG = {}
        for k in keys + ["ft"]:
            a = sum(x["c"][k][0] for x in rows if k in x["c"]); m = sum(x["c"][k][1] for x in rows if k in x["c"])
            LG[k] = m / a if a else 0
        return LG
    allp = [{"c": mcounts(p[8:], p[6], p[7])[0]} for p in M["players"]] if M else [{"c": zcounts(r)} for r in prof["players"].values()]
    LGF = league(allp, fams)
    LGZ = league([{"c": zcounts(r)} for r in prof["players"].values()], ["rim", "mid", "three"])
    # the D-I baseline everyone is measured against: quality / points per shot of the whole league
    lgx = model({k: [sum(x["c"][k][0] for x in allp), sum(x["c"][k][1] for x in allp)] for k in fams + ["ft"]}, fams, LGF)
    LX, LPPS = lgx[0], lgx[1]
    LGZ_X = model({k: [sum(zcounts(r)[k][0] for r in prof["players"].values()), sum(zcounts(r)[k][1] for r in prof["players"].values())] for k in ["rim", "mid", "three", "ft"]}, ["rim", "mid", "three"], LGZ)[0]

    def score(x, defense=False):
        LG, base = (LGF, LX) if x["f"] is fams else (LGZ, LGZ_X)
        mo = model(x["c"], x["f"], LG)
        if not mo: return False
        x["x"], x["pps"], x["sv"], x["shots"], x["fga"] = mo
        x["q"] = x["x"] - base; x["m"] = x["pps"] - x["x"]
        return x["shots"] >= MIN_SHOTS
    P = [p for p in P if score(p)]
    for side in TO: TO[side] = {k: v for k, v in TO[side].items() if score(v)}

    # ---- schedule adjustment: solve offense and defense together over every D-I vs D-I game
    games = get(f"games?season_year=eq.{y}&status=eq.STATUS_FINAL&select=id,home_id,away_id&order=id.asc")
    d1g = sum(1 for g in games if str(g["home_id"]) in names and str(g["away_id"]) in names)
    if d1g < SQ_MIN_GAMES:
        print(f"{y}: only {d1g} D-I games final — waiting for {SQ_MIN_GAMES} before building"); return
    opp = {}
    for g in games:
        h, a = str(g["home_id"]), str(g["away_id"])
        if h in TO.get("off", {}) and a in TO.get("off", {}) and h in TO.get("def", {}) and a in TO.get("def", {}):
            opp.setdefault(h, []).append(a); opp.setdefault(a, []).append(h)
    for key in ("q", "m"):
        off = {t: TO["off"][t][key] for t in TO["off"]}; dfn = {t: TO["def"][t][key] for t in TO["def"]}
        oa, da = dict(off), dict(dfn)
        for _ in range(25):
            oa = {t: off[t] - (sum(da[o] for o in opp[t]) / len(opp[t]) if opp.get(t) else 0) for t in off}
            da = {t: dfn[t] - (sum(oa[o] for o in opp[t]) / len(opp[t]) if opp.get(t) else 0) for t in dfn}
            mo, md = sum(oa.values()) / len(oa), sum(da.values()) / len(da)   # keep both centred on the raw D-I mean
            oa = {t: v - mo + sum(off.values()) / len(off) for t, v in oa.items()}; da = {t: v - md + sum(dfn.values()) / len(dfn) for t, v in da.items()}
        sched_def = {t: (sum(da[o] for o in opp[t]) / len(opp[t]) if opp.get(t) else 0) - sum(dfn.values()) / len(dfn) for t in off}
        sched_off = {t: (sum(oa[o] for o in opp[t]) / len(opp[t]) if opp.get(t) else 0) - sum(off.values()) / len(off) for t in dfn}
        for t, v in TO["off"].items(): v[key + "A"] = oa[t]; v[key + "Sch"] = sched_def.get(t, 0)
        for t, v in TO["def"].items(): v[key + "A"] = da[t]; v[key + "Sch"] = sched_off.get(t, 0)
        for p in P: p[key + "A"] = p[key] - sched_def.get(p["team"], 0)

    # ---- shrink making (empirical Bayes, shot-weighted): true spread = observed spread − average noise
    def shrink(rows):
        w = sum(r["shots"] for r in rows); mu = sum(r["mA"] * r["shots"] for r in rows) / w
        obs = sum(r["shots"] * (r["mA"] - mu) ** 2 for r in rows) / w; noise = sum(r["shots"] * r["sv"] for r in rows) / w
        tau2 = max(obs - noise, 1e-5)
        for r in rows:
            r["rel"] = tau2 / (tau2 + r["sv"]); r["mS"] = mu + (r["mA"] - mu) * r["rel"]
        return tau2
    tauP = shrink(P); tauT = {s: shrink(list(TO[s].values())) for s in TO}

    def grp(x):
        g = {k: [0, 0] for k in GROUPS}
        for f in x["f"]:
            g[TO_GROUP[f]][0] += x["c"][f][0]; g[TO_GROUP[f]][1] += x["c"][f][1]
        tagged = set(TO_GROUP[f] for f in x["f"])
        return [g[k] if k in tagged else None for k in GROUPS] + [x["c"]["ft"]]

    lgG = {}
    for f in fams:
        k = TO_GROUP[f]; lgG.setdefault(k, [0, 0]); lgG[k][0] += sum(p["c"][f][0] for p in allp); lgG[k][1] += sum(p["c"][f][1] for p in allp)
    pcols = ["id", "name", "team", "pos", "min", "shots", "x", "q", "qA", "pps", "m", "mA", "mS", "rel", "self", "pts100", "g"]
    prow = lambda p: [p["id"], p["name"], p["team"], p["pos"], p["min"], round(p["shots"]), r3(p["x"]), r3(p["q"]), r3(p["qA"]), r3(p["pps"]), r3(p["m"]), r3(p["mA"]), r3(p["mS"]), round(p["rel"], 2),
                      r3(p["self"]), round(100 * diet(p["c"], p["f"])[1] / p["poss"], 1), grp(p)]
    tcols = ["id", "name", "conf", "poss", "shots", "x", "q", "qA", "qSch", "pps", "m", "mA", "mS", "mSch", "rel", "self", "pts100", "g"]
    trow_ = lambda t: [t["id"], t["name"], t["conf"], t["poss"], round(t["shots"]), r3(t["x"]), r3(t["q"]), r3(t["qA"]), r3(t["qSch"]), r3(t["pps"]), r3(t["m"]), r3(t["mA"]), r3(t["mS"]), r3(t["mSch"]),
                       round(t["rel"], 2), r3(t["self"]), round(100 * diet(t["c"], t["f"])[1] / t["poss"], 1), grp(t)]
    out = {"season": y, "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "groups": GROUPS + ["ft"], "families": fams,
           "league": {"x": r3(LX), "pps": r3(LPPS), "rates": {k: r3(v) for k, v in LGF.items()}, "groups": {k: [v[0], v[1]] for k, v in lgG.items()},
                      "ft": [sum(p["c"]["ft"][0] for p in allp), sum(p["c"]["ft"][1] for p in allp)], "tauP": round(math.sqrt(tauP), 4)},
           "pcols": pcols, "players": sorted([prow(p) for p in P], key=lambda r: r[0]),
           "tcols": tcols, "teams": {s: sorted([trow_(t) for t in TO[s].values()], key=lambda r: r[0]) for s in TO},
           "teamNames": {t: names[t] for t in sorted(set(p["team"] for p in P) | set(TO.get("off", {}))) if t in names},
           "teamConf": {t: confs.get(t, "") for t in sorted(set(p["team"] for p in P) | set(TO.get("off", {}))) if t in names},
           "games": len(games)}
    if live: out.update(live=True, d1Games=d1g)   # season in progress: the page scales its minute floors to it
    os.makedirs(OUT, exist_ok=True)
    put(os.path.join(OUT, f"{y}.json"), out)
    print(f"{y}: {len(P)} players, {len(TO.get('off', {}))} teams, {len(games)} games · D-I quality {LX:.3f} pps {LPPS:.3f} · fams {fams} · player making sd(true) {math.sqrt(tauP):.3f}")


def careers():
    C = {}; ys = []; LGS = {}
    for f in sorted(glob.glob(os.path.join(OUT, "[0-9]*.json"))):
        S = json.load(open(f)); y = S["season"]; ys.append(y); I = {c: i for i, c in enumerate(S["pcols"])}
        # the D-I shot diet by season (the page's trends chart): [att, made] for rim / 2-pt jumpers (+ floaters, post,
        # pull-ups) / threes (+ pull-up 3s) / free throws, plus points per shot
        G = S["league"]["groups"]; add = lambda ks: [sum(G[k][0] for k in ks if k in G), sum(G[k][1] for k in ks if k in G)]
        LGS[str(y)] = {"pps": S["league"]["pps"], "rim": add(["rim"]), "j2": add(["float", "post", "pull2", "j2"]), "three": add(["pull3", "three"]), "ft": S["league"]["ft"]}
        for r in S["players"]:
            C.setdefault(r[0], []).append([y, r[I["team"]], r[I["min"]], r[I["shots"]], r[I["qA"]], r[I["mS"]], r[I["pps"]], r[I["self"]]])
        for side, rows in S["teams"].items():
            J = {c: i for i, c in enumerate(S["tcols"])}
            for r in rows:
                C.setdefault(("T" if side == "off" else "D") + r[0], []).append([y, r[J["conf"]], r[J["poss"]], r[J["shots"]], r[J["qA"]], r[J["mS"]], r[J["pps"]], r[J["self"]]])
    # sharded by the id's last digit (T/D-prefixed team ids too) so the drill-down fetches ~1/10 of every career
    os.makedirs(os.path.join(OUT, "careers"), exist_ok=True)
    for k in "0123456789":
        part = {i: v for i, v in sorted(C.items()) if i[-1] == k}
        put(os.path.join(OUT, "careers", f"{k}.json"), {"cols": ["season", "team", "min", "shots", "q", "mS", "pps", "self"], "rows": part})
    put(os.path.join(OUT, "index.json"), {"built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "seasons": sorted(ys, reverse=True), "league": LGS})
    print(f"careers.json: {len(C)} ids · seasons {min(ys)}-{max(ys)}")


if __name__ == "__main__":
    ys = [int(a) for a in sys.argv[1:]] or sorted(int(os.path.basename(f)[5:9]) for f in glob.glob(os.path.join(SA, "prof_*.json")))
    for y in ys: season(y)
    careers()
