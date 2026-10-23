#!/usr/bin/env python3
"""
Scrape NBA player data from ESPN's public JSON APIs — the NBA half of the
college → NBA comparison work.

Why ESPN (not Basketball-Reference): we moved off Sports-Reference scraping
(ToS risk, see the SR migration), and ESPN uses ONE athlete id across leagues —
a player's NBA espn_id is the same id as his college espn_id in box_scores /
player_history. So every NBA row joins to our college data with no name matching.

Phases (each resumable — rerun to pick up where it stopped):
  1. games    — every game (regular season, play-in, playoffs): full box score.
                One row per player-game (min/pts/fg/3p/ft/oreb/dreb/ast/stl/blk/tov/pf/+-,
                starter, DNP reason) + one row per game with both teams' totals.
                This is also how players are enumerated: ESPN's "team-season roster"
                endpoint returns TODAY's roster for recent seasons, so it misses
                anyone traded/waived/retired. Box scores catch everyone who appeared.
                ~1,320 games/season.
  2. bio      — per player: DOB, height, weight, hand, draft slot, college.
  3. seasons  — per player-season x {regular, postseason}: ESPN's ~110 season stats
                (per-48, TS%/eFG%, PER, RPM, +/-…). NOTE usageRate is 0 for recent
                seasons — derive USG ourselves from box + team totals.
  4. teams    — per team-season: ESPN team season totals (regular season).
  5. draft    — every pick, each draft (draft year = season year). The draft athlete
                record links to the COLLEGE athlete id, so picks who never played an
                NBA game (the busts box scores can't see) are still joinable.

  ESPN DATA HOLE: every CHI and NO game 2013-2018 has an all-zero box (players AND team
  totals; their per-player gamelogs skip those games too) — but the season totals in
  phases 3/4 are intact. build_nba_bridge.py falls back to them where box under-counts.

  python3 scrape_nba.py --seasons 2025              # pilot one season
  python3 scrape_nba.py                             # 2008-2026, all phases
  python3 scrape_nba.py --phases bio,seasons        # skip games

Outputs (scripts/data/, gitignored):
  nba_games.jsonl  nba_box.jsonl  nba_players.jsonl  nba_seasons.jsonl
Season years are the END year of the season (2026 = 2025-26), same as our CBB tables.
Then load with load_nba.py (owner runs it — needs the service key).
"""
import argparse, json, sys, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import requests

DATA = Path(__file__).parent / "data"
F_GAMES = DATA / "nba_games.jsonl"
F_BOX = DATA / "nba_box.jsonl"
F_PLAYERS = DATA / "nba_players.jsonl"
F_SEASONS = DATA / "nba_seasons.jsonl"
F_TEAMS = DATA / "nba_team_seasons.jsonl"
F_DRAFT = DATA / "nba_draft.jsonl"

CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba"
SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
TYPES = {2: "regular", 3: "postseason"}
GAME_TYPES = {2: "regular", 5: "playin", 3: "postseason"}

RATE = 8.0            # max requests/sec across all threads (ESPN is tolerant; stay polite)
WORKERS = 16           # requests are latency-bound (~5s summaries), not rate-bound
S = requests.Session()
S.headers["User-Agent"] = "Mozilla/5.0 (thedepthchart research)"
_lock = threading.Lock()
_next = [0.0]


def _throttle():
    with _lock:
        now = time.monotonic()
        wait = _next[0] - now
        _next[0] = max(now, _next[0]) + 1.0 / RATE
    if wait > 0:
        time.sleep(wait)


def get(url, tries=5):
    """JSON or None (404 = legitimately absent, e.g. a season the player sat out)."""
    for i in range(tries):
        _throttle()
        try:
            r = S.get(url, timeout=30)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 404:
                return None
            if r.status_code in (429, 503):
                time.sleep(20 * (i + 1)); continue
        except Exception:
            pass
        time.sleep(3 + 3 * i)
    print(f"  GAVE UP {url}", flush=True)
    return None


def read_jsonl(p):
    if not p.exists():
        return []
    out = []
    for l in p.read_text().splitlines():
        try: out.append(json.loads(l))
        except Exception: pass
    return out


