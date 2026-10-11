#!/usr/bin/env python3
"""
build_wowy_player.py — the player page's On/Off tab reads two small files made from the WOWY builds
(scripts/data/wowy_<season>.json + wowy_units_<season>.json, see build_wowy.py), so it never downloads
the 6 MB unit files:

  wowy_index.json            { espn_id: [seasons with on/off data, newest first] }
  wowy_pairs_<season>.json   { espn_id: [[partner_id, partner_name, minutes, net, net_luck, off, def], ...] }
                             his two-man units (him + one teammate), most minutes first, top 8

Offline, seconds. Run after build_wowy.py (the build-wowy workflow does).
"""
import json, os, glob, re

D = os.path.join(os.path.dirname(__file__), "data")

def main():
    index = {}
    for fp in sorted(glob.glob(os.path.join(D, "wowy_[0-9][0-9][0-9][0-9].json"))):
        season = int(re.search(r"(\d{4})\.json$", fp).group(1))
        P = json.load(open(fp))
        for p in P.get("players", []):
            index.setdefault(str(p["id"]), []).append(season)
        up = os.path.join(D, f"wowy_units_{season}.json")
        if not os.path.exists(up): continue
        U = json.load(open(up)); names = U.get("names", {})
        pairs = {}
        for team, by in (U.get("units") or {}).items():
            for u in by.get("2", []):
                a, b = u["ids"]; r = u["r"]
                for me, mate in ((a, b), (b, a)):
                    pairs.setdefault(me, []).append([mate, names.get(mate), r.get("min"), r.get("net"), r.get("netl"), r.get("o"), r.get("d")])
        for k in pairs:
            pairs[k].sort(key=lambda x: -(x[2] or 0)); pairs[k] = pairs[k][:8]
        json.dump(pairs, open(os.path.join(D, f"wowy_pairs_{season}.json"), "w"), separators=(",", ":"))
        print(f"{season}: {len(pairs)} players with pairs")
    for k in index: index[k] = sorted(set(index[k]), reverse=True)
    json.dump(index, open(os.path.join(D, "wowy_index.json"), "w"), separators=(",", ":"))
    print(f"index: {len(index)} players")

if __name__ == "__main__":
    main()
