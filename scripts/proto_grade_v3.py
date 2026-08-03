#!/usr/bin/env python3
"""
proto_grade_v3.py  —  FULL STATISTICAL overall (no hand-grade target).  [v2: SOS + real positions]

Premise: the overall IS a player's statistical contribution to winning, era- AND
competition-adjusted. Hand grades touch ONLY the number scale (rank-matched), never
the ordering.

Fixes over pass 1:
  * strength-of-competition: value metrics discounted by conference strength
    (level_adj.json, k=0.42) so mid-major volume isn't overrated.
  * real positions from player_history (coarse G/F/C) instead of defaulting to SF.

Spines (all owned, winning-grounded):
  A) VOLUME   = SOS-adj (owa+dwa)
  B) RATE     = SOS-adj wins added / 40, minutes-shrunk
  C) BALANCED = rate quality x role/volume credit
Read-only. No DB/site writes.
"""
import sys, json
import numpy as np, pandas as pd
import urllib.request, os

SB  = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H   = {"apikey": KEY, "Authorization": "Bearer " + KEY}
D   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

def sb_get(path):
    out, off = [], 0
    while True:
        url = f"{SB}/rest/v1/{path}" + ("&" if "?" in path else "?") + f"limit=1000&offset={off}"
        chunk = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=H)))
        out += chunk
        if len(chunk) < 1000: break
        off += 1000
    return out

def pos_bucket(p):
    if not isinstance(p, str) or not p: return "?"
    p = p.upper()
    if p.startswith("C"): return "C"
    if p.startswith("G") or p in ("PG","SG"): return "G"
    if p.startswith("F") or p in ("SF","PF"): return "F"
    return "?"

# ---- strength-of-competition factor per team (level_adj.json) ----
lv = json.load(open(os.path.join(D, "level_adj.json")))
CS, TC, TOP, K = lv["conf_strength"], lv["team_conf"], lv["top"], lv["k"]
def sos_factor(team):
    conf = TC.get(team)
    cs = CS.get(conf, np.nan)
    if not np.isfinite(cs): return 0.80          # unknown team → mild discount
    return 1.0 - K * (1.0 - cs / TOP)            # Big12~1.0, SEC~.99, mid-major~.62-.85

print("Pulling 2026 value metrics, roster grades, and positions...", file=sys.stderr)
adv = pd.DataFrame(sb_get("player_advanced?select=espn_id,name,team,min,ppg,usg_pct,tov_pct,ti40,owa,dwa&season_year=eq.2026"))
pl  = pd.DataFrame(sb_get("players?select=espn_id,tdc_grade,position"))
ph  = pd.DataFrame(sb_get("player_history?select=espn_id,position&season_year=eq.2026"))
for d in (adv, pl, ph):
    d["espn_id"] = pd.to_numeric(d["espn_id"], errors="coerce").astype("Int64")
pl["tdc_grade"] = pd.to_numeric(pl["tdc_grade"], errors="coerce")
for c in ["min","ppg","usg_pct","tov_pct","ti40","owa","dwa"]:
    adv[c] = pd.to_numeric(adv[c], errors="coerce")

# position: prefer player_history, fall back to players
ph = ph.dropna(subset=["espn_id"]).drop_duplicates("espn_id")
posmap = dict(zip(ph["espn_id"], ph["position"]))
posmap.update({r.espn_id: r.position for r in pl.dropna(subset=["position"]).itertuples() if r.espn_id not in posmap})

df = adv.merge(pl[["espn_id","tdc_grade"]], on="espn_id", how="left")
df["pos"] = df["espn_id"].map(posmap).map(pos_bucket)
df = df[df["min"].fillna(0) >= 250].copy()
print(f"  {len(df)} rotation players; positions known for {(df['pos']!='?').mean()*100:.0f}%", file=sys.stderr)

df["sos"]  = df["team"].map(sos_factor)
df["mp40"] = df["min"] / 40.0
df["wa"]   = (df["owa"].fillna(0) + df["dwa"].fillna(0)) * df["sos"]     # SOS-adjusted total wins added

# A) VOLUME
df["A_raw"] = df["wa"]
# B) RATE (per-40, minutes-shrunk)
per40 = df["wa"] / df["mp40"].clip(lower=0.1)
mu40  = per40.median(); cred = df["min"] / (df["min"] + 400.0)
df["B_raw"] = mu40 + cred * (per40 - mu40)
# C) BALANCED (rate x role credit)
df["C_raw"] = df["B_raw"] * np.sqrt((df["min"] / df["min"].quantile(0.90)).clip(0, 1.3))

