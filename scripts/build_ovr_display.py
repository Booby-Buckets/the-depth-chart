#!/usr/bin/env python3
"""build_ovr_display.py — the DISPLAYED overall for the projected season ("Eye test v2", owner Oct 20 2026).

The overall is a display number for fans (owner rule: it drives no stat, minutes, rating, award or NIL value). The
owner judged the stat overall against his eye test and found it overrated efficient role bigs and productive
mid-major players (Kellen Thames, Logan Duncomb, JT Rock, Jalen Jackson...) and underrated NBA prospects at top
programs (Mirkovic, Ngongba, Bidunga). This model orders every projected player by a blend, fitted to his examples
in the Overall Model Lab:

  impact  .20  projected per-40 Wins Added (shrunk 20 min toward the median) + season Wins Added
  talent  .15  per-40 Wins Added trusted by his DEMONSTRATED minutes (min/(min+400); newcomers .45)
  scoring .05  projected points, nudged by the strength of his league
  peak    .10  best scoring season with 20+ mpg in the last three seasons, adjusted for the league it came in
  prospect.10  average spot in current NBA mock drafts (draft-overrides.json; 2028 board at 60% weight)
  league  .20  his conference's average power rating
  team    .40  his team's power rating

…then puts that ORDER on the site's fixed all-seasons scale: a player at percentile p of this season's rotation
players gets the rating at percentile p of the last five seasons' rotation players on the fixed scale
(ovr_display_scale.json, from build_stat_overall.py) — so a top player lands where real top players have landed
(about 95-97), not an automatic 99.

Reads: stat_overall_projected.json, fresh_fit.json, fr_pedigree_2027.json, draft-overrides.json, ovr_display_scale.json; Supabase (anon,
read-only): players, predictive_ratings, player_history. Writes scripts/data/ovr_display_2027.json:
  {"season":2027, "espn":{espn_id: ovr}, "fresh":{"team|name": ovr}, "demo":{espn_id: 2025-26 ovr}}   (fresh keys like _fk)
"""
import json, os, re, math, statistics, collections, urllib.request
from statistics import NormalDist

HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(HERE, "data"); ROOT = os.path.dirname(HERE)
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"; KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
CUR = 2026; SEASON = CUR + 1; G = 31.0
W = {"imp": .20, "tal": .15, "pts": .05, "peak": .10, "pro": .10, "lvl": .20, "team": .40}
N = NormalDist()

