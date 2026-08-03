#!/usr/bin/env python3
"""
build_stat_overall_projected.py — PROJECTED 2026-27 overall, VALUED FROM A PROJECTED
STAT LINE (per user: the overall must be based on our projected stats, not last year's).

Pipeline:
  1. PROJECT each returner's full 2026-27 box line:
       • role minutes  (SLOT_MIN by depth_order, floored at last mpg)
       • USAGE VACANCY — redistribute departed teammates' usage/possessions to returners
         (weighted by talent × new role), so a gutted roster's returners take on more
       • volume (shots/assists/turnovers) scales with the new usage; boards/steals/blocks
         scale with minutes; efficiency regresses (FT-implied 3P%, toward positional means,
         small usage penalty); a class-development bump
  2. VALUE that projected line through the SAME statistical valuation as the demonstrated
     overall — compute TI/40 + OWA from the projected box (the site's TI weights), carry
     DWA from last year's defensive rate (team-D context can't be projected), SOS-adjust,
     usage-weight, per-40 quality × role, then map onto the FROZEN demonstrated-2026 scale.

Read-only vs the DB. Writes scripts/data/stat_overall_projected.json.
"""
import sys, json, os, math
import numpy as np, pandas as pd
import urllib.request
from scipy.stats import norm

SB="https://izlqhnxowdhtdofkwrho.supabase.co"; KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),"data")
CUR=2026; K_SOS=0.42; MU=73.0; SP=7.6; FLOOR=55; REF_MIN=200; G_PROJ=31
USG_REF=21.0; USG_POW=1.2; USG_LO=0.45; USG_HI=1.08   # match build_stat_overall.py
# ---- TI weights (must equal derived_stats.py TI_W) ----
TIW={"pts":1.0,"oreb":0.8,"dreb":0.3,"ast":0.7,"stl":1.4,"blk":0.9,"miss_fg":-0.5,"miss_ft":-0.35,"tov":-1.0}
REG_MP=100.0; OWA_REPL=3.0; OWA_A=-0.10; OWA_B=0.0092
# ---- projection knobs ----
RETURNER_VAC=0.70    # share of departed usage that returners (vs incoming frosh) absorb
USG_SCORE_EL=0.90    # shot volume elasticity to usage
USG_AST_EL=0.55      # assist elasticity to usage
USG_TOV_EL=0.95      # turnover elasticity to usage
USG_EFF_PEN=0.06     # FG% drop per +100% usage (usage-efficiency tradeoff)
REG_FG, REG_TP, REG_FT = 0.15, 0.25, 0.20   # shrink efficiency toward positional mean
FTIMP_W=0.35         # weight on FT-implied 3P% (0.55*ftpct-10)
TARGET_TEAM_USG=22.0; USG_CAP=(9.0,32.0); MPG_XFER_BUMP=10.0; TRANSFER_DEF_DAMP=0.5

def sb_get(path):
    # STABLE ORDER is required: PostgREST offset pagination without ORDER BY returns
    # inconsistent pages (duplicates + skipped rows) — silently dropped ~780 players.
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
def _n(v,d=0.0):
    try:
        f=float(v); return f if math.isfinite(f) else d
    except (TypeError,ValueError): return d
POS_FG={"PG":44,"SG":43,"SF":45,"PF":49,"C":54,"G":43,"F":47}
POS_TP={"PG":35,"SG":36,"SF":35,"PF":31,"C":24,"G":35,"F":33}
POS_FT={"PG":78,"SG":76,"SF":74,"PF":71,"C":66,"G":77,"F":72}
def _pos(p):
    p=(p or "").upper()
    for k in ("PG","SG","SF","PF"):
        if p==k: return k
    if p.startswith("C"): return "C"
    if p.startswith("G"): return "G"
    if p.startswith("F"): return "F"
    return "SF"
SLOT_MIN=[0,31,30,29,27,25,19,16,12,9,7]
def proj_mpg(d,last,starter):
    d=int(d) if pd.notna(d) else None
    slot=(SLOT_MIN[d] if d and 1<=d<len(SLOT_MIN) else (5 if d and d>=len(SLOT_MIN) else 0))
    last=last or 0; floor=last*0.9 if last>0 else 0
    if starter and (d is None or d<=6): floor=max(floor,28)
    pm=max(slot,floor)
    if d is None and last>0: pm=last
    return pm
