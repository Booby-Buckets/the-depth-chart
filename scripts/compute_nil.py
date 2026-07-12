#!/usr/bin/env python3
"""NIL valuation (article bottom-up framework) + a MARKET-PREMIUM layer.

 analytical = max(0, impact - replacement) * (MPG/40) * market $/point
   impact = composite of BPM + WS/40 + PER + TDC grade (grade encodes usage, TS%,
   rates, Wins Added, team success), z-scored over the pool, mapped to the BPM scale.
 market premium = size(height, relative to POSITION) * hype * conference -- the things
   the NIL market over/under-pays for beyond pure on-court impact.
   hype = Offense-pillar z-score (efficiency-aware, replaces raw PPG when a player
   has a grade_pillars row) * Usage-pillar z-score (ball's-in-his-hands premium,
   upside only) * Defense-pillar z-score (mild DISCOUNT — the real market chronically
   underpays defense relative to what BPM/WS already credit it; downside only).
   Falls back to raw-PPG scoring when a player has no bbref match (freshmen, no
   prior D1 season) — see score_mult().
 value = analytical * premium ; market $/point = median(budget / premium-weighted production).

Run to refresh nil-data.json + print constants for tdc-nil.js."""
import re,requests,statistics,json,os
from collections import defaultdict
SB="https://izlqhnxowdhtdofkwrho.supabase.co"
key=re.search(r'SB_KEY\s*=\s*"(sb_secret_[^"]+)"',open("load_supabase.py").read()).group(1)
H={"apikey":key,"Authorization":f"Bearer {key}"}
REPL=-1.0
FLOOR_PTS=1.6      # rotation-body floor: a player who plays is worth >= this many net pts (×minutes×premium)
WALKON_THR=-6.0    # impact below this = walk-on / non-rotation: nominal value, excluded from roster spend
WALKON_VALUE=0.01  # $M nominal ($10K) for walk-ons
TIER_MID={1:22.5,2:18,3:13.5,4:10,5:7.5,6:5,7:3,8:1.25,9:0.25}
W={"bpm":0.40,"grade":0.30,"ws40":0.20,"per":0.10}
# market-premium knobs
# size is judged RELATIVE TO POSITION, not on one flat curve — a 6'6" PG (rare,
# versatile, hyped) and a 6'6" C (undersized for the 5) are opposite stories,
# but a flat height curve pays them the same. Norms are rough position averages
# in inches; unknown/CG-type positions fall back to the old flat baseline.
POS_HT_NORM={"PG":74.0,"CG":75.0,"SG":76.0,"SF":78.5,"PF":80.5,"C":82.5,"G":75.0,"F":79.0}
SIZE_FALLBACK=75.0
SIZE_UP_SPAN,SIZE_UP=10.0,0.40      # +10in above your position's norm = full +40% (big-man/unicorn premium)
SIZE_DOWN_SPAN,SIZE_DOWN=6.0,0.40   # -6in below your position's norm = full -40% (undersized discount)
SCORE_BASE,SCORE_TOP,SCORE_MAX=12.0,27.0,0.18   # fallback ONLY for players with no grade_pillars (no bbref match)
CONF_MULT={"P":1.12,"M":1.00,"L":0.90}
# pillar-driven premium (scripts/grade_v4.py's 7-pillar z-scores, persisted to
# bbref_seasons.grade_pillars) — replaces raw-PPG hype with the same
# efficiency-aware Offense pillar the grade engine uses; adds a Usage-based
# "ball's in his hands" hype premium; and a Defense-based discount, because
# the real NIL market chronically underpays defense relative to what
# production models (BPM/WS) already credit it. Each is a clamped-linear
# function of the pillar's z-score, capped so extreme outliers don't run away.
OFF_SPAN,OFF_UP,OFF_DOWN_SPAN,OFF_DOWN=2.5,0.22,2.5,0.15   # asymmetric: great box score helps more than a bad one hurts
USG_SPAN,USG_UP=2.5,0.15                                    # upside only — low usage isn't further penalized (already reflected in production)
DEF_SPAN,DEF_DOWN=2.5,0.10                                  # downside only — no bonus for good D, capped modest discount
# roster-spot base + rate scale with the team's SPENDING TIER (not conference) — a low-budget
# power-conf program (e.g. Notre Dame, ACC but Tier 7) pays like its tier, not its league.
BASE_BY_TIER={1:0.90,2:0.80,3:0.55,4:0.40,5:0.27,6:0.18,7:0.10,8:0.04,9:0.015}  # $M base (×minutes)
RATE_BY_TIER={1:1.0,2:1.0,3:0.92,4:0.84,5:0.74,6:0.64,7:0.55,8:0.42,9:0.32}      # rate multiplier by tier
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
def size_mult(h,pos=None):
    if not h: return 1.0
    norm=POS_HT_NORM.get((pos or "").upper().strip(),SIZE_FALLBACK)
    d=h-norm
    if d>=0: return 1+min(d/SIZE_UP_SPAN,1)*SIZE_UP              # tall for the position: premium
    return 1-min((-d)/SIZE_DOWN_SPAN,1)*SIZE_DOWN                # short for the position: discount
