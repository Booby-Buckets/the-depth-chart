#!/usr/bin/env python3
"""
Overall grade v2 — position-relative, tier-adjusted, anchored so the elite hit 99.

Fixes the three problems with v1:
  1. Mid-majors over-valued  -> tier-translate counting stats (steeper low-end)
     using the corrected conf map, so dominant low-major box scores get docked.
  2. Bigs > guards           -> grade each player WITHIN their position group
     (G/W/B), so the best guard and the best big both reach the top of the scale.
  3. Scale too low           -> map the within-group composite z-score to a grade
     with BASE/SCALE tuned so generational seasons (Edey/Zion/Flagg) land ~99.

  python3 grade_v2.py            # dry run: verify anchors + distribution
  python3 grade_v2.py --write    # write grades to player_history
"""
import os, sys, re, time
from pathlib import Path
import numpy as np, pandas as pd, requests
import grade_conf as gc

DATA = Path(__file__).parent / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"

# ── tunable scale ───────────────────────────────────────────────────────────
BASE, SCALE = 77.0, 6.3
# non-linear top: below SOFT linear; SOFT..R99 compresses into 90..98; raw>=R99 -> 99,
# so only a tiny GOAT tier (~3-5 seasons all-time) ever rounds to 99.
SOFT, R99, GHI = 90.0, 102.3, 98.49
MIN_MPG_POP = 8
# scoring-centric: greatness = efficient high-volume scoring first, then the rest.
# (Breadth-summing rewarded compilers like 15/7/3 forwards over scoring stars.)
WEIGHTS = {"ppg":1.9,"ts":0.7,"rpg":0.45,"apg":0.45,"stl":0.25,"blk":0.25,"tovs":-0.25,"mpg":0.3}
TIER_COUNTS = ["ppg","rpg","apg","stl","blk","tovs","oreb","dreb","fgm","fta","fga"]
FEAT = {"ppg":"adj_ppg","rpg":"adj_rpg","apg":"adj_apg","stl":"adj_stl",
        "blk":"adj_blk","tovs":"adj_tovs","ts":"ts","mpg":"mpg"}


def num(s): return pd.to_numeric(s, errors="coerce")
def ht_in(h):
    if not isinstance(h, str): return np.nan
    m = re.match(r"^\s*(\d)\s*-\s*(\d{1,2})\s*$", h)
    return int(m.group(1))*12+int(m.group(2)) if m else np.nan

def posgrp(pos, ht):
    p = str(pos or "").upper().split("/")[0].strip()
    if p in ("PG","SG","G","CG"): return "G"
    if p in ("C","PF","FC"): return "B"
    if p == "SF": return "W"
    if not (ht is None or (isinstance(ht,float) and np.isnan(ht))):
        if ht >= 80: return "B"
        if ht < 74: return "G"
        return "W"
    return "W"


def compute(df):
    for c in TIER_COUNTS + ["mpg","fga","fta"]:
        df[c] = num(df[c])
    df["_ht"] = df["height"].map(ht_in)
    df["_grp"] = [posgrp(p, h) for p, h in zip(df["position"], df["_ht"])]
    df["_tier"] = df["team"].map(gc.tier).fillna(gc.DEFAULT_TIER).astype(int)
    df["_tf"] = df["_tier"].map(gc.TIER_TO_T1).astype(float)
    df["ts"] = (df["ppg"] / (2*(df["fga"].fillna(0)+0.44*df["fta"].fillna(0)).clip(lower=0.1))) * 100
    df["ts"] = df["ts"].clip(20, 80)
    for c in TIER_COUNTS:
        df["adj_"+c] = df[c] * df["_tf"]
    # Normalize WITHIN position group but ACROSS ALL seasons (tier-adjusted), so a
    # grade reflects absolute, cross-era greatness — only true outliers reach 99 —
    # while staying position-fair (a guard is measured against guards).
    df["raw"] = np.nan
    for grp, idx in df.groupby("_grp").groups.items():
        sub = df.loc[idx]
        qual = sub[sub["mpg"] >= MIN_MPG_POP]
        if len(qual) < 50: continue
        comp = pd.Series(0.0, index=sub.index)
        for wk, col in FEAT.items():
            mu, sd = qual[col].mean(), (qual[col].std() or 1)
            comp += WEIGHTS[wk] * ((sub[col]-mu)/sd).clip(-4,4).fillna(0)
        cq = comp.loc[qual.index]; cm, cs = cq.mean(), (cq.std() or 1)
        df.loc[idx, "raw"] = BASE + SCALE*((comp-cm)/cs)   # unclamped linear grade
    df["grade"] = squash(df["raw"])
    return df


