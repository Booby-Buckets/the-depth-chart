#!/usr/bin/env python3
"""build_program_prior.py — the program & coach terms of the 2026-27 preseason rating (tdc-ratings.js adds .adj).

On top of the live blend (½ roster + ½ last-3-seasons program history), the preseason backtest
(backtest_preseason.py, rolling origin 2016-2026) found five more signals that predict a team's final Power Rating:
    p10     the program's long-run level (Power Rating 4-10 seasons back) — blue bloods bounce back
    conf    its league's average Power Rating last season — strong leagues hold their level
    new     a first-year head coach (costs ~1.4)   newJob  …who has run a D-I program before (gives some back)
    ccar    the coach's career average Power Rating (every D-I school he's coached, before this season)
    cf      the coach's career over/under-performance vs the model (the live engine's existing coach lift)
Coefficients are fit on what the LIVE blend misses: actual − (½·roster prediction + ½·program history), so the terms
are corrections on top of the blend, not a second copy of program level. Applied to 2026-27 without
the fit's intercept, so a top-100 team with no coaching change gets exactly 0 and the rating scale doesn't drift.

    python3 scripts/build_program_prior.py      -> scripts/data/program_prior_2027.json
"""
import json, os, re, math, collections, datetime
import numpy as np
import backtest_preseason as B

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
Y = 2027
EXTRA = ["p10", "conf", "new", "newJob", "ccar", "cf"]
TOP = 5.0          # top-100 line on last season's Power Rating (level terms fade out across TOP±RAMP — see backtest)
RAMP = 5.0
def low_weight(p1): return min(1.0, max(0.0, (TOP + RAMP - p1) / (2 * RAMP)))
LEVEL = ["p10L", "confL", "ccarL"]
FINAL = ["new", "newJob", "p10L", "confL"]   # what ships: coach-change terms for everyone, level terms faded out above the top-100 (coach career avg added nothing)
PROG = (0.50, 0.29, 0.21)


def nm(s): return re.sub(r"[^a-z ]", "", (s or "").lower().replace("-", " ")).replace(" jr", "").replace(" iii", "").replace(" ii", "").strip()