DEV=json.load(open(os.path.join(D,"dev_curves.json")))["rate_mult"]
def cls_trans(yr):
    y=str(yr or "").lower()
    if "fr" in y: return "so"
    if "so" in y: return "jr"
    if "jr" in y: return "sr"
    return None
def dev_mult(yr,demo):
    t=cls_trans(yr)
    if not t: return 1.0
    tier="low" if demo<73 else ("mid" if demo<84 else "high")
    return DEV.get(t,{}).get(tier,1.0)

print("Pulling roster, last-year box + advanced, team SOS...",file=sys.stderr)
adv=pd.DataFrame(sb_get(f"player_advanced?select=espn_id,name,team,g,min,usg_pct,owa,dwa,ti40&season_year=eq.{CUR}"))
box=pd.DataFrame(sb_get(f"player_history?select=espn_id,ppg,mpg,fgm,fga,tpm,tpa,ftm,fta,oreb,dreb,stl,blk,tovs,apg,gp,fg_pct,tp_pct,ft_pct&season_year=eq.{CUR}"))
pl =pd.DataFrame(sb_get("players?select=espn_id,depth_order,starter,mpg,yr,class_year,team,position,height"))
ts =pd.DataFrame(sb_get("team_seasons?select=season_year,team,conference,srs"))
for df in (adv,pl,box): df["espn_id"]=pd.to_numeric(df["espn_id"],errors="coerce").astype("Int64")
for c in ["g","min","usg_pct","owa","dwa","ti40"]: adv[c]=pd.to_numeric(adv[c],errors="coerce")
for c in ["ppg","mpg","fgm","fga","tpm","tpa","ftm","fta","oreb","dreb","stl","blk","tovs","apg","gp","fg_pct","tp_pct","ft_pct"]:
    box[c]=pd.to_numeric(box[c],errors="coerce")
box=box.dropna(subset=["espn_id"]).drop_duplicates("espn_id").set_index("espn_id")
advByEspn=adv.dropna(subset=["espn_id"]).drop_duplicates("espn_id").set_index("espn_id")
BOX_IDS=set(int(x) for x in box.index)   # plain-int membership (Int64Index `in` is unreliable)

# ---- SOS: TEAM-LEVEL strength blended with conference, then HAND-TUNED conference targets
#      + a Gonzaga anomaly pin — must match build_stat_overall.py so projected grades sit on
#      the same scale. 2026-27 has no team_seasons row yet, so we proxy each team's
#      environment with its 2026 SRS; a transfer inherits their NEW school's SOS.
W_TEAM=0.45; SOS_REF_PCT=0.95; SOS_FLOOR=0.50   # must match build_stat_overall.py
CONF_TARGET={"Atlantic Coast Conference":0.96,"Big East Conference":0.94,
             "Mountain West Conference":0.80,"Atlantic 10 Conference":0.80,
             "American Conference":0.75}
TEAM_SOS_OVERRIDE={"Gonzaga Bulldogs":0.92}
ts["srs"]=pd.to_numeric(ts["srs"],errors="coerce"); ts["season_year"]=pd.to_numeric(ts["season_year"],errors="coerce")
tcur=ts[ts.season_year==CUR].dropna(subset=["conference","srs"]).copy().drop_duplicates("team")
cs=tcur.groupby("conference")["srs"].mean()
tcur["conf_srs"]=tcur["conference"].map(cs)
tcur["strength"]=W_TEAM*tcur["srs"]+(1.0-W_TEAM)*tcur["conf_srs"]
top=tcur["strength"].quantile(SOS_REF_PCT)
tcur["sos"]=(1.0-K_SOS*(1.0-tcur["strength"]/top)).clip(SOS_FLOOR,1.0)
tconf=tcur.set_index("team")["conference"].to_dict()
tsos=tcur.set_index("team")["sos"].to_dict()
def sos_of(full_team):
    ov=TEAM_SOS_OVERRIDE.get(full_team)
    if ov is not None: return ov                     # team anomaly pin (overrides conf)
    conf=tconf.get(full_team); t=CONF_TARGET.get(conf)
    if t is not None: return t                        # flat conference level
    s=tsos.get(full_team)
    return 0.80 if s is None else float(s)
# short->full team name (predictive_ratings), to link current roster to last-year school
S2F={}
try:
    pr=json.load(urllib.request.urlopen(urllib.request.Request(SB+"/rest/v1/predictive_ratings?season=eq.2027&select=data&limit=1",headers=H)))
    for t in (pr[0]["data"]["teams"] if pr else []):
        if t.get("team") and t.get("full"): S2F[t["team"].lower()]=t["full"]
