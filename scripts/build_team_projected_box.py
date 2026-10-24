#!/usr/bin/env python3
"""build_team_projected_box.py — projected 2026-27 per-game TEAM box line for every roster,
built from the RECONCILED player projections (stat_overall_projected.json + fresh_fit.json),
so the team line is the same one the player pages, depth charts and game previews show.

  team line = Σ returners' projected per-game lines (already team-fit: minutes to 200, points to
              the team's projected ORtg × tempo, transfers usage-discounted for level)
            + freshmen / no-box players from fresh_fit.json (fitted mpg + ppg; rebounds, assists,
              steals, blocks, turnovers and attempts at the roster's own per-minute / per-point rates)
  then a light scale to a 200-minute team if the roster is short. Percentages are attempt-weighted.

Writes scripts/data/team_projected_box.json  { full_team_name: {ppg,rpg,apg,fg_pct,tp_pct,ft_pct,
fga,tpa,tov,stl,blk,oreb,dreb,mpg} } for the index / team pages, and — with SUPABASE_SERVICE_KEY —
upserts the same lines into `team_projections` (short team name + conf) so team-stats.html and the
team-page projected-stats panel agree with the player projections.

  python3 scripts/build_team_projected_box.py                  # JSON only (anon, read-only)
  SUPABASE_SERVICE_KEY=... python3 scripts/build_team_projected_box.py --upload
"""
import json, os, sys, urllib.request, urllib.error, urllib.parse, pathlib
from collections import defaultdict

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"; K = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": K, "Authorization": "Bearer " + K}
D = pathlib.Path(__file__).parent / "data"
UPLOAD = "--upload" in sys.argv
# --sql PATH: write the same upsert as one SQL block to paste into the Supabase SQL editor (no key needed)
SQL_OUT = sys.argv[sys.argv.index("--sql") + 1] if "--sql" in sys.argv else None

def sb(path):
    out, off = [], 0
    while True:
        b = json.load(urllib.request.urlopen(urllib.request.Request(
            SB + "/rest/v1/" + path + ("&" if "?" in path else "?") + f"limit=1000&offset={off}", headers=H), timeout=60))
        out += b
        if len(b) < 1000: break
        off += 1000
    return out

teams = sb("teams?select=name,conference&order=name.asc")
short_conf = {t["name"]: t.get("conference") or "" for t in teams}
_PROJ_DOC = json.load(open(D / "stat_overall_projected.json"))
proj = _PROJ_DOC["players"]
# a player's ORIGINAL line (before the team reconcile below rewrote it) — every run starts from it, so
# re-running this build never compounds the team adjustments
RAWK = ["ppg", "rpg", "apg", "oreb", "dreb", "stl", "blk", "tovs", "fga", "fgm", "tpa", "tpm", "fta", "ftm", "mpg"]
def raw(v): return v.get("_raw") or {k: v.get(k) for k in RAWK}
# full team name -> the sheet's short name, learned from the roster rows themselves (no alias table):
# every projected player carries his FULL team; the players table carries his SHORT team.
_pl = sb("players?select=espn_id,team,name,position,height&order=id.asc")
_short_of_espn = {str(r["espn_id"]): r["team"] for r in _pl if r.get("team")}
_votes = defaultdict(lambda: defaultdict(int))
for e, v in proj.items():
    sh = _short_of_espn.get(e)
    if sh: _votes[v["team"]][sh] += 1
FULL2SHORT = {full: max(c.items(), key=lambda kv: kv[1])[0] for full, c in _votes.items()}
def _isbig(r):
    """C / PF, or 6-8+ not listed at guard — the players who take a team's frontcourt minutes"""
    pos = (r.get("position") or "").upper(); h = r.get("height") or ""
    try: hi = int(h.split("-")[0]) * 12 + int(h.split("-")[1])
    except Exception: hi = None
    return pos in ("C", "PF") or bool(hi and hi >= 80 and pos not in ("PG", "SG"))
BIG_ESPN = {str(r["espn_id"]) for r in _pl if r.get("espn_id") and _isbig(r)}
BIG_NAME = {(r["team"], (r.get("name") or "").strip().lower()) for r in _pl if _isbig(r)}
BIG_MIN = 72.0   # a team plays two bigs: ~72 of its 200 minutes go to the frontcourt
fresh = json.load(open(D / "fresh_fit.json"))
# THE FRESHMAN EDITOR'S PLAYSTYLE (owner, Oct 2026): every page shows this build's newcomer line, but it only
# carried the editor's minutes / usage / Scoring slider (via the stat build's fit) — rebounds, assists, steals,
# blocks, shot mix and percentages were the league shape no matter what the archetype or sliders said, so a
# saved playstyle never showed up. Each edited newcomer's shape is now moved by the same archetype + slider
# math as the editor preview (tdc-freshman.js FR_ARCH / applySliders / the shot-mix block). Points stay the
# fit's. A newcomer with no saved profile (or every slider at 50 and no archetype) keeps the league shape.
OWNER_ID = "c5784cf4-dd77-4429-b0e6-578a0c1c5c8f"
try:
    _blob = (sb(f"profiles?id=eq.{OWNER_ID}&select=freshman_projections") or [{}])[0].get("freshman_projections") or {}
