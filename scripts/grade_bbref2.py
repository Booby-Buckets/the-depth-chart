#!/usr/bin/env python3
"""
Grade v3 — keeps the proven per-game production backbone (grade_v2) and BLENDS in
an advanced-stats component (BPM, Win Shares, PER, usage + per-possession rates).
The advanced part is minutes-credibility weighted (so tiny-sample walk-ons don't
spike) and simply absent for early years where BBRef has no BPM/PER (those grade
on production alone, as before). Position-relative, tier-adjusted, cross-era.

  python3 grade_bbref2.py            # dry run
  python3 grade_bbref2.py --write
"""
import json, re, sys, time
from pathlib import Path
import numpy as np, pandas as pd, requests
import grade_conf as gc

DATA=Path(__file__).parent/"data"; SB="https://izlqhnxowdhtdofkwrho.supabase.co"
def _key():
    import os
    return os.environ.get("SUPABASE_SERVICE_KEY") or re.search(r'SB_KEY\s*=\s*"([^"]+)"',(DATA.parent/"load_supabase.py").read_text()).group(1)

BASE,SCALE=77.0,6.3
SOFT,R99,GHI=86.0,113.0,98.0
MIN_MPG=8
MIN_GP=13              # game cap: fewer games than this = no season grade (small sample)
CRED_MP=650.0          # total minutes for full advanced-stat credibility
ADV_W=0.85             # how much the advanced component counts vs production
PROD_W={"wa":1.7,"ppg":1.45,"ts":0.5,"rpg":0.32,"apg":0.55,"stl":0.18,"blk":0.18,"tovs":-0.18,"mpg":0.22,"team_srs":0.5,"usg":0.85}
LO_CLIP={"apg":0.0}    # assists are a pure bonus: reward playmakers (up to +4z), never punish non-passers
ADV_F ={"bpm":0.6,"per":0.35,"usg":0.2,"ast_pct":0.3,"trb_pct":0.3,
        "stl_pct":0.15,"blk_pct":0.15,"tov_pct":-0.18}
TIER_COUNTS=["ppg","rpg","apg","stl","blk","tovs"]

def f(d,k):
    try: v=(d or {}).get(k); return float(v) if v not in (None,"") else np.nan
    except (TypeError,ValueError): return np.nan
def ht_in(h):
    m=re.match(r"^\s*(\d)\s*-\s*(\d{1,2})\s*$",str(h or "")); return int(m.group(1))*12+int(m.group(2)) if m else np.nan
def posgrp(pos,ht):
    p=str(pos or "").upper().split("/")[0].strip()
    if p in ("PG","SG","G","CG"): return "G"
    if p in ("C","PF","FC"): return "B"
    if p=="SF": return "W"
    if not (ht is None or (isinstance(ht,float) and np.isnan(ht))): return "B" if ht>=80 else "G" if ht<74 else "W"
    return "W"

def load():
    rows=[]
    for l in (DATA/"bbref.jsonl").read_text().splitlines():
        try: b=json.loads(l)
        except Exception: continue
        pg=b.get("pergame") or {}; adv=b.get("advanced") or {}; p4=b.get("per40") or {}
        ts=f(adv,"ts_pct")
        rows.append({"bbref_id":b["bbref_id"],"season_year":b.get("season"),"school_slug":b["school_slug"],
            "name":b.get("player"),"team":b.get("school"),"pos":b.get("pos"),"height":b.get("height"),
            "ppg":f(pg,"pts_per_g"),"rpg":f(pg,"trb_per_g"),"apg":f(pg,"ast_per_g"),"mpg":f(pg,"mp_per_g"),
            "stl":f(pg,"stl_per_g"),"blk":f(pg,"blk_per_g"),"tovs":f(pg,"tov_per_g"),
            "fga":f(pg,"fga_per_g"),"fta":f(pg,"fta_per_g"),
            "ts":ts*100 if not np.isnan(ts) else np.nan,
            "bpm":f(adv,"bpm"),"ws40":f(adv,"ws_per_40"),"per":f(adv,"per"),"usg":f(adv,"usg_pct"),
            "ast_pct":f(adv,"ast_pct"),"trb_pct":f(adv,"trb_pct"),"stl_pct":f(adv,"stl_pct"),
            "blk_pct":f(adv,"blk_pct"),"tov_pct":f(adv,"tov_pct"),"ws":f(adv,"ws"),"games":f(pg,"games"),"mp":f(adv,"mp") if not np.isnan(f(adv,"mp")) else f(p4,"mp")})
    df=pd.DataFrame(rows)
    df["_ht"]=df["height"].map(ht_in); df["_grp"]=[posgrp(p,h) for p,h in zip(df["pos"],df["_ht"])]
    df["_tier"]=df["team"].map(gc.tier).fillna(gc.DEFAULT_TIER).astype(int)
    df["_tf"]=df["_tier"].map(gc.TIER_TO_T1).astype(float)
    df["ts"]=df["ts"].fillna((df["ppg"]/(2*(df["fga"].fillna(0)+0.44*df["fta"].fillna(0)).clip(lower=0.1)))*100).clip(20,80)
    df["_cred"]=(df["mp"].fillna(0)/CRED_MP).clip(0,1)
    df["wa"]=pd.to_numeric(df["ws"],errors="coerce")-0.04*(pd.to_numeric(df["mp"],errors="coerce").fillna(0)/40)
    for c in TIER_COUNTS: df["adj_"+c]=df[c]*df["_tf"]
    # team success: join each (season, bbref school) to its team_seasons SRS
    def _ns(s): return re.sub(r"\\s+"," ",re.sub(r"[&.]","",str(s).lower())).strip()
    K=_key(); HH={"apikey":K,"Authorization":f"Bearer {K}"}
    ts=[]
    while True:
        st=len(ts); d=requests.get(f"{SB}/rest/v1/team_seasons?select=season_year,team,srs&srs=not.is.null",headers={**HH,"Range-Unit":"items","Range":f"{st}-{st+999}"},timeout=60).json()
        if not isinstance(d,list) or not d: break
        ts+=d
    sch_by_yr={}
    for yr in df.season_year.dropna().unique():
        sch_by_yr[int(yr)]=sorted({s for s in df[df.season_year==yr].team.dropna().unique()}, key=lambda x:-len(_ns(x)))
    srs_map={}
    for r in ts:
        yr=int(r["season_year"]); en=_ns(r["team"])
        for sch in sch_by_yr.get(yr,[]):
            sn=_ns(sch)
            if sn and (en==sn or en.startswith(sn+" ")):
                srs_map[(yr,sch)]=r["srs"]; break
    df["team_srs"]=[srs_map.get((int(y) if y==y else -1, t)) for y,t in zip(df.season_year, df.team)]
    df["team_srs"]=pd.to_numeric(df["team_srs"],errors="coerce")
    return df

