#!/usr/bin/env python3
"""Audit: which rotation players does the CBBD shot archive know that our tables don't?

For each cached season, every player with 100+ located FGA (a rotation player) is checked
against player_history, bbref_seasons and box_scores (espn_id). Writes
scripts/data/box_coverage_audit.json and prints a per-season summary.

  python3 scripts/audit_box_coverage.py [seasons...]
"""
import json, os, sys, urllib.request, urllib.parse
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_shots_cbbd as B
from build_shot_zone_ref import seasons_in_cache

H = {"apikey": B.ANON, "Authorization": "Bearer " + B.ANON}
def get(path):
    out, off = [], 0
    while True:
        req = urllib.request.Request(B.SB + "/rest/v1/" + path + "&limit=1000&offset=%d" % off, headers=H)
        rows = json.load(urllib.request.urlopen(req, timeout=120)); out += rows
        if len(rows) < 1000: return out
        off += 1000

def in_box(eid, season):
    req = urllib.request.Request(B.SB + "/rest/v1/box_scores?espn_id=eq.%d&season_year=eq.%d&select=game_id&limit=1" % (eid, season), headers=H)
    try: return bool(json.load(urllib.request.urlopen(req, timeout=60)))
    except Exception: return None

def main():
    seasons = [int(a) for a in sys.argv[1:]] or seasons_in_cache()
    report = {}
    for y in seasons:
        ath, team = B.id_maps(y)
        roster = {}
        for t in B.cget("roster_%d" % y) or []:
            for pl in t.get("players") or []:
                e = B.to_int(pl.get("sourceId"))
                if e: roster[e] = (pl["name"], t.get("team"))
        fga = defaultdict(int); tm = {}
        for r in B.rows_for(y, B.season_plays(y), ath, team):
            if r["espn_id"]: fga[r["espn_id"]] += 1; tm[r["espn_id"]] = r["team_id"]
        rot = {e for e, n in fga.items() if n >= 100}
        ph = {r["espn_id"] for r in get("player_history?season_year=eq.%d&espn_id=not.is.null&select=espn_id&order=id" % y)}
        bb = {r["espn_id"] for r in get("bbref_seasons?season_year=eq.%d&espn_id=not.is.null&select=espn_id&order=bbref_id" % y)}
        miss_ph = sorted(rot - ph, key=lambda e: -fga[e]); miss_bb = sorted(rot - bb, key=lambda e: -fga[e])
        miss_both = [e for e in miss_ph if e not in bb]
        # box_scores is per game and huge: probe only the players missing from both season tables
        box = {e: in_box(e, y) for e in miss_both}
        miss_all = [e for e in miss_both if box.get(e) is False]
        report[str(y)] = {"rotation": len(rot), "missing_player_history": len(miss_ph), "missing_bbref": len(miss_bb),
            "missing_both": len(miss_both), "missing_box_too": len(miss_all),
            "players": [{"espn_id": e, "name": roster.get(e, ("?",))[0], "team": roster.get(e, (None, None))[1], "fga": fga[e],
                         "in_box": box.get(e)} for e in miss_both]}
        print("%d: %d rotation players (100+ FGA) · missing from player_history %d · bbref %d · both %d · also absent from box_scores %d" %
              (y, len(rot), len(miss_ph), len(miss_bb), len(miss_both), len(miss_all)), flush=True)
        for e in miss_all[:6]:
            print("     %-26s %-24s %4d FGA" % (roster.get(e, ("?",))[0], roster.get(e, (None, "?"))[1], fga[e]))
    json.dump(report, open(os.path.join(B.HERE, "data", "box_coverage_audit.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