except Exception as e: print("warn: no S2F map",e,file=sys.stderr)

# ---- DEMONSTRATED 2026 reference scale (matches build_stat_overall.py) ----
d26=advByEspn.reset_index().copy()
d26=d26[d26["min"].fillna(0)>=REF_MIN].copy()
d26["sos"]=d26["team"].map(sos_of)
d26["mp40"]=d26["min"]/40.0
d26["usg_mult"]=np.clip((pd.to_numeric(d26["usg_pct"],errors="coerce").fillna(USG_REF)/USG_REF)**USG_POW,USG_LO,USG_HI)
d26["wa"]=(d26["owa"].fillna(0)*d26["usg_mult"]+d26["dwa"].fillna(0))*d26["sos"]
per40=d26["wa"]/d26["mp40"].clip(lower=0.1)
MU40=per40.median(); P90=d26["min"].quantile(0.90); cred=d26["min"]/(d26["min"]+400.0)
d26["C"]=(MU40+cred*(per40-MU40))*np.sqrt((d26["min"]/P90).clip(0,1.3))
REF=np.sort(d26["C"].values)
def to_grade(c):
    pct=np.searchsorted(REF,c,side="right")/(len(REF)+1); pct=min(max(pct,1e-4),1-1e-4)
    return int(round(min(99,max(FLOOR,MU+SP*norm.ppf(pct)))))
demo_ovr={int(r.espn_id):to_grade(r.C) for r in d26.itertuples()}

# ---- group last-year rotations (by full team) + current roster (by short team) ----
adv_by_team={}
for r in advByEspn.reset_index().itertuples():
    adv_by_team.setdefault(r.team,[]).append(r)
roster_by_team={}
for r in pl.dropna(subset=["espn_id"]).itertuples():
    roster_by_team.setdefault(r.team,[]).append(r)

def ti_value(pg, min_season, games=G_PROJ):
    """TI/40 + OWA from a PER-GAME line scaled to a season (games long)."""
    G=games
    tot={k:pg[k]*G for k in ("pts","oreb","dreb","ast","stl","blk","fga","fgm","fta","ftm","tov")}
    mn=pg["mpg"]*G
    ti=(TIW["pts"]*tot["pts"]+TIW["oreb"]*tot["oreb"]+TIW["dreb"]*tot["dreb"]+TIW["ast"]*tot["ast"]
        +TIW["stl"]*tot["stl"]+TIW["blk"]*tot["blk"]+TIW["miss_fg"]*(tot["fga"]-tot["fgm"])
        +TIW["miss_ft"]*(tot["fta"]-tot["ftm"])+TIW["tov"]*tot["tov"])
    ti40=ti*40.0/(mn+REG_MP)
    ti_off=(1.0*tot["pts"]+0.8*tot["oreb"]+0.7*tot["ast"]-0.5*(tot["fga"]-tot["fgm"])
            -0.35*(tot["fta"]-tot["ftm"])-1.0*tot["tov"])
    ti_off40=ti_off*40.0/(mn+REG_MP)
    owa=OWA_A+OWA_B*((ti_off40-OWA_REPL)*(mn/40.0))
    return ti40, owa, mn

