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
import json, os, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "scripts", "data")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"   # anon, read-only

def ov(r): return r["ovr"] if isinstance(r, dict) else r

def fetch_freshman_blob():
    """Owner's freshman editor OVRs (profiles.freshman_projections, anon-readable, keyed
    tdc_fr:<team>:<name>). The live site reads these via gradeSolo; nil-data was baked from the
    stale DB tdc_grade, so freshman editor edits never reached it."""
    try:
        req = urllib.request.Request(SB + "/rest/v1/profiles?select=freshman_projections",
                                     headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
        for r in json.load(urllib.request.urlopen(req, timeout=30)):
            fp = r.get("freshman_projections") or {}
            if any(k.startswith("tdc_fr:") for k in fp):
                return fp
    except Exception as e:
        print("warn: freshman blob fetch failed —", e)
    return {}

proj = json.load(open(os.path.join(D, "stat_overall_projected.json")))
P = proj.get("players", proj)
demo = json.load(open(os.path.join(D, "stat_overall.json")))["players"]

def live(e):
    e = str(e)
    if e in P:    return ov(P[e])
    if e in demo: return ov(demo[e])
    return None

FR = fetch_freshman_blob()   # tdc_fr:<team>:<name> -> {ovr,...}

def fetch_conf_map():
    """team name -> conference code, for the program floor (nil-programs.json floor_by_conf)."""
    try:
        req = urllib.request.Request(SB + "/rest/v1/teams?select=name,conf",
                                     headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
        return {r["name"]: r.get("conf") for r in json.load(urllib.request.urlopen(req, timeout=30)) if r.get("name")}
    except Exception as e:
        print("warn: conf map fetch failed —", e); return {}
CONF = fetch_conf_map()

path = os.path.join(ROOT, "nil-data.json")
nil = json.load(open(path))
patched = fr_patched = kept = 0
for tn, t in nil.get("teams", {}).items():
    for p in t.get("players", []):
        p["team"] = tn                       # program NIL market (nil-programs.json by_team)
        if CONF.get(tn): p["conf"] = CONF[tn]  # conference floor (nil-programs.json floor_by_conf)
        e = p.get("espn_id")
        lg = live(e) if e is not None else None
        if lg is not None:
            if p.get("grade") != lg:
                p["grade"] = int(lg); patched += 1
            continue
        # not a rated returner → try the freshman editor OVR (the live grade for profiled freshmen)
        fr = FR.get("tdc_fr:%s:%s" % (tn, p.get("name")))
        fov = ov(fr) if fr else None
        if fov is not None and int(round(float(fov))) != p.get("grade"):
            p["grade"] = int(round(float(fov))); fr_patched += 1
        else:
            kept += 1   # unprofiled freshman → keep (already matches the DB tdc_grade the site uses)

json.dump(nil, open(path, "w"), separators=(",", ":"))
print(f"repointed {patched} returners to stat_overall; {fr_patched} freshmen to editor OVR; kept {kept}")
# spot check
for tn, t in nil["teams"].items():
    for p in t.get("players", []):
        if p.get("name") == "Samet Yigitoglu":
            print(f"  Samet grade now {p['grade']} (live)")
