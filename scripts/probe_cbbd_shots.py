#!/usr/bin/env python3
"""Probe collegebasketballdata.com for shot LOCATIONS (x/y) by season.

CBBD's play feed carries shotInfo.location {x,y} (nullable). This checks, per
season, what share of shooting plays actually have coordinates -- i.e. whether
we can backfill real shot charts from here instead of zone-level text.

Usage:  CBBD_KEY=... python3 scripts/probe_cbbd_shots.py [--team Duke] [--seasons 2015 2019 2023 2024 2025]
Get a free key at https://collegebasketballdata.com/key (never commit it).
"""
import argparse, json, os, sys, urllib.request, urllib.parse, collections

API = "https://api.collegebasketballdata.com"

def get(path, key, **params):
    url = API + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + key, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--team", default="Duke")
    ap.add_argument("--seasons", nargs="*", type=int, default=[2014, 2017, 2019, 2021, 2023, 2024, 2025, 2026])
    a = ap.parse_args()
    key = os.environ.get("CBBD_KEY") or input("CBBD API key: ").strip()
    if not key:
        sys.exit("no key")
    print(f"{'season':>6} {'shots':>7} {'with x/y':>9} {'cov':>6}  ranges")
    for s in a.seasons:
        try:
            plays = get("/plays/team", key, season=s, team=a.team, shootingPlaysOnly="true")
        except Exception as e:
            print(f"{s:>6}  error: {e}")
            continue
        shots = [p for p in plays if p.get("shotInfo")]
        loc = [p for p in shots if (p["shotInfo"].get("location") or {}).get("x") is not None]
        rng = collections.Counter(p["shotInfo"].get("range") for p in shots)
        cov = len(loc) / len(shots) if shots else 0
        print(f"{s:>6} {len(shots):>7} {len(loc):>9} {cov:>6.0%}  {dict(rng)}")
        if loc:
            ex = loc[0]["shotInfo"]
            print(f"        sample: {ex['shooter']['name']} {ex['range']} made={ex['made']} xy={ex['location']}")

if __name__ == "__main__":
    main()
