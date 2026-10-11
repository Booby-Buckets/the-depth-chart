#!/usr/bin/env python3
"""build_shot_twins.py — the Shot Profile Twin pool (player page + compare page).

Every D-I player-season with 300+ minutes, described on eight dimensions, each RELATIVE to that season's D-I
average so seasons compare fairly (the game's pace, rules and shot mix change):

    FT  volume (attempts per 100 possessions on the floor) · FT%
    Rim volume · rim FG%      Mid volume · midrange FG%      3P volume · 3P%

Volume = attempts per 100 possessions his team had while he played (minutes share, from build_shot_aftermath.mjs
prof_<y>.json). League averages are possession-weighted; an efficiency needs 15+ attempts in that zone (else null —
the page needs six of the eight dimensions to match two player-seasons). The page standardises each dimension by
the season's spread (sd here) and ranks the closest player-seasons in every year.

    python3 scripts/build_shot_twins.py      -> scripts/data/shot_aftermath/twin_pool.json
"""
import json, os, glob, math, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(HERE, "data", "shot_aftermath")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"; KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
MIN_MIN, MIN_ATT = 300, 15
DIMS = ["ftV", "ftE", "rimV", "rimE", "midV", "midE", "tV", "tE"]


def get(q):
    out = []
    for off in range(0, 20000, 1000):
        r = json.load(urllib.request.urlopen(urllib.request.Request(SB + q + f"&limit=1000&offset={off}", headers=H), timeout=60))
        out += r
        if len(r) < 1000: return out
    return out


def main():
    seasons, rows = {}, []
    for f in sorted(glob.glob(os.path.join(D, "prof_*.json"))):
        P = json.load(open(f)); y = P["season"]
        names = {str(t["team_id"]): t["team"] for t in get(f"team_seasons?season_year=eq.{y}&select=team_id,team&order=team_id")}
        pl = P["players"]
        tot = [sum(r[i] for r in pl.values()) for i in range(10)]
        poss = tot[1] or 1
        avg = {"ftV": 100 * tot[2] / poss, "ftE": tot[3] / max(1, tot[2]), "rimV": 100 * tot[4] / poss, "rimE": tot[5] / max(1, tot[4]),
               "midV": 100 * tot[6] / poss, "midE": tot[7] / max(1, tot[6]), "tV": 100 * tot[8] / poss, "tE": tot[9] / max(1, tot[8])}
        cur = []
        for pid, r in pl.items():
            mn, ps, fta, ftm, ra, rm, ma, mm, ta, tm = r
            if mn < MIN_MIN or ps <= 0: continue
            k = 100.0 / ps
            v = {"ftV": fta * k, "ftE": ftm / fta if fta >= MIN_ATT else None, "rimV": ra * k, "rimE": rm / ra if ra >= MIN_ATT else None,
                 "midV": ma * k, "midE": mm / ma if ma >= MIN_ATT else None, "tV": ta * k, "tE": tm / ta if ta >= MIN_ATT else None}
            pts = ftm + 2 * (rm + mm) + 3 * tm; tsa = 2 * (ra + ma + ta + 0.44 * fta)
            cur.append((pid, r, v, pts * k, (pts / tsa) if tsa else None))
        # each dimension's spread across the season's qualifying players (possession-weighted)
        sd = {}
        for d in DIMS:
            xs = [(c[2][d], c[1][1]) for c in cur if c[2][d] is not None]
            w = sum(x[1] for x in xs) or 1
            m = sum(x[0] * x[1] for x in xs) / w
            sd[d] = math.sqrt(sum(x[1] * (x[0] - m) ** 2 for x in xs) / w) or 1e-6
        seasons[y] = {"avg": {d: round(avg[d], 4) for d in DIMS}, "sd": {d: round(sd[d], 4) for d in DIMS}, "n": len(cur)}
        for pid, r, v, p100, ts in cur:
            rel = [(round(v[d] - avg[d], 3 if d.endswith("E") else 2) if v[d] is not None else None) for d in DIMS]   # small file: 0.1% / 0.01 per 100 is plenty
            rows.append([pid, y, P["names"].get(pid), names.get(P["team"].get(pid), ""), P["pos"].get(pid, ""), int(r[0]), round(p100, 1),
                         round(ts, 3) if ts else None] + rel)
        print(f"{y}: {len(cur)} player-seasons, league FT {avg['ftV']:.1f}/100 {avg['ftE']:.3f} · rim {avg['rimV']:.1f} {avg['rimE']:.3f} · mid {avg['midV']:.1f} {avg['midE']:.3f} · 3P {avg['tV']:.1f} {avg['tE']:.3f}")
    out = {"built": __import__("datetime").datetime.utcnow().isoformat() + "Z", "min_minutes": MIN_MIN, "min_attempts": MIN_ATT, "dims": DIMS,
           "cols": ["espn_id", "season", "name", "team", "pos", "min", "pts100", "ts"] + DIMS, "seasons": seasons, "rows": rows}
    json.dump(out, open(os.path.join(D, "twin_pool.json"), "w"), separators=(",", ":"))
    print(f"twin pool: {len(rows)} player-seasons -> twin_pool.json ({os.path.getsize(os.path.join(D, 'twin_pool.json')) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
