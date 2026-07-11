#!/usr/bin/env python3
"""roster_projection.py — calibrate & backtest: predict a team's DNA (four factors,
efficiency) from its minutes-weighted roster Player DNA. Fits on all historical
team-seasons where we have both (player_dna + team_dna), reports 5-fold CV R^2 per
target, and prints example projections. This is the science behind projecting a
2026-27 roster -> projected Team DNA + win-path."""
import json, pathlib, numpy as np
from collections import defaultdict
D=pathlib.Path(__file__).parent/"data"
PD=json.load(open(D/"player_dna.json")); TD=json.load(open(D/"team_dna.json"))
ALIAS={"Connecticut":"UConn Huskies","Brigham Young":"BYU Cougars","Louisiana State":"LSU Tigers",
 "Southern California":"USC Trojans","Texas Christian":"TCU Horned Frogs","Southern Methodist":"SMU Mustangs",
 "Virginia Commonwealth":"VCU Rams","Nevada-Las Vegas":"UNLV Rebels","Miami (FL)":"Miami Hurricanes",
 "Southern Mississippi":"Southern Miss Golden Eagles","San Jose State":"San José State Spartans",
 "Massachusetts":"UMass Minutemen","Louisiana-Monroe":"UL Monroe Warhawks","Hawaii":"Hawai'i Rainbow Warriors"}
def espn_key(school,teams):
    if school in ALIAS and ALIAS[school] in teams: return ALIAS[school]
    sl=school.lower(); cand=[k for k in teams if k.lower()==sl or k.lower().startswith(sl+' ')]
    return sorted(cand,key=len)[0] if cand else None
def rfeat(R):
    R=[p for p in R if (p.get('mpg') or 0)>=8 and p.get('bpm') is not None]
    if len(R)<6: return None
    def wm(k,shot=False):
        num=den=0
        for p in R:
            v=p.get(k)
            if v is None: continue
            w=p['mpg']*((p.get('usg') or 20) if shot else 1); num+=w*v; den+=w
        return num/den if den else 0
    us=[(p.get('usg') or 0)*p['mpg'] for p in R]; tot=sum(us) or 1
    return dict(eFG=wm('efg',1),TS=wm('ts',1),PA3=wm('tpa_rate',1),FTr=wm('ftr',1),TOV=wm('tov_pct',1),
        AST=wm('ast_pct'),ORB=wm('orb_pct'),DRB=wm('drb_pct'),STL=wm('stl_pct'),BLK=wm('blk_pct'),
        BPM=wm('bpm'),OBPM=wm('obpm'),DBPM=wm('dbpm'),HHI=sum((u/tot)**2 for u in us)*100)
# build dataset
rows=[]
for season in PD:
    if season not in TD: continue
    teams=TD[season]["teams"]
    byschool=defaultdict(list)
    for p in PD[season]["players"].values():
        if p.get("school"): byschool[p["school"]].append(p)
    for sch,R in byschool.items():
        ek=espn_key(sch,teams)
        if not ek: continue
        F=rfeat(R)
        if not F: continue
        rows.append((F,teams[ek],f"{sch} {season}"))
print(f"calibration set: {len(rows)} team-seasons")
MODELS={'oeFG':['eFG','PA3','TS'],'oTOV':['TOV','AST'],'oORB':['ORB'],'oFTr':['FTr'],
 'ORtg':['OBPM','eFG','TOV','TS'],'deFG':['DBPM','BLK','STL'],'dTOV':['STL','DBPM'],'dDRB':['DRB'],
 'DRtg':['DBPM','BLK','STL','HHI'],'net':['BPM','OBPM','DBPM'],'tempo':['PA3','BPM']}
def cv_r2(feats,tgt):
    X=np.array([[F[f] for f in feats] for F,_,_ in rows]); y=np.array([t.get(tgt,np.nan) for _,t,_ in rows])
    m=~np.isnan(y); X=X[m]; y=y[m]; n=len(y); idx=np.arange(n); rng=np.random.RandomState(0); rng.shuffle(idx)
    pred=np.zeros(n)
    for k in range(5):
        te=idx[k::5]; tr=np.setdiff1d(idx,te)
        A=np.column_stack([np.ones(len(tr)),X[tr]]); c=np.linalg.lstsq(A,y[tr],rcond=None)[0]
        pred[te]=np.column_stack([np.ones(len(te)),X[te]])@c
    ss=1-((y-pred)**2).sum()/((y-y.mean())**2).sum(); return ss,y.std()
print(f"\n{'TARGET':7} {'CV R^2':>7} {'RMSE-ish':>9}   drivers")
for t,feats in MODELS.items():
    r2,sd=cv_r2(feats,t); print(f"{t:7} {r2:>7.2f} {sd*(1-max(r2,0))**.5:>9.2f}   {'+'.join(feats)}")
# example: fit net on full, show a few predicted vs actual
X=np.array([[F[f] for f in MODELS['net']] for F,_,_ in rows]); y=np.array([t['net'] for _,t,_ in rows])
A=np.column_stack([np.ones(len(X)),X]); c=np.linalg.lstsq(A,y,rcond=None)[0]; pred=A@c
order=np.argsort(-y)
print("\nNET rating — projected-from-roster vs actual (top teams):")
for i in list(order[:6]):
    print(f"  {rows[i][2][:26]:26} actual {y[i]:+5.1f}  projected {pred[i]:+5.1f}")
