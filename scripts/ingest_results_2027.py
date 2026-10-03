#!/usr/bin/env python3
"""
2026-27 results feed: every finished D-I game → scripts/data/results_2027.json (+ the database).

The site's projections all start from this file (tdc-schedule.js loads it): a played game is a fixed
result in every simulated season, so team schedules, conference standings, conference tournaments, the
NCAA / NIT projection and the fantasy playoffs all begin from the real record, and each team's strength
is updated from how it has actually played.

  python3 scripts/ingest_results_2027.py              # yesterday + today (ET), the nightly default
  python3 scripts/ingest_results_2027.py --days 7     # the last week (catch up after a missed run)
  python3 scripts/ingest_results_2027.py --all        # the whole season so far

With SUPABASE_SERVICE_KEY set it also upserts the `games` rows (scores + status, season_year 2027) and
the player box scores of every newly final game into `box_scores` (fantasy stats, player pages). Without
it, only the results file is written. Runs in GitHub Actions (.github/workflows/results.yml).
"""
import json, os, sys, time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_schedule_2027 import NAME_FIX   # ESPN renames → the ratings' spelling

DATA = Path(__file__).parent / "data"
OUT = DATA / "results_2027.json"
SEASON = 2027
FIRST, LAST = date(2026, 11, 1), date(2027, 4, 6)
SCOREBOARD = ("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/"
              "scoreboard?dates={d}&groups=50&limit=400")
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={id}"
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0"   # ESPN's edge 403s browser-looking UAs here
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ.get("SUPABASE_SERVICE_KEY")
SINGLE = {"minutes": "min", "points": "pts", "rebounds": "reb", "assists": "ast", "turnovers": "tov", "steals": "stl",
          "blocks": "blk", "offensiveRebounds": "oreb", "defensiveRebounds": "dreb", "fouls": "pf"}
PAIRS = {"fieldGoalsMade-fieldGoalsAttempted": ("fgm", "fga"), "threePointFieldGoalsMade-threePointFieldGoalsAttempted": ("tpm", "tpa"),
         "freeThrowsMade-freeThrowsAttempted": ("ftm", "fta")}


def et_today():
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


def get(url, tries=3):
    for i in range(tries):
        try:
            r = S.get(url, timeout=30)
            if r.status_code == 200:
                return r.json()
        except Exception:
            pass
        time.sleep(1 + 2 * i)
    return None


def _i(x):
    try: return int(x)
    except Exception: return None


def fetch_day(d):
    """every game ESPN lists on that (ET) date, with its status and score"""
    j = get(SCOREBOARD.format(d=d.strftime("%Y%m%d")))
    out = []
    for e in (j or {}).get("events", []):
        try:
            comp = e["competitions"][0]
            cs = {c["homeAway"]: c for c in comp["competitors"]}
            h, a = cs["home"], cs["away"]
            st = comp.get("status", {}).get("type", {})
            out.append({"id": int(e["id"]), "season_year": SEASON, "date": d.isoformat(),
                        "home": NAME_FIX.get(h["team"]["displayName"], h["team"]["displayName"]), "home_id": _i(h["team"]["id"]),
                        "home_score": _i(h.get("score")), "away": NAME_FIX.get(a["team"]["displayName"], a["team"]["displayName"]),
                        "away_id": _i(a["team"]["id"]), "away_score": _i(a.get("score")),
                        "neutral": bool(comp.get("neutralSite")), "conf_game": bool(comp.get("conferenceCompetition")),
                        "status": st.get("name", ""), "final": bool(st.get("completed")) and st.get("name") != "STATUS_POSTPONED"})
        except Exception:
            continue
    return out


