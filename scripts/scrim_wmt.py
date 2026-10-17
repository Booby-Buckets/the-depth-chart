#!/usr/bin/env python3
"""
scrim_wmt.py — box scores for preseason scrimmages played by WMT-platform schools (Auburn, Georgia, Kentucky,
LSU, Tennessee, Florida State …), whose athletics sites have no Sidearm box-score page for scrim_boxes.py to read.

WMT Live Stats keeps every game's player lines in a public JSON API (api.wmt.games, no robots rules, no auth):
  /api/statistics/teams?school_id=<NCAA org id>      → a school's teams by season (paged)
  /api/statistics/teams/<team id>/games              → that team's games (date, competitors, scores, home team)
  /api/statistics/games/<game id>/players            → every player's line by period (period 0 = the game)
  /api/statistics/teams/<team id>                    → name_tabular ("Florida St.") = our school_sites "ncaa"

Team ids live in scripts/data/wmt_teams_2027.json ({team id: ESPN full name}). It starts from a few seeds and
grows on its own: every WMT game lists both teams' ids, so an opponent we scrimmage gets added when its name
matches school_sites_2027.json. For each played scrimmage with no box score (a hand-entered score included) the
game is found on a known team's schedule by date and written in the same shape scrim_boxes.py writes, so the
scrimmage page, Reality Meter and trends read it unchanged. Display only, like every scrimmage stat.

Usage:  python3 scripts/scrim_wmt.py [--dry] [--force]
"""
import json, re, sys, time, datetime, functools, urllib.request, urllib.parse
print = functools.partial(print, flush=True)
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
GAMES = DATA / "scrimmages_2027.json"
RES = DATA / "scrimmage_results_2027.json"
SITES = DATA / "school_sites_2027.json"
MAP = DATA / "wmt_teams_2027.json"
API = "https://api.wmt.games/api/statistics"
SEASON = 2027

def get(path, quiet=False):
    url = path if path.startswith("http") else API + path
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "the-depth-chart/1.0 (+https://www.thedepthchartcbb.com)", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            if i == 2 or "404" in str(e):
                if not quiet: print(f"  !! {url}: {e}")
                return None
            time.sleep(2 * (i + 1))

def norm(s):
    s = (s or "").lower().replace("&", "and").replace("st.", "state").replace("'", "")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

_TEAM, _GAMES = {}, {}
def team_name(tid):
    if tid not in _TEAM:
        d = get(f"/teams/{tid}", quiet=True); _TEAM[tid] = ((d or {}).get("data") or {})   # 404 = another sport's team
    return _TEAM[tid]

def team_games(tid):
    if tid not in _GAMES:
        d = get(f"/teams/{tid}/games"); _GAMES[tid] = (d or {}).get("data") or []
    return _GAMES[tid]

def i(v): return int(round(v)) if isinstance(v, (int, float)) else 0

def line(st):
    """a WMT statistic dict → our box-line fields (minutes come in seconds)"""
    oreb, reb = i(st.get("sOffensiveRebounds")), i(st.get("sTotalRebounds"))
    dreb = i(st.get("sDefensiveRebounds")) if st.get("sDefensiveRebounds") is not None else max(0, reb - oreb)
    return {"min": i((st.get("sMinutesPlayed") or 0) / 60), "fgm": i(st.get("sFieldGoalsMade")), "fga": i(st.get("sFieldGoalsAttempted")),
            "tpm": i(st.get("sThreePointFieldGoalsMade")), "tpa": i(st.get("sThreePointFieldGoalsAttempted")),
            "ftm": i(st.get("sFreeThrowsMade")), "fta": i(st.get("sFreeThrowsAttempted")), "oreb": oreb, "dreb": dreb, "reb": reb,
            "pf": i(st.get("sPersonalFouls")), "ast": i(st.get("sAssists")), "tov": i(st.get("sTurnovers")),
            "blk": i(st.get("sBlockedShots")), "stl": i(st.get("sSteals")), "pts": i(st.get("sPoints"))}

def game_total(stats):
    for s in stats or []:
        if s.get("period") == 0: return s.get("statistic") or {}
    tot = {}   # no period-0 row: add the periods up
    for s in stats or []:
        for k, v in (s.get("statistic") or {}).items():
            if k.startswith("s") and isinstance(v, (int, float)) and not k.endswith(("Pct", "Percent", "PerGame", "Avg", "Efficiency")):
                tot[k] = tot.get(k, 0) + v
    return tot

