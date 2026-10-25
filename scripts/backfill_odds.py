#!/usr/bin/env python3
"""
backfill_odds.py — buy historical odds for TDC Bet's backtests (the-odds-api historical endpoints).

Two kinds of history, for college (basketball_ncaab) or the NBA (basketball_nba):

  lines   every book's spread / total / moneyline per game, the last snapshot before tip
          (historical odds: 10 credits x markets x regions per snapshot call, all games in that call)
  props   player props (PTS/REB/AST/3PM/PRA) per game, ~45 minutes before tip
          (historical event odds: 10 credits x markets returned x regions per GAME; prop history starts May 2023)

Output (gzipped JSON lines, resumable — anything already saved is skipped):
  scripts/data/hist/<sport>_<season>_lines.jsonl.gz   {id, commence, home, away, snapshot, spread, total, ml_home, ml_away, books}
  scripts/data/hist/<sport>_<season>_props.jsonl.gz   {id, commence, home, away, snapshot, props:[{p, m, b:{book:[line, over, under]}}]}

ALWAYS start with --sample-days to measure: it pulls only the first N game days and prints real credit use,
so the full-season estimate is measured, not guessed.

  python3 scripts/backfill_odds.py --sport ncaab --mode lines --seasons 2024,2025,2026 --dry-run
  python3 scripts/backfill_odds.py --sport ncaab --mode props --seasons 2026 --sample-days 7
  python3 scripts/backfill_odds.py --sport nba --mode props --seasons 2025 --max-credits 80000

Runs from GitHub Actions (.github/workflows/backfill-odds.yml) with the ODDS_API_KEY secret, so the key never
leaves the repo's secrets. --max-credits stops the run before it spends more than that.
"""
import os, sys, json, gzip, urllib.parse, urllib.error
from datetime import datetime, timedelta, timezone, date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_odds_history import api_get, consensus_line, norm          # shared helpers
from archive_live_odds import book_lines, event_markets, PROP_MARKETS

API = "https://api.the-odds-api.com/v4"
OUT = os.path.join(HERE, "data", "hist")
SPORTS = {"ncaab": ("basketball_ncaab", (11, 1), (4, 10)), "nba": ("basketball_nba", (10, 15), (6, 20))}
LINE_SNAPS = ["16:00", "22:45"]               # UTC (11:00 / 17:45 ET); the latest one before each tip is that game's close-ish line


def arg(name, default=None):
    a = sys.argv[1:]
    return a[a.index(name) + 1] if name in a else default


def path_for(sport, season, mode):
    return os.path.join(OUT, "%s_%d_%s.jsonl.gz" % (sport, season, mode))


def load_done(p):
    done = {}
    if os.path.exists(p):
        with gzip.open(p, "rt") as f:
            for line in f:
                try:
                    r = json.loads(line); done[r["id"]] = r
                except Exception:
                    pass
    return done


def append(p, rows):
    with gzip.open(p, "at") as f:
        for r in rows:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")


def season_days(sport, season):
    _, (m0, d0), (m1, d1) = SPORTS[sport]
    d = date(season - 1, m0, d0); end = date(season, m1, d1)
    while d <= end:
        yield d
        d += timedelta(days=1)


class Budget:
    def __init__(self, cap):
        self.cap, self.spent, self.rem = cap, 0, None

    def ok(self, next_cost):
        return self.cap is None or self.spent + next_cost <= self.cap

    def add(self, used, rem):
        self.spent += int(used or 0); self.rem = rem


def lines_season(key, sport, season, sample, budget, dry):
    sk = SPORTS[sport][0]; p = path_for(sport, season, "lines"); done = load_done(p)
    days = list(season_days(sport, season)); days = days[:sample] if sample else days
    mks = arg("--markets", "spreads,totals")                          # add h2h for moneylines (+50% cost)
    per = 10 * len(mks.split(",")) * 1                                # historical: 10 x markets x region us
    print("%s %d lines: %d days x %d snaps = %d calls, ~%d credits (worst case)" % (sport, season, len(days), len(LINE_SNAPS), len(days) * len(LINE_SNAPS), len(days) * len(LINE_SNAPS) * per), flush=True)
    if dry:
        return
    best = {}
    for d in days:
        for sn in LINE_SNAPS:
            ts = "%sT%s:00Z" % (d.isoformat(), sn)
            if not budget.ok(per):
                print("credit cap reached", flush=True); return finish_lines(p, best, done)
            url = "%s/historical/sports/%s/odds?apiKey=%s&regions=us&markets=%s&oddsFormat=american&date=%s" % (API, sk, urllib.parse.quote(key), mks, ts)
            try:
                body, rem, used = api_get(url)
            except urllib.error.HTTPError as e:
                print("  HTTP %s at %s" % (e.code, ts), flush=True)
                if e.code in (401, 403, 422):
                    return finish_lines(p, best, done)
                continue
            budget.add(used, rem)
            snap = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            for ev in (body.get("data") or []):
                if ev["id"] in done:
                    continue
                try:
                    tip = datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
                except Exception:
                    continue
                if snap >= tip:
                    continue
                if ev["id"] not in best or best[ev["id"]]["snapshot"] < ts:
                    c = consensus_line(ev)
                    best[ev["id"]] = {"id": ev["id"], "commence": ev["commence_time"], "home": c["home"], "away": c["away"], "snapshot": ts,
                                      "spread": c["spread"], "total": c["total"], "ml_home": c["ml_home"], "ml_away": c["ml_away"], "books": book_lines(ev)}
        print("  %s · %d games · %d credits spent · %s remaining" % (d, len(best), budget.spent, budget.rem), flush=True)
    finish_lines(p, best, done)


