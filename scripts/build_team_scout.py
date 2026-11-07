#!/usr/bin/env python3
"""build_team_scout.py — the team Scouting Report: every stat, offense and defense, with its D-I rank.

Computed from our own box_scores (games between two D-I teams with both box scores on file), so a season in
progress and every past season work the same way. Opponent numbers come from the same game's other box.

Writes scripts/data/team_scout_<season>.json:
  {season, through, n, avg:{stat: D-I mean}, teams:{"Duke Blue Devils":{g, stat:[value, rank], ...}}}
Rank 1 is always the best for that team (lowest opponent eFG%, fewest turnovers); style stats rank highest first.

  python3 scripts/build_team_scout.py --season 2027
  python3 scripts/build_team_scout.py --seasons 2010-2027
"""
import argparse, json, os, re, sys, time
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
import build_onoff as B
_argv = sys.argv; sys.argv = sys.argv[:1]   # archetype_grades.py reads argv at import
_spec = importlib.util.spec_from_file_location("ag", os.path.join(os.path.dirname(os.path.abspath(__file__)), "archetype_grades.py"))
ag = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(ag); sys.argv = _argv

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
COLS = "game_id,team,opp,espn_id,starter,min,pts,fgm,fga,tpm,tpa,ftm,fta,oreb,dreb,ast,stl,blk,tov"
N = ("min", "pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov")
# stat -> direction for its rank: 1 higher is better, -1 lower is better, 0 style (highest first, not good or bad)
DIR = {"ortg": 1, "drtg": -1, "net": 1, "tempo": 0,
       "o_efg": 1, "d_efg": -1, "o_tov": -1, "d_tov": 1, "o_orb": 1, "d_orb": -1, "o_ftr": 1, "d_ftr": -1,
       "o_tp": 1, "d_tp": -1, "o_two": 1, "d_two": -1, "o_ft": 1, "d_ft": -1,
       "o_blk": -1, "d_blk": 1, "o_stl": -1, "d_stl": 1, "o_nst": -1, "d_nst": 1,
       "o_tpar": 0, "d_tpar": 0, "o_astr": 0, "d_astr": 0,
       "o_p3": 0, "d_p3": 0, "o_p2": 0, "d_p2": 0, "o_pf": 0, "d_pf": 0,
       "sos": 1, "sos_o": -1, "sos_d": -1, "ncsos": 1,
       "bench": 0, "exp": 1, "cont": 1, "hgt": 1, "adj_o": 1, "adj_d": -1, "adj_n": 1, "proj_o": 1, "proj_d": -1, "proj_n": 1, "proj_t": 0}


def rows_for(season):
    """every box row of a season, through the same paged reader derived_stats.py uses. An empty past season is an
    error, not an empty result: Supabase timeouts come back as an error object, which read as "no games" here once"""
    for a in range(5):
        try:
            rows = ag.get(f"box_scores?season_year=eq.{season}", COLS)
            break
        except Exception as e:
            if a == 4: raise
            print(f"{season}: retry {a + 1} ({type(e).__name__})", flush=True); time.sleep(4 * (a + 1))
    if not rows and season < 2027:
        raise SystemExit(f"box_scores came back empty for {season}")
    # Supabase pages without an ORDER BY can repeat rows (this table times out when sorted); a repeat means a page shifted
    seen = {(r.get("game_id"), r.get("espn_id")) for r in rows if r.get("espn_id") is not None}
    n = sum(1 for r in rows if r.get("espn_id") is not None)
    if n != len(seen): print(f"*** {season}: {n - len(seen)} repeated box rows from paging", flush=True)
    return rows


def num(v):
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def height(h):
    m = re.match(r"^(\d)-(\d{1,2})$", str(h or "").strip())
    return int(m.group(1)) * 12 + int(m.group(2)) if m else None


def class_years(y):
    """1 for a sophomore's season of experience, etc. Graduate and redshirt seniors count as 4."""
    s = str(y or "").lower()
    if "gr" in s: return 4
    if "sr" in s: return 3
    if "jr" in s: return 2
    if "so" in s: return 1
    if "fr" in s: return 0
    return None


