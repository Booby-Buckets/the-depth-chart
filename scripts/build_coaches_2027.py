#!/usr/bin/env python3
"""
2026-27 head coaches: data/coach-2027.json (the conference page's coach table for the projected season).

Starts from last season's staff (data/coach-2026.json) and applies the 2026 coaching carousel
(scripts/data/coach_changes_2026.json — every D-I head-coach change, researched: school, old/new coach,
new coach's previous job, source). A new coach who has a D-I head-coaching record keeps his career id, so
his career grade shows; a first-time head coach is marked new with his previous job. Every row is put in
its 2026-27 league (scripts/data/conf_members_2027.json).

  python3 scripts/build_coaches_2027.py
"""
import json, re, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "scripts" / "data"
# the conference page's full league names (conf-logos.js TDC_CONF_CODE)
CONF_FULL = {'ACC': 'Atlantic Coast Conference', 'B10': 'Big Ten Conference', 'BIG-12': 'Big 12 Conference', 'Big-East': 'Big East Conference',
    'SEC': 'Southeastern Conference', 'PAC-12': 'Pac-12 Conference', 'A10': 'Atlantic 10 Conference', 'AAC': 'American Conference',
    'AEC': 'America East Conference', 'ASUN': 'Atlantic Sun Conference', 'Big Sky': 'Big Sky Conference', 'Big South': 'Big South Conference',
    'Big West': 'Big West Conference', 'CAA': 'Coastal Athletic Association', 'CUSA': 'Conference USA', 'Horizon': 'Horizon League',
    'Ivy': 'Ivy League', 'MAAC': 'Metro Atlantic Athletic Conference', 'MAC': 'Mid-American Conference', 'MEAC': 'Mid-Eastern Athletic Conference',
    'MVC': 'Missouri Valley Conference', 'MWC': 'Mountain West Conference', 'NEC': 'Northeast Conference', 'OVC': 'Ohio Valley Conference',
    'Patriot': 'Patriot League', 'SWAC': 'Southwestern Athletic Conference', 'SoCon': 'Southern Conference', 'Southland': 'Southland Conference',
    'Summit': 'Summit League', 'Sun Belt': 'Sun Belt Conference', 'UAC': 'United Athletic Conference', 'WCC': 'West Coast Conference'}
ALIAS = {'nc state': 'NC State Wolfpack', 'fiu': 'Florida International Panthers', 'louisiana-monroe': 'UL Monroe Warhawks',
         'ut rio grande valley': 'UT Rio Grande Valley Vaqueros', 'kansas city': 'Kansas City Roos', 'charleston': 'Charleston Cougars',
         'little rock': 'Little Rock Trojans', 'california baptist': 'California Baptist Lancers', 'west florida': 'West Florida',
         'north carolina': 'North Carolina Tar Heels', 'san diego': 'San Diego Toreros'}


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]", " ", s.replace("&", " and ").replace("'", "")).split()


def main():
    rows = json.load(open(ROOT / "data" / "coach-2026.json"))
    careers = json.load(open(ROOT / "data" / "coach-careers.json"))
    mem = json.load(open(DATA / "conf_members_2027.json"))["teams"]
    changes = json.load(open(DATA / "coach_changes_2026.json"))
    full_names = list(mem)

    def team_of(school):
        a = ALIAS.get(school.lower())
        if a: return a
        w = norm(school)
        cands = [f for f in full_names if norm(f)[:len(w)] == w]
        # the shortest full name whose first words are the school ("Georgia" → Georgia Bulldogs, not Georgia Tech)
        cands.sort(key=lambda f: len(norm(f)))
        return cands[0] if cands else None

    by_name = {}
    for cid, c in careers.items(): by_name.setdefault(" ".join(norm(c.get("n"))), []).append(cid)
    by_team = {r["tm"]: r for r in rows}
    out, applied, missing = [], [], []
    for ch in changes:
        tm = team_of(ch["school"])
        if not tm: missing.append(ch["school"]); continue
        ids = by_name.get(" ".join(norm(ch["new_coach"])), [])
        if not ids:   # Mike / Michael, Jr.: same last name + first initial, if exactly one coach on record fits
            w = [x for x in norm(ch["new_coach"]) if x not in ("jr", "sr", "ii", "iii")]
            fits = [cid for k, v in by_name.items() for cid in v
                    if (lambda q: q and q[-1] == w[-1] and q[0][0] == w[0][0])([x for x in k.split() if x not in ("jr", "sr", "ii", "iii")])]
            ids = fits if len(fits) == 1 else []
        cid = ids[-1] if ids else "new-" + "-".join(norm(ch["new_coach"]))
        old = by_team.get(tm, {})
        by_team[tm] = {"c": cid, "n": ch["new_coach"], "tm": tm, "cf": old.get("cf"), "w": None, "l": None,
                       "new": True, "prev": ch.get("new_coach_prev"), "was": ch.get("old_coach"), "hired": ch.get("hired"),
                       "career": bool(ids), "src": ch.get("source")}
        applied.append((tm, ch["old_coach"], ch["new_coach"], bool(ids)))
    for tm, r in by_team.items():
        code = mem.get(tm)
        if not code: continue            # no longer D-I (Saint Francis)
        r = dict(r); r["cf"] = CONF_FULL.get(code, r.get("cf")); out.append(r)
    for tm in mem:                       # programs with no 2026 row (new to D-I)
        if tm not in by_team: out.append({"c": None, "n": None, "tm": tm, "cf": CONF_FULL.get(mem[tm])})
    json.dump(out, open(ROOT / "data" / "coach-2027.json", "w"), separators=(",", ":"))
    print(f"{len(out)} programs · {len(applied)} coaching changes applied · {sum(1 for a in applied if a[3])} new coaches with a D-I head-coaching record")
    for a in applied[:6]: print("  ", a)
    if missing: print("  NOT MATCHED:", missing)


if __name__ == "__main__":
    main()
