#!/usr/bin/env python3
"""backtest_preseason.py — how much should a PRESEASON team rating trust the program vs the roster?

Replays every season 2013-2026: for each D-I team, using only what was knowable before the season,
predict its FINAL Power Rating (team_seasons.srs), then score the predictions against what happened.
Each season is predicted by a model fit only on EARLIER seasons (rolling origin — no peeking).

Signals (all preseason-knowable):
  ROSTER   ret   = last season's wins added (owa+dwa, player_advanced) of players who stayed
           lost  = wins added of players who left (graduated / pro / transferred out)
           tin   = wins added transfers bring in, scaled by the level they came from
           rec   = incoming top-150 recruits (247 composite rank)
  PROGRAM  p1, p2, p3 = the program's Power Rating 1, 2 and 3 seasons back
  COACH    coach = the head coach's career over/under-performance (actual minus model) in PRIOR seasons only
Roster membership = who actually appeared for the team that season (a mild leak: a preseason analyst
doesn't know who'll get hurt — the same for every model, so the comparison is fair).

Models compared: roster-only (what our live rating mostly is) · program-only · roster+program · +coach.
Then the blend question in the live engine's own terms:  final ≈ w·ROSTER_PRED + g·(multi-year prior) + coach.

    python3 scripts/backtest_preseason.py        -> scripts/data/preseason_backtest.json
"""
import json, os, re, math, collections, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(HERE, "data")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"; KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
TEST0, TEST1 = 2013, 2026


def get(q):
    out = []
    for off in range(0, 400000, 1000):
        for t in range(4):
            try:
                r = json.load(urllib.request.urlopen(urllib.request.Request(SB + q + f"&limit=1000&offset={off}", headers=H), timeout=90)); break
            except Exception:
                if t == 3: raise
        out += r
        if len(r) < 1000: return out
    return out


def norm(s): return re.sub(r"[^a-z ]", "", (s or "").lower().replace("-", " ")).strip()


def cache(name, q):
    p = os.path.join("/tmp", "bt_" + name + ".json")   # dev cache, refreshed daily
    if os.path.exists(p) and __import__("time").time() - os.path.getmtime(p) < 86400: return json.load(open(p))
    r = get(q); json.dump(r, open(p, "w")); return r


