#!/usr/bin/env python3
"""
Backfill headshots for the current `players` roster from ESPN's live team-roster
API (carries current players + real headshot URLs that the core-API bio scrape
missed). Matches by normalized name. Historical backfill is separate (uses the
box-score ESPN ids once that scrape finishes).

  python3 backfill_photos_current.py            # dry run
  python3 backfill_photos_current.py --write
"""
import os, re, sys, time
from concurrent.futures import ThreadPoolExecutor
import requests, cloudscraper
from scraper import TEAMS

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
ROSTER = ("https://site.api.espn.com/apis/site/v2/sports/basketball/"
          "mens-college-basketball/teams/{tid}/roster")
S = cloudscraper.create_scraper(browser={"browser":"chrome","platform":"darwin","mobile":False})


def norm(n):
    n = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(n).strip().lower())
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", n)).strip()


def fetch_team(tid):
    out = {}
    for _ in range(2):
        try:
            d = S.get(ROSTER.format(tid=tid), timeout=30).json()
            for a in d.get("athletes", []):
                hs = (a.get("headshot") or {}).get("href")
                if hs:
                    out[norm(a.get("displayName"))] = hs
            return out
        except Exception:
            time.sleep(1)
    return out


def fetch_players():
    rows, pg = [], 0
    while True:
        r = requests.get(f"{SB}/rest/v1/players?select=id,name,team,photo_url&name=neq.%E2%80%94&order=id",
                         headers={**H, "Range-Unit": "items", "Range": f"{pg*1000}-{pg*1000+999}"}).json()
        if not isinstance(r, list) or not r:
            break
        rows += r
        if len(r) < 1000:
            break
        pg += 1
    return rows


def main(write=False):
    photo = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for m in ex.map(lambda t: fetch_team(t[1]), TEAMS):
            photo.update(m)
    print(f"headshots gathered from rosters: {len(photo)}")

    players = fetch_players()
    have = [p for p in players if p.get("photo_url")]
    need = [p for p in players if not p.get("photo_url")]
    pay = []
    for p in need:
        hs = photo.get(norm(p["name"]))
        if hs:
            pay.append({"id": p["id"], "name": p["name"], "photo_url": hs})
    print(f"players: {len(players)} total | had photo {len(have)} | newly matched {len(pay)} | still missing {len(need)-len(pay)}")
    print("  sample new:", [p["name"] for p in pay[:8]])
    if not write:
        print("DRY RUN — pass --write"); return
    ok = 0
    for j in range(0, len(pay), 200):
        b = pay[j:j+200]
        r = requests.post(f"{SB}/rest/v1/players?on_conflict=id",
                          headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"}, json=b, timeout=60)
        if r.status_code in (200, 201, 204): ok += len(b)
        else: print(f"  ERR {r.status_code}: {r.text[:150]}"); break
        time.sleep(0.1)
    print(f"  wrote {ok}")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
