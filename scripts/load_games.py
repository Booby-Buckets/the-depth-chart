#!/usr/bin/env python3
"""
Load games.jsonl + box_scores.jsonl into the `games` / `box_scores` tables.
Run schema_v2.sql first to create the tables.

  python3 load_games.py games        # load games.jsonl -> games
  python3 load_games.py box          # load box_scores.jsonl -> box_scores
  python3 load_games.py both
"""
import os, sys, json, time
from pathlib import Path
import requests

DATA = Path(__file__).parent / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def upload(table, rows, conflict):
    ok = 0
    for j in range(0, len(rows), 500):
        batch = rows[j:j+500]
        r = requests.post(f"{SB}/rest/v1/{table}?on_conflict={conflict}",
                          headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"},
                          json=batch, timeout=90)
        if r.status_code in (200, 201, 204):
            ok += len(batch)
        else:
            print(f"  ERR {table} {r.status_code}: {r.text[:200]}"); return ok
        if j % 25000 == 0:
            print(f"    {ok}/{len(rows)}", flush=True)
        time.sleep(0.05)
    return ok


def load_games():
    rows = []
    for line in (DATA / "games.jsonl").read_text().splitlines():
        try:
            g = json.loads(line)
        except Exception:
            continue
        g["season_year"] = g.pop("season", None)
        rows.append(g)
    # de-dup by id (resume re-appends can duplicate)
    rows = list({r["id"]: r for r in rows}.values())
    print(f"games: {len(rows)} unique")
    print(f"  loaded {upload('games', rows, 'id')}")


def load_box():
    seen, rows = set(), []
    for line in (DATA / "box_scores.jsonl").read_text().splitlines():
        try:
            b = json.loads(line)
        except Exception:
            continue
        k = (b["game_id"], b["espn_id"])
        if k in seen:
            continue
        seen.add(k)
        b["season_year"] = b.pop("season", None)
        rows.append(b)
    print(f"box_scores: {len(rows)} unique player-games")
    print(f"  loaded {upload('box_scores', rows, 'game_id,espn_id')}")


def load_team_seasons():
    rows = []
    for line in (DATA / "team_seasons.jsonl").read_text().splitlines():
        try:
            t = json.loads(line)
        except Exception:
            continue
        t["season_year"] = t.pop("season", None)
        rows.append(t)
    rows = list({(r["season_year"], r["team"]): r for r in rows}.values())
    print(f"team_seasons: {len(rows)} unique")
    print(f"  loaded {upload('team_seasons', rows, 'season_year,team')}")


def load_postseason():
    seen, rows = set(), []
    for line in (DATA / "postseason.jsonl").read_text().splitlines():
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        r["season_year"] = r.pop("season", None)
        rows.append(r)
    print(f"postseason_games: {len(rows)} games")
    print(f"  loaded {upload('postseason_games', rows, 'id')}")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "both"
    if what in ("games", "both"):
        load_games()
    if what in ("box", "both"):
        load_box()
    if what in ("teams", "team_seasons"):
        load_team_seasons()
    if what in ("postseason", "post"):
        load_postseason()