def parse_box(g):
    d = get(SUMMARY.format(id=g["id"]))
    if not d: return None
    rows = []
    teams = (d.get("boxscore") or {}).get("players") or []
    names = [(t.get("team") or {}).get("displayName") for t in teams]
    for ti, t in enumerate(teams):
        if not t.get("statistics"): continue
        blk = t["statistics"][0]; keys = blk.get("keys", [])
        for a in blk.get("athletes", []):
            if a.get("didNotPlay"): continue
            ath = a.get("athlete") or {}; stats = a.get("stats") or []
            if not stats or not ath.get("id"): continue
            row = {"game_id": g["id"], "season_year": SEASON, "date": g["date"], "team": names[ti],
                   "opp": names[1 - ti] if len(names) == 2 else None, "player": ath.get("displayName"),
                   "espn_id": _i(ath.get("id")), "starter": bool(a.get("starter"))}
            for k, v in zip(keys, stats):
                if k in SINGLE: row[SINGLE[k]] = _i(v)
                elif k in PAIRS and isinstance(v, str) and "-" in v:
                    m, at = v.split("-", 1); row[PAIRS[k][0]] = _i(m); row[PAIRS[k][1]] = _i(at)
            rows.append(row)
    return rows


def upsert(table, rows, conflict):
    if not KEY or not rows: return 0
    H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=minimal"}
    ok = 0
    for j in range(0, len(rows), 500):
        r = requests.post(f"{SB}/rest/v1/{table}?on_conflict={conflict}", headers=H, json=rows[j:j + 500], timeout=90)
        if r.status_code in (200, 201, 204): ok += len(rows[j:j + 500])
        else: print(f"  ERR {table} {r.status_code}: {r.text[:200]}"); break
    return ok


def main():
    today = min(et_today(), LAST)
    if "--all" in sys.argv: start = FIRST
    else:
        n = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 2
        start = max(FIRST, today - timedelta(days=n - 1))
    if today < FIRST:
        print(f"season starts {FIRST}; nothing to do"); return
    prev = json.loads(OUT.read_text()) if OUT.exists() else {"teams": [], "games": [], "boxed": []}
    T = list(prev["teams"]); tix = {n: i for i, n in enumerate(T)}
    have = {g[0]: g for g in prev["games"]}
    boxed = set(prev.get("boxed", []))
    days = [start + timedelta(days=k) for k in range((today - start).days + 1)]
    with ThreadPoolExecutor(6) as ex: lists = list(ex.map(fetch_day, days))
    rows = [g for L in lists for g in L]
    finals = [g for g in rows if g["final"] and g["home_score"] is not None and g["away_score"] is not None]
    for g in finals:
        for side in ("home", "away"):
            if g[side] not in tix: tix[g[side]] = len(T); T.append(g[side])
        have[g["id"]] = [g["id"], g["date"], tix[g["home"]], tix[g["away"]], g["home_score"], g["away_score"], int(g["neutral"]), int(g["conf_game"])]
    games = sorted(have.values(), key=lambda x: (x[1], x[0]))
    print(f"{len(days)} days · {len(rows)} games listed · {len(finals)} final · {len(games)} results on file")
    # database: every listed game's status/score, then box scores for finals not yet boxed
    if KEY:
        print(f"  games upserted: {upsert('games', [{k: v for k, v in g.items() if k != 'final'} for g in rows], 'id')}")
        todo = [g for g in finals if g["id"] not in boxed]
        with ThreadPoolExecutor(6) as ex: boxes = list(ex.map(parse_box, todo))
        brows = [r for b in boxes if b for r in b]
        n = upsert("box_scores", brows, "game_id,espn_id")
        if n == len(brows): boxed |= {g["id"] for g, b in zip(todo, boxes) if b is not None}
        print(f"  box scores: {len(todo)} new finals → {n} player rows")
    else:
        print("  SUPABASE_SERVICE_KEY not set — results file only (no games / box_scores upload)")
    out = {"season": SEASON, "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "teams": T, "games": games,
           "boxed": sorted(boxed)}
    if out["games"] == prev.get("games") and out["boxed"] == prev.get("boxed", []):
        print("  no change"); return
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"  wrote {OUT}")


if __name__ == "__main__":
    main()