def finish_lines(p, best, done):
    rows = [r for k, r in best.items() if k not in done]
    if rows:
        append(p, rows)
    print("saved %d games to %s" % (len(rows), os.path.relpath(p, HERE)), flush=True)


def props_season(key, sport, season, sample, budget, dry):
    sk = SPORTS[sport][0]; p = path_for(sport, season, "props"); done = load_done(p)
    days = list(season_days(sport, season)); days = days[:sample] if sample else days
    mk = ",".join(PROP_MARKETS)
    if datetime(season - 1, 11, 1) < datetime(2023, 5, 3) and not sample:
        print("note: prop history starts 2023-05-03; earlier games return nothing", flush=True)
    print("%s %d props: %d days · per game ~%d credits (10 x %d markets x 1 region) + 1 credit per day for the game list" % (sport, season, len(days), 10 * len(PROP_MARKETS), len(PROP_MARKETS)), flush=True)
    if dry:
        return
    for d in days:
        if not budget.ok(1):
            print("credit cap reached", flush=True); return
        ts = "%sT15:00:00Z" % d.isoformat()
        try:
            body, rem, used = api_get("%s/historical/sports/%s/events?apiKey=%s&date=%s&commenceTimeFrom=%sT12:00:00Z&commenceTimeTo=%sT11:59:00Z" % (
                API, sk, urllib.parse.quote(key), ts, d.isoformat(), (d + timedelta(days=1)).isoformat()))
        except urllib.error.HTTPError as e:
            print("  HTTP %s listing %s" % (e.code, d), flush=True)
            if e.code in (401, 403):
                return
            continue
        budget.add(used, rem)
        rows = []
        for ev in (body.get("data") or []):
            if ev["id"] in done:
                continue
            if not budget.ok(10 * len(PROP_MARKETS)):
                append(p, rows); print("credit cap reached", flush=True); return
            tip = datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
            snap = (tip - timedelta(minutes=45)).strftime("%Y-%m-%dT%H:%M:%SZ")
            try:
                b2, rem, used = api_get("%s/historical/sports/%s/events/%s/odds?apiKey=%s&regions=us&markets=%s&oddsFormat=american&date=%s" % (
                    API, sk, ev["id"], urllib.parse.quote(key), mk, snap))
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    append(p, rows); return
                continue
            budget.add(used, rem)
            em = event_markets((b2 or {}).get("data") or {})
            rows.append({"id": ev["id"], "commence": ev["commence_time"], "home": ev.get("home_team"), "away": ev.get("away_team"), "snapshot": snap, "props": em["props"]})
        append(p, rows)
        print("  %s · %d games (%d with props) · %d credits spent · %s remaining" % (d, len(rows), sum(1 for r in rows if r["props"]), budget.spent, budget.rem), flush=True)


def main():
    sport = arg("--sport", "ncaab"); mode = arg("--mode", "lines")
    seasons = [int(x) for x in arg("--seasons", "2026").split(",")]
    sample = int(arg("--sample-days", "0")) or None
    cap = int(arg("--max-credits")) if arg("--max-credits") else None
    dry = "--dry-run" in sys.argv
    key = os.environ.get("ODDS_API_KEY", "")
    if not key and not dry:
        print("ERROR: ODDS_API_KEY not set (run from the backfill-odds workflow, or export it locally)."); return 1
    if sport not in SPORTS:
        print("unknown --sport (ncaab | nba)"); return 1
    os.makedirs(OUT, exist_ok=True)
    budget = Budget(cap)
    for s in seasons:
        (lines_season if mode == "lines" else props_season)(key, sport, s, sample, budget, dry)
    print("TOTAL credits spent this run: %d · remaining on the plan: %s" % (budget.spent, budget.rem), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
