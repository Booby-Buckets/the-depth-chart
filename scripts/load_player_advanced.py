#!/usr/bin/env python3
"""One-time loader: bulk-upsert scripts/data/player_advanced.csv into the
`player_advanced` table using the project's service key (imported from
load_supabase.py — not hardcoded here). Idempotent: upserts on the composite
PK (espn_id, season_year), so it's safe to re-run if interrupted.

Run:  python3 scripts/load_player_advanced.py           # all 82k rows
      python3 scripts/load_player_advanced.py --limit 200   # quick test
"""
import os, csv, sys, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, "data", "player_advanced.csv")

spec = importlib.util.spec_from_file_location("ls", os.path.join(HERE, "load_supabase.py"))
ls = importlib.util.module_from_spec(spec); spec.loader.exec_module(ls)
ls.BATCH = 1000   # bigger batches than the pipeline default (50)

INT = {"espn_id", "season_year", "g", "min"}
STR = {"name", "team"}

limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None

rows = []
with open(CSV) as f:
    for r in csv.DictReader(f):
        row = {}
        for k, v in r.items():
            if v == "" or v is None:
                row[k] = None
            elif k in INT:
                row[k] = int(v)
            elif k in STR:
                row[k] = v
            else:
                row[k] = float(v)
        rows.append(row)
        if limit and len(rows) >= limit:
            break

print(f"loading {len(rows)} rows into player_advanced (batch={ls.BATCH})…")
n = ls.sb_upsert("player_advanced", rows, on_conflict="espn_id,season_year")
print(f"upserted {n} rows")
