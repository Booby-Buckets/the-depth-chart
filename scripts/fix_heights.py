#!/usr/bin/env python3
"""
Recover player_history heights mangled by a Google-Sheets date bug:
"6-9" was parsed as a date and stored as "Wed Jun 09 2026 00:00:00 GMT...".
Month = feet, day = inches, so "Jun 09" -> "6-9". Unrecoverable values are
nulled so they render as "—" instead of a giant string that breaks layout.

  python3 fix_heights.py            # dry run
  python3 fix_heights.py --write
"""
import os, re, sys, time
from collections import defaultdict
import requests

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
MONTHS = {m: i for i, m in enumerate(
    ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"], 1)}
VALID = re.compile(r"^\d-\d{1,2}$")
DATEPAT = re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b")


def recover(h):
    if not h:
        return None
    h = str(h).strip()
    if VALID.match(h):
        return h
    m = DATEPAT.search(h)
    if m:
        feet, inches = MONTHS[m.group(1)], int(m.group(2))
        if 4 <= feet <= 7 and 0 <= inches <= 11:
            return f"{feet}-{inches}"
    return None  # unrecoverable -> null it


def fetch_corrupted():
    rows, pg, PG = [], 0, 1000
    url = f"{SB}/rest/v1/player_history?select=id,height&height=like.*GMT*"
    while True:
        r = requests.get(url, headers={**H, "Range-Unit": "items",
                         "Range": f"{pg*PG}-{pg*PG+PG-1}"}, timeout=60)
        b = r.json()
        if not isinstance(b, list) or not b:
            break
        rows.extend(b);
        if len(b) < PG: break
        pg += 1
    return rows


def main(write=False):
    rows = fetch_corrupted()
    by_val = defaultdict(list)   # recovered height -> [ids]
    nulls = []
    for r in rows:
        fixed = recover(r["height"])
        (by_val[fixed] if fixed else nulls).append(int(r["id"]))
    recovered = sum(len(v) for v in by_val.values())
    print(f"corrupted rows: {len(rows)} | recovered: {recovered} | unrecoverable(null): {len(nulls)}")
    print("recovered height distribution:",
          {k: len(v) for k, v in sorted(by_val.items())})
    if not write:
        print("\nDRY RUN — pass --write"); return

    def patch(ids, payload):
        done = 0
        for i in range(0, len(ids), 200):
            chunk = ids[i:i+200]
            idlist = ",".join(map(str, chunk))
            r = requests.patch(f"{SB}/rest/v1/player_history?id=in.({idlist})",
                               headers={**H, "Prefer": "return=minimal"},
                               json=payload, timeout=60)
            if r.status_code in (200, 204): done += len(chunk)
            else: print(f"  ERROR {r.status_code}: {r.text[:160]}")
            time.sleep(0.05)
        return done

    total = 0
    for hv, ids in by_val.items():
        total += patch(ids, {"height": hv})
    if nulls:
        total += patch(nulls, {"height": None})
    print(f"updated {total} rows")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
