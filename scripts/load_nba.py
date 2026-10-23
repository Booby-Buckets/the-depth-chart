#!/usr/bin/env python3
"""Load scrape_nba.py output into nba_players / nba_games / nba_box / nba_seasons.
Run schema_nba.sql first. Idempotent upsert; dry run unless --write.

  python3 load_nba.py              # counts only
  python3 load_nba.py --write      # all tables
  python3 load_nba.py --write box  # one table
"""
import json, sys, time, requests
from pathlib import Path
from load_bbref import SB, H          # same key resolution (SUPABASE_SERVICE_KEY or load_supabase.py)

DATA = Path(__file__).parent / "data"
TABLES = {  # table: (file, conflict key, row filter/shaper)
    "players": ("nba_players.jsonl", "espn_id",
                lambda r: None if r.get("missing") else r),
    "games":   ("nba_games.jsonl", "game_id",
                lambda r: None if r.get("missing") else r),
    "box":     ("nba_box.jsonl", "game_id,espn_id",
                lambda r: r if r.get("espn_id") else None),
    "seasons": ("nba_seasons.jsonl", "espn_id,season,season_type",
                lambda r: r if r.get("stats") else None),
}


def rows_for(name):
    f, key, shape = TABLES[name]
    keys = key.split(",")
    seen = {}
    for l in (DATA / f).read_text().splitlines():
        try: r = shape(json.loads(l))
        except Exception: continue
        if r: seen[tuple(r.get(k) for k in keys)] = r     # last write wins
    return list(seen.values()), key


def main(write, only):
    for name in only or TABLES:
        rows, key = rows_for(name)
        print(f"nba_{name}: {len(rows)} rows")
        if not write: continue
        ok = 0
        for j in range(0, len(rows), 1000):
            b = rows[j:j + 1000]
            for i in range(4):
                r = requests.post(f"{SB}/rest/v1/nba_{name}?on_conflict={key}",
                                  headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"},
                                  json=b, timeout=120)
                if r.status_code in (200, 201, 204): ok += len(b); break
                print(f"  ERR {r.status_code}: {r.text[:200]}"); time.sleep(5 * (i + 1))
            else:
                raise SystemExit("  giving up")
        print(f"  wrote {ok}")
    if not write: print("DRY RUN — pass --write")


if __name__ == "__main__":
    args = sys.argv[1:]
    main("--write" in args, [a for a in args if not a.startswith("--")])
