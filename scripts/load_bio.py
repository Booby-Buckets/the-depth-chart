#!/usr/bin/env python3
"""
Load scraped bio (height / weight / headshot) from bio.jsonl into the DB.

Matches each bio record to player_history by normalized name + season (team as a
tiebreaker when a name repeats in one season — player_history team is the mascot-
less prefix of the bio team, e.g. "Abilene Christian" ⊂ "Abilene Christian Wildcats").
Also fills the current `players` roster (weight + photo) from each player's most
recent bio.

Requires these columns (add once in the Supabase SQL editor):
    alter table player_history add column if not exists weight integer;
    alter table player_history add column if not exists photo_url text;
    alter table players        add column if not exists photo_url text;

  python3 load_bio.py            # dry run (coverage stats)
  python3 load_bio.py --write
"""
import os, re, sys, json, time
from pathlib import Path
import requests

DATA = Path(__file__).parent / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def norm(n):
    n = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(n).strip().lower())
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", n)).strip()


def ht_dash(h):
    m = re.match(r"\s*(\d)\D+(\d{1,2})", str(h or ""))
    return f"{m.group(1)}-{m.group(2)}" if m else None


def fetch_all(url):
    url += ("&" if "?" in url else "?") + "order=id"
    rows, pg = [], 0
    while True:
        r = requests.get(url, headers={**H, "Range-Unit": "items", "Range": f"{pg*1000}-{pg*1000+999}"}, timeout=60)
        b = r.json()
        if not isinstance(b, list) or not b:
            break
        rows += b
        if len(b) < 1000:
            break
        pg += 1
    return rows


def load_bio():
    # (norm_name, season) -> list of bio dicts (best data first)
    by_key = {}
    for line in (DATA / "bio.jsonl").read_text().splitlines():
        try:
            b = json.loads(line)
        except Exception:
            continue
        k = (norm(b["name"]), int(b["season"]))
        by_key.setdefault(k, []).append(b)
    # within each key, prefer records that have a headshot, then weight, then height
    for k, v in by_key.items():
        v.sort(key=lambda b: (b.get("hs") is not None, b.get("wt") is not None, b.get("ht") is not None), reverse=True)
    return by_key


def pick(cands, team):
    """Choose the bio whose (mascot) team best matches the DB team (a prefix)."""
    if len(cands) == 1:
        return cands[0]
    tl = (team or "").lower()
    for b in cands:
        if b["team"].lower().startswith(tl) or tl.startswith(b["team"].lower().split()[0]):
            return b
    return cands[0]


def patch(table, payload, write):
    # PostgREST bulk-upsert needs every object in a batch to have the SAME keys,
    # so group by key-set. Grouping also means we never send a null that would
    # wipe existing data (a row only carries the fields bio actually had).
    if not write or not payload:
        return 0
    from collections import defaultdict
    groups = defaultdict(list)
    for row in payload:
        groups[tuple(sorted(row))].append(row)
    ok = 0
    for _, rows in groups.items():
        for j in range(0, len(rows), 500):
            batch = rows[j:j+500]
            r = requests.post(f"{SB}/rest/v1/{table}?on_conflict=id",
                              headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"},
                              json=batch, timeout=60)
            if r.status_code in (200, 201, 204):
                ok += len(batch)
            else:
                print(f"  ERR {table} {r.status_code}: {r.text[:200]}"); return ok
            time.sleep(0.1)
    return ok


def main(write=False):
    by_key = load_bio()
    print(f"bio records: {sum(len(v) for v in by_key.values())} | unique (name,season): {len(by_key)}")

    # ── player_history ──
    hist = fetch_all(f"{SB}/rest/v1/player_history?select=id,name,team,season_year,height")
    pay, n_ht, n_wt, n_hs = [], 0, 0, 0
    for r in hist:
        cands = by_key.get((norm(r["name"]), int(r["season_year"])))
        if not cands:
            continue
        b = pick(cands, r["team"])
        row = {"id": int(r["id"]), "season_year": int(r["season_year"]), "team": r["team"], "name": r["name"]}
        h = ht_dash(b.get("ht"))
        if h: row["height"] = h; n_ht += 1
        if b.get("wt"): row["weight"] = int(round(b["wt"])); n_wt += 1
        if b.get("hs"): row["photo_url"] = b["hs"]; n_hs += 1
        if len(row) > 4:
            pay.append(row)
    print(f"player_history matched {len(pay)} rows  (height {n_ht}, weight {n_wt}, photo {n_hs})")
    print(f"  wrote {patch('player_history', pay, write)}")

    # ── current players (most recent bio per name) ──
    cur = fetch_all(f"{SB}/rest/v1/players?select=id,name,team")
    latest = {}
    for (nm, season), cands in by_key.items():
        if nm not in latest or season > latest[nm][0]:
            latest[nm] = (season, cands)
    cpay, cwt, chs = [], 0, 0
    for r in cur:
        got = latest.get(norm(r["name"]))
        if not got:
            continue
        b = pick(got[1], r["team"])
        row = {"id": int(r["id"]), "name": r["name"]}
        if b.get("wt"): row["weight"] = int(round(b["wt"])); cwt += 1
        if b.get("hs"): row["photo_url"] = b["hs"]; chs += 1
        if len(row) > 2:
            cpay.append(row)
    print(f"players matched {len(cpay)} rows  (weight {cwt}, photo {chs})")
    print(f"  wrote {patch('players', cpay, write)}")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
