#!/usr/bin/env python3
"""Extract a slim per-team efficiency file for the homepage rankings table.

team_dna.json is ~4MB (full four-factors + evolution + percentiles). The index only
needs ORtg / DRtg / net per team per season, so we emit a ~380KB slim file keyed
{season_year: {full_team_name: {o, d, net}}}. Re-run this whenever team_dna.json is
rebuilt so the index stays in sync.

    python3 scripts/build_team_eff.py
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "scripts", "data", "team_dna.json")
OUT = os.path.join(ROOT, "scripts", "data", "team_eff.json")


def main():
    dna = json.load(open(SRC))
    slim = {}
    for yr, blk in dna.items():
        if not isinstance(blk, dict):
            continue
        teams = blk.get("teams", {})
        out = {}
        for name, v in teams.items():
            if isinstance(v, dict) and "ORtg" in v and "DRtg" in v:
                out[name] = {
                    "o": round(v["ORtg"], 1),
                    "d": round(v["DRtg"], 1),
                    "net": round(v.get("net", v["ORtg"] - v["DRtg"]), 1),
                }
        if out:
            slim[yr] = out
    json.dump(slim, open(OUT, "w"), separators=(",", ":"))
    total = sum(len(v) for v in slim.values())
    print("wrote %s — %d seasons, %d team-seasons, %d bytes"
          % (OUT, len(slim), total, os.path.getsize(OUT)))


if __name__ == "__main__":
    main()
