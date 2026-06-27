#!/usr/bin/env python3
"""
Recompute tdc_grade for ALL bbref_seasons (2007-2026) by feeding BBRef per-game
features into the existing grade_v2 model (same position-relative, tier-adjusted,
cross-era z-score logic + squash). Replaces the ESPN-derived grades and fills the
pre-2012 gap with the identical calibration (Edey/Zion/Flagg ~= 99).

  python3 grade_bbref.py            # dry run: anchors + distribution + tier check
  python3 grade_bbref.py --write    # write tdc_grade to bbref_seasons
"""
import json, sys, re, time
from pathlib import Path
import numpy as np, pandas as pd, requests
import grade_v2, grade_conf as gc

DATA = Path(__file__).parent / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
def _key():
    import os
    return os.environ.get("SUPABASE_SERVICE_KEY") or re.search(r'SB_KEY\s*=\s*"([^"]+)"', (DATA.parent/"load_supabase.py").read_text()).group(1)

def f(d, k):
    try:
        v = (d or {}).get(k)
        return float(v) if v not in (None, "") else np.nan
    except (TypeError, ValueError): return np.nan

def load():
    rows = []
    for l in (DATA / "bbref.jsonl").read_text().splitlines():
        try: b = json.loads(l)
        except Exception: continue
        pg = b.get("pergame") or {}
        rows.append({
            "bbref_id": b["bbref_id"], "school_slug": b["school_slug"],
            "id": 0, "name": b.get("player"), "season_year": b.get("season"),
            "team": b.get("school"), "position": b.get("pos"), "height": b.get("height"),
            "ppg": f(pg,"pts_per_g"), "rpg": f(pg,"trb_per_g"), "apg": f(pg,"ast_per_g"),
            "stl": f(pg,"stl_per_g"), "blk": f(pg,"blk_per_g"), "tovs": f(pg,"tov_per_g"),
            "mpg": f(pg,"mp_per_g"), "fga": f(pg,"fga_per_g"), "fta": f(pg,"fta_per_g"),
            "oreb": f(pg,"orb_per_g"), "dreb": f(pg,"drb_per_g"),
            "fgm": f(pg,"fg_per_g"), "ftm": f(pg,"ft_per_g"),
        })
    return pd.DataFrame(rows)

def main(write=False):
    # BBRef's feature distribution is tighter than ESPN's, so loosen the 99 threshold
    # to re-land the calibration anchors (Edey/Flagg/Zion/Trae) and ~2-3 seasons/yr at 99.
    grade_v2.R99, grade_v2.GHI = 100.0, 98.55
    df = grade_v2.compute(load())
    graded = df[df.grade.notna()]
    print(f"graded {len(graded):,}/{len(df):,} player-seasons  (BASE={grade_v2.BASE} SCALE={grade_v2.SCALE})")

    q = graded[grade_v2.num(graded.mpg) >= 10]
    print("\n=== position groups (mpg>=10) ===")
    for g in ("G","W","B"):
        v = q[q._grp==g].grade
        if len(v): print(f"  {g}: n={len(v):,} mean={v.mean():.1f} p90={v.quantile(.9):.0f} max={v.max():.0f} n99={int((v>=99).sum())}")
    print(f"  ALL: mean={q.grade.mean():.1f} max={q.grade.max():.0f} n99={int((q.grade>=99).sum())} (~{(q.grade>=99).sum()/20:.1f}/yr)")

    # tier sanity: power schools must NOT default to T6
    print("\n=== tier check (should be T1) ===")
    for s in ["Duke","Kentucky","North Carolina","Kansas","Gonzaga","Connecticut","UCLA","Notre Dame"]:
        print(f"  {s:16s} -> T{gc.tier(s)}")
    deftier = (graded._tier==gc.DEFAULT_TIER).mean()
    print(f"  rows at DEFAULT_TIER(6): {deftier*100:.0f}%")

    print("\n=== anchors ===")
    for nm, yr in [("Zach Edey",2024),("Cooper Flagg",2025),("Zion Williamson",2019),
                   ("Trae Young",2018),("Kevin Durant",2007),("Stephen Curry",2009),
                   ("Blake Griffin",2009),("Bonzie Colson",2018)]:
        r = graded[(graded.name==nm)&(graded.season_year==yr)]
        for _, x in r.iterrows():
            print(f"  {nm} {yr}: {int(x.grade)}  ({x.ppg}/{x.rpg}/{x.apg} {x._grp} T{x._tier} {str(x.team)[:16]})")

    print("\n=== top 20 all-time ===")
    top = graded.sort_values("grade",ascending=False).drop_duplicates(["name","season_year"]).head(20)
    for _, x in top.iterrows():
        print(f"  {int(x.grade)}  {str(x['name'])[:20]:20s} {x.season_year} {x._grp} T{x._tier} {str(x.team)[:16]:16s} {x.ppg}/{x.rpg}/{x.apg}")

    if write:
        w = graded[grade_v2.num(graded.mpg) >= 1]
        pay = [{"bbref_id":bid,"season_year":int(sy),"school_slug":ss,"tdc_grade":int(g)}
               for bid,sy,ss,g in zip(w.bbref_id,w.season_year,w.school_slug,w.grade)]
        K=_key(); H={"apikey":K,"Authorization":f"Bearer {K}","Content-Type":"application/json"}
        print(f"\nwriting {len(pay):,} grades to bbref_seasons...")
        ok=0
        for j in range(0,len(pay),500):
            b=pay[j:j+500]
            for _ in range(4):
                try: r=requests.post(f"{SB}/rest/v1/bbref_seasons?on_conflict=bbref_id,season_year,school_slug",
                    headers={**H,"Prefer":"resolution=merge-duplicates,return=minimal"},json=b,timeout=90)
                except Exception: time.sleep(3); continue
                if r.status_code in (200,201,204): ok+=len(b); break
                time.sleep(3)
            else: print(f"  batch {j} ERR {r.status_code}: {r.text[:140]}")
            time.sleep(0.04)
        print(f"  wrote {ok:,}")

if __name__ == "__main__":
    main(write="--write" in sys.argv)
