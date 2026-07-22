#!/usr/bin/env python3
"""
build_shot_genome.py — the "Shot Genome": three linked, original metrics that
decompose offense using our shot-location + shot-type + assist data (which no
other CBB site has). Current season only (2026 has ~96% shot coverage; earlier
seasons are too sparse — see the shot-charts memory).

Three numbers, at TEAM and PLAYER level:
  LQ  Look Quality   — expected eFG% from WHERE (and how) you shoot. Shot selection.
  SM+ Shot-Making    — points added over an average shooter given your shot diet.
                       Pure finishing, stripped of selection. (Sustainable-shooting tell.)
  CR  Creation       — expected points your passing generates, each assist valued by
                       the quality of the look it created (a corner-3 dime > a long-two).

Expected value is modeled per (zone x shot-type) from this season's league, so a
dunk and a contested floater — both "at the rim" — carry their own make rate.

Reads the `shots` table (anon key, read-only). Writes:
  data/shot_genome_teams.json    per-team offense+defense LQ/SM+/CR + shot mix + percentiles
  data/shot_genome_players.json  per-player SM+ and CR (rotation filter) + percentiles

  python3 scripts/build_shot_genome.py            # 2026
  python3 scripts/build_shot_genome.py 2025       # a specific season
"""
import json, os, sys, time, urllib.request, urllib.parse
from collections import defaultdict
import grade_conf   # conference-tier competition adjustment (same as the grade model)

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
D = os.path.join(os.path.dirname(__file__), "data")
SEASON = int(sys.argv[1]) if len(sys.argv) > 1 else 2026

# player-level noise floors
MIN_FGA = 150   # SM+ needs a real shot sample
MIN_AST = 40    # CR needs a real passing sample


def get(path, tries=5):
    """Paged GET via Range header (avoids the deep-offset 500s on big tables)."""
    out = []; frm = 0
    while True:
        for a in range(tries):
            try:
                h = {**HDR, "Range-Unit": "items", "Range": "%d-%d" % (frm, frm + 999)}
                req = urllib.request.Request(SB + "/rest/v1/" + path, headers=h)
                b = json.load(urllib.request.urlopen(req, timeout=90)); break
            except Exception:
                if a == tries - 1: raise
                time.sleep(2 * (a + 1))
        out += b
        if len(b) < 1000: break
        frm += 1000
    return out


def zone(s):
    """rim / paint / mid / corner3 / atb3 — matches build_team_dna."""
    if s.get("sv") == 3:
        return "corner3" if (s.get("y") or 99) <= 10 else "atb3"
    d = s.get("dist")
    if d is None or d <= 4: return "rim"
    if d <= 9: return "paint"
    return "mid"


def sval(s):
    return 3 if s.get("sv") == 3 else 2


def pctl(values):
    """value -> 0..100 percentile within the list."""
    srt = sorted(values)
    n = len(srt)
    def f(v):
        below = sum(1 for x in srt if x < v)
        return round(100 * below / n) if n else 50
    return f


