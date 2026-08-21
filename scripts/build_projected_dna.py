#!/usr/bin/env python3
"""build_projected_dna.py — apply the calibrated roster->team DNA model to the
2026-27 rosters (players table) to produce each team's PROJECTED DNA + win-path,
merged into team_dna.json under "2027" (projected:true). Returners/transfers use
their Player DNA; freshmen get a fingerprint estimated from grade (per position
group); tempo comes from the coach's pace profile."""
import json, urllib.request, urllib.parse, pathlib, numpy as np
from collections import defaultdict
D=pathlib.Path(__file__).parent/"data"
SB="https://izlqhnxowdhtdofkwrho.supabase.co"; K="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H={"apikey":K,"Authorization":"Bearer "+K}
PD=json.load(open(D/"player_dna.json")); TD=json.load(open(D/"team_dna.json"))
# Projected 2026-27 per-player line (stats-derived OVR + projected minutes), keyed by espn_id.
# Newcomers with no D1 Player DNA are fingerprinted from THIS (their projected stats), not from
# the hand/display tdc_grade — a grade that disagrees with the projected line (e.g. a 90 on a
# player projected to ~83) must not inflate the team DNA. Grade is only a last-resort fallback.
try: SOP=json.load(open(D/"stat_overall_projected.json")).get("players",{})
except Exception: SOP={}
CP={c["coach_slug"]:c for c in json.load(open(D/"coach_profiles.json"))}
CS=json.load(open(D/"coach_seasons.json"))
ALIAS={"Connecticut":"UConn Huskies","Brigham Young":"BYU Cougars","Louisiana State":"LSU Tigers",
 "Southern California":"USC Trojans","Texas Christian":"TCU Horned Frogs","Southern Methodist":"SMU Mustangs",
 "Virginia Commonwealth":"VCU Rams","Nevada-Las Vegas":"UNLV Rebels","Miami (FL)":"Miami Hurricanes"}
FMET=["efg","ts","tpa_rate","ftr","tov_pct","ast_pct","orb_pct","drb_pct","stl_pct","blk_pct","bpm","obpm","dbpm","usg"]
def grp(pos,h):
    pos=(pos or "").upper(); return 'B' if ('C' in pos or (h and h>=82)) else ('G' if (pos[:1]=='G' or (h and h<=75)) else 'W')
def htin(s):
    import re;m=re.match(r"(\d+)-(\d+)",str(s or ""));return int(m[1])*12+int(m[2]) if m else None
# ---- fit roster->team models on history + freshman metric~grade per group ----
def rfeat(R, minn=6):
    R=[p for p in R if (p.get('mpg') or 0)>=8 and p.get('bpm') is not None]
    if len(R)<minn: return None
    def wm(k,shot=False):
        num=den=0
        for p in R:
            v=p.get(k)
            if v is None: continue
            w=p['mpg']*((p.get('usg') or 20) if shot else 1); num+=w*v; den+=w
        return num/den if den else 0
    us=[(p.get('usg') or 0)*p['mpg'] for p in R]; tot=sum(us) or 1
    return dict(eFG=wm('efg'),TS=wm('ts'),PA3=wm('tpa_rate'),FTr=wm('ftr'),TOV=wm('tov_pct'),AST=wm('ast_pct'),
      ORB=wm('orb_pct'),DRB=wm('drb_pct'),STL=wm('stl_pct'),BLK=wm('blk_pct'),BPM=wm('bpm'),OBPM=wm('obpm'),
      DBPM=wm('dbpm'),HHI=sum((u/tot)**2 for u in us)*100)
def espn_key(school,teams):
    if school in ALIAS and ALIAS[school] in teams: return ALIAS[school]
    sl=school.lower(); c=[k for k in teams if k.lower()==sl or k.lower().startswith(sl+' ')]
    return sorted(c,key=len)[0] if c else None
rowsF=[];rowsT=[]
for s in PD:
    if s not in TD: continue
    teams=TD[s]["teams"]; byс=defaultdict(list)
    for p in PD[s]["players"].values():
        if p.get("school"): byс[p["school"]].append(p)
    for sch,R in byс.items():
        ek=espn_key(sch,teams); F=rfeat(R)
        if ek and F: rowsF.append(F); rowsT.append(teams[ek])
MODELS={'oeFG':['eFG','PA3','TS'],'oTOV':['TOV','AST'],'oORB':['ORB'],'oFTr':['FTr'],
 'ORtg':['OBPM','eFG','TOV','TS'],'deFG':['DBPM','BLK','STL'],'dTOV':['STL','DBPM'],'dDRB':['DRB'],
 'DRtg':['DBPM','BLK','STL','HHI'],'net':['BPM','OBPM','DBPM']}
