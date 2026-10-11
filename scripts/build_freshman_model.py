#!/usr/bin/env python3
"""build_freshman_model.py — what a freshman PRODUCES, from history, with no grade/overall involved.

Owner rule (Oct 2026): overalls are a display number only — they may not drive any stat, minutes or team number.
A freshman has no college line, so his projection used to be read off his grade. This fits it from real freshman
seasons instead: every 247 composite recruit 2011-2025 (recruiting_247.json, class C plays season C+1) matched to his
first D-I season in player_history, plus every UNRANKED first-year player as its own baseline.

For each position group (G / W / B, from position + height) and each stat's per-40 rate (and shooting %):
    ranked:   value = a + b * ln(rank)          (least squares, weighted by minutes)
    unranked: minutes-weighted mean, by conference level of his team (power / high / mid / low)
plus the typical minutes per game by rank (a default role when the depth chart says nothing).

    python3 scripts/build_freshman_model.py        -> scripts/data/freshman_model.json
"""
import json, math, os, re, unicodedata, urllib.request, collections
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(HERE, "data")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"; KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
STATS = ["pts", "oreb", "dreb", "ast", "stl", "blk", "tov", "fga", "tpa", "fta"]
PCT = [("fg_pct", "fga"), ("tp_pct", "tpa"), ("ft_pct", "fta")]
MIN_MPG, MIN_GP = 8.0, 10


def get(path):
    out = []
    for off in range(0, 400000, 1000):
        sep = "&" if "?" in path else "?"
        r = json.load(urllib.request.urlopen(urllib.request.Request(f"{SB}/rest/v1/{path}{sep}limit=1000&offset={off}", headers=H), timeout=90))
        out += r
        if len(r) < 1000: return out


fold = lambda s: unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
nk = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", fold(s).lower()))


def htin(h):
    m = re.match(r"\s*(\d)\D+(\d{1,2})", str(h or ""))
    return int(m.group(1)) * 12 + int(m.group(2)) if m else None


def group(pos, ht):
    p = str(pos or "").upper()
    if "C" in p and "G" not in p: return "B"
    if ht and ht >= 81: return "B"
    if "G" in p and "F" not in p: return "G"
    if ht and ht <= 76: return "G"
    return "W"


def per40(r):
    m = r.get("mpg") or 0
    if m <= 0: return None
    v = {"pts": r.get("ppg"), "oreb": r.get("oreb"), "dreb": r.get("dreb"), "ast": r.get("apg"), "stl": r.get("stl"),
         "blk": r.get("blk"), "tov": r.get("tovs"), "fga": r.get("fga"), "tpa": r.get("tpa"), "fta": r.get("fta")}
    if any(v[k] is None for k in ("pts", "fga")): return None
    out = {k: (float(x) * 40.0 / m if x is not None else None) for k, x in v.items()}
    for k, a in PCT:
        out[k] = r.get(k) if r.get(k) is not None else None
    return out


_LV_CACHE = {}
def level_of(team, ts_by):
    # player_history uses SHORT school names, team_seasons the full ESPN name: "Duke" -> "Duke Blue Devils" (shortest match)
    if team not in _LV_CACHE:
        sl = str(team or "").lower().strip()
        c = [k for k in ts_by if k.lower() == sl or k.lower().startswith(sl + " ")]
        _LV_CACHE[team] = ts_by.get(sorted(c, key=len)[0]) if c else None
    t = _LV_CACHE[team]
    tier = t.get("tier") if t else None
    try: tier = int(tier)
    except (TypeError, ValueError): tier = None
    return "power" if tier == 1 else "high" if tier == 2 else "mid" if tier == 3 else "low" if tier else "mid"


# OWNED BPM — the exact model tdc-ratings.js prices every returner with (estBpm: player_advanced box rates +
# his team's owned Power Rating). Fitting newcomers on the same scale means a freshman and a returner are
# valued in one currency in the team rating, and no overall is involved.
BPM_B0, BPM_MU, BPM_K, BPM_SRS = -5.17252, -0.5627, 1.0590, 0.31069
BPM_FEATS = ['ts_pct', 'efg_pct', 'tp_pct', 'ft_pct', 'pts40', 'reb40', 'ast40', 'usg_pct', 'ast_pct', 'tov_pct', 'orb_pct', 'drb_pct', 'stl_pct', 'blk_pct', 'ti40']
BPM_COEF = [0.32314, 1.29670, 2.03894, 0.99409, 0.21218, 0.13564, -2.82989, -0.39381, 0.64736, -0.07035, -0.13910, 0.02546, 0.42890, 0.09517, 0.47585]