out={}
for short, roster in roster_by_team.items():
    full=S2F.get(short.lower()) or short
    last_roster=adv_by_team.get(full,[])
    returner_ids={int(p.espn_id) for p in roster if pd.notna(p.espn_id) and int(p.espn_id) in BOX_IDS}
    # departures = last-year rotation (real minutes) not returning
    departures=[r for r in last_roster if int(r.espn_id) not in returner_ids and _n(r.min)>=150]
    vac_load=sum(_n(r.usg_pct,USG_REF)*_n(r.min) for r in departures)   # departed usage load (%·season-min)
    # returners with a real last-year line
    R=[]
    for p in roster:
        if pd.isna(p.espn_id) or int(p.espn_id) not in BOX_IDS: continue
        e=int(p.espn_id); b=box.loc[e]; a=advByEspn.loc[e] if e in advByEspn.index else None
        if _n(a["g"] if a is not None else 0)<3 and _n(b["gp"])<3: continue
        last_mpg=_n(b["mpg"]) or _n(p.mpg) or 0
        if last_mpg<3: continue
        starter=str(p.starter).lower() in ("true","t")
        pm=proj_mpg(p.depth_order,last_mpg,starter)
        R.append(dict(e=e,p=p,b=b,a=a,last_mpg=last_mpg,pm=pm,
                      last_usg=_n(a["usg_pct"] if a is not None else None,USG_REF) or USG_REF,
                      demo=demo_ovr.get(e,72)))
    if not R: continue
    # redistribute vacated usage to returners (weight = last_usg × proj_min)
    wsum=sum(r["last_usg"]*r["pm"] for r in R) or 1
    for r in R:
        share=(r["last_usg"]*r["pm"])/wsum
        add_usg=(vac_load*RETURNER_VAC*share)/max(r["pm"]*G_PROJ,1.0)   # %·min · frac / min = %
        r["raw_usg"]=r["last_usg"]+add_usg
    # TEAM CONSTRAINT: on-court usages sum to ~100%, so the rotation can't average >~22%.
    # If the vacancy pushed the returners' minute-weighted usage over target, scale it back
    # (preserving who's higher-usage) — a gutted roster still can't field five 34%-usage guys.
    tmin=sum(r["pm"] for r in R) or 1
    mw=sum(r["raw_usg"]*r["pm"] for r in R)/tmin
    scale=min(1.0, TARGET_TEAM_USG/mw) if mw>0 else 1.0
    for r in R:
        r["proj_usg"]=min(USG_CAP[1],max(USG_CAP[0],r["raw_usg"]*scale))

    for r in R:
        p,b,e=r["p"],r["b"],r["e"]; pos=_pos(p.position)
        last_mpg=r["last_mpg"]; pm=r["pm"]
        # transfer? (played elsewhere last year) — cap the minutes jump
        demo_team_full=(r["a"].team if r["a"] is not None else None)
        xfer=bool(demo_team_full and not str(demo_team_full).lower().startswith(str(short).lower()))
        if xfer: pm=min(pm,last_mpg+MPG_XFER_BUMP)
        usg_ratio=min(1.6,max(0.6,r["proj_usg"]/max(r["last_usg"],1)))
        dm=dev_mult(p.yr or p.class_year, r["demo"])
        # per-40 last-year rates
        def p40(k): return _n(b[k])*40.0/max(last_mpg,1)
        fga40=p40("fga")*usg_ratio*dm; tpa40=p40("tpa")*usg_ratio*dm; fta40=p40("fta")*usg_ratio*dm
        ast40=p40("apg")*(usg_ratio**USG_AST_EL); tov40=p40("tovs")*(usg_ratio**USG_TOV_EL)
        oreb40=p40("oreb"); dreb40=p40("dreb"); stl40=p40("stl"); blk40=p40("blk")   # minutes-based
        # efficiency: regress toward positional mean + FT-implied 3P% + usage penalty
        ft=_n(b["ft_pct"],POS_FT[pos]); tp=_n(b["tp_pct"],POS_TP[pos]); fg=_n(b["fg_pct"],POS_FG[pos])
        ftimp=0.55*ft-10.0
        tp_p=(1-REG_TP-FTIMP_W)*tp+REG_TP*POS_TP[pos]+FTIMP_W*ftimp
        fg_p=((1-REG_FG)*fg+REG_FG*POS_FG[pos])*(1-USG_EFF_PEN*(usg_ratio-1))
        ft_p=(1-REG_FT)*ft+REG_FT*POS_FT[pos]
        fg_p=min(72,max(30,fg_p)); tp_p=min(48,max(20,tp_p)); ft_p=min(95,max(45,ft_p))
        # per-game projected line
        sc=pm/40.0
        fga=fga40*sc; tpa=tpa40*sc; fta=fta40*sc
        fgm=fga*fg_p/100.0; tpm=tpa*tp_p/100.0; ftm=fta*ft_p/100.0
        pts=2*fgm+tpm+ftm
        pg=dict(mpg=pm,pts=pts,fga=fga,fgm=fgm,tpa=tpa,tpm=tpm,fta=fta,ftm=ftm,
                oreb=oreb40*sc,dreb=dreb40*sc,ast=ast40*sc,stl=stl40*sc,blk=blk40*sc,tov=tov40*sc)
        rpg=pg["oreb"]+pg["dreb"]
        # value it
        ti40,owa,mn=ti_value(pg,pm*G_PROJ)
        # ANCHOR OWA to the stored value: my TI formula drifts from the site's stored OWA
        # per-player, so carry only the PROJECTED CHANGE off the stored anchor.
        #   proj_owa = stored_owa + (my_owa(projected) - my_owa(demonstrated))
        if r["a"] is not None and _n(r["a"]["owa"]) != 0:
            gp_demo=_n(b["gp"]) or (last_min/max(last_mpg,1))
            demo_pg=dict(mpg=last_mpg,pts=_n(b["ppg"]),fga=_n(b["fga"]),fgm=_n(b["fgm"]),
                         fta=_n(b["fta"]),ftm=_n(b["ftm"]),oreb=_n(b["oreb"]),dreb=_n(b["dreb"]),
                         ast=_n(b["apg"]),stl=_n(b["stl"]),blk=_n(b["blk"]),tov=_n(b["tovs"]))
            _,owa_demo,_=ti_value(demo_pg,last_mpg*max(gp_demo,1),games=max(gp_demo,1))
            owa=_n(r["a"]["owa"])+(owa-owa_demo)
        # DWA carries from last year's defensive RATE (team-D can't be projected), scaled to new minutes
        dwa_last=_n(r["a"]["dwa"] if r["a"] is not None else 0); last_min=_n(r["a"]["min"] if r["a"] is not None else last_mpg*G_PROJ) or 1
        dwa40=dwa_last/(last_min/40.0)
        if xfer: dwa40=0.5*dwa40   # team-D credit doesn't fully transfer
        dwa_p=dwa40*(mn/40.0)
        sos=sos_of(full)
        usg_mult=min(USG_HI,max(USG_LO,(r["proj_usg"]/USG_REF)**USG_POW))
        wa=(owa*usg_mult+dwa_p)*sos
        per40_p=wa/max(mn/40.0,0.1)
        # RATE reliability comes from his ACTUAL sample, not the projected minutes — a
        # noisy small-minutes line stays shrunk toward the median even projected into a big
        # role (else a hot 200-min stretch projects to an elite starter). Projected minutes
        # drive only the volume/role credit below.
        cred_a=last_min/(last_min+400.0)
        b_p=MU40+cred_a*(per40_p-MU40)
        c_p=b_p*math.sqrt(min(max(mn/P90,0),1.3))
        ovr=to_grade(c_p)
        out[str(e)]={
            "ovr":ovr,"demo_ovr":int(r["demo"]),"proj_mpg":round(pm,1),"last_mpg":round(last_mpg,1),
            "dev_mult":round(dm,3),"proj_usg":round(r["proj_usg"],1),"last_usg":round(r["last_usg"],1),
            "proj_wa":round(wa,1),"ti40":round(ti40,1),"usg":round(r["proj_usg"],1),
            "dwa":round(dwa_p,2),"sos":round(sos,2),
            # projected box line (per-game) for the player page
            "ppg":round(pts,1),"rpg":round(rpg,1),"apg":round(pg["ast"],1),"mpg":round(pm,1),
            "fg_pct":round(fg_p,1),"tp_pct":round(tp_p,1),"ft_pct":round(ft_p,1),
            "stl":round(pg["stl"],1),"blk":round(pg["blk"],1),"tovs":round(pg["tov"],1),
            "oreb":round(pg["oreb"],1),"dreb":round(pg["dreb"],1),
        }

