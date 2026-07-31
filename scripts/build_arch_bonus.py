#!/usr/bin/env python3
"""build_arch_bonus.py — precompute the ARCHETYPE BONUS per current player so the
grade engine can layer it on and make the site-wide grade BECOME the TDC Rating.

Replaces the old crude 'versatility' bump: the bonus here is the calibrated,
expectation-relative archetype/custom composite (height/position expected production
-> deviations -> weighted categories + Shot Genome + team success), mapped to grade
points exactly as tdc-rating.js does (center 0.30, k 3.0, bounded -3..+4). Keyed by
players.id (like the coupled grades) so gradeSolo/gradeRoster can add it directly.

Output: scripts/data/arch_bonus.json = {"bonuses": {players.id: delta}}
"""
import os, json, sys, importlib.util
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location("ag", os.path.join(HERE, "archetype_grades.py"))
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
D = os.path.join(HERE, "data")

CAL = json.load(open(os.path.join(D, "archetype_expectations.json")))["calibration"]
CENTER, K, AMIN, AMAX = CAL["center"], CAL["k"], CAL["archMin"], CAL["archMax"]
W = {"Scoring": 0.18, "Creation": 0.18, "Efficiency": 0.14, "Defense": 0.18,
     "Rebounding": 0.08, "Shooting": 0.08, "Versatility": 0.04, "Impact": 0.12}

sg = {str(p["espn_id"]): p for p in json.load(open(os.path.join(D, "shot_genome_players.json")))["players"] if p.get("espn_id")}
teams = json.load(open(os.path.join(D, "team_dna.json")))["2026"]["teams"]
tnet = {f: (v.get("adjNet") if v.get("adjNet") is not None else v.get("net")) for f, v in teams.items()}
vv = [v for v in tnet.values() if v is not None]
Tm, Ts = float(np.mean(vv)), float(np.std(vv))
lqs = [p["lq"] for p in sg.values() if p.get("lq") is not None]
LQm, LQs = float(np.mean(lqs)), float(np.std(lqs))
num = ag.num


def clamp(v, a, b): return max(a, min(b, v))
def zpct(p): return (p - 50) / 30.0 if p is not None else 0.0


def composite(exp, r):
    base = ag.rate_player(exp, r)
    if not base:
        return None
    _, cats, _ = base
    ek = str(r.get("espn_id"))
    G = sg.get(ek)
    sm = zpct(G["smPct"]) if G and G.get("smPct") is not None else 0.0
    slf = zpct(G["selfPctl"]) if G and G.get("selfPctl") is not None else 0.0
    lq = (G["lq"] - LQm) / LQs if G and G.get("lq") is not None else 0.0
    full = G["team"] if G else (r.get("team") or "")
    role = clamp((num(r.get("mpg")) or 0) / 27.0, 0, 1.15)
    tz = ((tnet.get(full, 0.0) - Tm) / Ts) if tnet.get(full) is not None else 0.0
    C = {"Scoring": 0.6 * cats["Scoring"] + 0.4 * sm,
         "Creation": 0.6 * cats["Creation"] + 0.4 * slf,
         "Efficiency": 0.35 * cats["Efficiency"] + 0.65 * (0.5 * lq + 0.5 * sm),
         "Defense": cats["Defense"], "Rebounding": cats["Rebounding"],
         "Shooting": cats["Shooting"], "Versatility": cats["Versatility"],
         "Impact": clamp(tz * role, -2.5, 3.0)}
    return sum(W[k] * C[k] for k in W)


def main():
    print("fitting expectations…")
    exp = ag.fit_expectations(ag.load_reference())
    cur = ag.get("players?tdc_grade=not.is.null&height=not.is.null&mpg=gte.12&gp=gte.15",
                 "id,espn_id,name,team,position,height,mpg,gp,ppg,rpg,apg,stl,blk,tpa,fga,fta,tovs,oreb,dreb,fg_pct,tp_pct,ft_pct,tdc_grade")
    out = {}
    for r in cur:
        c = composite(exp, r)
        if c is None:
            continue
        bonus = round(clamp(K * (c - CENTER), AMIN, AMAX), 1)
        out[str(r["id"])] = bonus
    path = os.path.join(D, "arch_bonus.json")
    json.dump({"season": 2026, "n": len(out), "calibration": CAL, "bonuses": out}, open(path, "w"))
    vals = sorted(out.values())
    n = len(vals)
    print("wrote %s — %d players; bonus min %.1f / median %.1f / max %.1f"
          % (path, n, vals[0], vals[n // 2], vals[-1]))


if __name__ == "__main__":
    main()
