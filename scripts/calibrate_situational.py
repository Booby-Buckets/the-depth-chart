#!/usr/bin/env python3
"""Measure the SITUATIONAL factors around a game from our own 20-year history —
rest days, road trips, win streaks / recent form — controlled for team strength
and venue, so the schedule projection can price them honestly instead of by feel.

For every completed game where both teams have a same-season SRS:
    expected = SRS_home - SRS_away + home edge          (venue curve + venue offset,
                                                          scripts/calibrate_hca.py; 0 at neutral)
    residual = actual margin - expected                  (home perspective)

Each team's season is walked in date order to tag what it carried INTO the game:
    rest     days since its previous game (opener = 'fresh')
    stint    consecutive games away from home, counting this one (home = 0)
    streak   signed W/L streak entering (+3 = won three straight)
    form     mean residual over its last 5 games (how it's playing vs its rating)

Then one OLS fit of residual on SYMMETRIC feature differences f(home) - f(away),
so every effect is "what this situation is worth to whichever team is in it":
    rest buckets   b2b(1 day) · 2 · 3-4 · 5-7 · 8+ / opener        (ref: 3-4)
    stint buckets  2nd · 3rd · 4th+ straight road game               (ref: home / 1st)
    streak buckets <= -5 · -4..-2 · +2..+4 · >= +5                    (ref: -1..+1)
    form           per point of last-5 residual (continuous)

Writes scripts/data/situational_model.json for tdc-schedule.js:
    {"n":…, "sd":…, "rest":{…}, "stint":{…}, "streak":{…}, "form":…, "se":{…}, "notes":[…]}
"""
import json
from collections import defaultdict
from datetime import date
from pathlib import Path
import numpy as np

DATA = Path(__file__).parent / "data"
FIRST_SEASON = 2008

REST_B = ["b2b", "r2", "r34", "r57", "r8", "opener"]      # ref r34
STINT_B = ["s2", "s3", "s4"]                              # ref home/1st
STREAK_B = ["l5", "l24", "w24", "w5"]                     # ref -1..+1
COLS = [b for b in REST_B if b != "r34"] + STINT_B + STREAK_B + ["form"]   # r34 is the reference


def rest_bucket(days):
    if days is None: return "opener"
    if days <= 1: return "b2b"
    if days == 2: return "r2"
    if days <= 4: return "r34"
    if days <= 7: return "r57"
    return "r8"


def stint_bucket(s):
    if s >= 4: return "s4"
    if s == 3: return "s3"
    if s == 2: return "s2"
    return None


def streak_bucket(s):
    if s <= -5: return "l5"
    if s <= -2: return "l24"
    if s >= 5: return "w5"
    if s >= 2: return "w24"
    return None


def feat(rest, stint, streak, form):
    v = {c: 0.0 for c in COLS}
    b = rest_bucket(rest)
    if b != "r34": v[b] = 1.0
    b = stint_bucket(stint)
    if b: v[b] = 1.0
    b = streak_bucket(streak)
    if b: v[b] = 1.0
    v["form"] = form
    return v


