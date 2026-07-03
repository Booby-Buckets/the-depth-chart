#!/usr/bin/env python3
"""Backfill players.espn_id from player_history when a resync drops them.

A stats resync can rebuild `players` without espn_id, which silently kills
career history, game logs and bbref-advanced joins site-wide. player_history
still holds (name, team) -> espn_id; restore any player whose match is
UNAMBIGUOUS (exactly one distinct espn_id for that name+team, falling back to
name-only when unique). Uses the service key. Re-runnable.
"""
import json, urllib.request, urllib.parse, collections

SB_URL = "https://izlqhnxowdhtdofkwrho.supabase.co"
import os
def _service_key():
    # never committed: env var first, else the untracked local pipeline config
    k = os.environ.get("SUPABASE_SERVICE_KEY")
    if k: return k
    try:
        import importlib.util, pathlib
        p = pathlib.Path(__file__).parent / "load_supabase.py"
        spec = importlib.util.spec_from_file_location("_ls", p)
        m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
        return m.SB_KEY
    except Exception:
        raise SystemExit("Set SUPABASE_SERVICE_KEY (service key) to run this script.")
SB_KEY = _service_key()
H = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json"}

def req(method, path, body=None):
    r = urllib.request.Request(SB_URL + path, headers={**H, "Prefer": "return=minimal"},
                               data=json.dumps(body).encode() if body is not None else None, method=method)
    with urllib.request.urlopen(r, timeout=60) as resp:
        return resp.status

def fetch_all(path, page=1000):
    out, off = [], 0
    while True:
        r = urllib.request.Request(f"{SB_URL}{path}", headers={**H, "Range-Unit": "items", "Range": f"{off}-{off+page-1}"})
        with urllib.request.urlopen(r, timeout=60) as resp:
            batch = json.load(resp)
        out += batch
        if len(batch) < page: break
        off += page
    return out

def main():
    players = fetch_all("/rest/v1/players?espn_id=is.null&select=id,name,team&order=id.asc")
    print(f"players missing espn_id: {len(players)}")
    if not players: return
    hist = fetch_all("/rest/v1/player_history?espn_id=not.is.null&select=name,team,espn_id&order=id.asc")
    by_nt, by_n = collections.defaultdict(set), collections.defaultdict(set)
    for h in hist:
        k = (h["name"].strip().lower(), (h["team"] or "").strip().lower())
        by_nt[k].add(h["espn_id"]); by_n[k[0]].add(h["espn_id"])
    fixed = ambiguous = missing = 0
    for p in players:
        nk = p["name"].strip().lower()
        ids = by_nt.get((nk, (p["team"] or "").strip().lower())) or by_n.get(nk) or set()
        if len(ids) == 1:
            req("PATCH", f"/rest/v1/players?id=eq.{p['id']}", {"espn_id": next(iter(ids))})
            fixed += 1
            if fixed % 100 == 0: print(f"  {fixed} patched…", flush=True)
        elif len(ids) > 1: ambiguous += 1
        else: missing += 1
    print(f"done: {fixed} restored, {ambiguous} ambiguous (skipped), {missing} not in history (freshmen etc.)")

if __name__ == "__main__":
    main()
