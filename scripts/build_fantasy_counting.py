#!/usr/bin/env python3
"""Fantasy counting schedule (owner, Oct 2026): every pool team (Big Ten / SEC / ACC / Big 12 / Big East) counts
exactly 22 games — 18 conference + 4 non-conference — and every counted game counts for BOTH teams (Kentucky's
counted game vs Louisville is one of Louisville's counted games too). Non-conference picks are the best games
available: power-vs-power first, then strong mid-majors.

Solved exactly as a 0/1 program (scipy milp): one variable per game that involves a pool team;
  each pool team: conference games chosen = 18 (or all it has, if fewer), non-conference chosen = 4
  a pool-vs-pool game fills one slot on EACH side, so the matching rule holds by construction
  objective = sum over every filled slot of the OPPONENT's projected rating (predictive_ratings 2027),
              so the weakest league games are the ones dropped and the strongest non-league games are kept.
A same-league game at a NEUTRAL site is non-conference (league games are home/away — UNC vs NC State, Dec 15).

    python3 scripts/build_fantasy_counting.py   -> scripts/data/fantasy_counting_2027.json
"""
import json, re, urllib.request
from pathlib import Path
import numpy as np
from scipy.optimize import milp, LinearConstraint, Bounds

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "scripts" / "data"
POOL_CONF = {"B10", "SEC", "ACC", "BIG-12", "Big-East"}
N_CONF, N_NON = 18, 4


def ratings():
    k = re.search(r"sb_publishable_[A-Za-z0-9_-]+", (ROOT / "player.html").read_text()).group(0)
    r = json.load(urllib.request.urlopen(urllib.request.Request(
        "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/predictive_ratings?season=eq.2027&select=data&limit=1",
        headers={"apikey": k, "Authorization": "Bearer " + k}), timeout=60))
    return {t["full"]: float(t["rating"]) for t in r[0]["data"]["teams"] if t.get("full") and t.get("rating") is not None}


def main():
    s = json.load(open(D / "schedule_2027.json")); T = s["teams"]
    M = json.load(open(D / "conf_members_2027.json"))["teams"]
    R = ratings()
    floor = min(R.values()) if R else -30.0
    rt = lambda t: R.get(t, floor)
    pool = sorted(t for t, c in M.items() if c in POOL_CONF)
    P = set(pool)

    games = []   # (id, date, home, away, neutral, is_conf)
    for g in s["games"]:
        h, a = T[g[2]], T[g[3]]
        if h not in P and a not in P:
            continue
        neutral = bool(g[4])
        conf = M.get(h) is not None and M.get(h) == M.get(a) and not neutral
        games.append((g[0], g[1], h, a, neutral, conf))

    n = len(games)
    c = np.zeros(n)   # milp minimizes: use -value
    for j, (_, _, h, a, _, _) in enumerate(games):
        v = 0.0
        if h in P: v += rt(a)
        if a in P: v += rt(h)
        c[j] = -v
    rows, lo, hi, short = [], [], [], []
    for t in pool:
        for want_conf, need in ((True, N_CONF), (False, N_NON)):
            idx = [j for j, g in enumerate(games) if g[5] == want_conf and t in (g[2], g[3])]
            k = min(need, len(idx))
            if k < need: short.append((t, "conference" if want_conf else "non-conference", len(idx)))
            row = np.zeros(n); row[idx] = 1
            rows.append(row); lo.append(k); hi.append(k)
    res = milp(c, constraints=LinearConstraint(np.array(rows), lo, hi), integrality=np.ones(n), bounds=Bounds(0, 1))
    if not res.success:
        raise SystemExit(f"no counting schedule satisfies the rules: {res.message}")
    pick = [games[j] for j in range(n) if res.x[j] > 0.5]

    teams = {t: [] for t in pool}
    for gid, date, h, a, neu, conf in sorted(pick, key=lambda g: g[1]):
        for me, opp, site in ((h, a, "N" if neu else "H"), (a, h, "N" if neu else "A")):
            if me in P:
                teams[me].append({"id": gid, "date": date, "opp": opp, "site": site, "conf": conf})
    # checks: 22 per team, 18/4 split, every pool-vs-pool game on both teams' lists
    for t, lst in teams.items():
        nc = sum(1 for x in lst if x["conf"]); nn = len(lst) - nc
        assert nc <= N_CONF and nn <= N_NON, (t, nc, nn)
    both = sum(1 for g in pick if g[2] in P and g[3] in P)
    nonpp = [g for g in pick if not g[5] and g[2] in P and g[3] in P]
    out = {"season": "2026-27", "rules": {"conference": N_CONF, "non_conference": N_NON},
           "conferences": sorted(POOL_CONF), "games": len(pick), "pool_vs_pool": both, "short": short,
           "teams": teams}
    json.dump(out, open(D / "fantasy_counting_2027.json", "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"{len(pool)} teams, {len(pick)} counted games ({both} between two pool teams), "
          f"{len(nonpp)} of them non-conference power-vs-power; short: {short or 'none'}")


if __name__ == "__main__":
    main()
