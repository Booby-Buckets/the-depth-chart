#!/usr/bin/env python3
"""
Give player_history + players a stable ESPN player id (from box_scores) so the
app can identify a player by id instead of name — no more merging different
people who share a name. Matches by normalized name + season + team.

Requires:
    alter table player_history add column if not exists espn_id bigint;
    alter table players        add column if not exists espn_id bigint;
    create index if not exists ph_espn_idx      on player_history(espn_id);
    create index if not exists players_espn_idx on players(espn_id);

  python3 populate_espn_ids.py            # dry run (match rates)
  python3 populate_espn_ids.py --write
"""
import os, re, sys, json, time
from collections import defaultdict
from pathlib import Path
import requests

DATA = Path(__file__).parent / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def norm(n):
    n = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(n).strip().lower())
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", n)).strip()


def team_match(a, b):
    a, b = (a or "").lower().strip(), (b or "").lower().strip()
    if not a or not b:
        return False
    return a == b or a.startswith(b) or b.startswith(a) or a.split()[:2] == b.split()[:2]


def fetch_all(url):
    rows, pg = [], 0
    while True:
        r = requests.get(url, headers={**H, "Range-Unit": "items", "Range": f"{pg*1000}-{pg*1000+999}"}).json()
        if not isinstance(r, list) or not r:
            break
        rows += r
        if len(r) < 1000:
            break
        pg += 1
    return rows


def build_index():
    # (norm_name, season) -> { espn_id: {team, n} } ;  norm_name -> { espn_id: {teams,last,n} }
    by_ns = defaultdict(lambda: defaultdict(lambda: {"team": None, "n": 0}))
    by_name = defaultdict(lambda: defaultdict(lambda: {"teams": set(), "last": 0, "n": 0}))
    for line in (DATA / "box_scores.jsonl").open():
        try:
            b = json.loads(line)
        except Exception:
            continue
        eid = b.get("espn_id")
        if not eid:
            continue
        nm, se, tm = norm(b["player"]), b["season"], b.get("team") or ""
        d = by_ns[(nm, se)][eid]; d["team"] = tm; d["n"] += 1
        e = by_name[nm][eid]; e["teams"].add(tm); e["last"] = max(e["last"], se); e["n"] += 1
    return by_ns, by_name


def pick(cands, team):
    """cands: {espn_id:{team,n}} for a (name,season). Disambiguate by team, else most games."""
    items = list(cands.items())
    if len(items) == 1:
        return items[0][0]
    tmatch = [(eid, d) for eid, d in items if team_match(d["team"], team)]
    pool = tmatch or items
    return max(pool, key=lambda x: x[1]["n"])[0]


def main(write=False):
    by_ns, by_name = build_index()
    print(f"box index: {len(by_ns):,} (name,season) keys")

    # ── player_history ──
    hist = fetch_all(f"{SB}/rest/v1/player_history?select=id,name,team,season_year")
    pay, matched = [], 0
    for r in hist:
        cands = by_ns.get((norm(r["name"]), int(r["season_year"])))
        if not cands:
            continue
        eid = pick(cands, r["team"])
        pay.append({"id": int(r["id"]), "season_year": int(r["season_year"]), "team": r["team"],
                    "name": r["name"], "espn_id": int(eid)}); matched += 1
    print(f"player_history: matched {matched}/{len(hist)} ({100*matched/len(hist):.0f}%)")

    # ── players (current roster) ──
    cur = fetch_all(f"{SB}/rest/v1/players?select=id,name,team&name=neq.%E2%80%94")
    cpay, cmatched = [], 0
    for r in cur:
        cands = by_name.get(norm(r["name"]))
        if not cands:
            continue
        items = list(cands.items())
        tmatch = [(eid, d) for eid, d in items if any(team_match(t, r["team"]) for t in d["teams"])]
        pool = tmatch or items
        eid = max(pool, key=lambda x: (x[1]["last"], x[1]["n"]))[0]   # most recent, then most games
        if tmatch or len(items) == 1:        # only assign when team matches or unambiguous
            cpay.append({"id": int(r["id"]), "name": r["name"], "espn_id": int(eid)}); cmatched += 1
    print(f"players: matched {cmatched}/{len(cur)} ({100*cmatched/len(cur):.0f}%)")

    if not write:
        print("DRY RUN — pass --write"); return
    for table, payload, conflict in [("player_history", pay, "id"), ("players", cpay, "id")]:
        ok = 0
        for j in range(0, len(payload), 500):
            b = payload[j:j+500]
            r = requests.post(f"{SB}/rest/v1/{table}?on_conflict={conflict}",
                              headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"}, json=b, timeout=90)
            if r.status_code in (200, 201, 204): ok += len(b)
            else: print(f"  ERR {table} {r.status_code}: {r.text[:160]}"); break
            time.sleep(0.05)
        print(f"  {table}: wrote {ok}")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
