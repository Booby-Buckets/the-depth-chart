#!/usr/bin/env python3
"""Measure home-court advantage from our own 20-year game history,
CONTROLLED FOR OPPONENT STRENGTH.

For every completed non-neutral game where both teams have a same-season SRS:
    residual = (home_score - away_score) - (SRS_home - SRS_away)   [SRS centered per season on D-I]

The naive mean residual is NOT pure venue: it varies hugely with opponent
quality (vs SRS>=0 visitors it's a flat ~3.2; vs -15 SRS visitors it's ~+16 —
road blowouts snowball). A venue hosting many weak visitors pockets that as
fake home magic. So:

  1. BASELINE b(opp_srs): mean residual by opponent-SRS bucket (5-pt buckets,
     clamped to [-20, 25]) — what ANY venue gets vs that quality of visitor.
  2. VENUE OFFSET: mean(residual - b(opp_srs) - era_adj) per venue, shrunk
     toward 0 by K games (method-of-moments between-venue variance).
  3. LIVE PRICING (tdc-ratings.js): hc = interp(base, opp_rating) + offset,
     with the opponent input clamped to >= -10 so garbage-time extremes at
     the very bottom never leak into a real line.

Writes scripts/data/team_hca.json:
    {"global": <typical-vs-decent-opp edge>, "base": [[srs, edge], ...],
     "capMin": -10, "k": ..., "teams": {"Gonzaga Bulldogs": +2.1, ...}}
teams values are OFFSETS vs the baseline, not absolute HCA.
"""
import json, statistics
from pathlib import Path
from collections import defaultdict

DATA = Path(__file__).parent / "data"
BUCKET = 5
# Opponent strength is CENTERED per season on the D-I average (teams with 20+ games): raw SRS here is
# fit with non-D-I opponents in the pool, so the average D-I team sits at +7..+12 depending on the
# season. Centering puts the curve on the same scale as our power ratings (D-I mean 0) — reading
# raw-SRS buckets with a rating made a bottom-30 D-I visitor look like a D-II team (+11 pts home edge).
LO, HI = -30, 25          # opponent clamp for the baseline buckets (centered scale)
CAP_MIN = -20             # pricing-time opponent clamp (centered; ~ the old raw -10)

