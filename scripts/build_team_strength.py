#!/usr/bin/env python3
"""build_team_strength.py — ship per-season team strength (SRS z-score) so the grade
engine can DAMPEN empty-calorie box stats: big production on a weak team is discounted.

team_seasons.srs (Power Rating) covers 2007-2026. We z-score SRS within each season and
key it by the SHORT team name that players actually carry (players.team / player_history
.team), mapped from the full "Name Mascot" string. The map MUST be collision-free: a wrong
negative would penalize a good player, while a miss is harmless (z=0 → no dampening). So we
map each full name to the LONGEST short-name prefix, and REJECT the match when the leftover
after the short name contains a different-school marker (A&M / State / Southern / …) — that
stops "Alabama A&M Bulldogs" from ever overwriting "Alabama" (Crimson Tide). Ambiguous keys
(two schools → one short in a season) are dropped, not guessed.

The dampener is DAMPEN-ONLY (weak teams pull a positive archetype bonus down; strong/average
teams and non-positive bonuses do nothing), so it never inflates.

Output: scripts/data/team_strength.json = {"z": {season_year: {short_lower: z}}}
"""
import os, json, sys, importlib.util, re
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location("ag", os.path.join(HERE, "archetype_grades.py"))
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
D = os.path.join(HERE, "data")

# leftover (after the short name) that signals a DIFFERENT school, not a mascot → reject match
MARKER = re.compile(r"(a&m|a&t|\bstate\b|southern|atlantic|christian|international|"
                    r"\bvalley\b|\bgulf\b|baptist|wesleyan|pine bluff|corpus|el paso|"
                    r"chattanooga|\bam\b|&|-| of )", re.I)


def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def build_vocab():
    v = set()
    for tbl in ("players?select=team&team=not.is.null",
                "player_history?select=team&team=not.is.null&mpg=gte.5"):
        for r in ag.get(tbl, ""):
            n = norm(r.get("team"))
            if n and n != "—":
                v.add(n)
    return sorted(v, key=len, reverse=True)   # longest first → longest-prefix wins


def short_for(full, vocab):
    fl = norm(full)
    for s in vocab:                            # longest short-name that prefixes the full name
        if fl == s:
            return s
        if fl.startswith(s + " "):
            leftover = fl[len(s) + 1:]
            if MARKER.search(leftover):        # leftover names a different school → not a match
                return None
            return s
    return None


def main():
    vocab = build_vocab()
    print("short-name vocab from players/player_history:", len(vocab))
    rows = ag.get("team_seasons?select=season_year,team,srs&srs=not.is.null", "")
    by_yr = {}
    for r in rows:
        by_yr.setdefault(r["season_year"], []).append(r)
    Z, dropped = {}, 0
    for yr, rs in by_yr.items():
        srs = np.array([r["srs"] for r in rs], float)
        m, s = float(srs.mean()), float(srs.std() or 1.0)
        d, seen = {}, {}
        for r in rs:
            sn = short_for(r["team"], vocab)
            if sn is None:
                continue
            z = round((r["srs"] - m) / s, 3)
            if sn in seen and seen[sn] != r["team"]:   # two schools → same short: ambiguous, drop it
                d.pop(sn, None); dropped += 1; continue
            seen[sn] = r["team"]; d[sn] = z
        Z[str(yr)] = d
    path = os.path.join(D, "team_strength.json")
    json.dump({"metric": "srs_z", "seasons": sorted(Z.keys()), "z": Z}, open(path, "w"))
    sz = os.path.getsize(path)
    print("wrote %s (%.0f KB) — %d seasons, %d matched team-seasons, %d ambiguous dropped"
          % (path, sz / 1024, len(Z), sum(len(v) for v in Z.values()), dropped))
    z26 = Z.get("2026", {})
    for t in ["alabama", "florida", "texas", "vanderbilt", "duke", "maryland"]:
        print("  2026 %-11s z=%s" % (t, z26.get(t)))


if __name__ == "__main__":
    main()
