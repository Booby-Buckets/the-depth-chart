#!/usr/bin/env python3
"""
Scrape EVERY tournament game in men's college basketball for the last 20 seasons
from ESPN, both:
  * early-season MTEs (Maui, Battle 4 Atlantis, Players Era, all the "classics")
    — these live in the regular season (seasontype=2), tagged in the game's note
    headline; we scan Nov 1 - Dec 31.
  * postseason (NCAA Tournament, NIT, CBI, CIT/The Basketball Classic, and every
    conference tournament) — seasontype=3, Feb 25 - Apr 15.

Each game is normalized: sponsor names stripped ("The Maui Invitational Presented
by Novavax" -> "Maui Invitational"), category tagged (NCAA/NIT/CBI/CIT/CONF/MTE),
round + division + seeds + winner captured, so games can be assembled into
brackets downstream.

  python3 scrape_tournaments.py --seasons 2025      # pilot one season
  python3 scrape_tournaments.py                      # all 20 (2007-2026)
Output: data/tournaments.jsonl  (one row per game)   Resumable per season+date.
"""
import argparse, json, re, time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
import cloudscraper

DATA = Path(__file__).parent / "data"
OUT  = DATA / "tournaments.jsonl"
PROG = DATA / "tournaments_progress.json"
SCB = ("https://site.api.espn.com/apis/site/v2/sports/basketball/"
       "mens-college-basketball/scoreboard?dates={d}&groups=50&seasontype={st}&limit=400")
S = cloudscraper.create_scraper(browser={"browser":"chrome","platform":"darwin","mobile":False})

# leading sponsor tokens to strip from MTE names (kept minimal + safe — anything
# not stripped is still readable, and the raw headline is always preserved)
SPONSORS = [
    r"bad boy mowers", r"acrisure", r"emerald coast", r"myrtle beach", r"continental tire",
    r"hall of fame", r"legends", r"veterans classic", r"naismith", r"barclays center",
    r"basketball hall of fame", r"phil knight", r"invesco qqq", r"espn events",
    r"cayman islands", r"fort myers", r"paradise jam", r"gulf coast", r"jersey mike'?s",
]
SPONSOR_RE = re.compile(r"^(the\s+)?(" + "|".join(SPONSORS) + r")\s+", re.I)
PRESBY_RE  = re.compile(r"\s+(presented|pres\.?)\s+by\s+.*$", re.I)

ROUND_WORDS = ("championship","3rd place","5th place","7th place","consolation",
    "semifinal","quarterfinal","final four","elite eight","sweet 16","sweet sixteen",
    "national championship","1st round","2nd round","first round","second round",
    "opening round","regional","final","5th-place","3rd-place","place game")

def _int(x):
    try: return int(x)
    except Exception: return None

def get(url, tries=3):
    for i in range(tries):
        try:
            r = S.get(url, timeout=30)
            if r.status_code == 200: return r.json()
        except Exception: pass
        time.sleep(1 + 2*i)
    return None

def norm_round(seg):
    n = seg.lower()
    if "national championship" in n: return "National Championship"
    if "final four" in n: return "Final Four"
    if "elite eight" in n or "regional final" in n: return "Elite Eight"
    if "sweet" in n or "regional semifinal" in n: return "Sweet 16"
    if "second round" in n or "2nd round" in n: return "2nd Round"
    if "first round" in n or "1st round" in n or "opening round" in n: return "1st Round"
    if "quarterfinal" in n: return "Quarterfinal"
    if "semifinal" in n: return "Semifinal"
    if "3rd place" in n or "3rd-place" in n: return "3rd Place"
    if "5th place" in n or "5th-place" in n: return "5th Place"
    if "7th place" in n: return "7th Place"
    if "consolation" in n: return "Consolation"
    if "place game" in n: return seg.strip()
    if "championship" in n or "final" in n: return "Championship"
    return None