def bucket(s):
    return max(LO, min(HI - BUCKET, int(s // BUCKET) * BUCKET))

TYPE_YRS = 5              # seasons the conference / non-conference split is measured over

def type_split(d1_mean, srs_c, ngames, base_fn, offs):
    """Home edge by GAME TYPE, D-I v D-I only (both teams 20+ games), last TYPE_YRS seasons.
    Non-conference home games beat the curve by ~1 pt more than league games (buy games, travel, early-season
    rust; the gap grew from ~0.2 pre-2016 to ~1.0 in 2022-26). The curve averages both, so it under-prices
    November home teams and over-prices league hosts. Returns {"non": +x, "conf": -y}, centred so the
    games-weighted average adjustment is 0 (the curve's season-long level is unchanged)."""
    res = {"conf": [], "non": []}
    last = max(d1_mean)
    for line in open(DATA / "games.jsonl"):
        g = json.loads(line)
        if g.get("neutral") or g.get("status") != "STATUS_FINAL" or g.get("home_score") is None:
            continue
        yr = g.get("season_year") or g.get("season")
        if yr is None or yr <= last - TYPE_YRS: continue
        if ngames[(g["home"], yr)] < 20 or ngames[(g["away"], yr)] < 20: continue
        sh, sa = srs_c.get((g["home"], yr)), srs_c.get((g["away"], yr))
        if sh is None or sa is None: continue
        r = (g["home_score"] - g["away_score"]) - (sh - sa) - base_fn(sa) - offs.get(g["home"], 0)
        res["conf" if g.get("conf_game") else "non"].append(r)
    mc, mn = statistics.mean(res["conf"]), statistics.mean(res["non"])
    nc, nn = len(res["conf"]), len(res["non"])
    mid = (mc * nc + mn * nn) / (nc + nn)
    print(f"\ngame type ({TYPE_YRS} seasons, D-I v D-I): conf {mc:+.2f} ({nc:,})  non-conf {mn:+.2f} ({nn:,})  gap {mn-mc:+.2f}")
    return {"non": round(mn - mid, 2), "conf": round(mc - mid, 2)}

def main(write=False):
    srs = {}
    for line in open(DATA / "team_seasons.jsonl"):
        r = json.loads(line)
        if r.get("srs") is not None:
            srs[(r["team"], r.get("season_year") or r.get("season"))] = float(r["srs"])
    # D-I average per season = mean SRS of teams with 20+ games in our history
    ngames = defaultdict(int)
    for line in open(DATA / "games.jsonl"):
        g = json.loads(line); yr = g.get("season_year") or g.get("season")
        ngames[(g.get("home"), yr)] += 1; ngames[(g.get("away"), yr)] += 1
    d1 = defaultdict(list)
    for (t, yr), v in srs.items():
        if ngames[(t, yr)] >= 20: d1[yr].append(v)
    d1_mean = {yr: statistics.mean(v) for yr, v in d1.items()}
    srs = {k: v - d1_mean.get(k[1], 0.0) for k, v in srs.items()}

    games = []                       # (yr, venue, opp_srs, residual)
    for line in open(DATA / "games.jsonl"):
        g = json.loads(line)
        if g.get("neutral") or g.get("status") != "STATUS_FINAL":
            continue
        yr = g.get("season_year") or g.get("season")
        sh = srs.get((g.get("home"), yr))
        sa = srs.get((g.get("away"), yr))
        if sh is None or sa is None or g.get("home_score") is None:
            continue
        games.append((yr, g["home"], sa, (g["home_score"] - g["away_score"]) - (sh - sa)))

    all_resid = [r for *_, r in games]
    g_mean = statistics.mean(all_resid)
    g_var = statistics.pvariance(all_resid)
    season_mean = {}
    for yr in sorted({g[0] for g in games}):
        season_mean[yr] = statistics.mean(r for y, _, _, r in games if y == yr)
    recent = statistics.mean(season_mean[yr] for yr in sorted(season_mean)[-5:])
    era_shift = recent - g_mean      # how much hotter recent seasons run
    print(f"{len(games):,} home games, {len(season_mean)} seasons | naive global {g_mean:+.2f}, recent {recent:+.2f}")

    # 1. opponent-strength baseline
    by_bucket = defaultdict(list)
    for _, _, sa, r in games:
        by_bucket[bucket(sa)].append(r)
    base = {b: statistics.mean(rs) for b, rs in sorted(by_bucket.items())}
    print("\nbaseline home edge by opponent SRS (era-shifted to recent):")
    for b, m in base.items():
        print(f"  {b:>4}..{b+BUCKET:<4}: {m+era_shift:+5.2f}  ({len(by_bucket[b]):,} games)")

    # 2. venue offsets vs the baseline (season-adjusted)
    offs = defaultdict(list)
    for yr, v, sa, r in games:
        offs[v].append(r - base[bucket(sa)] - (season_mean[yr] - g_mean))
    means = [(v, statistics.mean(o), len(o)) for v, o in offs.items() if len(o) >= 30]
    noise = statistics.mean(g_var / n for _, _, n in means)
    raw_var = statistics.pvariance([m for _, m, _ in means])
    venue_var = max(raw_var - noise, 0.25)
    K = g_var / venue_var
    print(f"\nvenues 30+ games: {len(means)} | raw offset sd {raw_var**.5:.2f} | true venue sd ~{venue_var**.5:.2f} -> K={K:.0f}")

    teams = {v: round((len(o) * statistics.mean(o)) / (len(o) + K), 2) for v, o in offs.items()}

    typical = statistics.mean(base[b] for b in base if b >= 0) + era_shift
    top = sorted(teams.items(), key=lambda x: -x[1])
    print(f"\ntypical edge vs a decent (SRS>=0) visitor: {typical:+.2f}")
    print("strongest venue OFFSETS (added to the baseline):")
    for v, h in top[:20]:
        print(f"  {h:+5.2f}  {v}  ({len(offs[v])} games)")
    print("weakest:")
    for v, h in top[-6:]:
        print(f"  {h:+5.2f}  {v}  ({len(offs[v])} games)")

    curve_c = [[b + BUCKET / 2, m + era_shift] for b, m in base.items()]
    def base_fn(o):
        x = max(CAP_MIN, min(curve_c[-1][0], o))
        if x <= curve_c[0][0]: return curve_c[0][1]
        for (x0, y0), (x1, y1) in zip(curve_c, curve_c[1:]):
            if x <= x1: return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
        return curve_c[-1][1]
    type_adj = type_split(d1_mean, srs, ngames, base_fn, teams)
    print(f"game-type adjustment: {type_adj}")

    if write:
        curve = [[b + BUCKET / 2, round(m + era_shift, 2)] for b, m in base.items()]
        last = max(d1_mean)
        out = {"global": round(typical, 2), "base": curve, "capMin": CAP_MIN, "centered": True,
               "d1Mean": round(d1_mean[last], 2), "d1MeanSeason": last,
               "k": round(K), "gameSd": round(g_var**.5, 1),
               "seasons": len(season_mean), "games": len(games), "typeAdj": type_adj, "typeYrs": TYPE_YRS,
               "teams": teams}
        (DATA / "team_hca.json").write_text(json.dumps(out))
        print(f"\nwrote {DATA/'team_hca.json'} ({len(teams)} venues)")

if __name__ == "__main__":
    import sys
    main(write="--write" in sys.argv)
