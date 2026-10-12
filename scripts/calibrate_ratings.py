#!/usr/bin/env python3
"""Calibrate roster-BPM → SRS so projected team ratings live on the spread scale.

For 2024-25 and 2025-26: each team's minutes-weighted mean BPM (bbref advanced)
is regressed against its actual SRS (team_seasons). The fitted a + b·x becomes
the scale for PROJECTED rosters in tdc-ratings.js. Read-only; prints constants.
"""
import json, os, re, sys, urllib.request, urllib.parse, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from school_xwalk import prefix_pick
from build_coach_profiles import ALIAS
ALIAS = dict(ALIAS, **{"Mississippi": "Ole Miss Rebels", "Hawaii": "Hawai'i Rainbow Warriors"})
_base = lambda s: re.sub(r"\s*\([^)]+\)", "", s).strip()

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def fetch_all(path, page=1000):
    out, off = [], 0
    while True:
        r = urllib.request.Request(f"{SB}{path}", headers={**H, "Range-Unit": "items", "Range": f"{off}-{off+page-1}"})
        with urllib.request.urlopen(r, timeout=60) as resp:
            batch = json.load(resp)
        out += batch
        if len(batch) < page: break
        off += page
    return out

def team_match(school, ts_names, schools=()):
    """bbref school ('Duke', 'Miami (FL)', "St. John's (NY)") → team_seasons full name. Known divergent names via the
    coach-profile ALIAS table; otherwise a prefix match where the LONGEST school wins (school_xwalk.py), so "Alabama"
    can't land on "Alabama A&M Bulldogs" just because it's the same length as "Alabama Crimson Tide"."""
    if school in ALIAS and ALIAS[school] in ts_names: return ALIAS[school]
    par = re.search(r"\(([^)]+)\)", school)
    base = _base(school)
    if par:
        withpar = [t for t in ts_names if t.startswith(base + " ") and f"({par.group(1)})" in t]
        if withpar: return withpar[0]
    return prefix_pick(base, [t for t in ts_names if "(" not in t] or list(ts_names), [_base(s) for s in schools])

def fit(xs, ys):
    n = len(xs); mx = sum(xs)/n; my = sum(ys)/n
    sxx = sum((x-mx)**2 for x in xs); sxy = sum((x-mx)*(y-my) for x, y in zip(xs, ys))
    syy = sum((y-my)**2 for y in ys)
    b = sxy/sxx; a = my-b*mx; r = sxy/(sxx*syy)**0.5
    resid = [y-(a+b*x) for x, y in zip(xs, ys)]
    rmse = (sum(e*e for e in resid)/n)**0.5
    return a, b, r, rmse, n

for season in (2025, 2026):
    bb = fetch_all(f"/rest/v1/bbref_seasons?season_year=eq.{season}&select=school,advanced&order=bbref_id.asc")
    ts = fetch_all(f"/rest/v1/team_seasons?season_year=eq.{season}&select=team,srs&limit=1000")
    srs = {t["team"]: float(t["srs"]) for t in ts if t.get("srs") is not None}
    names = list(srs.keys())
    agg = collections.defaultdict(lambda: [0.0, 0.0])  # school -> [Σbpm*mp, Σmp]
    for r in bb:
        a = r.get("advanced") or {}
        try: bpm, mp = float(a["bpm"]), float(a["mp"])
        except (KeyError, TypeError, ValueError): continue
        if mp < 50: continue
        agg[r["school"]][0] += bpm*mp; agg[r["school"]][1] += mp
    xs, ys = [], []
    match_cache = {}
    for school, (s, m) in agg.items():
        if m < 3000: continue                        # need a real season of minutes
        if school not in match_cache: match_cache[school] = team_match(school, names, agg.keys())
        t = match_cache[school]
        if not t or t not in srs: continue
        xs.append(s/m)                               # minutes-weighted mean BPM
        ys.append(srs[t])
    a, b, r, rmse, n = fit(xs, ys)
    print(f"{season}: SRS = {a:+.3f} + {b:.3f} × mwBPM   (r={r:.3f}, rmse={rmse:.2f}, n={n})")