except Exception as _e:
    print("warn: no owner blob, newcomer playstyles skipped", _e, file=sys.stderr); _blob = {}
FR_PROF = {}
for _k, _v in _blob.items():
    if _k.startswith("tdc_fr:") and isinstance(_v, dict):
        _, _ft, _fn = _k.split(":", 2); FR_PROF[(_ft.strip(), _fn.strip().lower())] = _v
# a null in minutes_overrides_<season>.json drops the editor's typed minutes (the depth chart sets them), as in
# build_stat_overall_projected.py — UConn's Amosov kept 22.5 editor minutes from 11th on the chart (owner, Oct 20 2026)
try:
    for _ft, _pl0 in json.load(open(D / "minutes_overrides_2027.json")).items():
        if _ft.startswith("_") or not isinstance(_pl0, dict): continue
        for _fn, _mv in _pl0.items():
            _kk = (_ft.strip(), _fn.strip().lower())
            if _mv is None and _kk in FR_PROF: FR_PROF[_kk] = dict(FR_PROF[_kk], mpg=None)
except FileNotFoundError: pass
PL_BY_NAME = {(r["team"], (r.get("name") or "").strip().lower()): r for r in _pl}
FR_ARCH = {
    'Lead Guard': {'apg': 1.22, 'ppg': 1.05, 'tovs': 1.1}, 'Floor General': {'apg': 1.32, 'ppg': 0.85, 'tovs': 1.15, 'tp_pct': 2, 'stl': 1.15},
    'Combo Guard': {'ppg': 1.05, 'apg': 1.02}, 'Scoring Guard': {'ppg': 1.22, 'apg': 0.82, 'tp_pct': 2},
    'Sharpshooter': {'ppg': 1.05, 'tp_pct': 6, 'ft_pct': 4, 'apg': 0.75, 'rpg': 0.85, 'blk': 0.5}, '3&D Guard': {'tp_pct': 5, 'stl': 1.4, 'ppg': 0.9, 'apg': 0.9},
    'On-Ball Stopper': {'stl': 1.5, 'ppg': 0.85, 'apg': 1.05}, 'Point Forward': {'apg': 1.3, 'ppg': 1.0, 'rpg': 1.1},
    '3&D Wing': {'tp_pct': 5, 'stl': 1.35, 'ppg': 0.95, 'rpg': 1.05}, 'Movement Shooter': {'ppg': 1.1, 'tp_pct': 6, 'ft_pct': 4, 'apg': 0.75},
    'Wing Scorer': {'ppg': 1.25, 'tp_pct': 1, 'apg': 0.88}, 'Wing Stopper': {'stl': 1.4, 'blk': 1.2, 'ppg': 0.85},
    'Slasher': {'ppg': 1.15, 'fg_pct': 2, 'tp_pct': -3, 'apg': 0.9, 'oreb': 1.15}, 'Connector Wing': {'apg': 1.15, 'tp_pct': 2, 'ppg': 0.95},
    'Rim Runner': {'fg_pct': 6, 'ppg': 0.95, 'blk': 1.3, 'oreb': 1.5, 'dreb': 1.1, 'tp_pct': -15, 'apg': 0.6}, 'Stretch Big': {'tp_pct': 9, 'ppg': 1.05, 'blk': 0.85, 'oreb': 0.8},
    'Rim Protector': {'blk': 1.9, 'rpg': 1.2, 'dreb': 1.15, 'ppg': 0.85, 'fg_pct': 3}, 'Two-Way Big': {'blk': 1.5, 'fg_pct': 4, 'rpg': 1.15, 'ppg': 0.95},
    'Post Scorer': {'ppg': 1.25, 'fg_pct': 3, 'rpg': 1.1, 'tp_pct': -8, 'blk': 0.9}, 'Glass Cleaner': {'rpg': 1.35, 'oreb': 1.5, 'dreb': 1.25, 'ppg': 0.9, 'blk': 1.1},
    'Interior Big': {'rpg': 1.1, 'fg_pct': 3, 'blk': 1.1, 'tp_pct': -10},
}
def _ht(h):
    try: a, b = str(h).replace("'", "-").split("-")[:2]; return int(a) * 12 + int(b)
    except Exception: return 0

def reb40_ceiling(rpg, mpg):
    """the editor's rebounds-per-40 ceiling (tdc-freshman.js REB40): past 11.5 a 40 keep 45% of the excess, never past 15"""
    if not (mpg and mpg > 0 and rpg and rpg > 0): return 1.0
    r = rpg * 40.0 / mpg
    return 1.0 if r <= 11.5 else min(15.0, 11.5 + (r - 11.5) * 0.45) / r

