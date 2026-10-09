"""Dynasty: real annual non-conference series (rivalries) from the last six seasons of games.

A pair counts as an annual series when the two programs met in a regular-season non-conference game in at least
4 of the last 6 seasons and are in different conferences in 2026-27. For each series: whether it is usually on a
neutral floor, its usual date (month-day of the latest meeting) and who hosted last. Each program keeps at most its
3 most regular series. -> data/dynasty-rivals.json (the Dynasty engine carries them forward every season).

Usage: python3 scripts/build_dynasty_rivals.py
"""
import json, re, urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "scripts" / "data"
OUT = ROOT / "data" / "dynasty-rivals.json"
KEY = re.search(r"sb_publishable_[A-Za-z0-9_-]+", (ROOT / "player.html").read_text()).group(0)
API = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"
SEASONS = list(range(2021, 2027))


def sb(q):
    out, off = [], 0
    while True:   # stable ORDER BY or pages skip / repeat rows
        r = json.load(urllib.request.urlopen(urllib.request.Request(
            API + q + f"&order=id&limit=1000&offset={off}", headers={"apikey": KEY, "Authorization": "Bearer " + KEY}), timeout=90))
        out += r
        if len(r) < 1000: return out
        off += 1000


def main():
    members = json.load(open(D / "conf_members_2027.json"))["teams"]
    conf = {}
    for k, v in members.items():
        if isinstance(v, dict): conf[v.get("full") or k] = v.get("conf")
        else: conf[k] = v
    snap = json.load(open(ROOT / "data" / "dynasty-snapshot.json"))
    names = {t["name"]: t["conf"] for t in snap["teams"]}
    post = set()
    for y in SEASONS:
        post |= {g["id"] for g in sb(f"postseason_games?select=id&season_year=eq.{y}")}
    seasons, neutral, last = defaultdict(set), defaultdict(int), {}
    for y in SEASONS:
        for g in sb(f"games?select=id,season_year,date,home,away,neutral,conf_game&season_year=eq.{y}&conf_game=eq.false"):
            if g["id"] in post or g["home"] not in names or g["away"] not in names: continue
            if names[g["home"]] == names[g["away"]]: continue
            md = g["date"][5:]
            if "03-08" <= md <= "10-31": continue                       # postseason / CBI-type games
            k = tuple(sorted((g["home"], g["away"])))
            seasons[k].add(y)
            if g["neutral"]: neutral[k] += 1
            if k not in last or g["date"] > last[k][0]: last[k] = (g["date"], g["home"], g["neutral"])
    pairs = [(k, len(s)) for k, s in seasons.items() if len(s) >= 4]
    pairs.sort(key=lambda x: (-x[1], -max(seasons[x[0]])))
    per, out = defaultdict(int), []
    for (a, b), n in pairs:
        if per[a] >= 3 or per[b] >= 3: continue
        per[a] += 1; per[b] += 1
        d, home, neu = last[(a, b)]
        out.append([a, b, 1 if neutral[(a, b)] * 2 >= n else 0, d[5:], None if neu else home, n])
    json.dump({"_doc": "annual non-conference series: [teamA, teamB, neutral, usual MM-DD, last host, seasons met of 6]", "pairs": out},
              open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
    print(len(out), "series ->", OUT)
    for p in out[:25]: print(" ", p)


if __name__ == "__main__":
    main()