def main():
    srs = {}
    for line in open(DATA / "team_seasons.jsonl"):
        r = json.loads(line)
        if r.get("srs") is not None:
            srs[(r["team"], r.get("season_year") or r.get("season"))] = float(r["srs"])
    hca = json.load(open(DATA / "team_hca.json"))
    base = hca["base"]; cap_min = hca.get("capMin", -10); off = hca.get("teams", {})

    def base_edge(opp):
        x = max(cap_min, min(base[-1][0], opp))
        if x <= base[0][0]: return base[0][1]
        for i in range(1, len(base)):
            if x <= base[i][0]:
                (x0, y0), (x1, y1) = base[i-1], base[i]
                return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
        return base[-1][1]

    games = []
    for line in open(DATA / "games.jsonl"):
        g = json.loads(line)
        yr = g.get("season") or g.get("season_year")
        if yr < FIRST_SEASON or g.get("status") != "STATUS_FINAL" or g.get("home_score") is None:
            continue
        sh, sa = srs.get((g["home"], yr)), srs.get((g["away"], yr))
        if sh is None or sa is None:
            continue
        hc = 0.0 if g.get("neutral") else base_edge(sa) + off.get(g["home"], 0.0)
        exp = sh - sa + hc
        games.append({"yr": yr, "date": g["date"], "home": g["home"], "away": g["away"], "neutral": bool(g.get("neutral")),
                      "margin": g["home_score"] - g["away_score"], "exp": exp, "res": g["home_score"] - g["away_score"] - exp})
    games.sort(key=lambda g: (g["date"], g["home"]))
    print(f"{len(games)} rated games {FIRST_SEASON}-{max(g['yr'] for g in games)}")

    # walk each team-season to tag what it carried into every game
    state = {}   # (team, yr) -> dict
    for g in games:
        d = date.fromisoformat(g["date"])
        for side, is_home in (("home", True), ("away", False)):
            t = g[side]; k = (t, g["yr"])
            st = state.setdefault(k, {"last": None, "stint": 0, "streak": 0, "res": []})
            rest = (d - st["last"]).days if st["last"] else None
            stint = 0 if (is_home and not g["neutral"]) else st["stint"] + 1
            form = float(np.mean(st["res"][-5:])) if st["res"] else 0.0
            g[side + "_f"] = feat(rest, stint, st["streak"], form)
            g[side + "_raw"] = (rest, stint, st["streak"])
            # update after the game
            r_me = g["res"] if is_home else -g["res"]
            won = (g["margin"] > 0) == is_home
            st["last"] = d; st["stint"] = stint
            st["streak"] = (st["streak"] + 1 if st["streak"] > 0 else 1) if won else (st["streak"] - 1 if st["streak"] < 0 else -1)
            st["res"].append(r_me)

    X = np.array([[g["home_f"][c] - g["away_f"][c] for c in COLS] + [1.0] for g in games])
    y = np.array([g["res"] for g in games])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    n, p = X.shape
    sigma2 = float(resid @ resid) / (n - p)
    cov = sigma2 * np.linalg.inv(X.T @ X)
    se = np.sqrt(np.diag(cov))
    sd = float(np.std(y))
    print(f"residual sd {sd:.2f} → {np.sqrt(sigma2):.2f} after situational terms (n={n})")
    print(f"{'term':8s} {'pts':>7s} {'se':>6s} {'t':>6s}   n(home side)")
    counts = {c: sum(1 for g in games if g["home_f"][c] == 1.0) for c in COLS if c != "form"}
    counts["form"] = n
    for c, b, s in zip(COLS + ["const"], beta, se):
        print(f"{c:8s} {b:7.2f} {s:6.2f} {b/s:6.1f}   {counts.get(c, '')}")

    # plain-English notes for the page + the user
    B = dict(zip(COLS + ["const"], [float(x) for x in beta]))
    SE = dict(zip(COLS + ["const"], [float(x) for x in se]))
    notes = []
    notes.append(f"Back-to-back (1 day rest) is worth {B['b2b']:+.1f} pts vs 3-4 days; 2 days {B['r2']:+.1f}; 5-7 days {B['r57']:+.1f}; 8+ days {B['r8']:+.1f} (se ≈ {SE['r8']:.1f}).")
    notes.append(f"Road trips: 2nd straight road game {B['s2']:+.1f}, 3rd {B['s3']:+.1f}, 4th+ {B['s4']:+.1f} pts on top of the venue edge (se ≈ {SE['s3']:.1f}).")
    notes.append(f"Streaks beyond what the rating explains: won 2-4 straight {B['w24']:+.1f}, 5+ {B['w5']:+.1f}; lost 2-4 straight {B['l24']:+.1f}, 5+ {B['l5']:+.1f} (se ≈ {SE['w5']:.1f}).")
    notes.append(f"Form: each point of last-5 over/under-performance carries {B['form']:+.2f} pts into the next game (se {SE['form']:.2f}).")
    out = {"n": n, "sd": round(float(np.sqrt(sigma2)), 2), "firstSeason": FIRST_SEASON,
           "rest": {k: round(B.get(k, 0.0), 2) for k in REST_B}, "stint": {k: round(B[k], 2) for k in STINT_B},
           "streak": {k: round(B[k], 2) for k in STREAK_B}, "form": round(B["form"], 3),
           "se": {k: round(SE[k], 2) for k in COLS}, "notes": notes}
    json.dump(out, open(DATA / "situational_model.json", "w"), indent=1)
    print("\n".join(notes))
    print(f"→ {DATA / 'situational_model.json'}")


if __name__ == "__main__":
    main()
