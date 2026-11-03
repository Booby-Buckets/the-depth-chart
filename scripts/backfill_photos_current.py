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
    # (espn athlete id, normalized name, team id, headshot) for every athlete with a photo
    out = []
    for _ in range(2):
        try:
            d = S.get(ROSTER.format(tid=tid), timeout=30).json()
            for a in d.get("athletes", []):
                hs = (a.get("headshot") or {}).get("href")
                if hs:
                    out.append((str(a.get("id") or ""), norm(a.get("displayName")), tid, hs))
            return out
        except Exception:
            time.sleep(1)
    return out


def fetch_players():
    rows, pg = [], 0
    while True:
        r = requests.get(f"{SB}/rest/v1/players?select=id,name,team,espn_id,photo_url&name=neq.%E2%80%94&order=id",
                         headers={**H, "Range-Unit": "items", "Range": f"{pg*1000}-{pg*1000+999}"}).json()
        if not isinstance(r, list) or not r:
            break
        rows += r
        if len(r) < 1000:
            break
        pg += 1
    return rows


def main(write=False):
    # Match ESPN id first, then name within the same team, then a name that is unique across D-I: a bare
    # name match put one Chase Thompson's photo on every Chase Thompson.
    by_id, by_team, by_name = {}, {}, {}
    team_id = {t[0]: t[1] for t in TEAMS}
    def tid_of(short):   # players.team is the short school name ("Texas"); TEAMS has "Texas Longhorns"
        if not short: return None
        if short in team_id: return team_id[short]
        c = [f for f in team_id if f.startswith(short + " ")]
        return team_id[min(c, key=lambda f: len(f.split()))] if c else None
    with ThreadPoolExecutor(max_workers=8) as ex:
        for m in ex.map(lambda t: fetch_team(t[1]), TEAMS):
            for eid, nm, tid, hs in m:
                if eid: by_id[eid] = hs
                by_team[(tid, nm)] = hs
                by_name.setdefault(nm, set()).add(hs)
    print(f"headshots gathered from rosters: {len(by_id)} by id, {len(by_team)} by team+name")

    players = fetch_players()
    have = [p for p in players if p.get("photo_url")]
    need = [p for p in players if not p.get("photo_url")]
    pay, how = [], {"id": 0, "team": 0, "name": 0}
    for p in need:
        nm, hs = norm(p["name"]), None
        if p.get("espn_id") and str(p["espn_id"]) in by_id: hs = by_id[str(p["espn_id"])]; how["id"] += 1
        elif (tid_of(p.get("team")), nm) in by_team: hs = by_team[(tid_of(p.get("team")), nm)]; how["team"] += 1
        elif len(by_name.get(nm, ())) == 1: hs = next(iter(by_name[nm])); how["name"] += 1
        if hs:
            pay.append({"id": p["id"], "name": p["name"], "photo_url": hs})
    print(f"  matched by espn id {how['id']} · team+name {how['team']} · unique name {how['name']}")
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
