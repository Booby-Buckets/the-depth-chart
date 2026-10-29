#!/usr/bin/env python3
"""build_game_ot.py — which games went to overtime, and how many: data/game_ot.json  {"<espn game id>": n_ot}.

Only overtime games are listed (regulation = absent). ESPN's scoreboard reports each game's final period:
2 halves = regulation, 3 = OT, 4 = 2OT… Re-reads the scoreboard for every date in scripts/data/games.jsonl
(2006-07 on). The nightly results feed (ingest_results_2027.py) adds new games itself, so this is a one-off
backfill — rerun it only if the history is rebuilt.

    python3 scripts/build_game_ot.py
"""
import json, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "game_ot.json"
SCOREBOARD = ("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/"
              "scoreboard?dates={d}&groups=50&limit=400")


def day(d):
    for i in range(3):
        try:
            j = json.loads(urllib.request.urlopen(SCOREBOARD.format(d=d.replace("-", "")), timeout=30).read())
            out = {}
            for e in j.get("events", []):
                st = e["competitions"][0]["status"]
                if st["type"].get("completed") and (st.get("period") or 0) > 2:
                    out[str(e["id"])] = st["period"] - 2
            return d, out
        except Exception:
            time.sleep(2 * (i + 1))
    return d, None


def main():
    dates = sorted({json.loads(l)["date"] for l in open(ROOT / "scripts" / "data" / "games.jsonl")})
    ot = json.load(open(OUT)) if OUT.exists() else {}
    failed = []
    with ThreadPoolExecutor(6) as ex:
        for i, (d, got) in enumerate(ex.map(day, dates)):
            if got is None: failed.append(d)
            else: ot.update(got)
            if (i + 1) % 250 == 0: print("  %d/%d dates, %d OT games" % (i + 1, len(dates), len(ot)))
    OUT.write_text(json.dumps(dict(sorted(ot.items())), separators=(",", ":")))
    print("%d OT games across %d dates -> %s%s" % (len(ot), len(dates), OUT.name, ("  (failed: %s)" % ", ".join(failed)) if failed else ""))


if __name__ == "__main__":
    main()
