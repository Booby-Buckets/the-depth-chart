#!/usr/bin/env python3
"""build_coach_shots.py — a coach's shot discipline across his career (coach.html "Shot discipline").

For every coach-season since 2011-12 that maps to a D-I team in the Mastery Shots data, compute:
  from scripts/data/mastery/<y>.json (2011-12 on)
    disc   share of FGA at the rim, threes, or a shooter's proven mastery shot (green light, 1.1+ pts/shot)
    green  share of FGA that were green-light mastery shots
    off    share of FGA that were off-script (mid-range / pull-ups by players without a green light on them)
    pps    points per field-goal attempt
  from scripts/data/possession_value/<y>.json (2019-20 on)
    great / bad   shot grades (tdc-huntgreat.js): rim or green light / unproven tough two or pull-up three
    toCostG       points lost to turnovers per game (team PPP + D-I opponent premium after steals / dead balls)
    rimPlusG      points gained (+) or lost finishing rim attempts vs the D-I rate, per game
Each metric also gets a percentile among that season's D-I teams (higher = better; bad / off / toCostG inverted),
because the D-I shot diet moved a lot between 2012 and 2026 and raw shares don't compare across eras.

Team resolution follows build_coach_rundowns.py: coach_seasons.school ('Alabama') strip-matches team_seasons
names; collisions (Alabama vs Alabama State) are settled by the SRS fingerprint.

  python3 scripts/build_coach_shots.py      -> scripts/data/coach_shots.json
Rerun after build_mastery.mjs / build_possession_value.mjs or a coach_seasons refresh.
"""
import json, os, re, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "data")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"

FAM = ["rim", "float", "post", "pull2", "short", "long", "mid", "pull3", "three"]
SV = {"pull3": 3, "three": 3}
OPTS = {  # green-light floors, as in scripts/lib_shotfamily.mjs / tdc-mastery.js
    "jump2": (["float", "post", "pull2", "short", "long", "mid"], 75),
    "float": (["float"], 30), "post": (["post"], 30), "pull2": (["pull2"], 30),
    "pull3": (["pull3"], 25), "three": (["three", "pull3"], 100),
}
BAR = 1.1


def get_all(q):
    rows, off = [], 0
    while True:
        req = urllib.request.Request(SB + q + f"&limit=1000&offset={off}", headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
        d = json.load(urllib.request.urlopen(req, timeout=60))
        rows += d
        if len(d) < 1000:
            return rows
        off += 1000


def norm(s): return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", (s or "").lower())).strip()


def load_alias():
    """The Sports-Reference -> ESPN name table from build_coach_profiles.py ('Connecticut' -> 'UConn Huskies')."""
    import ast
    tree = ast.parse(open(os.path.join(HERE, "build_coach_profiles.py")).read())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "ALIAS" for t in node.targets):
            return dict(ast.literal_eval(node.value), **EXTRA_ALIAS)
    return dict(EXTRA_ALIAS)


EXTRA_ALIAS = {"Southeastern Louisiana": "SE Louisiana Lions"}
def keys(full):
    w = norm(full).split(); out = {norm(full)}
    for i in (1, 2):
        if len(w) > i: out.add(" ".join(w[:-i]))
    return out


def greens(c):
    g = {}
    for k, (fams, floor) in OPTS.items():
        att = sum(c[FAM.index(f) * 3] for f in fams)
        pts = sum(c[FAM.index(f) * 3 + 1] * SV.get(f, 2) for f in fams)
        g[k] = att >= floor and pts / att >= BAR
    return g


def fam_class(f, g):
    if f in ("rim", "three"): return "eff"
    if f == "pull3": return "green" if g["pull3"] else "off"
    if f in ("float", "post", "pull2"): return "green" if (g[f] or g["jump2"]) else "off"
    return "green" if g["jump2"] else "off"


