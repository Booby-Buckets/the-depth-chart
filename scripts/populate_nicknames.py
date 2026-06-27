#!/usr/bin/env python3
"""
Populate teams.nickname so each team page can build its exact mascot name
(name + ' ' + nickname) and link to the games/team_seasons data.

Resolves by longest-prefix: a mascot like "Kansas Jayhawks" belongs to the
teams.name that is its longest prefix ("Kansas", not "Kansas State"), which
disambiguates Kansas vs Kansas State, North Carolina vs NC State, etc.

  python3 populate_nicknames.py            # dry run
  python3 populate_nicknames.py --write
"""
import os, sys, time
import requests

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def fetch_all(url):
    rows, pg = [], 0
    while True:
        r = requests.get(url, headers={**H, "Range-Unit": "items", "Range": f"{pg*1000}-{pg*1000+999}"}).json()
        if not isinstance(r, list) or not r:
            break
        rows += r
        if len(r) < 1000:
            break
        pg += 1
    return rows


def main(write=False):
    teams = fetch_all(f"{SB}/rest/v1/teams?select=id,name,nickname&order=name")
    names = sorted({t["name"] for t in teams}, key=len, reverse=True)   # longest first
    # candidate mascots: every distinct team_seasons name (recent seasons cover all current teams)
    mascots = {m["team"] for m in fetch_all(f"{SB}/rest/v1/team_seasons?select=team&season_year=gte.2023")}

    # for each teams.name, find its mascot = the mascot whose longest teams-name prefix is this name
    def longest_prefix(mascot):
        for n in names:                      # names sorted longest-first
            if mascot == n or mascot.startswith(n + " "):
                return n
        return None

    owner = {}                               # name -> mascot
    for m in mascots:
        n = longest_prefix(m)
        if n and (n not in owner or len(m) < len(owner[n])):
            owner[n] = m                     # shortest mascot among this name's matches

    pay, unresolved = [], []
    for t in teams:
        m = owner.get(t["name"])
        if not m:
            unresolved.append(t["name"]); continue
        nick = m[len(t["name"]):].strip()
        if nick:
            pay.append({"id": t["id"], "name": t["name"], "nickname": nick})

    print(f"resolved {len(pay)}/{len(teams)} teams")
    print("  sample:", [(p["name"], p["nickname"]) for p in pay[:8]])
    if unresolved:
        print("  unresolved:", unresolved[:12])
    if not write:
        print("DRY RUN — pass --write"); return
    ok = 0
    for j in range(0, len(pay), 100):
        b = pay[j:j+100]
        r = requests.post(f"{SB}/rest/v1/teams?on_conflict=id",
                          headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"}, json=b, timeout=60)
        if r.status_code in (200, 201, 204): ok += len(b)
        else: print(f"  ERR {r.status_code}: {r.text[:150]}"); break
        time.sleep(0.1)
    print(f"  wrote {ok}")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