def main():
    rows, ts, coach_of, smap = B.build_rows()
    S = {(r["season_year"], r["team"]): r["srs"] for r in ts if r["srs"] is not None}
    CONF = {(r["season_year"], r["team"]): r["conference"] for r in ts}
    cav = collections.defaultdict(list)
    for (y, t), v in S.items():
        if CONF.get((y, t)): cav[(y, CONF[(y, t)])].append(v)
    cav = {k: sum(v) / len(v) for k, v in cav.items()}
    CS = json.load(open(os.path.join(D, "coach_seasons.json")))
    il = lambda n: (nm(n).split() or [""])[0][:2] + "|" + (nm(n).split() or [""])[-1]   # Mike Boynton = Michael Boynton
    slug_by_il = collections.defaultdict(set)
    seasons_of = collections.defaultdict(list); slug_by_name = collections.defaultdict(set); name_of = {}
    for c in CS:
        if not c.get("coach_slug"): continue
        if c.get("srs") is not None: seasons_of[c["coach_slug"]].append((c["season_year"], c["srs"]))
        slug_by_name[nm(c["coach"])].add(c["coach_slug"]); name_of[c["coach_slug"]] = c["coach"]
        slug_by_il[il(c["coach"])].add(c["coach_slug"])

    def p10(y, t):
        v = [S[(y - k, t)] for k in range(4, 11) if (y - k, t) in S]
        return sum(v) / len(v) if v else None

    def ccar(slug, y):
        v = [s for (yy, s) in seasons_of.get(slug, []) if yy < y]
        return sum(v) / len(v) if v else 0.0

    # coach residual history (cf) — mean of (actual − roster+program model) over the coach's seasons, shrunk by 5
    res = collections.defaultdict(list)
    for r in rows:
        if r.get("coach") and "pr_roster+program" in r: res[r["coach"]].append((r["y"], r["srs"] - r["pr_roster+program"]))
    def cf(slug, y):
        h = [e for (yy, e) in res.get(slug, []) if yy < y]
        return sum(h) / (len(h) + 5.0) if h else 0.0

    # ---- historical features
    for r in rows:
        y, t, c = r["y"], r["t"], r["coach"]
        r["prog"] = PROG[0] * r["p1"] + PROG[1] * r["p2"] + PROG[2] * r["p3"]
        r["p10"] = p10(y, t) if p10(y, t) is not None else r["p3"]
        r["conf"] = cav.get((y - 1, CONF.get((y - 1, t))), 0.0)
        new = bool(c) and coach_of.get((y - 1, t)) != c
        r["new"] = 1.0 if new else 0.0
        r["newJob"] = 1.0 if new and any(yy < y for yy, _ in seasons_of.get(c, [])) else 0.0
        r["ccar"] = ccar(c, y) if c else 0.0
    for r in rows:
        lo = low_weight(r["p1"])
        r["p10L"], r["confL"], r["ccarL"] = r["p10"] * lo, r["conf"] * lo, r["ccar"] * lo
    data = [r for r in rows if "pr_roster" in r]

    def fitX(tr, f):
        X = np.array([[1] + [r[x] for x in f] for r in tr]); yv = np.array([r["srs"] for r in tr])
        L = np.eye(X.shape[1]) * 1.0; L[0, 0] = 0
        return np.linalg.solve(X.T @ X + L, X.T @ yv)
    for r in data:
        r["blend"] = 0.5 * r["pr_roster"] + 0.5 * r["prog"]     # the live engine's blend
        r["_y"] = r["srs"]; r["srs"] = r["_y"] - r["blend"]       # fit the residual
    out = {}
    SUBSETS = [("live blend", [])] + [("+ " + k, [k]) for k in EXTRA] + [("+ new coach (both)", ["new", "newJob"]),
               ("+ all six", EXTRA),
               ("+ new coach + level terms below top-100", ["new", "newJob"] + LEVEL),
               ("+ new coach + p10/conf below top-100", ["new", "newJob", "p10L", "confL"])]
    for name, f in SUBSETS:
        e, eT = [], []
        for y in range(2016, 2027):
            b = fitX([r for r in data if r["y"] < y], f) if f else [0.0]
            for r in data:
                if r["y"] == y:
                    d = r["srs"] - (b[0] + sum(bi * r[x] for bi, x in zip(b[1:], f))); e.append(d)
                    if r["p1"] > 5: eT.append(d)
        out[name] = (math.sqrt(np.mean(np.square(e))), math.sqrt(np.mean(np.square(eT))))
        print(f"{name:36} RMSE {out[name][0]:.3f}   top-100 {out[name][1]:.3f}")
    b = fitX(data, FINAL)
    coef = dict(zip(["c"] + FINAL, [round(float(x), 4) for x in b]))
    means = {k: round(float(np.mean([r[k] for r in data])), 4) for k in FINAL}
    print("coef", coef)

    # ---- 2026-27 features
    changes = {}
    for ch in json.load(open(os.path.join(D, "coach_changes_2026.json"))):
        if ch.get("confirmed") is False: continue
        changes[nm(ch["school"])] = ch
    full_by_school = {}
    for sch, full in smap.items():
        if full: full_by_school[nm(sch)] = full
    ALIAS = {"nc state": "north carolina state", "saint marys": "saint marys ca", "louisiana monroe": "louisiana monroe",
             "kansas city": "umkc", "little rock": "arkansas little rock", "ut rio grande valley": "texas rio grande valley",
             "fiu": "florida international", "unc greensboro": "north carolina greensboro", "cal state bakersfield": "cal state bakersfield",
             "texas southern": "texas southern", "mississippi valley state": "mississippi valley state", "tennessee tech": "tennessee tech"}
    FULL = {"lsu": "LSU Tigers", "louisiana monroe": "UL Monroe Warhawks", "unc greensboro": "UNC Greensboro Spartans",
            "ut rio grande valley": "UT Rio Grande Valley Vaqueros", "nicholls": "Nicholls Colonels", "charleston": "Charleston Cougars"}
    ch_full = {}
    for k, ch in changes.items():
        if k == "west florida": continue          # D-II
        full = FULL.get(k) or full_by_school.get(k) or full_by_school.get(ALIAS.get(k, "#"))
        if not full:
            cand = [f for s2, f in full_by_school.items() if s2.startswith(k)]
            full = cand[0] if len(cand) == 1 else None
        if full: ch_full[full] = ch
        else: print("  ! coach change school not matched:", ch["school"])
    teams = {}
    for r in ts:
        if r["season_year"] != Y - 1 or r["srs"] is None or not r["conference"]: continue
        t = r["team"]; x = {}
        x["p10"] = p10(Y, t) if p10(Y, t) is not None else S.get((Y - 3, t), S[(Y - 1, t)])
        x["conf"] = cav.get((Y - 1, r["conference"]), 0.0)
        ch = ch_full.get(t)
        if ch:
            slugs = slug_by_name.get(nm(ch["new_coach"])) or slug_by_il.get(il(ch["new_coach"]), set())
            slug = next(iter(slugs)) if len(slugs) == 1 else None
            coach = ch["new_coach"]
            if slug and slug == coach_of.get((Y - 1, t)):      # interim last season, made permanent: not a new coach
                x["new"] = 0.0; x["newJob"] = 0.0
            else:
                x["new"] = 1.0; x["newJob"] = 1.0 if slug and seasons_of.get(slug) else 0.0
        else:
            slug = coach_of.get((Y - 1, t)); x["new"] = 0.0; x["newJob"] = 0.0
            coach = name_of.get(slug, "")
        x["ccar"] = ccar(slug, Y) if slug else 0.0
        x["cf"] = cf(slug, Y) if slug else 0.0
        lo = low_weight(S[(Y - 1, t)])
        x["p10L"], x["confL"], x["ccarL"] = x["p10"] * lo, x["conf"] * lo, x["ccar"] * lo
        adj = sum(coef[k] * x[k] for k in FINAL)   # no intercept: a top team with no coaching change gets exactly 0
        teams[t] = {"adj": round(float(adj), 2), "coach": coach, **{k: round(float(v), 2) for k, v in x.items()}}
    print(f"{len(teams)} teams · {len(ch_full)} coaching changes matched")
    json.dump({"built": datetime.datetime.now(datetime.timezone.utc).isoformat(), "season": Y, "coef": coef, "means": means,
               "backtest": {k: {"rmse": round(v[0], 3), "top100": round(v[1], 3)} for k, v in out.items()}, "teams": teams},
              open(os.path.join(D, f"program_prior_{Y}.json"), "w"), indent=0, separators=(",", ":"))
    top = sorted(teams.items(), key=lambda kv: kv[1]["adj"])
    for k, v in top[:8] + [("...", {})] + top[-8:]: print(k, v)


if __name__ == "__main__":
    main()