def squash(raw):
    # Below SOFT: linear. SOFT..R99: linearly compressed into SOFT..GHI (so it
    # rounds to 90..98). raw>=R99: 99. Result is a sharp, tiny 99 tier with a
    # smooth ramp of 98/97/96 below it, instead of ~100 piled at the cap.
    r = np.asarray(raw, float)
    g = np.where(r <= SOFT, r, SOFT + (GHI - SOFT)*(r - SOFT)/(R99 - SOFT))
    g = np.where(r >= R99, 99.0, g)
    return np.clip(g, 40, 99).round()


def main(write=False):
    df = compute(pd.read_pickle(DATA / "history_all.pkl"))
    graded = df[df.grade.notna()]
    print(f"graded {len(graded)} player-seasons | BASE={BASE} SCALE={SCALE}")

    # group sizes + distribution
    print("\n=== by position group (mpg>=10) ===")
    q = graded[num(graded.mpg) >= 10]
    for g in ("G","W","B"):
        v = q[q._grp==g].grade
        if len(v): print(f"  {g}: n={len(v)} mean={v.mean():.1f} p90={v.quantile(.9):.0f} max={v.max():.0f} n99={int((v>=99).sum())}")
    print(f"  ALL: mean={q.grade.mean():.1f} p99={q.grade.quantile(.99):.0f} max={q.grade.max():.0f} n99={int((q.grade>=99).sum())}")

    print("\n=== anchors ===")
    for nm, yr in [("Zach Edey",2024),("Cooper Flagg",2025),("Zion Williamson",2019),
                   ("Trae Young",2018),("Luka Garza",2021),("Caleb Love",2024)]:
        r = graded[(graded.name==nm)&(graded.season_year==yr)]
        for _, x in r.iterrows():
            print(f"  {nm} {yr}: grade={int(x.grade)} ({x.ppg}/{x.rpg}/{x.apg}, {x._grp}, T{x._tier}, {str(x.team)[:16]})")

    print("\n=== top 20 all-time ===")
    top = graded.sort_values("grade", ascending=False).drop_duplicates(["name","season_year"]).head(20)
    for _, x in top.iterrows():
        print(f"  {int(x.grade)}  {str(x['name'])[:20]:20s} {x.season_year} {x._grp} T{x._tier} {str(x.team)[:18]:18s} {x.ppg}/{x.rpg}/{x.apg}")

    if write:
        graded2 = graded[(num(graded.mpg) >= 1)]
        payload = [{"id":int(i),"season_year":int(sy),"team":str(tm),"name":str(nm),"tdc_grade":str(int(g))}
                   for i,sy,tm,nm,g in zip(graded2.id, graded2.season_year, graded2.team, graded2.name, graded2.grade)]
        H = {"apikey":os.environ["SUPABASE_SERVICE_KEY"],"Authorization":f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}","Content-Type":"application/json"}
        print(f"\nWriting {len(payload)} grades...")
        B=500; ok=0
        for j in range(0,len(payload),B):
            r=requests.post(f"{SB}/rest/v1/player_history?on_conflict=id",
                headers={**H,"Prefer":"resolution=merge-duplicates,return=minimal"}, json=payload[j:j+B], timeout=60)
            if r.status_code in (200,201,204): ok+=len(payload[j:j+B])
            else: print(f"  ERR {r.status_code}: {r.text[:150]}"); break
            time.sleep(0.1)
        print(f"  wrote {ok}")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