def get(path):
    out, off = [], 0
    while True:
        r = urllib.request.Request(f"{SB}/rest/v1/{path}&offset={off}&limit=1000", headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
        d = json.load(urllib.request.urlopen(r, timeout=60)); out += d
        if len(d) < 1000: return out
        off += 1000

def f(x, d=0.0):
    try:
        x = float(x); return x if math.isfinite(x) else d
    except (TypeError, ValueError): return d

nk = lambda n: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", str(n or "").lower()))
fk = lambda t, n: str(t or "").strip().lower() + "|" + str(n or "").strip().lower()

SO = json.load(open(os.path.join(D, "stat_overall_projected.json")))["players"]
FF = json.load(open(os.path.join(D, "fresh_fit.json")))
DR = json.load(open(os.path.join(ROOT, "draft-overrides.json")))
LAD = json.load(open(os.path.join(D, "ovr_display_scale.json")))["ladder"]
PED = json.load(open(os.path.join(D, "fr_pedigree_2027.json")))
PL = get("players?select=name,team,espn_id&name=neq.%E2%80%94&order=id.asc")
PR = get(f"predictive_ratings?select=data&season=eq.{SEASON}")[0]["data"]["teams"]
H = get(f"player_history?select=espn_id,season_year,team,ppg,mpg&season_year=gte.{CUR-2}&espn_id=not.is.null&order=id.asc")

# league / team strength
rating = {}; conf = {}
for t in PR:
    for k in (t.get("team"), t.get("full")):
        if k: rating[k] = f(t.get("rating")); conf[k] = t.get("conf") or ""
cm = collections.defaultdict(list)
for t in PR: cm[t.get("conf") or ""].append(f(t.get("rating")))
cmean = {c: statistics.mean(v) for c, v in cm.items()}
rmed = statistics.median(f(t.get("rating")) for t in PR); cmed = statistics.median(cmean[t.get("conf") or ""] for t in PR)

# prospect: average mock-draft spot (missing from a 2027 mock = 40; 2028 board at 60% weight, missing = 70)
picks = collections.defaultdict(list)
for yr, miss, wt in (("mocks_%d" % SEASON, 40, 1.0), ("mocks_%d" % (SEASON + 1), 70, 0.6)):
    lists = [[nk(x.split("|")[0]) for x in l] for l in (DR.get(yr, {}).get("lists") or {}).values() if l]
    for nm in {n for l in lists for n in l}:
        for l in lists: picks[nm].append((l.index(nm) + 1 if nm in l else miss, wt))
pro = {k: sum(p * w for p, w in v) / sum(w for p, w in v) for k, v in picks.items()}

# track record: best scoring season with 20+ mpg in the last three seasons, LEVEL-ADJUSTED by the league he did it in
# (owner, Oct 20 2026: Logan Duncomb's 18.3 ppg at Winthrop counted like an ACC 18.3) — 2.5% per point of that
# conference's average power rating vs the median league, kept within 0.6-1.2
PEAK_LVL = 0.025
peak = collections.defaultdict(float)
for h in H:
    if f(h.get("mpg")) >= 20:
        _cg = cmean.get(conf.get(h.get("team")), cmed) - cmed
        peak[str(h["espn_id"])] = max(peak[str(h["espn_id"])], f(h.get("ppg")) * max(0.6, min(1.2, 1 + PEAK_LVL * _cg)))

name_of = {}
for p in PL:
    if p.get("espn_id") is not None: name_of.setdefault(str(p["espn_id"]), p["name"])

rows = []
for e, p in SO.items():
    m = f(p.get("mpg"))
    if m <= 0: continue
    rows.append({"key": ("espn", e), "name": name_of.get(e, ""), "team": p.get("team"), "mpg": m, "ppg": f(p.get("ppg")), "wa": f(p.get("proj_wa")),
                 "sample": f(p.get("last_mpg")) * G, "new": False, "peak": peak.get(e, 0.0)})
for t, d in FF.items():
    for n, x in d.items():
        if not isinstance(x, dict): continue
        m = f(x.get("mpg"))
        if m <= 0: continue
        # the minutes a newcomer's rank usually earns protect a buried RANKED recruit only — scaled by his recruiting
        # pedigree (fr_pedigree_2027.json 'ped', 0-1; full at .5+), so an unranked freshman walk-on gets none of it
        _ped = f((PED.get(nk(n)) or {}).get("ped"))
        rows.append({"key": ("fresh", fk(t, n)), "name": n, "team": t, "mpg": m, "ppg": f(x.get("ppg")), "wa": f(x.get("pwa")),
                     "sample": 0.0, "new": True, "peak": 0.0, "mpg_pot": f(x.get("mpg_pot")) * min(1.0, _ped / 0.5)})

for r in rows:
    r["w40"] = r["wa"] / max(r["mpg"] * G / 40.0, 1.0)
    tr = rating.get(r["team"], rmed); cf = conf.get(r["team"], "")
    r["clvl"] = (cmean.get(cf, cmed) - cmed) / 8.0; r["tlvl"] = (tr - rmed) / 8.0
    r["pts"] = r["ppg"] * (1 + 0.06 * r["clvl"])
rot = [r for r in rows if r["mpg"] >= 15]
mu40 = statistics.median(r["w40"] for r in rot)
# small samples shrink toward REPLACEMENT level (the 20th percentile of rotation players), not the median: a walk-on with
# two minutes a game is a replacement player until he shows otherwise (owner, Oct 20 2026: walk-on overalls too high).
# A ranked recruit's role counts at the minutes recruits of his rank usually play (mpg_pot).
rep40 = sorted(r["w40"] for r in rot)[len(rot) // 5]
for r in rows:
    _rm = max(r["mpg"], r.get("mpg_pot") or 0.0)
    r["qA"] = (r["w40"] * _rm + rep40 * 20) / (_rm + 20)
    c = .45 if r["new"] else r["sample"] / (r["sample"] + 400)
    r["qB"] = rep40 + c * (r["w40"] - rep40)

def zf(vals):
    s = sorted(vals)
    def z(v):
        lo, hi = 0, len(s)
        while lo < hi:
            mid = (lo + hi) // 2
            if s[mid] < v: lo = mid + 1
            else: hi = mid
        return N.inv_cdf(min(max((lo + .5) / (len(s) + 1), 1e-4), 1 - 1e-4))
    return z
zq, zw, zb, zp, zk = (zf([r[k] for r in rot]) for k in ("qA", "wa", "qB", "pts", "peak"))
for r in rows:
    pk = pro.get(nk(r["name"]))
    feat = {"imp": .55 * zq(r["qA"]) + .45 * zw(r["wa"]), "tal": zb(r["qB"]), "pts": zp(r["pts"]),
            "peak": zk(r["peak"]) if r["peak"] > 0 else -0.5,
            "pro": (2.6 - 2.6 * min(1, (pk - 1) / 45)) if pk is not None and pk < 45 else 0.0,
            "lvl": max(-1.5, min(1.0, r["clvl"])), "team": max(-1.5, min(1.5, r["tlvl"]))}
    # TEAM / LEAGUE CREDIT FOLLOWS THE ROLE (owner, Oct 20 2026: "the walk-on overalls are too high" — a 2-minute player
    # at Texas A&M rated 77 off his team's strength). Full credit at 20+ minutes, none for a walk-on; a ranked recruit
    # buried on a deep roster counts at the minutes recruits of his rank usually play (mpg_pot), as the site does.
    _role = min(1.0, max(r["mpg"], r.get("mpg_pot") or 0.0) / 20.0)
    feat["lvl"] *= _role; feat["team"] *= _role
    r["s"] = sum(W[k] * feat[k] for k in W)

# the order -> the fixed scale: percentile among this season's rotation players -> the same percentile of the ladder
srot = sorted(r["s"] for r in rot)
def ovr(s):
    lo, hi = 0, len(srot)
    while lo < hi:
        mid = (lo + hi) // 2
        if srot[mid] < s: lo = mid + 1
        else: hi = mid
    q = min(max((lo + .5) / (len(srot) + 1), 0.0), 1.0) * 1000
    i = int(q); fr = q - i
    v = LAD[min(i, 1000)] + (LAD[min(i + 1, 1000)] - LAD[min(i, 1000)]) * fr
    return v

# A WALK-ON IS RATED AS ONE (owner, Oct 20 2026: "the walk-on overalls are too high"). The order above ranks a 2-minute
# player among rotation players, so a deep-bench player at a strong program landed at 72-77. The rating is pulled toward
# the floor (55) by role: full value at 15+ minutes, about half the distance above 55 for a 2-minute player. A ranked
# recruit's role is the minutes recruits of his rank usually play (mpg_pot), so a buried top recruit keeps his number.
def ovr_of(r):
    role = min(1.0, max(r["mpg"], r.get("mpg_pot") or 0.0) / 15.0)
    v = 55 + (ovr(r["s"]) - 55) * (0.4 + 0.6 * role)
    return int(round(max(55, min(99, v))))

out = {"season": SEASON, "weights": W, "espn": {}, "fresh": {},
       # last season's demonstrated overall on the same fixed scale (players' 2025-26 view), from build_stat_overall.py
       "demo": json.load(open(os.path.join(D, "ovr_display_hist.json"))).get(str(CUR), {})}
for r in rows:
    out[r["key"][0]][r["key"][1]] = ovr_of(r)
json.dump(out, open(os.path.join(D, "ovr_display_%d.json" % SEASON), "w"), separators=(",", ":"), sort_keys=True)
vals = [ovr_of(r) for r in rot]
top = sorted(rows, key=lambda r: -r["s"])[:10]
print(f"display overall {SEASON}: {len(rows)} players · 95+ {sum(v >= 95 for v in vals)} · 90+ {sum(v >= 90 for v in vals)} · "
      f"top: " + ", ".join(f"{r['name']} {ovr_of(r)}" for r in top))
