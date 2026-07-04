#!/usr/bin/env python3
"""Measure home-court advantage from our own 20-year game history,
CONTROLLED FOR OPPONENT STRENGTH.

For every completed non-neutral game where both teams have a same-season SRS:
    residual = (home_score - away_score) - (SRS_home - SRS_away)

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
LO, HI = -20, 25          # opponent-SRS clamp for the baseline buckets
CAP_MIN = -10             # pricing-time opponent clamp (see header)

def bucket(s):
    return max(LO, min(HI - BUCKET, int(s // BUCKET) * BUCKET))

def main(write=False):
    srs = {}
    for line in open(DATA / "team_seasons.jsonl"):
        r = json.loads(line)
        if r.get("srs") is not None:
            srs[(r["team"], r.get("season_year") or r.get("season"))] = float(r["srs"])

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

    if write:
        curve = [[b + BUCKET / 2, round(m + era_shift, 2)] for b, m in base.items()]
        out = {"global": round(typical, 2), "base": curve, "capMin": CAP_MIN,
               "k": round(K), "gameSd": round(g_var**.5, 1),
               "seasons": len(season_mean), "games": len(games), "teams": teams}
        (DATA / "team_hca.json").write_text(json.dumps(out))
        print(f"\nwrote {DATA/'team_hca.json'} ({len(teams)} venues)")

if __name__ == "__main__":
    import sys
    main(write="--write" in sys.argv)
