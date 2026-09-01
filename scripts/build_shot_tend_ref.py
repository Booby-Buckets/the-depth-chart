#!/usr/bin/env python3
"""build_shot_tend_ref.py — per-season shot-tendency reference for HISTORICAL views.

The 2026-27 projection emits per-player shot_tend already. For PAST seasons the team
page has each roster player's real box line (fga/mpg/tpa/fta) but no national context
to turn a per-40 rate into a 0-100 tendency percentile. Rather than ship a huge
per-player history file, we precompute — for each season — the sorted per-40
distributions (as 101 quantile breakpoints) for total shots / 3PA / 2PA / FTA. The
team page then percentiles each historic player against his own season client-side.

Read-only vs the DB (anon key). Writes scripts/data/shot_tend_ref.json.
"""
import os, sys, json, urllib.request
import numpy as np

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
D = os.path.join(os.path.dirname(__file__), "data")
MIN_MPG = 8.0          # rotation players only — tendency is measured among guys who play
SEASONS = list(range(2009, 2027))
NQ = 101               # 0..100th percentile breakpoints

def get(path):
    r = urllib.request.Request(SB + "/rest/v1/" + path,
                               headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    return json.load(urllib.request.urlopen(r, timeout=90))

def season_rows(yr):
    out, off = [], 0
    while True:
        # stable order (espn_id) so pagination can't drop/dupe rows
        c = get(f"player_history?select=mpg,fga,tpa,fta,gp&season_year=eq.{yr}"
                f"&order=espn_id.asc.nullslast&limit=1000&offset={off}")
        out += c
        if len(c) < 1000:
            break
        off += 1000
    return out

def num(v):
    try: return float(v)
    except: return 0.0

ref = {}
for yr in SEASONS:
    rows = season_rows(yr)
    f40, t3, t2, ft = [], [], [], []
    for r in rows:
        m = num(r.get("mpg"))
        if m < MIN_MPG:
            continue
        fga, tpa, fta = num(r.get("fga")), num(r.get("tpa")), num(r.get("fta"))
        f40.append(fga * 40.0 / m)
        t3.append(tpa * 40.0 / m)
        t2.append(max(0.0, (fga - tpa) * 40.0 / m))
        ft.append(fta * 40.0 / m)
    if len(f40) < 50:
        print(f"  {yr}: only {len(f40)} qualifying players — skipping", file=sys.stderr)
        continue
    qs = np.linspace(0, 100, NQ)
    ref[str(yr)] = {
        "f40": [round(float(x), 3) for x in np.percentile(f40, qs)],
        "t3":  [round(float(x), 3) for x in np.percentile(t3,  qs)],
        "t2":  [round(float(x), 3) for x in np.percentile(t2,  qs)],
        "ft":  [round(float(x), 3) for x in np.percentile(ft,  qs)],
        "n":   len(f40),
    }
    print(f"  {yr}: {len(f40)} players", file=sys.stderr)

json.dump({"min_mpg": MIN_MPG, "nq": NQ, "seasons": ref},
          open(os.path.join(D, "shot_tend_ref.json"), "w"), separators=(",", ":"))
print(f"Wrote shot_tend_ref.json ({len(ref)} seasons)", file=sys.stderr)
