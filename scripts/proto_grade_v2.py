#!/usr/bin/env python3
"""
proto_grade_v2.py  —  TWO-TIER grade prototype (pass 1).

Compares the current BOX-ONLY demonstrated grade against a UNIFIED "rich" model
that folds the things the box model is blind to straight into ONE regression
(no separate archetype bolt-on):

  + usg_pct    usage / offensive load        (fixes "workload has no usage")
  + tov_pct    usage-ADJUSTED turnovers      (fixes "TOs must scale with usage")
  + stl_pct/blk_pct/dwa  rate + owned defense (fixes "no advanced defense")
  + 3PA-rate + tp_pct    shot DIET proxy      (pass-1 stand-in for true distance;
                                               separates a 5-ft 70% big from a
                                               high-volume 55/45 wing)

Same 788 hand-set tdc_grade labels, same within-set z-scoring, same RidgeCV.
Read-only: pulls live Supabase (anon key), writes nothing to DB or site.

Pass 2 (todo) swaps the 3PA-rate proxy for true avg shot distance + expected-eFG
from the `shots` table.
"""
import sys, json, math
import numpy as np, pandas as pd
import urllib.request, urllib.parse
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import KFold, cross_val_predict

SB  = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H   = {"apikey": KEY, "Authorization": "Bearer " + KEY}

def sb_get(path):
    """GET all rows for a PostgREST path, paginating 1000 at a time."""
    out, off = [], 0
    while True:
        url = f"{SB}/rest/v1/{path}"
        url += ("&" if "?" in path else "?") + f"limit=1000&offset={off}"
        req = urllib.request.Request(url, headers=H)
        chunk = json.load(urllib.request.urlopen(req))
        out += chunk
        if len(chunk) < 1000: break
        off += 1000
    return out

def pos_norm(p):
    if not isinstance(p, str): return "SF"
    p = p.upper().strip()
    if p in ("PG","G"): return "PG"
    if p in ("SG","CG"): return "SG"
    if p in ("SF","F","GF"): return "SF"
    if p in ("PF","FC"): return "PF"
    if p.startswith("C"): return "C"
    if p.startswith("G"): return "SG"
    if p.startswith("F"): return "SF"
    return "SF"

def height_in(h):
    if not isinstance(h, str): return np.nan
    parts = h.replace("'", "-").split("-")
    try: return int(parts[0])*12 + int(parts[1])
    except Exception: return np.nan

print("Pulling labeled players (tdc_grade + espn_id)...", file=sys.stderr)
pl = sb_get("players?select=espn_id,name,team,tdc_grade,position,height,ppg,rpg,apg,stl,blk,tovs,mpg,fga,tpa,fgm,tpm,fta,ftm,oreb,dreb,fg_pct,tp_pct,ft_pct&tdc_grade=not.is.null&espn_id=not.is.null")
df = pd.DataFrame(pl)
df["tdc_grade"] = pd.to_numeric(df["tdc_grade"], errors="coerce")
df = df.dropna(subset=["tdc_grade"])
for c in ["ppg","rpg","apg","stl","blk","tovs","mpg","fga","tpa","fgm","tpm","fta","ftm","oreb","dreb","fg_pct","tp_pct","ft_pct"]:
    df[c] = pd.to_numeric(df.get(c), errors="coerce")
df["espn_id"] = pd.to_numeric(df["espn_id"], errors="coerce").astype("Int64")
df = df[df["mpg"].fillna(0) >= 8].copy()

print(f"  {len(df)} labeled players with box stats", file=sys.stderr)

print("Pulling player_advanced (2026: usg/tov/def rates + owa/dwa)...", file=sys.stderr)
adv = pd.DataFrame(sb_get("player_advanced?select=espn_id,season_year,usg_pct,tov_pct,ast_pct,stl_pct,blk_pct,orb_pct,drb_pct,dwa,owa,ti40&season_year=eq.2026"))
adv["espn_id"] = pd.to_numeric(adv["espn_id"], errors="coerce").astype("Int64")
for c in ["usg_pct","tov_pct","ast_pct","stl_pct","blk_pct","orb_pct","drb_pct","dwa","owa","ti40"]:
    adv[c] = pd.to_numeric(adv.get(c), errors="coerce")
df = df.merge(adv.drop(columns=["season_year"]), on="espn_id", how="left")
matched = df["usg_pct"].notna().sum()
print(f"  advanced matched for {matched}/{len(df)} labeled players", file=sys.stderr)

