#!/usr/bin/env python3
"""
Link bbref_seasons to the ESPN player identity and carry grades over.
Run schema_bbref_link.sql first (adds espn_id + tdc_grade columns).

For each bbref player-season: find the espn_id from box_scores by
normalized name + season + team (BBRef school is a prefix of the ESPN
mascot), then copy that player-season's tdc_grade from player_history.

  python3 reconcile_bbref.py            # dry run (match rates)
  python3 reconcile_bbref.py --write
"""
import os, re, sys, json, time
from collections import defaultdict
from pathlib import Path
import requests

DATA = Path(__file__).parent / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
def _key():
    k = os.environ.get("SUPABASE_SERVICE_KEY")
    if k: return k
    m = re.search(r'SB_KEY\s*=\s*"([^"]+)"', (Path(__file__).parent/"load_supabase.py").read_text())
    return m.group(1)
KEY = _key()
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def norm(n):
    n = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(n).strip().lower())
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", n)).strip()


def team_match(a, b):
    a, b = (a or "").lower().strip(), (b or "").lower().strip()
    if not a or not b: return False
    return a == b or a.startswith(b) or b.startswith(a) or a.split()[:2] == b.split()[:2]


def fetch_all(url):
    # Offset tracks rows actually received (resilient to short pages); retry transient errors;
    # stop only on a genuinely empty page so we never end pagination early.
    rows = []
    while True:
        start = len(rows)
        data = None
        for _ in range(5):
            try:
                d = requests.get(url, headers={**H, "Range-Unit": "items", "Range": f"{start}-{start+999}"}, timeout=60).json()
            except Exception:
                d = None
            if isinstance(d, list):
                data = d; break
            time.sleep(2)
        if not data:
            break
        rows += data
    return rows


def build_box_index():
    # (norm_name, season) -> { espn_id: {team, n} }
    by_ns = defaultdict(lambda: defaultdict(lambda: {"team": None, "n": 0}))
    for line in (DATA / "box_scores.jsonl").open():
        try: b = json.loads(line)
        except Exception: continue
        eid = b.get("espn_id")
        if not eid: continue
        d = by_ns[(norm(b["player"]), b["season"])][eid]
        d["team"] = b.get("team") or ""; d["n"] += 1
    return by_ns


def pick(cands, team):
    items = list(cands.items())
    if len(items) == 1: return items[0][0]
    tmatch = [(eid, d) for eid, d in items if team_match(d["team"], team)]
    pool = tmatch or items
    return max(pool, key=lambda x: x[1]["n"])[0]


def main(write=False):
    by_ns = build_box_index()
    print(f"box index: {len(by_ns):,} (name,season) keys")

    # grades from player_history keyed by (espn_id, season)
    grade_by = {}
    for r in fetch_all(f"{SB}/rest/v1/player_history?select=id,espn_id,season_year,tdc_grade&espn_id=not.is.null&order=id"):
        try: g = float(r.get("tdc_grade"))
        except (TypeError, ValueError): continue
        grade_by[(int(r["espn_id"]), int(r["season_year"]))] = g
    print(f"player_history grades: {len(grade_by):,}")

    bb = fetch_all(f"{SB}/rest/v1/bbref_seasons?select=bbref_id,season_year,school_slug,player,school&order=bbref_id,season_year,school_slug")
    pay, matched, graded = [], 0, 0
    for r in bb:
        cands = by_ns.get((norm(r["player"] or ""), int(r["season_year"])))
        eid = pick(cands, r["school"]) if cands else None
        grade = grade_by.get((int(eid), int(r["season_year"]))) if eid else None
        if eid: matched += 1
        if grade is not None: graded += 1
        if eid or grade is not None:
            pay.append({"bbref_id": r["bbref_id"], "season_year": r["season_year"],
                        "school_slug": r["school_slug"],
                        "espn_id": int(eid) if eid else None, "tdc_grade": grade})
    print(f"bbref_seasons: {len(bb):,} rows | matched espn_id {matched:,} ({100*matched/len(bb):.0f}%) | grade carried {graded:,} ({100*graded/len(bb):.0f}%)")

    if not write:
        print("DRY RUN — pass --write"); return
    ok, fail = 0, 0
    for j in range(0, len(pay), 500):
        b = pay[j:j+500]
        done = False
        for _ in range(4):                       # retry transient errors, don't abandon later batches
            try:
                r = requests.post(f"{SB}/rest/v1/bbref_seasons?on_conflict=bbref_id,season_year,school_slug",
                                  headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"}, json=b, timeout=90)
            except Exception:
                time.sleep(3); continue
            if r.status_code in (200, 201, 204): ok += len(b); done = True; break
            time.sleep(3)
        if not done:
            fail += len(b); print(f"  batch {j} failed: {r.status_code} {r.text[:150]}")
        time.sleep(0.04)
    print(f"  wrote {ok}  (failed {fail})")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
