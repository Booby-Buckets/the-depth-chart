#!/usr/bin/env python3
"""Per-player and per-team shot profiles by season, from the CBBD shot cache.

Feeds three surfaces:
  • player page  "Shot profile by season"  (scripts/data/shot_profiles/<espn_id % 40>.json)
  • coach page   shot fingerprint per stop  (scripts/data/shot_team_profiles.json)
  • Advanced Stats league shot trends       (league block of shot_team_profiles.json)

Profile row (one per season) is a flat int list, zone order = ZONES:
  [fga, fgm, assisted_makes, rim_a, rim_m, paint_a, paint_m, midl_a, midl_m, midc_a, midc_m,
   midr_a, midr_m, c3l_a, c3l_m, c3r_a, c3r_m, w3l_a, w3l_m, t3_a, t3_m, w3r_a, w3r_m]

  python3 scripts/build_shot_profiles.py          # every season in the cache
"""
import json, os, sys
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_shots_cbbd as B
from build_shot_zone_ref import zone10, ZONES, HOOP_Y, seasons_in_cache
from build_coach_profiles import build_crosswalk

D = os.path.join(B.HERE, "data")
PDIR = os.path.join(D, "shot_profiles")
SHARDS = 40
MIN_PLAYER_FGA = 40

def blank(): return [0] * (3 + 2 * len(ZONES))
def add(row, z, made, ast):
    row[0] += 1
    i = 3 + 2 * ZONES.index(z); row[i] += 1
    if made:
        row[1] += 1; row[i + 1] += 1
        if ast: row[2] += 1

def main():
    players = defaultdict(dict)   # espn_id -> {season: row}
    teams = defaultdict(dict)     # team_id -> {season: row}
    league = {}
    names = {}
    tinfo = {t["id"]: t for t in (B.cget("teams") or [])}
    for y in seasons_in_cache():
        ath, team = B.id_maps(y)
        P = defaultdict(blank); T = defaultdict(blank); L = blank()
        for r in B.rows_for(y, B.season_plays(y), ath, team):
            z = zone10(r["x"], r["y"] + HOOP_Y, r["sv"]); a = bool(r["ast_id"])
            add(L, z, r["made"], a)
            if r["team_id"]: add(T[r["team_id"]], z, r["made"], a)
            if r["espn_id"]: add(P[r["espn_id"]], z, r["made"], a)
        for pid, row in P.items():
            if row[0] >= MIN_PLAYER_FGA: players[pid][str(y)] = row
        for tid, row in T.items(): teams[tid][str(y)] = row
        league[str(y)] = L
        print(y, "players", sum(1 for r in P.values() if r[0] >= MIN_PLAYER_FGA), "teams", len(T), flush=True)
        # ESPN display names for the team file (CBBD displayName == ESPN displayName)
        for cid, e in team.items():
            if e and cid in tinfo: names[e] = tinfo[cid].get("displayName") or tinfo[cid].get("school")

    os.makedirs(PDIR, exist_ok=True)
    shards = defaultdict(dict)
    for pid, seas in players.items(): shards[pid % SHARDS][str(pid)] = seas
    for i in range(SHARDS):
        json.dump(shards.get(i, {}), open(os.path.join(PDIR, "%d.json" % i), "w"), separators=(",", ":"))
    print("wrote %d player shards, %d players" % (SHARDS, len(players)))

    # SR-style school names (coach pages) -> ESPN team id
    schools = set()
    cs = os.path.join(D, "coach_seasons.json")
    if os.path.exists(cs):
        schools = {s["school"] for s in json.load(open(cs)) if s.get("school")}
    by_name = {v: k for k, v in names.items()}
    xw = build_crosswalk(schools, set(by_name)) if schools else {}
    by_school = {s: by_name[n] for s, n in xw.items() if n in by_name}
    out = {"zones": ZONES, "fields": ["fga", "fgm", "ast"] + [z + s for z in ZONES for s in ("_a", "_m")],
           "teams": {str(t): {"name": names.get(t), "seasons": seas} for t, seas in teams.items()},
           "by_school": by_school, "league": league}
    json.dump(out, open(os.path.join(D, "shot_team_profiles.json"), "w"), separators=(",", ":"))
    print("teams", len(teams), "schools mapped", len(by_school), "of", len(schools))

if __name__ == "__main__":
    main()
