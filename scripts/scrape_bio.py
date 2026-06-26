#!/usr/bin/env python3
"""
Scrape height / weight / headshot for every player-season via ESPN's core API.

The site roster endpoint only returns current/recent rosters, but the core API
(seasons/{yr}/teams/{id}/athletes) lists every athlete who played for a team in
a given season — so we can cover all-time. Heights and weights are present for
historical players; headshots exist mainly for recent/current players (null for
older ones, which is expected).

Strategy: for each (team, season) pull the athlete $ref list, dedupe athletes by
id (an athlete plays several seasons), fetch each athlete's bio once, and emit one
record per (team, season, athlete). Resumable: skips already-scraped team-seasons.

  python3 scrape_bio.py --test          # 2 teams only, prints a sample
  python3 scrape_bio.py                  # full all-time run (resumable)
  python3 scrape_bio.py --seasons 2024 2025 2026
"""
import argparse, json, re, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import cloudscraper
from scraper import TEAMS   # [(name, espn_id), ...]

DATA = Path(__file__).parent / "data"
OUT  = DATA / "bio.jsonl"
PROG = DATA / "bio_progress.json"
LIST_URL = ("https://sports.core.api.espn.com/v2/sports/basketball/leagues/"
            "mens-college-basketball/seasons/{yr}/teams/{tid}/athletes?limit=200")
S = cloudscraper.create_scraper(browser={"browser":"chrome","platform":"darwin","mobile":False})


def get(url, tries=3):
    for i in range(tries):
        try:
            r = S.get(url, timeout=30)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 404:
                return None
        except Exception:
            pass
        time.sleep(1 + 2*i)
    return None


def fetch_bio(ref):
    d = get(ref)
    if not d:
        return None
    return {"name": d.get("displayName"), "ht": d.get("displayHeight"),
            "wt": d.get("weight"), "hs": (d.get("headshot") or {}).get("href")}


def main(seasons, test=False):
    teams = TEAMS[:2] if test else TEAMS
    prog = json.loads(PROG.read_text()) if PROG.exists() and not test else {"done": []}
    done = set(prog["done"])
    bio_cache = {}                       # athlete_id -> bio dict (dedupe across seasons)
    mode = "w" if test else "a"
    fout = open(OUT, mode)
    n_rec = 0
    for ti, (name, tid) in enumerate(teams, 1):
        for yr in seasons:
            key = f"{tid}-{yr}"
            if key in done:
                continue
            lst = get(LIST_URL.format(yr=yr, tid=tid))
            if lst:
                refs = []
                for it in lst.get("items", []):
                    m = re.search(r"/athletes/(\d+)", it.get("$ref", ""))
                    if m:
                        refs.append((m.group(1), it["$ref"]))
                todo = [(aid, ref) for aid, ref in refs if aid not in bio_cache]
                if todo:                       # fetch this team-season's new athletes in parallel
                    with ThreadPoolExecutor(max_workers=6) as ex:
                        for aid, b in ex.map(lambda x: (x[0], fetch_bio(x[1])), todo):
                            bio_cache[aid] = b
                for aid, _ in refs:
                    b = bio_cache.get(aid)
                    if b and b.get("name"):
                        fout.write(json.dumps({"team": name, "season": yr, "aid": aid, **b}) + "\n")
                        n_rec += 1
                fout.flush()
            done.add(key)
            if not test:
                PROG.write_text(json.dumps({"done": list(done)}))
            time.sleep(0.15)
        print(f"[{ti}/{len(teams)}] {name}: {n_rec} records so far, {len(bio_cache)} athletes cached", flush=True)
    fout.close()
    print(f"DONE: {n_rec} records -> {OUT}")
    if test:
        for line in OUT.read_text().splitlines()[:8]:
            print("  ", line)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="+", default=list(range(2011, 2027)))
    ap.add_argument("--test", action="store_true")
    a = ap.parse_args()
    main(a.seasons, a.test)
