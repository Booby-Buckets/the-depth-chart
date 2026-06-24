#!/usr/bin/env python3
"""
Pull all player_history rows (box-score columns + grade) and the teams
conference map into local parquet/json caches so the grade model can be
trained and scored offline without hammering Supabase.

Outputs:
  scripts/data/history_all.parquet   — every player_history row
  scripts/data/teams_conf.json       — {team_name: conf}
"""
import json
import os
import sys
from pathlib import Path

import requests
import pandas as pd

SB  = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_KEY"]  # export before running
H   = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
DATA = Path(__file__).parent / "data"

COLS = ("id,season_year,team,name,position,height,yr,ppg,rpg,apg,mpg,"
        "fgm,fga,fg_pct,tpm,tpa,tp_pct,ftm,fta,ft_pct,oreb,dreb,stl,blk,"
        "tovs,gp,tdc_grade")

PAGE = 1000


def pull_history() -> pd.DataFrame:
    rows, page = [], 0
    while True:
        lo, hi = page * PAGE, page * PAGE + PAGE - 1
        r = requests.get(
            f"{SB}/rest/v1/player_history?select={COLS}&order=id.asc",
            headers={**H, "Range-Unit": "items", "Range": f"{lo}-{hi}"},
            timeout=60,
        )
        r.raise_for_status()
        b = r.json()
        if not b:
            break
        rows.extend(b)
        print(f"  page {page}: {len(b)} rows (total {len(rows)})")
        if len(b) < PAGE:
            break
        page += 1
    return pd.DataFrame(rows)


def pull_teams() -> dict:
    r = requests.get(f"{SB}/rest/v1/teams?select=name,conf,conference&limit=1000",
                     headers=H, timeout=30)
    r.raise_for_status()
    out = {}
    for t in r.json():
        out[t["name"]] = t.get("conf") or t.get("conference") or ""
    return out


def main():
    DATA.mkdir(exist_ok=True)
    print("Pulling player_history...")
    df = pull_history()
    print(f"Total history rows: {len(df)}")
    out = DATA / "history_all.pkl"
    df.to_pickle(out)
    print(f"  wrote {out}")

    print("Pulling teams...")
    conf = pull_teams()
    (DATA / "teams_conf.json").write_text(json.dumps(conf, indent=0))
    print(f"  wrote teams_conf.json ({len(conf)} teams)")


if __name__ == "__main__":
    main()