def mastery_season(y):
    p = os.path.join(D, "mastery", f"{y}.json")
    if not os.path.exists(p): return None
    m = json.load(open(p)); C = len(m["pcols"])
    T = defaultdict(lambda: {"att": 0, "pts": 0, "eff": 0, "green": 0, "off": 0})
    for r in m["players"]:
        c = r[C:]; g = greens(c); t = T[str(r[2])]
        for i, f in enumerate(FAM):
            a, mk = c[i * 3], c[i * 3 + 1]
            t["att"] += a; t["pts"] += mk * SV.get(f, 2); t[fam_class(f, g)] += a
    lg_rim = m["league"][0][1] / m["league"][0][0]
    out = {}
    for r in m["teamRows"]:
        tid = str(r[0]); t = T.get(tid)
        if not t or t["att"] < 300: continue
        gp, rimA, rimM = r[1], r[4], r[5]
        out[tid] = {"fga": t["att"], "pps": t["pts"] / t["att"], "disc": (t["eff"] + t["green"]) / t["att"],
                    "green": t["green"] / t["att"], "off": t["off"] / t["att"],
                    "rimPlusG": ((rimM / rimA - lg_rim) * rimA * 2 / gp) if (rimA and gp) else None, "gp": gp}
    return out


def pv_season(y, gp_by):
    p = os.path.join(D, "possession_value", f"{y}.json")
    if not os.path.exists(p): return {}
    v = json.load(open(p))
    L = v["league"]
    rt = lambda a: a[1] / a[0] if a[0] else 0
    base = rt(L[29:31]); live_p = rt(L[21:23]) - base; dead_p = rt(L[23:25]) - base
    out = {}
    for r in v["teams"]:
        tid = str(r[0]); clock = r[3:21]
        tot = sum(clock[k] for k in range(0, 18, 2))
        if tot < 300: continue
        great = sum(clock[(b * 3 + 0) * 2] for b in range(3)) / tot
        bad = sum(clock[(b * 3 + 2) * 2] for b in range(3)) / tot
        ppp = r[2] / r[1]; gp = gp_by.get(tid)
        cost = r[21] * (ppp + live_p) + r[23] * (ppp + dead_p)
        out[tid] = {"great": great, "bad": bad, "toCostG": cost / gp if gp else None}
    return out


def pctls(rows, key, invert=False):
    vals = sorted(v[key] for v in rows.values() if v.get(key) is not None)
    n = len(vals)
    if n < 20: return
    import bisect
    for v in rows.values():
        x = v.get(key)
        if x is None: continue
        p = 100 * (bisect.bisect_left(vals, x) + bisect.bisect_right(vals, x)) / 2 / n
        v[key + "P"] = round(100 - p if invert else p)


