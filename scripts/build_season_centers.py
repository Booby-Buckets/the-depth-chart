#!/usr/bin/env python3
"""build_season_centers.py — add per-season BOX-ONLY centers + box weights to the
archetype expectations, so the grade can be made consistent across EVERY year.

"Box only for every year" (user 2026-07-31): historical seasons have no Shot Genome
or team-success/on-off data, so the site-wide archetype grade drops those layers and
grades every season the same box way. To avoid a systematic drift when the bonus is
applied to an old year, each season is RE-CENTERED on its own pool: the bonus is
    clamp(k * (box_composite - center[season]), archMin, archMax)
where center[season] = mean box composite over that season's rotation pool. So the
median rotation player nets ~0 and only the genuinely-unusual-for-their-archetype
move — the same reshaping we validated on 2024-25 (Flagg 96 -> ~100, corr 0.990).

Adds to scripts/data/archetype_expectations.json:
  box_weights     — the category weights with Impact dropped + renormalized
  season_centers  — {season_year: mean box composite over rotation pool}
  box_center      — global fallback (pooled mean)
"""
import os, json, sys, importlib.util
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location("ag", os.path.join(HERE, "archetype_grades.py"))
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
D = os.path.join(HERE, "data")

# full weights (with Impact) -> box weights (Impact dropped, renormalized to sum 1)
FULL = {"Scoring": 0.18, "Creation": 0.18, "Efficiency": 0.14, "Defense": 0.18,
        "Rebounding": 0.08, "Shooting": 0.08, "Versatility": 0.04, "Impact": 0.12}
BOXW = {k: v for k, v in FULL.items() if k != "Impact"}
_s = sum(BOXW.values())
BOXW = {k: round(v / _s, 5) for k, v in BOXW.items()}


def box_composite(exp, r):
    base = ag.rate_player(exp, r)
    if not base:
        return None
    _, cats, _ = base
    return sum(BOXW[k] * cats[k] for k in BOXW)


def main():
    print("fitting expectations…")
    exp = ag.fit_expectations(ag.load_reference())

    centers, allc = {}, []
    for yr in range(2012, 2027):
        rows = ag.get("player_history?season_year=eq.%d&mpg=gte.12&gp=gte.15&height=not.is.null" % yr,
                      "position,height,mpg,gp,ppg,rpg,apg,stl,blk,tpa,fga,fta,tovs,oreb,dreb,fg_pct,tp_pct,ft_pct")
        cs = [box_composite(exp, r) for r in rows]
        cs = [c for c in cs if c is not None]
        if not cs:
            continue
        centers[str(yr)] = round(float(np.mean(cs)), 4)
        allc += cs
        print("  %d: n=%d  center(mean)=%.3f  median=%.3f" % (yr, len(cs), np.mean(cs), np.median(cs)))

    box_center = round(float(np.mean(allc)), 4)
    print("global box_center = %.4f  (%d player-seasons)" % (box_center, len(allc)))

    path = os.path.join(D, "archetype_expectations.json")
    e = json.load(open(path))
    e["box_weights"] = BOXW
    e["season_centers"] = centers
    e["box_center"] = box_center
    # keep k / bounds; center handled per-season now
    e["calibration"]["box_center"] = box_center
    json.dump(e, open(path, "w"))
    print("wrote", path, "— box_weights:", BOXW)


if __name__ == "__main__":
    main()
