#!/usr/bin/env python3
"""
Build team-season records + conference membership.

Records, conference W-L, and ppg/oppg are COMPUTED from games.jsonl (no extra
scraping). Conference NAME per team-season comes from ESPN's standings tree (one
request per season) — which also gives every conference's member list per season.

  python3 scrape_team_seasons.py            # -> data/team_seasons.jsonl
"""
import json, time
from collections import defaultdict
from pathlib import Path
import cloudscraper

DATA = Path(__file__).parent / "data"
GAMES = DATA / "games.jsonl"
OUT = DATA / "team_seasons.jsonl"
STAND = ("https://site.web.api.espn.com/apis/v2/sports/basketball/"
         "mens-college-basketball/standings?season={yr}&level=3")
S = cloudscraper.create_scraper(browser={"browser":"chrome","platform":"darwin","mobile":False})


def conf_map(yr):
    """{team_id: conference_name} for a season, from the standings tree."""
    out = {}
    try:
        d = S.get(STAND.format(yr=yr), timeout=30).json()
        for c in d.get("children", []):
            if not c.get("isConference"):
                continue
            name = c.get("name")
            ent = (c.get("standings") or {}).get("entries", [])
            for e in ent:
                tid = e.get("team", {}).get("id")
                if tid:
                    out[int(tid)] = name
    except Exception:
        pass
    return out


def main():
    # accumulate records from games
    rec = defaultdict(lambda: {"team": None, "w": 0, "l": 0, "cw": 0, "cl": 0, "pf": 0, "pa": 0})
    seasons = set()
    for line in GAMES.read_text().splitlines():
        try:
            g = json.loads(line)
        except Exception:
            continue
        if g.get("status") != "STATUS_FINAL" or g.get("home_score") is None or g.get("away_score") is None:
            continue
        yr = g["season"]; seasons.add(yr)
        hs, as_ = g["home_score"], g["away_score"]
        for side, tid, name, pf, pa in [("home", g["home_id"], g["home"], hs, as_),
                                        ("away", g["away_id"], g["away"], as_, hs)]:
            if tid is None:
                continue
            r = rec[(yr, tid)]
            r["team"] = name
            won = pf > pa
            r["w" if won else "l"] += 1
            if g.get("conf_game"):
                r["cw" if won else "cl"] += 1
            r["pf"] += pf; r["pa"] += pa
    # conference names per season
    cmaps = {}
    for yr in sorted(seasons):
        cmaps[yr] = conf_map(yr)
        print(f"  {yr}: {len(cmaps[yr])} teams mapped to conferences", flush=True)
        time.sleep(0.2)
    # emit
    n = 0
    with open(OUT, "w") as f:
        for (yr, tid), r in rec.items():
            gp = r["w"] + r["l"]
            f.write(json.dumps({
                "season": yr, "team": r["team"], "team_id": tid,
                "conference": cmaps.get(yr, {}).get(tid),
                "wins": r["w"], "losses": r["l"],
                "conf_wins": r["cw"], "conf_losses": r["cl"],
                "ppg": round(r["pf"]/gp, 1) if gp else None,
                "oppg": round(r["pa"]/gp, 1) if gp else None,
            }) + "\n")
            n += 1
    print(f"DONE: {n} team-seasons -> {OUT}")


if __name__ == "__main__":
    main()
