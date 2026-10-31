#!/usr/bin/env python3
"""build_game_compare_ref.py — where a game's numbers sit among real D-I games: data/game_compare_ref.json.

compare-games.html shows each game's pace, scoring, shot mix and possession numbers next to its percentile
among every D-I vs D-I game of one full season, so "fast" or "three-heavy" is the data's word, not ours.
For each number it stores 101 cut points (the 0th..100th percentile) plus the game count.
The numbers are computed exactly the way the page computes them (both teams combined, from box_scores).

    python3 scripts/build_game_compare_ref.py          # last full season (2026 = 2025-26)
    python3 scripts/build_game_compare_ref.py 2025
"""
import json, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "game_compare_ref.json"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
COLS = "game_id,team,starter,fgm,fga,tpm,tpa,ftm,fta,oreb,dreb,ast,tov,pts,player"


def get(path):
    req = urllib.request.Request(SB + path, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def pull(table, query, order):
    # every paginated pull needs a stable ORDER BY or rows silently drop
    out, step = [], 1000
    while True:
        rows = get("%s?%s&order=%s&limit=%d&offset=%d" % (table, query, order, step, len(out)))
        out += rows
        if len(rows) < step: return out


def q(v, xs):
    xs = sorted(x for x in xs if x is not None)
    n = len(xs)
    return [round(xs[min(n - 1, int(round(p / 100 * (n - 1))))], 4) for p in range(101)], n


def main():
    yr = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    games = {g["id"]: g for g in pull("games", "season_year=eq.%d&home_score=not.is.null&select=id,home,away,home_score,away_score" % yr, "id.asc")}
    # by game id in chunks: one big sorted pull of a whole season times out on the server
    ids, box = sorted(games), []
    for i in range(0, len(ids), 150):
        box += pull("box_scores", "game_id=in.(%s)&select=%s" % (",".join(map(str, ids[i:i + 150])), COLS), "game_id.asc,team.asc,player.asc")
        if i % 1500 == 0: print("  box %d/%d games" % (i, len(ids)))
    srs = {r["team"]: float(r["srs"]) for r in get("team_seasons?season_year=eq.%d&srs=not.is.null&select=team,srs" % yr)}
    ot = json.load(open(ROOT / "data" / "game_ot.json"))
    print("%d games, %d box rows, %d power ratings" % (len(games), len(box), len(srs)))
    by = {}
    for r in box: by.setdefault(r["game_id"], {}).setdefault(r["team"], []).append(r)
    K = ["fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "tov", "pts"]
    feats = {k: [] for k in ["pace", "total", "ppp", "margin", "vsExp", "tpr", "efg", "ftr", "tovp", "orebp", "astr", "bench"]}
    for gid, g in games.items():
        teams = by.get(gid, {})
        if len(teams) != 2: continue
        hw = g["home_score"] > g["away_score"]
        W, L = (g["home"], g["away"]) if hw else (g["away"], g["home"])
        if W not in teams or L not in teams: continue
        T = {}
        for n in (W, L):
            t = {k: sum((p.get(k) or 0) for p in teams[n]) for k in K}
            t["bench"] = sum((p.get("pts") or 0) for p in teams[n] if not p.get("starter"))
            T[n] = t
        w, l = T[W], T[L]
        if w["fga"] < 30 or l["fga"] < 30: continue          # partial box scores
        poss = lambda t: t["fga"] + .44 * t["fta"] + t["tov"] - t["oreb"]
        P = (poss(w) + poss(l)) / 2
        ws, ls = max(g["home_score"], g["away_score"]), min(g["home_score"], g["away_score"])
        mins = 40 + 5 * ot.get(str(gid), 0)
        both = lambda f: (f(w, l) + f(l, w)) / 2
        feats["pace"].append(P * 40 / mins)
        feats["total"].append(ws + ls)
        feats["ppp"].append((ws + ls) / (2 * P) * 100)
        feats["margin"].append(ws - ls)
        if W in srs and L in srs: feats["vsExp"].append((ws - ls) - (srs[W] - srs[L]))
        feats["tpr"].append(both(lambda a, b: a["tpa"] / a["fga"]))
        feats["efg"].append(both(lambda a, b: (a["fgm"] + .5 * a["tpm"]) / a["fga"]))
        feats["ftr"].append(both(lambda a, b: a["fta"] / a["fga"]))
        feats["tovp"].append(both(lambda a, b: a["tov"] / poss(a)))
        feats["orebp"].append(both(lambda a, b: a["oreb"] / max(1, a["oreb"] + b["dreb"])))
        feats["astr"].append(both(lambda a, b: a["ast"] / max(1, a["fgm"])))
        feats["bench"].append((w["bench"] + l["bench"]) / max(1, ws + ls))
    out = {"season": yr, "label": "%d-%s" % (yr - 1, str(yr)[2:]), "q": {}, "n": {}}
    for k, xs in feats.items():
        out["q"][k], out["n"][k] = q(k, xs)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(" ".join("%s:%d med=%s" % (k, out["n"][k], out["q"][k][50]) for k in feats))


if __name__ == "__main__":
    main()
