#!/usr/bin/env python3
"""
build_roster_inputs.py — assemble the per-team roster facts the roster-report
generator (roster_reports.workflow.js) reasons over.

For every team with a roster it writes, keyed by team name:
  { coach, conf, players: [ {d(epth), pos, name, grade, ppg,rpg,apg,mpg, tp_pct,
    ts_pct, fg_pct, ft_pct, stl, blk, tovs, usage, bpm, height, class, transfer_from} ] }
Players are ordered by depth_order (the user's authored chart — starters 1-5, bench 6+).

Output: scripts/data/roster_inputs.json   (read-only public anon key; no writes)
Run:    python3 scripts/build_roster_inputs.py
"""
import urllib.request, urllib.parse, json, os
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
OUT = os.path.join(os.path.dirname(__file__), "data", "roster_inputs.json")

PSEL = ("name,position,depth_order,tdc_grade,ppg,rpg,apg,mpg,tp_pct,three_pct,ts_pct,"
        "usage_pct,bpm,fg_pct,ft_pct,stl,blk,tovs,height,class_year,yr,hometown,is_injured")


def q(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(SB + "/rest/v1/" + path, headers=H), timeout=60))


def main():
    # all teams that have players (distinct team from a paginated player pull)
    players = []
    start = 0
    while True:
        h = dict(H); h["Range-Unit"] = "items"; h["Range"] = f"{start}-{start+999}"
        chunk = json.load(urllib.request.urlopen(
            urllib.request.Request(SB + "/rest/v1/players?select=team&name=neq.%E2%80%94", headers=h), timeout=60))
        players += chunk
        if len(chunk) < 1000: break
        start += 1000
    teams = sorted({p["team"] for p in players if p.get("team")})

    tinfo = {t["name"]: t for t in q("teams?select=name,head_coach,coach,conference,conf")}
    out = {}
    for tm in teams:
        rows = q(f"players?team=eq.{urllib.parse.quote(tm)}&select={PSEL}&order=depth_order.asc")
        rows = [r for r in rows if r.get("name") and r["name"] != "—"]
        if not rows: continue
        ti = tinfo.get(tm, {})
        roster = []
        for r in rows:
            hw = (r.get("hometown") or "").strip()
            roster.append({
                "d": r.get("depth_order"), "pos": r.get("position"), "name": r["name"],
                "grade": r.get("tdc_grade"), "ppg": r.get("ppg"), "rpg": r.get("rpg"),
                "apg": r.get("apg"), "mpg": r.get("mpg"),
                "tp_pct": r.get("tp_pct") or r.get("three_pct"), "ts_pct": r.get("ts_pct"),
                "fg_pct": r.get("fg_pct"), "ft_pct": r.get("ft_pct"),
                "stl": r.get("stl"), "blk": r.get("blk"), "tovs": r.get("tovs"),
                "usage": r.get("usage_pct"), "bpm": r.get("bpm"),
                "height": r.get("height"), "class": r.get("yr") or r.get("class_year"),
                "transfer_from": hw if (hw and "," not in hw) else None,
                "injured": bool(r.get("is_injured")),
            })
        out[tm] = {"coach": ti.get("head_coach") or ti.get("coach"),
                   "conf": ti.get("conf") or ti.get("conference"), "players": roster}
    json.dump(out, open(OUT, "w"))
    print(f"wrote {len(out)} team roster inputs -> {OUT}")


if __name__ == "__main__":
    main()