def squash(raw):
    r=np.asarray(raw,float)
    g=np.where(r<=SOFT,r,SOFT+(GHI-SOFT)*(r-SOFT)/(R99-SOFT)); g=np.where(r>=R99,99.0,g)
    return np.clip(g,40,99).round()

def compute(df):
    df["raw"]=np.nan
    PROD_COL={"ppg":"adj_ppg","ts":"ts","rpg":"adj_rpg","apg":"adj_apg","stl":"adj_stl","blk":"adj_blk","tovs":"adj_tovs","mpg":"mpg","team_srs":"team_srs","wa":"wa","usg":"usg"}
    for grp,idx in df.groupby("_grp").groups.items():
        sub=df.loc[idx]; qual=sub[sub["mpg"]>=MIN_MPG]
        if len(qual)<50: continue
        prod=pd.Series(0.0,index=sub.index)
        for k,w in PROD_W.items():
            col=PROD_COL[k]; mu,sd=qual[col].mean(),(qual[col].std() or 1)
            lo=LO_CLIP.get(k,-4.0)                                 # assists: big upside, small downside
            prod+=w*((sub[col]-mu)/sd).clip(lo,4).fillna(0)
        adv=pd.Series(0.0,index=sub.index)
        for k,w in ADV_F.items():
            mu,sd=qual[k].mean(),(qual[k].std() or 1)
            adv+=w*((sub[k]-mu)/sd).clip(-4,4).fillna(0)
        adv=adv*sub["_cred"]                        # shrink low-minute (noisy) advanced stats
        comp=(prod+ADV_W*adv)*sub["_tf"]            # blend, then discount weak competition
        cq=comp.loc[qual.index]; cm,cs=cq.mean(),(cq.std() or 1)
        df.loc[idx,"raw"]=BASE+SCALE*((comp-cm)/cs)
    df["grade"]=squash(df["raw"])
    df.loc[pd.to_numeric(df["games"],errors="coerce").fillna(0)<MIN_GP,"grade"]=np.nan  # game cap
    return df

def main(write=False):
    df=compute(load()); g=df[df.grade.notna()]; q=g[g.mpg>=10]
    print(f"graded {len(g):,} | n99={int((q.grade>=99).sum())} (~{(q.grade>=99).sum()/20:.1f}/yr) max={q.grade.max():.0f}")
    print("=== anchors ===")
    for nm,yr in [("Zach Edey",2024),("Cameron Boozer",2026),("Cooper Flagg",2025),("Zion Williamson",2019),
                  ("Bennett Stirtz",2025),("Trae Young",2018),("Gary Clark",2018),("Jae Crowder",2012)]:
        for _,x in g[(g.name==nm)&(g.season_year==yr)].iterrows():
            print(f"  {nm} {yr}: {int(x.grade)} (bpm{x.bpm} ws40{x.ws40} {x.ppg}/{x.rpg}/{x.apg} {x._grp} T{x._tier})")
    print("=== top 18 ===")
    for _,x in g.sort_values('grade',ascending=False).drop_duplicates(['name','season_year']).head(18).iterrows():
        print(f"  {int(x.grade)} {str(x['name'])[:19]:19} {x.season_year} {x._grp} T{x._tier} bpm{x.bpm} mp{x.mp} {x.ppg}/{x.rpg}/{x.apg} {str(x.team)[:13]}")
    if write:
        w=df[df.mpg>=1]; pay=[{"bbref_id":b,"season_year":int(s),"school_slug":ss,"tdc_grade":(int(gr) if pd.notna(gr) else None)} for b,s,ss,gr in zip(w.bbref_id,w.season_year,w.school_slug,w.grade)]
        K=_key(); H={"apikey":K,"Authorization":f"Bearer {K}","Content-Type":"application/json"}; print(f"writing {len(pay):,}...")
        ok=0
        for j in range(0,len(pay),500):
            b=pay[j:j+500]
            for _ in range(4):
                try: r=requests.post(f"{SB}/rest/v1/bbref_seasons?on_conflict=bbref_id,season_year,school_slug",headers={**H,"Prefer":"resolution=merge-duplicates,return=minimal"},json=b,timeout=90)
                except Exception: time.sleep(3); continue
                if r.status_code in (200,201,204): ok+=len(b); break
                time.sleep(3)
            time.sleep(0.03)
        print(f"  wrote {ok:,}")
if __name__=="__main__": main(write="--write" in sys.argv)