class Writer:
    def __init__(self, p):
        self.f = open(p, "a"); self.l = threading.Lock()
    def __call__(self, row):
        with self.l:
            self.f.write(json.dumps(row, separators=(",", ":")) + "\n"); self.f.flush()


def ref_id(ref):
    return ref.split("?")[0].rstrip("/").split("/")[-1]


def pool(jobs, fn, label):
    n, t0 = len(jobs), time.time()
    print(f"[{label}] {n} to fetch", flush=True)
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = [ex.submit(fn, j) for j in jobs]
        for i, f in enumerate(as_completed(futs), 1):
            try: f.result()
            except Exception as e: print(f"  ERR {e}", flush=True)
            if i % 250 == 0 or i == n:
                el = time.time() - t0
                print(f"  {label} {i}/{n}  ({el/60:.1f}m, eta {(n-i)*el/i/60:.1f}m)", flush=True)


# ---------- 1. games / box scores ----------
BOX_COLS = {"MIN": "min", "PTS": "pts", "REB": "reb", "AST": "ast", "TO": "tov", "STL": "stl",
            "BLK": "blk", "OREB": "oreb", "DREB": "dreb", "PF": "pf", "+/-": "pm"}
PAIR_COLS = {"FG": ("fgm", "fga"), "3PT": ("fg3m", "fg3a"), "FT": ("ftm", "fta")}


def _num(v):
    try: return int(str(v).replace("+", ""))
    except Exception:
        try: return float(v)
        except Exception: return None


def parse_line(names, vals):
    out = {}
    for n, v in zip(names, vals):
        if n in PAIR_COLS:
            m, _, a = str(v).partition("-")
            out[PAIR_COLS[n][0]], out[PAIR_COLS[n][1]] = _num(m), _num(a)
        elif n in BOX_COLS:
            out[BOX_COLS[n]] = _num(v)
    return out


def phase_games(seasons):
    done = {r["game_id"] for r in read_jsonl(F_GAMES) if not r.get("missing")}  # retry failures
    wg, wb = Writer(F_GAMES), Writer(F_BOX)
    jobs = []
    for y in seasons:
        for t, tname in GAME_TYPES.items():
            page = 1
            while True:
                d = get(f"{CORE}/seasons/{y}/types/{t}/events?limit=1000&page={page}") or {}
                for it in d.get("items", []):
                    gid = ref_id(it["$ref"])
                    if gid not in done:
                        jobs.append((y, tname, gid))
                if page >= (d.get("pageCount") or 1): break
                page += 1

    def one(job):
        y, tname, gid = job
        d = get(f"{SITE}/summary?event={gid}")
        if not d:
            wg({"game_id": gid, "season": y, "season_type": tname, "missing": True}); return
        comp = (d.get("header") or {}).get("competitions", [{}])[0]
        sides = {c.get("homeAway"): c for c in comp.get("competitors", [])}
        abbr = {c["team"]["id"]: c["team"].get("abbreviation") for c in comp.get("competitors", [])}
        teams = {}
        for t in (d.get("boxscore") or {}).get("teams", []):
            teams[t["team"].get("abbreviation")] = {x["name"]: x.get("displayValue") for x in t.get("statistics", [])}
        n = 0
        for tb in (d.get("boxscore") or {}).get("players", []):
            ta = tb["team"].get("abbreviation")
            opp = next((v for k, v in abbr.items() if v != ta), None)
            home = (sides.get("home") or {}).get("team", {}).get("abbreviation") == ta
            for blk in tb.get("statistics", []):
                names = blk.get("names") or blk.get("labels") or []
                for a in blk.get("athletes", []):
                    ath = a.get("athlete") or {}
                    row = {"game_id": gid, "season": y, "season_type": tname,
                           "date": (comp.get("date") or "")[:10] or None,
                           "espn_id": ath.get("id"), "name": ath.get("displayName"),
                           "pos": (ath.get("position") or {}).get("abbreviation"),
                           "team": ta, "opp": opp, "home": home,
                           "starter": bool(a.get("starter")),
                           # "--" minutes + all-zero line = sat (older games don't flag DNP)
                           "dnp": bool(a.get("didNotPlay")) or not a.get("stats")
                                  or (str(a["stats"][0]).strip() in ("--", "")
                                      and not any(_num(v) for v in a["stats"][1:])),
                           "reason": a.get("reason") if a.get("didNotPlay") else None,
                           "ejected": bool(a.get("ejected"))}
                    if a.get("stats"):
                        row.update(parse_line(names, a["stats"]))
                    wb(row); n += 1
        wg({"game_id": gid, "season": y, "season_type": tname,
            "date": (comp.get("date") or "")[:10] or None,
            "neutral": comp.get("neutralSite"),
            "home": (sides.get("home") or {}).get("team", {}).get("abbreviation"),
            "away": (sides.get("away") or {}).get("team", {}).get("abbreviation"),
            "home_score": _num((sides.get("home") or {}).get("score")),
            "away_score": _num((sides.get("away") or {}).get("score")),
            "team_stats": teams, "player_rows": n})
    pool(jobs, one, "games")


