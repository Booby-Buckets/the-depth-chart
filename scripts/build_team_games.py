"""build_team_games.py — team box totals per game (both sides), summed from box_scores.

  python3 scripts/build_team_games.py 2024 2025 2026 2027
  -> scripts/data/team_games/<season>.json  {fields, games: [[game_id, date, team, opp, ...fields]]}

Feeds the luck model (scripts/build_luck.py). Paged with a stable ORDER BY (see the Supabase pagination note: unordered
pages silently drop rows).
"""
import json, os, sys, time, urllib.request, urllib.parse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1"
KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye")
F = ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "tov", "stl", "blk", "pf"]
OUT = os.path.join(os.path.dirname(__file__), "data", "team_games")


def get(path, tries=14):
    for i in range(tries):
        try:
            req = urllib.request.Request(f"{SB}/{path}", headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(min(30, 3 * (i + 1)))


def season(y):
    # page by date windows (a week at a time) so each request is small and ordered
    from datetime import date, timedelta
    d0, d1 = date(y - 1, 10, 25), date(y, 4, 15)
    wins = []
    d = d0
    while d <= d1:
        wins.append((d, d)); d += timedelta(days=1)   # one day per request: week windows hit statement timeouts (500)

    def pull(w):
        rows, off = [], 0
        sel = "game_id,date,team,opp," + ",".join(F)
        while True:
            q = f"box_scores?season_year=eq.{y}&date=gte.{w[0]}&date=lte.{w[1]}&select={sel}&order=game_id.asc,espn_id.asc&limit=1000&offset={off}"
            r = get(q); rows += r
            if len(r) < 1000: return rows
            off += 1000

    T = defaultdict(lambda: [None, None, None] + [0] * len(F))
    with ThreadPoolExecutor(2) as ex:
        for rows in ex.map(pull, wins):
            for b in rows:
                k = (b["game_id"], b["team"])
                t = T[k]; t[0], t[1], t[2] = b["date"], b["team"], b["opp"]
                for i, f in enumerate(F): t[3 + i] += b.get(f) or 0
    games = [[gid] + v for (gid, _), v in T.items()]
    games.sort(key=lambda g: (g[1], g[0], g[2]))
    os.makedirs(OUT, exist_ok=True)
    json.dump({"season": y, "fields": ["game_id", "date", "team", "opp"] + F, "games": games},
              open(os.path.join(OUT, f"{y}.json"), "w"), separators=(",", ":"))
    print(f"{y}: {len(games)} team-games", flush=True)


if __name__ == "__main__":
    for y in sys.argv[1:]: season(int(y))