def est_bpm(r, srs):
    s = BPM_B0 + BPM_SRS * (srs or 0.0)
    for f, c in zip(BPM_FEATS, BPM_COEF):
        v = r.get(f)
        if v is None: return None
        s += c * float(v)
    return BPM_MU + (s - BPM_MU) * BPM_K


def main():
    R = json.load(open(os.path.join(D, "recruiting_247.json")))["classes"]
    ph = get("player_history?select=espn_id,name,season_year,team,yr,position,height,mpg,gp,ppg,oreb,dreb,apg,stl,blk,tovs,fga,tpa,fta,fg_pct,tp_pct,ft_pct&season_year=gte.2008&order=id")
    ts = get("team_seasons?select=season_year,team,tier&order=team_id")
    ts_by = {}
    for t in ts:
        ts_by.setdefault(t["team"], t)
    srs_of = {(t["team"], t["season_year"]): t.get("srs") for t in get("team_seasons?select=season_year,team,srs&order=team_id,season_year")}
    adv = {}
    for r in get("player_advanced?select=espn_id,season_year,team," + ",".join(BPM_FEATS) + "&season_year=gte.2013&order=espn_id,season_year"):
        b = est_bpm(r, srs_of.get((r["team"], r["season_year"])))
        if b is not None and r.get("espn_id"): adv[(int(r["espn_id"]), r["season_year"])] = b
    bpm_of = lambda r: adv.get((int(r["espn_id"]), r["season_year"])) if r.get("espn_id") else None
    # first D-I season per player
    first = {}
    for r in ph:
        e = r.get("espn_id")
        if not e or (r.get("mpg") or 0) <= 0: continue
        if e not in first or r["season_year"] < first[e]["season_year"]: first[e] = r
    by_name_season = collections.defaultdict(list)
    for e, r in first.items(): by_name_season[(nk(r["name"]), r["season_year"])].append(r)
    ranked, matched = [], set()
    for cls, L in R.items():
        y = int(cls) + 1
        for p in L:
            c = by_name_season.get((nk(p["name"]), y)) or []
            if len(c) != 1: continue
            r = c[0]; matched.add(r["espn_id"])
            if (r.get("mpg") or 0) >= MIN_MPG and (r.get("gp") or 0) >= MIN_GP:
                ranked.append((p["rank"], r))
    # unranked first-year players: his first D-I season, not a top-300 recruit
    # (the class-year field is mostly blank, so "first year" = his first D-I season, 2013+ so the history before it is known;
    #  this also covers JUCO / international newcomers, who are projected the same way)
    unranked = [r for e, r in first.items() if e not in matched and r["season_year"] >= 2013
                and (r.get("mpg") or 0) >= MIN_MPG and (r.get("gp") or 0) >= MIN_GP]
    out = {"note": __doc__.split("\n\n")[0], "n_ranked": len(ranked), "n_unranked": len(unranked),
           "ranked": {}, "unranked": {}, "mpg_by_rank": {}}
    for g in "GWB":
        rows = [(rk, per40(r), r["mpg"]) for rk, r in ranked if group(r.get("position"), htin(r.get("height"))) == g]
        rows = [x for x in rows if x[1]]
        out["ranked"][g] = {"n": len(rows)}
        for k in STATS + [p for p, _ in PCT]:
            # a shooting % only counts where he actually took those shots (a big's 0-for-0 is not a 0% shooter),
            # weighted by the attempts behind it
            att = dict(PCT).get(k)
            use = [(rk, v, m) for rk, v, m in rows if v.get(k) is not None and (not att or (v.get(att) or 0) * m / 40.0 >= 0.5)]
            xs = [math.log(rk) for rk, v, m in use]
            ys = [v[k] for rk, v, m in use]
            ws = [m * (v[att] * m / 40.0 if att else 1.0) for rk, v, m in use]
            if len(xs) < 40: continue
            b, a = np.polyfit(xs, ys, 1, w=np.sqrt(ws))
            out["ranked"][g][k] = [round(float(a), 4), round(float(b), 4)]
        # first-year owned BPM by rank (the team rating's currency)
        bb = [(math.log(rk), bpm_of(r), r["mpg"]) for rk, r in ranked
              if group(r.get("position"), htin(r.get("height"))) == g and bpm_of(r) is not None]
        # a + b*ln(rank) + c*(mpg - 20): his minutes say how good the coach found him (and undo the
        # survivorship of fitting only players who earned 8+ mpg); the projection supplies the minutes
        if len(bb) >= 40:
            X = np.array([[1.0, x, m - 20.0] for x, _, m in bb]); w = np.sqrt([m for _, _, m in bb])
            co = np.linalg.lstsq(X * w[:, None], np.array([y for _, y, _ in bb]) * w, rcond=None)[0]
            out["ranked"][g]["bpm"] = [round(float(co[0]), 4), round(float(co[1]), 4), round(float(co[2]), 4)]
        xs = [math.log(rk) for rk, v, m in rows]; ys = [m for rk, v, m in rows]
        b, a = np.polyfit(xs, ys, 1)
        out["mpg_by_rank"][g] = [round(float(a), 3), round(float(b), 3)]
        out["unranked"][g] = {}
        # unranked: level means at 20 mpg + one minutes slope per position group
        ub = [(bpm_of(r), r["mpg"], level_of(r["team"], ts_by)) for r in unranked
              if group(r.get("position"), htin(r.get("height"))) == g and bpm_of(r) is not None]
        LV = ("power", "high", "mid", "low")
        X = np.array([[1.0 if lv == l else 0.0 for l in LV] + [m - 20.0] for _, m, lv in ub]); w = np.sqrt([m for _, m, _ in ub])
        uco = np.linalg.lstsq(X * w[:, None], np.array([y for y, _, _ in ub]) * w, rcond=None)[0]
        out["unranked_bpm_mpg"] = out.get("unranked_bpm_mpg", {}); out["unranked_bpm_mpg"][g] = round(float(uco[-1]), 4)
        for lv in ("power", "high", "mid", "low"):
            rs = [(per40(r), r["mpg"]) for r in unranked if group(r.get("position"), htin(r.get("height"))) == g and level_of(r["team"], ts_by) == lv]
            rs = [x for x in rs if x[0]]
            if len(rs) < 25: continue
            ent = {"n": len(rs), "mpg": round(float(np.median([m for _, m in rs])), 1)}
            for k in STATS + [p for p, _ in PCT]:
                att = dict(PCT).get(k)
                vv = [(v[k], m * (v[att] * m / 40.0 if att else 1.0)) for v, m in rs
                      if v.get(k) is not None and (not att or (v.get(att) or 0) * m / 40.0 >= 0.5)]
                if vv: ent[k] = round(sum(a * m for a, m in vv) / sum(m for _, m in vv), 3)
            bb = [(bpm_of(r), r["mpg"]) for r in unranked if group(r.get("position"), htin(r.get("height"))) == g
                  and level_of(r["team"], ts_by) == lv and bpm_of(r) is not None]
            if len(bb) >= 25: ent["bpm"] = round(float(uco[LV.index(lv)]), 3)   # at 20 mpg
            out["unranked"][g][lv] = ent
    json.dump(out, open(os.path.join(D, "freshman_model.json"), "w"), indent=1)
    print(f"ranked freshmen {len(ranked)}, unranked {len(unranked)}")
    for g in "GWB":
        r = out["ranked"][g]
        if "pts" in r:
            f = lambda k, rk: r[k][0] + r[k][1] * math.log(rk)
            print(f"  {g}: n={r['n']}  pts/40 #1 {f('pts', 1):.1f}  #25 {f('pts', 25):.1f}  #100 {f('pts', 100):.1f}  #300 {f('pts', 300):.1f}"
                  f" | unranked: " + ", ".join(f"{lv} {out['unranked'][g][lv]['pts']:.1f}" for lv in out['unranked'][g]))
            if "bpm" in r:
                print(f"     BPM@20mpg #1 {f('bpm', 1):+.1f}  #25 {f('bpm', 25):+.1f}  #100 {f('bpm', 100):+.1f}  #300 {f('bpm', 300):+.1f}  per mpg {r['bpm'][2]:+.3f} (unranked {out['unranked_bpm_mpg'][g]:+.3f})"
                      f" | unranked: " + ", ".join(f"{lv} {out['unranked'][g][lv].get('bpm', float('nan')):+.1f}" for lv in out['unranked'][g]))


if __name__ == "__main__":
    main()
