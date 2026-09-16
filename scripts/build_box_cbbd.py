#!/usr/bin/env python3
"""Fill the box-score holes ESPN left, from collegebasketballdata.com player box scores.

ESPN's historical box scores carry BLANK athletes (no id, flagged DNP) for some players —
whole player-seasons vanish (Jamarius Burton, Pitt 2022-23; McKinley Wright IV, Tyler Bey and
Evan Battey, Colorado 2019-20). audit_box_coverage.py found 138 rotation player-seasons with
no box rows at all across 2019-20 → 2024-25, plus 20 players whose CBBD id differs from ours.

  CBBD_KEY=... python3 scripts/build_box_cbbd.py pull 2023        # /games/players by date window (cached)
  python3 scripts/build_box_cbbd.py diff 2023                     # rows missing from our box_scores → data/box_fill_2023.json
  python3 scripts/build_box_cbbd.py history 2023                  # season lines for those players → data/history_fill_2023.json
  SUPABASE_SERVICE_KEY=... python3 scripts/build_box_cbbd.py upload 2023   # owner: insert both + repoint shots ids

diff also writes data/box_fill_remap_2023.json (CBBD id → our id for same-name players) and the
SQL to repoint their `shots` rows. Quota: ~10-14 calls per season.
"""
import json, os, re, sys, time, datetime as dt, urllib.request, urllib.parse, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_shots_cbbd as B

D = os.path.join(B.HERE, "data")
H = {"apikey": B.ANON, "Authorization": "Bearer " + B.ANON}

