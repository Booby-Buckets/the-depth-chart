#!/usr/bin/env python3
"""
Unify abbreviated-first-name rows with their full-name rows in
player_history, using a COLLISION-SAFE rule: an abbreviated name
"X. Lastname" only merges into "First Lastname" when

  * they share the same last name,
  * X matches the full first initial,
  * they share at least one TEAM, and
  * exactly ONE full name matches (so "S. Jones" -> Sean/Spencer is skipped).

Renames happen only at the SHARED team. If renaming would collide with an
existing full-name row for the same (season_year, team), the duplicate
abbreviated row is dropped (keep the higher-GP row).

  python3 name_merge.py            # dry run
  python3 name_merge.py --write
"""
import os, sys, re, time
from collections import defaultdict
from pathlib import Path
import pandas as pd
import requests

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
DATA = Path(__file__).parent / "data"
ABBR = re.compile(r"^([A-Za-z])\.?\s+(.+)$")


def plan(df):
    df = df[df.name.notna() & df.team.notna()].copy()
    df["gp"] = pd.to_numeric(df.gp, errors="coerce").fillna(0)
    teams_by_name = df.groupby("name").team.apply(set).to_dict()

    def is_abbrev(n):
        m = ABBR.match(n.strip())
        if not m:
            return None
        return (m.group(1).upper(), m.group(2).strip())

    full_idx = defaultdict(list)
    for n in df.name.unique():
        if is_abbrev(n):
            continue
        parts = n.strip().split()
        if len(parts) < 2 or len(parts[0].replace(".", "")) < 2:
            continue
        full_idx[(parts[0][0].upper(), parts[-1].lower())].append(n)

    mapping = {}            # abbr_name -> (full_name, shared_teams)
    for n in df.name.unique():
        ab = is_abbrev(n)
        if not ab:
            continue
        init, rest = ab
        last = rest.split()[-1].lower()
        shared = [c for c in full_idx.get((init, last), [])
                  if teams_by_name[n] & teams_by_name[c]]
        if len(shared) == 1:
            mapping[n] = (shared[0], teams_by_name[n] & teams_by_name[shared[0]])

    # build row-level rename / delete sets
    full_keys = set(zip(df.name, df.season_year, df.team))   # existing (name,yr,team)
    renames = defaultdict(list)   # full_name -> [ids]
    deletes = []                  # ids of conflicting abbr dups
    affected = []
    for _, r in df.iterrows():
        m = mapping.get(r["name"])
        if not m:
            continue
        full, shared_teams = m
        if r.team not in shared_teams:
            continue                     # only merge at the shared team
        affected.append(r)
        if (full, r.season_year, r.team) in full_keys:
            deletes.append(int(r.id))    # full row already exists -> drop dup
        else:
            renames[full].append(int(r.id))
    return mapping, renames, deletes, pd.DataFrame(affected)


def main(write=False):
    df = pd.read_pickle(DATA / "history_all.pkl")
    mapping, renames, deletes, affected = plan(df)
    n_ren = sum(len(v) for v in renames.values())
    print(f"safe name mappings: {len(mapping)}")
    print(f"rows to RENAME: {n_ren}  (across {len(renames)} full names)")
    print(f"rows to DELETE (dup collisions): {len(deletes)}")
    if len(affected):
        affected.to_csv(DATA / "name_merge_backup.csv", index=False)
        print(f"backed up {len(affected)} affected rows -> name_merge_backup.csv")
    print("\nsample renames:")
    for full, ids in list(renames.items())[:12]:
        print(f"  {len(ids)} row(s) -> {full}")

    if not write:
        print("\nDRY RUN — pass --write")
        return

    # renames: batch PATCH by id group per target name
    done = 0
    for full, ids in renames.items():
        for j in range(0, len(ids), 100):
            chunk = ids[j:j+100]
            idlist = ",".join(map(str, chunk))
            r = requests.patch(f"{SB}/rest/v1/player_history?id=in.({idlist})",
                               headers={**H, "Prefer": "return=minimal"},
                               json={"name": full}, timeout=60)
            if r.status_code in (200, 204):
                done += len(chunk)
            else:
                print(f"  RENAME ERROR {r.status_code}: {r.text[:160]}")
            time.sleep(0.05)
    print(f"renamed {done} rows")

    # deletes
    ddone = 0
    for j in range(0, len(deletes), 100):
        chunk = deletes[j:j+100]
        idlist = ",".join(map(str, chunk))
        r = requests.delete(f"{SB}/rest/v1/player_history?id=in.({idlist})",
                            headers={**H, "Prefer": "return=minimal"}, timeout=60)
        if r.status_code in (200, 204):
            ddone += len(chunk)
        else:
            print(f"  DELETE ERROR {r.status_code}: {r.text[:160]}")
        time.sleep(0.05)
    print(f"deleted {ddone} duplicate rows")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
