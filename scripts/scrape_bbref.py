#!/usr/bin/env python3
"""
Scrape Basketball Reference (sports-reference.com/cbb) school-season pages for
every player-season: bio (height/weight/class/pos/hometown) + per-game + per-40 +
advanced stats. One page per school-season = everything for that team that year.

Basketball Reference rate-limits hard (~20 req/min) and temp-bans faster scrapers,
so this crawls politely (DELAY seconds between requests) with 429 backoff. Fully
resumable per (year, school-slug). Run in the background — all 20 years is ~7 hrs.

  python3 scrape_bbref.py --seasons 2009            # pilot one year
  python3 scrape_bbref.py                            # 2007-2026
Output: data/bbref.jsonl  (one row per player-season; stats kept as JSON dicts)
"""
import argparse, json, re, sys, time
from pathlib import Path
import cloudscraper
from bs4 import BeautifulSoup, Comment

DATA = Path(__file__).parent / "data"
OUT  = DATA / "bbref.jsonl"
PROG = DATA / "bbref_progress.json"
SCHOOLS = DATA / "bbref_schools.json"          # {year: {slug: name}}
BASE = "https://www.sports-reference.com"
DELAY = 3.5
S = cloudscraper.create_scraper(browser={"browser":"chrome","platform":"darwin","mobile":False})

ROSTER_BIO = {"class":"class","pos":"pos","height":"height","weight":"weight","hometown":"hometown"}
SKIP = {"ranker","name_display","player","pos","awards","number","class","height","weight","hometown","rsci","summary"}


def get(url, tries=5):
    for i in range(tries):
        try:
            r = S.get(url, timeout=40)
            if r.status_code == 200:
                time.sleep(DELAY)
                return r.text
            if r.status_code == 404:
                time.sleep(DELAY); return None
            if r.status_code == 429:
                print(f"  429 rate-limited; backing off {60*(i+1)}s", flush=True)
                time.sleep(60*(i+1)); continue
        except Exception:
            pass
        time.sleep(6 + 4*i)
    return None


def with_comments(html):
    soup = BeautifulSoup(html, "html.parser")
    for c in soup.find_all(string=lambda t: isinstance(t, Comment)):
        if "<table" in c:
            try: soup.append(BeautifulSoup(c, "html.parser"))
            except Exception: pass
    return soup


def bbid(cell):
    a = cell.find("a", href=True) if cell else None
    if a:
        m = re.search(r"/cbb/players/([^.]+)\.html", a["href"])
        if m: return m.group(1)
    return None


def parse_stat_table(table):
    out = {}
    if not table or not table.find("tbody"): return out
    for tr in table.find("tbody").find_all("tr"):
        if "thead" in (tr.get("class") or []): continue
        cells = {c.get("data-stat"): c for c in tr.find_all(["th", "td"])}
        bid = bbid(cells.get("name_display") or cells.get("player"))
        if not bid: continue
        out[bid] = {k: (c.get_text(strip=True) or None) for k, c in cells.items() if k and k not in SKIP}
    return out


def school_list(year):
    cache = json.loads(SCHOOLS.read_text()) if SCHOOLS.exists() else {}
    if str(year) in cache:
        return cache[str(year)]
    html = get(f"{BASE}/cbb/seasons/men/{year}-school-stats.html")
    out = {}
    if html:
        soup = with_comments(html)
        for a in soup.select('table#basic_school_stats tbody a[href^="/cbb/schools/"]'):
            m = re.match(r"/cbb/schools/([^/]+)/men/\d+\.html", a["href"])
            if m: out[m.group(1)] = a.get_text(strip=True)
    cache[str(year)] = out
    SCHOOLS.write_text(json.dumps(cache))
    return out


def scrape_school(slug, name, year):
    html = get(f"{BASE}/cbb/schools/{slug}/men/{year}.html")
    if not html: return []
    soup = with_comments(html)
    tabs = {t.get("id"): t for t in soup.find_all("table") if t.get("id")}
    pg  = parse_stat_table(tabs.get("players_per_game"))
    p40 = parse_stat_table(tabs.get("players_per_min"))
    adv = parse_stat_table(tabs.get("players_advanced"))
    # roster bio, keyed by bbref id
    bio = {}
    rt = tabs.get("roster")
    if rt and rt.find("tbody"):
        for tr in rt.find("tbody").find_all("tr"):
            cells = {c.get("data-stat"): c for c in tr.find_all(["th", "td"])}
            namec = cells.get("player")
            bid = bbid(namec)
            if not bid: continue
            b = {"player": namec.get_text(strip=True)}
            for src, dst in ROSTER_BIO.items():
                c = cells.get(src)
                if c is not None:
                    v = c.get_text(strip=True) or None
                    b[dst] = int(v) if dst == "weight" and v and v.isdigit() else v
            bio[bid] = b
    ids = set(pg) | set(adv) | set(bio) | set(p40)
    rows = []
    for bid in ids:
        b = bio.get(bid, {})
        rows.append({"bbref_id": bid, "season": year, "school_slug": slug, "school": name,
                     "player": b.get("player"), "class": b.get("class"), "pos": b.get("pos"),
                     "height": b.get("height"), "weight": b.get("weight"), "hometown": b.get("hometown"),
                     "pergame": pg.get(bid), "per40": p40.get(bid), "advanced": adv.get(bid)})
    return rows


def main(seasons):
    prog = json.loads(PROG.read_text()) if PROG.exists() else {"done": []}
    done = set(prog["done"])
    fout = open(OUT, "a")
    n = 0
    for yr in seasons:
        schools = school_list(yr)
        print(f"=== {yr}: {len(schools)} schools ===", flush=True)
        for slug, name in schools.items():
            key = f"{yr}:{slug}"
            if key in done:
                continue
            for r in scrape_school(slug, name, yr):
                fout.write(json.dumps(r) + "\n"); n += 1
            fout.flush()
            done.add(key); PROG.write_text(json.dumps({"done": list(done)}))
        print(f"  {yr} done — {n} player-seasons cumulative", flush=True)
    fout.close()
    print(f"DONE: {n} player-seasons -> {OUT}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="+", default=list(range(2007, 2027)))
    main(ap.parse_args().seasons)
