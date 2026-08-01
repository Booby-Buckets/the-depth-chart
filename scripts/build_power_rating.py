#!/usr/bin/env python3
"""build_power_rating.py — our OWN team Power Rating, computed from game results.

WHY
  team_seasons.srs is Sports-Reference's SRS (scraped). We replace it with an
  Simple Rating System we compute ourselves from the `games` table:
      rating_i = avg_home_adjusted_margin_i + avg(rating of opponents)
  solved iteratively and re-centered to a mean of 0 across Division I. This is a
  standard, public method run on data we own (final scores) — no SR value is read.
  Bonus: it fixes miscalibrations in the old column (e.g. a 4-28 team wrongly rated +4).

METHOD
  - D1 set = teams with a team_seasons row that season.
  - Count only D1-vs-D1 final games (drops exhibitions vs non-D1).
  - Home-court adjustment: subtract HCA from the home margin, add it to the away
    margin, none on neutral courts. HCA solved from the data (avg home margin / 2).
  - Margin cap keeps a 40-point blowout from dominating (garbage time isn't 2x signal).
  - Iterate rating = adj_MOV + avg(opp rating) to convergence, then center at 0.

OUTPUT
  data/owned_power_rating.json     {season_year: {team_id: rating}}
  data/power_rating_update.sql     UPDATE team_seasons SET srs=<owned> ...  (owner runs it)
  data/power_rating_review.csv     old srs vs owned, per team-season, for review
"""
import os, sys, csv, json, importlib.util
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
_CLI = sys.argv[1:]              # capture before neutralizing argv for ag import
sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location("ag", os.path.join(HERE, "archetype_grades.py"))
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
D = os.path.join(HERE, "data")

MARGIN_CAP = 28          # cap adjusted margin magnitude (blowout dampening)
MAX_ITERS = 1000
TOL = 1e-4


def season_ratings(season):
    ts = ag.get(f"team_seasons?season_year=eq.{season}", "team_id,team,srs")
    d1 = {r["team_id"]: r for r in ts if r.get("team_id") is not None}
    if not d1:
        return None, None
    games = ag.get(f"games?season_year=eq.{season}&status=eq.STATUS_FINAL", "home_id,away_id,home_score,away_score,neutral")
    gl = [g for g in games if g["home_id"] in d1 and g["away_id"] in d1
          and g.get("home_score") is not None and g.get("away_score") is not None]
    if len(gl) < 50:
        return None, None
    # home-court advantage from the data: avg home margin over non-neutral games / 2
    hm = [g["home_score"] - g["away_score"] for g in gl if not g.get("neutral")]
    hca = (sum(hm) / len(hm) / 2.0) if hm else 3.0
    # per-team adjusted margins + opponent lists
    margins = defaultdict(list)   # team_id -> [adjusted margin per game]
    opps = defaultdict(list)      # team_id -> [opp team_id per game]
    for g in gl:
        h, a = g["home_id"], g["away_id"]
        raw = g["home_score"] - g["away_score"]
        adj = 0 if g.get("neutral") else hca      # remove home edge
        mh = max(-MARGIN_CAP, min(MARGIN_CAP, raw - adj))
        ma = max(-MARGIN_CAP, min(MARGIN_CAP, -raw + adj))
        margins[h].append(mh); opps[h].append(a)
        margins[a].append(ma); opps[a].append(h)
    teams = [t for t in d1 if margins.get(t)]
    mov = {t: sum(margins[t]) / len(margins[t]) for t in teams}
    rating = dict(mov)
    for _ in range(MAX_ITERS):
        delta = 0.0
        new = {}
        for t in teams:
            sos = sum(rating.get(o, 0.0) for o in opps[t]) / len(opps[t])
            new[t] = mov[t] + sos
            delta = max(delta, abs(new[t] - rating[t]))
        rating = new
        if delta < TOL:
            break
    # center at 0 across D1
    mean = sum(rating.values()) / len(rating)
    rating = {t: rating[t] - mean for t in rating}
    return d1, rating


def main():
    args = [a for a in _CLI if not a.startswith("--")]
    seasons = [int(args[0])] if args else list(range(2010, 2027))
    out, review = {}, []
    for s in seasons:
        d1, rating = season_ratings(s)
        if not rating:
            print(f"[{s}] skipped (no games/teams)"); continue
        out[str(s)] = {str(t): round(r, 2) for t, r in rating.items()}
        vals = sorted(rating.values(), reverse=True)
        for t, r in rating.items():
            old = d1[t].get("srs")
            review.append([s, t, d1[t]["team"], old, round(r, 2),
                           (round(r - old, 1) if isinstance(old, (int, float)) else "")])
        # sanity print: top 3 + bottom 2
        by = sorted(rating.items(), key=lambda kv: -kv[1])
        top = ", ".join(f"{d1[t]['team'].split()[0]} {r:+.1f}" for t, r in by[:3])
        bot = ", ".join(f"{d1[t]['team'].split()[0]} {r:+.1f}" for t, r in by[-2:])
        print(f"[{s}] {len(rating)} teams | mean~0 spread [{vals[-1]:+.1f},{vals[0]:+.1f}] | top: {top} | bottom: {bot}")

    with open(os.path.join(D, "owned_power_rating.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    # UPDATE sql (owner runs — anon key is RLS-blocked on team_seasons). One bulk
    # UPDATE...FROM(VALUES) per season keeps each statement ~365 rows and fast.
    with open(os.path.join(D, "power_rating_update.sql"), "w") as f:
        f.write("-- Owned Power Rating (scripts/build_power_rating.py) replacing SR's SRS in team_seasons.\n")
        f.write("-- Computed from game results only. Review power_rating_review.csv first.\n")
        f.write("-- Run in the Supabase SQL editor (paste the whole file).\n\nBEGIN;\n")
        for s in out:
            vals = ",\n  ".join(f"({t},{s},{r})" for t, r in out[s].items())
            f.write(f"\nUPDATE team_seasons AS t SET srs = v.srs\nFROM (VALUES\n  {vals}\n) AS v(team_id, season_year, srs)\n"
                    f"WHERE t.team_id = v.team_id AND t.season_year = v.season_year;\n")
        f.write("\nCOMMIT;\n")
    with open(os.path.join(D, "power_rating_review.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["season", "team_id", "team", "old_srs", "owned_rating", "delta"])
        w.writerows(sorted(review, key=lambda r: (r[0], -(r[4] or 0))))
    print(f"\nwrote owned_power_rating.json ({sum(len(v) for v in out.values())} team-seasons), "
          f"power_rating_update.sql, power_rating_review.csv")


if __name__ == "__main__":
    main()
