#!/usr/bin/env python3
"""
Normalize + enrich scraped tournament games (data/tournaments.jsonl) and upsert to
the tournament_games table.

  - fills conference-tournament names for untagged postseason games via team
    conference lookup (both teams share a league)
  - assigns a round_order for bracket sorting; infers missing MTE rounds from the
    date sequence within each tournament edition
  - flags "notable" tournaments (NCAA, NIT, the marquee MTEs, conf championships)
  - dedupes canonical tournament names across sponsor variants

  python3 normalize_tournaments.py            # dry run — stats only
  python3 normalize_tournaments.py --write    # upsert to tournament_games
Requires the tournament_games table (scripts/schema_tournaments.sql) to exist.
"""
import argparse, json, os, re, sys, time
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).parent / "data"
SRC  = DATA / "tournaments.jsonl"
OUT  = DATA / "tournaments_norm.jsonl"
SB   = "https://izlqhnxowdhtdofkwrho.supabase.co"

def _key():
    return os.environ.get("SUPABASE_SERVICE_KEY") or re.search(
        r'SB_KEY\s*=\s*"([^"]+)"', (Path(__file__).parent/"load_supabase.py").read_text()).group(1)

CONF_AB = {
    "Atlantic Coast":"ACC","Southeastern":"SEC","Big Ten":"Big Ten","Big 12":"Big 12",
    "Big East":"Big East","Pacific-12":"Pac-12","Pacific-10":"Pac-10","American Athletic":"American",
    "Atlantic 10":"Atlantic 10","Mountain West":"Mountain West","Missouri Valley":"MVC",
    "West Coast":"WCC","Conference USA":"C-USA","Western Athletic":"WAC","Mid-American":"MAC",
    "Colonial Athletic":"CAA","Coastal Athletic":"CAA","Metro Atlantic Athletic":"MAAC",
    "Mid-Eastern Athletic":"MEAC","Southwestern Athletic":"SWAC","Ohio Valley":"OVC",
    "America East":"America East","Atlantic Sun":"ASUN","Big Sky":"Big Sky","Big South":"Big South",
    "Big West":"Big West","Northeast":"NEC","Southern":"SoCon","Sun Belt":"Sun Belt",
    "Horizon League":"Horizon","Summit League":"Summit","Southland":"Southland","Ivy":"Ivy",
    "Patriot":"Patriot","United Athletic":"UAC","Great West":"Great West",
}
def conf_ab(name):
    if not name: return None
    s = re.sub(r"\s+(Conference|League|Association)$","",name).strip()
    return CONF_AB.get(s, s if len(s)<=10 else "".join(w[0] for w in s.split()).upper())

# canonical-name cleanup for MTEs whose sponsor changes yearly
CANON = [
    (r"maui invitational", "Maui Invitational"),
    (r"battle 4 atlantis", "Battle 4 Atlantis"),
    (r"players era", "Players Era Festival"),
    (r"phil knight", "Phil Knight Invitational"),
    (r"cancun challenge", "Cancun Challenge"),
    (r"fort myers tip-?off", "Fort Myers Tip-Off"),
    (r"cayman islands", "Cayman Islands Classic"),
    (r"myrtle beach", "Myrtle Beach Invitational"),
    (r"paradise jam", "Paradise Jam"),
    (r"emerald coast", "Emerald Coast Classic"),
    (r"diamond head", "Diamond Head Classic"),
    (r"charleston classic", "Charleston Classic"),
    (r"empire classic", "Empire Classic"),
    (r"hall of fame", "Hall of Fame Classic"),
    (r"legends classic", "Legends Classic"),
    (r"jimmy v", "Jimmy V Classic"),
    (r"gulf coast showcase", "Gulf Coast Showcase"),
    (r"sunshine slam", "Sunshine Slam"),
    (r"cbs sports classic", "CBS Sports Classic"),
    (r"champions classic", "Champions Classic"),
    (r"college basketball crown", "College Basketball Crown"),
]
def canon_name(tour):
    if not tour: return tour
    low = tour.lower()
    for pat, name in CANON:
        if re.search(pat, low): return name
    return tour

