#!/usr/bin/env python3
"""
Diagnose + simulate the all-time ranking rebalance.

Problem: 2026-27 projected (players table, manual grades w/ scouting bump)
dominate the all-time top; historical seasons (player_history, pure-stat
model grades) sit too low. Simulate: historical += BUMP, current -= DROP,
then show the merged top-N to pick magnitudes.

  python3 rank_rebalance.py            # diagnose + simulate
"""
import os, sys, time
from collections import defaultdict
import requests, pandas as pd

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":KEY,"Authorization":f"Bearer {KEY}"}

def fetch_all(url):
    rows,pg,PG=[],0,1000
    while True:
        r=requests.get(url,headers={**H,"Range-Unit":"items","Range":f"{pg*PG}-{pg*PG+PG-1}"},timeout=60)
        b=r.json()
        if not isinstance(b,list) or not b: break
        rows.extend(b)
        if len(b)<PG: break
        pg+=1
    return rows

def season(yr): yr=int(yr); return f"{str(yr-1)[-2:]}-{str(yr)[-2:]}"

def build(bump, drop):
    cur=pd.DataFrame(fetch_all(f"{SB}/rest/v1/players?select=name,team,tdc_grade,ppg,rpg,apg&tdc_grade=not.is.null"))
    his=pd.DataFrame(fetch_all(f"{SB}/rest/v1/player_history?select=name,season_year,team,tdc_grade,ppg,rpg,apg,gp&tdc_grade=not.is.null"))
    cur["g"]=pd.to_numeric(cur.tdc_grade,errors="coerce"); his["g"]=pd.to_numeric(his.tdc_grade,errors="coerce")
    his["gp"]=pd.to_numeric(his.gp,errors="coerce").fillna(0)
    # dedup history within (name, season) keep max gp
    his=his.sort_values("gp").drop_duplicates(["name","season_year"],keep="last")
    cur=cur.dropna(subset=["g"]); his=his.dropna(subset=["g"])
    ents=[]
    for _,r in cur.iterrows():
        ents.append({"name":r["name"],"season":"26-27","team":r.team,"g0":r.g,
                     "g":min(99,r.g-drop),"ppg":r.ppg,"rpg":r.rpg,"apg":r.apg,"cur":True})
    for _,r in his.iterrows():
        ents.append({"name":r["name"],"season":season(r.season_year),"team":r.team,"g0":r.g,
                     "g":min(99,r.g+bump),"ppg":r.ppg,"rpg":r.rpg,"apg":r.apg,"cur":False})
    df=pd.DataFrame(ents).sort_values("g",ascending=False).reset_index(drop=True)
    return df

def show(df,label,n=25):
    top=df.head(n)
    ncur=top.cur.sum()
    print(f"\n=== {label} — top {n}: {ncur} current / {n-ncur} historical ===")
    for i,(_,r) in enumerate(top.iterrows(),1):
        tag="26-27 PROJ" if r.cur else r.season
        print(f"  {i:2d}. {int(r.g):2d}  {r['name'][:22]:22s} {tag:8s} {str(r.team)[:20]:20s} "
              f"{r.ppg:.1f}/{r.rpg:.1f}/{r.apg:.1f}")

def patch_val(table, old, new):
    r=requests.patch(f"{SB}/rest/v1/{table}?tdc_grade=eq.{old}",
        headers={**H,"Content-Type":"application/json","Prefer":"return=minimal"},
        json={"tdc_grade":str(new)},timeout=60)
    if r.status_code not in (200,204): print(f"  ERR {table} {old}->{new}: {r.status_code} {r.text[:120]}")
    time.sleep(0.05)

def apply(bump, drop):
    # history += bump (descending so a value isn't bumped twice)
    for g in range(99,39,-1):
        new=min(99,g+bump)
        if new!=g: patch_val("player_history",g,new)
    print(f"history bumped +{bump}")
    # current -= drop (ascending so a value isn't dropped twice)
    for g in range(40,100):
        new=max(40,g-drop)
        if new!=g: patch_val("players",g,new)
    print(f"current dropped -{drop}")

if __name__=="__main__":
    if "--write" in sys.argv:
        apply(3,2)
        show(build(0,0),"AFTER WRITE — top 25")
    else:
        base=build(0,0)
        show(base,"CURRENT (no change)")
        for bump,drop in [(3,2),(5,2),(4,3)]:
            show(build(bump,drop),f"SIM bump=+{bump} historical, drop=-{drop} current")