COEF={}
for t,fe in MODELS.items():
    X=np.array([[F[f] for f in fe] for F in rowsF]); y=np.array([r.get(t,np.nan) for r in rowsT]);m=~np.isnan(y)
    COEF[t]=(fe,np.linalg.lstsq(np.column_stack([np.ones(m.sum()),X[m]]),y[m],rcond=None)[0])
# freshman metric ~ grade, per group (rotation players)
FR={}
for g in "GWB":
    FR[g]={}
    pool=[p for p in PD["2026"]["players"].values() if p["grp"]==g and (p["mpg"] or 0)>=10 and p.get("tdc_grade")]
    for mt in FMET:
        xs=[float(p["tdc_grade"]) for p in pool if p.get(mt) is not None]; ys=[p[mt] for p in pool if p.get(mt) is not None]
        if len(xs)>20: FR[g][mt]=np.polyfit(xs,ys,1)
        else: FR[g][mt]=(0,float(np.mean(ys)) if ys else 0)
def fresh_fp(grade,group):
    fp={}
    for mt in FMET: a,b=FR[group][mt]; fp[mt]=a*grade+b
    fp2={'efg':fp['efg'],'ts':fp['ts'],'tpa_rate':fp['tpa_rate'],'ftr':fp['ftr'],'tov_pct':fp['tov_pct'],
     'ast_pct':fp['ast_pct'],'orb_pct':fp['orb_pct'],'drb_pct':fp['drb_pct'],'stl_pct':fp['stl_pct'],
     'blk_pct':fp['blk_pct'],'bpm':fp['bpm'],'obpm':fp['obpm'],'dbpm':fp['dbpm'],'usg':fp['usg']}
    return fp2
# player_dna lookup by espn_id (most recent season)
def fp_by_espn(eid):
    for s in ["2026","2025","2024","2023"]:
        p=PD.get(s,{}).get("players",{}).get(str(eid))
        if p: return p
    return None
# coach pace per team (latest coach_seasons)
coachpace={}
best={}
for c in CS:
    sc=c["school"]; y=c["season_year"]
    if sc not in best or y>best[sc][0]: best[sc]=(y,c.get("coach_slug"))
for sc,(y,slug) in best.items():
    pp=(CP.get(slug) or {}).get("poss_pg"); coachpace[sc]=pp
# ---- pull 2026-27 rosters ----
rows=[];off=0
while True:
    b=json.load(urllib.request.urlopen(urllib.request.Request(SB+f"/rest/v1/players?select=team,name,espn_id,tdc_grade,mpg,position,height&name=neq.%E2%80%94&order=team.asc,name.asc,espn_id.asc&limit=1000&offset={off}",headers=H),timeout=60))
    if not b: break
    rows+=b; off+=1000
    if len(b)<1000: break
byteam=defaultdict(list)
for p in rows: byteam[p["team"]].append(p)
teams26=TD["2026"]["teams"]
# Authoritative short->full team-name map from predictive_ratings. The index looks up
# team_eff by this SAME full name, and espn_key mis-resolved any flagship whose "State"
# sibling sorted shorter (Illinois -> "Illinois State Redbirds"), so the Fighting Illini
# got no 2027 DNA. Keying off predictive_ratings guarantees the DNA key matches the site.
SHORT2FULL={}
try:
    _pr=json.load(urllib.request.urlopen(urllib.request.Request(SB+"/rest/v1/predictive_ratings?season=eq.2027&select=data&limit=1",headers=H),timeout=60))
    for _t in (_pr[0]["data"]["teams"] if _pr else []):
        if _t.get("team") and _t.get("full"): SHORT2FULL[_t["team"].lower()]=_t["full"]
except Exception as _e:
    print("warn: could not load predictive_ratings short->full map (%s); using espn_key only" % _e)