def classify(headline):
    """headline -> (category, tournament, division, round). category in
    NCAA/NIT/CBI/CIT/TBC/CONF/MTE."""
    if not headline: return (None, None, None, None)
    n = headline.lower()
    parts = [p.strip() for p in re.split(r"\s+[-–]\s+", headline)]
    division = next((p for p in parts[1:] if "division" in p.lower()), None)
    rnd = None
    for seg in parts[1:]:
        if "division" in seg.lower(): continue
        r = norm_round(seg)
        if r: rnd = r
    # if the round rode along inside the first segment (older all-caps notes)
    if rnd is None:
        rnd = norm_round(headline)

    if "men's basketball championship" in n or re.search(r"\bncaa\b", n):
        return ("NCAA", "NCAA Tournament", division, rnd)
    if re.search(r"\bnit\b", n) or "national invitation" in n:
        return ("NIT", "NIT", division, rnd)
    if re.search(r"\bcbi\b", n) or "college basketball invitational" in n:
        return ("CBI", "CBI", division, rnd)
    if re.search(r"\bcit\b", n) or "postseason tournament" in n:
        return ("CIT", "CIT", division, rnd)
    if "basketball classic" in n and ("the basketball classic" in n or "tbc" in n):
        return ("TBC", "The Basketball Classic", division, rnd)
    # conference tournament?
    if "championship" in n or "tournament" in n or "conf" in n:
        cat = "CONF"
    else:
        cat = "MTE"
    # clean the tournament name from the first segment
    t = parts[0]
    t = PRESBY_RE.sub("", t)
    t = SPONSOR_RE.sub("", t)
    # drop a round word that got glued onto the name (all-caps legacy notes)
    t = re.sub(r"\s+(" + "|".join(re.escape(w) for w in ROUND_WORDS) + r").*$", "", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip(" -–")
    t = t.title() if t.isupper() else t
    return (cat, t, division, rnd)

def parse(e, yr, st, dt):
    try:
        comp = e["competitions"][0]
        notes = comp.get("notes") or []
        head = notes[0].get("headline") if notes else None
        # regular season: keep only tournament-tagged games; postseason: keep all
        if st == 2 and not head: return None
        cat, tour, division, rnd = classify(head)
        # keep only note-tagged games. ESPN's seasontype=3 filter leaks non-tagged
        # regular-season games for pre-tournament dates, and st=2 non-tournament
        # games have no note — both are dropped here.
        if cat is None: return None
        cs = {c["homeAway"]: c for c in comp["competitors"]}
        h, a = cs.get("home"), cs.get("away")
        if not h or not a: return None
        def seed(c):
            s = (c.get("curatedRank") or {}).get("current")
            return s if (s and s != 99) else None
        winner = h if h.get("winner") else (a if a.get("winner") else None)
        gd = f"{dt[:4]}-{dt[4:6]}-{dt[6:8]}"
        return {
            "id": int(e["id"]), "season": yr, "date": gd, "seasontype": st,
            "category": cat, "tournament": tour, "tournament_raw": head,
            "division": division, "round": rnd, "neutral": bool(comp.get("neutralSite")),
            "home": h["team"]["displayName"], "home_id": _int(h["team"]["id"]),
            "home_score": _int(h.get("score")), "home_seed": seed(h),
            "away": a["team"]["displayName"], "away_id": _int(a["team"]["id"]),
            "away_score": _int(a.get("score")), "away_seed": seed(a),
            "winner": winner["team"]["displayName"] if winner else None,
            "winner_id": _int(winner["team"]["id"]) if winner else None,
            "status": comp.get("status", {}).get("type", {}).get("name", ""),
        }
    except Exception:
        return None

def date_range(a, b):
    out=[]; d=a
    while d <= b: out.append(d.strftime("%Y%m%d")); d += timedelta(days=1)
    return out

def season_scan(yr):
    """(seasontype, date) pairs: early-season MTEs + postseason for season YR."""
    early = [(2, d) for d in date_range(date(yr-1,11,1), date(yr-1,12,31))]
    post  = [(3, d) for d in date_range(date(yr,2,25),  date(yr,4,15))]
    return early + post

def fetch(st, dt, yr):
    d = get(SCB.format(d=dt, st=st))
    rows=[]
    if d:
        for e in d.get("events", []):
            g = parse(e, yr, st, dt)
            if g: rows.append(g)
    return (st, dt), rows

def main(seasons):
    prog = json.loads(PROG.read_text()) if PROG.exists() else {"done": []}
    done = set(prog["done"])
    seen = set()
    if OUT.exists():
        for line in OUT.open():
            try: seen.add(json.loads(line)["id"])
            except Exception: pass
    fout = open(OUT, "a"); n = len(seen)
    for yr in seasons:
        pairs = [(st,dt) for (st,dt) in season_scan(yr) if f"{yr}:{st}:{dt}" not in done]
        with ThreadPoolExecutor(max_workers=8) as ex:
            for (st,dt), rows in ex.map(lambda p: fetch(p[0], p[1], yr), pairs):
                for g in rows:
                    if g["id"] in seen: continue
                    seen.add(g["id"]); fout.write(json.dumps(g)+"\n"); n+=1
                done.add(f"{yr}:{st}:{dt}")
        fout.flush(); PROG.write_text(json.dumps({"done": list(done)}))
        print(f"season {yr}: {n} tournament games cumulative", flush=True)
    fout.close()
    print(f"DONE — {n} games -> {OUT}", flush=True)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="*")
    a = ap.parse_args()
    seasons = a.seasons or list(range(2007, 2027))
    main(seasons)
