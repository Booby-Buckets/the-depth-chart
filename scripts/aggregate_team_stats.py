#!/usr/bin/env python3
"""
Aggregate complete team stats (rpg, apg, FG%, 3P%, FT%, steals, blocks, TO, off/def
reb) for every team-season directly from box_scores.jsonl — no extra scrape. Attach
to team_seasons.jsonl. Matches on (season, team displayName), which both files share.

  python3 aggregate_team_stats.py
"""
import json
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).parent / "data"
SUMS = ("reb", "ast", "stl", "blk", "tov", "oreb", "dreb",
        "fgm", "fga", "tpm", "tpa", "ftm", "fta")


def main():
    agg = defaultdict(lambda: {"games": set(), **{s: 0 for s in SUMS}})
    for line in (DATA / "box_scores.jsonl").read_text().splitlines():
        try:
            b = json.loads(line)
        except Exception:
            continue
        a = agg[(b["season"], b["team"])]
        a["games"].add(b["game_id"])
        for s in SUMS:
            a[s] += b.get(s) or 0

    stats = {}
    for key, a in agg.items():
        g = len(a["games"])
        if g < 5:
            continue
        pg = lambda x: round(a[x] / g, 1)
        pct = lambda m, at: round(100 * a[m] / a[at], 1) if a[at] else None
        stats[key] = {
            "rpg": pg("reb"), "apg": pg("ast"), "spg": pg("stl"), "bpg": pg("blk"),
            "topg": pg("tov"), "orpg": pg("oreb"), "drpg": pg("dreb"),
            "fg_pct": pct("fgm", "fga"), "tp_pct": pct("tpm", "tpa"), "ft_pct": pct("ftm", "fta"),
        }

    rows, matched = [], 0
    for line in (DATA / "team_seasons.jsonl").read_text().splitlines():
        try:
            t = json.loads(line)
        except Exception:
            continue
        s = stats.get((t["season"], t["team"]))
        if s:
            t.update(s); matched += 1
        rows.append(t)
    with open(DATA / "team_seasons.jsonl", "w") as f:
        for t in rows:
            f.write(json.dumps(t) + "\n")
    print(f"attached team stats to {matched}/{len(rows)} team-seasons")

    samp = next((t for t in rows if t["season"] == 2026 and "Houston" in t["team"]), None)
    if samp:
        print("Houston 2025-26:", {k: samp.get(k) for k in
              ("ppg","oppg","rpg","apg","spg","bpg","topg","fg_pct","tp_pct","ft_pct")})


if __name__ == "__main__":
    main()