def main():
    idx = json.load(open(os.path.join(D, "mastery", "index.json")))["seasons"]
    print("fetching team_seasons…")
    ts = get_all("team_seasons?select=team,team_id,season_year,srs&order=season_year.asc,team_id.asc")
    ts_by_key = defaultdict(list)
    for r in ts:
        for k in keys(r["team"]): ts_by_key[(k, r["season_year"])].append(r)
    alias = load_alias()
    by_full = {(norm(r["team"]), r["season_year"]): r for r in ts}
    def resolve(school, yr, srs):
        if school in alias and (norm(alias[school]), yr) in by_full: return by_full[(norm(alias[school]), yr)]
        c = ts_by_key.get((norm(school), yr))
        if not c: return None
        if len(c) == 1 or srs is None: return min(c, key=lambda r: len(r["team"]))
        return min(c, key=lambda r: abs((r["srs"] if r.get("srs") is not None else -999) - srs))

    seasons = {}
    for y in idx:
        ms = mastery_season(y)
        if not ms: continue
        pv = pv_season(y, {k: v["gp"] for k, v in ms.items()})
        for tid, h in pv.items():
            if tid in ms: ms[tid].update(h)
        for k, inv in (("disc", False), ("green", False), ("off", True), ("pps", False), ("rimPlusG", False), ("great", False), ("bad", True), ("toCostG", True)):
            pctls(ms, k, inv)
        seasons[y] = ms
        print(f"  {y}: {len(ms)} teams" + (" + possession value" if pv else ""))

    cs = json.load(open(os.path.join(D, "coach_seasons.json")))
    # A season in progress isn't in team_seasons (only finished seasons are) or coach_seasons (scraped from
    # Sports-Reference): take its teams from the mastery file and its coaches from teams.head_coach (this season).
    cs_last = max(r["season_year"] for r in cs)
    for y in seasons:
        if not any(r["season_year"] == y for r in ts):
            m = json.load(open(os.path.join(D, "mastery", f"{y}.json")))
            for tid, t in m["teams"].items():
                r = {"team": t[0], "team_id": int(tid), "season_year": y, "srs": None}
                ts.append(r)
                for k in keys(r["team"]): ts_by_key[(k, y)].append(r)
                by_full[(norm(r["team"]), y)] = r
    slug_of = {}
    for r in sorted(cs, key=lambda r: r["season_year"]): slug_of[r["coach"]] = r["coach_slug"]
    live = [y for y in seasons if y > cs_last]
    if live:
        hc = get_all("teams?select=name,head_coach&head_coach=not.is.null&order=name.asc")
        for y in live:
            n = 0
            for t in hc:
                slug = slug_of.get(t["head_coach"])
                if not slug: continue        # a first-year head coach has no coach page yet
                cs.append({"season_year": y, "school": t["name"], "coach": t["head_coach"], "coach_slug": slug, "srs": None, "wins": None, "losses": None}); n += 1
            print(f"  {y}: {n} coaches from teams.head_coach (season not in coach_seasons yet)")
    out, miss = defaultdict(list), 0
    R = lambda x, d=3: None if x is None else round(x, d)
    for s in cs:
        y = s["season_year"]
        if y not in seasons: continue
        tm = resolve(s["school"], y, s.get("srs"))
        t = tm and seasons[y].get(str(tm["team_id"]))
        if not t: miss += 1; continue
        out[s["coach_slug"]].append({
            "y": y, "school": s["school"], "team": tm["team"], "tid": tm["team_id"], "w": s.get("wins"), "l": s.get("losses"),
            "fga": t["fga"], "pps": R(t["pps"]), "disc": R(t["disc"]), "green": R(t["green"]), "off": R(t["off"]),
            "rimPlusG": R(t.get("rimPlusG"), 2), "great": R(t.get("great")), "bad": R(t.get("bad")), "toCostG": R(t.get("toCostG"), 2),
            "P": {k[:-1]: t[k] for k in t if k.endswith("P")},
        })
    for v in out.values(): v.sort(key=lambda r: -r["y"])
    # D-I medians per season, for the "vs D-I" reference line
    med = {}
    for y, ms in seasons.items():
        m = {}
        for k in ("disc", "green", "off", "pps", "great", "bad", "toCostG"):
            vals = sorted(v[k] for v in ms.values() if v.get(k) is not None)
            if vals: m[k] = round(vals[len(vals) // 2], 3)
        med[y] = m
    body = {"seasons": sorted(seasons, reverse=True), "median": {str(k): v for k, v in med.items()}, "coaches": out}
    dst = os.path.join(D, "coach_shots.json")
    try:
        old = json.load(open(dst)); old.pop("built", None)
    except Exception:
        old = None
    # rewrite only when something changed, so a quiet night commits nothing
    if json.loads(json.dumps(body)) != old:
        json.dump(dict(built=__import__("datetime").datetime.now().isoformat(timespec="seconds"), **body), open(dst, "w"), separators=(",", ":"))
    else:
        print("coach_shots.json unchanged")
    n = sum(len(v) for v in out.values())
    print(f"coach_shots.json: {len(out)} coaches, {n} coach-seasons ({miss} coach-seasons unmatched)")
    for slug in ("josh-schertz-1", "mark-few-1", "bill-self-1"):
        for r in out.get(slug, [])[:3]:
            print(f"  {slug} {r['y']} {r['school']}: disc {r['disc']} (pctl {r['P'].get('disc')}), great {r['great']} (pctl {r['P'].get('great')}), pps {r['pps']}")


if __name__ == "__main__":
    main()
