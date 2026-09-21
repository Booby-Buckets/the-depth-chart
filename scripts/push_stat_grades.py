#!/usr/bin/env python3
"""Push the statistical overall (stat_overall_history.csv, from build_stat_overall.py) into the
DB grade columns the OFF-SITE pipelines read — bbref_seasons.tdc_grade and player_history.tdc_grade
(coach pages / rundowns / coach grades, development curves). The site itself reads the JSON files
directly, so this only matters for consistency of those DB-fed builds.

Deliberately does NOT touch players.tdc_grade (the roster sheet's hand grades — the user's backbone).

  SUPABASE_SERVICE_KEY=... python3 scripts/push_stat_grades.py [--dry-run] [--since 2012]
"""
import os, sys, csv, json, time, collections, urllib.request

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DRY = "--dry-run" in sys.argv
SINCE = int(sys.argv[sys.argv.index("--since") + 1]) if "--since" in sys.argv else 2007

def _key():
    k = os.environ.get("SUPABASE_SERVICE_KEY")
    if k: return k
    raise SystemExit("Set SUPABASE_SERVICE_KEY (service key) to run this script.")
KEY = _key(); H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json", "Prefer": "return=minimal"}

def fetch(path):
    out, off = [], 0
    while True:
        r = urllib.request.Request(f"{SB}{path}&limit=1000&offset={off}", headers=H)
        with urllib.request.urlopen(r, timeout=90) as resp: b = json.load(resp)
        out += b
        if len(b) < 1000: return out
        off += 1000

def patch(path, body):
    if DRY: return True
    for _ in range(4):
        try:
            r = urllib.request.Request(f"{SB}{path}", headers=H, data=json.dumps(body).encode(), method="PATCH")
            with urllib.request.urlopen(r, timeout=90) as resp: return resp.status in (200, 204)
        except Exception:
            time.sleep(3)
    return False

# stat overall by (espn, season)
grade = {}
with open(os.path.join(D, "stat_overall_history.csv")) as f:
    for r in csv.DictReader(f):
        yr = int(r["season_year"])
        if yr >= SINCE: grade[(int(r["espn_id"]), yr)] = int(round(float(r["ovr"])))
years = sorted({yr for (_, yr) in grade})
print(f"stat overall: {len(grade):,} player-seasons, {years[0]}–{years[-1]}{' (dry run)' if DRY else ''}")

tot_bb = tot_ph = 0
for yr in years:
    # bbref_seasons: keyed by (espn_id, season_year)
    rows = fetch(f"/rest/v1/bbref_seasons?select=espn_id,tdc_grade&season_year=eq.{yr}&espn_id=not.is.null&order=espn_id.asc")
    by_g = collections.defaultdict(list)
    for r in rows:
        g = grade.get((int(r["espn_id"]), yr))
        if g is None: continue
        cur = r.get("tdc_grade")
        if cur is not None and int(cur) == g: continue
        by_g[g].append(int(r["espn_id"]))
    n = 0
    for g, ids in by_g.items():
        for i in range(0, len(ids), 250):
            ch = ids[i:i + 250]
            if patch(f"/rest/v1/bbref_seasons?season_year=eq.{yr}&espn_id=in.({','.join(map(str, ch))})", {"tdc_grade": str(g)}): n += len(ch)
    # player_history: has its own id
    rows = fetch(f"/rest/v1/player_history?select=id,espn_id,tdc_grade&season_year=eq.{yr}&espn_id=not.is.null&order=id.asc")
    by_g = collections.defaultdict(list)
    for r in rows:
        g = grade.get((int(r["espn_id"]), yr))
        if g is None: continue
        cur = r.get("tdc_grade")
        if cur is not None and str(cur).strip() and int(float(cur)) == g: continue
        by_g[g].append(int(r["id"]))
    m = 0
    for g, ids in by_g.items():
        for i in range(0, len(ids), 300):
            ch = ids[i:i + 300]
            if patch(f"/rest/v1/player_history?id=in.({','.join(map(str, ch))})", {"tdc_grade": str(g)}): m += len(ch)
    tot_bb += n; tot_ph += m
    print(f"  {yr}: bbref_seasons {n} updated · player_history {m} updated", flush=True)
print(f"done: bbref_seasons {tot_bb:,} · player_history {tot_ph:,}")
