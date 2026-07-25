#!/usr/bin/env python3
"""
build_projgrade_bridge.py — calibrate the line -> grade bridge for projection model v5.

The whole rebuild rests on: grade = f( estBPM(stat line) ). Before we grade PROJECTED
lines we must confirm the bridge reproduces REAL grades: feed each historical player's
ACTUAL line through estBPM and fit grade ~ a + b*estBPM. Good fit => the bridge is sound
and we can trust it on projected lines. Also reports the residual so we know the noise.

Writes scripts/data/projgrade_bridge.json  { "a":..., "b":..., "r2":..., "rmse":... }
Usage: python3 scripts/build_projgrade_bridge.py
"""
import urllib.request, json, os, math

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
OUT = os.path.join(os.path.dirname(__file__), "data", "projgrade_bridge.json")


def q_all(path):
    out = []; start = 0
    while True:
        h = dict(H); h["Range-Unit"] = "items"; h["Range"] = f"{start}-{start+999}"
        chunk = json.load(urllib.request.urlopen(urllib.request.Request(SB + "/rest/v1/" + path, headers=h), timeout=60))
        out += chunk
        if len(chunk) < 1000: break
        start += 1000
    return out


def n(d, k):
    try: return float(d.get(k))
    except Exception: return 0.0


# port of tdc-freshman.js estBPM(L) — estimated BPM from a box line (R^2~.59 to bbref bpm)
def est_bpm(mpg, pts, trb, ast, stl, blk, tov, fga, fta):
    mpg = max(8.0, mpg or 20.0); k = 36.0 / mpg
    fga = fga or max(2.0, mpg * 0.30); fta = fta or 0.0
    tsa = fga + 0.44 * fta; ts = pts / (2 * tsa) if tsa > 0 else 0.53
    poss = fga + 0.44 * fta + tov; team_poss = (mpg / 40.0) * 68.0
    usg = 100.0 * poss / team_poss if team_poss > 0 else 20.0
    return (-3.9475 + 0.1852 * pts * k + 0.2810 * trb * k + 1.1877 * ast * k
            + 1.7021 * stl * k + 1.1577 * blk * k - 2.6101 * tov * k
            + 0.2469 * (ts - 0.53) * 100 + 0.1772 * (usg - 20))


def line_bpm(pg):
    mpg = n(pg, "mp_per_g")
    if mpg < 10: return None
    pts = n(pg, "pts_per_g") or (2 * n(pg, "fg2_per_g") + 3 * n(pg, "fg3_per_g") + n(pg, "ft_per_g"))
    trb = n(pg, "trb_per_g") or (n(pg, "orb_per_g") + n(pg, "drb_per_g"))
    return est_bpm(mpg, pts, trb, n(pg, "ast_per_g"), n(pg, "stl_per_g"), n(pg, "blk_per_g"),
                   n(pg, "tov_per_g"), n(pg, "fga_per_g"), n(pg, "fta_per_g"))


def main():
    rows = []
    for yr in range(2012, 2027):     # grade era with reliable tdc_grade
        rows += q_all(f"bbref_seasons?season_year=eq.{yr}&select=tdc_grade,pergame")
        print(f"  {yr}: total {len(rows)}", flush=True)
    xs, ys = [], []
    for r in rows:
        try: g = float(r.get("tdc_grade"))
        except Exception: continue
        b = line_bpm(r.get("pergame") or {})
        if b is None or not (40 <= g <= 99): continue
        xs.append(b); ys.append(g)
    N = len(xs)
    mx = sum(xs) / N; my = sum(ys) / N
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    a = my - b * mx
    ss_res = sum((y - (a + b * x)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - my) ** 2 for y in ys)
    r2 = 1 - ss_res / ss_tot
    rmse = math.sqrt(ss_res / N)
    bridge = {"a": round(a, 3), "b": round(b, 3), "r2": round(r2, 3), "rmse": round(rmse, 2), "n": N}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(bridge, open(OUT, "w"), indent=0)
    print(f"\ngrade ≈ {a:.2f} + {b:.3f} * estBPM(line)   R²={r2:.3f}  RMSE={rmse:.2f}  (n={N})")
    for bpm in (-6, -3, 0, 3, 6, 9, 12):
        print(f"  estBPM {bpm:>3} -> grade {a + b * bpm:5.1f}")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
