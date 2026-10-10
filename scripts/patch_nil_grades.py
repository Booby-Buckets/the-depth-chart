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
import json, math, os, urllib.request

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

# No hand-grade blend: tdc-projgrade.js dropped _scoutBlend (Sept 30 2026) — the NIL grade is the
# statistical overall, same as every page.
def _blend(sv, e): return sv

def live(e):
    e = str(e)
    if e in P:    return _blend(ov(P[e]), e)
    if e in demo: return _blend(ov(demo[e]), e)
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

# ── NIL PRICE BASIS (Oct 2026, owner: "focused on the player from last year + his career + potential, not just
#    what he is being projected") ─────────────────────────────────────────────────────────────────────────────
# `grade`/`mpg` stay the site's projected OVR and minutes (what the board shows). The NIL price uses its own:
#   ng = NIL grade = LAST season (2025-26 demonstrated) · CAREER (earlier seasons, recency-weighted) · POTENTIAL
#        (the better of his projected grade and last season + a normal class-year step), weights NIL_W, with the
#        last-season weight scaled down when he barely played (it moves to career + potential).
#   nm = NIL minutes = the bigger of last season's real minutes and his projected minutes — a buried transfer's
#        price isn't erased by a depth chart, and a rising player's bigger role still counts.
# Freshmen (no college line) keep their projected / editor grade and minutes. The parts ride along (ngl/ngc/ngp,
# lm, hist) so the player NIL tab can show what the price is built on.
NIL_W = {"last": 0.50, "career": 0.20, "pot": 0.30}
STEP = {"so": 3.0, "jr": 1.5, "sr": 0.5}            # typical next-season grade step by the class he is entering
HIST = json.load(open(os.path.join(D, "stat_overall_history.json")))
def hist_of(e):
    e = str(e); out = []
    for y in sorted(HIST.keys()):
        g = HIST[y].get(e) if isinstance(HIST[y], dict) else None
        if g is not None: out.append([int(y), int(round(ov(g)))])
    return out
def step_for(cls):
    c = str(cls or "").lower().replace("r-", "").replace(".", "").strip()[:2]
    return STEP.get(c, 0.0)
nb = 0
for tn, t in nil.get("teams", {}).items():
    for p in t.get("players", []):
        e = p.get("espn_id")
        if e is None or p.get("walkon"): continue
        e = str(e); pr = P.get(e) if isinstance(P.get(e), dict) else None
        last = demo.get(e); last = ov(last) if last is not None else None
        if last is None and pr is not None and pr.get("demo_ovr") is not None and float(pr.get("last_mpg") or 0) > 0:
            last = pr["demo_ovr"]                        # a box-score-filled line (no advanced row): the build's demonstrated grade
        if last is None: continue                        # a freshman / no 2025-26 line: price on his projection
        # out for the season (owner injury report) -> not in the projection: price on last season; the injury dock applies on top
        lm = float((pr or {}).get("last_mpg") or p.get("mpg") or 0); pm = float((pr or {}).get("proj_mpg") or 0)
        h = [x for x in hist_of(e) if x[0] < 2026]
        car = None
        if h:
            ws = [0.5, 0.3, 0.2]; recent = list(reversed(h))[:3]
            car = sum(g * w for (y, g), w in zip(recent, ws)) / sum(ws[:len(recent)])
        pot = float(last) + step_for(p.get("cls"))
        if pr is not None: pot = max(float(ov(pr)), pot)
        rel = max(0.25, min(1.0, lm / 20.0))           # 20+ mpg = a full season of evidence
        w_last = NIL_W["last"] * rel; spare = NIL_W["last"] - w_last
        w_car = (NIL_W["career"] + spare * 0.5) if car is not None else 0.0
        w_pot = NIL_W["pot"] + spare * (0.5 if car is not None else 1.0) + (0.0 if car is not None else NIL_W["career"])
        ng = (w_last * last + w_car * (car or 0) + w_pot * pot) / (w_last + w_car + w_pot)
        p["ng"] = int(round(ng)); p["nm"] = round(max(lm, pm), 1)
        p["ngl"] = int(last); p["ngc"] = (round(car, 1) if car is not None else None); p["ngp"] = round(pot, 1)
        p["ngw"] = [round(w_last / (w_last + w_car + w_pot), 2), round(w_car / (w_last + w_car + w_pot), 2), round(w_pot / (w_last + w_car + w_pot), 2)]
        p["lm"] = round(lm, 1); p["hist"] = h[-4:]
        nb += 1
json.dump(nil, open(path, "w"), separators=(",", ":"))
print(f"repointed {patched} returners to stat_overall; {fr_patched} freshmen to editor OVR; kept {kept}; NIL basis for {nb}")
# spot check
for tn, t in nil["teams"].items():
    for p in t.get("players", []):
        if p.get("name") == "Samet Yigitoglu":
            print(f"  Samet grade now {p['grade']} (live)")
