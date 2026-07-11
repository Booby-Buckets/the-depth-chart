#!/usr/bin/env python3
"""build_team_dna.py — Winning Engine foundation (validation run).
 (1) League Win Model: margin & win-prob regressed on the 8 four-factors.
 (2) Team DNA = Actual + Expected(shot quality / Pythagorean) + Gap.
 (3) Evolution: non-conf / conference / last-10.
Pulls box scores by game-id batches (indexed, fast). Production = same code, all seasons."""
import json, urllib.request, urllib.parse
import numpy as np
from collections import defaultdict
SB="https://izlqhnxowdhtdofkwrho.supabase.co"; K="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H={"apikey":K,"Authorization":"Bearer "+K}
SEASON=2026
def GET(path,to=90):
    return json.load(urllib.request.urlopen(urllib.request.Request(SB+"/rest/v1/"+path,headers=H),timeout=to))
STATK=["pts","fga","fgm","tpm","tpa","fta","oreb","dreb","tov"]
def poss(t): return t["fga"]-t["oreb"]+t["tov"]+0.44*t["fta"]
def factors(o,d):
    op=poss(o); return dict(
      oeFG=100*(o["fgm"]+.5*o["tpm"])/o["fga"] if o["fga"] else 0, oTOV=100*o["tov"]/op if op else 0,
      oORB=100*o["oreb"]/(o["oreb"]+d["dreb"]) if (o["oreb"]+d["dreb"]) else 0, oFTr=100*o["fta"]/o["fga"] if o["fga"] else 0,
      deFG=100*(d["fgm"]+.5*d["tpm"])/d["fga"] if d["fga"] else 0, dTOV=100*d["tov"]/poss(d) if poss(d) else 0,
      dDRB=100*o["dreb"]/(o["dreb"]+d["oreb"]) if (o["dreb"]+d["oreb"]) else 0, dFTr=100*d["fta"]/d["fga"] if d["fga"] else 0)
FKEYS=["oeFG","oTOV","oORB","oFTr","deFG","dTOV","dDRB","dFTr"]
FLAB=dict(oeFG="OFF eFG%",oTOV="OFF TOV%",oORB="OFF ORB%",oFTr="OFF FT rate",deFG="DEF eFG% allowed",dTOV="DEF forced TOV%",dDRB="DEF DREB%",dFTr="DEF FT rate allowed")

# ---- (1) league win model: game list from `games`, factors from box_scores by game-id batch ----
print("Fetching game list...",flush=True)
games=[]; off=0
while len(games)<1600:
    b=GET(f"games?season_year=eq.{SEASON}&status=eq.STATUS_FINAL&select=id&order=id.asc&limit=1000&offset={off}")
    if not b: break
    games+=[g["id"] for g in b]; off+=1000
    if len(b)<1000: break
gids=games[:1500]
print(f"{len(gids)} games; pulling box scores in batches...",flush=True)
bg=defaultdict(lambda:defaultdict(lambda:defaultdict(float)))
for i in range(0,len(gids),30):
    batch=gids[i:i+30]
    rows=GET("box_scores?game_id=in.("+",".join(map(str,batch))+f")&select=game_id,team,{','.join(STATK)}")
    for r in rows:
        for k in STATK: bg[r["game_id"]][r["team"]][k]+=(r.get(k) or 0)
X=[];ym=[];yw=[]
for g,tm in bg.items():
    if len(tm)!=2: continue
    (_,a),(_,b)=list(tm.items())
    for o,d in [(a,b),(b,a)]:
        if o["fga"]<=0 or d["fga"]<=0 or poss(o)<=0 or poss(d)<=0: continue
        f=factors(o,d); X.append([f[k] for k in FKEYS]); ym.append(o["pts"]-d["pts"]); yw.append(1 if o["pts"]>d["pts"] else 0)
X=np.array(X);ym=np.array(ym,float);yw=np.array(yw,float)
A=np.column_stack([np.ones(len(X)),X]); coef=np.linalg.lstsq(A,ym,rcond=None)[0]
r2=1-((ym-A@coef)**2).sum()/((ym-ym.mean())**2).sum()
Xs=(X-X.mean(0))/X.std(0); As=np.column_stack([np.ones(len(Xs)),Xs]); scoef=np.linalg.lstsq(As,ym,rcond=None)[0]
w=np.zeros(Xs.shape[1]);b0=0.
for _ in range(4000):
    p=1/(1+np.exp(-(Xs@w+b0))); w-=0.3*(Xs.T@(p-yw)/len(yw)); b0-=0.3*(p-yw).mean()
acc=((1/(1+np.exp(-(Xs@w+b0)))>0.5)==yw).mean()
print(f"\n===== LEAGUE WIN MODEL — what wins CBB (season {SEASON}, n={len(ym)} team-games, margin R^2={r2:.3f}, win acc={acc:.3f}) =====")
print(f"{'FACTOR':22} {'pts/+5%':>9} {'std-impact':>11}")
for i in sorted(range(8),key=lambda i:-abs(scoef[i+1])):
    print(f"{FLAB[FKEYS[i]]:22} {coef[i+1]*5:>+8.1f} {scoef[i+1]:>+11.2f}")
