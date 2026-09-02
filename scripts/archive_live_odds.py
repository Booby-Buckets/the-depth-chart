#!/usr/bin/env python3
"""
archive_live_odds.py — Betting Hub, Phase C: LIVE in-season odds archive.

Pulls the current NCAAB odds board (upcoming games, main markets) from the
the-odds-api v4 /odds endpoint — the CHEAP one: 1 credit per market per region
per call, not the 10× historical rate — takes a consensus (median-across-books)
line per game, and does two things:

  1. Overwrites  scripts/data/odds_live.json      — today's/upcoming board, the
     live "Best Bets" feed the site reads (model line vs the book's number).
  2. Appends to  scripts/data/odds_archive.jsonl  — one line per (game, snapshot),
     our own growing forward archive of opening→closing movement + closing lines.
     Nobody sells 5yr of this cheaply, so we OWN it by capturing it daily.

Run twice a day (a morning snapshot + a near-tip evening snapshot) so the archive
captures both the open and the close. Designed to be run from a GitHub Action with
the ODDS_API_KEY repo secret (see .github/workflows/archive-odds.yml). Off-season
the board comes back empty — the script writes an empty live file, appends nothing,
and exits 0, so it is safe to leave scheduled year-round.

Reuses the normalizer / consensus / fetch helpers from build_odds_history.py so the
team-name matching is identical to the historical backfill.

Usage:
  export ODDS_API_KEY=...           # never commit the key
  python3 scripts/archive_live_odds.py
  python3 scripts/archive_live_odds.py --markets spreads,totals,h2h --regions us
  python3 scripts/archive_live_odds.py --dry-run     # print the board, write nothing
"""
import os, sys, json, urllib.parse
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_odds_history import api_get, consensus_line, norm   # shared helpers

DATA = os.path.join(HERE, "data")
LIVE = os.path.join(DATA, "odds_live.json")
ARCHIVE = os.path.join(DATA, "odds_archive.jsonl")

API_BASE = "https://api.the-odds-api.com/v4"
SPORT = "basketball_ncaab"


def fetch_board(key, markets, regions):
    url = "%s/sports/%s/odds?apiKey=%s&regions=%s&markets=%s&oddsFormat=american" % (
        API_BASE, SPORT, urllib.parse.quote(key), regions, markets)
    body, rem, used = api_get(url)
    return (body or []), rem, used


def board_to_games(events, snap_ts):
    games = []
    for ev in events:
        line = consensus_line(ev)
        if not line.get("home") or not line.get("away"):
            continue
        games.append({
            "id": ev.get("id"),
            "commence": ev.get("commence_time"),
            "home": line["home"], "away": line["away"],
            "home_norm": norm(line["home"]), "away_norm": norm(line["away"]),
            "spread": line["spread"],       # home-relative points (negative = home favored)
            "total": line["total"],
            "ml_home": line["ml_home"], "ml_away": line["ml_away"],
            "snapshot": snap_ts,
        })
    return games


def main():
    args = sys.argv[1:]
    markets = args[args.index("--markets") + 1] if "--markets" in args else "spreads,totals,h2h"
    regions = args[args.index("--regions") + 1] if "--regions" in args else "us"
    dry = "--dry-run" in args
    key = os.environ.get("ODDS_API_KEY", "")

    if not key and not dry:
        print("ERROR: ODDS_API_KEY not set. `export ODDS_API_KEY=...` then re-run "
              "(or use --dry-run to test plumbing without a key).", flush=True)
        return 1

    snap_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if dry and not key:
        print("[dry-run] no key set — nothing fetched. With a key, --dry-run fetches "
              "the board and prints it but writes no files.", flush=True)
        return 0

    try:
        events, rem, used = fetch_board(key, markets, regions)
    except Exception as e:
        print("Fetch failed: %s" % e, flush=True)
        return 1

    games = board_to_games(events, snap_ts)
    print("Board: %d games · credits used this call: %s · remaining: %s"
          % (len(games), used, rem), flush=True)

    if dry:
        for g in games[:20]:
            print("  %s @ %s  spread(home) %s  total %s  ml %s/%s"
                  % (g["away"], g["home"], g["spread"], g["total"], g["ml_home"], g["ml_away"]), flush=True)
        print("[dry-run] wrote nothing.", flush=True)
        return 0

    os.makedirs(DATA, exist_ok=True)
    # 1) live board (overwrite) — the site's Best Bets feed
    with open(LIVE, "w") as f:
        json.dump({"generated": snap_ts, "sport": "NCAAB", "markets": markets,
                   "count": len(games), "games": games}, f, separators=(",", ":"))
    print("Wrote %s (%d games)." % (os.path.relpath(LIVE, HERE), len(games)), flush=True)

    # 2) forward archive (append) — only when there are games to record
    if games:
        with open(ARCHIVE, "a") as f:
            for g in games:
                f.write(json.dumps(g, separators=(",", ":")) + "\n")
        print("Appended %d snapshots to %s." % (len(games), os.path.relpath(ARCHIVE, HERE)), flush=True)
    else:
        print("Empty board (off-season / no games today) — archive untouched.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
