#!/usr/bin/env python3
"""NIL valuation (article framework) with a COMPOSITE impact metric instead of raw BPM.

 impact = blend of BPM + WS/40 + PER + TDC grade (grade itself already encodes usage,
 TS%, rate stats, Wins Added and team success), z-scored over the qualified pool and
 mapped back onto the BPM / net-rating-per-100 scale so replacement (-1) and the
 framework math still hold.

 value = max(0, impact - replacement) * (MPG/40) * market $/point
 team budget = NIL-tier midpoint; market $/point = median(budget / roster production).

Run to refresh nil-data.json + print the constants to bake into tdc-nil.js."""
import re,requests,statistics,json,os
from collections import defaultdict
SB="https://izlqhnxowdhtdofkwrho.supabase.co"
key=re.search(r'SB_KEY\s*=\s*"(sb_secret_[^"]+)"',open("load_supabase.py").read()).group(1)
H={"apikey":key,"Authorization":f"Bearer {key}"}
REPL=-1.0
TIER_MID={1:22.5,2:18,3:13.5,4:10,5:7.5,6:5,7:3,8:1.25,9:0.25}  # $M midpoints
# composite-impact weights (renormalized over whatever components a player has)
W={"bpm":0.40,"grade":0.30,"ws40":0.20,"per":0.10}
def gnum(x):
    try: return float(x)
    except: return None
def fetch(u):
    r=[]; s=0
    while True:
        b=requests.get(f"{SB}/rest/v1/{u}",headers={**H,"Range-Unit":"items","Range":f"{s}-{s+999}"},timeout=90).json()
        if not isinstance(b,list) or not b: break
        r+=b; s+=1000
        if len(b)<1000: break
    return r
def tier_num(t):
    if t is None: return None
    m=re.search(r'(\d+)',str(t)); return int(m.group(1)) if m else None

# ── 1) pool stats for the composite (qualified seasons, mpg>=8) ──
pool=[]
for r in fetch("bbref_seasons?select=advanced,pergame,tdc_grade&tdc_grade=not.is.null"):
    a=r.get("advanced") or {}; pg=r.get("pergame") or {}
    mp=gnum(pg.get("mp_per_g"))
    if mp is None or mp<8: continue
    pool.append((gnum(a.get("bpm")),gnum(a.get("ws_per_40")),gnum(a.get("per")),gnum(r.get("tdc_grade"))))
print(f"pool: {len(pool):,} qualified seasons")
def mstd(vals):
    vals=[v for v in vals if v is not None]
    return (statistics.mean(vals), statistics.pstdev(vals) or 1.0)
M={"bpm":mstd([p[0] for p in pool]),"ws40":mstd([p[1] for p in pool]),
   "per":mstd([p[2] for p in pool]),"grade":mstd([p[3] for p in pool])}
def z(key,v):
    if v is None: return None
    m,s=M[key]; return (v-m)/s
def cz_of(bpm,ws40,per,grade):
    parts=[]
    for k,v in (("bpm",bpm),("ws40",ws40),("per",per),("grade",grade)):
        zz=z(k,v)
        if zz is not None: parts.append((W[k],zz))
    if not parts: return None
    return sum(w*zz for w,zz in parts)/sum(w for w,_ in parts)
czs=[c for c in (cz_of(*p) for p in pool) if c is not None]
CZM,CZS=statistics.mean(czs),(statistics.pstdev(czs) or 1.0)
MB,SB_=M["bpm"]
def impact(bpm,ws40,per,grade):
    cz=cz_of(bpm,ws40,per,grade)
    if cz is None: return None
    return MB + SB_*((cz-CZM)/CZS)   # composite, on the BPM/per-100 scale

# ── 2) current rosters: latest actual season stats by espn_id ──
bb={}
for r in fetch("bbref_seasons?select=espn_id,advanced,pergame,tdc_grade&season_year=eq.2026&espn_id=not.is.null"):
    a=r.get("advanced") or {}; pg=r.get("pergame") or {}
    bb[int(r["espn_id"])]=(gnum(a.get("bpm")),gnum(a.get("ws_per_40")),gnum(a.get("per")),
                           gnum(r.get("tdc_grade")),gnum(pg.get("mp_per_g")))