print("(pts/+5% = points added per +5 pct-pts, holding the other 7 constant)")

# ---- (2)+(3) team DNA ----
BASE={"rim":.615,"paint":.395,"mid":.375,"corner3":.385,"atb3":.345}  # D1 zone FG% baseline
def zone(s):
    d=s.get("dist")
    if s.get("sv")==3: return "corner3" if (s.get("y") or 99)<=10 else "atb3"
    if d is None or d<=4: return "rim"
    if d<=9: return "paint"
    return "mid"
def team_dna(name):
    enc=urllib.parse.quote(name)
    orow=GET(f"box_scores?team=eq.{enc}&season_year=eq.{SEASON}&select=game_id,date,{','.join(STATK)}&limit=2000")
    drow=GET(f"box_scores?opp=eq.{enc}&season_year=eq.{SEASON}&select=game_id,{','.join(STATK)}&limit=2000")
    O=defaultdict(lambda:defaultdict(float));D=defaultdict(lambda:defaultdict(float));dt={}
    for r in orow:
        for k in STATK: O[r["game_id"]][k]+=(r.get(k) or 0)
        dt[r["game_id"]]=r.get("date")
    for r in drow:
        for k in STATK: D[r["game_id"]][k]+=(r.get(k) or 0)
    gl=[g for g in O if g in D]; gl.sort(key=lambda g: dt.get(g) or "")
    def seg(gs):
        t=defaultdict(float);u=defaultdict(float);o_r=[];d_r=[];w=l=0
        for g in gs:
            o,d=O[g],D[g]
            for k in STATK: t[k]+=o[k];u[k]+=d[k]
            if poss(o)>0:o_r.append(100*o["pts"]/poss(o))
            if poss(d)>0:d_r.append(100*d["pts"]/poss(d))
            w+=o["pts"]>d["pts"]; l+=o["pts"]<=d["pts"]
        f=factors(t,u); return dict(w=w,l=l,ORtg=np.mean(o_r),DRtg=np.mean(d_r),net=np.mean(o_r)-np.mean(d_r),**f)
    full=seg(gl); G=len(gl)
    tq=GET(f"games?home=eq.{enc}&season_year=eq.{SEASON}&select=home_id&limit=1")
    ee=ae=None
    if tq:
        ts=GET(f"shots?team_id=eq.{tq[0]['home_id']}&season_year=eq.{SEASON}&select=dist,sv,y,made&limit=4000")
        if ts:
            ee=100*sum(BASE[zone(s)]*(1.5 if s.get('sv')==3 else 1) for s in ts)/len(ts)
            ae=100*sum((1.5 if s.get('sv')==3 else 1) for s in ts if s.get('made'))/len(ts)
    pyth=full["ORtg"]**11.5/(full["ORtg"]**11.5+full["DRtg"]**11.5)
    print(f"\n===== {name} {SEASON-1}-{str(SEASON)[2:]} — TEAM DNA ({full['w']}-{full['l']}) =====")
    print(f"  ORtg {full['ORtg']:.1f}  DRtg {full['DRtg']:.1f}  NET {full['net']:+.1f}")
    print(f"  OFF  eFG {full['oeFG']:.1f}  TOV {full['oTOV']:.1f}  ORB {full['oORB']:.1f}  FTr {full['oFTr']:.1f}")
    print(f"  DEF  eFG {full['deFG']:.1f}  frcTOV {full['dTOV']:.1f}  DRB {full['dDRB']:.1f}  FTr {full['dFTr']:.1f}")
    if ee is not None: print(f"  EXPECTED shooting: shot-quality eFG {ee:.1f} vs actual {ae:.1f} -> {ae-ee:+.1f}")
    print(f"  EXPECTED wins (Pythag): {pyth*G:.1f} vs actual {full['w']} -> {full['w']-pyth*G:+.1f} (luck)")
    gg=GET(f"games?or=(home.eq.{enc},away.eq.{enc})&season_year=eq.{SEASON}&select=id,conf_game&limit=100")
    cf={x["id"]:x.get("conf_game") for x in gg}
    for lbl,gs in [("Non-conf",[g for g in gl if cf.get(g)==False]),("Conference",[g for g in gl if cf.get(g)==True]),("Last 10",gl[-10:])]:
        if gs: s=seg(gs); print(f"    {lbl:11} {s['w']}-{s['l']}  NET {s['net']:+.1f}  (OFF eFG {s['oeFG']:.1f} / DEF eFG {s['deFG']:.1f})")
for t in ["Duke Blue Devils","Houston Cougars","Alabama Crimson Tide"]:
    try: team_dna(t)
    except Exception as e: print(f"{t}: error {e}",flush=True)
print("\nDONE",flush=True)
