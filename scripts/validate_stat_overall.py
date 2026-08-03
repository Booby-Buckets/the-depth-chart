#!/usr/bin/env python3
"""
validate_stat_overall.py — does the statistical overall predict team success
better than the current box-model (hand-grade-trained) grade?

For every team-season 2013-2025, team strength is built two ways from the SAME
players / minutes / aggregation, then correlated with actual win% and SRS:
  * STAT  = minutes-weighted mean statistical overall (stat_overall_history.csv)
  * HAND  = minutes-weighted mean box-model tdc_grade (player_history, back-scored)

Caveats reported honestly:
  - win% is the cleaner target (nothing in either metric uses it).
  - SRS is somewhat generous to STAT: the overall's SOS factor is built from
    conference SRS, so aggregate-STAT vs team-SRS is partly self-referential.
  - both metrics aggregate individual box-derived value to the team, so some
    win-tracking is expected by construction; the point is the RELATIVE gap.
"""
import sys, json, os
import numpy as np, pandas as pd
import urllib.request

SB="https://izlqhnxowdhtdofkwrho.supabase.co"; KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),"data")

def sb_get(path):
    # STABLE ORDER required: PostgREST offset pagination without ORDER BY skips/dupes rows.
    order=""
    if "order=" not in path and "select=" in path:
        first=path.split("select=",1)[1].split("&",1)[0].split(",")[0]
        if first: order=f"&order={first}.asc"
    out,off=[],0
    while True:
        url=f"{SB}/rest/v1/{path}"+("&" if "?" in path else "?")+f"limit=1000&offset={off}{order}"
        ch=json.load(urllib.request.urlopen(urllib.request.Request(url,headers=H))); out+=ch
        if len(ch)<1000: break
        off+=1000
    return out

print("Loading overall history + box grades + minutes + team results...",file=sys.stderr)
stat=pd.read_csv(os.path.join(D,"stat_overall_history.csv"))
adv =pd.DataFrame(sb_get("player_advanced?select=espn_id,season_year,min"))
ph  =pd.DataFrame(sb_get("player_history?select=espn_id,season_year,tdc_grade"))
ts  =pd.DataFrame(sb_get("team_seasons?select=season_year,team,wins,losses,srs"))
for df,cols in [(adv,["espn_id","season_year","min"]),(ph,["espn_id","season_year","tdc_grade"]),(ts,["season_year","wins","losses","srs"])]:
    for c in cols: df[c]=pd.to_numeric(df[c],errors="coerce")

d=stat.merge(adv,on=["espn_id","season_year"]).merge(ph,on=["espn_id","season_year"])
d=d.dropna(subset=["min","ovr","tdc_grade"]); d=d[d["min"]>=200]

def wm(v,w):
    s=w.sum(); return (v*w).sum()/s if s>0 else np.nan
rows=[]
for (yr,tm),g in d.groupby(["season_year","team"]):
    rows.append({"season_year":yr,"team":tm,"n":len(g),
                 "stat":wm(g["ovr"],g["min"]), "hand":wm(g["tdc_grade"],g["min"])})
agg=pd.DataFrame(rows)
ts["winpct"]=ts["wins"]/(ts["wins"]+ts["losses"])
m=agg.merge(ts,on=["season_year","team"])
m=m[(m["n"]>=6)&(m["season_year"].between(2013,2025))&m["winpct"].notna()]
print(f"Team-seasons in test: {len(m)}\n",file=sys.stderr)

def report(target,tlabel,note=""):
    r_s=np.corrcoef(m["stat"],m[target])[0,1]; r_h=np.corrcoef(m["hand"],m[target])[0,1]
    print(f"vs {tlabel:6}  STAT r={r_s:.3f} R2={r_s**2:.3f}   HAND r={r_h:.3f} R2={r_h**2:.3f}   "
          f"STAT +{(r_s**2-r_h**2)*100:.0f} pts variance {note}")

print("HEAD-TO-HEAD: minutes-weighted team strength -> team success (2013-2025)\n")
report("winpct","win%","(clean target)")
report("srs","SRS","(SOS-circular for STAT; read with care)")

print("\nPer-season r vs win%:")
for yr,g in m.groupby("season_year"):
    if len(g)<50: continue
    rs=np.corrcoef(g["stat"],g["winpct"])[0,1]; rh=np.corrcoef(g["hand"],g["winpct"])[0,1]
    print(f"  {int(yr)}: STAT {rs:.3f}   HAND {rh:.3f}   (+{(rs**2-rh**2)*100:.0f} pts)")
