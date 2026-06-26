#!/usr/bin/env python3
"""
Repair abbreviated 2022-23 names ("K. Davis" -> "Kendric Davis").

The 2022-23 scrape (season_year 2023) stored first names as initials for ~4,680
players, so those seasons don't link to a player's other (full-name) seasons —
e.g. Kendric Davis's Memphis POY year was orphaned as "K. Davis".

Fix: the bio scrape (bio.jsonl) has full ESPN names per team-season. For each
abbreviated 2023 row, find the bio full name on the SAME team+2023 whose last
name matches and whose first initial matches. Update only on a unique match.

Run AFTER the bio scrape covers 2023 for every team.

  python3 repair_names.py            # dry run
  python3 repair_names.py --write
"""
import os, re, sys, json, time
from collections import defaultdict
from pathlib import Path
import requests

DATA = Path(__file__).parent / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
ABBR = re.compile(r"^([A-Z])\.\s+(.+)$")


def nteam(t): return re.sub(r"[^a-z0-9]", "", str(t or "").lower())


def team_match(a, b):
    a, b = nteam(a), nteam(b)
    return bool(a) and bool(b) and (a == b or a.startswith(b) or b.startswith(a))


def fetch_all(url):
    url += ("&" if "?" in url else "?") + "order=id"
    rows, pg = [], 0
    while True:
        r = requests.get(url, headers={**H, "Range-Unit": "items", "Range": f"{pg*1000}-{pg*1000+999}"}, timeout=60).json()
        if not isinstance(r, list) or not r:
            break
        rows += r
        if len(r) < 1000:
            break
        pg += 1
    return rows


def main(write=False):
    # bio full names for 2023, grouped by team
    bio = defaultdict(list)
    for line in (DATA / "bio.jsonl").read_text().splitlines():
        try:
            b = json.loads(line)
        except Exception:
            continue
        if int(b.get("season", 0)) == 2023 and b.get("name"):
            bio[nteam(b["team"])].append((b["team"], b["name"]))
    print(f"bio 2023 teams: {len(bio)}")

    rows = fetch_all(f"{SB}/rest/v1/player_history?select=id,name,team&season_year=eq.2023")
    abbr = [r for r in rows if ABBR.match(str(r["name"]))]
    print(f"2023 rows: {len(rows)} | abbreviated: {len(abbr)}")

    fixes, ambiguous, nomatch = [], 0, 0
    for r in abbr:
        m = ABBR.match(r["name"]); init, last = m.group(1).upper(), m.group(2).strip().lower()
        cands = set()
        # gather bio names from any team key that matches this row's team
        for key, lst in bio.items():
            if not team_match(r["team"], key):
                continue
            for _, full in lst:
                parts = full.split()
                if parts and parts[0][:1].upper() == init and full.lower().endswith(last):
                    cands.add(full)
        cands = list(cands)
        if len(cands) == 1 and cands[0].lower() != r["name"].lower():
            fixes.append({"id": int(r["id"]), "name": cands[0], "season_year": 2023, "team": r["team"]})
        elif len(cands) > 1:
            ambiguous += 1
        else:
            nomatch += 1
    print(f"unique fixes: {len(fixes)} | ambiguous: {ambiguous} | no bio match: {nomatch}")
    print("samples:", [(r["id"], f["name"]) for r, f in list(zip(abbr, fixes))[:6]] if fixes else "—")
    for f in fixes[:8]:
        print("   ->", f["name"])

    if not write:
        print("\nDRY RUN — pass --write"); return
    ok = dup = err = 0
    for i, f in enumerate(fixes):
        sc = None
        for attempt in range(4):
            try:
                sc = requests.patch(f"{SB}/rest/v1/player_history?id=eq.{f['id']}",
                                    headers={**H, "Prefer": "return=minimal"},
                                    json={"name": f["name"]}, timeout=60).status_code
                break
            except Exception:
                time.sleep(1 + 2*attempt)
        if sc in (200, 204):
            ok += 1
        elif sc == 409:                             # full-name row already exists; leave abbreviated as-is
            dup += 1
        else:
            err += 1
        if (i+1) % 300 == 0:
            print(f"  {i+1}/{len(fixes)} (ok {ok}, dup {dup}, err {err})", flush=True)
    print(f"repaired {ok} names, skipped {dup} duplicates, {err} errors")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
