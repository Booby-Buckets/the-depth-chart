#!/usr/bin/env python3
"""Player weights for 2026-27 rosters -> scripts/data/player_wt_2027.json.

The players table has height + class but no weight. Official school roster pages
(scripts/data/school_rosters_2027.json, scrape_school_rosters.py) list weight for ~90%
of players. Output: {"Team": {"normalized name": lb, ...}, ...} — team = our short name — plus
"_e": {espn_id: lb} = each current player's latest listed weight in player_history (fallback for
schools whose site has no weights or didn't scrape).
tdc-bio.js reads it (name normalization must match nk() there). Rerun after a roster scrape.
"""
import json, re, unicodedata, urllib.request
from pathlib import Path
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"; KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"

def sb(path):
    out, off = [], 0
    while True:
        req = urllib.request.Request(f"{SB}/rest/v1/{path}&offset={off}&limit=1000", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
        rows = json.load(urllib.request.urlopen(req)); out += rows; off += 1000
        if len(rows) < 1000: return out
DATA = Path(__file__).parent / "data"

def nk(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    return re.sub(r"[^a-z]", "", s)

out = {}
for t in json.load(open(DATA / "school_rosters_2027.json")):
    m = {}
    for p in t.get("players") or []:
        w = p.get("wt")
        try: w = int(float(w))
        except (TypeError, ValueError): continue
        if 120 <= w <= 380: m[nk(p.get("name"))] = w
    if m: out[t["team"]] = m
cur = {str(r["espn_id"]) for r in sb("players?select=espn_id&espn_id=not.is.null&order=id.asc")}
E = {}
for r in sb("player_history?season_year=gte.2022&weight=not.is.null&select=espn_id,weight,season_year&order=id.asc"):
    e = str(r.get("espn_id") or "")
    try: w = int(float(r["weight"]))
    except (TypeError, ValueError): continue
    if e in cur and 120 <= w <= 380 and (e not in E or r["season_year"] >= E[e][0]): E[e] = (r["season_year"], w)
out["_e"] = {e: w for e, (_, w) in E.items()}
(DATA / "player_wt_2027.json").write_text(json.dumps(out, separators=(",", ":")))
print(f"{len(out["_e"])} history fallbacks, {len(out)-1} teams, {sum(len(v) for v in out.values())} weights")
