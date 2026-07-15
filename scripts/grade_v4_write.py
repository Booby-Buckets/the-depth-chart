#!/usr/bin/env python3
"""
grade_v4_write.py — grade the FULL bbref population with the v4 pillar engine
(per-season pools, conference-translated, reliability-shrunk) and upsert the
grades into bbref_seasons.tdc_grade, the canonical column grade_sync_bbref.py
propagates to the live site.

  python3 grade_v4_write.py            # DRY RUN — distribution + anchors, no writes
  python3 grade_v4_write.py --write    # upsert tdc_grade into bbref_seasons

After --write, run:  python3 grade_sync_bbref.py --write
"""
import sys, time, re
from pathlib import Path
import grade_v4 as G

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
DATA=Path(__file__).parent/"data"
# tuned compressed scale (Virginia acceptance test: MAE 2.0)
LOGI={"floor":58,"span":41,"k":0.6,"center":0.9}

def _key():
    import os
    return os.environ.get("SUPABASE_SERVICE_KEY") or re.search(r'SB_KEY\s*=\s*"([^"]+)"',(DATA.parent/"load_supabase.py").read_text()).group(1)

def grade_all(min_mpg=1, min_g=5):
    # min_mpg=1 includes non-rotation players; grade_v4 standardizes on the mpg>=8
    # rotation pool (CONFIG.qualMpg) and scores the bench against it, so deep-bench
    # players land low rather than being dropped (matches the prior engine's coverage).
    G.CONFIG["logistic"].update(LOGI)
    buckets=G.load_all(min_mpg=min_mpg, min_g=min_g)
    out=[]
    for season in sorted(buckets):
        graded=G.grade_players(buckets[season])
        out.extend(graded)
    return out

def main(write=False):
    graded=grade_all()
    grades=[p["grade"] for p in graded]
    n=len(grades); xs=sorted(grades)
    mean=sum(grades)/n
    pct=lambda q: xs[min(n-1,int(q*n))]
    print(f"graded {n:,} player-seasons | logistic {LOGI}")
    print(f"  mean {mean:.1f} | median {pct(.50)} | min {xs[0]} | max {xs[-1]}")
    print(f"  p10={pct(.10)} p25={pct(.25)} p50={pct(.50)} p75={pct(.75)} p90={pct(.90)} p99={pct(.99)}")
    print(f"  share 90+: {sum(1 for x in xs if x>=90)/n*100:.1f}%  |  95+: {sum(1 for x in xs if x>=95)/n*100:.2f}%  |  ==max: {sum(1 for x in xs if x==xs[-1])}")

    print("\n=== STAR ANCHORS (do the elite still grade elite?) ===")
    anchors=[("Zach Edey",2024),("Cameron Boozer",2026),("Cooper Flagg",2025),("Zion Williamson",2019),
             ("Bennett Stirtz",2025),("Trae Young",2018),("Gary Clark",2018),("Jae Crowder",2012),
             ("Damarion Dennis",2026),("Cruz Davis",2026),("Dra Gibbs-Lawhorn",2026),("JT Toppin",2026)]
    by={}
    for p in graded: by[(p["name"],p["season_year"])]=p
    for nm,yr in anchors:
        p=by.get((nm,yr))
        if p: print(f"  {nm:20} {yr}  grade {p['grade']}  (rel {p['_debug']['reliability']:.2f})")
        else: print(f"  {nm:20} {yr}  — (not in pool)")

    print("\n=== TOP 18 ALL-TIME ===")
    seen=set(); shown=0
    for p in sorted(graded,key=lambda p:-p["grade"]):
        k=(p["name"],p["season_year"])
        if k in seen: continue
        seen.add(k)
        print(f"  {p['grade']} {str(p['name'])[:22]:22} {p['season_year']} {p['_grp']} {str(p['team'])[:18]}")
        shown+=1
        if shown>=18: break

    if not write:
        print("\nDRY RUN — pass --write to upsert into bbref_seasons.tdc_grade")
        return

    # upsert keyed by (bbref_id, season_year, school_slug) — same key grade_bbref2 uses.
    # grade_pillars persists the 7 per-pillar z-scores (offense/efficiency/defense/
    # creation/usage/scalability/impact) that the engine computes but previously
    # discarded — downstream consumers (NIL valuation) read them individually
    # instead of only the single blended grade.
    import requests
    pay=[{"bbref_id":p["bbref_id"],"season_year":int(p["season_year"]),"school_slug":p["school_slug"],
          "tdc_grade":int(p["grade"]),
          "grade_pillars":{k:round(v,3) for k,v in p["_debug"]["pillars"].items()}}
         for p in graded if p.get("bbref_id") and p.get("school_slug")]
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
        time.sleep(0.03)
    print(f"  wrote {ok:,}")

if __name__=="__main__":
    main(write="--write" in sys.argv)