teams=fetch("teams?select=name,nil_tier,conf"); tinfo={t["name"]:t for t in teams if t.get("nil_tier")}
srs={}
for r in fetch("team_seasons?select=team,srs&season_year=eq.2026&srs=not.is.null"): srs[r["team"]]=gnum(r["srs"])
def team_srs(bare):
    if bare in srs: return srs[bare]
    for k,v in srs.items():
        if k.startswith(bare+" ") or k==bare: return v
    return None
players=fetch("players?select=name,team,espn_id,mpg,tdc_grade,starter,depth_order&tdc_grade=not.is.null")
ros=defaultdict(list)
for p in players:
    if p["team"] in tinfo: ros[p["team"]].append(p)
def player_impact_mpg(p):
    eid=p.get("espn_id"); g=gnum(p.get("tdc_grade"))
    proj=impact(None,None,None,g)                              # 2026-27 projection from grade
    if eid and int(eid) in bb:
        bp,ws,pr,ga,mp=bb[int(eid)]
        proven=impact(bp,ws,pr,ga)                             # last actual season composite
        imp=((proven+proj)/2.0) if (proven is not None and proj is not None) else (proven or proj)  # BLEND
        return imp, (mp if mp else gnum(p.get("mpg")) or 0)
    mp=gnum(p.get("mpg")) or (26 if str(p.get("starter")).lower() in("true","yes","1") else 14)
    return proj, mp                                            # freshman/transfer: grade only
def contribution(p):
    imp,mp=player_impact_mpg(p)
    if imp is None: imp=REPL
    return max(0.0,(imp-REPL))*min(max(mp,0)/40.0,1.0), imp, mp

# ── 3) per-team production, market rate, verdicts ──
rows=[]
for name,info in tinfo.items():
    budget=TIER_MID.get(tier_num(info["nil_tier"]))
    if not budget: continue
    prod=0; pls=[]
    for p in ros.get(name,[]):
        c,imp,mp=contribution(p); prod+=c; pls.append((p["name"],imp,mp,c))
    if prod<=0.5: continue
    rows.append({"name":name,"tier":tier_num(info["nil_tier"]),"budget":budget,"prod":prod,
                 "implied":budget/prod,"srs":team_srs(name),"pls":pls})
MKT=statistics.median(r["implied"] for r in rows)
out={"market_rate_per_pt":round(MKT,4),"replacement":REPL,"tier_budget_m":TIER_MID,
     "impact":{"w":W,"mean":{k:round(M[k][0],4) for k in M},"std":{k:round(M[k][1],4) for k in M},
               "cz_mean":round(CZM,5),"cz_std":round(CZS,5)},"teams":{}}
for r in rows:
    val=r["prod"]*MKT
    pls=sorted([{"name":n,"impact":round(imp,1),"mpg":round(mp,1),"value":round(c*MKT,3)} for n,imp,mp,c in r["pls"]],
               key=lambda x:-x["value"])
    out["teams"][r["name"]]={"tier":r["tier"],"budget":r["budget"],"value":round(val,2),
        "production":round(r["prod"],2),"implied_rate":round(r["implied"],4),"srs":r["srs"],
        "verdict":"deal" if val>r["budget"] else "expensive","diff":round(val-r["budget"],2),"players":pls}
json.dump(out,open(os.path.join(os.path.dirname(__file__),"..","nil-data.json"),"w"),separators=(',',':'))
deals=sum(1 for r in rows if r["prod"]*MKT>r["budget"])
print(f"teams valued: {len(rows)} | DEALS {deals}/{len(rows)} | MARKET=${MKT*1000:.0f}K/pt")
print("\n--- paste into tdc-nil.js TDC_NIL ---")
print(f"MARKET_RATE:{round(MKT,4)}, REPL:{REPL},")
print(f"IMPACT:{json.dumps(out['impact'])},")
print(f"TIER_BUDGET:{json.dumps(TIER_MID)}")