json.dump({"season":"2026-27","scale":{"mu":MU,"sp":SP},"n":len(out),"players":out},
          open(os.path.join(D,"stat_overall_projected.json"),"w"),separators=(",",":"),allow_nan=False)
print(f"Wrote stat_overall_projected.json ({len(out)} returners)",file=sys.stderr)
prev=pd.DataFrame([{**v,"espn":k} for k,v in out.items()]); prev["move"]=prev["ovr"]-prev["demo_ovr"]
print("\nTop projected 2026-27:",file=sys.stderr)
names=advByEspn["name"].to_dict()
prev["name"]=prev["espn"].astype(int).map(names)
for _,r in prev.sort_values("ovr",ascending=False).head(12).iterrows():
    print(f"  {str(r['name'])[:20]:20} proj {r['ovr']} (demo {r['demo_ovr']}, {r['move']:+d})  {r['ppg']}pg {r['proj_mpg']}mpg usg {r['last_usg']}->{r['proj_usg']}",file=sys.stderr)
# Fogle spotlight
f=out.get("5196913")
if f: print(f"\nDavis Fogle: proj OVR {f['ovr']} (demo {f['demo_ovr']}) — projected line {f['ppg']}p/{f['rpg']}r/{f['apg']}a {f['fg_pct']}fg/{f['tp_pct']}3p, usg {f['last_usg']}->{f['proj_usg']}, mpg {f['last_mpg']}->{f['proj_mpg']}",file=sys.stderr)
