#!/usr/bin/env python3
"""build_historical_projection.py — BACKTEST: for each past team-season, project
its DNA from the roster's PRIOR-year Player DNA (a true preseason projection),
so the page can show Projected vs Actual and surface over/under-achievers.
Writes scripts/data/team_dna_proj.json (season -> ESPN team -> {net,ORtg,DRtg}).
Separate file so it never collides with the running team_dna sweep."""
import json, pathlib, numpy as np
from collections import defaultdict
D=pathlib.Path(__file__).parent/"data"
PD=json.load(open(D/"player_dna.json")); TD=json.load(open(D/"team_dna.json"))
ALIAS={"Connecticut":"UConn Huskies","Brigham Young":"BYU Cougars","Louisiana State":"LSU Tigers",
 "Southern California":"USC Trojans","Texas Christian":"TCU Horned Frogs","Southern Methodist":"SMU Mustangs",
 "Virginia Commonwealth":"VCU Rams","Nevada-Las Vegas":"UNLV Rebels","Miami (FL)":"Miami Hurricanes"}
FMET=["efg","ts","tpa_rate","ftr","tov_pct","ast_pct","orb_pct","drb_pct","stl_pct","blk_pct","bpm","obpm","dbpm","usg"]
def espn_key(school,teams):
    if school in ALIAS and ALIAS[school] in teams: return ALIAS[school]
    sl=school.lower(); c=[k for k in teams if k.lower()==sl or k.lower().startswith(sl+' ')]
    return sorted(c,key=len)[0] if c else None
def rfeat(R):
    R=[p for p in R if (p.get('mpg') or 0)>=8 and p.get('bpm') is not None]
    if len(R)<6: return None
    def wm(k):
        num=den=0
        for p in R:
            v=p.get(k)
            if v is None: continue
            num+=p['mpg']*v; den+=p['mpg']
        return num/den if den else 0
    us=[(p.get('usg') or 0)*p['mpg'] for p in R]; tot=sum(us) or 1
    return dict(eFG=wm('efg'),TS=wm('ts'),PA3=wm('tpa_rate'),FTr=wm('ftr'),TOV=wm('tov_pct'),AST=wm('ast_pct'),
      ORB=wm('orb_pct'),DRB=wm('drb_pct'),STL=wm('stl_pct'),BLK=wm('blk_pct'),BPM=wm('bpm'),OBPM=wm('obpm'),
      DBPM=wm('dbpm'),HHI=sum((u/tot)**2 for u in us)*100)
# fit concurrent model (same as build_projected_dna)
rowsF=[];rowsT=[]
for s in PD:
    if s not in TD: continue
    teams=TD[s]["teams"]; bys=defaultdict(list)
    for p in PD[s]["players"].values():
        if p.get("school"): bys[p["school"]].append(dict(p))
    for sch,R in bys.items():
        ek=espn_key(sch,teams); F=rfeat(R)
        if ek and F: rowsF.append(F); rowsT.append(teams[ek])
MODELS={'ORtg':['OBPM','eFG','TOV','TS'],'DRtg':['DBPM','BLK','STL','HHI'],'net':['BPM','OBPM','DBPM']}
COEF={}
for t,fe in MODELS.items():
    X=np.array([[F[f] for f in fe] for F in rowsF]); y=np.array([r.get(t,np.nan) for r in rowsT]);m=~np.isnan(y)
    COEF[t]=(fe,np.linalg.lstsq(np.column_stack([np.ones(m.sum()),X[m]]),y[m],rcond=None)[0])
# freshman metric~grade per group (from 2026 rotation)
FR={g:{} for g in "GWB"}
for g in "GWB":
    pool=[p for p in PD["2026"]["players"].values() if p["grp"]==g and (p["mpg"] or 0)>=10 and p.get("tdc_grade")]
    for mt in FMET:
        xs=[float(p["tdc_grade"]) for p in pool if p.get(mt) is not None]; ys=[p[mt] for p in pool if p.get(mt) is not None]
        FR[g][mt]=np.polyfit(xs,ys,1) if len(xs)>20 else (0,float(np.mean(ys)) if ys else 0)
def fresh_fp(grade,group):
    return {mt:(FR[group][mt][0]*grade+FR[group][mt][1]) for mt in FMET}
# project each season Y from Y-1 fingerprints
OUT={}
for y in sorted(int(s) for s in PD):
    prev=str(y-1)
    if prev not in PD or str(y) not in TD: continue
    teams=TD[str(y)]["teams"]; PY=PD[str(y)]["players"]; PYm1=PD[prev]["players"]
    bys=defaultdict(list)
    for eid,p in PY.items():
        if p.get("school"): bys[p["school"]].append((eid,p))
    seasonproj={}
    for sch,plist in bys.items():
        ek=espn_key(sch,teams)
        if not ek: continue
        R=[]
        for eid,p in plist:
            prior=PYm1.get(eid)  # prior-year fingerprint (preseason-known talent)
            if prior:
                fp={k:prior.get(k) for k in FMET}; fp["mpg"]=prior.get("mpg") or p.get("mpg") or 0
            else:
                g=float(p["tdc_grade"]) if p.get("tdc_grade") else 72
                fp=fresh_fp(g,p["grp"]); fp["mpg"]=p.get("mpg") or 8
            R.append(fp)
        F=rfeat(R)
        if not F: continue
        pj={t:round(float(c[0]+sum(c[i+1]*F[fe[i]] for i in range(len(fe)))),1) for t,(fe,c) in COEF.items()}
        seasonproj[ek]=pj
    OUT[str(y)]=seasonproj
    print(f"[{y}] projected {len(seasonproj)} teams from {prev} DNA",flush=True)
json.dump(OUT,open(D/"team_dna_proj.json","w"),separators=(',',':'))
# validate Miami 2024-25 (season 2025)
mp=OUT.get("2025",{}).get("Miami Hurricanes"); ma=TD.get("2025",{}).get("teams",{}).get("Miami Hurricanes")
if mp and ma:
    print(f"\nMIAMI 2024-25:  projected NET {mp['net']:+.1f}  vs  actual NET {ma['net']:+.1f}  -> {ma['net']-mp['net']:+.1f} vs projection")
    print(f"  projected ORtg {mp['ORtg']} DRtg {mp['DRtg']}  |  actual ORtg {ma['ORtg']} DRtg {ma['DRtg']}")
# biggest under/over-achievers 2025
if "2025" in OUT:
    rows=[(k,OUT["2025"][k]["net"],TD["2025"]["teams"][k]["net"]) for k in OUT["2025"] if k in TD["2025"]["teams"]]
    rows.sort(key=lambda r:r[2]-r[1])
    print("\nBiggest UNDER-achievers 2024-25 (actual - projected):")
    for k,pj,ac in rows[:5]: print(f"  {k[:24]:24} proj {pj:+5.1f}  actual {ac:+5.1f}  ({ac-pj:+.1f})")
    print("Biggest OVER-achievers:")
    for k,pj,ac in rows[-5:]: print(f"  {k[:24]:24} proj {pj:+5.1f}  actual {ac:+5.1f}  ({ac-pj:+.1f})")
