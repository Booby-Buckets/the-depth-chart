#!/usr/bin/env python3
"""Per-team starting-lineup history for the team page's Lineups tab (and the Compare page).

From box_scores (who started, minutes, points per game) + game results (games.jsonl, results_2027.json),
writes one compact file per team: scripts/data/team_lineups/<slug>.json

    {"team": "<ESPN full name>", "p": {key: name}, "s": {season: [game, ...]}}
    game = [game_id, "YYYY-MM-DD", opp, site, my_score, opp_score, [5 starter keys], [[key, min, pts, reb, ast, started], ...]]
    site: "H" home / "A" away / "N" neutral;  scores are null when the result isn't on file.
    key = espn_id as a string, or "n:<name>" when ESPN blanked the id.

Everything else (most common starting five, last 5 / 10, by month, best / worst fives, starter-vs-bench
splits) is computed on the page, so the file stays raw and small. Real 5-man lineup ratings and on/off
come from lineups.json / player_onoff.json, which the page loads separately.

    python3 scripts/build_team_lineups.py                    # default seasons 2019-2026
    python3 scripts/build_team_lineups.py --seasons 2024,2025,2026
"""
import json, os, re, sys, time, urllib.request, urllib.parse
from collections import defaultdict
from pathlib import Path

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"; KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
DATA = Path(__file__).parent / "data"; OUT = DATA / "team_lineups"
DEFAULT = list(range(2019, 2027))


def get(path):
    """paginated GET with a stable ORDER BY (unordered pages silently drop rows)."""
    out, off = [], 0
    while True:
        for i in range(4):
            try:
                r = urllib.request.Request(f"{SB}/rest/v1/{path}&offset={off}&limit=1000", headers=H)
                b = json.load(urllib.request.urlopen(r, timeout=120)); break
            except Exception as e:
                if i == 3: raise
                time.sleep(3 * (i + 1))
        out += b
        if len(b) < 1000: return out
        off += 1000


def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def results():
    R = {}
    for line in open(DATA / "games.jsonl"):
        g = json.loads(line)
        if g.get("home_score") is not None and g.get("away_score") is not None:
            R[str(g["id"])] = g
    p = DATA / "results_2027.json"
    if p.exists():
        try:
            for g in (json.load(open(p)).get("games") or []):
                if g.get("home_score") is not None: R[str(g.get("id"))] = g
        except Exception: pass
    return R


def main():
    seasons = DEFAULT
    if "--seasons" in sys.argv: seasons = [int(x) for x in sys.argv[sys.argv.index("--seasons") + 1].split(",")]
    R = results()
    OUT.mkdir(exist_ok=True)
    # existing files keep the seasons this run doesn't touch
    teams = {}
    for f in OUT.glob("*.json"):
        try: d = json.load(open(f)); teams[d["team"]] = d
        except Exception: pass
    for yr in seasons:
        t0 = time.time()
        # team by team: one sorted whole-season query times out (500) on a table this size
        names = sorted({n for g in R.values() if (g.get("season") or g.get("season_year")) == yr for n in (g.get("home"), g.get("away")) if n})
        rows = []
        for i, tm in enumerate(names):
            rows += get(f"box_scores?select=game_id,date,team,opp,player,espn_id,starter,min,pts,reb,ast&season_year=eq.{yr}&team=eq.{urllib.parse.quote(tm)}&order=game_id.asc,player.asc")
            if (i + 1) % 100 == 0: print(f"  {yr}: {i+1}/{len(names)} teams", flush=True)
        by = defaultdict(lambda: defaultdict(list))
        for r in rows:
            if not r.get("team") or not r.get("game_id"): continue
            by[r["team"]][str(r["game_id"])].append(r)
        n = 0
        for team, games in by.items():
            T = teams.setdefault(team, {"team": team, "p": {}, "s": {}})
            out = []
            for gid, ps in games.items():
                key = lambda r: str(r["espn_id"]) if r.get("espn_id") is not None else "n:" + (r.get("player") or "")
                for r in ps: T["p"][key(r)] = r.get("player") or T["p"].get(key(r), "")
                st = [key(r) for r in ps if r.get("starter")][:5]
                if not st: st = [key(r) for r in sorted(ps, key=lambda r: -(r.get("min") or 0))[:5]]   # no flags at all: top minutes
                g = R.get(gid); site, ms, os_ = None, None, None
                if g:
                    home = g.get("home") == team
                    site = "N" if g.get("neutral") else ("H" if home else "A")
                    ms, os_ = (g["home_score"], g["away_score"]) if home else (g["away_score"], g["home_score"])
                out.append([int(gid), ps[0].get("date"), ps[0].get("opp"), site, ms, os_, st,
                            [[key(r), r.get("min") or 0, r.get("pts") or 0, r.get("reb") or 0, r.get("ast") or 0, 1 if r.get("starter") else 0] for r in ps if (r.get("min") or 0) > 0]])
            out.sort(key=lambda x: (x[1] or "", x[0]))
            T["s"][str(yr)] = out; n += 1
        print(f"{yr}: {len(rows):,} box rows, {n} teams ({time.time()-t0:.0f}s)", flush=True)
    for team, T in teams.items():
        with open(OUT / (slug(team) + ".json"), "w") as f: json.dump(T, f, separators=(",", ":"))
    print(f"wrote {len(teams)} team files to {OUT}")


if __name__ == "__main__":
    main()
