#!/usr/bin/env python3
"""
build_versatility.py — a bounded "does-a-lot" bump for the grade.

The trained grade leans on scoring volume, so a versatile forward who contributes
across the board but doesn't score 20 (David Mirkovic: 9.6 BPM, 13 ppg) grades below
lower-impact high-usage scorers. This adds a positive-only bump that rewards BREADTH
of NON-SCORING impact — playmaking, defense, floor-spacing, rebounding, efficiency —
each measured RELATIVE TO THE PLAYER'S POSITION (so a center isn't rewarded just for
rebounding, only for out-rebounding other centers). A pure scorer gets ~0; a true
five-tool contributor gets up to +4.

Emits scripts/data/versatility_adj.json = {espn_id: bump} for the 2025-26 season,
consumed live by tdc-projgrade.js (so no DB write) and folded into the grade anchor,
then flows into the coupled-grade regen.

Usage: python3 build_versatility.py   (prints the biggest movers; --write not needed,
always writes the JSON — it's a derived, reversible overlay)
"""
import json, os, urllib.request
from statistics import mean, pstdev

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
D = os.path.join(os.path.dirname(__file__), "data")
SEASON = 2026
VMAX = 2.5            # bump ceiling
MIN_MP = 500         # need real minutes for the advanced stats to mean anything

def get(path):
    rows, frm = [], 0
    while True:
        req = urllib.request.Request(SB + "/rest/v1/" + path,
              headers={**HDR, "Range": "%d-%d" % (frm, frm + 999), "Range-Unit": "items"})
        b = json.load(urllib.request.urlopen(req, timeout=90)); rows += b
        if len(b) < 1000: break
        frm += 1000
    return rows

def posgroup(pos):
    p = (pos or "").upper().replace("/", "")
    if p in ("PG", "SG", "CG", "G"): return "G"
    if p in ("SF", "GF", "W"): return "W"
    return "B"   # PF, C, F, FC…

def fnum(x):
    try: return float(x)
    except (TypeError, ValueError): return None

def main():
    players = {str(p["espn_id"]): p for p in get(
        "players?select=name,team,position,tdc_grade,ppg,espn_id") if p.get("espn_id")}
    bb = get("bbref_seasons?season_year=eq.%d&select=player,espn_id,advanced,pergame" % SEASON)

    # assemble per-player dims from bbref advanced + pergame
    recs = []
    for b in bb:
        e = str(b.get("espn_id") or "")
        if e not in players: continue
        adv = b.get("advanced") or {}; pg = b.get("pergame") or {}
        mp = fnum(adv.get("mp"))
        if not mp or mp < MIN_MP: continue
        ast = fnum(adv.get("ast_pct")); dbpm = fnum(adv.get("dbpm"))
        trb = fnum(adv.get("trb_pct")); ts = fnum(adv.get("ts_pct"))
        tr3 = fnum(adv.get("fg3a_per_fga_pct")); tp = fnum(pg.get("fg3_pct"))
        stl = fnum(adv.get("stl_pct")); blk = fnum(adv.get("blk_pct"))
        bpm = fnum(adv.get("bpm"))
        # floor-spacing = shoots threes AND makes them (0 if he doesn't shoot them)
        spacing = ((tr3 or 0) * ((tp or 0) - 0.30)) if (tr3 and tr3 >= 0.15 and tp) else 0.0
        stocks = (stl or 0) + (blk or 0)
        grade = fnum(players[e].get("tdc_grade")) or 70
        recs.append({"e": e, "grp": posgroup(players[e].get("position")),
                     "ast": ast or 0, "def": (dbpm or 0), "trb": trb or 0, "ts": ts or 0,
                     "space": spacing, "stocks": stocks, "bpm": bpm or 0, "mp": mp, "grade": grade})

    dims = ["ast", "def", "trb", "ts", "space", "stocks"]
    weights = {"ast": 1.0, "def": 1.0, "trb": 0.7, "ts": 0.7, "space": 0.9, "stocks": 0.7}
    # z-score each dim WITHIN position group
    zstats = {}
    for grp in ("G", "W", "B"):
        sub = [r for r in recs if r["grp"] == grp]
        for dm in dims:
            vals = [r[dm] for r in sub]
            m = mean(vals) if vals else 0; sd = pstdev(vals) if len(vals) > 1 else 1
            zstats[(grp, dm)] = (m, sd or 1)

    out = {}
    for r in recs:
        breadth = 0.0
        for dm in dims:
            m, sd = zstats[(r["grp"], dm)]
            z = (r[dm] - m) / sd
            breadth += weights[dm] * max(0.0, min(2.0, z))   # only above-average counts, capped
        # a real-impact term (elite all-around BPM the scoring grade under-rewards) and a
        # ROLE gate — a 4-ppg specialist's per-possession breadth isn't undervaluation, so
        # scale the whole bump by minutes (0 at 600 mp → full at 1000+).
        bpm_term = max(0.0, min(1.2, (r["bpm"] - 6.5) * 0.35))
        role = max(0.0, min(1.0, (r["mp"] - 600) / 400.0))
        # taper toward the top: an already-elite grade is not being under-rated for
        # versatility, so the bump fades out above ~87 (nearly nothing by 93).
        taper = max(0.2, min(1.0, (93 - r["grade"]) / 6.0))
        bump = max(0.0, min(VMAX, ((breadth - 1.5) * 0.9 + bpm_term) * role * taper))
        bump = round(bump * 10) / 10
        if bump >= 0.5:
            out[r["e"]] = bump

    path = os.path.join(D, "versatility_adj.json")
    json.dump({"season": SEASON, "n": len(out), "vmax": VMAX, "bumps": out},
              open(path, "w"), separators=(",", ":"))
    print("wrote %s — %d players bumped" % (path, len(out)))
    ranked = sorted(out.items(), key=lambda kv: -kv[1])
    print("\nBiggest bumps (grade will rise by this much):")
    for e, bump in ranked[:18]:
        p = players[e]
        print("  +%.1f  %-22s %-16s grade %s (%s ppg)" % (bump, p["name"], p["team"], p["tdc_grade"], p.get("ppg")))

if __name__ == "__main__":
    main()
