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
CUR=2026; K_SOS=0.42; MU=73.0; SP=7.6; FLOOR=55; MIN_GP=3; REF_MIN=200
# Usage weighting: a low-usage finisher's efficiency is "easier" (uncontested rim
# finishes) and less valuable than the same efficiency carried at high volume, so we
# scale the OFFENSIVE value by how much of the offense a player shoulders. Pulls
# empty-efficiency role bigs down and separates role players from high-load creators.
USG_REF=21.0; USG_POW=1.2; USG_LO=0.45; USG_HI=1.08   # mostly a DOWNWEIGHT for low usage; only a slight boost above average

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

def pos_bucket(p):
    if not isinstance(p,str) or not p: return "?"
    p=p.upper()
    if p.startswith("C"): return "C"
    if p.startswith("G") or p in ("PG","SG"): return "G"
    if p.startswith("F") or p in ("SF","PF"): return "F"
    return "?"

print("Pulling player_advanced (all seasons), team_seasons, positions...",file=sys.stderr)
adv=pd.DataFrame(sb_get("player_advanced?select=espn_id,season_year,name,team,g,min,ppg,usg_pct,tov_pct,ti40,owa,dwa"))
ts =pd.DataFrame(sb_get("team_seasons?select=season_year,team,conference,srs,wins,losses"))
ph =pd.DataFrame(sb_get("player_history?select=espn_id,season_year,position"))
for c in ["espn_id","season_year","min","g"]: adv[c]=pd.to_numeric(adv[c],errors="coerce")
for c in ["usg_pct","tov_pct","ti40","owa","dwa"]: adv[c]=pd.to_numeric(adv[c],errors="coerce")
for c in ["season_year","srs","wins","losses"]: ts[c]=pd.to_numeric(ts[c],errors="coerce")
ph["espn_id"]=pd.to_numeric(ph["espn_id"],errors="coerce")
ph["season_year"]=pd.to_numeric(ph["season_year"],errors="coerce")

# ---- per-season, per-team SOS: TEAM-LEVEL strength (own SRS) blended with conference ----
# Conference-average SRS alone punishes elite teams in weak leagues (Gonzaga/WCC) and
# flatters mediocre teams in strong ones (ASU/Big12). Blend the team's OWN SRS in so the
# environment tracks the actual team, not just its league.  Anchor "full credit" at the
# 95th-pct team (not the single max, which over-compresses everyone below it) and cap the
# multiplier at 1.0 so SOS is always a discount, never a bonus.
W_TEAM=0.45; SOS_REF_PCT=0.95; SOS_FLOOR=0.50
ts=ts.dropna(subset=["conference","srs"])
conf_str=ts.groupby(["season_year","conference"])["srs"].mean().rename("conf_srs").reset_index()
tmap=ts.merge(conf_str,on=["season_year","conference"])
tmap["strength"]=W_TEAM*tmap["srs"]+(1.0-W_TEAM)*tmap["conf_srs"]
ref=tmap.groupby("season_year")["strength"].quantile(SOS_REF_PCT).rename("top_srs").reset_index()
tmap=tmap.merge(ref,on="season_year")
tmap["sos"]=(1.0 - K_SOS*(1.0 - tmap["strength"]/tmap["top_srs"])).clip(SOS_FLOOR,1.0)
sos_lookup=tmap.set_index(["season_year","team"])["sos"].to_dict()

# positions (latest per espn_id)
ph=ph.dropna(subset=["espn_id"]).sort_values("season_year")
posmap=ph.groupby("espn_id")["position"].last().map(pos_bucket).to_dict()

def sos_of(row):
    return sos_lookup.get((row["season_year"], row["team"]), 0.80)

adv["sos"]=adv.apply(sos_of,axis=1)
# A player must have played >= MIN_GP games to get a rating at all (a 1-2 game
# sample is noise). Everyone else is scored, but the scale is calibrated against the
# ROTATION pool (>=REF_MIN minutes) so low-minute players land near the floor.
adv=adv[adv["g"].fillna(0)>=MIN_GP].copy()
adv["mp40"]=adv["min"]/40.0
_usg=pd.to_numeric(adv["usg_pct"],errors="coerce").fillna(USG_REF)
adv["usg_mult"]=np.clip((_usg/USG_REF)**USG_POW, USG_LO, USG_HI)
adv["wa"]=(adv["owa"].fillna(0)*adv["usg_mult"] + adv["dwa"].fillna(0))*adv["sos"]

rows=[]
for yr,g in adv.groupby("season_year"):
    g=g.copy()
    ref=g[g["min"]>=REF_MIN]
    if len(ref)<20: ref=g                       # tiny season fallback
    ref_per40=ref["wa"]/ref["mp40"].clip(lower=0.1)
    mu40=ref_per40.median(); P90=ref["min"].quantile(0.90)
    def _craw(gg):
        per40=gg["wa"]/gg["mp40"].clip(lower=0.1)
        cred=gg["min"]/(gg["min"]+400.0)
        b=mu40+cred*(per40-mu40)
        return b*np.sqrt((gg["min"]/P90).clip(0,1.3))
    g["_c"]=_craw(g)
    refc=np.sort(_craw(ref).values)             # rotation-pool reference distribution
    pct=(np.searchsorted(refc,g["_c"].values,side="right"))/(len(refc)+1)
    pct=np.clip(pct,1e-4,1-1e-4)
    g["ovr"]=np.round((MU+SP*norm.ppf(pct)).clip(FLOOR,99),0).astype(int)
    rows.append(g)
allg=pd.concat(rows)
print(f"Scored {len(allg)} player-seasons across {allg['season_year'].nunique()} seasons",file=sys.stderr)

# ---- history CSV (all seasons) ----
hist=allg[["espn_id","season_year","team","ovr"]].dropna(subset=["espn_id"]).copy()
hist["espn_id"]=hist["espn_id"].astype(int)
hist.to_csv(os.path.join(D,"stat_overall_history.csv"),index=False)
# client JSON: {season: {espn_id: ovr}} so gradeSolo can be season-aware for
# historical views (conference/team/index past-season top players, player history).
histj={}
for _,r in hist.iterrows():
    histj.setdefault(str(int(r["season_year"])),{})[str(int(r["espn_id"]))]=int(r["ovr"])
json.dump(histj, open(os.path.join(D,"stat_overall_history.json"),"w"), separators=(",",":"))

# ---- current-season JSON for the player page ----
def _sf(x,nd=1):   # NaN/None-safe number (low-minute players can have null usg/ti)
    return 0.0 if pd.isna(x) else round(float(x),nd)
cur=allg[allg["season_year"]==CUR].dropna(subset=["espn_id"])
out={}
for _,r in cur.iterrows():
    out[str(int(r["espn_id"]))]={
        "ovr":int(r["ovr"]),"pos":posmap.get(r["espn_id"],"?"),
        "wa":_sf(r["wa"]),"ti40":_sf(r["ti40"]),
        "usg":_sf(r["usg_pct"]),"dwa":_sf(r["dwa"],2),
        "sos":_sf(r["sos"],2),
    }
json.dump({"season":CUR,"scale":{"mu":MU,"sp":SP},"n":len(out),"players":out},
          open(os.path.join(D,"stat_overall.json"),"w"),separators=(",",":"),allow_nan=False)
print(f"Wrote stat_overall.json ({len(out)} current players) + stat_overall_history.csv ({len(hist)} rows)",file=sys.stderr)
print(f"[{CUR}] top: "+", ".join(f"{r['name']} {int(r['ovr'])}" for _,r in cur.sort_values('ovr',ascending=False).head(5).iterrows()),file=sys.stderr)
