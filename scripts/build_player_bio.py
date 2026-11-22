#!/usr/bin/env python3
"""Height · weight · class for every player the site links to -> scripts/data/player_bio.json.

Owner rule (Nov 2026): show height, weight and class beside player names on every page. tdc-bio.js reads this
file and adds a small "6-5 · 215 · Jr." line under any player.html link.
  current players  : players table (height, class_year) + player_wt_2027.json weights (build_player_wt.py)
  everyone else    : their latest player_history row (height, weight, yr)
Output (columnar, ~73 KB gz): {"k": ["ht|wt|cls", ...distinct combos], "d": [espn id deltas, sorted], "v": [combo index]}
Links by ?name= (no espn id) are looked up live by tdc-bio.js. Rerun after roster / history changes (nightly in
rebuild-projections.yml).
"""
import json, re, unicodedata, urllib.request
from pathlib import Path
DATA = Path(__file__).parent / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"; KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"

def sb(path):
    out, off = [], 0
    while True:
        req = urllib.request.Request(f"{SB}/rest/v1/{path}&offset={off}&limit=1000", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
        rows = json.load(urllib.request.urlopen(req)); out += rows; off += 1000
        if len(rows) < 1000: return out

def nk(s):   # must match nk() in tdc-bio.js
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    return re.sub(r"[^a-z]", "", s)

def cls(y):
    y = (y or "").strip().lower().replace("redshirt", "r-").replace(" ", "")
    for k, v in (("gr", "Gr."), ("fr", "Fr."), ("so", "So."), ("jr", "Jr."), ("sr", "Sr.")):
        if k in y: return ("R-" if y.startswith("r") and k != "gr" and not y.startswith(k) else "") + v
    return ""

def ht(h):
    h = (h or "").strip()
    m = re.match(r"^(\d)['\s-]+(\d{1,2})", h)
    return f"{m.group(1)}-{m.group(2)}" if m else ""

def wt(w):
    try: w = int(float(w))
    except (TypeError, ValueError): return ""
    return str(w) if 120 <= w <= 380 else ""

W = json.load(open(DATA / "player_wt_2027.json")); WE = W.get("_e", {})
bio = {}

# history first (latest season wins), then the current roster overrides
latest = {}
for r in sb("player_history?select=espn_id,name,team,season_year,height,weight,yr&espn_id=not.is.null&order=id.asc"):
    e = str(r["espn_id"]); prev = latest.get(e)
    if prev is None or (r.get("season_year") or 0) >= (prev.get("season_year") or 0):
        # keep a known height/weight from an older row if the latest lacks it
        if prev:
            r = dict(r); r["height"] = r.get("height") or prev.get("height"); r["weight"] = r.get("weight") or prev.get("weight")
        latest[e] = r
    elif prev:
        prev["height"] = prev.get("height") or r.get("height"); prev["weight"] = prev.get("weight") or r.get("weight")
for e, r in latest.items():
    bio[e] = [ht(r.get("height")), wt(r.get("weight")), cls(r.get("yr"))]

for i, p in enumerate(sb("players?select=espn_id,name,team,height,weight,class_year&order=id.asc")):
    e = str(p["espn_id"]) if p.get("espn_id") else f"p{i}"
    w = wt(p.get("weight")) or str(W.get(p.get("team"), {}).get(nk(p.get("name")), "") or "") or str(WE.get(e, "") or "") \
        or (bio.get(e, ["", "", ""])[1])
    old = bio.get(e, ["", "", ""])
    bio[e] = [ht(p.get("height")) or old[0], w, cls(p.get("class_year")) or old[2]]

E = {e: "|".join(v) for e, v in bio.items() if any(v) and not e.startswith("p")}
ids = sorted(E, key=int); combos = sorted(set(E.values())); ci = {c: i for i, c in enumerate(combos)}
d, prev = [], 0
for e in ids: d.append(int(e) - prev); prev = int(e)
(DATA / "player_bio.json").write_text(json.dumps({"k": combos, "d": d, "v": [ci[E[e]] for e in ids]}, separators=(",", ":")))
print(f"{len(ids)} players, {len(combos)} distinct bio lines")
