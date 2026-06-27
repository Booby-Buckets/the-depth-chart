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


CODE2FULL = {"ACC":"atlantic coast","B10":"big ten","B12":"big 12","BE":"big east",
             "SEC":"southeastern","P12":"pac-12","A10":"atlantic 10","AAC":"american",
             "MWC":"mountain west","MW":"mountain west","WCC":"west coast","MVC":"missouri valley",
             "CUSA":"cusa","SBC":"sun belt","B1G":"big ten"}


def main(write=False):
    teams = fetch_all(f"{SB}/rest/v1/teams?select=id,name,nickname,conf,conference&order=name")
    # mascot -> conference (most recent season available)
    mconf = {}
    for yr in (2026, 2025, 2024):
        for m in fetch_all(f"{SB}/rest/v1/team_seasons?select=team,conference&season_year=eq.{yr}"):
            if m["team"] not in mconf and m.get("conference"):
                mconf[m["team"]] = m["conference"]
    mascots = {m["team"] for m in fetch_all(f"{SB}/rest/v1/team_seasons?select=team&season_year=gte.2023")}

    def conf_match(t, mascot):
        code = (t.get("conf") or t.get("conference") or "").strip()
        full = CODE2FULL.get(code, code.lower())
        mc = (mconf.get(mascot) or "").lower()
        return bool(full) and bool(mc) and full in mc

    pay, unresolved = [], []
    for t in teams:
        N = t["name"]
        cands = [m for m in mascots if m == N or m.startswith(N + " ")]
        if not cands:
            unresolved.append(N); continue
        # the right mascot is the one whose conference matches this team's conference
        # (disambiguates Illinois Fighting Illini[B10] vs Illinois State Redbirds[MVC]);
        # fall back to the shortest if no conference signal.
        cm = [m for m in cands if conf_match(t, m)]
        chosen = min(cm, key=len) if cm else min(cands, key=len)
        nick = chosen[len(N):].strip()
        if nick:
            pay.append({"id": t["id"], "name": N, "nickname": nick})

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