# ---- derived box features (same as grade_features.py) ----
mpg = df["mpg"].clip(lower=1)
df["ts_pct"]      = (df["ppg"]/(2*(df["fga"]+0.44*df["fta"]).clip(lower=0.1))*100).clip(20,90)
df["efg"]         = ((df["fgm"]+0.5*df["tpm"])/df["fga"].clip(lower=0.1)*100).clip(20,95)
df["ast_to"]      = (df["apg"]/(df["tovs"].fillna(0)+0.5)).clip(0,6)
df["pts_per_min"] = df["ppg"]/mpg
df["reb_per_min"] = df["rpg"]/mpg
df["stk_per_min"] = (df["stl"].fillna(0)+df["blk"].fillna(0))/mpg
# shot-diet proxy for distance: share of shots from three
df["tpa_rate"]    = (df["tpa"]/df["fga"].clip(lower=0.1)).clip(0,1)
df["ftr"]         = (df["fta"]/df["fga"].clip(lower=0.1)).clip(0,2)
df["_pos"]        = df["position"].map(pos_norm)
df["_ht"]         = df["height"].map(height_in)
df["_ht"]         = df["_ht"].fillna(df["_pos"].map({"PG":74,"SG":76,"SF":79,"PF":81,"C":83}))

def zscore(frame, cols):
    z = pd.DataFrame(index=frame.index)
    for c in cols:
        v = pd.to_numeric(frame[c], errors="coerce")
        mu, sd = v.mean(), v.std()
        z[c] = (v - mu)/(sd if sd and sd>1e-6 else 1.0)
        z[c] = z[c].fillna(0.0)
    return z

BOX_Z  = ["ppg","rpg","apg","stl","blk","tpm","tpa","fta","fga","oreb","dreb",
          "tovs","mpg","fg_pct","tp_pct","ft_pct","ts_pct","efg","ast_to",
          "pts_per_min","reb_per_min","stk_per_min"]
# RICH: drop raw tovs/ast_to (replaced by usage-adjusted tov_pct); add the new signals
RICH_Z = ["ppg","rpg","apg","stl","blk","tpm","tpa","fta","fga","oreb","dreb",
          "mpg","fg_pct","tp_pct","ft_pct","ts_pct","efg","pts_per_min","reb_per_min",
          "usg_pct","tov_pct","ast_pct","stl_pct","blk_pct","dwa","owa","tpa_rate","ftr"]

POS = pd.get_dummies(df["_pos"]).reindex(columns=["PG","SG","SF","PF","C"], fill_value=0).astype(float)
htz = zscore(df, ["_ht"])

def build_X(zcols):
    return pd.concat([zscore(df, zcols), htz, POS.reset_index(drop=True).set_axis(df.index)], axis=1)

y = df["tdc_grade"].values
kf = KFold(n_splits=5, shuffle=True, random_state=7)

def fit_report(name, X):
    mdl = RidgeCV(alphas=np.logspace(-2,3,30)).fit(X.values, y)
    pred_cv = cross_val_predict(RidgeCV(alphas=np.logspace(-2,3,30)), X.values, y, cv=kf)
    mae = np.mean(np.abs(pred_cv - y)); corr = np.corrcoef(pred_cv, y)[0,1]
    infit = mdl.predict(X.values)
    print(f"\n{name}:  5-fold CV  MAE={mae:.2f}  corr={corr:.3f}   (n={len(y)}, {X.shape[1]} features)")
    return mdl, infit

Xbox  = build_X(BOX_Z)
Xrich = build_X(RICH_Z)
mbox,  gbox  = fit_report("BOX-ONLY (current model)", Xbox)
mrich, grich = fit_report("RICH (two-tier Tier-1)", Xrich)

res = df[["name","team","_pos","tdc_grade","usg_pct","tov_pct","dwa","tpa_rate"]].copy()
res["box"]  = np.round(gbox,1)
res["rich"] = np.round(grich,1)
res["move"] = np.round(res["rich"]-res["box"],1)

def show(title, d):
    print("\n"+title)
    print(f"{'Player':22}{'Pos':4}{'Hand':>5}{'Box':>6}{'Rich':>6}{'Δ':>6}{'Usg':>6}{'TOV%':>6}{'DWA':>6}")
    for _,r in d.iterrows():
        print(f"{r['name'][:21]:22}{r['_pos']:4}{r['tdc_grade']:5.0f}{r['box']:6.1f}{r['rich']:6.1f}{r['move']:+6.1f}"
              f"{(r['usg_pct'] or 0):6.1f}{(r['tov_pct'] or 0):6.1f}{(r['dwa'] or 0):6.2f}")

show("=== TOP 30 by RICH model ===", res.sort_values("rich", ascending=False).head(30))
show("=== BIGGEST RISERS (rich vs box) ===", res.sort_values("move", ascending=False).head(15))
show("=== BIGGEST FALLERS (rich vs box) ===", res.sort_values("move").head(15))

# position mix of the top 40 under each model — is the big-bias reduced?
def posmix(col):
    top = res.sort_values(col, ascending=False).head(40)
    return top["_pos"].value_counts().reindex(["PG","SG","SF","PF","C"], fill_value=0).to_dict()
print("\nPosition mix of TOP 40:")
print("  box :", posmix("box"))
print("  rich:", posmix("rich"))
