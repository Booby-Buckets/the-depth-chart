#!/usr/bin/env python3
"""
build_stat_overall_projected.py — PROJECTED 2026-27 statistical overall.

Architecture (per user): the projection forecasts the INPUTS; the overall is a
fixed VALUATION of inputs. So we project each returner's stat line, then run it
through the SAME valuation as the demonstrated overall (build_stat_overall.py)
and map it onto the SAME frozen scale — demonstrated and projected are directly
comparable.

Projected line is built GRADE-INDEPENDENTLY (no circularity):
  * per-40 production carried from his ACTUAL 2025-26 line (owa/40, dwa/40, ti40)
  * nudged by the class development curve (dev_curves.rate_mult, offense only),
    tiered by his DEMONSTRATED statistical overall (not the old grade)
  * scaled to PROJECTED minutes from his depth-chart role (same projMin logic
    the site already uses: SLOT_MIN by depth_order, floored at last year's mpg)

Freshmen / newcomers (no played season) are NOT here — they keep the editor OVR.
Read-only; writes scripts/data/stat_overall_projected.json.
"""
import sys, json, os
import numpy as np, pandas as pd
import urllib.request
from scipy.stats import norm

SB="https://izlqhnxowdhtdofkwrho.supabase.co"; KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),"data")
CUR=2026; K_SOS=0.42; MU=73.0; SP=7.3; FLOOR=55; MIN_MIN=200; G_PROJ=31

def sb_get(path):
    out,off=[],0
    while True:
        url=f"{SB}/rest/v1/{path}"+("&" if "?" in path else "?")+f"limit=1000&offset={off}"
        ch=json.load(urllib.request.urlopen(urllib.request.Request(url,headers=H))); out+=ch
        if len(ch)<1000: break
        off+=1000
    return out

DEV=json.load(open(os.path.join(D,"dev_curves.json")))["rate_mult"]
def cls_trans(yr):
    y=str(yr or "").lower()
    if "fr" in y: return "so"
    if "so" in y: return "jr"
    if "jr" in y: return "sr"
    return None                                  # Sr./Gr. -> no growth
def qtier(demo): return "low" if demo<73 else ("mid" if demo<84 else "high")
def dev_mult(yr,demo):
    t=cls_trans(yr)
    if not t: return 1.0
    return DEV.get(t,{}).get(qtier(demo),1.0)

SLOT_MIN=[0,31,30,29,27,25,19,16,12,9,7]
def proj_mpg(d,last,starter):
    d=int(d) if pd.notna(d) else None
    slot=(SLOT_MIN[d] if d and 1<=d<len(SLOT_MIN) else (5 if d and d>=len(SLOT_MIN) else 0))
    last=last or 0
    floor=last*0.9 if last>0 else 0
    if starter and (d is None or d<=6): floor=max(floor,28)
    pm=max(slot,floor)
    if d is None and last>0: pm=last
    return pm

print("Pulling 2026 actuals, team SOS, current roster roles...",file=sys.stderr)
adv=pd.DataFrame(sb_get(f"player_advanced?select=espn_id,name,team,min,g,usg_pct,ti40,owa,dwa&season_year=eq.{CUR}"))
ts =pd.DataFrame(sb_get("team_seasons?select=season_year,team,conference,srs"))
pl =pd.DataFrame(sb_get("players?select=espn_id,depth_order,starter,mpg,yr,class_year,team"))
for c in ["espn_id","min","g","usg_pct","ti40","owa","dwa"]: adv[c]=pd.to_numeric(adv[c],errors="coerce")
for c in ["season_year","srs"]: ts[c]=pd.to_numeric(ts[c],errors="coerce")
for c in ["espn_id","depth_order","mpg"]: pl[c]=pd.to_numeric(pl[c],errors="coerce")

# per-season, per-team SOS (his 2025-26 competition level; transfers approximate)
ts=ts[ts.season_year==CUR].dropna(subset=["conference","srs"])
cs=ts.groupby("conference")["srs"].mean(); top=cs.max()
tconf=ts.set_index("team")["conference"].to_dict()
def sos_of(team):
    c=tconf.get(team); v=cs.get(c,np.nan)
    return 0.80 if not np.isfinite(v) else 1.0-K_SOS*(1.0-v/top)

adv=adv[adv["min"].fillna(0)>=MIN_MIN].copy()
adv["sos"]=adv["team"].map(sos_of)
adv["mp40"]=adv["min"]/40.0
adv["wa"]=(adv["owa"].fillna(0)+adv["dwa"].fillna(0))*adv["sos"]

