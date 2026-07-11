#!/usr/bin/env python3
"""sweep_team_dna.py — compute Team DNA for EVERY team in a season + national
percentiles + the season win model, and merge into scripts/data/team_dna.json
(static precompute the team page loads). v1 = box-score-derived DNA; shot
profile/quality is a later enrichment pass. Re-runnable per season."""
import json, sys, urllib.request, pathlib
import numpy as np
from collections import defaultdict
SB="https://izlqhnxowdhtdofkwrho.supabase.co"; K="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H={"apikey":K,"Authorization":"Bearer "+K}
OUT=pathlib.Path(__file__).parent/"data"/"team_dna.json"
def GET(p,to=90): return json.load(urllib.request.urlopen(urllib.request.Request(SB+"/rest/v1/"+p,headers=H),timeout=to))
STATK=["pts","fga","fgm","tpm","tpa","fta","oreb","dreb","tov"]
def poss(t): return t["fga"]-t["oreb"]+t["tov"]+0.44*t["fta"]
FKEYS=["oeFG","oTOV","oORB","oFTr","deFG","dTOV","dDRB","dFTr"]
def factors(o,d):
    op=poss(o); return dict(
      oeFG=100*(o["fgm"]+.5*o["tpm"])/o["fga"] if o["fga"] else 0, oTOV=100*o["tov"]/op if op else 0,
      oORB=100*o["oreb"]/(o["oreb"]+d["dreb"]) if (o["oreb"]+d["dreb"]) else 0, oFTr=100*o["fta"]/o["fga"] if o["fga"] else 0,
      deFG=100*(d["fgm"]+.5*d["tpm"])/d["fga"] if d["fga"] else 0, dTOV=100*d["tov"]/poss(d) if poss(d) else 0,
      dDRB=100*o["dreb"]/(o["dreb"]+d["oreb"]) if (o["dreb"]+d["oreb"]) else 0, dFTr=100*d["fta"]/d["fga"] if d["fga"] else 0)

def sweep(SEASON):
    print(f"[{SEASON}] game list...",flush=True)
    gids=[];off=0
    while True:
        b=GET(f"games?season_year=eq.{SEASON}&status=eq.STATUS_FINAL&select=id,home,away,conf_game&order=id.asc&limit=1000&offset={off}")
        if not b: break
        gids+=b; off+=1000
        if len(b)<1000: break
    conf={g["id"]:g.get("conf_game") for g in gids}
    ids=[g["id"] for g in gids]
    print(f"[{SEASON}] {len(ids)} games; box scores in batches...",flush=True)
    # per (game, team) totals
    GT=defaultdict(lambda:defaultdict(lambda:defaultdict(float)))
    for i in range(0,len(ids),30):
        rows=GET("box_scores?game_id=in.("+",".join(map(str,ids[i:i+30]))+f")&select=game_id,team,{','.join(STATK)}")
        for r in rows:
            for k in STATK: GT[r["game_id"]][r["team"]][k]+=(r.get(k) or 0)
        if i%1500==0: print(f"  ...{i}/{len(ids)}",flush=True)
    # league win model from all team-games
    X=[];ym=[]
    # per-team game rows: opp is the other team in the game
    TG=defaultdict(list)   # team -> list of (own,opp,gid)
    for gid,tm in GT.items():
        if len(tm)!=2: continue
        (na,a),(nb,b)=list(tm.items())
        TG[na].append((a,b,gid)); TG[nb].append((b,a,gid))
        for o,d in [(a,b),(b,a)]:
            if o["fga"]>0 and d["fga"]>0 and poss(o)>0 and poss(d)>0:
                f=factors(o,d); X.append([f[k] for k in FKEYS]); ym.append(o["pts"]-d["pts"])
    X=np.array(X);ym=np.array(ym,float)
    A=np.column_stack([np.ones(len(X)),X]);coef=np.linalg.lstsq(A,ym,rcond=None)[0]
    r2=1-((ym-A@coef)**2).sum()/((ym-ym.mean())**2).sum()
    winmodel={FKEYS[i]:round(coef[i+1]*5,2) for i in range(8)}
    # per-team DNA (>=15 games -> D1)
    teams={}
    for name,glist in TG.items():
        if len(glist)<15: continue
        def seg(gs):
            t=defaultdict(float);u=defaultdict(float);o_r=[];d_r=[];mar=[];w=l=0
            for o,d,gid in gs:
                for k in STATK: t[k]+=o[k];u[k]+=d[k]
                if poss(o)>0:o_r.append(100*o["pts"]/poss(o))
                if poss(d)>0:d_r.append(100*d["pts"]/poss(d))
                mar.append(o["pts"]-d["pts"]); w+=o["pts"]>d["pts"]; l+=o["pts"]<=d["pts"]
            f=factors(t,u)
            return dict(w=w,l=l,ORtg=round(float(np.mean(o_r)),1),DRtg=round(float(np.mean(d_r)),1),
                        net=round(float(np.mean(o_r)-np.mean(d_r)),1),tempo=round((poss(t)+poss(u))/(2*len(gs)),1),
                        ortg_sd=round(float(np.std(o_r)),1),margin_sd=round(float(np.std(mar)),1),
                        **{k:round(v,1) for k,v in f.items()})
        glist.sort(key=lambda x:x[2])
        full=seg(glist);G=len(glist)
        pyth=full["ORtg"]**11.5/(full["ORtg"]**11.5+full["DRtg"]**11.5)
        full["exp_wins"]=round(pyth*G,1); full["luck"]=round(full["w"]-pyth*G,1)
        ev={}
        for lbl,pred in [("nonconf",lambda gid:conf.get(gid)==False),("conf",lambda gid:conf.get(gid)==True),("last10",None)]:
            gs=glist[-10:] if lbl=="last10" else [x for x in glist if pred(x[2])]
            if gs: s=seg(gs); ev[lbl]={"w":s["w"],"l":s["l"],"net":s["net"],"oeFG":s["oeFG"],"deFG":s["deFG"]}
        full["evolution"]=ev
        teams[name]=full
    # national percentiles within season
    DIRS={"net":1,"ORtg":1,"DRtg":-1,"oeFG":1,"deFG":-1,"oTOV":-1,"dTOV":1,"oORB":1,"dDRB":1,"margin_sd":-1}
    for m,dr in DIRS.items():
        vals=sorted(t[m] for t in teams.values())
        n=len(vals)
        for t in teams.values():
            below=sum(1 for v in vals if (v<t[m]) )
            pc=100*below/n
            t.setdefault("pct",{})[m]=round(pc if dr>0 else 100-pc)
    return {"meta":{"win_model":winmodel,"r2":round(float(r2),3),"n_games":len(ids)},"teams":teams}

data=json.loads(OUT.read_text()) if OUT.exists() else {}
for s in [int(x) for x in sys.argv[1:]] or [2026]:
    data[str(s)]=sweep(s)
    print(f"[{s}] {len(data[str(s)]['teams'])} teams done.",flush=True)
OUT.write_text(json.dumps(data,separators=(',',':')))
print("wrote",OUT,flush=True)