def newcomer_line(short, nm, x, t=None):
    """a newcomer's per-game line at his fitted minutes + points: the league shape (rebounds/blocks at a big's or
    a guard's rate; attempts per point from his team's returners and the league), then his saved playstyle"""
    m, pp = float(x.get("mpg") or 0), float(x.get("ppg") or 0)
    big = (short, nm.strip().lower()) in BIG_NAME; R = BIGR if big else NBR
    d = {"mpg": m, "ppg": pp, "apg": m * LG["apg"], "stl": m * LG["stl"], "tov": m * LG["tov"],
         "oreb": m * R["oreb"], "dreb": m * R["dreb"], "blk": m * R["blk"], "rpg": m * R["rpg"]}
    for k in ("fga", "fgm", "tpa", "tpm", "fta", "ftm"):
        d[k] = pp * ((0.5 * t[k] / max(t["ppg"], 1) + 0.5 * LGP[k]) if t else LGP[k])
    prof = FR_PROF.get((short, nm.strip().lower()))
    # THE EDITOR'S LINE IS THE LINE (owner, Oct 15 2026: "the edit playstyle needs to be the thing updating"). A profile
    # saved since then carries _line — exactly what the editor showed. Use it as-is (per-minute rates held if his fitted
    # minutes moved and he has no explicit minutes); the reconcile below holds it fixed and the rest of the roster absorbs
    # the team totals.
    el = (prof or {}).get("_line")
    if el and float(el.get("mpg") or 0) > 0:
        km = 1.0 if (prof.get("mpg") not in (None, "") or m <= 0) else m / float(el["mpg"])
        g = lambda k: float(el.get(k) or 0) * km
        e = {"mpg": float(el["mpg"]) * km, "ppg": g("ppg"), "apg": g("apg"), "stl": g("stl"), "tov": g("tovs"), "oreb": g("oreb"),
             "dreb": g("dreb"), "blk": g("blk"), "fga": g("fga"), "fgm": g("fgm"), "tpa": g("tpa"), "tpm": g("tpm"), "fta": g("fta"), "ftm": g("ftm")}
        if e["oreb"] + e["dreb"] <= 0: e["dreb"] = g("rpg") * 0.75; e["oreb"] = g("rpg") * 0.25
        # the editor's rpg is the capped total; lines saved before LINE_V 2 (tdc-freshman.js) split past it (Enzo
        # Shahrvin 11.9 rpg on 5.0 + 9.6) — hold the total, keep the split's mix
        elif g("rpg") > 0: _od = e["oreb"] + e["dreb"]; e["oreb"] *= g("rpg") / _od; e["dreb"] *= g("rpg") / _od
        _kr = reb40_ceiling(e["oreb"] + e["dreb"], e["mpg"]); e["oreb"] *= _kr; e["dreb"] *= _kr
        # a line saved before LINE_V 2 gave everyone a flat 42% three-point share (an Interior Big took 4.3 threes at 26%):
        # re-solve its shot mix the way the editor now does — his model 3PA/FTA share x the sliders — at the line's points
        r = x.get("r40") or {}
        if float(prof.get("_lv") or 0) < 2 and r.get("fga") and e["ppg"] > 0:
            sl = prof.get("sliders") or {}; sv = lambda k: (float(sl.get(k, 50)) - 50) / 50
            tpr = min(0.72, r.get("tpa", 0) / r["fga"] * max(0.10, min(0.72, 0.42 + sv("three") * 0.18 - sv("paint") * 0.10)) / 0.42)
            ftr = min(0.60, r.get("fta", 0) / r["fga"] * max(0.12, min(0.55, 0.28 + sv("paint") * 0.10 + sv("ft") * 0.04)) / 0.28)
            fg, tp, ft = (float(el.get(k) or dv) / 100 for k, dv in (("fg_pct", 45), ("tp_pct", 33), ("ft_pct", 70)))
            pps = 2 * fg + tpr * tp + ftr * ft
            if pps > 0.2:
                e["fga"] = e["ppg"] / pps; e["tpa"] = e["fga"] * tpr; e["fta"] = e["fga"] * ftr
                e["fgm"] = e["fga"] * fg; e["tpm"] = e["tpa"] * tp; e["ftm"] = e["fta"] * ft
        e["rpg"] = e["oreb"] + e["dreb"]; e["_fixed"] = True
        return e
    sl = dict((prof or {}).get("sliders") or {})
    if sl.get("defense") is not None: sl.setdefault("steals", sl["defense"]); sl.setdefault("blocks", sl["defense"])
    arch = FR_ARCH.get((prof or {}).get("archetype") or "")
    if not prof or m <= 0 or (not arch and all(float(v) == 50 for v in sl.values())): return d
    pr = PL_BY_NAME.get((short, nm.strip().lower())) or {}
    pos = (pr.get("position") or "").upper(); guard = 1 if pos in ("PG", "SG") else 0
    size = max(0.0, min(1.0, (_ht(pr.get("height")) - 72) / 12.0))
    # the editor works on a per-32 base line; run its math on this line's per-32 shape and keep the ratios
    k32 = 32.0 / m
    fg0 = 100 * d["fgm"] / d["fga"] if d["fga"] else 45.0; tp0 = 100 * d["tpm"] / d["tpa"] if d["tpa"] else 33.0
    ft0 = 100 * d["ftm"] / d["fta"] if d["fta"] else 70.0
    b = {"apg": d["apg"] * k32, "stl": d["stl"] * k32, "blk": d["blk"] * k32, "tovs": d["tov"] * k32,
         "oreb": d["oreb"] * k32, "dreb": d["dreb"] * k32, "fg_pct": fg0, "tp_pct": tp0, "ft_pct": ft0}
    b["rpg"] = b["oreb"] + b["dreb"]; b0 = dict(b)
    for k, v in (arch or {}).items():
        if k == "ppg": continue
        b[k] = b[k] + v if k.endswith("_pct") else b[k] * v
    s = lambda k: float(sl.get(k, 50)); mm = lambda k, r: 1 + ((s(k) - 50) / 50) * r; aa = lambda k, r: ((s(k) - 50) / 50) * r
    b["tp_pct"] += aa("three", 7); b["fg_pct"] += aa("mid", 2.5) + aa("paint", 4); b["oreb"] *= mm("paint", 0.35)
    b["ft_pct"] += aa("ft", 10)
    b["apg"] = max(0.1, b["apg"] * mm("playmaking", 0.5) + aa("playmaking", 1.2 + 1.0 * guard)); b["tovs"] *= mm("playmaking", 0.20)
    b["oreb"] *= mm("athleticism", 0.45); b["blk"] *= mm("athleticism", 0.4); b["stl"] *= mm("athleticism", 0.25); b["dreb"] *= mm("athleticism", 0.14)
    st, bl = s("steals"), s("blocks")
    b["stl"] = max(0.05, b["stl"] * (1 + ((st - 50) / 50) * 0.45) + ((st - 50) / 50) * 0.45)
    b["blk"] = max(0.02, b["blk"] * (1 + ((bl - 50) / 50) * 0.45) + ((bl - 50) / 50) * (0.25 + 0.9 * size))
    b["rpg"] = max(0.3, b["rpg"] * mm("rebounding", 0.4) + aa("rebounding", 0.8 + 1.4 * size))
    b["oreb"] *= mm("rebounding", 0.3); b["dreb"] *= mm("rebounding", 0.3)
    rd = s("ready"); pm = 1 + ((rd - 50) / 50) * 0.14
    for k in ("rpg", "apg", "stl", "blk", "oreb", "dreb"): b[k] *= pm
    b["fg_pct"] += ((rd - 50) / 50) * 2.5; b["tp_pct"] += ((rd - 50) / 50) * 2; b["ft_pct"] += ((rd - 50) / 50) * 1.5
    b["tovs"] *= 1 - ((rd - 50) / 50) * 0.15
    # the editor's percentage ceilings (tdc-freshman.js PCT_CEIL: knee, kept, max)
    for k, (kn, kp_, mx) in (("fg_pct", (54, 0.5, 62)), ("tp_pct", (38, 0.5, 43)), ("ft_pct", (82, 0.5, 88))):
        if b[k] > kn: b[k] = min(mx, kn + (b[k] - kn) * kp_)
    b["fg_pct"] = max(30, b["fg_pct"]); b["tp_pct"] = max(0, b["tp_pct"]); b["ft_pct"] = max(45, b["ft_pct"])
    for k, dk in (("apg", "apg"), ("stl", "stl"), ("blk", "blk"), ("tovs", "tov")): d[dk] *= b[k] / max(b0[k], 1e-6)
    # the editor sets rebounds as a total; split it in the oreb/dreb mix the sliders left
    od = b["oreb"] + b["dreb"]
    if od > 0: d["oreb"] = b["rpg"] / k32 * b["oreb"] / od; d["dreb"] = b["rpg"] / k32 * b["dreb"] / od; d["rpg"] = d["oreb"] + d["dreb"]
    # shot mix: 3PT raises his 3-point share, Paint lowers it and draws more free throws (relative to his base
    # mix), then attempts are re-solved so his makes still add up to the fit's points
    tau = (d["tpa"] / d["fga"] if d["fga"] else 0.42) * max(0.10, min(0.72, 0.42 + aa("three", 0.18) - aa("paint", 0.10))) / 0.42
    phi = (d["fta"] / d["fga"] if d["fga"] else 0.28) * max(0.12, min(0.55, 0.28 + aa("paint", 0.10) + aa("ft", 0.04))) / 0.28
    fg, tp, ft = b["fg_pct"] / 100, b["tp_pct"] / 100, b["ft_pct"] / 100
    pps = 2 * fg + tau * tp + phi * ft
    if pp > 0 and pps > 0.2:
        d["fga"] = pp / pps; d["tpa"] = d["fga"] * tau; d["fta"] = d["fga"] * phi
        d["fgm"] = d["fga"] * fg; d["tpm"] = d["tpa"] * tp; d["ftm"] = d["fta"] * ft
    return d
