#!/usr/bin/env python3
"""Each D-I program's home state (Dynasty recruiting: proximity / hometown pull). One ESPN game summary per team:
the venue address of a non-neutral home game in games_2027.jsonl. Writes scripts/data/team_states.json
{full team name: {"state": "NC", "city": "Durham"}}. Run once (and when programs change)."""
import json, time, urllib.request
from pathlib import Path
D = Path(__file__).parent / "data"
SUM = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={}"
members = json.load(open(D / "conf_members_2027.json"))["teams"]
out = json.load(open(D / "team_states.json")) if (D / "team_states.json").exists() else {}
home = {}
for line in open(D / "games_2027.jsonl"):
    g = json.loads(line)
    if not g.get("neutral") and g["home"] in members and g["home"] not in home: home[g["home"]] = g["id"]
todo = [t for t in members if t not in out]
print(len(todo), "to fetch;", len([t for t in todo if t not in home]), "with no home game listed")
for i, t in enumerate(todo):
    gid = home.get(t)
    if not gid: continue
    for k in range(3):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(SUM.format(gid), headers={"User-Agent": "Mozilla/5.0"}), timeout=30)); break
        except Exception:
            time.sleep(2 * (k + 1)); d = None
    a = ((d or {}).get("gameInfo", {}).get("venue", {}) or {}).get("address") or {}
    if a.get("state"): out[t] = {"state": a["state"], "city": a.get("city", "")}
    if (i + 1) % 50 == 0: print(i + 1); json.dump(out, open(D / "team_states.json", "w"), indent=0, sort_keys=True)
    time.sleep(0.15)
json.dump(out, open(D / "team_states.json", "w"), indent=0, sort_keys=True)
print("have", len(out), "of", len(members), "missing:", [t for t in members if t not in out])
