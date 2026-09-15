#!/usr/bin/env python3
"""Backfill shot LOCATIONS for past seasons from collegebasketballdata.com (CBBD).

ESPN only logged coordinates for a minority of games before 2024-25 (2023: 0-17%),
but CBBD's play feed carries x/y for most games from 2018-19 on (measured on a
mid-January date: 2019 31%, 2020 73%, 2021 84%, 2022 85%, 2023 92%, 2024-25 96%;
nothing before 2018-19). Plays keep ESPN ids (play sourceId, game sourceId, team
and athlete sourceId), so rows drop straight into our `shots` table.

Two phases so the API quota (X-CallLimit ~1000/month on the free key) is spent once:

  1. pull   -- one /plays/date call per UTC day of the season, cached to
               scripts/data/cbbd_cache/<date>.json.gz (+ one roster + one teams call).
               Needs CBBD_KEY (env or prompt). Re-runs cost nothing.
  2. upload -- rebuilds rows from the cache and POSTs them to Supabase with
               resolution=ignore-duplicates, so anything ESPN already gave us is kept.
               Needs SUPABASE_SERVICE_KEY (owner runs this in their own shell).

  CBBD_KEY=... python3 scripts/build_shots_cbbd.py pull 2025 2024 2023
  SUPABASE_SERVICE_KEY=... python3 scripts/build_shots_cbbd.py upload 2025
  python3 scripts/build_shots_cbbd.py stats 2025      # coverage from the cache, no network

Coordinate frame (fit on Belmont 2024-25, 3,790 FGA): CBBD x/y are tenths of a foot
on the FULL court (94 x 50), hoops at (52.5, 250) and (887.5, 250); the 3PT flag
agrees with a 22.15 ft arc for 99.6% of shots under that frame. We store ESPN's
frame: x across the court (25 = rim), y feet out from the rim.
"""
import gzip, json, math, os, re, sys, time, datetime as dt, urllib.request, urllib.parse, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "data", "cbbd_cache")
API = "https://api.collegebasketballdata.com"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
ANON = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
DELAY = 0.6

def cbbd_key():
    k = (os.environ.get("CBBD_KEY") or "").strip()
    if not k:
        k = input("CBBD API key (free at collegebasketballdata.com/key): ").strip()
    if not k: sys.exit("no CBBD key")
    return k

def api(path, key, **q):
    url = API + path + "?" + urllib.parse.urlencode(q)
    for a in range(5):
        try:
            req = urllib.request.Request(url, headers={"Authorization": "Bearer " + key, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=300) as r:
                rem = r.headers.get("X-CallLimit-Remaining")
                return json.loads(r.read().decode()), rem
        except urllib.error.HTTPError as e:
            if e.code in (401, 403): sys.exit("CBBD rejected the key (%d)" % e.code)
            if e.code == 429: print("  rate-limited, sleeping 60s", flush=True); time.sleep(60); continue
            print("  http %d, retry" % e.code, flush=True); time.sleep(5 * (a + 1))
        except Exception as ex:
            print("  %s, retry" % type(ex).__name__, flush=True); time.sleep(5 * (a + 1))
    raise SystemExit("gave up on " + url)

def cpath(name): return os.path.join(CACHE, name + ".json.gz")
def cget(name):
    p = cpath(name)
    if os.path.exists(p):
        with gzip.open(p, "rt") as f: return json.load(f)
    return None
def cput(name, obj):
    os.makedirs(CACHE, exist_ok=True)
    tmp = cpath(name) + ".tmp"
    with gzip.open(tmp, "wt") as f: json.dump(obj, f)
    os.replace(tmp, cpath(name))

def cached(name, fetch):
    v = cget(name)
    if v is None:
        v, rem = fetch()
        cput(name, v)
        print("  %s  (%d items, %s calls left)" % (name, len(v), rem), flush=True)
        time.sleep(DELAY)
    return v

# ── season calendar: our games table (public) gives the local game dates; the CBBD
#    date endpoint is UTC, so a local date D lives on UTC days D and D+1.
def season_dates(season):
    dates = set(); off = 0
    H = {"apikey": ANON, "Authorization": "Bearer " + ANON}
    while True:
        url = SB + "/rest/v1/games?select=date&season_year=eq.%d&order=id&limit=1000&offset=%d" % (season, off)
        rows = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60).read())
        for r in rows:
            if r.get("date"): dates.add(r["date"][:10])
        if len(rows) < 1000: break
        off += 1000
    if not dates: sys.exit("no games in our table for %d" % season)
    d0 = dt.date.fromisoformat(min(dates)); d1 = dt.date.fromisoformat(max(dates)) + dt.timedelta(days=1)
    out = []; d = d0
    while d <= d1:
        out.append(d.isoformat()); d += dt.timedelta(days=1)
    return out

# ── shot text → type bucket (mirrors scrape_shots.shot_type; CBBD playText is ESPN's)
def shot_type(txt):
    t = (txt or "").lower()
    if "tip" in t: return "tip"
    if "dunk" in t: return "dunk"
    if "floating" in t or "floater" in t: return "floater"
    if "hook" in t: return "hook"
    if "pullup" in t or "pull up" in t or "pull-up" in t: return "pullup"
    if "step back" in t or "stepback" in t or "step-back" in t: return "stepback"
    if "fadeaway" in t or "fade away" in t: return "fadeaway"
    if "layup" in t or "lay up" in t or "lay-up" in t or "layin" in t or "lay in" in t: return "layup"
    return "jumper"