def score_mult(p): return 1.0 if not p   else 1+min(max((p-SCORE_BASE)/(SCORE_TOP-SCORE_BASE),0),1)*SCORE_MAX
def offense_mult(z):
    if z is None: return None
    return 1+min(z/OFF_SPAN,1)*OFF_UP if z>=0 else 1+max(z/OFF_DOWN_SPAN,-1)*OFF_DOWN
def usage_mult(z):
    if z is None: return 1.0
    return 1+min(max(z/USG_SPAN,0),1)*USG_UP
def defense_mult(z):
    if z is None: return 1.0
    return 1-min(max(z/DEF_SPAN,0),1)*DEF_DOWN
def premium(h,ppg,cls,pos=None,pillars=None):
    off=offense_mult((pillars or {}).get("offense"))
    hype = off if off is not None else score_mult(ppg)   # fall back to raw-PPG when no pillar data
    hype *= usage_mult((pillars or {}).get("usage")) * defense_mult((pillars or {}).get("defense"))
    return size_mult(h,pos)*hype*CONF_MULT.get(cls,1.0)

# (grade-centric model — no BPM-impact pool needed; grade IS the talent/hype signal)

# ── 2) current rosters ──
bb={}
for r in fetch("bbref_seasons?select=espn_id,advanced,pergame,tdc_grade,height,grade_pillars&season_year=eq.2026&espn_id=not.is.null"):
    a=r.get("advanced") or {}; pg=r.get("pergame") or {}
    bb[int(r["espn_id"])]=(gnum(a.get("bpm")),gnum(a.get("ws_per_40")),gnum(a.get("per")),
        gnum(r.get("tdc_grade")),gnum(pg.get("mp_per_g")),ht_in(r.get("height")),gnum(pg.get("pts_per_g")),
        r.get("grade_pillars") or {})
teams=fetch("teams?select=name,nil_tier,conference"); tinfo={t["name"]:t for t in teams if t.get("nil_tier")}
srs={}
for r in fetch("team_seasons?select=team,srs&season_year=eq.2026&srs=not.is.null"): srs[r["team"]]=gnum(r["srs"])
def team_srs(b):
    if b in srs: return srs[b]
    for k,v in srs.items():
        if k.startswith(b+" ") or k==b: return v
    return None
players=fetch("players?select=name,team,espn_id,mpg,tdc_grade,starter,height,ppg,position,class_year&tdc_grade=not.is.null")
ros=defaultdict(list)
for p in players:
    if p["team"] in tinfo: ros[p["team"]].append(p)
# ── GRADE-CENTRIC MARKET MODEL ────────────────────────────────────────────────
# The real NIL market pays for TALENT + HYPE + ROLE, scaled by the school's spend.
# The TDC grade is the stable talent/hype signal (it already encodes usage, TS%,
# recruiting projection for freshmen, team success) — far better than a noisy,
# small-sample BPM that made bench bigs out-value stars. Value is a convex curve of
# grade (stars are worth exponentially more), times projected minutes (role), times
# the team's spending tier, times a market premium (size/scoring/conf) and a youth
# bump (the market pays for upside). Calibrated to real NIL anchors.
GRADE_FLOOR,GRADE_SPAN,CURVE = 58.0, 40.0, 2.35
TOP_M = 4.35                                    # $M for a grade-98, tier-1, full-min, avg-premium player
TIER_MULT = {1:1.00,2:0.74,3:0.54,4:0.40,5:0.29,6:0.20,7:0.13,8:0.07,9:0.03}
def grade_base(g):
    if g is None: return 0.0
    x=max(0.0,min(1.0,(g-GRADE_FLOOR)/GRADE_SPAN)); return x**CURVE
def min_factor(mp):
    return max(0.30,(min(max(mp,0),34)/34.0)**0.55)   # rotation floor 0.30, full at 34 mpg
def est_mpg(p):
    mp=gnum(p.get("mpg"))
    if mp and mp>0: return mp
    g=gnum(p.get("tdc_grade")) or 72; st=str(p.get("starter")).lower() in("true","yes","1")
    base=28 if g>=88 else 24 if g>=82 else 20 if g>=76 else 15
    return base if (st or g>=82) else max(12,base-4)
def youth_mult(cls):
    c=(cls or "").lower()
    if "fr" in c: return 1.10
    if "so" in c: return 1.05
    if "sr" in c or "gr" in c: return 0.97
    return 1.0