def norm(s):
    import unicodedata
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[.'’]", "", s.lower()); s = re.sub(r"\b(jr|sr|iii|ii|iv|v)\b", "", s)
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()

def sb(path):
    out, off = [], 0
    while True:
        req = urllib.request.Request(B.SB + "/rest/v1/" + path + "&limit=1000&offset=%d" % off, headers=H)
        rows = json.load(urllib.request.urlopen(req, timeout=120)); out += rows
        if len(rows) < 1000: return out
        off += 1000

# ── pull ──────────────────────────────────────────────────────────────────
def pull(season, key):
    dates = B.season_dates(season)
    d0, d1 = dt.date.fromisoformat(dates[0]) - dt.timedelta(days=1), dt.date.fromisoformat(dates[-1])
    calls = 0
    def window(a, b):
        nonlocal calls
        name = "box_%d_%s_%s" % (season, a, b)
        v = B.cget(name)
        if v is None:
            v, rem = B.api("/games/players", key, season=season, startDateRange=a.isoformat() + "T00:00:00Z",
                           endDateRange=b.isoformat() + "T23:59:59Z")
            calls += 1
            ng = len({x.get("gameId") for x in v})           # two team blocks per game
            if ng >= 1000 and (b - a).days >= 1:              # capped: split and try again
                m = a + (b - a) // 2
                print("  %s → %s hit the 1000-game cap, splitting" % (a, b), flush=True)
                return window(a, m) + window(m + dt.timedelta(days=1), b)
            B.cput(name, v)
            print("  %s → %s: %d games (%s calls left)" % (a, b, ng, rem), flush=True)
            time.sleep(0.5)
        return v
    games = []
    a = d0
    while a <= d1:
        b = min(a + dt.timedelta(days=13), d1)
        games += window(a, b); a = b + dt.timedelta(days=1)
    print("== %d: %d game-team blocks, %d API calls" % (season, len(games), calls))

def season_blocks(season):
    out = []
    for f in sorted(os.listdir(B.CACHE)):
        if f.startswith("box_%d_" % season): out += B.cget(f[:-8])
    return out

# ── diff ──────────────────────────────────────────────────────────────────
def diff(season):
    blocks = season_blocks(season)
    ours = {g["id"]: g for g in sb("games?season_year=eq.%d&select=id,date,home,away&order=id" % season)}
    d1 = {t["team"] for t in sb("team_seasons?season_year=eq.%d&select=team&order=team_id" % season)}   # D-I only
    # the box blocks carry only CBBD game ids; the cached plays map them to ESPN ids
    g2e = {}
    for p in B.season_plays(season):
        if p.get("gameId") not in g2e: g2e[p["gameId"]] = B.to_int(p.get("gameSourceId"))
    by_game = {}
    for blk in blocks:
        gid = g2e.get(blk.get("gameId"))
        if gid is None:
            continue
        by_game.setdefault(gid, []).append(blk)
    gids = [g for g in by_game if g in ours]
    print("  %d CBBD games, %d match our games table" % (len(by_game), len(gids)), flush=True)
    have = {}      # game_id -> {espn_id: player}, plus names
    for i in range(0, len(gids), 60):
        chunk = gids[i:i + 60]
        for r in sb("box_scores?game_id=in.(%s)&select=game_id,espn_id,player,team&order=game_id" % ",".join(map(str, chunk))):
            have.setdefault(r["game_id"], {})[r["espn_id"]] = r
        if (i // 60) % 20 == 0: print("    box rows for %d / %d games" % (min(i + 60, len(gids)), len(gids)), flush=True)
    fill, remap, seen_remap = [], {}, set()
    for gid in gids:
        g = ours[gid]; rows = have.get(gid, {})
        names = {norm(r["player"]): eid for eid, r in rows.items()}
        for blk in by_game[gid]:
            team = g["home"] if blk.get("isHome") else g["away"]; opp = g["away"] if blk.get("isHome") else g["home"]
            if team not in d1: continue          # non-D-I opponents never get box rows on the site
            for p in blk.get("players") or []:
                eid = B.to_int(p.get("athleteSourceId"))
                if eid is None or eid in rows: continue
                mins = p.get("minutes") or 0
                if not mins and not (p.get("points") or (p.get("fieldGoals") or {}).get("attempted")): continue
                other = names.get(norm(p.get("name")))
                if other and other != eid:
                    remap[eid] = {"our_id": other, "name": p.get("name")}; continue     # same player, different id
                fg, tp, ft, rb = p.get("fieldGoals") or {}, p.get("threePointFieldGoals") or {}, p.get("freeThrows") or {}, p.get("rebounds") or {}
                I = lambda v: None if v is None else int(round(v))
                fill.append({"game_id": gid, "season_year": season, "date": g["date"], "team": team, "opp": opp,
                    "player": p.get("name"), "espn_id": eid, "starter": bool(p.get("starter")),
                    "min": I(mins), "pts": I(p.get("points")), "fgm": I(fg.get("made")), "fga": I(fg.get("attempted")),
                    "tpm": I(tp.get("made")), "tpa": I(tp.get("attempted")), "ftm": I(ft.get("made")), "fta": I(ft.get("attempted")),
                    "reb": I(rb.get("total")), "oreb": I(rb.get("offensive")), "dreb": I(rb.get("defensive")),
                    "ast": I(p.get("assists")), "tov": I(p.get("turnovers")), "stl": I(p.get("steals")),
                    "blk": I(p.get("blocks")), "pf": I(p.get("fouls"))})
    json.dump(fill, open(os.path.join(D, "box_fill_%d.json" % season), "w"))
    json.dump(remap, open(os.path.join(D, "box_fill_remap_%d.json" % season), "w"), indent=1)
    players = {}
    for r in fill: players.setdefault(r["espn_id"], [r["player"], r["team"], 0]); players[r["espn_id"]][2] += 1
    print("== %d: %d missing player-games for %d players; %d id remaps" % (season, len(fill), len(players), len(remap)))
    for eid, (n, t, k) in sorted(players.items(), key=lambda x: -x[1][2])[:8]: print("     %-26s %-28s %3d games" % (n, t, k))
    if remap:
        print("  -- shots remap SQL (owner):")
        for old, v in remap.items():
            print("  update public.shots set espn_id=%d where espn_id=%d and season_year=%d;  -- %s" % (v["our_id"], old, season, v["name"]))

# ── history: season lines for the players the fill completes ──────────────
def history(season):
    """player_history rows (per-game averages, the site's season table) for filled players who
    have no row that season. Aggregates every box row we now hold for them (fill + existing)."""
    fill = json.load(open(os.path.join(D, "box_fill_%d.json" % season)))
    ids = sorted({r["espn_id"] for r in fill})
    have = {r["espn_id"] for r in sb("player_history?season_year=eq.%d&espn_id=in.(%s)&select=espn_id&order=id" % (season, ",".join(map(str, ids))))}
    # player_history keys teams by their short name ("Utah State"); our games use the full
    # ESPN name ("Utah State Aggies"). Longest short name that prefixes the full one wins.
    shorts = sorted({r["team"] for r in sb("player_history?season_year=eq.%d&select=team&order=id" % season) if r.get("team")}, key=len, reverse=True)
    from build_coach_profiles import ALIAS            # bbref school -> ESPN full name
    rev = {v: k for k, v in ALIAS.items()}
    rev.update({"SE Louisiana Lions": "Southeastern Louisiana", "UMBC Retrievers": "Maryland-Baltimore County",
                "UIC Flames": "Illinois-Chicago", "Nicholls Colonels": "Nicholls State",
                "Central Connecticut Blue Devils": "Central Connecticut State", "San José State Spartans": "San Jose State"})
    def to_short(full):
        if rev.get(full) in shorts: return rev[full]
        f = norm(full)
        for sh in shorts:
            if f == norm(sh) or f.startswith(norm(sh) + " "): return sh
        return None
    short = {}
    roster = {}
    for t in B.cget("roster_%d" % season) or []:
        for pl in t.get("players") or []:
            e = B.to_int(pl.get("sourceId"))
            if e: roster[e] = pl
    games = {}
    for r in fill: games.setdefault(r["espn_id"], []).append(r)
    for e in ids:
        if e in have: continue
        for r in sb("box_scores?season_year=eq.%d&espn_id=eq.%d&select=*&order=game_id" % (season, e)): games[e].append(r)
    out, skipped = [], []
    POS = {"Guard": "G", "Forward": "F", "Center": "C"}
    for e in ids:
        if e in have: continue
        rows = [r for r in games[e] if (r.get("min") or 0) > 0 or (r.get("fga") or 0) > 0]
        if len(rows) < 5: continue
        team = max({r["team"] for r in rows}, key=lambda t: sum(1 for r in rows if r["team"] == t))
        if team not in short: short[team] = to_short(team)
        if not short[team]: skipped.append((rows[0]["player"], team)); continue
        gp = len(rows); tot = lambda k: sum((r.get(k) or 0) for r in rows)
        pg = lambda k: round(tot(k) / gp, 1)
        pct = lambda m, a: round(100.0 * tot(m) / tot(a), 1) if tot(a) else None
        rp = roster.get(e) or {}
        h = rp.get("height"); height = "%d-%d" % (h // 12, h % 12) if isinstance(h, (int, float)) and h else None
        out.append({"season_year": season, "team": short[team], "name": rows[0]["player"], "espn_id": e,
            "position": POS.get(rp.get("position"), rp.get("position")), "height": height, "yr": None, "gp": gp,
            "mpg": pg("min"), "ppg": pg("pts"), "rpg": pg("reb"), "apg": pg("ast"), "fgm": pg("fgm"), "fga": pg("fga"),
            "fg_pct": pct("fgm", "fga"), "tpm": pg("tpm"), "tpa": pg("tpa"), "tp_pct": pct("tpm", "tpa"),
            "ftm": pg("ftm"), "fta": pg("fta"), "ft_pct": pct("ftm", "fta"), "oreb": pg("oreb"), "dreb": pg("dreb"),
            "stl": pg("stl"), "blk": pg("blk"), "tovs": pg("tov")})
    json.dump(out, open(os.path.join(D, "history_fill_%d.json" % season), "w"), indent=0)
    print("== %d: %d player_history rows to add (%d filled players already had one)%s" % (season, len(out), len(have),
          ("; skipped, no short team name: %s" % skipped[:5]) if skipped else ""))
    for r in sorted(out, key=lambda r: -r["ppg"])[:6]: print("     %-26s %-18s %2d gp %5.1f ppg" % (r["name"], r["team"], r["gp"], r["ppg"]))

# ── upload ────────────────────────────────────────────────────────────────
def upload(season):
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not key: sys.exit("Set SUPABASE_SERVICE_KEY (owner only).")
    HH = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json", "Prefer": "return=minimal"}
    for table, fn in (("box_scores", "box_fill_%d.json"), ("player_history", "history_fill_%d.json")):
        fp = os.path.join(D, fn % season)
        if not os.path.exists(fp): print("  no", fn % season); continue
        rows = json.load(open(fp))
        for i in range(0, len(rows), 500):
            req = urllib.request.Request(B.SB + "/rest/v1/" + table, data=json.dumps(rows[i:i + 500]).encode(), method="POST", headers=HH)
            try: urllib.request.urlopen(req, timeout=180).read()
            except urllib.error.HTTPError as e: sys.exit("upload %s http %d: %s" % (table, e.code, e.read()[:300]))
        print("== %d: inserted %d rows into %s" % (season, len(rows), table))
    remap = json.load(open(os.path.join(D, "box_fill_remap_%d.json" % season)))
    for old, v in remap.items():
        req = urllib.request.Request(B.SB + "/rest/v1/shots?espn_id=eq.%s&season_year=eq.%d" % (old, season),
                                     data=json.dumps({"espn_id": v["our_id"]}).encode(), method="PATCH", headers=HH)
        try: urllib.request.urlopen(req, timeout=180).read(); print("   shots %s → %s (%s)" % (old, v["our_id"], v["name"]))
        except urllib.error.HTTPError as e: print("   remap %s failed: %d %s" % (old, e.code, e.read()[:200]))

if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] not in ("pull", "diff", "history", "upload"): sys.exit(__doc__)
    key = B.cbbd_key() if sys.argv[1] == "pull" else None
    for s in [int(x) for x in sys.argv[2:]]:
        {"pull": lambda: pull(s, key), "diff": lambda: diff(s), "history": lambda: history(s), "upload": lambda: upload(s)}[sys.argv[1]]()
