#!/usr/bin/env python3
"""Owner-run SQL that repairs specific 2026-27 rosters in Supabase `players`.

    python3 scripts/build_roster_repair_sql.py "St. Thomas" Queens "Idaho State" ...  → scripts/roster_repair_<date>.sql

Two fixes:
  1. REPLACE — a team listed in scripts/data/roster_override_2027.json (an official roster entered by hand
     where the scraper failed) has its current rows deleted and the official roster inserted. Returners are
     linked to their ESPN id at THIS school and ordered by last season's minutes (depth chart).
  2. LINK — every other row with no espn_id is linked when his name matches exactly ONE player_history
     player at THIS school or at the previous school in `hometown` (this site stores a transfer's last
     school there). Name-only national matches are never used (namesakes: Duke's freshman Cameron Williams
     is not Portland's). An id already on another current roster is skipped and listed.
Afterwards: owner console → 🔁 Rebuild projections → ⚡ Republish projected ratings.
"""
import json, re, sys, datetime, urllib.request, urllib.parse, collections
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1"
KEY = re.search(r"sb_publishable_[A-Za-z0-9_-]+", (ROOT / "player.html").read_text()).group(0)
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}


def get(path):
    out, off = [], 0
    while True:
        rows = json.load(urllib.request.urlopen(urllib.request.Request(f"{SB}/{path}&limit=1000&offset={off}", headers=H), timeout=120))
        out += rows
        if len(rows) < 1000: return out
        off += 1000


def q(v):
    if v is None or v == "": return "null"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"


nk = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", (s or "").lower()))
sk = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower().replace("saint", "st").replace("state", "st").replace("university", ""))


def school_match(hist_team, school):
    """does a Sports-Reference school name ('Queens (NC)', 'Mississippi Valley State') denote `school`?"""
    a, b = sk(re.sub(r"\(.*?\)", "", hist_team)), sk(re.sub(r"\(.*?\)", "", school))
    return bool(a) and bool(b) and (a == b or a.startswith(b) or b.startswith(a))


def main():
    teams = [a for a in sys.argv[1:] if not a.startswith("-")]
    over = json.load(open(ROOT / "scripts/data/roster_override_2027.json"))["teams"]
    hist = get("player_history?select=espn_id,name,team,season_year,mpg,gp&season_year=gte.2022&espn_id=not.is.null&order=espn_id.asc,season_year.asc")
    by_name = collections.defaultdict(list)
    for h in hist: by_name[nk(h["name"])].append(h)
    taken = {}
    for r in get("players?select=id,name,team,espn_id&espn_id=not.is.null&order=id.asc"): taken[str(r["espn_id"])] = r
    out, notes, day = [], [], datetime.date.today().isoformat()

    def link(name, schools, team):
        """unique espn id for `name` at any of `schools`, else None"""
        c = {h["espn_id"] for h in by_name.get(nk(name), []) if any(school_match(h["team"], s) for s in schools if s)}
        if len(c) != 1: return None, len(c)
        e = str(c.pop()); t = taken.get(e)
        if t and not (t["team"] == team and nk(t["name"]) == nk(name)):
            notes.append(f"--   {name} ({team}): ESPN {e} is on {t['name']} / {t['team']} — left unlinked"); return None, 0
        return int(e), 1

    for team in teams:
        cur = get(f"players?select=id,name,team,espn_id,hometown,yr,class_year&team=eq.{urllib.parse.quote(team)}&order=id.asc")
        if team in over:
            roster = over[team]
            rows, ret = [], []
            for p in roster:
                e, _ = link(p["name"], [team], team)
                last = [h for h in by_name.get(nk(p["name"]), []) if e and h["espn_id"] == e]
                lm = max([float(h.get("mpg") or 0) for h in last if h["season_year"] >= 2025] or [0])
                ret.append((p, e, lm))
            ret.sort(key=lambda x: (-x[2], x[0]["name"]))
            for i, (p, e, lm) in enumerate(ret, 1):
                rows.append("  (" + ", ".join([q(p["name"]), q(team), q(p["pos"]), q(p["yr"]), q(p["yr"]), q(p["ht"]), "null",
                                               q(e), q(i), q(i <= 5), q(e is None), "false", "false"]) + ")")
            linked = sum(1 for _, e, _ in ret if e)
            out.append(f"-- {team}: the {len(cur)} rows on file are NOT this school's roster (none match its 2025-26 players);\n"
                       f"-- replace them with the official 2026-27 roster ({len(ret)} players, {linked} linked to their stats).")
            keep = {nk(p["name"]) for p in roster}
            gone = [r["name"] for r in cur if nk(r["name"]) not in keep]
            if gone:
                out.append(f"delete from players where team = {q(team)} and name in ({', '.join(q(n) for n in gone)});")
            out.append("insert into players (name, team, position, class_year, yr, height, hometown,\n"
                       "  espn_id, depth_order, starter, is_addition, is_international, is_injured)\n"
                       "select v.name, v.team, v.position, v.class_year, v.yr, v.height, v.hometown::text,\n"
                       "  v.espn_id::bigint, v.depth_order, v.starter, v.is_addition, v.is_international, v.is_injured from (values\n" + ",\n".join(rows) +
                       "\n) as v(name, team, position, class_year, yr, height,\n  hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)\n"
                       "where not exists (select 1 from players p where p.name = v.name and p.team = v.team);")
            for p, e, lm in ret:   # an existing official-roster row still missing its id
                if e: out.append(f"update players set espn_id = {e} where team = {q(team)} and name = {q(p['name'])} and espn_id is null;")
            continue
        ups = []
        for r in cur:
            if r.get("espn_id") or not (r.get("name") or "").strip() or r["name"].strip() in ("—", "-"): continue
            prev = [s.strip() for s in re.split(r"[/,]", r.get("hometown") or "") if s.strip()]
            e, n = link(r["name"], [team] + prev, team)
            if e: ups.append((r, e, prev))
        out.append(f"-- {team}: {len(ups)} of {sum(1 for r in cur if not r.get('espn_id'))} unlinked players have D-I history at this school or their listed previous school")
        for r, e, prev in ups:
            out.append(f"update players set espn_id = {e} where id = {r['id']} and espn_id is null;   -- {r['name']}" + (f" (from {', '.join(prev)})" if prev else " (returner)"))
    head = [f"-- Roster repair for {', '.join(teams)} ({day}). Generated by scripts/build_roster_repair_sql.py.",
            "-- Run in the Supabase SQL editor. Then owner console: 🔁 Rebuild projections → ⚡ Republish projected ratings."]
    if notes: head += ["--", "-- Notes:"] + notes
    path = ROOT / "scripts" / f"roster_repair_{day}.sql"
    path.write_text("\n".join(head) + "\n\n" + "\n".join(out) + "\n")
    print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