ROUND_ORDER = {
    "First Four":0, "1st Round":1, "Opening Round":1, "Quarterfinal":2, "2nd Round":2,
    "Sweet 16":3, "Semifinal":3, "Elite Eight":4, "Championship":5, "Final":5,
    "Final Four":5, "National Championship":6,
    "Consolation":0, "7th Place":0, "5th Place":0, "3rd Place":0,
}

def reround(headline):
    """Re-derive (division/region, round) from the raw ESPN note headline with
    fuller round vocabulary than the scraper (Elite 8, First Four, Final Four…)."""
    if not headline: return (None, None)
    parts = [p.strip() for p in re.split(r"\s+[-–]\s+", headline)]
    division = next((p for p in parts[1:] if re.search(r"region|division", p, re.I)), None)
    rnd = None
    for seg in parts[1:] if len(parts) > 1 else [headline]:
        n = seg.lower()
        if re.search(r"region|division", n): continue
        if "national championship" in n: rnd = "National Championship"
        elif "final four" in n: rnd = "Final Four"
        elif "first four" in n: rnd = "First Four"
        elif "elite" in n or "regional final" in n: rnd = "Elite Eight"
        elif "sweet" in n or "regional semifinal" in n: rnd = "Sweet 16"
        elif "second round" in n or "2nd round" in n: rnd = "2nd Round"
        elif "first round" in n or "1st round" in n or "opening" in n: rnd = "1st Round"
        elif "quarterfinal" in n: rnd = "Quarterfinal"
        elif "semifinal" in n: rnd = "Semifinal"
        elif "3rd place" in n or "3rd-place" in n or "third place" in n: rnd = "3rd Place"
        elif "5th place" in n: rnd = "5th Place"
        elif "7th place" in n: rnd = "7th Place"
        elif "consolation" in n: rnd = "Consolation"
        elif "championship" in n or re.search(r"\bfinal\b", n): rnd = "Championship"
    return (division, rnd)
# marquee events shown by default in the viewer
NOTABLE_MTE = {"Maui Invitational","Battle 4 Atlantis","Players Era Festival","Phil Knight Invitational",
    "Champions Classic","CBS Sports Classic","Jimmy V Classic","Empire Classic","Emerald Coast Classic",
    "Diamond Head Classic","Charleston Classic","Legends Classic","Hall of Fame Classic",
    "Myrtle Beach Invitational","Cancun Challenge","Fort Myers Tip-Off","Cayman Islands Classic",
    "Maui Invitational","College Basketball Crown","Acrisure Holiday Invitational","Baha Mar Hoops"}

