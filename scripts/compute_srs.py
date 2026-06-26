#!/usr/bin/env python3
"""
Compute SRS (Simple Rating System) for every team-season from games.jsonl and
attach it to team_seasons.jsonl. SRS = average scoring margin adjusted for
opponent strength (the standard KenPom/Sports-Reference team rating), so teams
that ran up margin on weak schedules are docked and power teams rise.

Solve iteratively:  srs[t] = mov[t] + mean(srs[opp]),  re-centered to mean 0.
Margin per game capped (±CAP) so blowouts don't dominate.

  python3 compute_srs.py            # compute + rewrite team_seasons.jsonl
"""
import json
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).parent / "data"
CAP = 22


def srs_for_season(games):
    teams = set()
    gp = defaultdict(int); mov_sum = defaultdict(float); opps = defaultdict(list)
    for g in games:
        h, a, hs, as_ = g["home_id"], g["away_id"], g["home_score"], g["away_score"]
        m = max(-CAP, min(CAP, hs - as_))
        teams.add(h); teams.add(a)
        gp[h] += 1; gp[a] += 1
        mov_sum[h] += m; mov_sum[a] += -m
        opps[h].append(a); opps[a].append(h)
    mov = {t: mov_sum[t]/gp[t] for t in teams}
    srs = dict(mov)
    for _ in range(100):
        new = {t: mov[t] + sum(srs[o] for o in opps[t])/len(opps[t]) for t in teams}
        mean = sum(new.values())/len(new)
        for t in new: new[t] -= mean
        diff = max(abs(new[t]-srs[t]) for t in teams)
        srs = new
        if diff < 0.001: break
    return {t: round(srs[t], 2) for t in teams}


def main():
    by_season = defaultdict(list)
    for l in (DATA/"games.jsonl").read_text().splitlines():
        try: g = json.loads(l)
        except Exception: continue
        if g.get("status") != "STATUS_FINAL": continue
        if g.get("home_score") is None or g.get("away_score") is None: continue
        if g.get("home_id") is None or g.get("away_id") is None: continue
        by_season[g["season"]].append(g)

    srs_all = {}
    for season in sorted(by_season):
        s = srs_for_season(by_season[season])
        for tid, v in s.items(): srs_all[(season, tid)] = v
        print(f"  {season}: {len(s)} teams rated", flush=True)

    rows = []
    for l in (DATA/"team_seasons.jsonl").read_text().splitlines():
        try: t = json.loads(l)
        except Exception: continue
        t["srs"] = srs_all.get((t["season"], t["team_id"]))
        rows.append(t)
    with open(DATA/"team_seasons.jsonl", "w") as f:
        for t in rows: f.write(json.dumps(t) + "\n")
    print(f"attached SRS to {len(rows)} team-seasons")

    top = sorted([t for t in rows if t["season"] == 2026 and t.get("srs") is not None],
                 key=lambda x: -x["srs"])[:14]
    print("\n2025-26 by SRS:")
    for t in top:
        print(f"  {t['srs']:+5.1f}  {t['team'][:24]:24s} {t['wins']}-{t['losses']}  margin {round(t['ppg']-t['oppg'],1):+.1f}")


if __name__ == "__main__":
    main()
