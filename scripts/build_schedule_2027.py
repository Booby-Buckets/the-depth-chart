#!/usr/bin/env python3
"""
Pull the announced 2026-27 schedule into scripts/data/games_2027.jsonl, then
upload it into the `games` table (season_year=2027, status STATUS_SCHEDULED,
scores null). Re-run any time: rows merge by ESPN id, and once games are
played the same rows pick up scores + STATUS_FINAL, so the team page's
schedule tab shows results trailing into projections.

ESPN's day scoreboard caps FUTURE dates at 50 events, so this walks every
D-I program's own schedule endpoint instead (team ids come from last
season's games). Games ESPN doesn't list yet can be added by hand in
scripts/data/schedule_extras_2027.json (see that file) — the client merges
them in.

  python3 scripts/build_schedule_2027.py pull                 # ESPN → games_2027.jsonl
  python3 scripts/build_schedule_2027.py show "Notre Dame"    # eyeball one team
  SUPABASE_SERVICE_KEY=… python3 scripts/build_schedule_2027.py upload
"""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests

DATA = Path(__file__).parent / "data"
OUT = DATA / "games_2027.jsonl"
SITE = DATA / "schedule_2027.json"     # compact copy the team page reads directly (no DB round-trip)
SEASON = 2027
TEAM_SCHED = ("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/"
              "teams/{id}/schedule?season={yr}&seasontype=2")
# ESPN's edge blocks browser-looking user agents on this API but not a bare one
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0"


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


def _int(x):
    try: return int(x)
    except Exception: return None


def d1_team_ids():
    """{espn team id: name} for every program that played a D-I game last season."""
    ids = {}
    for line in open(DATA / "games.jsonl"):
        g = json.loads(line)
        if (g.get("season") or g.get("season_year")) != SEASON - 1:
            continue
        for side in ("home", "away"):
            if g.get(f"{side}_id"):
                ids[g[f"{side}_id"]] = g[side]
    return ids


def et_date(iso):
    """ESPN gives a UTC timestamp; the game's calendar date is the US-Eastern one (an 8pm PT tip is the
    next day in UTC). November–March is EST (UTC−5)."""
    from datetime import datetime, timedelta
    try:
        t = datetime.strptime(iso.replace("Z", ""), "%Y-%m-%dT%H:%M")
        return (t - timedelta(hours=5)).strftime("%Y-%m-%d")
    except Exception:
        return iso[:10]


def parse_event(e):
    try:
        comp = e["competitions"][0]
        cs = {c["homeAway"]: c for c in comp["competitors"]}
        h, a = cs.get("home"), cs.get("away")
        if not h or not a:
            return None
        return {
            "id": int(e["id"]), "season": SEASON, "date": et_date(e["date"]),
            "home": h["team"]["displayName"], "home_id": _int(h["team"]["id"]), "home_score": _int((h.get("score") or {}).get("value")) if isinstance(h.get("score"), dict) else _int(h.get("score")),
            "away": a["team"]["displayName"], "away_id": _int(a["team"]["id"]), "away_score": _int((a.get("score") or {}).get("value")) if isinstance(a.get("score"), dict) else _int(a.get("score")),
            "neutral": bool(comp.get("neutralSite")),
            "conf_game": bool(comp.get("conferenceCompetition")),
            "status": comp.get("status", {}).get("type", {}).get("name", ""),
            "venue": (comp.get("venue") or {}).get("fullName"),
        }
    except Exception:
        return None


def fetch_team(tid):
    d = get(TEAM_SCHED.format(id=tid, yr=SEASON))
    out = []
    for e in (d or {}).get("events", []):
        g = parse_event(e)
        if g:
            out.append(g)
    return tid, out


def pull():
    ids = d1_team_ids()
    print(f"{len(ids)} D-I programs from {SEASON-1} games")
    seen, rows, empty = set(), [], []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for tid, games in ex.map(fetch_team, sorted(ids)):
            if not games:
                empty.append(ids[tid])
            for g in games:
                if g["id"] in seen:
                    continue
                seen.add(g["id"]); rows.append(g)
    rows.sort(key=lambda g: (g["date"], g["id"]))
    with open(OUT, "w") as f:
        for g in rows:
            f.write(json.dumps(g) + "\n")
    write_site(rows)
    by_status = {}
    for g in rows:
        by_status[g["status"]] = by_status.get(g["status"], 0) + 1
    print(f"{len(rows)} games → {OUT} + {SITE}")
    print("  status:", by_status)
    print(f"  {len(empty)} programs with no schedule yet: {', '.join(sorted(empty)[:12])}{' …' if len(empty) > 12 else ''}")


# ESPN renamed a few programs since the ratings were built — keep the site on the ratings' spelling
NAME_FIX = {"St. Thomas Tommies": "St. Thomas-Minnesota Tommies", "LSU New Orleans Privateers": "New Orleans Privateers"}


def write_site(rows):
    """{teams:[names], games:[[id, date, homeIdx, awayIdx, neutral, conf]]} — ~150KB for the whole season."""
    for g in rows:
        g["home"] = NAME_FIX.get(g["home"], g["home"]); g["away"] = NAME_FIX.get(g["away"], g["away"])
    names = sorted({g["home"] for g in rows} | {g["away"] for g in rows})
    idx = {n: i for i, n in enumerate(names)}
    out = {"season": SEASON, "pulled": time.strftime("%Y-%m-%d"), "teams": names,
           "games": [[g["id"], g["date"], idx[g["home"]], idx[g["away"]], int(g["neutral"]), int(g["conf_game"])] for g in rows]}
    json.dump(out, open(SITE, "w"), separators=(",", ":"))


def show(team):
    team = team.lower()
    for line in open(OUT):
        g = json.loads(line)
        if team in g["home"].lower() or team in g["away"].lower():
            me_home = team in g["home"].lower()
            opp = g["away"] if me_home else g["home"]
            where = "N" if g["neutral"] else ("H" if me_home else "A")
            print(f"{g['date']}  {where}  {opp}")


def upload():
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not key:
        sys.exit("set SUPABASE_SERVICE_KEY (your own terminal only)")
    H = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=minimal"}
    rows = []
    for line in open(OUT):
        g = json.loads(line); g["season_year"] = g.pop("season"); g.pop("venue", None); rows.append(g)
    ok = 0
    for j in range(0, len(rows), 500):
        r = requests.post("https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/games?on_conflict=id",
                          headers=H, json=rows[j:j+500], timeout=90)
        if r.status_code not in (200, 201, 204):
            print("ERR", r.status_code, r.text[:300]); break
        ok += len(rows[j:j+500]); time.sleep(0.05)
    print(f"uploaded {ok}/{len(rows)} rows into games (season_year={SEASON})")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "pull"
    if cmd == "pull": pull()
    elif cmd == "show": show(" ".join(sys.argv[2:]))
    elif cmd == "upload": upload()
    else: sys.exit(__doc__)
