#!/usr/bin/env python3
"""build_wins_added.py — OWNED Wins Added, re-sourced from our TI metric (no Win Shares).

Wins Added was WS - 0.04*(MP/40), and WS is Sports-Reference. We keep the STAT but
recompute it from owned data: TI (ti40, our per-40 points-value from box scores) times
minutes played, above a replacement level, on a wins scale. Calibrated so the distribution
matches the familiar old range (median ~0.6, stars ~4-6, elite ~10).

    WA = (ti40 - REPL) * (min/40) / PPW

Emits, from scripts/data/player_advanced.csv (ti40 + min over every season):
  - the 51-point NAT_PCT["wa"] percentile array (for shading)
  - WA_RANK_G all-time rank table (WA value -> #players above) + WA_POOL_N
  - the formula constants
So player.html / team / roster keep Wins Added, now fully owned. Prints JS-ready snippets.
"""
import csv, os, statistics, json

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
REPL = 5.0      # replacement-level ti40 (a below-this player adds ~0)
TARGET_MEDIAN = 0.75  # calibrate PPW so the MEDIAN season maps here — matches the old WS-based
                      # Wins Added median exactly, so the numbers stay familiar (stars ~3-6, elite ~12)


def load():
    rows = []
    with open(os.path.join(D, "player_advanced.csv")) as f:
        for r in csv.DictReader(f):
            try:
                mn = int(r["min"]) if r["min"] else 0
                ti = float(r["ti40"]) if r["ti40"] else None
            except (ValueError, TypeError):
                continue
            if ti is None or mn <= 0:
                continue
            rows.append((ti, mn))
    return rows


def main():
    rows = load()
    raw = [(ti - REPL) * (mn / 40.0) for ti, mn in rows]
    # calibrate PPW so the median season maps to TARGET_MEDIAN (matches old WA median)
    med_raw = statistics.median(raw) or 1.0
    PPW = med_raw / TARGET_MEDIAN
    wa = sorted(x / PPW for x in raw)
    n = len(wa)

    def q(p):
        return round(wa[min(n - 1, int(p * (n - 1)))], 2)
    dist = [q(i / 50.0) for i in range(51)]

    # rank table: for WA thresholds from top down, how many player-seasons are >= it
    hi = wa[-1]
    thresholds = []
    t = round(hi, 1)
    while t >= -1.5:
        thresholds.append(round(t, 1))
        t -= 0.1
    wa_sorted_desc = wa[::-1]
    rank = []
    import bisect
    for th in thresholds:
        # count how many are strictly greater than th
        above = n - bisect.bisect_right(wa, th)
        rank.append([th, above])

    print(f"seasons: {n:,}  ti40 median={statistics.median([r[0] for r in rows]):.1f}")
    print(f"REPL={REPL}  PPW={PPW:.2f}  (median WA={TARGET_MEDIAN})")
    print(f"WA range: {dist[0]} .. {dist[-1]}  p50={dist[25]}  p90={dist[45]}")
    out = {"REPL": REPL, "PPW": round(PPW, 3), "NAT_PCT_wa": dist, "WA_POOL_N": n, "WA_RANK_G": rank}
    with open(os.path.join(D, "wins_added_owned.json"), "w") as f:
        json.dump(out, f)
    print(f"\nwrote data/wins_added_owned.json")
    print(f"\n// paste into player.html:")
    print(f'NAT_PCT["wa"]={json.dumps(dist)};')
    print(f"var WA_POOL_N={n};")
    print(f"var WA_RANK_G={json.dumps(rank)};")


if __name__ == "__main__":
    main()
