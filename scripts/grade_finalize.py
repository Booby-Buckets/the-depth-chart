#!/usr/bin/env python3
"""
Final grade pipeline:
  1. Train calibrated Ridge model on the 653 labeled players.
  2. Persist model (coefs + calibration + per-season pop stats + tier map)
     to data/grade_model.json for the JS live-scorer.
  3. Score every player_history row that has minutes.
  4. (--write) upsert tdc_grade back to player_history in batches.

  python3 grade_finalize.py            # dry run: train, persist, preview
  python3 grade_finalize.py --write    # also write grades to Supabase
"""
import os, sys, json, time
import numpy as np
import pandas as pd
from pathlib import Path
import requests
from sklearn.linear_model import RidgeCV

import grade_features as gf
import grade_conf as gc
from grade_score import tier_translate

DATA = Path(__file__).parent / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_KEY"]  # export before running
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def train_calibrated(hist, pop):
    lab = pd.read_pickle(DATA / "players_labeled.pkl")
    lab = lab[lab.mpg.notna() & lab.grade_num.notna()].reset_index(drop=True)
    labt = tier_translate(lab)
    X, names, _ = gf.build_matrix(labt, pop, default_season=2026)
    y = lab.grade_num.values.astype(float)
    mdl = RidgeCV(alphas=np.logspace(-2, 3, 30)).fit(X, y)
    pin = mdl.predict(X)
    calib = {"mp": float(pin.mean()), "sp": float(pin.std()),
             "my": float(y.mean()), "sy": float(y.std())}
    return mdl, names, calib


def apply_cal(raw, c):
    return c["my"] + (raw - c["mp"]) * (c["sy"] / c["sp"])


def main(write=False):
    hist = pd.read_pickle(DATA / "history_all.pkl")
    pop = gf.season_pop_stats(hist)
    mdl, names, calib = train_calibrated(hist, pop)

    # persist model for the JS scorer
    model_json = {
        "intercept": float(mdl.intercept_),
        "coef": {n: float(c) for n, c in zip(names, mdl.coef_)},
        "feature_order": names,
        "z_features": gf.Z_FEATURES,
        "positions": gf.POSITIONS,
        "calibration": calib,
        "tier_to_t1": gc.TIER_TO_T1,
        "tier_translated_counts": ["ppg", "rpg", "apg", "stl", "blk", "tpm",
                                   "tpa", "fta", "fga", "oreb", "dreb", "fgm", "ftm"],
        "pop_stats": {str(k): v for k, v in pop.items()},
        "min_mpg_pop": gf.MIN_MPG,
    }
    (DATA / "grade_model.json").write_text(json.dumps(model_json))
    print(f"Persisted model -> grade_model.json ({(DATA/'grade_model.json').stat().st_size//1024} KB)")

    # score every history row with minutes
    sc = hist[pd.to_numeric(hist.mpg, errors="coerce").notna()].copy()
    sc["mpg_n"] = pd.to_numeric(sc.mpg, errors="coerce")
    sc = sc[sc.mpg_n >= 1].copy()
    st = tier_translate(sc)
    X, _, _ = gf.build_matrix(st, pop, season_col="season_year")
    raw = mdl.predict(X)
    grade = np.clip(np.round(apply_cal(raw, calib)), 40, 99).astype(int)
    # soft floor for very low minutes (deep bench shouldn't grade like rotation)
    low = sc.mpg_n < 10
    grade[low.values] = np.minimum(grade[low.values],
                                   40 + (grade[low.values] - 40) * 0.85).astype(int)
    sc["grade"] = grade

    print(f"Scored {len(sc)} player-seasons")
    print(f"  dist: mean {sc.grade.mean():.1f}  median {int(sc.grade.median())}  "
          f"p99 {int(sc.grade.quantile(.99))}  max {sc.grade.max()}")
    print(f"  by season rows: {sc.groupby('season_year').size().to_dict()}")

    if not write:
        print("\nDRY RUN — pass --write to upsert grades to Supabase")
        return

    # include NOT NULL key cols so the upsert insert-path is valid; on_conflict
    # by id then updates tdc_grade (key cols update to their own values)
    payload = [{"id": int(i), "season_year": int(sy), "team": str(tm),
                "name": str(nm), "tdc_grade": str(int(g))}
               for i, sy, tm, nm, g in zip(
                   sc.id.values, sc.season_year.values, sc.team.values,
                   sc.name.values, sc.grade.values)]
    print(f"\nWriting {len(payload)} grades to player_history...")
    B = 500
    ok = 0
    for j in range(0, len(payload), B):
        batch = payload[j:j + B]
        r = requests.post(
            f"{SB}/rest/v1/player_history?on_conflict=id",
            headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"},
            json=batch, timeout=60)
        if r.status_code in (200, 201, 204):
            ok += len(batch)
            if (j // B) % 10 == 0:
                print(f"  {ok}/{len(payload)}")
        else:
            print(f"  ERROR {r.status_code}: {r.text[:200]}")
            break
        time.sleep(0.15)
    print(f"Done: {ok} rows written")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
