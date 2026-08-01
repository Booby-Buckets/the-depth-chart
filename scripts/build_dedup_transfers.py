#!/usr/bin/env python3
"""build_dedup_transfers.py — find the PHANTOM player_history rows created by the transfer
double-count and emit reviewable DELETE SQL (does NOT delete — writes need the owner's auth).

A transferred player's season is stored TWICE in player_history: one row under his real
team, and a phantom under the team he moved TO (same espn_id + season_year, different team).
Basketball-Reference (`bbref_seasons.school`) is the authoritative team per player-season, and
its school string matches one of the two player_history teams exactly — so we KEEP the row
whose team matches bbref and mark the other(s) as phantoms to delete.

SAFETY: only deletes when bbref unambiguously identifies exactly one matching row. Collisions
with no bbref row, or where bbref matches none/both, are left UNRESOLVED for manual review —
nothing ambiguous is ever put in the delete list. Same-team exact duplicates (rare) keep the
higher-GP / lower-id row.

Outputs:
  scripts/data/dedup_transfers.sql      — DELETE statements (run in the Supabase SQL editor)
  scripts/data/dedup_transfers_review.csv — every decision (kept vs deleted vs unresolved)
"""
import os, sys, csv, importlib.util, re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location("ag", os.path.join(HERE, "archetype_grades.py"))
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
D = os.path.join(HERE, "data")


def norm(t):
    return re.sub(r"[^a-z0-9 ]", "", (t or "").lower()).strip()


def main():
    print("fetching player_history (espn_id rows)…")
    ph = ag.get("player_history?select=id,espn_id,name,season_year,team,gp&espn_id=not.is.null", "")
    print("fetching bbref_seasons authoritative teams…")
    bb = ag.get("bbref_seasons?select=espn_id,season_year,school&espn_id=not.is.null", "")
    bbmap = {}
    for b in bb:
        bbmap[(b["espn_id"], b["season_year"])] = b["school"]

    groups = defaultdict(list)
    for r in ph:
        groups[(r["espn_id"], r["season_year"])].append(r)
    collisions = {k: v for k, v in groups.items() if len(v) > 1}

    delete_ids, review, unresolved = [], [], 0
    resolved_phantoms = same_team = 0
    for (espn, season), rows in collisions.items():
        teams = {norm(r["team"]) for r in rows}
        name = rows[0]["name"]
        # same-team exact dup → keep higher GP then lower id
        if len(teams) == 1:
            order = sorted(rows, key=lambda r: (-(r["gp"] or 0), r["id"]))
            keep = order[0]
            for r in order[1:]:
                delete_ids.append(r["id"]); same_team += 1
                review.append([espn, season, name, "DELETE (exact dup)", r["id"], r["team"], keep["id"], keep["team"]])
            review.append([espn, season, name, "KEEP", keep["id"], keep["team"], "", ""])
            continue
        school = bbmap.get((espn, season))
        matches = [r for r in rows if school and norm(r["team"]) == norm(school)] if school else []
        if len(matches) == 1:
            keep = matches[0]
            review.append([espn, season, name, "KEEP (bbref=%s)" % school, keep["id"], keep["team"], "", ""])
            for r in rows:
                if r["id"] != keep["id"]:
                    delete_ids.append(r["id"]); resolved_phantoms += 1
                    review.append([espn, season, name, "DELETE (phantom)", r["id"], r["team"], keep["id"], keep["team"]])
        else:
            unresolved += 1
            reason = "no bbref row" if not school else "bbref=%s matched %d rows" % (school, len(matches))
            for r in rows:
                review.append([espn, season, name, "UNRESOLVED (%s)" % reason, r["id"], r["team"], "", ""])

    # write DELETE sql (chunked so no single statement is enormous)
    sqlpath = os.path.join(D, "dedup_transfers.sql")
    with open(sqlpath, "w") as f:
        f.write("-- Phantom transfer rows in player_history (kept row = the bbref-authoritative team).\n")
        f.write("-- Review dedup_transfers_review.csv first. Run in the Supabase SQL editor.\n")
        f.write("-- %d rows to delete across %d resolved collisions.\n\n" % (len(delete_ids), resolved_phantoms + same_team))
        f.write("BEGIN;\n")
        for i in range(0, len(delete_ids), 500):
            chunk = delete_ids[i:i + 500]
            f.write("DELETE FROM player_history WHERE id IN (%s);\n" % ",".join(str(x) for x in chunk))
        f.write("COMMIT;\n")

    csvpath = os.path.join(D, "dedup_transfers_review.csv")
    with open(csvpath, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["espn_id", "season", "name", "decision", "row_id", "row_team", "kept_id", "kept_team"])
        w.writerows(sorted(review, key=lambda r: (r[2], r[1])))

    print("\n── DEDUP SUMMARY ──")
    print("collisions total          : %d" % len(collisions))
    print("resolved by bbref (phantom): %d rows to delete" % resolved_phantoms)
    print("same-team exact dups       : %d rows to delete" % same_team)
    print("UNRESOLVED (left alone)    : %d collisions — manual review" % unresolved)
    print("TOTAL delete list          : %d rows" % len(delete_ids))
    print("\nwrote %s" % sqlpath)
    print("wrote %s" % csvpath)


if __name__ == "__main__":
    main()
