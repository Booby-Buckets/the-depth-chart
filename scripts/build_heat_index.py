#!/usr/bin/env python3
"""
build_heat_index.py — player Heat Index: game-to-game scoring consistency.

A "streaky scorer" swings a lot night to night; a "steady" one gives you the same
line every game. We measure it as the coefficient of variation of a player's
game scoring — CV = stdev(points) / mean(points) — so it's comparable across
scoring levels (a 20-ppg guy isn't automatically streakier than a 6-ppg guy).

Higher CV = streakier. Reported as a national percentile among rotation scorers.
Current season (2026). Reads box_scores by team (indexed → no deep-offset 500s).
Writes data/heat_index_players.json  { <espn_id>: {cv, pct, gp, ppg, hi, lo} }

  python3 scripts/build_heat_index.py
"""
import json, os, math, urllib.request, urllib.parse
from collections import defaultdict

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
OUT = os.path.join(os.path.dirname(__file__), os.pardir, "data")
SEASON = 2026
MIN_GP = 12     # need a real season of games
MIN_PPG = 7.0   # skip non-scorers (CV explodes on tiny means)


def get(path):
    out = []; frm = 0
    while True:
        h = {**HDR, "Range-Unit": "items", "Range": "%d-%d" % (frm, frm + 999)}
        b = json.load(urllib.request.urlopen(urllib.request.Request(SB + "/rest/v1/" + path, headers=h), timeout=90))
        out += b
        if len(b) < 1000: break
        frm += 1000
    return out


def main():
    print("Heat Index (players) — %d" % SEASON, flush=True)
    teams = [t["team"] for t in get("team_seasons?season_year=eq.%d&select=team&team=not.is.null" % SEASON)]
    pts_by = defaultdict(list)          # espn_id -> [game points]
    for i, tm in enumerate(sorted(set(teams))):
        rows = get("box_scores?season_year=eq.%d&team=eq.%s&select=espn_id,pts&pts=not.is.null"
                   % (SEASON, urllib.parse.quote(tm)))
        for r in rows:
            if r.get("espn_id") is not None:
                pts_by[r["espn_id"]].append(float(r["pts"] or 0))
        if (i + 1) % 60 == 0:
            print("    %d teams pulled (%d players so far)" % (i + 1, len(pts_by)), flush=True)

    out = {}
    for eid, pts in pts_by.items():
        n = len(pts)
        if n < MIN_GP: continue
        mean = sum(pts) / n
        if mean < MIN_PPG: continue
        var = sum((p - mean) ** 2 for p in pts) / n
        sd = math.sqrt(var)
        cv = sd / mean if mean else 0
        out[eid] = {"cv": round(cv, 3), "gp": n, "ppg": round(mean, 1),
                    "hi": round(max(pts)), "lo": round(min(pts))}

    # national percentile of CV (higher CV = streakier)
    vals = sorted(v["cv"] for v in out.values())
    n = len(vals)
    for v in out.values():
        v["pct"] = round(100 * sum(1 for x in vals if x < v["cv"]) / n) if n else 50

    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, "heat_index_players.json"), "w"), separators=(",", ":"))
    print("  wrote %d players" % len(out), flush=True)

    rank = sorted(out.items(), key=lambda kv: -kv[1]["cv"])
    print("\n  STREAKIEST scorers (highest CV):")
    for eid, v in rank[:8]:
        print("    cv %.2f  %4.1f ppg  (hi %d / lo %d, %d gp)" % (v["cv"], v["ppg"], v["hi"], v["lo"], v["gp"]))
    print("\n  STEADIEST scorers (lowest CV):")
    for eid, v in rank[-6:]:
        print("    cv %.2f  %4.1f ppg  (hi %d / lo %d)" % (v["cv"], v["ppg"], v["hi"], v["lo"]))


if __name__ == "__main__":
    main()
