#!/usr/bin/env python3
"""
build_amplifier.py — the "Lineup Amplifier" predictive identifier.

Turns the raw team on/off splits (scripts/data/player_onoff.json) into a clean,
sample-aware per-player score for the player-page / predictive-profile scorecard:
how much a team's net efficiency (points per 100 possessions) swings with a player
ON the floor vs OFF it — and WHERE that swing comes from (offense vs defense).

Raw on/off is notoriously noisy: it is measured RELATIVE to a player's own
teammates, and a tiny off-court sample can manufacture a huge (meaningless) swing.
So we:
  1. qualify only players with a real sample both ways (on>=300, off>=200 poss),
  2. clamp the raw swing to +-35 (kills garbage-time blowout artifacts),
  3. shrink toward 0 by off-court sample size  adj = raw * off/(off+K), K=300
     (a 200-poss off sample keeps 40%% of its swing; a 1200-poss sample ~80%%),
  4. percentile-rank the shrunk swing across all qualified players so it reads
     "vs the field", not as a raw number nobody can calibrate.

We also decompose the swing into an OFFENSIVE part (on_o - off_o) and a DEFENSIVE
part (off_d - on_d, positive = the team defends better with him on) so the card can
say *where* he moves the needle — the kind of thing a coach plans rotations around.

Output: scripts/data/player_amplifier.json  { generated, season, k, min_on,
min_off, n, players:{ espn_id: {amp,pct,raw,on_net,off_net,off_swing,def_swing,
games,on_poss,off_poss,conf} } }.  Keyed by espn_id (string), name fallback "n:<lower>".

Usage: python3 build_amplifier.py [season]   (default 2026)
"""
import json, os, sys, bisect, datetime

D = os.path.join(os.path.dirname(__file__), "data")
SEASON = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
MIN_ON, MIN_OFF, K, CAP = 300, 200, 300, 35

def main():
    raw = json.load(open(os.path.join(D, "player_onoff.json")))
    rows = raw.get(str(SEASON), [])
    q = [p for p in rows
         if p.get("onoff_net") is not None
         and (p.get("on_poss") or 0) >= MIN_ON
         and (p.get("off_poss") or 0) >= MIN_OFF]

    def clamp(v, lo, hi): return max(lo, min(hi, v))
    for p in q:
        off = p["off_poss"]
        p["_adj"] = clamp(p["onoff_net"], -CAP, CAP) * off / (off + K)

    adj_sorted = sorted(p["_adj"] for p in q)
    n = len(adj_sorted)
    def pct(v): return round(bisect.bisect_left(adj_sorted, v) / max(1, n - 1) * 100)

    def num(x): return None if x is None else round(x, 1)
    players = {}
    for p in q:
        on_o, off_o = p.get("on_o"), p.get("off_o")
        on_d, off_d = p.get("on_d"), p.get("off_d")
        off_swing = round(on_o - off_o, 1) if (on_o is not None and off_o is not None) else None
        def_swing = round(off_d - on_d, 1) if (on_d is not None and off_d is not None) else None
        rec = {
            "amp": round(p["_adj"], 1),
            "pct": pct(p["_adj"]),
            "raw": num(p["onoff_net"]),
            "on_net": num(p.get("on_net")),
            "off_net": num(p.get("off_net")),
            "off_swing": off_swing,          # offense: team ORTG change with him on
            "def_swing": def_swing,          # defense: team DRTG improvement with him on (+ = better D)
            "games": p.get("games"),
            "on_poss": p.get("on_poss"),
            "off_poss": p.get("off_poss"),
            "conf": "high" if p["off_poss"] >= 500 else "med",
        }
        # key by espn_id (what every page fetches on); name key only when it's missing
        key = str(p["espn_id"]) if p.get("espn_id") not in (None, "") else "n:" + (p.get("name") or "").lower().strip()
        players[key] = rec

    out = {
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "season": SEASON, "k": K, "min_on": MIN_ON, "min_off": MIN_OFF, "cap": CAP,
        "n": n, "players": players,
    }
    path = os.path.join(D, "player_amplifier.json")
    json.dump(out, open(path, "w"), separators=(",", ":"))
    print("wrote %s — %d qualified players (season %d)" % (path, n, SEASON))
    top = sorted(q, key=lambda x: -x["_adj"])[:5]
    for p in top:
        print("  +%.1f (pct %d) %s / %s" % (p["_adj"], pct(p["_adj"]), p["name"], p["team"]))

if __name__ == "__main__":
    main()
