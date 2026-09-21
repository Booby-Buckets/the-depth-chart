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
_pl = sb("players?select=espn_id,team&espn_id=not.is.null&order=id.asc")
_short_of_espn = {str(r["espn_id"]): r["team"] for r in _pl if r.get("team")}
_votes = defaultdict(lambda: defaultdict(int))
for e, v in proj.items():
    sh = _short_of_espn.get(e)
    if sh: _votes[v["team"]][sh] += 1
FULL2SHORT = {full: max(c.items(), key=lambda kv: kv[1])[0] for full, c in _votes.items()}
fresh = json.load(open(D / "fresh_fit.json"))
pace = json.load(open(D / "team_pace_eff.json"))
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
for v in proj.values():
    t = by[v["team"]]
    for k in CNT:
        src = "tovs" if k == "tov" else k
        t[k] += float(v.get(src) or 0)

# league-average per-minute / per-point shape from full rosters, for the ones we barely know
_full = [t for t in by.values() if t["mpg"] >= 180]
LG = {k: sum(t[k] for t in _full) / max(1, sum(t["mpg"] for t in _full)) for k in ("rpg", "apg", "oreb", "dreb", "stl", "blk", "tov")}   # per minute
LGP = {k: sum(t[k] for t in _full) / max(1, sum(t["ppg"] for t in _full)) for k in ("fga", "fgm", "tpa", "tpm", "fta", "ftm")}          # per point
out = {}
for full, t in by.items():
    if t["mpg"] < 40: continue                           # nothing to project from
    short = full_to_short(full)
    fr = fresh.get(short, {}) if short else {}
    f_mpg = sum(float(x.get("mpg") or 0) for x in fr.values()); f_ppg = sum(float(x.get("ppg") or 0) for x in fr.values())
    line = dict(t)
    if f_mpg > 0 and t["mpg"] > 0:
        # freshmen: fitted points + minutes; rebounds/assists/etc. half at the roster's own per-minute
        # rates, half at the league's (the fit doesn't know their positions — a guard-only returning
        # core would otherwise hand its freshman bigs a guard's rebounding)
        for k in ("rpg", "apg", "oreb", "dreb", "stl", "blk", "tov"): line[k] += f_mpg * LG[k]   # positions unknown -> league shape
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
    for k in ("rpg", "apg", "oreb", "dreb", "stl", "blk", "tov"):
        line[k] += miss_min * LG[k]                          # the players we can't see: league shape
    for k in ("fga", "fgm", "tpa", "tpm", "fta", "ftm"):
        own = line[k] / max(line["ppg"], 1)
        line[k] += miss_pts * (known * own + (1 - known) * LGP[k])
    line["ppg"] = max(line["ppg"], pts_target) if line["mpg"] < 200 else line["ppg"]
    line["mpg"] = max(line["mpg"], 200.0)
    if line["rpg"] < 28.0 and line["rpg"] > 0:               # no D-I team rebounds this little — the bigs aren't linked yet
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