def build_rows():
    """every team-season with its preseason signals + rolling-origin model predictions (pr_*) and coach residual (cf)"""
    ts = cache("ts", "team_seasons?select=season_year,team,srs,conference&order=season_year,team")
    pa = cache("pa", "player_advanced?select=espn_id,season_year,team,name,min,g,owa,dwa&espn_id=not.is.null&order=season_year,espn_id,team")
    SRS = {(r["season_year"], r["team"]): r["srs"] for r in ts if r["srs"] is not None}
    D1 = {(r["season_year"], r["team"]) for r in ts if r["srs"] is not None and r["conference"]}
    # player-season value + roster membership
    val, roster, first = {}, collections.defaultdict(list), {}
    for r in pa:
        e, y = r["espn_id"], r["season_year"]
        wa = (r["owa"] or 0) + (r["dwa"] or 0)
        k = (e, y)
        if k not in val or (r["min"] or 0) > val[k][2]: val[k] = (r["team"], wa, r["min"] or 0, r["name"])
        first[e] = min(first.get(e, 9999), y)
    for (e, y), (t, wa, mn, nm) in val.items(): roster[(y, t)].append(e)

    # recruits: 247 class C enters season C+1; match by name to a freshman on that season's roster
    R = json.load(open(os.path.join(D, "recruiting_247.json")))["classes"]
    rec_rank = {}
    for c, lst in R.items():
        for x in lst:
            if (x.get("rank") or 999) <= 150: rec_rank[(int(c) + 1, norm(x["name"]))] = x["rank"]

    # coaches: SR school names -> team_seasons full names
    CS = json.load(open(os.path.join(D, "coach_seasons.json")))
    fulls = sorted({r["team"] for r in ts})
    # SR school -> ESPN full name: known divergent names first, else the ESPN name the school prefixes — and an
    # ESPN name belongs to the LONGEST school that prefixes it ("Alabama A&M Bulldogs" is Alabama A&M's, not Alabama's)
    from build_coach_profiles import ALIAS
    ALIAS = dict(ALIAS, **{"Mississippi": "Ole Miss Rebels", "Hawaii": "Hawai'i Rainbow Warriors",
                           "Southeastern Louisiana": "SE Louisiana Lions", "St. Thomas": "St. Thomas-Minnesota Tommies"})
    base = lambda s: re.sub(r"\s*\([^)]+\)", "", s).strip()
    schools = sorted({r["school"] for r in CS})
    own = {}
    for f in fulls:
        m = [sc for sc in schools if sc not in ALIAS and (f == base(sc) or f.startswith(base(sc) + " "))]
        if m: own.setdefault(max(m, key=lambda sc: len(base(sc))), set()).add(f)
    def match(school):
        if school in ALIAS: return ALIAS[school] if ALIAS[school] in fulls else None
        c = sorted(own.get(school, ()), key=len)
        return c[0] if c else None
    smap = {s: match(s) for s in schools}
    coach_of = {(r["season_year"], smap[r["school"]]): r["coach_slug"] for r in CS if smap.get(r["school"])}

    rows = []
    for (y, t) in sorted(D1):
        if y < 2011 or (y - 1, t) not in SRS: continue
        cur, prev = set(roster.get((y, t), [])), set(roster.get((y - 1, t), []))
        if len(cur) < 5: continue
        ret = sum(val[(e, y - 1)][1] for e in cur & prev if (e, y - 1) in val)
        # young returners (1st/2nd-year players) are the ones who still grow
        retY = sum(val[(e, y - 1)][1] for e in cur & prev if (e, y - 1) in val and first.get(e, 0) >= y - 2)
        retMin = sum(val[(e, y - 1)][2] for e in cur & prev if (e, y - 1) in val) / max(1, sum(val[(e, y - 1)][2] for e in prev if (e, y - 1) in val))
        lost = sum(val[(e, y - 1)][1] for e in prev - cur if (e, y - 1) in val)
        tin = tinL = 0.0; rec = recT = 0.0
        for e in cur - prev:
            if (e, y - 1) in val:
                ot, wa, mn, nm = val[(e, y - 1)]
                tin += wa; tinL += wa * (SRS.get((y - 1, ot), 0) - SRS[(y - 1, t)]) / 10.0
            elif first.get(e) == y:
                rk = rec_rank.get((y, norm(val[(e, y)][3])))
                if rk: rec += (151 - rk) / 150.0; recT += 1.0 if rk <= 25 else 0.0
        p1 = SRS[(y - 1, t)]; p2 = SRS.get((y - 2, t), p1); p3 = SRS.get((y - 3, t), p2)
        rows.append(dict(y=y, t=t, srs=SRS[(y, t)], ret=ret, lost=lost, tin=tin, tinL=tinL, rec=rec, recT=recT, retY=retY, retMin=retMin, p1=p1, p2=p2, p3=p3,
                         coach=coach_of.get((y, t))))
    print(f"{len(rows)} team-seasons built")

    RF = ["ret", "retY", "retMin", "lost", "tin", "tinL", "rec", "recT"]
    F = {"roster": RF,
         "program": ["p1", "p2", "p3"],
         "roster+program": RF + ["p1", "p2", "p3"],
         "last year only": ["p1"]}

    def fit(tr, feats):
        X = np.array([[1.0] + [r[f] for f in feats] for r in tr]); yv = np.array([r["srs"] for r in tr])
        lam = np.eye(X.shape[1]) * 1.0; lam[0, 0] = 0
        return np.linalg.solve(X.T @ X + lam, X.T @ yv)
    def pred(b, r, feats): return b[0] + sum(bi * r[f] for bi, f in zip(b[1:], feats))

    # rolling-origin predictions for every model
    for name, feats in F.items():
        for y in range(TEST0, TEST1 + 1):
            tr = [r for r in rows if r["y"] < y]; b = fit(tr, feats)
            for r in rows:
                if r["y"] == y: r["pr_" + name] = pred(b, r, feats)

    # coach effect: shrunk mean residual of the roster+program model in the coach's EARLIER seasons
    hist = collections.defaultdict(list)
    for r in sorted([r for r in rows if "pr_roster+program" in r], key=lambda r: r["y"]):
        c = r["coach"]; h = [x for x in hist[c] if x[0] < r["y"]] if c else []
        r["cf"] = (sum(x[1] for x in h) / (len(h) + 5.0)) if h else 0.0
        if c: hist[c].append((r["y"], r["srs"] - r["pr_roster+program"]))
    # +coach model: one extra rolling fit on the coach feature
    for y in range(TEST0 + 3, TEST1 + 1):
        tr = [r for r in rows if TEST0 <= r["y"] < y]
        X = np.array([[1, r["pr_roster+program"], r["cf"]] for r in tr]); yv = np.array([r["srs"] for r in tr])
        b = np.linalg.lstsq(X, yv, rcond=None)[0]
        for r in rows:
            if r["y"] == y and "cf" in r: r["pr_+coach"] = b[0] + b[1] * r["pr_roster+program"] + b[2] * r["cf"]

    return rows, ts, coach_of, smap


