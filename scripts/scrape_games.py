#!/usr/bin/env python3
"""
Scrape every D1 men's game (schedule + final score + ids) from ESPN's scoreboard,
iterating day-by-day. Game ids feed the box-score scraper (scrape_boxscores.py).

ESPN coverage thins out pre-~2010 (only marquee games), so older seasons will be
lighter than recent ones. Resumable (per season+date) and parallel over dates.

  python3 scrape_games.py --seasons 2024            # pilot one season
  python3 scrape_games.py                            # all 20 (2007-2026)
Output: data/games.jsonl  (one row per game)
"""
import argparse, json, sys, time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
import cloudscraper

DATA = Path(__file__).parent / "data"
OUT  = DATA / "games.jsonl"
PROG = DATA / "games_progress.json"
SCOREBOARD = ("https://site.api.espn.com/apis/site/v2/sports/basketball/"
              "mens-college-basketball/scoreboard?dates={d}&groups=50&limit=400")
S = cloudscraper.create_scraper(browser={"browser":"chrome","platform":"darwin","mobile":False})


def get(url, tries=3):
    for i in range(tries):
        try:
            r = S.get(url, timeout=30)
            if r.status_code == 200:
                return r.json()
        except Exception:
            pass
        time.sleep(1 + 2*i)
    return None


def _int(x):
    try: return int(x)
    except Exception: return None


def season_dates(yr):
    """Season YR (e.g. 2024 = 2023-24): Nov 1 (yr-1) through Apr 15 (yr)."""
    d, end, out = date(yr-1, 11, 1), date(yr, 4, 15), []
    while d <= end:
        out.append(d.strftime("%Y%m%d")); d += timedelta(days=1)
    return out


def parse_game(e, yr, dt=None):
    try:
        comp = e["competitions"][0]
        cs = {c["homeAway"]: c for c in comp["competitors"]}
        h, a = cs.get("home"), cs.get("away")
        if not h or not a:
            return None
        # use the scoreboard (venue/ET) date, not the UTC event timestamp, so
        # evening games don't roll to the next calendar day
        game_date = f"{dt[:4]}-{dt[4:6]}-{dt[6:8]}" if dt else e["date"][:10]
        return {
            "id": int(e["id"]), "season": yr, "date": game_date,
            "home": h["team"]["displayName"], "home_id": _int(h["team"]["id"]), "home_score": _int(h.get("score")),
            "away": a["team"]["displayName"], "away_id": _int(a["team"]["id"]), "away_score": _int(a.get("score")),
            "neutral": bool(comp.get("neutralSite")),
            "conf_game": bool(comp.get("conferenceCompetition")),
            "status": comp.get("status", {}).get("type", {}).get("name", ""),
        }
    except Exception:
        return None


def fetch_date(dt, yr):
    d = get(SCOREBOARD.format(d=dt))
    games = []
    if d:
        for e in d.get("events", []):
            g = parse_game(e, yr, dt)
            if g:
                games.append(g)
    return dt, games


def main(seasons):
    prog = json.loads(PROG.read_text()) if PROG.exists() else {"done": []}
    done = set(prog["done"])
    fout = open(OUT, "a")
    seen, n = set(), 0
    for yr in seasons:
        dates = [d for d in season_dates(yr) if f"{yr}:{d}" not in done]
        with ThreadPoolExecutor(max_workers=8) as ex:
            for dt, games in ex.map(lambda d: fetch_date(d, yr), dates):
                for g in games:
                    if g["id"] in seen:
                        continue
                    seen.add(g["id"]); fout.write(json.dumps(g) + "\n"); n += 1
                done.add(f"{yr}:{dt}")
        fout.flush(); PROG.write_text(json.dumps({"done": list(done)}))
        print(f"season {yr}: {n} games cumulative", flush=True)
    fout.close()
    print(f"DONE: {n} games -> {OUT}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="+", default=list(range(2007, 2027)))
    main(ap.parse_args().seasons)
