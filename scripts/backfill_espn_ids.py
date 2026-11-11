#!/usr/bin/env python3
"""Backfill players.espn_id from player_history when a resync drops them (or the sheet misspells a name).

A stats resync can rebuild `players` without espn_id, which silently kills
career history, game logs and bbref-advanced joins site-wide. player_history
still holds (name, team) -> espn_id; restore any player whose match is
UNAMBIGUOUS (exactly one distinct espn_id for that name+team, falling back to
name-only when unique), then a strict TYPO tier for the rest (prior school + name
similarity + the sheet's autofilled ppg/mpg agreeing with the history line).
Uses the service key. Re-runnable. `--dry-run` prints what it would link.
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

import re, difflib, sys
DRY = "--dry-run" in sys.argv
# The sheet is typed by hand: "Scharniwski" for Scharnowski, "Machowksi", "Westrey", "Royale", and
# Roman numerals typed as lowercase L's ("Roddie Anderson lll"). Normalise both sides the same way.
def norm(n):
    n = re.sub(r"\s*\(.*?\)\s*", " ", n or "")            # "(24-25)" markers
    n = re.sub(r"[*+]", "", n).lower()
    n = re.sub(r"\b(l{2,3}|ii|iii|iv|jr|sr)\.?\b", lambda m: {"ll":"ii","lll":"iii"}.get(m.group(1), m.group(1)), n)
    n = re.sub(r"[^a-z ]", "", n)
    return re.sub(r"\s+", " ", n).strip()
def _num(v):
    try: return float(v)
    except (TypeError, ValueError): return None

def main():
    players = fetch_all("/rest/v1/players?espn_id=is.null&select=id,name,team,yr,hometown,ppg,mpg&order=id.asc")
    print(f"players missing espn_id: {len(players)}")
    if not players: return
    hist = fetch_all("/rest/v1/player_history?espn_id=not.is.null&select=name,team,espn_id,season_year,ppg,mpg&order=id.asc")
    by_nt, by_n = collections.defaultdict(set), collections.defaultdict(set)
    for h in hist:
        k = (norm(h["name"]), (h["team"] or "").strip().lower())
        by_nt[k].add(h["espn_id"]); by_n[k[0]].add(h["espn_id"])
    latest = [h for h in hist if h.get("season_year") == max(x.get("season_year") or 0 for x in hist)]
    by_team_latest = collections.defaultdict(list)
    for h in latest: by_team_latest[(h["team"] or "").strip().lower()].append(h)
    fixed = fuzzy = ambiguous = missing = 0; report = []
    for p in players:
        nk = norm(p["name"])
        ids = by_nt.get((nk, (p["team"] or "").strip().lower())) or by_n.get(nk) or set()
        if len(ids) == 1:
            if not DRY: req("PATCH", f"/rest/v1/players?id=eq.{p['id']}", {"espn_id": next(iter(ids))})
            fixed += 1
            if fixed % 100 == 0: print(f"  {fixed} patched…", flush=True)
            continue
        if len(ids) > 1: ambiguous += 1; continue
        # FUZZY tier (typos): last completed season only, prior school from the From column when
        # known, name similarity >= .84, and the sheet's autofilled ppg/mpg must agree with the
        # history line (they were copied from it) — that agreement is what makes a typo match safe.
        if (p.get("yr") or "").lower().startswith(("fr", "r-fr")): missing += 1; continue
        src = re.sub(r"\s*\(.*?\)\s*", "", p.get("hometown") or "").strip().lower()
        cands = by_team_latest.get(src) if src else None
        if not cands: cands = [h for h in latest if norm(h["name"]).split(" ")[-1:] == nk.split(" ")[-1:]]
        best, bs, second = None, 0.0, 0.0
        for h in cands or []:
            r = difflib.SequenceMatcher(None, nk, norm(h["name"])).ratio()
            if r > bs: second = bs; bs = r; best = h
            elif r > second: second = r
        sp, sm = _num(p.get("ppg")), _num(p.get("mpg"))
        stats_ok = (sp is not None and _num(best and best.get("ppg")) is not None and abs(sp - _num(best["ppg"])) < 0.06) or \
                   (sm is not None and _num(best and best.get("mpg")) is not None and abs(sm - _num(best["mpg"])) < 0.06)
        if best and bs >= 0.84 and bs - second >= 0.05 and stats_ok:
            if not DRY: req("PATCH", f"/rest/v1/players?id=eq.{p['id']}", {"espn_id": best["espn_id"]})
            fuzzy += 1; report.append(f"  linked  {p['team']:16s} {p['name']:26s} -> {best['name']} ({best['team']}, espn {best['espn_id']}) [{bs:.2f}]")
        else:
            missing += 1
            if best and bs >= 0.7: report.append(f"  CHECK   {p['team']:16s} {p['name']:26s} ?  {best['name']} ({best['team']}) [{bs:.2f}{'' if stats_ok else ', stats differ'}] — fix the sheet spelling if this is him")
    print("\n".join(report))
    print(f"done{' (dry run)' if DRY else ''}: {fixed} exact, {fuzzy} typo-matched, {ambiguous} ambiguous (skipped), {missing} not in history (freshmen / unresolved)")
    box_tier()

# CURRENT-SEASON tier: freshmen (and anyone else) not in player_history yet but already playing.
# box_scores carries ESPN's athlete id for every 2026-27 game; without it the player page shows no
# "so far" row, no game logs and no headshot (Saliou Niang, LSU, Nov 2026 — 1,760 such players).
# The sheet team ("LSU") is mapped to its ESPN name ("LSU Tigers") from the data itself: the ESPN
# team that most unique-name matches land on. The match must hit that exact team (so "LSU" never
# grabs an LSU New Orleans namesake) and resolve to exactly one id that no other player holds.
CUR_SEASON = 2027
import unicodedata
def bnorm(n):   # accents off ("Jokūbas" -> jokubas), nicknames in quotes off, suffixes off ("Jr."/"II"/"lll")
    n = unicodedata.normalize("NFKD", n or "").encode("ascii", "ignore").decode()
    n = re.sub(r'"[^"]*"', " ", n)
    n = norm(n)
    return re.sub(r"\s+", " ", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", n)).strip()
def _prefix_match(a, b):
    # same last name, one first name a prefix of the other ("alex ensor"/"alexander ensor"),
    # or one full name a leading part of the other ("mike montano"/"mike montanobest", "joao panzo"/"joao pedro panzo")
    ta, tb = a.split(), b.split()
    if not ta or not tb: return False
    if ta[-1] == tb[-1] and (ta[0].startswith(tb[0]) or tb[0].startswith(ta[0])) and min(len(ta[0]), len(tb[0])) >= 3: return True
    if ta[0] == tb[0] and (ta[-1].startswith(tb[-1]) or tb[-1].startswith(ta[-1])) and min(len(ta[-1]), len(tb[-1])) >= 4: return True
    return False
def box_tier():
    players = fetch_all("/rest/v1/players?espn_id=is.null&select=id,name,team&order=id.asc")
    if not players: return
    linked_rows = fetch_all("/rest/v1/players?espn_id=not.is.null&select=team,espn_id&order=id.asc")
    taken = {r["espn_id"] for r in linked_rows}
    box = fetch_all(f"/rest/v1/box_scores?season_year=eq.{CUR_SEASON}&espn_id=not.is.null&select=espn_id,player,team&order=game_id.asc,espn_id.asc")
    eteam = {b["espn_id"]: b["team"] for b in box}
    # sheet team ("LSU") -> ESPN team ("LSU Tigers"): where that team's already-linked players play
    votes = collections.defaultdict(collections.Counter)
    for r in linked_rows:
        if r["espn_id"] in eteam: votes[r["team"]][eteam[r["espn_id"]]] += 1
    full = {k: v.most_common(1)[0][0] for k, v in votes.items() if v.most_common(1)[0][1] >= 2}
    pool = collections.defaultdict(dict)                      # ESPN team -> {espn_id: name} not yet on anyone
    for b in box:
        if b["espn_id"] not in taken: pool[b["team"]][b["espn_id"]] = bnorm(b["player"])
    linked = fuzzy = skipped = 0; report = []
    for p in players:
        cands = pool.get(full.get(p["team"]), {})
        nk = bnorm(p["name"])
        exact = [e for e, n in cands.items() if n == nk]
        if len(exact) > 1: skipped += 1; continue
        e = exact[0] if exact else None
        if e is None and cands:
            sc = sorted(((difflib.SequenceMatcher(None, nk, n).ratio(), e2) for e2, n in cands.items()), reverse=True)
            r1, e1 = sc[0]; r2 = sc[1][0] if len(sc) > 1 else 0
            pre = [e2 for e2, n in cands.items() if _prefix_match(nk, n)]
            if r1 >= 0.88 and r1 - r2 >= 0.2: e = e1                        # typo ("Sebatian" / "Gihool")
            elif len(pre) == 1: e = pre[0]                                   # short/long form of the same name
            if e is not None: fuzzy += 1; report.append(f"  ~ {p['team']:22s} {p['name']:28s} -> {cands[e]} ({e})")
        if e is None: continue
        if not DRY: req("PATCH", f"/rest/v1/players?id=eq.{p['id']}", {"espn_id": e})
        cands.pop(e, None); taken.add(e); linked += 1
    print("\n".join(report))
    print(f"box tier{' (dry run)' if DRY else ''}: {linked} linked from {CUR_SEASON} box scores ({fuzzy} by spelling), {skipped} ambiguous skipped")

if __name__ == "__main__":
    main()
