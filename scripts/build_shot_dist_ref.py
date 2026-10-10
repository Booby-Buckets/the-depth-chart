#!/usr/bin/env python3
"""Per-season D-I shot benchmarks BY DISTANCE (each foot from the rim, 0-30) for the
shot-chart distance panels (tdc-shotchart.js "By distance"): attempts + makes per foot for
the whole league and for each CBBD roster position (Guard / Forward / Center), from the CBBD
shot cache (build_shots_cbbd.py). Shots past 35 ft (heaves) are dropped; 31-35 ft land in 30.

  {"seasons": {"2025": {"all": {"a": [31 ints], "m": [...]}, "G": {...}, "F": {...}, "C": {...}}},
   "latest": 2025}

  python3 scripts/build_shot_dist_ref.py
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_shots_cbbd as B
from build_shot_zone_ref import seasons_in_cache

OUT = os.path.join(B.HERE, "data", "shot_dist_ref.json")
NF = 31
POS = {"Guard": "G", "Forward": "F", "Center": "C"}

def build(season):
    ath, team = B.id_maps(season)
    pos = {}
    for t in B.cget("roster_%d" % season) or []:
        for pl in t.get("players") or []:
            e = B.to_int(pl.get("sourceId")); g = POS.get(pl.get("position"))
            if e and g: pos[e] = g
    acc = {k: {"a": [0] * NF, "m": [0] * NF} for k in ("all", "G", "F", "C")}
    for r in B.rows_for(season, B.season_plays(season), ath, team):
        d = r["dist"]
        if d is None or d > 35: continue
        f = min(NF - 1, max(0, int(d)))
        for k in ("all", pos.get(r["espn_id"])):
            if not k: continue
            acc[k]["a"][f] += 1
            if r["made"]: acc[k]["m"][f] += 1
    return acc

def main():
    ref = {"seasons": {}}
    for y in seasons_in_cache():
        s = build(y); n = sum(s["all"]["a"])
        if n < 50000: continue
        ref["seasons"][str(y)] = s
        print(y, n, {k: sum(v["a"]) for k, v in s.items()}, flush=True)
    ref["latest"] = max(int(k) for k in ref["seasons"])
    json.dump(ref, open(OUT, "w"), separators=(",", ":"))
    print("wrote", OUT, os.path.getsize(OUT), "bytes")

if __name__ == "__main__":
    main()
