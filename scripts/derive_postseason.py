#!/usr/bin/env python3
"""
Derive per-team-season postseason achievements from postseason.jsonl and attach
them to team_seasons.jsonl: NCAA seed + how far they advanced, conference-tournament
result (champion / runner-up / round), and a one-line postseason summary.

  python3 derive_postseason.py
"""
import json
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).parent / "data"

NCAA_ROUNDS = ["1st Round","2nd Round","Sweet 16","Elite Eight","Final Four","National Championship"]
# round a team REACHED when it LOST that round's game
LOST_AT = {"1st Round":"Round of 64","2nd Round":"Round of 32","Sweet 16":"Sweet 16",
           "Elite Eight":"Elite Eight","Final Four":"Final Four","National Championship":"Runner-Up"}
# round a team REACHED when it WON that round's game (edge cases / champion)
WON_AT  = {"1st Round":"Round of 32","2nd Round":"Sweet 16","Sweet 16":"Elite Eight",
           "Elite Eight":"Final Four","Final Four":"Runner-Up","National Championship":"Champion"}
CONF_ROUNDS = ["First Round","1st Round","Quarterfinal","Second Round","Semifinal","Final","Championship"]


def is_conf(t):
    return t not in ("NCAA Tournament","NIT","CBI","CIT")


def ncaa_outcome(games, tid):
    g = sorted([x for x in games if x["round"] in NCAA_ROUNDS],
               key=lambda x: NCAA_ROUNDS.index(x["round"]))
    if not g:
        return None, None
    last = g[-1]
    won = last["winner_id"] == tid
    seed = last["home_seed"] if last["home_id"] == tid else last["away_seed"]
    res = (WON_AT if won else LOST_AT).get(last["round"], "Round of 64")
    return res, seed


def bracket_outcome(games, tid, kind):
    """champion / runner-up / round reached for a conf tourney, NIT, CBI, CIT."""
    if not games:
        return None
    def rk(x): return CONF_ROUNDS.index(x["round"]) if x["round"] in CONF_ROUNDS else -1
    g = sorted(games, key=rk)
    last = g[-1]
    won = last["winner_id"] == tid
    final = last["round"] in ("Final","Championship")
    if final:
        return "Champion" if won else "Runner-Up"
    return f"{last['round']}"


def main():
    by_team = defaultdict(lambda: defaultdict(list))   # (season,tid) -> tournament -> games
    confname = {}
    for l in (DATA/"postseason.jsonl").read_text().splitlines():
        try: r = json.loads(l)
        except Exception: continue
        for side in ("home", "away"):
            tid = r[side+"_id"]
            by_team[(r["season"], tid)][r["tournament"]].append(r)
        if is_conf(r["tournament"]):
            confname[r["tournament"]] = r["tournament"]

    derived = {}
    for (season, tid), tours in by_team.items():
        d = {"ncaa_seed": None, "ncaa_result": None, "conf_tourney": None,
             "conf_champ": False, "postseason": None}
        # NCAA
        if "NCAA Tournament" in tours:
            res, seed = ncaa_outcome(tours["NCAA Tournament"], tid)
            d["ncaa_result"] = res; d["ncaa_seed"] = seed
        # conference tournament (the non-national bracket this team played)
        for t, games in tours.items():
            if is_conf(t):
                cr = bracket_outcome(games, tid, t)
                d["conf_tourney"] = cr   # 'Champion','Runner-Up','Semifinal'... (conference field gives context)
                if cr == "Champion": d["conf_champ"] = True
        # one-line summary (most prestigious)
        if d["ncaa_result"]:
            d["postseason"] = f"NCAA {d['ncaa_result']}" + (f" (#{d['ncaa_seed']} seed)" if d["ncaa_seed"] else "")
        elif "NIT" in tours:
            d["postseason"] = "NIT " + (bracket_outcome(tours["NIT"], tid, "NIT") or "")
        elif "CBI" in tours:
            d["postseason"] = "CBI " + (bracket_outcome(tours["CBI"], tid, "CBI") or "")
        elif "CIT" in tours:
            d["postseason"] = "CIT " + (bracket_outcome(tours["CIT"], tid, "CIT") or "")
        elif d["conf_champ"]:
            d["postseason"] = "Conf Tournament Champion"
        derived[(season, tid)] = d

    rows = []
    for l in (DATA/"team_seasons.jsonl").read_text().splitlines():
        try: t = json.loads(l)
        except Exception: continue
        d = derived.get((t["season"], t["team_id"]))
        if d: t.update(d)
        rows.append(t)
    with open(DATA/"team_seasons.jsonl", "w") as f:
        for t in rows: f.write(json.dumps(t) + "\n")
    print(f"attached postseason to {sum(1 for t in rows if t.get('postseason'))} of {len(rows)} team-seasons")

    print("\n2024 NCAA bracket sample:")
    for t in sorted([t for t in rows if t["season"]==2024 and t.get("ncaa_result")],
                    key=lambda x: (x.get("ncaa_seed") or 99))[:8]:
        print(f"  #{t.get('ncaa_seed')} {t['team'][:22]:22s} -> {t['ncaa_result']}")
    print("conf champions 2024:", [t["team"] for t in rows if t["season"]==2024 and t.get("conf_champ")][:8])


if __name__ == "__main__":
    main()
