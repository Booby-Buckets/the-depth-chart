#!/usr/bin/env python3
"""NIL valuation model (per the article framework, using our data).
 value = (BPM - replacement) * (MPG/40) * $/point
 team budget = NIL-tier midpoint; market $/point = median(budget/production).
Run to print a sanity table + the derived market rate."""
import re,requests,statistics
from collections import defaultdict
SB="https://izlqhnxowdhtdofkwrho.supabase.co"
key=re.search(r'SB_KEY\s*=\s*"(sb_secret_[^"]+)"',open("load_supabase.py").read()).group(1)
H={"apikey":key,"Authorization":f"Bearer {key}"}
REPL=-1.0
TIER_MID={1:22.5,2:18,3:13.5,4:10,5:7.5,6:5,7:3,8:1.25,9:0.25}  # $M midpoints (Tier1 $20M+ -> 22.5)
def gnum(x):
    try: return float(x)
    except: return None
def fetch(u):
    r=[]; s=0
    while True:
        b=requests.get(f"{SB}/rest/v1/{u}",headers={**H,"Range-Unit":"items","Range":f"{s}-{s+999}"},timeout=60).json()
        if not isinstance(b,list) or not b: break
        r+=b; s+=1000
        if len(b)<1000: break
    return r
def tier_num(t):
    if t is None: return None
    m=re.search(r'(\d+)',str(t)); return int(m.group(1)) if m else None
# 1) bbref 2025-26 (season 2026) BPM + mpg by espn_id  (proxy for 2026-27 returners)
bb={}; pairs=[]
for r in fetch("bbref_seasons?select=espn_id,advanced,pergame,tdc_grade&season_year=eq.2026&espn_id=not.is.null"):
    a=r.get("advanced") or {}; pg=r.get("pergame") or {}
    bp=gnum(a.get("bpm")); mp=gnum(pg.get("mp_per_g")); g=gnum(r.get("tdc_grade"))
    if bp is not None:
        bb[int(r["espn_id"])]=(bp,mp)
        if g is not None: pairs.append((g,bp))
# linear fit: projected bpm = SLOPE*(grade-78)
sx=sum((g-78)**2 for g,_ in pairs); SLOPE=(sum((g-78)*b for g,b in pairs)/sx) if sx else 0.6
def grade2bpm(g): return SLOPE*((g if g else 78)-78)
# 2) teams with a NIL tier
teams=fetch("teams?select=name,nil_tier,conf")
tinfo={t["name"]:t for t in teams if t.get("nil_tier")}
# 3) SRS (current season) by team name -> need team_seasons; match bare->mascot loosely via startswith
srs={}
for r in fetch("team_seasons?select=team,srs&season_year=eq.2026&srs=not.is.null"):
    srs[r["team"]]=gnum(r["srs"])
def team_srs(bare):
    if bare in srs: return srs[bare]
    for k,v in srs.items():
        if k.startswith(bare+" ") or k==bare: return v
    return None
# 4) rosters
players=fetch("players?select=name,team,espn_id,mpg,tdc_grade,starter,depth_order&tdc_grade=not.is.null")
ros=defaultdict(list)
for p in players:
    if p["team"] in tinfo: ros[p["team"]].append(p)
def player_bpm_mpg(p):
    eid=p.get("espn_id"); g=gnum(p.get("tdc_grade")) or 75
    proj=grade2bpm(g)                                   # projected from TDC grade
    if eid and int(eid) in bb:
        bp,mp=bb[int(eid)]
        return (bp+proj)/2.0, (mp if mp else gnum(p.get("mpg")) or 0)   # BLEND proven + projected
    mp=gnum(p.get("mpg")) or (26 if str(p.get("starter")).lower() in("true","yes","1") else 14)
    return proj, mp                                     # freshman/transfer: projected only
def contribution(p):
    bp,mp=player_bpm_mpg(p)
    return max(0.0,(bp-REPL))*min(max(mp,0)/40.0,1.0), bp, mp
# 5) per-team production + implied rate
rows=[]
for name,info in tinfo.items():
    tn=tier_num(info["nil_tier"]); budget=TIER_MID.get(tn)
    if not budget: continue
    prod=0; pls=[]
    for p in ros.get(name,[]):
        c,bp,mp=contribution(p); prod+=c; pls.append((p["name"],bp,mp,c))
    if prod<=0.5: continue
    implied=budget/prod
    rows.append({"name":name,"tier":tn,"budget":budget,"prod":prod,"implied":implied,"srs":team_srs(name),"pls":pls})
MKT=statistics.median(r["implied"] for r in rows)
import json,os
out={"market_rate_per_pt":round(MKT,4),"grade_bpm_slope":round(SLOPE,4),"replacement":REPL,
     "tier_budget_m":TIER_MID,"teams":{}}
for r in rows:
    val=r["prod"]*MKT
    pls=sorted([{"name":n,"bpm":round(bp,1),"mpg":round(mp,1),"value":round(c*MKT,3)} for n,bp,mp,c in r["pls"]],
               key=lambda x:-x["value"])
    out["teams"][r["name"]]={"tier":r["tier"],"budget":r["budget"],"value":round(val,2),
        "production":round(r["prod"],2),"implied_rate":round(r["implied"],4),"srs":r["srs"],
        "verdict":"deal" if val>r["budget"] else "expensive","diff":round(val-r["budget"],2),"players":pls}
json.dump(out,open(os.path.join(os.path.dirname(__file__),"..","nil-data.json"),"w"),separators=(',',':'))
deals=sum(1 for r in rows if r["prod"]*MKT>r["budget"])
print(f"teams valued: {len(rows)} | DEALS {deals}/{len(rows)} | MARKET=${MKT*1000:.0f}K/pt | slope={SLOPE:.2f} | wrote ../nil-data.json")
