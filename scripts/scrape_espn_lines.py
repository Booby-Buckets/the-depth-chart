#!/usr/bin/env python3
"""
scrape_espn_lines.py — free historical college lines for TDC Bet's backtests, from ESPN's odds feed.

ESPN keeps each past game's odds from several books (2015-16 on: Pinnacle, Westgate, Caesars, DraftKings, MGM, ESPN BET,
consensus …; 2024-25 on mostly ESPN BET only): spread, total, moneylines and, for many, the OPENING numbers too. That's
the market we have to beat, game by game, for nothing.

  python3 scripts/scrape_espn_lines.py --seasons 2016,2017,...      # resumable; skips games already saved
  python3 scripts/scrape_espn_lines.py --seasons 2024 --limit 200   # quick sample

Writes scripts/data/hist/espn_lines_<season>.jsonl.gz, one row per game:
  {id, season, date, home, away, hs, as, neutral, books: {provider: {spread, total, ml_home, ml_away, open_spread, open_total}}}
spread = the HOME team's line (negative = home favoured), as ESPN reports it.
"""
import json, os, sys, gzip, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(DATA, "hist")
CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball"


def arg(k, d=None):
    a = sys.argv[1:]
    return a[a.index(k) + 1] if k in a else d


def getj(url):
    for i in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "tdc"}), timeout=30))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(1.5 * (i + 1))
        except Exception:
            time.sleep(1.5 * (i + 1))
    return None


def num(x):
    try:
        return float(x)
    except Exception:
        return None


def american(x):
    try:
        return int(round(float(str(x).replace("+", ""))))
    except Exception:
        return None


def lines(g):
    d = getj("%s/events/%s/competitions/%s/odds?limit=50" % (CORE, g["id"], g["id"]))
    if not d:
        return None
    books = {}
    for it in d.get("items", []):
        nm = (it.get("provider") or {}).get("name") or str((it.get("provider") or {}).get("id"))
        ho, ao = it.get("homeTeamOdds") or {}, it.get("awayTeamOdds") or {}
        b = {"spread": num(it.get("spread")), "total": num(it.get("overUnder")),
             "ml_home": american(ho.get("moneyLine")), "ml_away": american(ao.get("moneyLine"))}
        op = it.get("open") or {}
        hop = (ho.get("open") or {}).get("pointSpread") or {}
        b["open_spread"] = num(hop.get("american")) if hop else None
        b["open_total"] = num(((op.get("total") or {}).get("american")) if op else None)
        if any(v is not None for v in b.values()):
            books[nm] = b
    return books


def main():
    seasons = [int(x) for x in arg("--seasons", "2016").split(",")]
    limit = int(arg("--limit", "0")) or None
    games = {}
    with open(os.path.join(DATA, "games.jsonl")) as f:
        for line in f:
            g = json.loads(line)
            if g.get("season") in seasons and g.get("status") == "STATUS_FINAL" and g.get("home_score") is not None:
                games.setdefault(g["season"], []).append(g)
    os.makedirs(OUT, exist_ok=True)
    for s in seasons:
        path = os.path.join(OUT, "espn_lines_%d.jsonl.gz" % s)
        done = set()
        if os.path.exists(path):
            with gzip.open(path, "rt") as f:
                for line in f:
                    try:
                        done.add(json.loads(line)["id"])
                    except Exception:
                        pass
        todo = [g for g in games.get(s, []) if g["id"] not in done]
        if limit:
            todo = todo[:limit]
        print("season %d: %d games, %d already saved, %d to fetch" % (s, len(games.get(s, [])), len(done), len(todo)), flush=True)
        t0 = time.time(); n_with = 0
        for i in range(0, len(todo), 400):
            chunk = todo[i:i + 400]
            with ThreadPoolExecutor(8) as ex:
                res = list(ex.map(lines, chunk))
            with gzip.open(path, "at") as f:
                for g, b in zip(chunk, res):
                    if b is None:
                        b = {}
                    n_with += bool(b)
                    f.write(json.dumps({"id": g["id"], "season": s, "date": g["date"], "home": g["home"], "away": g["away"],
                                        "hs": g["home_score"], "as": g["away_score"], "neutral": g.get("neutral", False), "books": b},
                                       separators=(",", ":")) + "\n")
            print("  %d/%d · %d with lines · %.0fs" % (i + len(chunk), len(todo), n_with, time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
