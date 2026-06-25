#!/usr/bin/env python3
"""
Fix current-roster overalls for transfers. The players table lists a
transfer's NEW team, but their stats were earned at the OLD team, so the
tier translation was wrong (e.g. Ryan Prather: Robert Morris stats graded
as Iowa State -> 91 instead of 75).

Each player's 2025-26 line already exists, correctly tier-graded, in
player_history (season_year=2026, with the team where it was earned). So we
copy that grade onto the current players row, matching by name + closest
stat line (handles transfers and namesakes). No-stat freshmen are untouched.

  python3 grade_sync_current.py           # dry run
  python3 grade_sync_current.py --write
"""
import os, sys, time
import pandas as pd
import requests

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def num(s):
    return pd.to_numeric(s, errors="coerce")


def fetch_all(url):
    """Page through Supabase's 1000-row-per-request cap."""
    rows, pg, PG = [], 0, 1000
    while True:
        r = requests.get(url, headers={**H, "Range-Unit": "items",
                         "Range": f"{pg*PG}-{pg*PG+PG-1}"}, timeout=60)
        b = r.json()
        if not isinstance(b, list) or not b:
            break
        rows.extend(b)
        if len(b) < PG:
            break
        pg += 1
    return pd.DataFrame(rows)


def main(write=False):
    cur = fetch_all(f"{SB}/rest/v1/players?select=id,name,team,ppg,mpg,tdc_grade")
    hist = fetch_all(f"{SB}/rest/v1/player_history?select=name,team,ppg,mpg,gp,"
                     f"tdc_grade&season_year=eq.2026&tdc_grade=not.is.null")
    print(f"fetched {len(cur)} current, {len(hist)} graded 2026 history rows")
    hist["ppg_n"] = num(hist.ppg); hist["mpg_n"] = num(hist.mpg)
    by_name = {n: g for n, g in hist.groupby("name")}

    cur["ppg_n"] = num(cur.ppg); cur["mpg_n"] = num(cur.mpg)
    updates = []
    for _, p in cur.iterrows():
        if pd.isna(p.mpg_n):           # no-stat freshman -> leave manual grade
            continue
        cand = by_name.get(p["name"])
        if cand is None or not len(cand):
            continue
        # closest stat line (same statistical season, regardless of team)
        d = (cand.ppg_n - p.ppg_n).abs() + (cand.mpg_n - p.mpg_n).abs()
        best = cand.loc[d.idxmin()]
        new_g = str(best.tdc_grade)
        old_g = "" if pd.isna(p.tdc_grade) else str(p.tdc_grade)
        if new_g != old_g:
            updates.append({"id": int(p.id), "name": p["name"], "team": p.team,
                            "old": old_g, "new": new_g, "hist_team": best.team,
                            "ppg": p.ppg_n})

    up = pd.DataFrame(updates)
    print(f"current with stats: {cur.mpg_n.notna().sum()} | grades changing: {len(up)}")
    if len(up):
        up["delta"] = num(up["new"]) - num(up["old"].replace("", "nan"))
        drops = up.reindex(up.delta.sort_values().index).head(15)
        print("\nBiggest drops (transfers down to correct tier):")
        for _, r in drops.iterrows():
            print(f"  {r['name'][:22]:22s} {str(r.team)[:13]:13s} <- {str(r.hist_team)[:18]:18s} "
                  f"{r.old:>3}->{r['new']:>3}  ({r.ppg:.1f} ppg)")

    if not write:
        print("\nDRY RUN — pass --write")
        return

    payload = [{"id": u["id"], "name": u["name"], "tdc_grade": u["new"]} for u in updates]
    B = 200; ok = 0
    for j in range(0, len(payload), B):
        batch = payload[j:j + B]
        r = requests.post(f"{SB}/rest/v1/players?on_conflict=id",
                          headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"},
                          json=batch, timeout=60)
        if r.status_code in (200, 201, 204):
            ok += len(batch)
        else:
            print(f"  ERROR {r.status_code}: {r.text[:200]}"); break
        time.sleep(0.15)
    print(f"Done: {ok} grades corrected")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