rows=[]
for name,info in tinfo.items():
    budget=TIER_MID.get(tier_num(info["nil_tier"]))
    if not budget: continue
    tn=tier_num(info["nil_tier"]); cls=conf_class(info.get("conference")); tmult=TIER_MULT.get(tn,0.2)
    prod=0; pls=[]
    for p in ros.get(name,[]):
        g=gnum(p.get("tdc_grade")); pos=p.get("position"); mp=est_mpg(p); eid=p.get("espn_id")
        if eid and int(eid) in bb:
            bp,ws,pr,ga,mpb,htb,ppgb,pillars=bb[int(eid)]
            prem=premium(htb,ppgb,cls,pos,pillars)
        else:
            prem=premium(ht_in(p.get("height")),gnum(p.get("ppg")),cls,pos)
        base=grade_base(g)
        if base<=0.003 or g is None:            # sub-rotation / very low grade: nominal only
            pls.append((p["name"],g,mp,prem,0.0,True)); continue
        val=base*TOP_M*tmult*min_factor(mp)*prem*youth_mult(p.get("class_year"))
        prod+=val; pls.append((p["name"],g,mp,prem,round(val,3),False))
    if prod<=0.05: continue
    rows.append({"name":name,"tier":tn,"budget":budget,"prod":prod,"srs":team_srs(name),"cls":cls,"pls":pls})
MKT=0.263   # base rate from real salary data (Tennessee anchors); RATE_BY_TIER scales it per team
# manual overrides (injury risk, versatility, hyped recruits, non-D1 transfers) — things the model can't see
OVR={}
_ovp=os.path.join(os.path.dirname(__file__),"..","nil-overrides.json")
if os.path.exists(_ovp):
    try: OVR={k:v["value"] for k,v in (json.load(open(_ovp)).get("by_name") or {}).items() if isinstance(v,dict) and "value" in v}
    except Exception: OVR={}
def pval(n,proj): return OVR[n] if n in OVR else proj
out={"market_rate_per_pt":round(MKT,4),"walkon_value":WALKON_VALUE,"tier_budget_m":TIER_MID,
     "model":{"grade_floor":GRADE_FLOOR,"grade_span":GRADE_SPAN,"curve":CURVE,"top_m":TOP_M,"tier_mult":TIER_MULT},
     "premium":{"pos_ht_norm":POS_HT_NORM,"size_fallback":SIZE_FALLBACK,"size_up":[SIZE_UP_SPAN,SIZE_UP],"size_down":[SIZE_DOWN_SPAN,SIZE_DOWN],
                "score":[SCORE_BASE,SCORE_TOP,SCORE_MAX],"conf":CONF_MULT,
                "offense":[OFF_SPAN,OFF_UP,OFF_DOWN_SPAN,OFF_DOWN],"usage":[USG_SPAN,USG_UP],"defense":[DEF_SPAN,DEF_DOWN]},
     "teams":{}}
out["overrides"]=OVR
for r in rows:
    pls=[]
    for n,g,mp,prem,v,wo in r["pls"]:
        proj=WALKON_VALUE if wo else v; val=pval(n,proj)
        pls.append({"name":n,"grade":(round(g) if g is not None else None),"mpg":round(mp,1),"prem":round(prem,2),
            "proj":round(proj,3),"value":round(val,3),"payDiff":round(val-proj,3),"walkon":wo,"override":(n in OVR)})
    pls.sort(key=lambda x:-x["value"])
    val=round(sum(p["value"] for p in pls),2)      # team value = sum of player values (reflects overrides)
    projSpend=round(sum(p["proj"] for p in pls),2) # team's own model estimate, ignoring known real deals
    out["teams"][r["name"]]={"tier":r["tier"],"budget":r["budget"],"value":val,"projected_spend":projSpend,
        "production":round(r["prod"],2),
        "implied_rate":round(r["budget"]/(r["prod"] or 1),4),"srs":r["srs"],"verdict":"deal" if val<=r["budget"] else "expensive",
        "diff":round(val-r["budget"],2),"players":pls}
json.dump(out,open(os.path.join(os.path.dirname(__file__),"..","nil-data.json"),"w"),separators=(',',':'))
fits=sum(1 for r in rows if round(sum(pv[4] for pv in r["pls"]),2)<=r["budget"])
print(f"teams: {len(rows)} | within budget {fits}/{len(rows)}")
print("\n--- model constants (mirror in tdc-nil.js) ---")
print(json.dumps(out["model"]))
# quick sanity: top values overall + a few rosters
allp=sorted(([p["name"],p["value"],p.get("grade"),tm] for tm,t in out["teams"].items() for p in t["players"]),key=lambda x:-x[1])
print("\nTOP 12 NIL values:")
for n,v,g,tm in allp[:12]: print(f"  {n[:22]:22} ${v:>5.2f}M  grade {g}  {tm}")
