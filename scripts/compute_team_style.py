#!/usr/bin/env python3
"""
compute_team_style.py — per team-season "coaching style" signals from box scores.

For every (team, season) we roll up the box scores into the tendencies that
distinguish how a staff plays: pace, how deep they go into the bench, their
shot diet, ball movement, offensive-glass crashing, defensive ball pressure,
and how concentrated the offense is on one star.

Output: scripts/data/team_style.json — list of
  {team, season_year, games, poss_pg, rotation_size, bench_min_pct,
   three_pa_rate, ft_rate, ast_rate, oreb_pg, opp_tov_pg, stl_pg,
   top_scorer_share, min_hhi}

Note: `team` is the ESPN name ("Duke Blue Devils"); the crosswalk to SR schools
happens in build_coach_profiles.py.

Usage:
  python3 scripts/compute_team_style.py                 # all seasons 2007-2026
  python3 scripts/compute_team_style.py --season 2025   # one season (fast test)
  python3 scripts/compute_team_style.py --upload        # push to Supabase team_style
"""
import json, os, sys, urllib.request
from collections import defaultdict

SB  = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
OUT = os.path.join(os.path.dirname(__file__), "data", "team_style.json")
FIELDS = "game_id,team,opp,player,starter,min,pts,fga,fta,tpa,oreb,tov,ast,fgm,stl"


def num(x):
    try: return float(x)
    except Exception: return 0.0


def fetch_season(year):
    """Page all box_scores for one season."""
    rows, frm, PG = [], 0, 1000
    while True:
        url = "%s/rest/v1/box_scores?select=%s&season_year=eq.%d" % (SB, FIELDS, year)
        req = urllib.request.Request(url, headers={**HDR, "Range-Unit": "items",
                                                   "Range": "%d-%d" % (frm, frm + PG - 1)})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                batch = json.load(r)
        except Exception as e:
            print("  fetch error @%d: %s" % (frm, e)); break
        rows += batch
        if len(batch) < PG: break
        frm += PG
    return rows


def team_game_totals(game_rows):
    """{team: {tot..., mins:[..], pts:[..], starters:int}} for one game."""
    by = defaultdict(lambda: {"fga": 0, "fta": 0, "tpa": 0, "oreb": 0, "tov": 0,
                              "ast": 0, "fgm": 0, "pts": 0, "stl": 0,
                              "mins": [], "ptsv": []})
    for r in game_rows:
        t = r["team"]; d = by[t]
        for k in ("fga", "fta", "tpa", "oreb", "tov", "ast", "fgm", "pts", "stl"):
            d[k] += num(r.get(k))
        mn = num(r.get("min"))
        if mn > 0:
            d["mins"].append(mn); d["ptsv"].append(num(r.get("pts")))
    return by


def compute(rows):
    # group by game
    games = defaultdict(list)
    for r in rows:
        games[r["game_id"]].append(r)
    # accumulate per-game style into (team, season)
    acc = defaultdict(lambda: defaultdict(float))
    for gid, grows in games.items():
        tt = team_game_totals(grows)
        teams = list(tt.keys())
        for t in teams:
            d = tt[t]
            opp = tt[teams[1 - teams.index(t)]] if len(teams) == 2 else None
            a = acc[t]; a["g"] += 1
            a["poss"] += d["fga"] + 0.44 * d["fta"] - d["oreb"] + d["tov"]
            a["fga"] += d["fga"]; a["fta"] += d["fta"]; a["tpa"] += d["tpa"]
            a["ast"] += d["ast"]; a["fgm"] += d["fgm"]; a["oreb"] += d["oreb"]; a["stl"] += d["stl"]
            a["opp_tov"] += (opp["tov"] if opp else 0)
            mins = sorted(d["mins"], reverse=True)
            a["rotation"] += sum(1 for m in mins if m >= 10)         # players 10+ min
            tot_min = sum(mins) or 1
            a["bench_min"] += sum(mins[5:]) / tot_min               # share beyond top-5 minutes
            tot_pts = sum(d["ptsv"]) or 1
            a["top_share"] += (max(d["ptsv"]) if d["ptsv"] else 0) / tot_pts
            a["hhi"] += sum((m / tot_min) ** 2 for m in mins)       # minute concentration
    out = []
    for (t), a in acc.items():
        g = a["g"] or 1
        out.append({
            "team": t, "games": int(g),
            "poss_pg": round(a["poss"] / g, 2),
            "rotation_size": round(a["rotation"] / g, 2),
            "bench_min_pct": round(a["bench_min"] / g * 100, 1),
            "three_pa_rate": round(a["tpa"] / max(1, a["fga"]) * 100, 1),
            "ft_rate": round(a["fta"] / max(1, a["fga"]) * 100, 1),
            "ast_rate": round(a["ast"] / max(1, a["fgm"]) * 100, 1),
            "oreb_pg": round(a["oreb"] / g, 2),
            "opp_tov_pg": round(a["opp_tov"] / g, 2),
            "stl_pg": round(a["stl"] / g, 2),
            "top_scorer_share": round(a["top_share"] / g * 100, 1),
            "min_hhi": round(a["hhi"] / g, 4),
        })
    return out


def upload(rows):
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        req = urllib.request.Request(
            SB + "/rest/v1/team_style?on_conflict=team,season_year",
            data=json.dumps(chunk).encode(), method="POST",
            headers={**HDR, "Content-Type": "application/json",
                     "Prefer": "resolution=merge-duplicates"})
        try:
            urllib.request.urlopen(req, timeout=60).read(); print("  uploaded %d-%d" % (i, i + len(chunk)))
        except urllib.error.HTTPError as e:
            print("  upload error:", e.code, e.read()[:200]); return


def main():
    one = None; do_upload = False
    for i, a in enumerate(sys.argv[1:]):
        if a == "--upload": do_upload = True
        elif a == "--season": one = int(sys.argv[i + 2])
    years = [one] if one else list(range(2007, 2027))
    allrows = []
    for y in years:
        rows = fetch_season(y)
        st = compute(rows)
        for s in st: s["season_year"] = y
        allrows += st
        print("season %d: %d team-seasons (%d box rows)" % (y, len(st), len(rows)))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(allrows, f)
    print("wrote %d team-season style rows -> %s" % (len(allrows), OUT))
    if do_upload:
        upload(allrows)


if __name__ == "__main__":
    main()
