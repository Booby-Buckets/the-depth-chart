#!/usr/bin/env python3
"""build_real_lines.py — the season's REAL totals for every player and team, from box_scores.

Owner, Nov 2026: pages show real season-to-date stats, with a filter back to the projection. Only the player page could
do that (it queries its own box rows), so this is the one shared file: tdc-reallines.js reads it in the browser and
build_team_projected_box.py reads it to blend real games into the projected line.

Writes scripts/data/real_lines_<season>.json:
  { season, built, through, games,
    players: {espn_id: {n, t, g, gs, min, pts, oreb, dreb, ast, stl, blk, tov, pf, fgm, fga, tpm, tpa, ftm, fta}},
    named:   {"team|name": {...same...}},      # box rows with no espn_id
    teams:   {espn full team name: {g, w, l, opts, min, pts, oreb, ...same box fields,
              opp: {same box fields, summed over the opponents' lines in those games},
              adj: {o, d, t, ro, rd, rt, n}}} }   # KenPom-style efficiency (see adjust())
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

# ── KenPom-style efficiency (owner, Nov 11 2026: "I still open KenPom because it's simpler") ─────────────────────────
# Per game: possessions = mean of both teams' FGA − OREB + TOV + 0.475·FTA; ORtg/DRtg = points per 100 of them.
# Adjusted: each game's ORtg is corrected for the opponent's adjusted DRtg (and vice versa) and for venue (half the home
# edge on each end), then blended with our preseason projection (team_pace_eff.json) counted as ADJ_K games — the
# same weight the Power Rating gives its preseason number (tdc-ratings.js ADJ_K), so the two never tell different stories.
ADJ_K = 8.0
HCA100 = 4.4          # home edge per 100 possessions (~3 points a game)
def adjust(teams, gbox, gmeta):
    try: PE = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "team_pace_eff.json")))
    except Exception: PE = {"teams": {}, "avgO": 104.0, "avgD": 104.0, "avgT": 68.0}
    pri = PE.get("teams", {})
    poss = lambda b: b["fga"] - b["oreb"] + b["tov"] + 0.475 * b["fta"]
    G = []   # (team, opp, ortg, drtg, poss, venue: +1 home / -1 away / 0 neutral)
    for gid, ts in gbox.items():
        if len(ts) != 2: continue
        (ta, a), (tb, b) = ts.items(); p = (poss(a) + poss(b)) / 2
        if p < 40: continue
        m = gmeta.get(gid) or {}
        for t, x, y in ((ta, a, b), (tb, b, a)):
            v = 0 if m.get("neutral") else (1 if m.get("home") == t else -1 if m.get("away") == t else 0)
            G.append((t, ta if t == tb else tb, 100 * x["pts"] / p, 100 * y["pts"] / p, p, v))
    if not G: return
    avg = sum(g[2] for g in G) / len(G)
    # a non-D-I opponent has no projection: start it well below D-I (an average one would hand its D-I opponents a
    # 10-point defensive bonus for holding a D-II team to 60)
    NONDI = 14.0
    O = {t: (pri.get(t) or {}).get("o", avg - NONDI) for t in teams}; D = {t: (pri.get(t) or {}).get("d", avg + NONDI) for t in teams}
    PO, PD = dict(O), dict(D)
    PT = {t: (pri.get(t) or {}).get("t", PE.get("avgT", 68.0)) for t in teams}
    avg = sum(PO[t] for t in pri if t in PO) / max(1, sum(1 for t in pri if t in PO)) if pri else avg   # D-I average
    by = defaultdict(list)
    for g in G: by[g[0]].append(g)
    for _ in range(100):
        mx = 0.0
        for t, gs in by.items():
            o = (ADJ_K * PO[t] + sum(g[2] - (D.get(g[1], avg) - avg) - g[5] * HCA100 / 2 for g in gs)) / (ADJ_K + len(gs))
            d = (ADJ_K * PD[t] + sum(g[3] - (O.get(g[1], avg) - avg) + g[5] * HCA100 / 2 for g in gs)) / (ADJ_K + len(gs))
            mx = max(mx, abs(o - O[t]), abs(d - D[t])); O[t], D[t] = o, d
        if mx < 1e-3: break
    for t, gs in by.items():
        n = len(gs); tm = teams[t]
        tm["adj"] = {"o": round(O[t], 1), "d": round(D[t], 1), "t": round((ADJ_K * PT[t] + sum(g[4] for g in gs)) / (ADJ_K + n), 1),
                     "ro": round(sum(g[2] * g[4] for g in gs) / sum(g[4] for g in gs), 1),
                     "rd": round(sum(g[3] * g[4] for g in gs) / sum(g[4] for g in gs), 1),
                     "rt": round(sum(g[4] for g in gs) / n, 1), "n": n,
                     "po": round(PO[t], 1), "pd": round(PD[t], 1)}

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
        rows = get(f"games?select=id,date,home,away,neutral&season_year=eq.{a.season}&status=eq.STATUS_FINAL&order=id.asc&limit=1000&offset={off}")
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
    gbox = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))   # game -> team -> box sums
    ident = {}
    for r in rows:
        tm = r.get("team")
        if tm:   # a team's totals count everyone who logged a row, DNPs add nothing
            game_teams[r["game_id"]][tm] += float(r.get("pts") or 0)
            for k in BOX: teams[tm][k] += float(r.get(k) or 0)
            teams[tm]["min"] += float(r.get("min") or 0)
            for k in BOX: gbox[r["game_id"]][tm][k] += float(r.get(k) or 0)
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
            ob = teams[t].setdefault("opp", dict.fromkeys(BOX, 0.0)); other = tb if t == ta else ta
            for k in BOX: ob[k] += gbox[gid][other][k]
    adjust(teams, gbox, {g["id"]: g for g in games})
    def tidy(d):
        return {k: (tidy(v) if isinstance(v, dict) else int(v) if isinstance(v, float) and v == int(v) else round(v, 2) if isinstance(v, float) else v)
                for k, v in d.items() if k != "gs" or v}
    if not players and a.season == 2027 and games:
        sys.exit("final games but no box rows: not overwriting the file")
    out = {"season": a.season, "built": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()), "through": max((g["date"] for g in games), default=None),
           "games": len(games), "players": {e: tidy(d) for e, d in players.items()}, "named": {k: tidy(d) for k, d in named.items()},
           "teams": {t: tidy(d) for t, d in teams.items() if d["g"]}}
    # the one exact list of sheet name -> ESPN full name, from the published rankings. Guessing from a name prefix sent UMass to
    # UMass Lowell and Penn to Penn State. Pages and builds read this file; if the pull fails the last file stays.
    names_fp = os.path.join(a.out, "team_full_names.json")
    try:
        if a.season == 2027:
            rows = get("predictive_ratings?select=data&season=eq.2027")[0]["data"]["teams"]
            names = {t["team"]: t["full"] for t in rows if t.get("team") and t.get("full")}
            if len(names) >= 300: json.dump(names, open(names_fp, "w"), separators=(",", ":"), sort_keys=True, ensure_ascii=False)
            else: print(f"warn: only {len(names)} team names from the rankings, keeping the last list")
    except Exception as e:
        print(f"warn: no team names from the rankings ({e}), keeping the last list")
    try: out["alias"] = json.load(open(names_fp))
    except Exception: out["alias"] = {}
    fp = os.path.join(a.out, f"real_lines_{a.season}.json")
    json.dump(out, open(fp, "w"), separators=(",", ":"))
    print(f"wrote {fp}: {len(games)} games, {len(out['players'])} players, {len(out['named'])} without an id, {len(out['teams'])} teams, through {out['through']}")

if __name__ == "__main__":
    main()
