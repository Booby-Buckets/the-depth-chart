#!/usr/bin/env python3
"""
build_prop_form.py — this season's form for TDC Bet's prop pricing (bet/bet-edge.js).

Per player, from the 2026-27 box scores so far: games played, minutes, the spread of his minutes, and stat
totals. The edge board blends this with our preseason projection (prop_model.json's k_prior minutes of
projection per player), so a player's line follows what he's actually doing as the season goes.

Writes scripts/data/prop_form_2027.json  {built, season, players: {espn_id: {g, min, sdm, tot:{pts,reb,ast,tpm}, l5:{...}}}}
Off-season (no games yet) it writes an empty player map and exits 0. Run nightly after the results ingest.
"""
import json, os, urllib.request, urllib.parse, datetime
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
SEASON = 2027
STATS = ["pts", "reb", "ast", "tpm"]


def get(path):
    req = urllib.request.Request(SB + "/rest/v1/" + path, headers=HDR)
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(req, timeout=90))
        except Exception:
            if attempt == 3:
                raise


def main():
    teams = sorted(json.load(open(os.path.join(DATA, "bet_trends_teams.json")))["teams"])
    by = defaultdict(list)
    for t in teams:
        rows = get("box_scores?season_year=eq.%d&team=eq.%s&select=espn_id,date,game_id,min,pts,reb,ast,tpm&limit=3000" % (SEASON, urllib.parse.quote(t))) or []
        for r in rows:
            if r.get("espn_id") is None or not r.get("min"):
                continue
            by[str(r["espn_id"])].append(r)
    out = {}
    for pid, gs in by.items():
        gs.sort(key=lambda r: (r["date"], r["game_id"]))
        mins = [int(r["min"]) for r in gs]
        n = len(mins); m = sum(mins) / n
        sdm = (sum((x - m) ** 2 for x in mins) / max(1, n - 1)) ** 0.5 if n > 1 else None
        last = gs[-5:]
        out[pid] = {"g": n, "min": sum(mins), "sdm": round(sdm, 1) if sdm is not None else None,
                    "tot": {s: sum(r.get(s) or 0 for r in gs) for s in STATS},
                    "l5": {"min": sum(int(r["min"]) for r in last), "g": len(last), "tot": {s: sum(r.get(s) or 0 for r in last) for s in STATS}}}
    payload = {"built": datetime.date.today().isoformat(), "season": SEASON, "players": out}
    path = os.path.join(DATA, "prop_form_%d.json" % SEASON)
    try:
        old = json.load(open(path))
    except Exception:
        old = None
    if old and old.get("players") == out:
        print("prop form unchanged (%d players)" % len(out)); return
    json.dump(payload, open(path, "w"), separators=(",", ":"))
    print("prop form: %d players with 2026-27 games" % len(out))


if __name__ == "__main__":
    main()