def main():
    dry, force = "--dry" in sys.argv, "--force" in sys.argv
    G = json.loads(GAMES.read_text()); games = G["games"]
    res = json.loads(RES.read_text()); R = res["results"]
    sites = json.loads(SITES.read_text())
    wmap = {int(k): v for k, v in json.loads(MAP.read_text()).get("teams", {}).items()} if MAP.exists() else {}
    by_full = {v: k for k, v in wmap.items()}
    by_ncaa = {}
    for full, rec in sites.items():
        for nm in (rec.get("ncaa"), re.sub(r"\s+\S+$", "", full)):
            if nm: by_ncaa.setdefault(norm(nm), full)
    in_scrims = {t for g in games for t in (g["home"], g["away"])}
    today = datetime.date.today().isoformat()
    todo = [g for g in games if g["date"] <= today and (force or not R.get(g["id"], {}).get("box"))]
    print(f"{len(todo)} played scrimmages without a box score; {len(wmap)} WMT teams known")

    def learn(tid):
        """add a WMT team we scrimmage to the map from its name"""
        if tid in wmap: return
        t = team_name(tid)
        if t.get("sport_code") != "MBB" or t.get("season_academic_year") != SEASON: return
        full = by_ncaa.get(norm(t.get("name_tabular")))
        if full and full in in_scrims and full not in by_full:
            wmap[tid] = full; by_full[full] = tid; print(f"  + learned {full} = WMT team {tid}")

    # grow the map: every known team's games list its opponents' WMT team ids
    scrim_dates = {g["date"] for g in games}
    for tid in list(wmap):
        for wg in team_games(tid):
            if (wg.get("game_date") or "")[:10] not in scrim_dates: continue   # only exhibition opponents matter
            for c in wg.get("competitors") or []:
                if c.get("teamId"): learn(c["teamId"])

    got = 0
    for g in todo:
        tid = by_full.get(g["home"]) or by_full.get(g["away"])
        if not tid: continue
        wg = next((x for x in team_games(tid) if (x.get("game_date") or "")[:10] == g["date"] and x.get("is_exhibition") is not False), None)
        if not wg:
            print(f"  -- {g['date']} {g['away']} at {g['home']}: not on WMT team {tid}'s schedule"); continue
        comps = wg.get("competitors") or []
        if len(comps) != 2 or any(c.get("score") is None for c in comps):
            print(f"  -- {g['date']} {g['away']} at {g['home']}: no final on WMT yet"); continue
        d = get(f"/games/{wg['id']}/players"); players = (d or {}).get("data") or []
        if not players:
            print(f"  -- {g['date']} {g['away']} at {g['home']}: WMT game {wg['id']} has no player lines yet"); continue
        mine_is_home = by_full.get(g["home"]) == tid
        # which competitor is our listed home team: the mapped team's own teamId, else the other one
        c_mine = next(c for c in comps if c.get("teamId") == tid)
        c_other = next(c for c in comps if c is not c_mine)
        side_of = {c_mine["teamId"]: "home" if mine_is_home else "away", c_other["teamId"]: "away" if mine_is_home else "home"}
        full_of = {"home": g["home"], "away": g["away"]}
        box = {}
        for c in comps:
            sd = side_of[c["teamId"]]
            pl = []
            for p in players:
                if p.get("team_id") != c["teamId"]: continue
                ln = line(game_total(p.get("statistic")))
                pl.append(dict({"name": p.get("xml_name") or p.get("xml_short_name"), "no": str(p.get("xml_uni") or ""), "gs": bool(p.get("games_started"))}, **ln))
            tot = line(game_total(c.get("teamStats")))
            tot.pop("min", None)
            box[sd] = {"team": full_of[sd], "players": pl, "totals": tot}
            # one team's feed only (e.g. LSU's lines from McNeese's floor): the thin side is partial so the
            # Reality Meter, trends and depth charts skip it, but the page still shows what's there
            if sum(1 for q in pl if q["min"] > 0) < 5 or sum(q["min"] for q in pl) < 150: box[sd]["partial"] = True
        hs, as_ = (c_mine["score"], c_other["score"]) if mine_is_home else (c_other["score"], c_mine["score"])
        rec = R.get(g["id"], {})
        if rec.get("hs") is not None and (rec["hs"], rec["as"]) != (hs, as_):
            print(f"  !! {g['id']}: stored {rec['hs']}-{rec['as']} vs WMT {hs}-{as_}; keeping WMT")
        rec.update({"hs": hs, "as": as_, "box": box, "wmt": wg["id"],
                    "src": rec.get("src") or f"{API}/games/{wg['id']}"})
        rec.pop("partial", None)
        R[g["id"]] = rec; got += 1
        print(f"  ok {g['date']} {g['away']} {as_} at {g['home']} {hs}  ({len(box['home']['players'])}+{len(box['away']['players'])} players, WMT {wg['id']})")

    if dry: print(f"[dry] {got} box scores; nothing written"); return
    MAP.write_text(json.dumps({"note": "WMT Live Stats team ids for 2026-27 men's basketball (scripts/scrim_wmt.py). Grows on its own from opponents of known teams.",
                               "teams": {str(k): v for k, v in sorted(wmap.items())}}, indent=1))
    if got:
        RES.write_text(json.dumps(res, indent=1))
    print(f"{got} box scores from WMT")

if __name__ == "__main__":
    main()
