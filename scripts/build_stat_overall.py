#!/usr/bin/env python3
"""
build_stat_overall.py — the FULL STATISTICAL overall, back-scored 2012→2026.

Premise: overall = era- and competition-adjusted contribution to winning, from
owned metrics only (player_advanced). No hand grades. See memory
grade-statistical-overall.

Per season:
  1. SOS factor per team from that season's conference SRS (team_seasons), so
     realignment is handled per-year:  factor = 1 - k*(1 - conf_srs/top_srs).
  2. Balanced value = SOS-adj wins added -> per-40 (minutes-shrunk) -> x role credit.
  3. Probit scale (MU=73, SP=7.3): percentile -> inverse-normal -> grade, clip 55..99.

Writes (read-only w.r.t. the DB; local files only):
  scripts/data/stat_overall.json          current-season espn_id -> {ovr, components}  (player page)
  scripts/data/stat_overall_history.csv   espn_id,season_year,team,ovr  (all seasons, for cutover + validation)
"""
import sys, json, os
import numpy as np, pandas as pd
import urllib.request
from scipy.stats import norm

SB="https://izlqhnxowdhtdofkwrho.supabase.co"; KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),"data")
CUR=2026; K_SOS=0.42; MU=73.0; SP=7.3; FLOOR=55; MIN_MIN=200

def sb_get(path):
    out,off=[],0
    while True:
        url=f"{SB}/rest/v1/{path}"+("&" if "?" in path else "?")+f"limit=1000&offset={off}"
        ch=json.load(urllib.request.urlopen(urllib.request.Request(url,headers=H))); out+=ch
        if len(ch)<1000: break
        off+=1000
    return out

def pos_bucket(p):
    if not isinstance(p,str) or not p: return "?"
    p=p.upper()
    if p.startswith("C"): return "C"
    if p.startswith("G") or p in ("PG","SG"): return "G"
    if p.startswith("F") or p in ("SF","PF"): return "F"
    return "?"

print("Pulling player_advanced (all seasons), team_seasons, positions...",file=sys.stderr)
adv=pd.DataFrame(sb_get("player_advanced?select=espn_id,season_year,name,team,min,ppg,usg_pct,tov_pct,ti40,owa,dwa"))
ts =pd.DataFrame(sb_get("team_seasons?select=season_year,team,conference,srs,wins,losses"))
ph =pd.DataFrame(sb_get("player_history?select=espn_id,season_year,position"))
for c in ["espn_id","season_year","min"]: adv[c]=pd.to_numeric(adv[c],errors="coerce")
for c in ["usg_pct","tov_pct","ti40","owa","dwa"]: adv[c]=pd.to_numeric(adv[c],errors="coerce")
for c in ["season_year","srs","wins","losses"]: ts[c]=pd.to_numeric(ts[c],errors="coerce")
ph["espn_id"]=pd.to_numeric(ph["espn_id"],errors="coerce")
ph["season_year"]=pd.to_numeric(ph["season_year"],errors="coerce")

# ---- per-season, per-team SOS from conference SRS ----
ts=ts.dropna(subset=["conference","srs"])
conf_str=ts.groupby(["season_year","conference"])["srs"].mean().rename("conf_srs").reset_index()
top=conf_str.groupby("season_year")["conf_srs"].max().rename("top_srs").reset_index()
tmap=ts.merge(conf_str,on=["season_year","conference"]).merge(top,on="season_year")
tmap["sos"]=1.0 - K_SOS*(1.0 - tmap["conf_srs"]/tmap["top_srs"])
sos_lookup=tmap.set_index(["season_year","team"])["sos"].to_dict()

# positions (latest per espn_id)
ph=ph.dropna(subset=["espn_id"]).sort_values("season_year")
posmap=ph.groupby("espn_id")["position"].last().map(pos_bucket).to_dict()

def sos_of(row):
    return sos_lookup.get((row["season_year"], row["team"]), 0.80)

adv["sos"]=adv.apply(sos_of,axis=1)
adv=adv[adv["min"].fillna(0)>=MIN_MIN].copy()
adv["mp40"]=adv["min"]/40.0
adv["wa"]=(adv["owa"].fillna(0)+adv["dwa"].fillna(0))*adv["sos"]

rows=[]
for yr,g in adv.groupby("season_year"):
    g=g.copy()
    per40=g["wa"]/g["mp40"].clip(lower=0.1)
    mu40=per40.median(); cred=g["min"]/(g["min"]+400.0)
    b=mu40+cred*(per40-mu40)
    c=b*np.sqrt((g["min"]/g["min"].quantile(0.90)).clip(0,1.3))
    pct=c.rank(method="average")/(len(c)+1)
    g["ovr"]=np.round((MU+SP*norm.ppf(pct)).clip(FLOOR,99),0).astype(int)
    rows.append(g)
allg=pd.concat(rows)
print(f"Scored {len(allg)} player-seasons across {allg['season_year'].nunique()} seasons",file=sys.stderr)

# ---- history CSV (all seasons) ----
hist=allg[["espn_id","season_year","team","ovr"]].dropna(subset=["espn_id"]).copy()
hist["espn_id"]=hist["espn_id"].astype(int)
hist.to_csv(os.path.join(D,"stat_overall_history.csv"),index=False)

# ---- current-season JSON for the player page ----
cur=allg[allg["season_year"]==CUR].dropna(subset=["espn_id"])
out={}
for _,r in cur.iterrows():
    out[str(int(r["espn_id"]))]={
        "ovr":int(r["ovr"]),"pos":posmap.get(r["espn_id"],"?"),
        "wa":round(float(r["wa"]),1),"ti40":round(float(r["ti40"] or 0),1),
        "usg":round(float(r["usg_pct"] or 0),1),"dwa":round(float(r["dwa"] or 0),2),
        "sos":round(float(r["sos"]),2),
    }
json.dump({"season":CUR,"scale":{"mu":MU,"sp":SP},"n":len(out),"players":out},
          open(os.path.join(D,"stat_overall.json"),"w"),separators=(",",":"))
print(f"Wrote stat_overall.json ({len(out)} current players) + stat_overall_history.csv ({len(hist)} rows)",file=sys.stderr)
print(f"[{CUR}] top: "+", ".join(f"{r['name']} {int(r['ovr'])}" for _,r in cur.sort_values('ovr',ascending=False).head(5).iterrows()),file=sys.stderr)