pace = json.load(open(D / "team_pace_eff.json"))
# Rebounds are a TEAM resource (misses x rebound rates), not a sum of last year's individual rates
# — a guard-heavy roster's guards rebound more than they did next to a big, and a roster whose
# bigs aren't linked yet has no one to sum. So the team's rebounds are half the roster's sum and
# half a team-level target from its projected DNA: rpg ~ tempo + ORB% + DRB% + eFG + opp eFG,
# fit live on every 2026 team-season (r 0.92, rmse 1.0).
import numpy as np
_dna = json.load(open(D / "team_dna.json"))
_ts = sb("team_seasons?select=team,rpg&season_year=eq.2026&order=team_id.asc")
_rp = {t["team"]: float(t["rpg"]) for t in _ts if t.get("rpg")}
def _rebx(t): return [1.0, t["tempo"], t["oORB"], t["dDRB"], t.get("oeFG", 50.0), t.get("deFG", 50.0)]
_X = []; _y = []
for k, t in _dna["2026"]["teams"].items():
    if k in _rp and t.get("tempo") and t.get("oORB") and t.get("dDRB"): _X.append(_rebx(t)); _y.append(_rp[k])
_REBC = np.linalg.lstsq(np.array(_X), np.array(_y), rcond=None)[0]
def reb_target(full):
    t = _dna["2027"]["teams"].get(full)
    if not t or not (t.get("tempo") and t.get("oORB") and t.get("dDRB")): return None
    return float(np.array(_rebx(t)) @ _REBC)
