#!/usr/bin/env python3
"""build_real_lines.py — the season's REAL totals for every player and team, from box_scores.

Owner, Nov 2026: pages show real season-to-date stats, with a filter back to the projection. Only the player page could
do that (it queries its own box rows), so this is the one shared file: tdc-reallines.js reads it in the browser and
build_team_projected_box.py reads it to blend real games into the projected line.

Writes scripts/data/real_lines_<season>.json:
  { season, built, through, games,
    players: {espn_id: {n, t, g, gs, min, pts, oreb, dreb, ast, stl, blk, tov, pf, fgm, fga, tpm, tpa, ftm, fta}},
    named:   {"team|name": {...same...}},      # box rows with no espn_id
    teams:   {espn full team name: {g, w, l, opts, min, pts, oreb, ...same box fields}} }
Totals, not averages: pages divide, so a percentage is always makes / attempts.

  python3 scripts/build_real_lines.py                    # season 2027
  python3 scripts/build_real_lines.py --season 2026 --to 2025-12-15 --out <dir>    # replay an old season's opening weeks
"""
import argparse, json, os, re, sys, time, urllib.request
from collections import defaultdict

SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"
KEY = os.environ.get("SUPABASE_ANON_KEY", "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye")
BOX = ("pts", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf", "fgm", "fga", "tpm", "tpa", "ftm", "fta")

# How heavily a player's real games count against his projection: a stat reaches half weight after this many games.
# Fit on 4,031 player-seasons, 2024-25 and 2025-26: first N games plus the previous season predicting the rest of his
# season, per 40 (fit: pts 6, fga 4, tpa 5, fta 10, ast 10, tov 10, dreb 10, oreb 15, blk 15, stl 25). That prior is only
# last season's line and the model is better than that, so these sit a little above the fit. Scoring settles fast, steals
# slowly. Keys are the projection's per-game field names.
REAL_K = {"ppg": 8.0, "fga": 6.0, "tpa": 6.0, "fta": 12.0, "apg": 12.0, "tovs": 12.0, "dreb": 12.0, "oreb": 18.0, "blk": 18.0, "stl": 25.0}
REAL_K_MIN = 5.0                                     # minutes (fit 1, against a last-season prior that misses role changes)
REAL_SHOOT_K = {"fg": 150.0, "tp": 150.0, "ft": 75.0}   # pseudo-attempts at the projected % (fit 150 / 100 / 50)
REAL_CAP = 0.95
G_SEASON = 31                                        # regular-season games a projected average covers

def get(q):
    for a in range(5):
        try:
            req = urllib.request.Request(SB + q, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
            return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception as e:
            err = e; time.sleep(1.5 * (a + 1))
    raise RuntimeError(f"{err}: {q[:90]}")

def name_key(s):
    return re.sub(r"[^a-z]", "", str(s or "").lower())

def blank():
    return dict.fromkeys(("g", "gs", "min") + BOX, 0)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2027)
    ap.add_argument("--to", help="last date to count (a replay of an old season)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
    a = ap.parse_args()
    # game ids first, 30 a request, stable order: date-window box pulls hit the anon statement timeout, and a failure must
    # stop the build rather than publish a season with games missing
    games, off = [], 0
    while True:
        rows = get(f"games?select=id,date&season_year=eq.{a.season}&status=eq.STATUS_FINAL&order=id.asc&limit=1000&offset={off}")
        games += rows; off += 1000
        if len(rows) < 1000: break
    if a.to: games = [g for g in games if g["date"] <= a.to]
    ids = [g["id"] for g in games]
    rows = []
    for i in range(0, len(ids), 30):
        rows += get("box_scores?select=game_id,espn_id,team,player,starter,min," + ",".join(BOX) +
                    f"&game_id=in.({','.join(map(str, ids[i:i + 30]))})&order=game_id.asc,espn_id.asc")
    players, named = defaultdict(blank), defaultdict(blank)
    teams, game_teams = defaultdict(blank), defaultdict(lambda: defaultdict(float))
    ident = {}
    for r in rows:
        tm = r.get("team")
        if tm:   # a team's totals count everyone who logged a row, DNPs add nothing
            game_teams[r["game_id"]][tm] += float(r.get("pts") or 0)
            for k in BOX: teams[tm][k] += float(r.get(k) or 0)
            teams[tm]["min"] += float(r.get("min") or 0)
        if float(r.get("min") or 0) <= 0: continue
        e = r.get("espn_id")
        d = players[str(e)] if e is not None else named[f"{tm}|{name_key(r.get('player'))}"]
        if e is not None: ident[str(e)] = (r.get("player"), tm)   # the latest row wins: a midseason transfer shows his current team
        else: d["n"], d["t"] = r.get("player"), tm
        d["g"] += 1; d["gs"] += 1 if r.get("starter") else 0; d["min"] += float(r["min"])
        for k in BOX: d[k] += float(r.get(k) or 0)
    for e, (n, t) in ident.items(): players[e]["n"], players[e]["t"] = n, t
    for gid, ts in game_teams.items():
        if len(ts) != 2: continue   # one side missing from the box: its record and points against stay out
        (ta, pa), (tb, pb) = ts.items()
        for t, p, o in ((ta, pa, pb), (tb, pb, pa)):
            teams[t]["g"] += 1; teams[t]["opts"] = teams[t].get("opts", 0) + o
            teams[t]["w" if p > o else "l"] = teams[t].get("w" if p > o else "l", 0) + 1
    def tidy(d):
        return {k: (int(v) if isinstance(v, float) and v == int(v) else v) for k, v in d.items() if k != "gs" or v}
    if not players and a.season == 2027 and games:
        sys.exit("final games but no box rows: not overwriting the file")
    out = {"season": a.season, "built": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()), "through": max((g["date"] for g in games), default=None),
           "games": len(games), "players": {e: tidy(d) for e, d in players.items()}, "named": {k: tidy(d) for k, d in named.items()},
           "teams": {t: tidy(d) for t, d in teams.items() if d["g"]}}
    fp = os.path.join(a.out, f"real_lines_{a.season}.json")
    json.dump(out, open(fp, "w"), separators=(",", ":"))
    print(f"wrote {fp}: {len(games)} games, {len(out['players'])} players, {len(out['named'])} without an id, {len(out['teams'])} teams, through {out['through']}")

if __name__ == "__main__":
    main()