def main():
    print("Shot Genome — season %d" % SEASON, flush=True)
    teams = {t["team_id"]: t for t in get(
        "team_seasons?season_year=eq.%d&select=team_id,team,conference&team_id=not.is.null" % SEASON)}
    print("  %d D1 teams" % len(teams), flush=True)

    # competition adjustment: beating a league-wide shot baseline is easier vs weak
    # defenses, so shrink SM+/CR by the same conference tier the grade model uses
    # (tier 1 = x1.0 … tier 7 ≈ x0.35). Keeps the "best shot-maker" list honest.
    def tfac(tid):
        nm = (teams.get(tid) or {}).get("team") or ""
        try: return grade_conf.TIER_TO_T1.get(grade_conf.tier(nm), 0.6)
        except Exception: return 0.6

    # names for shooters: espn_id -> player (bbref is fully populated for the season)
    name_of = {}
    for r in get("bbref_seasons?season_year=eq.%d&espn_id=not.is.null&select=espn_id,player" % SEASON):
        name_of[r["espn_id"]] = r["player"]

    # ── pull every shot once, by team (indexed team_id → no deep-offset 500s) ──
    ALL = []
    for i, tid in enumerate(teams):
        sh = get("shots?season_year=eq.%d&team_id=eq.%d&select=game_id,team_id,espn_id,made,sv,dist,y,stype,ast_id,ast_name" % (SEASON, tid))
        ALL += sh
        if (i + 1) % 50 == 0: print("    %d/%d teams pulled (%d shots)" % (i + 1, len(teams), len(ALL)), flush=True)
    print("  %d shots total" % len(ALL), flush=True)

    # ── league expected make% per (zone, stype) ──
    bucket = defaultdict(lambda: [0, 0])
    for s in ALL:
        k = (zone(s), s.get("stype") or "?")
        bucket[k][0] += 1
        if s.get("made"): bucket[k][1] += 1
    # zone-only fallback for thin (zone,stype) cells
    zbucket = defaultdict(lambda: [0, 0])
    for s in ALL:
        z = zone(s); zbucket[z][0] += 1; zbucket[z][1] += 1 if s.get("made") else 0
    zmake = {z: (m / n if n else 0) for z, (n, m) in zbucket.items()}

    def exp_make(s):
        n, m = bucket[(zone(s), s.get("stype") or "?")]
        return (m / n) if n >= 40 else zmake[zone(s)]   # shrink thin cells to the zone rate

    def exp_pts(s):
        return exp_make(s) * sval(s)

    print("  league make%% by zone:", {z: round(v * 100, 1) for z, v in zmake.items()}, flush=True)

    # ── group for offense (by team) and defense (opponent shots in each game) ──
    by_team = defaultdict(list)
    by_game = defaultdict(list)
    for s in ALL:
        by_team[s["team_id"]].append(s)
        by_game[s["game_id"]].append(s)
    # per game, each team's defense = the OTHER team's shots
    def_shots = defaultdict(list)
    for gid, shots in by_game.items():
        tids = list({s["team_id"] for s in shots})
        if len(tids) != 2: continue          # only clean 2-team games
        a, b = tids
        for s in shots:
            def_shots[b if s["team_id"] == a else a].append(s)

    def summarize(shots):
        n = len(shots)
        if not n: return None
        exp_efg = sum(exp_make(s) * (1.5 if sval(s) == 3 else 1) for s in shots) / n * 100
        act_efg = sum((1.5 if sval(s) == 3 else 1) for s in shots if s.get("made")) / n * 100
        pts_over = sum((sval(s) if s.get("made") else 0) - exp_pts(s) for s in shots)  # total points vs expected
        z = defaultdict(int)
        for s in shots: z[zone(s)] += 1
        rim = z["rim"] / n; three = (z["corner3"] + z["atb3"]) / n; mid = (z["paint"] + z["mid"]) / n
        prox = 1.0 + 2.0 * three + 1.0 * mid   # 1.0 all-rim … 3.0 all-three (mid ~2.0)
        return dict(
            n=n,
            lq=round(exp_efg, 1),                 # Look Quality
            efg=round(act_efg, 1),
            sm=round(pts_over / n * 100, 2),      # SM+ per 100 shots
            sm_total=round(pts_over, 1),
            rimRate=round(100 * rim, 1), midRate=round(100 * mid, 1), threeRate=round(100 * three, 1),
            prox=round(prox, 2))

    # ── team rows ──
    trows = {}
    for tid, t in teams.items():
        o = summarize(by_team.get(tid, []))
        d = summarize(def_shots.get(tid, []))
        if not o: continue
        # team Creation = expected points its players created via assists (offense)
        cr = sum(exp_pts(s) for s in by_team[tid] if s.get("ast_id") and s.get("made"))
        gp = len({s["game_id"] for s in by_team[tid]}) or 1
        tf = tfac(tid)
        o["smAdj"] = round(o["sm"] * tf, 2)          # competition-adjusted SM+
        if d: d["smAdj"] = round(d["sm"] * tf, 2)
        trows[tid] = {"team_id": tid, "team": t["team"], "conf": t.get("conference"),
                      "gp": gp, "tf": round(tf, 2), "off": o, "def": d,
                      "cr": round(cr, 1), "crPg": round(cr / gp, 1), "crAdjPg": round(cr / gp * tf, 2)}

    # team percentiles (offense LQ/SM+ high-good; defense LQ/SM+ low-good = harder shots forced)
    def add_team_pct(key, sub, invert=False):
        vals = [r[sub][key] for r in trows.values() if r.get(sub)]
        f = pctl(vals)
        for r in trows.values():
            if r.get(sub):
                p = f(r[sub][key]); r[sub].setdefault("pct", {})[key] = (100 - p) if invert else p
    for k in ("lq", "smAdj", "efg"): add_team_pct(k, "off")
    for k in ("lq", "smAdj", "efg"): add_team_pct(k, "def", invert=True)
    crf = pctl([r["crAdjPg"] for r in trows.values()])
    for r in trows.values(): r["crPct"] = crf(r["crAdjPg"])

    # ── player rows: SM+ (own shots) and CR (looks created) ──
    pshots = defaultdict(list); pcreate = defaultdict(lambda: {"ast": 0, "xpts": 0.0})
    pteam = {}
    for s in ALL:
        if s.get("espn_id"):
            pshots[s["espn_id"]].append(s); pteam[s["espn_id"]] = s["team_id"]
        if s.get("ast_id") and s.get("made"):
            c = pcreate[s["ast_id"]]; c["ast"] += 1; c["xpts"] += exp_pts(s)

    players = {}
    for eid, shots in pshots.items():
        n = len(shots)
        if n < MIN_FGA: continue
        pts_over = sum((sval(s) if s.get("made") else 0) - exp_pts(s) for s in shots)
        exp_efg = sum(exp_make(s) * (1.5 if sval(s) == 3 else 1) for s in shots) / n * 100
        act_efg = sum((1.5 if sval(s) == 3 else 1) for s in shots if s.get("made")) / n * 100
        tf = tfac(pteam.get(eid))
        players[eid] = {"espn_id": eid, "name": name_of.get(eid, "Unknown"),
                        "team_id": pteam.get(eid), "team": (teams.get(pteam.get(eid)) or {}).get("team"),
                        "fga": n, "lq": round(exp_efg, 1), "efg": round(act_efg, 1),
                        "sm": round(pts_over / n * 100, 2), "sm_total": round(pts_over, 1),
                        "smAdj": round(pts_over / n * 100 * tf, 2)}
    for eid, c in pcreate.items():
        if c["ast"] < MIN_AST: continue
        tf = tfac(pteam.get(eid))
        p = players.get(eid) or {"espn_id": eid, "name": name_of.get(eid, "Unknown"),
                                 "team_id": pteam.get(eid), "team": (teams.get(pteam.get(eid)) or {}).get("team")}
        p["ast"] = c["ast"]; p["cr"] = round(c["xpts"], 1); p["crPer"] = round(c["xpts"] / c["ast"], 2)
        p["crAdj"] = round(c["xpts"] * tf, 1)
        players[eid] = p

    smf = pctl([p["smAdj"] for p in players.values() if "smAdj" in p])
    crf2 = pctl([p["crAdj"] for p in players.values() if "crAdj" in p])
    for p in players.values():
        if "smAdj" in p: p["smPct"] = smf(p["smAdj"])
        if "crAdj" in p: p["crPct"] = crf2(p["crAdj"])

    os.makedirs(D, exist_ok=True)
    meta = {"season": SEASON, "n_shots": len(ALL), "n_teams": len(trows),
            "zone_make": {z: round(v, 4) for z, v in zmake.items()},
            "min_fga": MIN_FGA, "min_ast": MIN_AST}
    json.dump({"meta": meta, "teams": list(trows.values())},
              open(os.path.join(D, "shot_genome_teams.json"), "w"), separators=(",", ":"))
    json.dump({"meta": meta, "players": sorted(players.values(), key=lambda p: -p.get("sm", -99))},
              open(os.path.join(D, "shot_genome_players.json"), "w"), separators=(",", ":"))
    print("  wrote %d teams, %d players" % (len(trows), len(players)), flush=True)

    # ── sanity leaderboards ──
    def top(rows, key, lbl, fmt="%.2f", teamside=False):
        good = [r for r in rows if (r.get(key) is not None)]
        good.sort(key=lambda r: -r[key])
        print("\n  %s" % lbl)
        for r in good[:8]:
            nm = r["team"] if teamside else "%-22s %s" % (r.get("name", "?"), (r.get("team") or "")[:18])
            print("    " + (fmt % r[key]) + "  " + nm)

    tl = list(trows.values())
    top([r["off"] | {"team": r["team"]} for r in tl if r.get("off")], "smAdj", "TEAM Shot-Making (adj SM+ /100 shots)", teamside=True)
    top([{"team": r["team"], "crAdjPg": r["crAdjPg"]} for r in tl], "crAdjPg", "TEAM Creation (adj xPts created / game)", fmt="%.1f", teamside=True)
    pl = list(players.values())
    top([p for p in pl if "smAdj" in p], "smAdj", "PLAYER Shot-Making (adj SM+ /100)")
    top([p for p in pl if "crAdj" in p], "crAdj", "PLAYER Creation (adj xPts created)", fmt="%.1f")


if __name__ == "__main__":
    main()