import re
_MARK = re.compile(r"\b(atlantic|christian|baptist|state|southern|a&m|a&t|international|wesleyan|of|valley|pine bluff|gulf coast|tech|central|northern|western|eastern|st)\b")
def full_to_short(full):
    """roster-learned first ('East Carolina Pirates' -> 'ECU'); else 'Florida Gators' -> 'Florida' but never
    'Florida Atlantic Owls' -> 'Florida': the leftover after the short name must be a mascot."""
    if full in FULL2SHORT: return FULL2SHORT[full]
    lo = full.lower()
    best = None
    for s in short_conf:
        sl = s.lower()
        if lo == sl: return s
        if lo.startswith(sl + " "):
            rest = lo[len(sl) + 1:]
            if _MARK.search(rest): continue
            if best is None or len(s) > len(best): best = s
    return best

CNT = ["ppg", "rpg", "apg", "oreb", "dreb", "stl", "blk", "tov", "fga", "fgm", "tpa", "tpm", "fta", "ftm", "mpg"]
by = defaultdict(lambda: {k: 0.0 for k in CNT})
bigmin = defaultdict(float)
_bg = {"m": 0.0, "rpg": 0.0, "oreb": 0.0, "dreb": 0.0, "blk": 0.0}; _nb = dict(_bg)
for e, v0 in proj.items():
    v = raw(v0); t = by[v0["team"]]
    for k in CNT:
        src = "tovs" if k == "tov" else k
        t[k] += float(v.get(src) or 0)
    acc = _bg if e in BIG_ESPN else _nb
    if e in BIG_ESPN: bigmin[v0["team"]] += float(v.get("mpg") or 0)
    acc["m"] += float(v.get("mpg") or 0)
    for k in ("rpg", "oreb", "dreb", "blk"): acc[k] += float(v.get(k) or 0)
# per-minute rebounding / shot-blocking of a big vs everyone else, from the projections themselves
BIGR = {k: _bg[k] / max(_bg["m"], 1) for k in ("rpg", "oreb", "dreb", "blk")}
NBR = {k: _nb[k] / max(_nb["m"], 1) for k in ("rpg", "oreb", "dreb", "blk")}

# league-average per-minute / per-point shape from full rosters, for the ones we barely know
_full = [t for t in by.values() if t["mpg"] >= 180]
LG = {k: sum(t[k] for t in _full) / max(1, sum(t["mpg"] for t in _full)) for k in ("rpg", "apg", "oreb", "dreb", "stl", "blk", "tov")}   # per minute
LGP = {k: sum(t[k] for t in _full) / max(1, sum(t["ppg"] for t in _full)) for k in ("fga", "fgm", "tpa", "tpm", "fta", "ftm")}          # per point
# A roster the sheet hasn't filled in yet (fewer than MIN_ROSTER names) is NOT projected: a
# six-man sheet with no center would read as a real team line. The row is left out of the JSON
# and removed from team_projections until the roster is complete (UTSA, Sept 2026).
MIN_ROSTER = 8
_cnt = defaultdict(int)
for r in _pl:
    if (r.get("name") or "").strip() and (r.get("name") or "").strip() != "\u2014": _cnt[r["team"]] += 1
