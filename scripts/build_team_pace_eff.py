#!/usr/bin/env python3
"""Compact per-team offense / defense / tempo for the schedule projection's scores.

Pulls from team_dna.json: the 2026-27 PROJECTED line where one exists (114 rosters).
Everyone else keeps last season's TEMPO (for pace / totals) but gets offense and
defense split evenly from their projected Power Rating (last season's raw
efficiencies aren't opponent-adjusted, so a mid-major's net would lie). tdc-schedule.js
turns two teams' lines into an expected pace + total and lets the efficiency margin
nudge the ratings-based spread.

Writes scripts/data/team_pace_eff.json:
  {"avgO": 108.3, "avgT": 68.4, "shrink": 0.52,
   "teams": {"Duke Blue Devils": {"o": 117.0, "d": 96.5, "t": 68.9, "src": "proj"}, …}}
"""
import json, statistics as st, urllib.request
from pathlib import Path

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
ANON = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"   # read-only public key
def ratings():
    req = urllib.request.Request(f"{SB}/rest/v1/predictive_ratings?select=data&limit=1", headers={"apikey": ANON, "Authorization": f"Bearer {ANON}"})
    rows = json.load(urllib.request.urlopen(req, timeout=30))
    return {t["full"]: t["rating"] for t in rows[0]["data"]["teams"]} if rows else {}

DATA = Path(__file__).parent / "data"
d = json.load(open(DATA / "team_dna.json"))
proj, last = d["2027"]["teams"], d["2026"]["teams"]

def line(t): return {"o": t.get("ORtg"), "d": t.get("DRtg"), "t": t.get("tempo")}
P = {k: line(v) for k, v in proj.items() if v.get("ORtg") and v.get("DRtg") and v.get("tempo")}
L = {k: line(v) for k, v in last.items() if v.get("ORtg") and v.get("DRtg") and v.get("tempo")}
avgO_p = st.mean(v["o"] for v in P.values()); avgD_p = st.mean(v["d"] for v in P.values()); avgT_p = st.mean(v["t"] for v in P.values())
avgO_l = st.mean(v["o"] for v in L.values()); avgD_l = st.mean(v["d"] for v in L.values())
sd_p = st.pstdev(v["o"] - v["d"] for v in P.values()); sd_l = st.pstdev(v["o"] - v["d"] for v in L.values())
shrink = round(sd_p / sd_l, 2)

R = ratings()
out = {}
for k, v in P.items():
    out[k] = {"o": round(v["o"], 1), "d": round(v["d"], 1), "t": round(v["t"], 1), "src": "proj"}
for k, v in L.items():
    if k in out or k not in R: continue
    net100 = R[k] * 100 / avgT_p            # points per game → per 100 possessions
    out[k] = {"o": round(avgO_p + net100 / 2, 1), "d": round(avgD_p - net100 / 2, 1), "t": round(v["t"], 1), "src": "rating"}
json.dump({"avgO": round(avgO_p, 1), "avgD": round(avgD_p, 1), "avgT": round(avgT_p, 1), "shrink": shrink, "teams": out},
          open(DATA / "team_pace_eff.json", "w"), separators=(",", ":"))
print(f"{len(P)} projected + {len(out) - len(P)} rating-split lines → team_pace_eff.json")
