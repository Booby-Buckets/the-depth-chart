#!/usr/bin/env python3
"""build_archetype_expectations.py — precompute the expectation model for the
archetype player rating so it can be applied CLIENT-SIDE off the real projected line.

The rating measures a player against what a player of his HEIGHT + POSITION is
expected to produce (per-40), learned from 20 years of history. This ships those
learned curves as a small JSON the browser can evaluate — expected[pos][stat] is a
quadratic in height, plus the residual spread for z-scoring, plus population stats
for the custom metrics and the category weights. See scripts/archetype_grades.py
for the prototype that validated the methodology (Boozer #1 at 98.6, etc.).

Output: scripts/data/archetype_expectations.json
"""
import os, json, sys, importlib.util
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
# reuse the validated reference-load + fit from the prototype
sys.argv = [sys.argv[0]]   # keep archetype_grades' __main__ guard from running its demo
spec = importlib.util.spec_from_file_location("ag", os.path.join(HERE, "archetype_grades.py"))
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)

D = os.path.join(HERE, "data")

# category weights (user's spec + the Impact dimension from the custom stats)
WEIGHTS = {"Scoring": 0.18, "Creation": 0.18, "Efficiency": 0.14, "Defense": 0.18,
           "Rebounding": 0.08, "Shooting": 0.08, "Versatility": 0.04, "Impact": 0.12}


def main():
    print("loading 20yr reference population…")
    pop = ag.load_reference()
    print("  qualified seasons:", len(pop))
    exp = ag.fit_expectations(pop)

    out_exp = {}
    for posn, stats in exp.items():
        out_exp[posn] = {}
        for stat, (coef, sd) in stats.items():
            out_exp[posn][stat] = {"coef": [round(float(c), 6) for c in np.atleast_1d(coef)],
                                   "sd": round(float(sd), 4)}

    # population stats for the custom (shot-genome) metrics used by Efficiency/Shooting
    sg = {}
    try:
        sgp = json.load(open(os.path.join(D, "shot_genome_players.json")))["players"]
        lqs = [p["lq"] for p in sgp if p.get("lq") is not None]
        sg["lookq"] = {"mean": round(float(np.mean(lqs)), 3), "std": round(float(np.std(lqs)), 3)}
    except Exception as e:
        print("  (shot genome pop stats skipped:", e, ")")

    payload = {
        "season": 2026,
        "n_reference": len(pop),
        "positions": ["PG", "SG", "SF", "PF", "C"],
        "rate_stats": ag.RATE,
        "eff_stats": ag.EFF,
        "weights": WEIGHTS,
        "pop": sg,
        # calibration of the archetype bonus that layers on the projected grade —
        # CENTERED on the current-pool mean composite (~0.30, from the 524-player
        # distribution) so half get a positive bonus / half negative; K maps the spread
        # (std ~0.33) to grade points; bounded so it reshapes without overwhelming.
        "calibration": {"center": 0.30, "k": 3.0, "archMin": -3, "archMax": 4},
        "expectations": out_exp,
        "notes": "rating = projected_grade + clamp(k*(composite-center), archMin, archMax); "
                 "expected[pos][stat] = polyval(coef, height_in); z = (actual_per40 - expected)/sd",
    }
    path = os.path.join(D, "archetype_expectations.json")
    json.dump(payload, open(path, "w"))
    sz = os.path.getsize(path)
    print("wrote %s (%.1f KB) — %d positions x %d stats" % (path, sz / 1024, len(out_exp), len(ag.RATE) + len(ag.EFF)))
    # sanity: expected RPG for a few profiles (should match the prototype)
    def E(posn, ht, stat):
        c = out_exp[posn][stat]["coef"]; return float(np.polyval(c, ht))
    print("  sanity — expected RPG/40: 6'2\" PG %.1f, 6'9\" PF %.1f, 7'0\" C %.1f"
          % (E("PG", 74, "rpg"), E("PF", 81, "rpg"), E("C", 84, "rpg")))


if __name__ == "__main__":
    main()
