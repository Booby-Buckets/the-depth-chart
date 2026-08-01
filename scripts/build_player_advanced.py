#!/usr/bin/env python3
"""build_player_advanced.py — merge the per-season derived_stats_<year>.json into the
owned advanced-stats deliverables that replace Sports-Reference data site-wide.

Reads:  scripts/data/derived_stats_<year>.json   (produced by derived_stats.py)
Writes: scripts/data/player_advanced.csv         — all years, for Supabase bulk import
        scripts/data/player_advanced_schema.sql  — CREATE TABLE + PK + index (owner runs it)
        scripts/data/proj_advanced_<cur>.json     — SLIM current-season map for the projection
                                                     engine gating (espn_id -> usg/ts/ti40),
                                                     the static drop-in for the old bbref fetch.

Nothing here reads a Sports-Reference value; every number originates in box_scores.
"""
import os, json, csv, glob, re

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "data")
CUR = 2026  # current season for the slim engine file

# column order for the table / csv (espn_id + season_year are the composite key)
COLS = ["espn_id", "season_year", "name", "team", "g", "min",
        "ppg", "rpg", "apg",
        "ts_pct", "efg_pct", "fg_pct", "tp_pct", "ft_pct",
        "pts40", "reb40", "ast40",
        "usg_pct", "ast_pct", "tov_pct", "orb_pct", "drb_pct", "trb_pct", "stl_pct", "blk_pct",
        "ti40", "ti100"]
# postgres types (real for rate stats, int for counts)
INT_COLS = {"espn_id", "season_year", "g", "min"}


def main():
    files = sorted(glob.glob(os.path.join(D, "derived_stats_*.json")))
    if not files:
        print("no derived_stats_<year>.json found — run derived_stats.py all first"); return
    rows, slim = [], {}
    for fp in files:
        yr = int(re.search(r"derived_stats_(\d+)\.json", fp).group(1))
        data = json.load(open(fp))
        for eid, r in data.items():
            rows.append(r)
            if yr == CUR:
                slim[eid] = {"usg_pct": r.get("usg_pct"), "ts_pct": r.get("ts_pct"), "ti40": r.get("ti40")}
    rows.sort(key=lambda r: (r.get("season_year", 0), -(r.get("min") or 0)))

    # 1) all-years CSV for bulk import
    csvp = os.path.join(D, "player_advanced.csv")
    with open(csvp, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(COLS)
        for r in rows:
            w.writerow([r.get(c) if r.get(c) is not None else "" for c in COLS])

    # 2) schema DDL
    ddl = os.path.join(D, "player_advanced_schema.sql")
    with open(ddl, "w") as f:
        f.write("-- Owned advanced stats (replaces bbref_seasons.advanced). Computed from box_scores\n")
        f.write("-- by scripts/derived_stats.py — reproducible, no Sports-Reference values.\n")
        f.write("-- Load: create table, then import player_advanced.csv (Supabase Table Editor > Import).\n\n")
        f.write("DROP TABLE IF EXISTS player_advanced;\n")
        f.write("CREATE TABLE player_advanced (\n")
        defs = []
        for c in COLS:
            if c == "name" or c == "team":
                t = "text"
            elif c in INT_COLS:
                t = "integer"
            else:
                t = "real"
            defs.append(f"  {c} {t}")
        f.write(",\n".join(defs))
        f.write(",\n  PRIMARY KEY (espn_id, season_year)\n);\n")
        f.write("CREATE INDEX idx_padv_year ON player_advanced (season_year);\n")
        f.write("CREATE INDEX idx_padv_espn ON player_advanced (espn_id);\n")
        f.write("-- RLS: read-only public (same posture as other reference tables)\n")
        f.write("ALTER TABLE player_advanced ENABLE ROW LEVEL SECURITY;\n")
        f.write("CREATE POLICY padv_read ON player_advanced FOR SELECT USING (true);\n")

    # 3) slim current-season engine map (static drop-in for the bbref fetch)
    slimp = os.path.join(D, f"proj_advanced_{CUR}.json")
    with open(slimp, "w") as f:
        json.dump(slim, f, separators=(",", ":"))

    yrs = sorted({r.get("season_year") for r in rows})
    print(f"rows: {len(rows):,} across {len(yrs)} seasons ({yrs[0]}–{yrs[-1]})")
    print(f"wrote {os.path.relpath(csvp, HERE)}  ({os.path.getsize(csvp)//1024} KB)")
    print(f"wrote {os.path.relpath(ddl, HERE)}")
    print(f"wrote {os.path.relpath(slimp, HERE)}  ({len(slim)} players, {os.path.getsize(slimp)//1024} KB)")


if __name__ == "__main__":
    main()
