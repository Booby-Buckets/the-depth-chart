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
proj = json.load(open(D / "stat_overall_projected.json"))["players"]
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
for e, v in proj.items():
    t = by[v["team"]]
    for k in CNT:
        src = "tovs" if k == "tov" else k
        t[k] += float(v.get(src) or 0)
    acc = _bg if e in BIG_ESPN else _nb
    if e in BIG_ESPN: bigmin[v["team"]] += float(v.get("mpg") or 0)
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
out = {}
for full, t in by.items():
    if t["mpg"] < 40: continue                           # nothing to project from
    short = full_to_short(full)
    if short and 0 < _cnt.get(short, 0) < MIN_ROSTER:
        print(f"  skipped {full}: only {_cnt[short]} players on the sheet — roster incomplete, not projected"); continue
    fr = fresh.get(short, {}) if short else {}
    f_mpg = sum(float(x.get("mpg") or 0) for x in fr.values()); f_ppg = sum(float(x.get("ppg") or 0) for x in fr.values())
    line = dict(t)
    f_big = sum(float(x.get("mpg") or 0) for nm, x in fr.items() if (short, nm.strip().lower()) in BIG_NAME)
    if f_mpg > 0 and t["mpg"] > 0:
        # freshmen: fitted points + minutes; assists/steals/turnovers at the league's per-minute shape,
        # rebounds and blocks at a big's or a guard's rate by their listed position (the fit doesn't
        # know positions — a guard-only returning core would otherwise hand its freshman bigs a
        # guard's rebounding)
        for k in ("apg", "stl", "tov"): line[k] += f_mpg * LG[k]
        for k in ("rpg", "oreb", "dreb", "blk"): line[k] += f_big * BIGR[k] + (f_mpg - f_big) * NBR[k]
        for k in ("fga", "fgm", "tpa", "tpm", "fta", "ftm"): line[k] += f_ppg * (0.5 * t[k] / max(t["ppg"], 1) + 0.5 * LGP[k])
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

json.dump(out, open(D / "team_projected_box.json", "w"), separators=(",", ":"))
print(f"wrote team_projected_box.json — {len(out)} teams")
for t in ["Florida Gators", "Duke Blue Devils", "Houston Cougars", "Gonzaga Bulldogs", "San Diego State Aztecs"]:
    if t in out:
        tgt = pace["teams"].get(t); tgt = round(tgt["o"] * tgt["t"] / 100, 1) if tgt else None
        print(f"  {t}: PPG {out[t]['ppg']} (target {tgt}) FG% {out[t]['fg_pct']} 3P% {out[t]['tp_pct']} RPG {out[t]['rpg']} AST {out[t]['apg']} min {out[t]['mpg']}")

if UPLOAD:
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not key: sys.exit("Set SUPABASE_SERVICE_KEY to upload.")
    HH = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
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
