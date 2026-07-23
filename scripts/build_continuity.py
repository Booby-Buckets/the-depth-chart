#!/usr/bin/env python3
"""
build_continuity.py — Continuity Index for the 2026-27 projection.

"Minutes continuity" = the share of a team's 2025-26 minutes that RETURN on its
2026-27 roster. High continuity teams tend to over-perform their raw talent
(chemistry / system familiarity), especially early; it's a standard projection
signal (Torvik-style).

  returning_min = sum of 2025-26 minutes for players who are BOTH on the 2026-27
                  roster AND played for that same school last year
  continuity    = returning_min / (that school's total 2025-26 minutes)

Join by espn_id throughout, so the recurring short-vs-full team-name mismatch
(players.team = "Houston", bbref.school = "Houston Cougars") never bites: each
roster player's 2025-26 school comes from their own bbref row.

Reads bbref_seasons (2026) + players (anon key, read-only). Writes:
  data/continuity.json  { <short team>: {continuity, returners, retMin, totMin, full} }

  python3 scripts/build_continuity.py
"""
import json, os, urllib.request
from collections import defaultdict

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
OUT = os.path.join(os.path.dirname(__file__), os.pardir, "data")


def get(path):
    out = []; frm = 0
    while True:
        h = {**HDR, "Range-Unit": "items", "Range": "%d-%d" % (frm, frm + 999)}
        req = urllib.request.Request(SB + "/rest/v1/" + path, headers=h)
        b = json.load(urllib.request.urlopen(req, timeout=90))
        out += b
        if len(b) < 1000: break
        frm += 1000
    return out


def mp_of(adv):
    try: return float((adv or {}).get("mp") or 0)
    except Exception: return 0.0


def main():
    print("Continuity Index — 2026-27", flush=True)
    # 2025-26 minutes: per player (by espn_id) + per school total
    bb = get("bbref_seasons?season_year=eq.2026&espn_id=not.is.null&select=espn_id,school,advanced")
    min_by_eid = {}          # espn_id -> (school, minutes) last season
    school_min = defaultdict(float)
    for r in bb:
        m = mp_of(r.get("advanced"))
        if not r.get("school"): continue
        min_by_eid[r["espn_id"]] = (r["school"], m)
        school_min[r["school"]] += m
    print("  %d bbref 2025-26 players, %d schools" % (len(min_by_eid), len(school_min)), flush=True)

    # 2026-27 rosters
    roster = get("players?select=team,espn_id,name&team=not.is.null")
    by_team = defaultdict(list)
    for p in roster:
        if p.get("team"): by_team[p["team"]].append(p)
    print("  %d roster teams" % len(by_team), flush=True)

    out = {}
    for short, players in by_team.items():
        # a returner: on this roster AND played for the SAME school in 2025-26.
        # Resolve the team's full school as the majority school among players who
        # have a last-year row (handles the short/full name gap via espn_id).
        schools = defaultdict(float)
        for p in players:
            info = min_by_eid.get(p.get("espn_id"))
            if info: schools[info[0]] += 1
        if not schools: continue
        full = max(schools, key=schools.get)
        tot = school_min.get(full, 0.0)
        if tot <= 0: continue
        ret_min = 0.0; returners = []
        for p in players:
            info = min_by_eid.get(p.get("espn_id"))
            if info and info[0] == full and info[1] > 0:
                ret_min += info[1]; returners.append(p.get("name"))
        cont = round(100 * ret_min / tot, 1)
        out[short] = {"continuity": cont, "returners": len(returners),
                      "retMin": round(ret_min), "totMin": round(tot), "full": full}

    # national percentile
    vals = sorted(v["continuity"] for v in out.values())
    n = len(vals)
    for v in out.values():
        below = sum(1 for x in vals if x < v["continuity"])
        v["pct"] = round(100 * below / n) if n else 50

    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, "continuity.json"), "w"), separators=(",", ":"))
    print("  wrote %d teams" % len(out), flush=True)

    rank = sorted(out.items(), key=lambda kv: -kv[1]["continuity"])
    print("\n  MOST continuity (returning minutes):")
    for s, v in rank[:8]:
        print("    %5.1f%%  %-22s (%d returners, %d/%d min)" % (v["continuity"], s, v["returners"], v["retMin"], v["totMin"]))
    print("\n  LEAST continuity (rebuilt rosters):")
    for s, v in rank[-6:]:
        print("    %5.1f%%  %-22s (%d returners)" % (v["continuity"], s, v["returners"]))


if __name__ == "__main__":
    main()