def player_index(seasons):
    """{espn_id: {season: [teams]}} — everyone who logged minutes, from box scores."""
    idx = {}
    for r in read_jsonl(F_BOX):
        if r.get("espn_id") and not r.get("dnp") and r["season"] in seasons:
            ts = idx.setdefault(r["espn_id"], {}).setdefault(r["season"], [])
            if r["team"] not in ts: ts.append(r["team"])
    return idx


# ---------- 2. bio ----------
def phase_bio(idx):
    # re-fetch rows from before college_athlete_id existed (readers keep the last row per id)
    done = {r["espn_id"] for r in read_jsonl(F_PLAYERS) if "college_athlete_id" in r or r.get("missing")}
    w = Writer(F_PLAYERS)
    jobs = [a for a in idx if a not in done]

    def one(aid):
        a = get(f"{CORE}/athletes/{aid}")
        if not a:
            w({"espn_id": aid, "missing": True}); return
        d = a.get("draft") or {}
        col = a.get("college") or {}
        college = get(col["$ref"]) if col.get("$ref") else None
        w({
            "espn_id": aid,
            "name": a.get("displayName"),
            "first_name": a.get("firstName"), "last_name": a.get("lastName"),
            "dob": (a.get("dateOfBirth") or "")[:10] or None,
            "height_in": a.get("height"), "weight": a.get("weight"),
            "pos": (a.get("position") or {}).get("abbreviation"),
            "hand": (a.get("hand") or {}).get("abbreviation"),
            "birthplace": a.get("birthPlace"),
            "college": (college or {}).get("name"),
            "college_espn_id": ref_id(col["$ref"]) if col.get("$ref") else None,
            "played_college": bool(a.get("collegeAthlete")),
            # the player's COLLEGE espn_id. Same as espn_id for recent players, but ESPN
            # kept separate college/NBA ids for most who left school before ~2016.
            "college_athlete_id": ref_id(a["collegeAthlete"]["$ref"]) if (a.get("collegeAthlete") or {}).get("$ref") else None,
            "draft_year": d.get("year"), "draft_round": d.get("round"),
            "draft_pick": d.get("selection"),
            "draft_team_id": ref_id(d["team"]["$ref"]) if isinstance(d.get("team"), dict) and d["team"].get("$ref") else None,
            "draft_display": d.get("displayText"),
            "debut_year": a.get("debutYear"),
            "experience": (a.get("experience") or {}).get("years"),
            "active": a.get("active"),
            "headshot": (a.get("headshot") or {}).get("href"),
        })
    pool(jobs, one, "bio")


def flat_stats(d):
    out = {}
    for c in ((d or {}).get("splits") or {}).get("categories") or []:
        for st in c.get("stats", []):
            v = st.get("value")
            if v is not None:
                out[st["name"]] = round(v, 4) if isinstance(v, float) else v
    return out


