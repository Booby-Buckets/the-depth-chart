#!/usr/bin/env python3
"""build_team_projected_box.py — projected 2026-27 per-game TEAM box line, from each
team's roster's REAL per-game production (player_history), normalized to a 200-minute
team. Fills the projected-rankings box columns (PPG/FG%/OReb/…) for teams whose
team_projections row is missing or zeroed (e.g. Gonzaga).

Method: each roster player's per-40 rates x his projected minutes (SLOT_MIN by
depth_order, floored at last mpg), with the rotation's minutes scaled to 200
(5 x 40). Percentages are attempt-weighted. Returners only (players with a real
player_history line); teams are keyed by the SAME full name the index/team_eff use.

Writes scripts/data/team_projected_box.json  { full_team_name: {ppg,rpg,apg,fg_pct,
tp_pct,ft_pct,fga,tpa,tov,stl,blk,oreb,dreb} }. Read-only vs the DB.
"""
import json, urllib.request, pathlib, re
from collections import defaultdict
D = pathlib.Path(__file__).parent / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"; K = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": K, "Authorization": "Bearer " + K}
SLOT_MIN = [0, 31, 30, 29, 27, 25, 19, 16, 12, 9, 7]

def sb(path):
    out, off = [], 0
    while True:
        b = json.load(urllib.request.urlopen(urllib.request.Request(
            SB + "/rest/v1/" + path + ("&" if "?" in path else "?") + f"limit=1000&offset={off}", headers=H), timeout=60))
        out += b
        if len(b) < 1000: break
        off += 1000
    return out

def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None

def proj_mpg(depth, last, starter):
    d = None
    try: d = int(depth)
    except (TypeError, ValueError): d = None
    slot = (SLOT_MIN[d] if d and 1 <= d < len(SLOT_MIN) else (5 if d and d >= len(SLOT_MIN) else 0))
    last = last or 0
    floor = last * 0.9 if last > 0 else 0
    if starter and (d is None or d <= 6): floor = max(floor, 28)
    pm = max(slot, floor)
    if d is None and last > 0: pm = last
    return pm

import sys
print("Pulling rosters + real per-game history...", file=sys.stderr)
players = sb("players?select=team,name,espn_id,mpg,depth_order,starter&name=neq.%E2%80%94")
# latest real per-game line per espn_id
ph = sb("player_history?select=espn_id,season_year,ppg,rpg,apg,mpg,fgm,fga,tpm,tpa,ftm,fta,oreb,dreb,stl,blk,tovs")
latest = {}
for r in ph:
    e = r.get("espn_id")
    if e is None: continue
    if e not in latest or (num(r.get("season_year")) or 0) > (num(latest[e].get("season_year")) or 0):
        latest[e] = r

# short->full team name (match index/team_eff keys), from predictive_ratings
S2F = {}
try:
    pr = json.load(urllib.request.urlopen(urllib.request.Request(
        SB + "/rest/v1/predictive_ratings?season=eq.2027&select=data&limit=1", headers=H), timeout=60))
    for t in (pr[0]["data"]["teams"] if pr else []):
        if t.get("team") and t.get("full"): S2F[t["team"].lower()] = t["full"]
except Exception as e:
    print("warn: no predictive_ratings map", e)

by = defaultdict(list)
for p in players: by[p["team"]].append(p)

CNT = ["ppg", "rpg", "apg", "oreb", "dreb", "stl", "blk", "tov"]
out = {}
for team, roster in by.items():
    # gather returners with a real line + projected minutes
    rp = []
    for p in roster:
        e = p.get("espn_id"); h = latest.get(e) if e is not None else None
        if not h: continue
        mpg = num(h.get("mpg")) or 0
        if mpg < 4: continue
        pm = proj_mpg(p.get("depth_order"), num(p.get("mpg")) or mpg,
                      str(p.get("starter")).lower() in ("true", "t"))
        rp.append((h, mpg, pm))
    if len(rp) < 4: continue                      # too little to form a team line
    tot_pm = sum(x[2] for x in rp) or 1
    scale = 200.0 / tot_pm                          # normalize rotation to a 200-min team
    agg = {k: 0.0 for k in CNT}
    fgm = fga = tpm = tpa = ftm = fta = 0.0
    for h, mpg, pm in rp:
        w = (pm * scale) / max(mpg, 1)              # per-game -> projected-minute share
        agg["ppg"] += (num(h.get("ppg")) or 0) * w
        agg["rpg"] += (num(h.get("rpg")) or 0) * w
        agg["apg"] += (num(h.get("apg")) or 0) * w
        agg["oreb"] += (num(h.get("oreb")) or 0) * w
        agg["dreb"] += (num(h.get("dreb")) or 0) * w
        agg["stl"] += (num(h.get("stl")) or 0) * w
        agg["blk"] += (num(h.get("blk")) or 0) * w
        agg["tov"] += (num(h.get("tovs")) or 0) * w
        # makes/attempts robust to swapped columns in player_history (tpm/tpa are
        # inconsistent): attempts = the larger, makes = the smaller.
        def ma(mk, at):
            m = num(h.get(mk)) or 0; a = num(h.get(at)) or 0; return (min(m, a), max(m, a))
        fm, fa = ma("fgm", "fga"); tm, ta = ma("tpm", "tpa"); rm, ra = ma("ftm", "fta")
        fgm += fm * w; fga += fa * w; tpm += tm * w; tpa += ta * w; ftm += rm * w; fta += ra * w
    line = {k: round(agg[k], 1) for k in CNT}
    line["fga"] = round(fga, 1); line["tpa"] = round(tpa, 1)
    line["fg_pct"] = round(100 * fgm / fga, 1) if fga else 0
    line["tp_pct"] = round(100 * tpm / tpa, 1) if tpa else 0
    line["ft_pct"] = round(100 * ftm / fta, 1) if fta else 0
    key = S2F.get(team.lower()) or team
    out[key] = line

json.dump(out, open(D / "team_projected_box.json", "w"), separators=(",", ":"))
print(f"wrote team_projected_box.json — {len(out)} teams")
for t in ["Gonzaga Bulldogs", "Duke Blue Devils", "Virginia Tech Hokies", "Houston Cougars"]:
    if t in out: print(f"  {t}: PPG {out[t]['ppg']} FG% {out[t]['fg_pct']} 3P% {out[t]['tp_pct']} OReb {out[t]['oreb']} AST {out[t]['apg']}")
