#!/usr/bin/env python3
"""NIL valuation (article bottom-up framework) + a MARKET-PREMIUM layer.

 analytical = max(0, impact - replacement) * (MPG/40) * market $/point
   impact = composite of BPM + WS/40 + PER + TDC grade (grade encodes usage, TS%,
   rates, Wins Added, team success), z-scored over the pool, mapped to the BPM scale.
 market premium = size(height) * scoring(PPG) * conference  -- the things the NIL
   market over-pays for beyond pure on-court impact.
 value = analytical * premium ; market $/point = median(budget / premium-weighted production).

Run to refresh nil-data.json + print constants for tdc-nil.js."""
import re,requests,statistics,json,os
from collections import defaultdict
SB="https://izlqhnxowdhtdofkwrho.supabase.co"
key=re.search(r'SB_KEY\s*=\s*"(sb_secret_[^"]+)"',open("load_supabase.py").read()).group(1)
H={"apikey":key,"Authorization":f"Bearer {key}"}
REPL=-1.0
TIER_MID={1:22.5,2:18,3:13.5,4:10,5:7.5,6:5,7:3,8:1.25,9:0.25}
W={"bpm":0.40,"grade":0.30,"ws40":0.20,"per":0.10}
# market-premium knobs
SIZE_BASE,SIZE_TOP,SIZE_MAX=76.0,88.0,0.20   # 6'4"=1.0 ... 7'4"+ = +20%
SCORE_BASE,SCORE_TOP,SCORE_MAX=12.0,27.0,0.18
CONF_MULT={"P":1.12,"M":1.00,"L":0.90}
def gnum(x):
    try: return float(x)
    except: return None
def ht_in(h):
    if not h: return None
    m=re.match(r'\s*(\d+)\s*[-’\']\s*(\d+)',str(h))
    return (int(m.group(1))*12+int(m.group(2))) if m else None
def fetch(u):
    r=[]; s=0
    while True:
        b=requests.get(f"{SB}/rest/v1/{u}",headers={**H,"Range-Unit":"items","Range":f"{s}-{s+999}"},timeout=90).json()
        if not isinstance(b,list) or not b: break
        r+=b; s+=1000
        if len(b)<1000: break
    return r
def tier_num(t):
    m=re.search(r'(\d+)',str(t)) if t is not None else None; return int(m.group(1)) if m else None
def conf_class(c):
    c=(c or "").lower()
    if any(k in c for k in ["big ten","big 12","southeastern","big east","atlantic coast"]) or c in("acc","sec","b10","b12","be"): return "P"
    if any(k in c for k in ["american","atlantic 10","mountain west","west coast","conference usa","sun belt","mid-american","missouri valley"]) or c in("aac","a10","mwc","wcc"): return "M"
    return "L"
def size_mult(h):  return 1.0 if not h   else 1+min(max((h-SIZE_BASE)/(SIZE_TOP-SIZE_BASE),0),1)*SIZE_MAX
def score_mult(p): return 1.0 if not p   else 1+min(max((p-SCORE_BASE)/(SCORE_TOP-SCORE_BASE),0),1)*SCORE_MAX
def premium(h,ppg,cls): return size_mult(h)*score_mult(ppg)*CONF_MULT.get(cls,1.0)

# ── 1) composite-impact pool stats (mpg>=8) ──
pool=[]
for r in fetch("bbref_seasons?select=advanced,pergame,tdc_grade&tdc_grade=not.is.null"):
    a=r.get("advanced") or {}; pg=r.get("pergame") or {}; mp=gnum(pg.get("mp_per_g"))
    if mp is None or mp<8: continue
    pool.append((gnum(a.get("bpm")),gnum(a.get("ws_per_40")),gnum(a.get("per")),gnum(r.get("tdc_grade"))))
def mstd(v):
    v=[x for x in v if x is not None]; return (statistics.mean(v), statistics.pstdev(v) or 1.0)
M={"bpm":mstd([p[0] for p in pool]),"ws40":mstd([p[1] for p in pool]),"per":mstd([p[2] for p in pool]),"grade":mstd([p[3] for p in pool])}
def z(k,v): return None if v is None else (v-M[k][0])/M[k][1]
def cz_of(b,w,p,g):
    parts=[(W[k],z(k,v)) for k,v in (("bpm",b),("ws40",w),("per",p),("grade",g)) if z(k,v) is not None]
    return None if not parts else sum(w*zz for w,zz in parts)/sum(w for w,_ in parts)
czs=[c for c in (cz_of(*p) for p in pool) if c is not None]
CZM,CZS=statistics.mean(czs),(statistics.pstdev(czs) or 1.0); MB,SB_=M["bpm"]
def impact(b,w,p,g):
    cz=cz_of(b,w,p,g); return None if cz is None else MB+SB_*((cz-CZM)/CZS)
