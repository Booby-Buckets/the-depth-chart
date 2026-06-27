#!/usr/bin/env python3
"""
Scrape labeled postseason games (seasontype=3) from ESPN: conference tournaments,
NCAA tournament, NIT, CBI, CIT — each game tagged with tournament + round + seeds.
From these we can derive every team's postseason: conf-tourney champion, NCAA seed
and how far they advanced, NIT result, etc.

  python3 scrape_postseason.py --seasons 2024     # pilot
  python3 scrape_postseason.py                      # all 20
Output: data/postseason.jsonl
"""
import argparse, json, re, time
from datetime import date, timedelta
from pathlib import Path
import cloudscraper

DATA = Path(__file__).parent / "data"
OUT = DATA / "postseason.jsonl"
SB = ("https://site.api.espn.com/apis/site/v2/sports/basketball/"
      "mens-college-basketball/scoreboard?dates={d}&groups=50&seasontype=3&limit=200")
S = cloudscraper.create_scraper(browser={"browser":"chrome","platform":"darwin","mobile":False})


def get(url, tries=3):
    for i in range(tries):
        try:
            r = S.get(url, timeout=30)
            if r.status_code == 200: return r.json()
        except Exception: pass
        time.sleep(1+i)
    return None


def _round(note):
    """Normalize the round across ESPN's two note formats (Title Case w/ ' - '
    separator in recent years; ALL-CAPS appended in older years)."""
    n = note.lower()
    if "national championship" in n: return "National Championship"
    if "final four" in n: return "Final Four"
    if "elite eight" in n or "regional final" in n: return "Elite Eight"
    if "sweet" in n or "regional semifinal" in n: return "Sweet 16"
    if "2nd round" in n or "second round" in n: return "2nd Round"
    if "1st round" in n or "first round" in n or "opening round" in n: return "1st Round"
    if "quarterfinal" in n: return "Quarterfinal"
    if "semifinal" in n: return "Semifinal"
    if "championship" in n or "final" in n: return "Final"   # conference final
    return None


def classify(note):
    """note headline -> (tournament, round)."""
    if not note: return (None, None)
    n = note.lower()
    rnd = _round(note)
    if "men's basketball championship" in n or "ncaa" in n:
        tour = "NCAA Tournament"
    elif "nit" in n or "national invitation" in n:
        tour = "NIT"
    elif "cbi" in n or "college basketball invitational" in n:
        tour = "CBI"
    elif "cit" in n:
        tour = "CIT"
    else:
        # conference tournament: strip round words + sponsors, then title-case
        t = re.split(r"\s*[-–]\s*", note)[0]
        t = re.sub(r"\s+(quarterfinal|semifinal|championship|final|first round|second round|1st round|2nd round|opening round).*$", "", t, flags=re.I)
        t = re.sub(r"\s*(pres\.?\s+by\s+.*|presented\s+by\s+.*)$", "", t, flags=re.I)
        t = re.sub(r"^(phillips 66|dr pepper|t\.?\s*rowe price|continental tire|hercules tires?)\s+", "", t, flags=re.I)
        t = re.sub(r"\s+", " ", t).strip()
        tour = t.title() if t.isupper() else t
    return (tour, rnd)


def reparse():
    """Re-classify tournament+round from the stored raw notes (no re-scrape)."""
    rows = []
    for l in OUT.read_text().splitlines():
        try: r = json.loads(l)
        except Exception: continue
        r["tournament"], r["round"] = classify(r.get("note"))
        if r["tournament"]:
            rows.append(r)
    with open(OUT, "w") as f:
        for r in rows: f.write(json.dumps(r) + "\n")
    print(f"reparsed {len(rows)} postseason games")


def _seed(c):
    cr = c.get("curatedRank", {})
    return cr.get("current") if isinstance(cr, dict) and cr.get("current") not in (None, 99) else c.get("seed")


def main(seasons):
    fout = open(OUT, "w")
    n = 0
    for yr in seasons:
        d, end = date(yr, 3, 1), date(yr, 4, 12)
        while d <= end:
            data = get(SB.format(d=d.strftime("%Y%m%d")))
            if data:
                for e in data.get("events", []):
                    try:
                        comp = e["competitions"][0]
                        notes = comp.get("notes", [])
                        note = notes[0].get("headline") if notes else None
                        tour, rnd = classify(note)
                        if not tour: continue
                        cs = {c["homeAway"]: c for c in comp["competitors"]}
                        h, a = cs.get("home"), cs.get("away")
                        if not h or not a: continue
                        def sc(x):
                            try: return int(x.get("score"))
                            except Exception: return None
                        hw = (h.get("winner") is True)
                        row = {"id": int(e["id"]), "season": yr, "date": e["date"][:10],
                               "tournament": tour, "round": rnd, "note": note,
                               "home": h["team"]["displayName"], "home_id": int(h["team"]["id"]),
                               "home_seed": _seed(h), "home_score": sc(h),
                               "away": a["team"]["displayName"], "away_id": int(a["team"]["id"]),
                               "away_seed": _seed(a), "away_score": sc(a),
                               "winner": (h if hw else a)["team"]["displayName"],
                               "winner_id": int((h if hw else a)["team"]["id"])}
                        fout.write(json.dumps(row) + "\n"); n += 1
                    except Exception:
                        continue
                fout.flush()
            d += timedelta(days=1)
        print(f"season {yr}: {n} postseason games cumulative", flush=True)
    fout.close()
    print(f"DONE: {n} games -> {OUT}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="+", default=list(range(2007, 2027)))
    ap.add_argument("--reparse", action="store_true")
    a = ap.parse_args()
    if a.reparse:
        reparse()
    else:
        main(a.seasons)
