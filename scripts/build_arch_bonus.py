#!/usr/bin/env python3
"""build_arch_bonus.py — precompute the ARCHETYPE BONUS per current (2026) player so
the grade engine can layer it on and make the site-wide grade BECOME the TDC Rating.

BOX-ONLY (user 2026-07-31): to grade every season the same way, the bonus uses only
box-derived, expectation-relative categories (height/position expected per-40 -> how
unusual the player is for his archetype). No Shot Genome / on-off / team-success here
— those live only for 2026 and would break cross-year consistency. The bonus is
re-centered on the 2026 rotation pool (season_centers["2026"]) so the median returner
nets ~0 and only the genuinely-unusual move. Keyed by players.id so gradeSolo/
gradeRoster can add it directly. This is identical math to tdc-rating.js's box path,
so the precomputed 2026 bonus and the client-side historical bonus agree.

Output: scripts/data/arch_bonus.json = {"bonuses": {players.id: delta}}
"""
import os, json, sys, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location("ag", os.path.join(HERE, "archetype_grades.py"))
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
D = os.path.join(HERE, "data")

E = json.load(open(os.path.join(D, "archetype_expectations.json")))
CAL = E["calibration"]
K, AMIN, AMAX = CAL["k"], CAL["archMin"], CAL["archMax"]
DAMP_K, DAMP_REF, DAMP_CAP = CAL.get("damp_k", 0.8), CAL.get("damp_ref", 3.0), CAL.get("damp_cap", 2.0)
BOXW = E["box_weights"]
CENTER = E["season_centers"].get("2026", E["box_center"])
# team strength (SRS z) for 2026 — the weak-team dampener context
TSTR = json.load(open(os.path.join(D, "team_strength.json")))["z"].get("2026", {})


def clamp(v, a, b): return max(a, min(b, v))


def team_z(team):
    if not team:
        return 0.0
    lo = str(team).lower().strip()
    if lo in TSTR:
        return TSTR[lo]
    for f in TSTR:                      # prefix-tolerant (short vs full)
        if f == lo or lo.startswith(f + " ") or f.startswith(lo + " ") or (len(lo) >= 5 and f.startswith(lo)):
            return TSTR[f]
    return 0.0


def team_damp(bonus, team):
    if bonus <= 0:
        return 0.0
    tz = team_z(team)
    if tz >= 0:
        return 0.0
    weak = min(-tz, DAMP_CAP)
    frac = min(bonus / DAMP_REF, 1.0)
    return -DAMP_K * weak * frac


def box_composite(exp, r):
    base = ag.rate_player(exp, r)
    if not base:
        return None
    _, cats, _ = base
    return sum(BOXW[k] * cats[k] for k in BOXW)


def main():
    print("fitting expectations… (box-only, center=%.3f)" % CENTER)
    exp = ag.fit_expectations(ag.load_reference())
    cur = ag.get("players?tdc_grade=not.is.null&height=not.is.null&mpg=gte.12&gp=gte.15",
                 "id,espn_id,name,team,position,height,mpg,gp,ppg,rpg,apg,stl,blk,tpa,fga,fta,tovs,oreb,dreb,fg_pct,tp_pct,ft_pct,tdc_grade")
    out = {}
    ndamp = 0
    for r in cur:
        c = box_composite(exp, r)
        if c is None:
            continue
        raw = clamp(K * (c - CENTER), AMIN, AMAX)
        d = team_damp(raw, r.get("team"))
        if d <= -0.05:
            ndamp += 1
        out[str(r["id"])] = round(clamp(raw + d, AMIN, AMAX), 1)
    print("  weak-team dampener applied to %d players" % ndamp)
    path = os.path.join(D, "arch_bonus.json")
    json.dump({"season": 2026, "n": len(out), "box_only": True,
               "center": CENTER, "calibration": CAL, "bonuses": out}, open(path, "w"))
    vals = sorted(out.values()); n = len(vals)
    print("wrote %s — %d players; bonus min %.1f / median %.1f / max %.1f"
          % (path, n, vals[0], vals[n // 2], vals[-1]))


if __name__ == "__main__":
    main()
