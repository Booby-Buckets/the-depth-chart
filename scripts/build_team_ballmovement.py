#!/usr/bin/env python3
"""build_team_ballmovement.py — ship a pace-INDEPENDENT ball-movement signal per team so
the projection's scheme layer can move a newcomer's ASSISTS by the system he's joining.

Assists-per-game are pace-driven (fast teams rack them up), and the scheme layer already
scales for pace separately — so ball movement must be measured per possession:
    astPerPoss = team_seasons.apg / team_dna.tempo * 100        (assists per 100 poss)
This isolates a motion/pass-heavy system (Purdue ~30) from an iso-heavy one (~13). Keyed
by the team_dna full name (lowercased) so tdc-proj.js's existing _resolveTeam (short roster
name -> full name) works unchanged, exactly like the havoc/look-quality maps.

Output: scripts/data/team_ballmovement.json = {"astpp": {team_lower: per100}, "lg": median}
Rebounding uses team_dna's oORB/dDRB directly (already loaded) — no file needed for those.
"""
import os, json, sys, importlib.util, re
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location("ag", os.path.join(HERE, "archetype_grades.py"))
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
D = os.path.join(HERE, "data")


def strip_mascot(s):
    return re.sub(r"\s+\S+$", "", s or "").strip().lower()


def main():
    dna = json.load(open(os.path.join(D, "team_dna.json")))["2026"]["teams"]
    tempo = {f: v.get("tempo") for f, v in dna.items() if v.get("tempo")}
    ts = ag.get("team_seasons?select=team,apg&season_year=eq.2026&apg=not.is.null", "")

    # team_seasons and team_dna both use "Name Mascot" — try exact first, then mascot-strip
    apg_by_full = {r["team"]: r["apg"] for r in ts}
    apg_by_strip = {strip_mascot(r["team"]): r["apg"] for r in ts}

    astpp, matched = {}, 0
    for full, tp in tempo.items():
        apg = apg_by_full.get(full)
        if apg is None:
            apg = apg_by_strip.get(strip_mascot(full))
        if apg is None or not tp:
            continue
        astpp[full.lower()] = round(apg / tp * 100, 2)
        matched += 1

    vals = sorted(astpp.values())
    lg = round(float(np.median(vals)), 2)
    path = os.path.join(D, "team_ballmovement.json")
    json.dump({"metric": "ast_per_100_poss", "lg": lg, "astpp": astpp}, open(path, "w"))
    print("wrote %s — %d teams matched, league median %.1f (p10 %.1f / p90 %.1f)"
          % (path, matched, lg, np.percentile(vals, 10), np.percentile(vals, 90)))
    # sanity: motion vs iso
    ex = sorted(astpp.items(), key=lambda x: -x[1])
    print("  most passing:", [(t.split()[0], v) for t, v in ex[:3]])
    print("  most iso    :", [(t.split()[0], v) for t, v in ex[-3:]])


if __name__ == "__main__":
    main()
