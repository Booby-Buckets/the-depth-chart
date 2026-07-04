#!/usr/bin/env python3
"""Measure home-court advantage from our own 20-year game history.

For every completed non-neutral game where both teams have a same-season SRS:
    residual = (home_score - away_score) - (SRS_home - SRS_away)
The mean residual IS home-court advantage: how much the home team beats the
strength gap by. Computed globally, per season (to see the trend), and per
venue with empirical-Bayes shrinkage toward the global mean (a venue only
earns its own number as its sample grows: hca = (n*venue_mean + K*global)/(n+K),
K = game_variance / between-venue variance, method of moments).

Writes scripts/data/team_hca.json:
    {"global": 3.1, "k": ..., "teams": {"New Mexico Lobos": 4.6, ...}}
which tdc-ratings.js serves per-host in game lines.
"""
import json, statistics
from pathlib import Path
from collections import defaultdict

DATA = Path(__file__).parent / "data"

def main(write=False):
    srs = {}
    for line in open(DATA / "team_seasons.jsonl"):
        r = json.loads(line)
        if r.get("srs") is not None:
            srs[(r["team"], r.get("season_year") or r.get("season"))] = float(r["srs"])

    by_season = defaultdict(list)
    by_venue = defaultdict(list)      # (yr, resid) per venue
    for line in open(DATA / "games.jsonl"):
        g = json.loads(line)
        if g.get("neutral") or g.get("status") != "STATUS_FINAL":
            continue
        yr = g.get("season_year") or g.get("season")
        h, a = g.get("home"), g.get("away")
        hs, as_ = g.get("home_score"), g.get("away_score")
        if None in (yr, h, a, hs, as_):
            continue
        sh, sa = srs.get((h, yr)), srs.get((a, yr))
        if sh is None or sa is None:
            continue          # non-D1 opponent or missing season
        resid = (hs - as_) - (sh - sa)
        by_season[yr].append(resid)
        by_venue[h].append((yr, resid))

    all_resid = [r for rs in by_season.values() for r in rs]
    g_mean = statistics.mean(all_resid)
    g_var = statistics.pvariance(all_resid)
    print(f"{len(all_resid):,} home games across {len(by_season)} seasons")
    print(f"GLOBAL home-court advantage: {g_mean:+.2f} pts (game sd {g_var**.5:.1f})")
    season_mean = {}
    print("\nby season:")
    for yr in sorted(by_season):
        rs = by_season[yr]
        season_mean[yr] = statistics.mean(rs)
        print(f"  {yr-1}-{str(yr)[2:]}: {season_mean[yr]:+5.2f}  ({len(rs):,} games)")
    # HCA drifts by era — anchor the live number to the recent league level, and
    # grade each venue as an OFFSET vs its own season's average (era-neutral)
    recent = statistics.mean(season_mean[yr] for yr in sorted(season_mean)[-5:])
    print(f"\nrecent (last 5 seasons) global: {recent:+.2f} — used as the live anchor")

    # between-venue variance (method of moments): var of venue offset-means minus
    # the sampling noise each mean carries -> how much venues TRULY differ
    offs = {v: [r - season_mean[yr] for yr, r in rs] for v, rs in by_venue.items()}
    means = [(v, statistics.mean(o), len(o)) for v, o in offs.items() if len(o) >= 30]
    noise = statistics.mean(g_var / n for _, _, n in means)
    raw_var = statistics.pvariance([m for _, m, _ in means])
    venue_var = max(raw_var - noise, 0.25)
    K = g_var / venue_var
    print(f"venues with 30+ games: {len(means)} | raw sd of venue offsets {raw_var**.5:.2f}")
    print(f"true between-venue sd ~{venue_var**.5:.2f} pts  ->  shrinkage K={K:.0f} games")

    # live HCA = recent league anchor + shrunk era-neutral venue offset
    teams = {}
    for v, o in offs.items():
        n = len(o)
        teams[v] = round(recent + (n * statistics.mean(o)) / (n + K), 2)

    top = sorted(teams.items(), key=lambda x: -x[1])
    print("\nstrongest home courts:")
    for v, h in top[:12]:
        print(f"  {h:+5.2f}  {v}  ({len(by_venue[v])} games)")
    print("weakest:")
    for v, h in top[-8:]:
        print(f"  {h:+5.2f}  {v}  ({len(by_venue[v])} games)")

    if write:
        out = {"global": round(recent, 2), "allTime": round(g_mean, 2), "k": round(K),
               "gameSd": round(g_var**.5, 1), "seasons": len(by_season),
               "games": len(all_resid), "teams": teams}
        (DATA / "team_hca.json").write_text(json.dumps(out))
        print(f"\nwrote {DATA/'team_hca.json'} ({len(teams)} venues)")

if __name__ == "__main__":
    import sys
    main(write="--write" in sys.argv)
