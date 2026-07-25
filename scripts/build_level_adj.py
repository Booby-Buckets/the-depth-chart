#!/usr/bin/env python3
"""
build_level_adj.py — strength-of-competition adjustment for projection model v5.

A grade-83 built on mid-major production isn't an 83 in the ACC. To kill the last owner
bias (manually burying mid-major transfers), the quality PRIOR that drives minutes + grade
must be discounted by the level a player produced against. Uses our own team ratings: each
conference's strength = mean team Power Rating (SRS) over recent seasons; a player's quality
is discounted by the gap between his conference and the top, converted SRS->grade points.

Writes scripts/data/level_adj.json  { "conf_strength": {conf: srs}, "team_conf": {team: conf},
                                       "top": <max conf srs>, "k": <grade pts per SRS gap> }
Usage: python3 scripts/build_level_adj.py
"""
import urllib.request, json, os
from collections import defaultdict

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
OUT = os.path.join(os.path.dirname(__file__), "data", "level_adj.json")
K = 0.42          # grade points discounted per SRS point of conference gap (calibrated below)
RECENT = range(2022, 2027)


def q_all(path):
    out = []; start = 0
    while True:
        h = dict(H); h["Range-Unit"] = "items"; h["Range"] = f"{start}-{start+999}"
        chunk = json.load(urllib.request.urlopen(urllib.request.Request(SB + "/rest/v1/" + path, headers=h), timeout=60))
        out += chunk
        if len(chunk) < 1000: break
        start += 1000
    return out


def main():
    conf_srs = defaultdict(list)
    team_conf = {}
    for yr in RECENT:
        for t in q_all(f"team_seasons?season_year=eq.{yr}&select=team,conference,srs"):
            c = (t.get("conference") or "").strip()
            try: s = float(t.get("srs"))
            except Exception: s = None
            if not c: continue
            if s is not None: conf_srs[c].append(s)
            team_conf[t["team"]] = c
    strength = {c: round(sum(v) / len(v), 2) for c, v in conf_srs.items() if len(v) >= 8}
    top = max(strength.values())
    adj = {"conf_strength": strength, "team_conf": team_conf, "top": round(top, 2), "k": K}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(adj, open(OUT, "w"))

    def discount(conf):
        s = strength.get(conf)
        return 0.0 if s is None else round(K * (top - s), 1)

    print("Conference strength (mean Power Rating, 2021-26) and grade discount vs the top league:")
    for c, s in sorted(strength.items(), key=lambda kv: -kv[1]):
        print(f"  {c:14} SRS {s:>6}  -> discount {discount(c):>4}")
    print(f"\ntop league SRS = {top}")
    # sanity: a mid-major grade-83 (e.g. Belmont/MVC) should land near a mid-70s ACC-equivalent
    for c in ("MVC", "OVC", "Big Sky", "ACC", "SEC", "Big Ten"):
        if c in strength:
            print(f"  grade-83 in {c}: level-adjusted quality = {round(83 - discount(c),1)}")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