out = {}; LINES = {}
for full, t in by.items():
    if t["mpg"] < 40: continue                           # nothing to project from
    short = full_to_short(full)
    if short and 0 < _cnt.get(short, 0) < MIN_ROSTER:
        print(f"  skipped {full}: only {_cnt[short]} players on the sheet — roster incomplete, not projected"); continue
    fr = {nm: (x.get("_raw") or x) for nm, x in (fresh.get(short, {}) if short else {}).items()}
    f_mpg = sum(float(x.get("mpg") or 0) for x in fr.values()); f_ppg = sum(float(x.get("ppg") or 0) for x in fr.values())
    line = dict(t)
    f_big = sum(float(x.get("mpg") or 0) for nm, x in fr.items() if (short, nm.strip().lower()) in BIG_NAME)
    if f_mpg > 0 and t["mpg"] > 0:
        # freshmen: fitted points + minutes; assists/steals/turnovers at the league's per-minute shape,
        # rebounds and blocks at a big's or a guard's rate by their listed position (the fit doesn't
        # know positions — a guard-only returning core would otherwise hand its freshman bigs a
        # guard's rebounding)
        for nm, x in fr.items():
            d = newcomer_line(short, nm, x, t)
            for k in ("apg", "stl", "tov", "oreb", "dreb", "blk", "fga", "fgm", "tpa", "tpm", "fta", "ftm"): line[k] += d[k]
            line["rpg"] += d["rpg"]
        line["ppg"] += f_ppg; line["mpg"] += f_mpg
    # A SHORT roster (unlinked players, freshmen the fit doesn't know) can't read as the worst team
    # of all time. Points land on the team's projected ORtg x tempo; the other counting stats are
    # filled to a 200-minute team — at the roster's own per-minute rates when we know most of it,
    # blended toward the league's shape when we know little (< 120 fitted minutes).
    known = min(1.0, max(0.0, (line["mpg"] - 40.0) / 80.0))    # 40 min -> 0 (league shape), 120+ -> 1 (own shape)
    pt = pace["teams"].get(full)
    pts_target = (pt["o"] * pt["t"] / 100.0) if pt else line["ppg"] * 200.0 / max(line["mpg"], 1)
    miss_min = max(0.0, 200.0 - line["mpg"]); miss_pts = max(0.0, pts_target - line["ppg"])
    for k in ("apg", "stl", "tov"):
        line[k] += miss_min * LG[k]                          # the players we can't see: league shape
    # the players we can't see are the frontcourt first: a team plays two bigs (~72 of 200 minutes),
    # so unseen minutes fill the frontcourt up to that at a big's rebounding / blocking rate, the rest
    # at a guard's. If the roster still comes up short of two bigs after that (linked centers squeezed
    # to 5-8 mpg behind a guard-heavy grade order), those minutes are reassigned to bigs at the rate
    # difference — whoever ends up playing them will be a big.
    bm = bigmin.get(full, 0.0) + f_big
    big_fill = min(miss_min, max(0.0, BIG_MIN - bm)); other_fill = miss_min - big_fill
    for k in ("rpg", "oreb", "dreb", "blk"):
        line[k] += big_fill * BIGR[k] + other_fill * NBR[k]
    short_big = max(0.0, BIG_MIN - bm - big_fill)
    for k in ("rpg", "oreb", "dreb", "blk"):
        line[k] += short_big * (BIGR[k] - NBR[k])
    for k in ("fga", "fgm", "tpa", "tpm", "fta", "ftm"):
        own = line[k] / max(line["ppg"], 1)
        line[k] += miss_pts * (known * own + (1 - known) * LGP[k])
    # points ALWAYS land on the team's projected scoring (ORtg x tempo): a roster of low-usage
    # returners hits the per-player fit clamps and comes up short (Seton Hall 64 vs 72) — the
    # missing points are the ones nobody on the sheet is credited with yet, filled above at the
    # league's attempt shape
    line["ppg"] = max(line["ppg"], pts_target)
    line["mpg"] = max(line["mpg"], 200.0)
    rt = reb_target(full)
    if rt and line["rpg"] > 0:
        f = (0.5 * line["rpg"] + 0.5 * rt) / line["rpg"]; line["rpg"] *= f; line["oreb"] *= f; line["dreb"] *= f
    if line["rpg"] < 28.0 and line["rpg"] > 0:               # no D-I team rebounds this little — last guard
        f = 28.0 / line["rpg"]; line["rpg"] = 28.0; line["oreb"] *= f; line["dreb"] *= f
    row = {k: round(line[k], 1) for k in ("ppg", "rpg", "apg", "oreb", "dreb", "stl", "blk", "tov", "fga", "tpa")}
    row["mpg"] = round(line["mpg"], 1)
    row["fg_pct"] = round(100 * line["fgm"] / line["fga"], 1) if line["fga"] else 0
    row["tp_pct"] = round(100 * line["tpm"] / line["tpa"], 1) if line["tpa"] else 0
    row["ft_pct"] = round(100 * line["ftm"] / line["fta"], 1) if line["fta"] else 0
    out[full] = row
    LINES[full] = (line, dict(t), short, fr)