proj={}
for team,roster in byteam.items():
    R=[]
    for p in roster:
        eid=str(p["espn_id"]) if p.get("espn_id") not in (None,"") else None
        g=p.get("tdc_grade")
        h=htin(p.get("height")); grp_=grp(p.get("position"),h)
        fp0=fp_by_espn(p["espn_id"]) if p.get("espn_id") else None
        sp=SOP.get(eid) if eid else None            # projected 2026-27 stat line
        # Newcomer quality that drives the estimated fingerprint: prefer the projection engine's
        # stats-derived OVR (reflects the PROJECTED line) over the hand/display grade. Grade is
        # only used when a player has no projected line at all (a true unknown). A rotation player
        # whose grade never synced (Sheet->Supabase gap) still keeps their real Player-DNA
        # fingerprint. Skip only when there is NEITHER DNA, NOR a projected OVR, NOR a grade.
        proj_ovr=(sp.get("ovr") if sp else None)
        q=(float(proj_ovr) if proj_ovr not in (None,"")
           else (float(g) if g not in (None,"") else None))
        if fp0 is None and q is None: continue
        fp=dict(fp0) if fp0 else fresh_fp(q,grp_)   # returner DNA, else projected-line fingerprint
        # Minutes: recorded mpg -> projected mpg -> quality-based estimate. A mid-quality rotation
        # player (72-77) on a ~12-man roster still plays real minutes, so floor above the 8-min bar.
        mp=p.get("mpg")
        if mp in (None,"") and sp and sp.get("proj_mpg") not in (None,""): mp=sp["proj_mpg"]
        if mp in (None,""):
            qq=q if q is not None else 77
            mp=(26 if qq>=92 else 22 if qq>=88 else 16 if qq>=82 else 12 if qq>=78 else 9 if qq>=72 else 6)
        fp["mpg"]=float(mp)
        R.append(fp)
    F=rfeat(R, minn=5)   # projection is more permissive than the historical fit (6)
    if not F: continue
    dna={}
    for t,(fe,c) in COEF.items(): dna[t]=round(float(c[0]+sum(c[i+1]*F[fe[i]] for i in range(len(fe)))),1)
    dna["tempo"]=round(coachpace.get(team) or 68.0,1)
    dna["projected"]=True
    proj[(SHORT2FULL.get(team.lower()) or espn_key(team,teams26) or team)]=dna
# ---- reconcile ORtg/DRtg with the trusted net ------------------------------
# ORtg, DRtg and net are each predicted by a SEPARATE regression, so raw o-d does
# not equal net and the offense model runs hot (pool mean o-d ~ +4 over mean net).
# Ranked by raw ORtg that overvalues offense-leaning teams (a mid-major reads top-5
# on offense while its adjusted net is mid-pack). Rebuild o/d from net + a damped
# run-and-gun level around a realistic baseline so ORtg - DRtg == net for every
# consumer of the projected DNA (homepage, team/offense/defense/matchup pages…).
_pool=[t for t in proj.values() if all(k in t for k in ("ORtg","DRtg","net"))]
if _pool:
    _mid=sum((t["ORtg"]+t["DRtg"])/2 for t in _pool)/len(_pool)
    _BASE,_LD=105.5,0.5
    for t in _pool:
        _lvl=((t["ORtg"]+t["DRtg"])/2 - _mid)*_LD
        t["ORtg"]=round(_BASE+_lvl+t["net"]/2,1)
        t["DRtg"]=round(_BASE+_lvl-t["net"]/2,1)
# ---- national percentiles + win-path (weighted by 2026 win model) ----
allt=list(proj.values()); n=len(allt)
DIRS={"net":1,"ORtg":1,"DRtg":-1,"oeFG":1,"deFG":-1,"oTOV":-1,"dTOV":1,"oORB":1,"dDRB":1}
for m,dr in DIRS.items():
    vals=sorted(t[m] for t in allt if m in t)
    for t in allt:
        if m in t: below=sum(1 for v in vals if v<t[m]); pc=100*below/n; t.setdefault("pct",{})[m]=round(pc if dr>0 else 100-pc)
WM=TD["2026"]["meta"]["win_model"]; means={m:np.mean([t[m] for t in allt if m in t]) for m in ["oeFG","oTOV","oORB","oFTr","deFG","dTOV","dDRB"]}
LAB={"oeFG":"shooting","oTOV":"ball security","oORB":"offensive rebounding","oFTr":"getting to the line",
 "deFG":"defending shots","dTOV":"forcing turnovers","dDRB":"defensive rebounding"}
for t in allt:
    contrib=[]
    for m,w in WM.items():
        if m in t and m in means: contrib.append((LAB.get(m,m),(t[m]-means[m])*(w/5)))
    contrib.sort(key=lambda x:-x[1])
    stg=[c[0] for c in contrib if c[1]>0.6][:3]; wk=[c[0] for c in contrib if c[1]<-0.6][-3:]
    t["win_path"]={"strengths":stg,"weaknesses":wk,
      "summary":("Built to win with "+", ".join(stg) if stg else "Balanced profile")+ (("; must overcome weak "+", ".join(wk)) if wk else "")+"."}
TD["2027"]={"meta":{"projected":True,"note":"projected from 2026-27 rosters + coach pace","win_model":WM},"teams":proj}
json.dump(TD,open(D/"team_dna.json","w"),separators=(',',':'))
print(f"projected {len(proj)} teams into 2027. Fit sizes: {len(rowsF)} historical team-seasons.")
# validation
for tm in ["Duke Blue Devils","Arizona Wildcats","Alabama Crimson Tide","Houston Cougars"]:
    t=proj.get(tm)
    if t: print(f"\n{tm}: NET {t['net']:+.1f} (pct {t.get('pct',{}).get('net')})  ORtg {t['ORtg']} DRtg {t['DRtg']} tempo {t['tempo']}\n  {t['win_path']['summary']}")
