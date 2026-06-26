#!/usr/bin/env python3
"""
Scrape player box scores for every game id in games.jsonl (ESPN summary endpoint).
One output row per player per game, keyed by ESPN athlete id. Resumable (per game
id) and parallel. This is the massive one — run it in the background.

  python3 scrape_boxscores.py --limit 200      # pilot a sample
  python3 scrape_boxscores.py                    # everything in games.jsonl
Output: data/box_scores.jsonl
"""
import argparse, json, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import cloudscraper

DATA = Path(__file__).parent / "data"
GAMES = DATA / "games.jsonl"
OUT = DATA / "box_scores.jsonl"
PROG = DATA / "box_progress.json"
SUMMARY = ("https://site.api.espn.com/apis/site/v2/sports/basketball/"
           "mens-college-basketball/summary?event={id}")
S = cloudscraper.create_scraper(browser={"browser":"chrome","platform":"darwin","mobile":False})

# ESPN stat key -> our field (made-att pairs are split out below)
PAIRS = {"fieldGoalsMade-fieldGoalsAttempted": ("fgm","fga"),
         "threePointFieldGoalsMade-threePointFieldGoalsAttempted": ("tpm","tpa"),
         "freeThrowsMade-freeThrowsAttempted": ("ftm","fta")}
SINGLE = {"minutes":"min","points":"pts","rebounds":"reb","assists":"ast",
          "turnovers":"tov","steals":"stl","blocks":"blk",
          "offensiveRebounds":"oreb","defensiveRebounds":"dreb","fouls":"pf"}


def get(url, tries=3):
    for i in range(tries):
        try:
            r = S.get(url, timeout=30)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 404:
                return None
        except Exception:
            pass
        time.sleep(0.7 + 1.5*i)
    return None


def _i(x):
    try: return int(x)
    except Exception: return None


def parse_box(gid, game):
    d = get(SUMMARY.format(id=gid))
    if not d:
        return None  # signal failure (retry later) vs empty
    rows = []
    teams = (d.get("boxscore") or {}).get("players") or []
    names = [t["team"]["displayName"] for t in teams if t.get("team")]
    for ti, t in enumerate(teams):
        if not t.get("statistics"):
            continue
        blk = t["statistics"][0]
        keys = blk.get("keys", [])
        team = t["team"]["displayName"]
        opp = names[1-ti] if len(names) == 2 else None
        for a in blk.get("athletes", []):
            if a.get("didNotPlay"):
                continue
            stats = a.get("stats") or []
            if not stats:
                continue
            row = {"game_id": gid, "season": game["season"], "date": game["date"],
                   "team": team, "opp": opp,
                   "player": a["athlete"]["displayName"], "espn_id": _i(a["athlete"].get("id")),
                   "starter": bool(a.get("starter"))}
            for k, v in zip(keys, stats):
                if k in SINGLE:
                    row[SINGLE[k]] = _i(v)
                elif k in PAIRS and isinstance(v, str) and "-" in v:
                    m, at = v.split("-", 1)
                    row[PAIRS[k][0]] = _i(m); row[PAIRS[k][1]] = _i(at)
            if row.get("espn_id"):
                rows.append(row)
    return rows


def main(limit=None):
    games = {}
    for line in GAMES.read_text().splitlines():
        try:
            g = json.loads(line); games[g["id"]] = g
        except Exception:
            pass
    prog = json.loads(PROG.read_text()) if PROG.exists() else {"done": []}
    done = set(prog["done"])
    todo = [gid for gid in games if gid not in done]
    if limit:
        todo = todo[:limit]
    print(f"{len(games)} games total | {len(todo)} to scrape", flush=True)
    fout = open(OUT, "a")
    n_rows, n_done = 0, 0
    BATCH = 400
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i+BATCH]
        with ThreadPoolExecutor(max_workers=6) as ex:
            results = list(ex.map(lambda gid: (gid, parse_box(gid, games[gid])), chunk))
        for gid, rows in results:
            if rows is None:          # fetch failed — leave undone to retry next run
                continue
            for r in rows:
                fout.write(json.dumps(r) + "\n"); n_rows += 1
            done.add(gid); n_done += 1
        fout.flush(); PROG.write_text(json.dumps({"done": list(done)}))
        print(f"  {n_done}/{len(todo)} games | {n_rows} player-rows", flush=True)
    fout.close()
    print(f"DONE: {n_rows} rows from {n_done} games -> {OUT}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    main(ap.parse_args().limit)
