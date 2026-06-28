#!/usr/bin/env python3
"""Set player_history.team to the canonical bbref_seasons.school via the
(espn_id, season) link, so the Player Database shows the exact same team names
as the player pages. Supersedes prefix/mascot guessing for matched rows."""
import os,re,sys,time,requests
from pathlib import Path
from collections import defaultdict
SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY=os.environ.get("SUPABASE_SERVICE_KEY") or re.search(r'SB_KEY\s*=\s*"([^"]+)"',(Path(__file__).parent/"load_supabase.py").read_text()).group(1)
H={"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json"}
def fetch_season(tbl,yr,sel):
    rows=[]; pg=0
    while True:
        try: j=requests.get(f"{SB}/rest/v1/{tbl}?{sel}&season_year=eq.{yr}",headers={**H,"Range-Unit":"items","Range":f"{pg*1000}-{pg*1000+999}"},timeout=60).json()
        except: j=None
        if not isinstance(j,list) or not j: break
        rows+=j
        if len(j)<1000: break
        pg+=1
    return rows
def patch_team(pay):
    by=defaultdict(list)
    for r in pay: by[r["team"]].append(r["id"])
    ok=0
    for team,ids in by.items():
        for i in range(0,len(ids),300):
            ch=ids[i:i+300]
            for _ in range(4):
                try: r=requests.patch(f"{SB}/rest/v1/player_history?id=in.({','.join(map(str,ch))})",headers={**H,"Prefer":"return=minimal"},json={"team":team},timeout=90)
                except Exception: time.sleep(3); continue
                if r.status_code in (200,204): ok+=len(ch); break
                time.sleep(3)
            time.sleep(0.02)
    print(f"  updated {ok} rows across {len(by)} teams")
def main(write=False):
    sch={}
    for yr in range(2007,2027):
        for r in fetch_season("bbref_seasons",yr,"select=espn_id,school&espn_id=not.is.null&school=not.is.null"):
            sch[(int(r["espn_id"]),yr)]=r["school"]
    print(f"bbref schools: {len(sch):,} player-seasons")
    pay=[]
    for yr in range(2012,2027):
        for h in fetch_season("player_history",yr,"select=id,espn_id,team&espn_id=not.is.null"):
            k=(int(h["espn_id"]),yr)
            if k in sch and sch[k]!=h.get("team"): pay.append({"id":int(h["id"]),"team":sch[k]})
    print(f"player_history rows needing a team fix: {len(pay)}")
    if not write: print("DRY RUN"); return
    patch_team(pay)
if __name__=="__main__": main(write="--write" in sys.argv)
