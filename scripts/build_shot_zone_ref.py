#!/usr/bin/env python3
"""Per-season D-I zone benchmarks for the shot charts, from the CBBD shot cache.

tdc-shotchart.js colours every zone by FG% *vs the D-I average*; those averages were
hard-coded guesses (rim .615, paint .415, mid .38, corner .36, above-break .335).
This computes the real number for each season from the located shots pulled by
build_shots_cbbd.py (scripts/data/cbbd_cache), using the same ten-zone classifier
as the chart, and writes scripts/data/shot_zone_ref.json:

  {"seasons": {"2025": {"n": 706606, "zones": {"rim": {"a":..,"m":..,"p":..,"share":..}, ...},
                        "fga3_share": .., "rim_share": .., "ast_share": ..}}, "latest": 2025}

  python3 scripts/build_shot_zone_ref.py            # every season in the cache
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_shots_cbbd as B

OUT = os.path.join(B.HERE, "data", "shot_zone_ref.json")
HOOP_X, HOOP_Y = 25.0, 5.25
R3, CORNER_X = 22.15, 3.35
CORNER_Y = HOOP_Y + math.sqrt(max(0.0, R3 * R3 - (HOOP_X - CORNER_X) ** 2))
ZONES = ["rim", "paint", "midl", "midc", "midr", "c3l", "c3r", "w3l", "t3", "w3r"]

def zone10(x, y, sv):
    """Mirror of tdc-shotchart.js zone10 (x across, y = feet from the baseline)."""
    d = math.hypot(x - HOOP_X, y - HOOP_Y)
    if sv == 3:
        if y <= CORNER_Y - 0.4: return "c3l" if x < HOOP_X else "c3r"
        return "w3l" if x < 19 else ("w3r" if x > 31 else "t3")
    if d <= 4: return "rim"
    if 19 <= x <= 31 and y <= 19: return "paint"
    return "midl" if x < 19 else ("midr" if x > 31 else "midc")

def seasons_in_cache():
    ys = set()
    for f in os.listdir(B.CACHE):
        if f.startswith("roster_"): ys.add(int(f[7:11]))
    return sorted(ys)

def build(season):
    ath, team = B.id_maps(season)
    Z = {z: [0, 0] for z in ZONES}; n = 0; ast = 0
    for r in B.rows_for(season, B.season_plays(season), ath, team):
        z = zone10(r["x"], r["y"] + HOOP_Y, r["sv"])
        Z[z][1] += 1; n += 1
        if r["made"]:
            Z[z][0] += 1
            if r["ast_id"]: ast += 1
    made = sum(m for m, a in Z.values())
    zones = {z: {"a": a, "m": m, "p": round(m / a, 4) if a else None, "share": round(a / n, 4)} for z, (m, a) in Z.items()}
    three = sum(Z[z][1] for z in ("c3l", "c3r", "w3l", "t3", "w3r"))
    return {"n": n, "zones": zones,
            "fga3_share": round(three / n, 4), "rim_share": round(Z["rim"][1] / n, 4),
            "ast_share": round(ast / made, 4) if made else None}

def main():
    ref = {"seasons": {}}
    if os.path.exists(OUT):
        try: ref = json.load(open(OUT))
        except Exception: pass
    for y in seasons_in_cache():
        s = build(y); ref["seasons"][str(y)] = s
        print(y, s["n"], "FGA;", " ".join("%s %.1f%%" % (z, 100 * (s["zones"][z]["p"] or 0)) for z in ZONES), flush=True)
    ref["latest"] = max(int(k) for k in ref["seasons"])
    json.dump(ref, open(OUT, "w"), separators=(",", ":"))
    print("wrote", OUT)

if __name__ == "__main__":
    main()