def main():
    rows, ts, coach_of, smap = build_rows()
    test = [r for r in rows if TEST0 + 3 <= r["y"] <= TEST1]
    def score(key, sub):
        e = np.array([r["srs"] - r[key] for r in sub]); return math.sqrt((e ** 2).mean()), abs(e).mean()
    def spear(key, sub):
        out = []
        for y in sorted({r["y"] for r in sub}):
            s = [r for r in sub if r["y"] == y]
            a = np.argsort(np.argsort([r[key] for r in s])); b = np.argsort(np.argsort([r["srs"] for r in s]))
            out.append(np.corrcoef(a, b)[0, 1])
        return float(np.mean(out))
    top = [r for r in test if r["p1"] > 5]   # roughly the top ~100
    res = {}
    print(f"\nOut-of-sample {TEST0 + 3}-{TEST1}: {len(test)} team-seasons ({len(top)} top-100ish)")
    print(f"{'model':18} {'RMSE':>6} {'MAE':>6} {'rank r':>7} | top100 RMSE  MAE")
    for k in ["last year only", "roster", "program", "roster+program", "+coach"]:
        a, m = score("pr_" + k, test); a2, m2 = score("pr_" + k, top); rr = spear("pr_" + k, test)
        res[k] = dict(rmse=round(a, 3), mae=round(m, 3), rank_r=round(rr, 3), top_rmse=round(a2, 3), top_mae=round(m2, 3))
        print(f"{k:18} {a:6.2f} {m:6.2f} {rr:7.3f} |   {a2:6.2f} {m2:6.2f}")

    # the blend question in live-engine terms: final = c + w*ROSTER_PRED + g1*p1 + g2*p2 + g3*p3 + d*cf
    X = np.array([[1, r["pr_roster"], r["p1"], r["p2"], r["p3"], r["cf"]] for r in test]); yv = np.array([r["srs"] for r in test])
    b = np.linalg.lstsq(X, yv, rcond=None)[0]
    print("\nfinal ≈ %.2f + %.2f·rosterPred + %.2f·p1 + %.2f·p2 + %.2f·p3 + %.2f·coach" % tuple(b))
    gs = b[2] + b[3] + b[4]
    print(f"program share of the weight: {gs / (b[1] + gs):.0%}  (live engine today: ~7%)")
    # same with the roster pred's spread matched to ours? report sd of each
    print("sd: actual %.2f  rosterPred %.2f  roster+program %.2f" % (yv.std(), np.std([r["pr_roster"] for r in test]), np.std([r["pr_roster+program"] for r in test])))
    json.dump({"models": res, "blend": dict(zip(["c", "roster", "p1", "p2", "p3", "coach"], [round(float(x), 3) for x in b])),
               "n": len(test)}, open(os.path.join(D, "preseason_backtest.json"), "w"), indent=1)
    json.dump(rows, open("/tmp/bt_rows.json", "w"))


if __name__ == "__main__":
    main()
