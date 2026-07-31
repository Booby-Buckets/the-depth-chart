#!/usr/bin/env python3
"""build_gp_regression.py — small-sample (games-played) regression for the grade.

A grade built on 6-10 games is a hot (or cold) streak, not a proven talent. The
box-score model takes per-game numbers at face value, so a 6-game 20-ppg cameo can
out-grade a 37-game Final-Four starter. This regresses each returner's grade toward
a rotation-level baseline in proportion to how few games he played:

    conf      = min(1, GP / GP_FULL)          # full confidence by GP_FULL games
    adjusted  = BASELINE + (grade - BASELINE) * conf
    delta     = adjusted - grade              # <= 0, only for GP < GP_FULL

Full seasons (GP >= GP_FULL) are untouched (delta 0). Emits scripts/data/gp_shrink.json
= {players.id: delta}, applied on top of the grade in tdc-projgrade.js (like the
versatility bump, but negative). Keyed by players.id so it composes with coupling.
"""
import os, json, urllib.request, urllib.parse

KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
D = os.path.join(os.path.dirname(__file__), "data")

GP_FULL = 22        # games that earn full confidence (~2/3 of a season)
BASELINE = 76.0     # where a zero-sample player regresses to (rotation level)
MIN_DELTA = 0.5     # ignore trivial shrinks


def get(path):
    rows, frm = [], 0
    while True:
        req = urllib.request.Request(SB + "/rest/v1/" + path,
                                     headers={**HDR, "Range-Unit": "items", "Range": "%d-%d" % (frm, frm + 999)})
        b = json.load(urllib.request.urlopen(req, timeout=60))
        rows += b
        if len(b) < 1000:
            break
        frm += 1000
    return rows


def main():
    players = get("players?select=id,name,team,tdc_grade,gp,mpg&tdc_grade=not.is.null&order=id.asc")
    out = {}
    rows_dbg = []
    for p in players:
        try:
            grade = float(p["tdc_grade"])
        except (TypeError, ValueError):
            continue
        gp = p.get("gp")
        if gp is None:
            continue                       # freshmen / no played season → handled elsewhere
        gp = float(gp)
        if gp >= GP_FULL or grade <= BASELINE:
            continue                       # full season or already at/below baseline → no shrink
        conf = max(0.0, min(1.0, gp / GP_FULL))
        adjusted = BASELINE + (grade - BASELINE) * conf
        delta = round(adjusted - grade, 1)
        if delta <= -MIN_DELTA:
            out[str(p["id"])] = delta
            rows_dbg.append((delta, p["name"], p["team"], grade, int(gp)))

    path = os.path.join(D, "gp_shrink.json")
    json.dump({"gp_full": GP_FULL, "baseline": BASELINE, "n": len(out), "deltas": out},
              open(path, "w"))
    print("wrote %s — %d players regressed" % (path, len(out)))
    rows_dbg.sort()
    print("\nBiggest small-sample regressions (grade will DROP by this much):")
    for delta, nm, tm, g, gp in rows_dbg[:20]:
        print("  %.1f  %-22s %-16s grade %g  (GP=%d)" % (delta, nm, tm, g, gp))


if __name__ == "__main__":
    main()
