#!/usr/bin/env python3
"""patch_nil_grades.py — repoint nil-data.json grades to the LIVE statistical overall.

compute_nil.py bakes each player's grade from the DB `tdc_grade` column, but the site's live grade
(gradeSolo) is the STATISTICAL OVERALL in scripts/data/stat_overall*.json — a different number
(93% of returners differed, avg 5 pts). This resyncs nil-data's grades to the live ones so the NIL
board shows the SAME grade as the rest of the site. Client-side NIL value is recomputed from grade,
so patching the grade fixes the displayed values too.

Only RETURNERS (espn_id present in stat_overall_projected/demonstrated) are repointed. Freshmen and
anyone not in the stat files are left as-is — their nil grade already equals the live editor OVR
(gradeSolo can't be reproduced here without the freshman profiles, and returns a wrong floor).

Local-file only (no network, no secret key). Re-run after any grade rebuild:
  cd scripts && python3 patch_nil_grades.py
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "scripts", "data")

def ov(r): return r["ovr"] if isinstance(r, dict) else r

proj = json.load(open(os.path.join(D, "stat_overall_projected.json")))
P = proj.get("players", proj)
demo = json.load(open(os.path.join(D, "stat_overall.json")))["players"]

def live(e):
    e = str(e)
    if e in P:    return ov(P[e])
    if e in demo: return ov(demo[e])
    return None

path = os.path.join(ROOT, "nil-data.json")
nil = json.load(open(path))
patched = kept = 0
for tn, t in nil.get("teams", {}).items():
    for p in t.get("players", []):
        e = p.get("espn_id")
        lg = live(e) if e is not None else None
        if lg is not None:
            if p.get("grade") != lg:
                p["grade"] = int(lg); patched += 1
        else:
            kept += 1   # freshman / not in stat files → keep (already the live editor OVR)

json.dump(nil, open(path, "w"), separators=(",", ":"))
print(f"repointed {patched} returner grades to live stat_overall; kept {kept} (freshmen/unmatched)")
# spot check
for tn, t in nil["teams"].items():
    for p in t.get("players", []):
        if p.get("name") == "Samet Yigitoglu":
            print(f"  Samet grade now {p['grade']} (live)")