def main(write=False):
    import urllib.request
    K = _key(); H = {"apikey":K, "Authorization":"Bearer "+K}
    # team -> conference per season
    conf = {}
    off = 0
    while True:
        req = urllib.request.Request(
            f"{SB}/rest/v1/team_seasons?select=team,conference,season_year",
            headers={**H, "Range-Unit":"items", "Range":f"{off}-{off+999}"})
        batch = json.load(urllib.request.urlopen(req))
        if not batch: break
        for r in batch:
            if r.get("conference"): conf[(r["team"], r["season_year"])] = r["conference"]
        if len(batch) < 1000: break
        off += 1000
    print(f"conference map: {len(conf):,} team-seasons")

    raw = [json.loads(l) for l in SRC.open()]
    # ESPN's seasontype=3 filter is loose and leaks regular-season games (non-
    # neutral, no note headline) for pre-tournament dates. Real conf tournaments
    # are all note-tagged; drop untagged postseason games as regular-season noise.
    rows = [r for r in raw if not (r["seasontype"] == 3 and not r.get("tournament_raw"))]
    print(f"scraped games: {len(raw):,}  |  kept after dropping untagged st=3 leakage: {len(rows):,}")

    # 1) recategorize using seasontype (the scraper's word-based "championship ->
    #    CONF" test wrongly tagged MTE title games like the Maui final as CONF):
    #    early-season (st=2) is always an MTE; postseason (st=3) special events are
    #    NCAA/NIT/CBI/CIT/TBC, everything else there is a conference tournament.
    def recat(r):
        n = (r.get("tournament_raw") or "").lower()
        if "men's basketball championship" in n or re.search(r"\bncaa\b", n): return "NCAA"
        if re.search(r"\bnit\b", n) or "national invitation" in n: return "NIT"
        if re.search(r"\bcbi\b", n) or "college basketball invitational" in n: return "CBI"
        if "the basketball classic" in n or re.search(r"\btbc\b", n): return "TBC"
        if re.search(r"\bcit\b", n) or "postseason tournament" in n: return "CIT"
        return "MTE" if r["seasontype"] == 2 else "CONF"
    for r in rows:
        r["category"] = recat(r)
        if r["category"] == "CONF":
            c = conf.get((r["home"], r["season"])) or conf.get((r["away"], r["season"]))
            r["tournament"] = f"{conf_ab(c)} Tournament" if c else (r.get("tournament") or "Conference Tournament")
        r["tournament"] = canon_name(r["tournament"])

    # 2) re-derive region/round from the raw headline (fuller vocabulary), then
    #    round_order; infer missing MTE rounds from the date sequence
    for r in rows:
        div, rnd = reround(r.get("tournament_raw"))
        if div: r["division"] = div
        if rnd: r["round"] = rnd
    grp = defaultdict(list)
    for r in rows:
        grp[(r["season"], r["tournament"], r.get("division"))].append(r)
    for key, gs in grp.items():
        gs.sort(key=lambda x: (x["date"], x["id"]))
        dates = sorted({g["date"] for g in gs})
        drank = {d:i for i,d in enumerate(dates)}
        for g in gs:
            if g.get("round") in ROUND_ORDER:
                g["round_order"] = ROUND_ORDER[g["round"]]
            else:
                # untagged (early MTE) game: label + order by which day it fell on
                g["round_order"] = drank[g["date"]] + 1
                if not g.get("round"):
                    g["round"] = f"Round {drank[g['date']] + 1}"

    # 3) notable flag
    for r in rows:
        cat = r["category"]
        r["notable"] = bool(
            cat in ("NCAA","NIT") or
            (cat == "MTE" and r["tournament"] in NOTABLE_MTE) or
            (cat == "CONF" and r.get("round") in ("Championship","Final")))

    with OUT.open("w") as f:
        for r in rows: f.write(json.dumps(r)+"\n")

    from collections import Counter
    print("by category:", dict(Counter(r["category"] for r in rows)))
    print("distinct tournaments:", len({(r["season"],r["tournament"]) for r in rows}))
    print("notable games:", sum(1 for r in rows if r["notable"]))

    if not write:
        print("\nDRY RUN — pass --write to upsert into tournament_games")
        return

    import requests
    cols = ["id","season","date","seasontype","category","tournament","tournament_raw",
            "division","round","round_order","neutral","home","home_id","home_score","home_seed",
            "away","away_id","away_score","away_seed","winner","winner_id","status","notable"]
    pay = [{k:r.get(k) for k in cols} for r in rows]
    HW = {**H, "Content-Type":"application/json", "Prefer":"resolution=merge-duplicates,return=minimal"}
    ok = 0
    for j in range(0, len(pay), 500):
        b = pay[j:j+500]
        for _ in range(4):
            try: rr = requests.post(f"{SB}/rest/v1/tournament_games?on_conflict=id", headers=HW, json=b, timeout=90)
            except Exception: time.sleep(3); continue
            if rr.status_code in (200,201,204): ok += len(b); break
            print("  err", rr.status_code, rr.text[:150]); time.sleep(3)
        time.sleep(0.02)
    print(f"upserted {ok:,} / {len(pay):,}")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--write", action="store_true")
    main(write=ap.parse_args().write)
