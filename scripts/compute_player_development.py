#!/usr/bin/env python3
"""
compute_player_development.py — how college careers arc.

Rolls 20 years of graded player-seasons into:
  - curve: the average TDC-grade development path by class (Fr→So→Jr→Sr),
    overall and by position group
  - risers: players with the biggest career grade climb (first → peak)
  - jumps: biggest single-season grade jumps (breakout years)
  - busts: biggest career declines

Output: scripts/data/development.json  (loaded by development.html)
"""
import json, os, urllib.request
from collections import defaultdict

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR={"apikey":KEY,"Authorization":"Bearer "+KEY}
OUT=os.path.join(os.path.dirname(__file__),"data","development.json")
CLS={"FR":1,"SO":2,"JR":3,"SR":4}

def co(c): return CLS.get((c or "").upper().replace("R-","")[:2],0)
def grp(p):
    p=(p or "").upper()
    return "G" if p in ("G","PG","SG") else "B" if p in ("C","PF","F-C","C-F") else "F"

def fetch():
    rows,frm=[],0
    while True:
        u=SB+"/rest/v1/bbref_seasons?select=espn_id,player,school,season_year,class,pos,tdc_grade&tdc_grade=not.is.null&espn_id=not.is.null"
        req=urllib.request.Request(u,headers={**HDR,"Range-Unit":"items","Range":"%d-%d"%(frm,frm+999)})
        b=json.load(urllib.request.urlopen(req,timeout=60)); rows+=b
        if len(b)<1000: break
        frm+=1000
    return rows

def main():
    rows=fetch()
    # dedupe a player-season (keep the school with the row; bbref rows are per school-season)
    # curve
    cs=defaultdict(lambda:[0,0]); cg=defaultdict(lambda:[0,0])
    for r in rows:
        o=co(r["class"]);
        if not o: continue
        g=int(r["tdc_grade"]); cs[o][0]+=g; cs[o][1]+=1
        k=(grp(r["pos"]),o); cg[k][0]+=g; cg[k][1]+=1
    curve={"overall":[round(cs[o][0]/cs[o][1],1) for o in (1,2,3,4)]}
    for gp in ("G","F","B"):
        curve[gp]=[round(cg[(gp,o)][0]/max(1,cg[(gp,o)][1]),1) for o in (1,2,3,4)]

    # per-player arcs (by espn_id)
    byp=defaultdict(list)
    for r in rows:
        try: byp[r["espn_id"]].append((int(r["season_year"]),r["player"],r["school"],int(r["tdc_grade"])))
        except Exception: pass
    risers=[]; jumps=[]; busts=[]
    for pid,ss in byp.items():
        ss.sort()
        if len(ss)<2: continue
        first=ss[0]; peak=max(ss,key=lambda x:x[3]); low=min(ss,key=lambda x:x[3]); last=ss[-1]
        nm=ss[-1][1]
        # career riser: first grade -> peak grade
        gain=peak[3]-first[3]
        if first[3]<=93:  # room to grow
            risers.append({"espn_id":pid,"player":nm,"from_school":first[2],"peak_school":peak[2],
                           "from_year":first[0],"peak_year":peak[0],"from":first[3],"peak":peak[3],"gain":gain,"seasons":len(ss)})
        # biggest single-season jump
        for i in range(1,len(ss)):
            d=ss[i][3]-ss[i-1][3]
            jumps.append({"espn_id":pid,"player":nm,"school":ss[i][2],"year":ss[i][0],
                          "from":ss[i-1][3],"to":ss[i][3],"jump":d})
        # career bust: first -> last decline (min at least 3 seasons or notable drop)
        drop=last[3]-first[3]
        busts.append({"espn_id":pid,"player":nm,"school":last[2],"from":first[3],"to":last[3],"drop":drop,"seasons":len(ss)})

    risers=sorted(risers,key=lambda x:-x["gain"])[:40]
    jumps=sorted(jumps,key=lambda x:-x["jump"])[:40]
    busts=sorted(busts,key=lambda x:x["drop"])[:20]
    out={"curve":curve,
         "counts":{o:cs[o][1] for o in (1,2,3,4)},
         "risers":risers,"jumps":jumps,"busts":busts,
         "total_seasons":len(rows)}
    os.makedirs(os.path.dirname(OUT),exist_ok=True)
    json.dump(out,open(OUT,"w"))
    print("curve overall:",curve["overall"])
    print("top risers:")
    for r in risers[:6]: print("  %-20s %d->%d (+%d) %s"%(r["player"][:20],r["from"],r["peak"],r["gain"],r["peak_school"]))
    print("biggest single-season jumps:")
    for j in jumps[:5]: print("  %-20s %d->%d (+%d) %s %d"%(j["player"][:20],j["from"],j["to"],j["jump"],j["school"],j["year"]))
    print("wrote",OUT)

if __name__=="__main__": main()