# ---- DEMONSTRATED 2026 reference distribution (the frozen scale) ----
per40=adv["wa"]/adv["mp40"].clip(lower=0.1)
MU40=per40.median(); P90=adv["min"].quantile(0.90)
cred=adv["min"]/(adv["min"]+400.0)
b=MU40+cred*(per40-MU40)
adv["C_demo"]=b*np.sqrt((adv["min"]/P90).clip(0,1.3))
ref=np.sort(adv["C_demo"].values)
def to_grade(craw):
    pct=(np.searchsorted(ref,craw,side="right"))/(len(ref)+1)
    pct=min(max(pct,1e-4),1-1e-4)
    return int(round(min(99,max(FLOOR, MU+SP*norm.ppf(pct)))))
adv["demo_ovr"]=adv["C_demo"].apply(to_grade)

# ---- PROJECT each returner's line, value on the same scale ----
roles=pl.dropna(subset=["espn_id"]).drop_duplicates("espn_id").set_index("espn_id")
out={}
for _,r in adv.iterrows():
    eid=r["espn_id"]
    role=roles.loc[eid] if eid in roles.index else None
    d_ord = role["depth_order"] if role is not None else np.nan
    last_mpg = (role["mpg"] if role is not None and pd.notna(role["mpg"]) else (r["min"]/max(r["g"] or G_PROJ,1)))
    starter = bool(role["starter"]) if (role is not None and pd.notna(role["starter"])) else False
    yr = (role["yr"] or role["class_year"]) if role is not None else None
    pm = proj_mpg(d_ord, last_mpg, starter)                    # projected MPG
    dm = dev_mult(yr, r["demo_ovr"])                            # class development on offense
    # per-40 rates from ACTUAL, offense nudged by dev
    owa40 = (r["owa"] or 0)/max(r["mp40"],0.1); dwa40 = (r["dwa"] or 0)/max(r["mp40"],0.1)
    per40_p = (owa40*dm + dwa40) * r["sos"]
    proj_min = pm * G_PROJ                                      # projected season minutes
    # RATE reliability comes from his ACTUAL sample (an 8-mpg per-40 is noisy and
    # must stay shrunk toward the median even when projected into a big role);
    # PROJECTED minutes drive only the role/volume credit.
    cred_actual = r["min"]/(r["min"]+400.0)
    b_p = MU40 + cred_actual*(per40_p - MU40)
    c_p = b_p * np.sqrt(min(max(proj_min/P90,0),1.3))
    proj_ovr = to_grade(c_p)
    out[str(int(eid))]={
        "ovr": proj_ovr, "demo_ovr": int(r["demo_ovr"]),
        "proj_mpg": round(float(pm),1), "last_mpg": round(float(last_mpg or 0),1),
        "dev_mult": round(float(dm),3),
        "proj_wa": round(float(per40_p*proj_min/40.0),1),
        "ti40": round(float(r["ti40"] or 0),1), "usg": round(float(r["usg_pct"] or 0),1),
        "dwa": round(float(r["dwa"] or 0),2), "sos": round(float(r["sos"]),2),
    }
json.dump({"season":"2026-27","scale":{"mu":MU,"sp":SP},"n":len(out),"players":out},
          open(os.path.join(D,"stat_overall_projected.json"),"w"),separators=(",",":"))
print(f"Wrote stat_overall_projected.json ({len(out)} returners)",file=sys.stderr)

# preview: biggest role-driven risers
prev=pd.DataFrame([{**v,"espn":k} for k,v in out.items()])
prev["move"]=prev["ovr"]-prev["demo_ovr"]
names=adv.set_index(adv["espn_id"].astype(int).astype(str))["name"]
prev["name"]=prev["espn"].map(names)
print("\nTop projected 2026-27:",file=sys.stderr)
for _,r in prev.sort_values("ovr",ascending=False).head(12).iterrows():
    print(f"  {r['name'][:22]:22} proj {r['ovr']}  (demo {r['demo_ovr']}, {r['move']:+d})  {r['proj_mpg']:.0f}mpg dev×{r['dev_mult']}",file=sys.stderr)
print("\nBiggest role/dev RISERS:",file=sys.stderr)
for _,r in prev.sort_values("move",ascending=False).head(8).iterrows():
    print(f"  {r['name'][:22]:22} demo {r['demo_ovr']} -> proj {r['ovr']} ({r['move']:+d})  {r['last_mpg']:.0f}->{r['proj_mpg']:.0f}mpg dev×{r['dev_mult']}",file=sys.stderr)
