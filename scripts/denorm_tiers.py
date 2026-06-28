#!/usr/bin/env python3
"""
Backfill box_scores.team_tier + opp_tier from team_seasons.tier, via the REST API
(the single SQL UPDATE over 2.2M rows times out the dashboard editor). One PATCH
per (season, team) using a clean eq filter — each updates all that team-season's
box scores server-side. Resumable: re-running only re-touches the same rows.

  python3 denorm_tiers.py            # dry run (counts)
  python3 denorm_tiers.py --write
"""
import os, re, sys, time, urllib.parse, requests
from pathlib import Path
SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY=os.environ.get("SUPABASE_SERVICE_KEY") or re.search(r'SB_KEY\s*=\s*"([^"]+)"',(Path(__file__).parent/"load_supabase.py").read_text()).group(1)
H={"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json"}

def fetch_all(url):
    rows=[]
    while True:
        s=len(rows)
        d=requests.get(url,headers={**H,"Range-Unit":"items","Range":f"{s}-{s+999}"},timeout=60).json()
        if not isinstance(d,list) or not d: break
        rows+=d
    return rows

def patch(col_filter, season, team, field, tier):
    val=urllib.parse.quote(team, safe='')
    url=f"{SB}/rest/v1/box_scores?season_year=eq.{season}&{col_filter}=eq.{val}"
    for _ in range(4):
        try:
            r=requests.patch(url, headers={**H,"Prefer":"return=minimal"}, json={field:tier}, timeout=60)
            if r.status_code in (200,204): return True
        except Exception: pass
        time.sleep(2)
    return False

def main(write=False):
    ts=fetch_all(f"{SB}/rest/v1/team_seasons?select=season_year,team,tier&tier=not.is.null&order=season_year")
    print(f"team-seasons with tier: {len(ts):,}")
    if not write: print("DRY RUN — pass --write"); return
    ok=fail=0
    for i,r in enumerate(ts):
        s,team,tier=r["season_year"],r["team"],r["tier"]
        a=patch("team", s, team, "team_tier", tier)
        b=patch("opp",  s, team, "opp_tier",  tier)
        ok+= (a and b); fail+= (not(a and b))
        if (i+1)%500==0: print(f"  {i+1}/{len(ts)}  ok={ok} fail={fail}", flush=True)
    print(f"done: {ok} team-seasons set ({fail} failed)")

if __name__=="__main__":
    main(write="--write" in sys.argv)