# ── RECONCILE: the team line IS the sum of its players (Oct 2026, owner: every page must match) ──
# The team line adds what no player line carries: team rebounds (the DNA rebounding blend), minutes and
# points nobody on the sheet is credited with yet, and the ORtg x tempo points floor. Those used to stay
# at the TEAM level only, so a depth chart's players summed to 87.7 ppg / 45.3% FG while the same team's
# Analytics line read 87.9 / 48.3. Each stat's team adjustment is now spread over that team's players in
# proportion to their own share, the reconciled lines are written back into stat_overall_projected.json
# (returners) and fresh_fit.json (newcomers), and the team row is re-summed from the players' ROUNDED
# numbers — so the depth chart, player pages, team stats and Analytics show one set of numbers.
PK = ["ppg", "oreb", "dreb", "apg", "stl", "blk", "tov", "fga", "fgm", "tpa", "tpm", "fta", "ftm", "mpg"]
for full, (line, t, short, fr) in LINES.items():
    pls = []
    for e, v0 in proj.items():
        if v0.get("team") != full: continue
        v = raw(v0); pls.append(("r", e, {k: float(v.get("tovs" if k == "tov" else k) or 0) for k in PK}))
    for nm, x in fr.items():
        pls.append(("f", nm, newcomer_line(short, nm, x, t)))
    if not pls: continue
    tot_m = sum(d["mpg"] for _, _, d in pls) or 1.0
    for k in PK:
        # an editor-set line (_fixed) keeps its numbers; everyone else absorbs the rest of the team total
        F = sum(d[k] for _, _, d in pls if d.get("_fixed")); S = sum(d[k] for _, _, d in pls if not d.get("_fixed"))
        tgt = max(line[k] - F, 0.3 * S)
        for _, _, d in pls:
            if d.get("_fixed"): continue
            d[k] = d[k] * tgt / S if S > 0 else line[k] * d["mpg"] / tot_m
    agg = {k: 0.0 for k in PK}
    for kind, key, d in pls:
        r = {k: round(d[k], 1) for k in PK}
        r["rpg"] = round(r["oreb"] + r["dreb"], 1)
        # percentages from the UNROUNDED makes / attempts: a low-volume player's 0.5 / 1.5 rounded first could only read
        # 33.3% or 38.5%, which swallowed the editor's shooting sliders (Tommy Ahneman, owner Oct 15 2026)
        pct = lambda a, b: round(100 * d[a] / d[b], 1) if d[b] > 0 else None
        for k in PK: agg[k] += r[k]
        agg["rpg"] = agg.get("rpg", 0.0) + r["rpg"]
        if kind == "r":
            v0 = proj[key]
            if "_raw" not in v0: v0["_raw"] = {k: v0.get(k) for k in RAWK}
            for k in PK: v0["tovs" if k == "tov" else k] = r[k]
            v0["rpg"] = r["rpg"]; v0["fg_pct"] = pct("fgm", "fga"); v0["tp_pct"] = pct("tpm", "tpa"); v0["ft_pct"] = pct("ftm", "fta")
        else:
            x = fresh[short][key]
            if "_raw" not in x: x["_raw"] = {"mpg": x.get("mpg"), "ppg": x.get("ppg")}
            for k in PK: x["tovs" if k == "tov" else k] = r[k]
            x["rpg"] = r["rpg"]; x["fg_pct"] = pct("fgm", "fga"); x["tp_pct"] = pct("tpm", "tpa"); x["ft_pct"] = pct("ftm", "fta")
    row = {k: round(agg[k], 1) for k in ("ppg", "rpg", "apg", "oreb", "dreb", "stl", "blk", "tov", "fga", "tpa", "mpg")}
    row["fg_pct"] = round(100 * agg["fgm"] / agg["fga"], 1) if agg["fga"] else 0
    row["tp_pct"] = round(100 * agg["tpm"] / agg["tpa"], 1) if agg["tpa"] else 0
    row["ft_pct"] = round(100 * agg["ftm"] / agg["fta"], 1) if agg["fta"] else 0
    out[full] = row
# Newcomers on a team this build couldn't project (almost no linked returners — St. Thomas, Queens, Idaho
# State, Campbell, La Tech, MVSU in Oct 2026) still need a FULL line, or their player page falls back to a
# different engine than their team page (owner: "check the other freshmen"). Fill from their fitted minutes
# and points at the league's per-minute / per-point shape (a big's rebounding/blocks for listed bigs) — the
# same rates the team line uses for newcomers everywhere else.
_filled = 0
for short, rows in fresh.items():
    for nm, x in rows.items():
        if x.get("rpg") is not None or x.get("ppg") is None: continue
        d = newcomer_line(short, nm, x)
        for k in ("apg", "stl", "oreb", "dreb", "blk", "fga", "fgm", "tpa", "tpm", "fta", "ftm"): x[k] = round(d[k], 1)
        x["tovs"] = round(d["tov"], 1); x["rpg"] = round(d["rpg"], 1)
        x["fg_pct"] = round(100 * d["fgm"] / d["fga"], 1) if d["fga"] else None
        x["tp_pct"] = round(100 * d["tpm"] / d["tpa"], 1) if d["tpa"] else None
        x["ft_pct"] = round(100 * d["ftm"] / d["fta"], 1) if d["fta"] else None
        _filled += 1
if _filled: print(f"  filled full lines for {_filled} newcomers on teams without a team line")
json.dump(_PROJ_DOC, open(D / "stat_overall_projected.json", "w"), separators=(",", ":"))
json.dump(fresh, open(D / "fresh_fit.json", "w"), separators=(",", ":"))
print(f"reconciled player lines to their team line for {len(LINES)} teams (stat_overall_projected.json + fresh_fit.json rewritten)")