# ---------- 4. team season totals ----------
def phase_teams(seasons):
    done = {(r["season"], r["team_id"]) for r in read_jsonl(F_TEAMS)}
    w = Writer(F_TEAMS)
    jobs = []
    for y in seasons:
        for t in (get(f"{CORE}/seasons/{y}/teams?limit=50") or {}).get("items", []):
            tid = ref_id(t["$ref"])
            if (y, tid) not in done: jobs.append((y, tid))

    def one(job):
        y, tid = job
        team = get(f"{CORE}/seasons/{y}/teams/{tid}") or {}
        w({"season": y, "team_id": tid, "team": team.get("abbreviation"),
           "team_name": team.get("displayName"),
           "stats": flat_stats(get(f"{CORE}/seasons/{y}/types/2/teams/{tid}/statistics")) or None})
    pool(jobs, one, "teams")


# ---------- 5. draft ----------
def phase_draft(seasons):
    done = {(r["draft_year"], r["overall"]) for r in read_jsonl(F_DRAFT)}
    w = Writer(F_DRAFT)
    jobs = []
    for y in seasons:
        for rd in (get(f"{CORE}/seasons/{y}/draft/rounds") or {}).get("items", []):
            for pk in rd.get("picks", []):
                if (y, pk.get("overall")) not in done:
                    jobs.append((y, pk))

    def one(job):
        y, pk = job
        a = get(pk["athlete"]["$ref"]) if (pk.get("athlete") or {}).get("$ref") else {}
        a = a or {}
        ath = (a.get("athlete") or {}).get("$ref") or ""
        team = (a.get("team") or {}).get("$ref") or ""
        w({"draft_year": y, "overall": pk.get("overall"), "round": pk.get("round"), "pick": pk.get("pick"),
           "nba_team_id": ref_id(pk["team"]["$ref"]) if (pk.get("team") or {}).get("$ref") else None,
           "name": a.get("displayName"),
           # the athlete ref points into the league he was drafted FROM
           "college_athlete_id": ref_id(ath) if "mens-college-basketball" in ath else None,
           "athlete_ref_league": ath.split("/leagues/")[1].split("/")[0] if "/leagues/" in ath else None,
           "college_team_id": ref_id(team) if "mens-college-basketball" in team else None,
           "height_in": a.get("height"), "weight": a.get("weight"),
           "dob": (a.get("dateOfBirth") or "")[:10] or None})
    pool(jobs, one, "draft")


# ---------- 3. season stats ----------
def phase_seasons(idx):
    done = {(r["espn_id"], r["season"], r["season_type"]) for r in read_jsonl(F_SEASONS)}
    w = Writer(F_SEASONS)
    jobs = [(aid, y, t) for aid, ys in idx.items() for y in ys for t in TYPES
            if (aid, y, TYPES[t]) not in done]

    def one(job):
        aid, y, t = job
        d = get(f"{CORE}/seasons/{y}/types/{t}/athletes/{aid}/statistics")
        cats = ((d or {}).get("splits") or {}).get("categories") or []
        stats = {}
        for c in cats:
            for s in c.get("stats", []):
                v = s.get("value")
                if v is not None:
                    stats[s["name"]] = round(v, 4) if isinstance(v, float) else v
        # marker row on no data (no playoffs) so reruns skip it
        w({"espn_id": aid, "season": y, "season_type": TYPES[t],
           "teams": idx[aid][y], "stats": stats or None})
    pool(jobs, one, "seasons")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", default="2008-2026", help="e.g. 2025 or 2008-2026")
    ap.add_argument("--phases", default="games,bio,seasons,teams")
    a = ap.parse_args()
    lo, _, hi = a.seasons.partition("-")
    seasons = list(range(int(lo), int(hi or lo) + 1))
    phases = a.phases.split(",")
    DATA.mkdir(exist_ok=True)
    print(f"NBA scrape: seasons {seasons[0]}-{seasons[-1]}, phases {phases}", flush=True)

    if "games" in phases:
        phase_games(seasons)
    idx = player_index(set(seasons))
    print(f"  {len(idx)} players, {sum(len(v) for v in idx.values())} player-seasons", flush=True)
    if "bio" in phases: phase_bio(idx)
    if "seasons" in phases: phase_seasons(idx)
    if "teams" in phases: phase_teams(seasons)
    if "draft" in phases: phase_draft(seasons)
    print("done.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
