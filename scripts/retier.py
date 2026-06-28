#!/usr/bin/env python3
"""Re-tier team_seasons by SRS RANK within each season (not absolute SRS):
   T1 = rank 1-35, T2 = 36-75, T3 = 76-150, T4 = 151+."""
import os,re,sys,time,requests
from pathlib import Path
from collections import defaultdict
SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY=os.environ.get("SUPABASE_SERVICE_KEY") or re.search(r'SB_KEY\s*=\s*"([^"]+)"',(Path(__file__).parent/"load_supabase.py").read_text()).group(1)
H={"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json"}
def fetch_all(u):
    r=[]
    while True:
        s=len(r); d=requests.get(u,headers={**H,"Range-Unit":"items","Range":f"{s}-{s+999}"},timeout=60).json()
        if not isinstance(d,list) or not d: break
        r+=d
    return r
def tier(rank): return 1 if rank<=35 else 2 if rank<=75 else 3 if rank<=150 else 4
def main(write=False):
    ts=fetch_all(f"{SB}/rest/v1/team_seasons?select=season_year,team,srs&srs=not.is.null")
    by=defaultdict(list)
    for r in ts: by[r["season_year"]].append(r)
    pay=[]
    for yr,rows in by.items():
        rows.sort(key=lambda x:-x["srs"])
        for i,r in enumerate(rows):
            pay.append({"season_year":yr,"team":r["team"],"tier":tier(i+1)})
    from collections import Counter
    print(f"{len(pay)} team-seasons | tier spread {dict(Counter(p['tier'] for p in pay))}")
    if not write: print("DRY RUN — pass --write"); return
    ok=0
    for j in range(0,len(pay),500):
        b=pay[j:j+500]
        r=requests.post(f"{SB}/rest/v1/team_seasons?on_conflict=season_year,team",
            headers={**H,"Prefer":"resolution=merge-duplicates,return=minimal"},json=b,timeout=90)
        if r.status_code in (200,201,204): ok+=len(b)
        else: print(f"  ERR {r.status_code}: {r.text[:150]}"); break
        time.sleep(0.04)
    print(f"  wrote {ok}")
if __name__=="__main__": main(write="--write" in sys.argv)