# ---- FROZEN probit scale (replaces rank-match). Map each player's percentile
#      through an inverse-normal so the grade distribution is normal-shaped:
#      elites stay rare and the tail separates the true #1. Tuned so the best
#      player lands ~97-98. This IS the scale; hand grades are out of the loop. ----
from scipy.stats import norm
MU = float(os.environ.get("MU", "73"))     # grade of the median rotation player
SP = float(os.environ.get("SP", "7.3"))    # grade points per normal sigma
FLOOR = 55
def probit_scale(raw):
    n = len(raw)
    pct = raw.rank(method="average") / (n + 1)         # uniform (0,1), no ties at 0/1
    z = norm.ppf(pct)                                   # normal quantile
    return np.round((MU + SP * z).clip(FLOOR, 99), 0)
for k in ("A","B","C"): df[k] = probit_scale(df[f"{k}_raw"])

# calibration diagnostics
zc = (df["C_raw"] - df["C_raw"].mean())/df["C_raw"].std()
print(f"\n[scale] MU={MU} SP={SP}  #1 z={zc.max():.2f} -> OVR={df['C'].max():.0f}   "
      f">=95: {(df['C']>=95).sum()}   >=90: {(df['C']>=90).sum()}   >=85: {(df['C']>=85).sum()}   "
      f"median={df['C'].median():.0f}   floor-hits={(df['C']<=FLOOR).sum()}", file=sys.stderr)

def board(col, title):
    d = df.sort_values(col, ascending=False).head(30)
    print(f"\n=== TOP 30 — {title} ===")
    print(f"{'Player':22}{'Pos':4}{'Conf-adj':>9}{'Ovr':>4}{'Hand':>5}{'WA':>6}{'ti40':>6}{'Usg':>6}{'DWA':>6}")
    for _,r in d.iterrows():
        hand = r['tdc_grade']
        print(f"{str(r['name'])[:21]:22}{r['pos']:4}{r['sos']:9.2f}{r[col]:4.0f}"
              f"{(hand if pd.notna(hand) else 0):5.0f}{r['wa']:6.1f}{(r['ti40'] or 0):6.1f}"
              f"{(r['usg_pct'] or 0):6.1f}{(r['dwa'] or 0):6.2f}")

board("A","A) VOLUME (SOS-adj wins added)")
board("C","C) BALANCED (rate x role credit)")

print("\n--- POSITION MIX of TOP 40 (guards / forwards / centers) ---")
def pm(col):
    return df.sort_values(col, ascending=False).head(40)["pos"].value_counts().reindex(["G","F","C","?"], fill_value=0).to_dict()
print(f"{'':10}{'G':>4}{'F':>4}{'C':>4}{'?':>4}")
for k,lbl in [("tdc_grade","HAND"),("A","VOLUME"),("B","RATE"),("C","BALANCE")]:
    m = pm(k); print(f"{lbl:10}{m['G']:>4}{m['F']:>4}{m['C']:>4}{m['?']:>4}")

print("\n--- MOVEMENT vs your hand grades (graded players only) ---")
for k,lbl in [("A","VOLUME"),("B","RATE"),("C","BALANCE")]:
    sub = df.dropna(subset=["tdc_grade"])
    print(f"  {lbl:9} corr-to-hand={np.corrcoef(sub[k],sub['tdc_grade'])[0,1]:.2f}   mean |move|={np.mean(np.abs(sub[k]-sub['tdc_grade'])):.1f} pts")

# ---- dump the full BALANCED board for the review artifact ----
import os as _os
OUT = _os.environ.get("BOARD_OUT", "/private/tmp/claude-501/-Users-aidanlee-the-depth-chart/bde8a560-8687-4c93-af40-3226d2d08b46/scratchpad/stat_overall_board.json")
exp = df.sort_values("C", ascending=False).copy()
recs = []
for _,r in exp.iterrows():
    hand = r["tdc_grade"]
    recs.append({
        "name": str(r["name"]), "team": str(r["team"]).replace(" Blue Devils","").replace(" Wildcats",""),
        "team_full": str(r["team"]), "pos": r["pos"],
        "ovr": int(r["C"]), "hand": (int(hand) if pd.notna(hand) else None),
        "move": (int(r["C"]-hand) if pd.notna(hand) else None),
        "wa": round(float(r["wa"]),1), "ti40": round(float(r["ti40"] or 0),1),
        "usg": round(float(r["usg_pct"] or 0),1), "dwa": round(float(r["dwa"] or 0),2),
        "sos": round(float(r["sos"]),2), "min": int(r["min"]),
    })
json.dump({"n": len(recs), "players": recs}, open(OUT,"w"))
print(f"\nWrote {len(recs)} players -> {OUT}", file=sys.stderr)