print(f"pool: {len(pool):,} seasons")

# ── 2) current rosters ──
bb={}
for r in fetch("bbref_seasons?select=espn_id,advanced,pergame,tdc_grade,height&season_year=eq.2026&espn_id=not.is.null"):
    a=r.get("advanced") or {}; pg=r.get("pergame") or {}
    bb[int(r["espn_id"])]=(gnum(a.get("bpm")),gnum(a.get("ws_per_40")),gnum(a.get("per")),
        gnum(r.get("tdc_grade")),gnum(pg.get("mp_per_g")),ht_in(r.get("height")),gnum(pg.get("pts_per_g")))
teams=fetch("teams?select=name,nil_tier,conference"); tinfo={t["name"]:t for t in teams if t.get("nil_tier")}
srs={}
for r in fetch("team_seasons?select=team,srs&season_year=eq.2026&srs=not.is.null"): srs[r["team"]]=gnum(r["srs"])
def team_srs(b):
    if b in srs: return srs[b]
    for k,v in srs.items():
        if k.startswith(b+" ") or k==b: return v
    return None
players=fetch("players?select=name,team,espn_id,mpg,tdc_grade,starter,height,ppg&tdc_grade=not.is.null")
ros=defaultdict(list)
for p in players:
    if p["team"] in tinfo: ros[p["team"]].append(p)
def evalp(p,cls):
    eid=p.get("espn_id"); g=gnum(p.get("tdc_grade")); proj=impact(None,None,None,g)
    if eid and int(eid) in bb:
        bp,ws,pr,ga,mp,ht,ppg=bb[int(eid)]
        proven=impact(bp,ws,pr,ga)
        imp=((proven+proj)/2.0) if (proven is not None and proj is not None) else (proven or proj)
        return imp,(mp if mp else gnum(p.get("mpg")) or 0),premium(ht,ppg,cls)
    mp=gnum(p.get("mpg")) or (26 if str(p.get("starter")).lower() in("true","yes","1") else 14)
    return proj,mp,premium(ht_in(p.get("height")),gnum(p.get("ppg")),cls)

rows=[]
for name,info in tinfo.items():
    budget=TIER_MID.get(tier_num(info["nil_tier"]))
    if not budget: continue
    cls=conf_class(info.get("conference")); prod=0; pls=[]
    for p in ros.get(name,[]):
        imp,mp,prem=evalp(p,cls)
        if imp is None: imp=REPL
        c=max(0.0,(imp-REPL))*min(max(mp,0)/40.0,1.0)*prem
        prod+=c; pls.append((p["name"],imp,mp,prem,c))
    if prod<=0.5: continue
    rows.append({"name":name,"tier":tier_num(info["nil_tier"]),"budget":budget,"prod":prod,
                 "implied":budget/prod,"srs":team_srs(name),"cls":cls,"pls":pls})
MKT=statistics.median(r["implied"] for r in rows)
out={"market_rate_per_pt":round(MKT,4),"replacement":REPL,"tier_budget_m":TIER_MID,
     "impact":{"w":W,"mean":{k:round(M[k][0],4) for k in M},"std":{k:round(M[k][1],4) for k in M},
               "cz_mean":round(CZM,5),"cz_std":round(CZS,5)},
     "premium":{"size":[SIZE_BASE,SIZE_TOP,SIZE_MAX],"score":[SCORE_BASE,SCORE_TOP,SCORE_MAX],"conf":CONF_MULT},
     "teams":{}}
for r in rows:
    val=r["prod"]*MKT
    pls=sorted([{"name":n,"impact":round(imp,1),"mpg":round(mp,1),"prem":round(prem,2),"value":round(c*MKT,3)} for n,imp,mp,prem,c in r["pls"]],key=lambda x:-x["value"])
    out["teams"][r["name"]]={"tier":r["tier"],"budget":r["budget"],"value":round(val,2),"production":round(r["prod"],2),
        "implied_rate":round(r["implied"],4),"srs":r["srs"],"verdict":"deal" if val>r["budget"] else "expensive",
        "diff":round(val-r["budget"],2),"players":pls}
json.dump(out,open(os.path.join(os.path.dirname(__file__),"..","nil-data.json"),"w"),separators=(',',':'))
deals=sum(1 for r in rows if r["prod"]*MKT>r["budget"])
print(f"teams: {len(rows)} | DEALS {deals}/{len(rows)} | MARKET=${MKT*1000:.0f}K/pt")
print("\n--- tdc-nil.js constants ---")
print(f"MARKET_RATE:{round(MKT,4)},")
print(f"IMPACT:{json.dumps(out['impact'])},")
print(f"PREMIUM:{json.dumps(out['premium'])}")