json.dump(out, open(D / "team_projected_box.json", "w"), separators=(",", ":"))
print(f"wrote team_projected_box.json — {len(out)} teams")
for t in ["Florida Gators", "Duke Blue Devils", "Houston Cougars", "Gonzaga Bulldogs", "San Diego State Aztecs"]:
    if t in out:
        tgt = pace["teams"].get(t); tgt = round(tgt["o"] * tgt["t"] / 100, 1) if tgt else None
        print(f"  {t}: PPG {out[t]['ppg']} (target {tgt}) FG% {out[t]['fg_pct']} 3P% {out[t]['tp_pct']} RPG {out[t]['rpg']} AST {out[t]['apg']} min {out[t]['mpg']}")

# The rows for team_projections (short team name + conf), always built and saved: the owner console's
# "Refresh team projections" button publishes this file, so no SQL paste is needed after a rebuild.
import datetime
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
# SANITY GUARD: nothing outside real D-I team ranges reaches the site. A row that fails is
# printed and left out (the old row stays), and the run exits non-zero so it gets looked at.
RANGE = {"ppg": (58, 96), "rpg": (26, 46), "apg": (8, 23), "fg_pct": (38, 57), "tp_pct": (26, 43), "ft_pct": (58, 85), "fga": (46, 76), "tov": (6, 21)}
rows, seen, rejected = [], {}, []
for full, r in sorted(out.items(), key=lambda kv: -kv[1]["mpg"]):
    short = full_to_short(full)
    if not short: continue
    if short in seen: print(f"  skip {full}: '{short}' already taken by {seen[short]}"); continue
    bad = [k for k, (lo, hi) in RANGE.items() if not (lo <= float(r.get(k) or 0) <= hi)]
    if bad: rejected.append((short, {k: r[k] for k in bad})); continue
    seen[short] = full
    rows.append({"team": short, "conf": short_conf.get(short) or "", "updated_at": now,
                 **{k: r[k] for k in ("ppg", "rpg", "apg", "fg_pct", "tp_pct", "ft_pct", "fga", "tpa", "tov", "stl", "blk", "oreb", "dreb")}})
for t, b in rejected: print(f"  REJECTED (out of D-I range, not uploaded): {t} {b}")
json.dump({"generated": now, "rows": rows, "rejected": [t for t, _ in rejected]},
          open(D / "team_projections_rows.json", "w"), separators=(",", ":"))
print(f"wrote team_projections_rows.json — {len(rows)} rows")
if UPLOAD or SQL_OUT:
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if UPLOAD and not key: sys.exit("Set SUPABASE_SERVICE_KEY to upload.")
    HH = {"apikey": key or "", "Authorization": "Bearer " + (key or ""), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
    if SQL_OUT:
        COLS = ["team", "conf", "ppg", "rpg", "apg", "fg_pct", "tp_pct", "ft_pct", "fga", "tpa", "tov", "stl", "blk", "oreb", "dreb"]
        q = lambda v: "null" if v is None else ("'" + str(v).replace("'", "''") + "'" if isinstance(v, str) else repr(float(v)))
        vals = ",\n".join("  (" + ", ".join(q(r[c]) for c in COLS) + ", now())" for r in rows)
        upd = ", ".join(f"{c} = excluded.{c}" for c in COLS[1:]) + ", updated_at = excluded.updated_at"
        keep = ", ".join(q(r["team"]) for r in rows)
        sql = (f"-- team_projections from build_team_projected_box.py ({len(rows)} teams, {now})\nbegin;\n"
               f"insert into team_projections ({', '.join(COLS)}, updated_at) values\n{vals}\n"
               f"on conflict (team) do update set {upd};\n"
               f"-- rows no build produced (leftovers from the old in-browser engine)\n"
               f"delete from team_projections where team not in ({keep});\ncommit;\n")
        open(SQL_OUT, "w").write(sql); print(f"wrote {SQL_OUT} — {len(rows)} rows")
        if not UPLOAD: sys.exit(2 if rejected else 0)
    ok = 0
    for i in range(0, len(rows), 40):
        ch = rows[i:i + 40]
        try:
            req = urllib.request.Request(SB + "/rest/v1/team_projections?on_conflict=team", headers=HH, data=json.dumps(ch).encode(), method="POST")
            with urllib.request.urlopen(req, timeout=120) as resp: ok += len(ch)
        except urllib.error.HTTPError as e:
            print("  upsert failed:", e.code, e.read()[:200], [c["team"] for c in ch][:5])
    print(f"team_projections: upserted {ok} of {len(rows)} rows")
    # rows the build didn't produce are leftovers from the old in-browser engine — remove them so
    # nothing on the site shows a number no model made
    try:
        cur = json.load(urllib.request.urlopen(urllib.request.Request(SB + "/rest/v1/team_projections?select=team", headers=HH), timeout=60))
        extra = [c["team"] for c in cur if c["team"] not in seen]
        if extra:
            req = urllib.request.Request(SB + "/rest/v1/team_projections?team=in.(" + ",".join(urllib.parse.quote(t, safe='') for t in extra) + ")", headers=HH, method="DELETE")
            with urllib.request.urlopen(req, timeout=60) as resp: print(f"  removed {len(extra)} row(s) no build produced: {extra}")
    except Exception as e:
        print("  cleanup skipped:", e)
    if rejected: sys.exit(2)
