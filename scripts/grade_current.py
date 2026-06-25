#!/usr/bin/env python3
"""
DEPRECATED for production use — see grade_sync_current.py.

This re-grades the players table directly, which tiers TRANSFERS by their
NEW team instead of the team where their stats were earned (inflates
low-major -> power transfers, e.g. Prather 91 vs correct 75). Use
grade_sync_current.py to write current-roster grades. Kept for reference and
non-transfer spot checks.

Players with stats get algorithm overalls; no-stat freshmen keep their
(projection-based) manual grade since the production model has no input.

  python3 grade_current.py           # dry run
  python3 grade_current.py --write
"""
import os, sys, time
import numpy as np
import pandas as pd
from pathlib import Path
import requests
from sklearn.linear_model import RidgeCV

import grade_features as gf
from grade_score import tier_translate
from grade_finalize import train_calibrated, apply_cal

DATA = Path(__file__).parent / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_KEY"]  # export before running
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
COLS = ("id,name,team,position,height,ppg,rpg,apg,mpg,fgm,fga,fg_pct,tpm,tpa,"
        "tp_pct,ftm,fta,ft_pct,oreb,dreb,stl,blk,tovs,gp,tdc_grade")


def main(write=False):
    hist = pd.read_pickle(DATA / "history_all.pkl")
    pop = gf.season_pop_stats(hist)
    mdl, names, calib = train_calibrated(hist, pop)

    r = requests.get(f"{SB}/rest/v1/players?select={COLS}&limit=5000", headers=H, timeout=60)
    cur = pd.DataFrame(r.json())
    cur["mpg_n"] = pd.to_numeric(cur.mpg, errors="coerce")
    has = cur[cur.mpg_n >= 1].copy()
    print(f"current roster: {len(cur)} rows, {len(has)} with stats (gradable)")

    st = tier_translate(has)
    X, _, _ = gf.build_matrix(st, pop, default_season=2026)
    raw = mdl.predict(X)
    grade = np.clip(np.round(apply_cal(raw, calib)), 40, 99).astype(int)
    low = has.mpg_n < 10
    grade[low.values] = np.minimum(grade[low.values],
                                   40 + (grade[low.values] - 40) * 0.85).astype(int)
    has = has.assign(grade=grade)

    # compare to manual
    has["manual"] = pd.to_numeric(has.tdc_grade, errors="coerce")
    has["delta"] = has.grade - has.manual
    print(f"  algo dist: mean {has.grade.mean():.1f}  max {has.grade.max()}")
    print(f"  vs manual: mean delta {has.delta.mean():+.1f}  "
          f"|delta|>5: {(has.delta.abs()>5).sum()} players")
    print("\n  sample (top 10 algo):")
    for _, p in has.nlargest(10, "grade").iterrows():
        print(f"    {p.grade} (was {p.manual:.0f})  {str(p['name'])[:22]:22s} "
              f"{str(p.team)[:16]:16s} {p.ppg:.1f}/{p.rpg:.1f}/{p.apg:.1f}")

    if not write:
        print("\nDRY RUN — pass --write")
        return

    payload = [{"id": int(i), "name": str(n), "tdc_grade": str(int(g))}
               for i, n, g in zip(has.id.values, has.name.values, has.grade.values)]
    print(f"\nWriting {len(payload)} algorithm grades to players...")
    B = 200
    ok = 0
    for j in range(0, len(payload), B):
        batch = payload[j:j + B]
        rr = requests.post(f"{SB}/rest/v1/players?on_conflict=id",
                           headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"},
                           json=batch, timeout=60)
        if rr.status_code in (200, 201, 204):
            ok += len(batch)
        else:
            print(f"  ERROR {rr.status_code}: {rr.text[:200]}")
            break
        time.sleep(0.15)
    print(f"Done: {ok} rows written (no-stat freshmen kept manual grades)")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