def to_espn_xy(x, y):
    """CBBD full-court tenths-of-feet → ESPN half-court feet (x across, 25=rim; y out from rim)."""
    if x < 470: return round(y / 10.0, 1), round((x - 52.5) / 10.0, 1)
    return round((500 - y) / 10.0, 1), round((887.5 - x) / 10.0, 1)

def to_int(v):
    try: return int(v)
    except Exception: return None

def rows_for(season, plays, ath, team):
    out = []; seen = set()
    for p in plays:
        si = p.get("shotInfo")
        if not si or si.get("range") == "free_throw": continue
        loc = si.get("location") or {}
        if loc.get("x") is None or loc.get("y") is None: continue
        pid = to_int(p.get("sourceId")); gid = to_int(p.get("gameSourceId"))
        if pid is None or gid is None or pid in seen: continue
        seen.add(pid)
        ex, ey = to_espn_xy(float(loc["x"]), float(loc["y"]))
        sv = p.get("scoreValue") or (3 if si["range"] == "three_pointer" else 2)
        shooter = (si.get("shooter") or {}).get("id")
        ab = si.get("assistedBy") or {}
        out.append({
            "id": pid, "game_id": gid, "season_year": season,
            "espn_id": ath.get(shooter), "team_id": team.get(p.get("teamId")),
            "x": ex, "y": ey, "made": bool(si.get("made")), "sv": int(sv),
            "dist": int(round(math.hypot(ex - 25, ey))),
            "period": p.get("period"), "sec_left": p.get("secondsRemaining"),
            "home_score": p.get("homeScore"), "away_score": p.get("awayScore"),
            "stype": shot_type(p.get("playText")),
            "ast_id": ath.get(ab.get("id")) if si.get("assisted") else None,
            "ast_name": ab.get("name") if si.get("assisted") else None,
        })
    return out

def id_maps(season):
    teams = cget("teams") or []
    roster = cget("roster_%d" % season) or []
    team = {t["id"]: to_int(t.get("sourceId")) for t in teams}
    ath = {}
    for t in roster:
        for pl in t.get("players") or []:
            e = to_int(pl.get("sourceId"))
            if e: ath[pl["id"]] = e
    return ath, team

def season_plays(season):
    for d in season_dates(season):
        v = cget("plays_" + d)
        if v: yield from v

# ── phases
def pull(season, key):
    print("== pull %d" % season, flush=True)
    cached("teams", lambda: api("/teams", key))
    cached("roster_%d" % season, lambda: api("/teams/roster", key, season=season))
    dates = season_dates(season)
    print("  %d UTC days %s → %s" % (len(dates), dates[0], dates[-1]), flush=True)
    for d in dates:
        cached("plays_" + d, lambda d=d: api("/plays/date", key, date=d, shootingPlaysOnly="true"))
    stats(season)

def stats(season):
    ath, team = id_maps(season)
    n = m = 0; games = {}; unmapped = 0; seen = set()
    for p in season_plays(season):
        si = p.get("shotInfo")
        if not si or si.get("range") == "free_throw": continue
        # a game that straddles midnight UTC comes back on both days; count each play once
        if p.get("sourceId") in seen: continue
        seen.add(p.get("sourceId"))
        n += 1; g = games.setdefault(p["gameId"], [0, 0]); g[1] += 1
        if (si.get("location") or {}).get("x") is not None:
            m += 1; g[0] += 1
            if (si.get("shooter") or {}).get("id") not in ath: unmapped += 1
    full = sum(1 for a, b in games.values() if a >= 0.95 * b); none = sum(1 for a, b in games.values() if a == 0)
    print("  %d: %d FGA, %d with x/y (%.0f%%); %d games: %d full, %d none; %d located shots w/o ESPN athlete id" %
          (season, n, m, 100.0 * m / max(n, 1), len(games), full, none, unmapped), flush=True)

def upload(season):
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not key: sys.exit("Set SUPABASE_SERVICE_KEY (service key; owner only) to upload.")
    H = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json",
         "Prefer": "resolution=ignore-duplicates"}
    ath, team = id_maps(season)
    rows = rows_for(season, season_plays(season), ath, team)
    print("== upload %d: %d rows" % (season, len(rows)), flush=True)
    RETRY = {408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524}
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        for a in range(8):
            try:
                req = urllib.request.Request(SB + "/rest/v1/shots?on_conflict=id", data=json.dumps(chunk).encode(),
                                             method="POST", headers=H)
                urllib.request.urlopen(req, timeout=180).read(); break
            except urllib.error.HTTPError as e:
                if e.code in RETRY: time.sleep(8 * (a + 1)); continue
                sys.exit("upload http %d: %s" % (e.code, e.read()[:200]))
            except Exception as ex:
                time.sleep(6 * (a + 1))
        else:
            sys.exit("upload gave up at row %d" % i)
        if (i // 500) % 100 == 0: print("  %d / %d" % (i, len(rows)), flush=True)
    print("  done %d" % season, flush=True)

def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ("pull", "upload", "stats"):
        sys.exit(__doc__)
    phase = sys.argv[1]; seasons = [int(s) for s in sys.argv[2:]]
    key = cbbd_key() if phase == "pull" else None
    for s in seasons:
        {"pull": lambda: pull(s, key), "upload": lambda: upload(s), "stats": lambda: stats(s)}[phase]()

if __name__ == "__main__":
    main()