def bio(season):
    """{espn_id: (inches, experience)}: the roster table for the season in progress, player_history before it"""
    out, off = {}, 0
    tbl = "players" if season >= 2027 else f"player_history"
    flt = "espn_id=not.is.null" + ("" if season >= 2027 else f"&season_year=eq.{season}")
    while True:
        rows = B.sb_get(f"{tbl}?{flt}&select=espn_id,height,yr&order=espn_id.asc&limit=1000&offset={off}") or []
        for r in rows:
            out[str(r["espn_id"])] = (height(r.get("height")), class_years(r.get("yr")))
        off += 1000
        if len(rows) < 1000: return out


def poss(t):
    return t["fga"] - t["oreb"] + t["tov"] + 0.44 * t["fta"]


def pct(a, b):
    return 100.0 * a / b if b else None


def build(season, prior_rows=None):
    dna_all = json.load(open(os.path.join(D, "team_dna.json")))
    dna = (dna_all.get(str(season)) or {}).get("teams") or {}
    if not dna:
        print(f"{season}: no team_dna season, skipped"); return None
    rows = rows_for(season)
    games = B_games(season)
    # per game, per team totals; a game counts only with two D-I teams and both boxes on file
    G = defaultdict(lambda: defaultdict(lambda: dict.fromkeys(N, 0.0)))
    who = defaultdict(lambda: defaultdict(lambda: dict(mins=0.0, bench=0.0)))
    pl = defaultdict(lambda: defaultdict(float))
    for r in rows:
        t = r.get("team")
        if t not in dna: continue
        g = G[r["game_id"]][t]
        for k in N: g[k] += num(r.get(k))
        m = num(r.get("min"))
        if m > 0:
            if not r.get("starter"): who[t]["x"]["bench"] += m
            who[t]["x"]["mins"] += m
            if r.get("espn_id") is not None: pl[t][str(r["espn_id"])] += m
    T = defaultdict(lambda: dict.fromkeys(N, 0.0)); O = defaultdict(lambda: dict.fromkeys(N, 0.0))
    played = defaultdict(int); opps = defaultdict(list); through = None
    for gid, sides in G.items():
        if len(sides) != 2: continue
        a, b = list(sides)
        info = games.get(gid) or {}
        if info and info.get("status") not in (None, "STATUS_FINAL"): continue
        if not sides[a]["pts"] or not sides[b]["pts"]: continue
        for x, y in ((a, b), (b, a)):
            for k in N:
                T[x][k] += sides[x][k]; O[x][k] += sides[y][k]
            played[x] += 1; opps[x].append((y, bool(info.get("conf_game"))))
        d = info.get("date")
        if d and (through is None or d > through): through = d
    prior = defaultdict(set)
    for r in (prior_rows or []):
        if num(r.get("min")) > 0 and r.get("espn_id") is not None: prior[r.get("team")].add(str(r["espn_id"]))
    BIO = bio(season)
    netk = "adjNet" if any("adjNet" in v for v in dna.values()) else "net"
    okeys = "adjO" if netk == "adjNet" else "ORtg"; dkeys = "adjD" if netk == "adjNet" else "DRtg"
    V = {}
    for t, a in T.items():
        o = O[t]; pa = poss(a); po = poss(o)
        if pa <= 0 or po <= 0: continue
        two_a, two_o = a["fga"] - a["tpa"], o["fga"] - o["tpa"]
        length = a["min"] / 5.0   # game minutes in the games counted here (all players' minutes / 5)
        v = {"g": played[t],
             "ortg": pct(a["pts"], pa), "drtg": pct(o["pts"], po), "tempo": (pa + po) / 2 / length * 40 if length else None,
             "o_efg": pct(a["fgm"] + .5 * a["tpm"], a["fga"]), "d_efg": pct(o["fgm"] + .5 * o["tpm"], o["fga"]),
             "o_tov": pct(a["tov"], pa), "d_tov": pct(o["tov"], po),
             "o_orb": pct(a["oreb"], a["oreb"] + o["dreb"]), "d_orb": pct(o["oreb"], o["oreb"] + a["dreb"]),
             "o_ftr": pct(a["fta"], a["fga"]), "d_ftr": pct(o["fta"], o["fga"]),
             "o_tp": pct(a["tpm"], a["tpa"]), "d_tp": pct(o["tpm"], o["tpa"]),
             "o_two": pct(a["fgm"] - a["tpm"], two_a), "d_two": pct(o["fgm"] - o["tpm"], two_o),
             "o_ft": pct(a["ftm"], a["fta"]), "d_ft": pct(o["ftm"], o["fta"]),
             "o_blk": pct(o["blk"], two_a), "d_blk": pct(a["blk"], two_o),
             "o_stl": pct(o["stl"], pa), "d_stl": pct(a["stl"], po),
             "o_nst": pct(a["tov"] - o["stl"], pa), "d_nst": pct(o["tov"] - a["stl"], po),
             "o_tpar": pct(a["tpa"], a["fga"]), "d_tpar": pct(o["tpa"], o["fga"]),
             "o_astr": pct(a["ast"], a["fgm"]), "d_astr": pct(o["ast"], o["fgm"]),
             "o_p3": pct(3 * a["tpm"], a["pts"]), "d_p3": pct(3 * o["tpm"], o["pts"]),
             "o_p2": pct(2 * (a["fgm"] - a["tpm"]), a["pts"]), "d_p2": pct(2 * (o["fgm"] - o["tpm"]), o["pts"]),
             "o_pf": pct(a["ftm"], a["pts"]), "d_pf": pct(o["ftm"], o["pts"])}
        v["net"] = v["ortg"] - v["drtg"]
        # strength of schedule from each opponent's rating that season
        def avg(k, f=lambda _: True):
            L = [num(dna[y].get(k)) for y, c in opps[t] if f(c) and dna.get(y, {}).get(k) is not None]
            return sum(L) / len(L) if L else None
        v["sos"] = avg(netk); v["sos_o"] = avg(dkeys); v["sos_d"] = avg(okeys); v["ncsos"] = avg(netk, lambda c: not c)
        # personnel, weighted by minutes
        mins = who[t]["x"]["mins"]
        v["bench"] = pct(who[t]["x"]["bench"], mins)
        hs = ex = hm = em = kept = 0.0
        for e, m in pl[t].items():
            h, y = BIO.get(e, (None, None))
            if h: hs += h * m; hm += m
            if y is not None: ex += y * m; em += m
            if e in prior.get(t, ()): kept += m
        v["hgt"] = hs / hm if hm else None
        v["exp"] = ex / em if em else None
        v["cont"] = pct(kept, sum(pl[t].values())) if prior_rows and sum(pl[t].values()) else None
        # ratings kept beside the raw numbers: schedule-adjusted for a finished season, projected for the one in progress
        r = dna.get(t) or {}
        if r.get("adjO") is not None:
            v["adj_o"], v["adj_d"], v["adj_n"] = num(r["adjO"]), num(r["adjD"]), num(r.get("adjNet"))
        if r.get("projected") and r.get("ORtg") is not None:
            v["proj_o"], v["proj_d"], v["proj_n"], v["proj_t"] = num(r["ORtg"]), num(r["DRtg"]), num(r.get("net")), num(r.get("tempo"))
        V[t] = v
    if not V:
        print(f"{season}: no games yet, skipped"); return None
    teams = {t: {"g": v["g"]} for t, v in V.items()}
    avg = {}
    for k, d in DIR.items():
        L = sorted(((v[k], t) for t, v in V.items() if v.get(k) is not None), key=lambda x: -x[0] if d >= 0 else x[0])
        if not L: continue
        avg[k] = round(sum(x[0] for x in L) / len(L), 2)
        rank, prev = 0, None
        for i, (val, t) in enumerate(L):
            if prev is None or round(val, 3) != round(prev, 3): rank = i + 1
            prev = val
            teams[t][k] = [round(val, 2), rank]
    out = {"season": season, "through": through, "n": len(teams), "avg": avg, "teams": teams}
    fp = os.path.join(D, f"team_scout_{season}.json")
    json.dump(out, open(fp, "w"), separators=(",", ":"))
    print(f"{season}: {len(teams)} teams through {through}, {os.path.getsize(fp)//1024} KB", flush=True)
    return rows


def B_games(season):
    out, off = {}, 0
    while True:
        rows = B.sb_get(f"games?season_year=eq.{season}&select=id,date,conf_game,status&order=id.asc&limit=1000&offset={off}") or []
        for r in rows: out[r["id"]] = r
        off += 1000
        if len(rows) < 1000: return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int)
    ap.add_argument("--seasons", help="first-last, oldest first")
    a = ap.parse_args()
    if a.season:
        build(a.season, rows_for(a.season - 1)); return
    lo, hi = (int(x) for x in a.seasons.split("-"))
    prior = None
    for y in range(lo, hi + 1):
        if prior is None:
            try: prior = rows_for(y - 1)
            except SystemExit: prior = []
        prior = build(y, prior) or rows_for(y)


if __name__ == "__main__":
    main()
