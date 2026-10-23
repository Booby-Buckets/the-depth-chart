#!/usr/bin/env python3
"""
College → NBA bridge: one row per college player (final college season 2010+), with
what happened next in the NBA. Phase 1 of the college-to-NBA comparison work.

The NBA side is computed with OUR college formulas (derived_stats.compute on nba_box),
so TS%, USG%, AST/REB/STL/BLK%, TI/40 mean the same thing on both sides. ESPN's own
season stats (PER/RPM, nba_seasons.jsonl) are not used here — owned numbers only.
Join key: nba_players.college_athlete_id (ESPN's link to the college athlete record).
Recent players share one espn_id across leagues, but most who left school before ~2016
have separate college and NBA ids (Anthony Davis: college 56353, NBA 6583) — joining on
espn_id alone silently drops them. Bridge rows carry both ids.

Inputs
  data/player_advanced.csv        college seasons 2010-2026 (owned, derived_stats.py)
  ../archetypes_YYYY.json         college style role per season (2014+)
  Supabase player_history         college height / position / weight (2012+)
  Supabase team_seasons           team power rating + conference
  Supabase players                current rosters — players still in college are excluded
  data/nba_box.jsonl / nba_players.jsonl   from scrape_nba.py (works on a partial scrape)

Outcome window = the 4 seasons after the final college season (F+1..F+4), regular season.
  window_complete = F+4 <= last NBA season scraped; train only on complete windows.
  tier_w4:  0 No NBA | 1 Cup of coffee (<1,500 min) | 2 Rotation (>=1,500 min)
            3 Starter (a season with >=41 starts and >=1,800 min) | 4 Star (a qualified
            season in the league's top 5% of TI/40)
  tier_career: same ladder over every NBA season scraped (censored for recent exits).
NBA value: nba_par = TI points above replacement, replacement = the TI/40 at the 15th
  percentile of that season's NBA minutes. Points, not wins — the wins scale is college-fit.

Outputs
  data/nba_bridge.csv             the bridge (analysis-friendly)
  data/nba_player_seasons.json    owned NBA advanced per player-season (regular season)
  data/nba_unlinked.json          NBA players whose college espn_id isn't in our college data
                                  (pre-2010 exits, or id mismatches — name-match later)

  python3 build_nba_bridge.py
"""
import csv, json, re, sys
from collections import defaultdict
from pathlib import Path
import requests
import derived_stats as ds

HERE = Path(__file__).parent
DATA = HERE / "data"
ROOT = HERE.parent
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
ANON = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"   # public read key (same as the site)
H = {"apikey": ANON, "Authorization": f"Bearer {ANON}"}

WINDOW = 4
COFFEE_MIN, ROT_MIN = 1500, 1500
START_GS, START_MIN = 41, 1800
STAR_QUAL_MIN, STAR_PCTL = 1500, 0.95
REPL_PCTL = 0.15
NBA_MIN_QUAL = 500           # season minutes to count a TI/40 as a "peak"


def sb_all(table, select, order):
    """Paginated public read. Stable ORDER BY or PostgREST skips/dupes rows at page edges."""
    out, step = [], 1000
    while True:
        r = requests.get(f"{SB}/rest/v1/{table}", headers={**H, "Range": f"{len(out)}-{len(out)+step-1}"},
                         params={"select": select, "order": order}, timeout=90)
        r.raise_for_status()
        b = r.json(); out += b
        if len(b) < step: return out


def read_jsonl(p):
    out = []
    if p.exists():
        for l in p.read_text().splitlines():
            try: out.append(json.loads(l))
            except Exception: pass
    return out


def ht_in(h):
    m = re.match(r"\s*(\d+)\s*[-']\s*(\d+)", str(h or ""))
    return int(m.group(1)) * 12 + int(m.group(2)) if m else None


def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None


# ---------------- NBA side ----------------
# ESPN season-total stat names -> derived_stats aggregate keys
ESPN_TOT = {"min": "minutes", "pts": "points", "fgm": "fieldGoalsMade", "fga": "fieldGoalsAttempted",
            "tpm": "threePointFieldGoalsMade", "tpa": "threePointFieldGoalsAttempted",
            "ftm": "freeThrowsMade", "fta": "freeThrowsAttempted", "oreb": "offensiveRebounds",
            "dreb": "defensiveRebounds", "reb": "rebounds", "ast": "assists", "stl": "steals",
            "blk": "blocks", "tov": "turnovers", "pf": "fouls", "g": "gamesPlayed"}


def espn_totals(stats):
    return {k: float(stats.get(v) or 0) for k, v in ESPN_TOT.items()}


TOT_KEYS = ("g", "min", "pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "reb",
            "ast", "stl", "blk", "tov", "pf")


def nba_seasons(season_type="regular", quiet=False):
    """{(espn_id, season): owned advanced dict} for NBA play of one season type
    ("regular" | "postseason"). Each row also carries the counting totals ("tot").

    Box scores are the base. Where ESPN's box under-counts (the CHI/NO 2013-18 all-zero
    games, plus stray blanks) the player's / team's ESPN SEASON totals stand in — still run
    through our formulas. Residual bias: other teams' opponent totals miss the blank games
    (~2-4 of 82), so their REB%/STL%/BLK% denominators are a few % light in those seasons.
    """
    allbox = [r for r in read_jsonl(DATA / "nba_box.jsonl")
              if not r.get("dnp") and r.get("espn_id") and r.get("min")]   # "--" minutes = didn't play
    games = defaultdict(set)                         # REGULAR-season games per team = who's a real team
    for r in allbox:
        if r.get("season_type") == "regular":
            games[(r["season"], r["team"])].add(r["game_id"])
    box = [r for r in allbox if r.get("season_type") == season_type]
    tot = {(r["espn_id"], r["season"]): r for r in read_jsonl(DATA / "nba_seasons.jsonl")
           if r.get("season_type") == season_type and r.get("stats")}
    # team-season totals are regular season only — no team fallback for the playoffs
    tteam = {(r["season"], r["team"]): r["stats"] for r in read_jsonl(DATA / "nba_team_seasons.jsonl")
             if r.get("stats")} if season_type == "regular" else {}
    by_season = defaultdict(list)
    for r in box:
        if len(games[(r["season"], r["team"])]) < 40 or len(games[(r["season"], r["opp"])]) < 40:
            continue                                 # All-Star / exhibition sides (EAST, WEST, LEB…)
        by_season[r["season"]].append({
            "espn_id": r["espn_id"], "player": r["name"], "team": r["team"], "opp": r["opp"],
            "min": r.get("min") or 0, "pts": r.get("pts") or 0, "fga": r.get("fga") or 0,
            "fgm": r.get("fgm") or 0, "fta": r.get("fta") or 0, "ftm": r.get("ftm") or 0,
            "tpa": r.get("fg3a") or 0, "tpm": r.get("fg3m") or 0, "oreb": r.get("oreb") or 0,
            "dreb": r.get("dreb") or 0, "reb": r.get("reb") or 0, "ast": r.get("ast") or 0,
            "stl": r.get("stl") or 0, "blk": r.get("blk") or 0, "tov": r.get("tov") or 0,
            "pf": r.get("pf") or 0, "_gs": 1 if r.get("starter") else 0})
    out, fills = {}, defaultdict(int)
    for y, rows in sorted(by_season.items()):
        P, T, O, NAME, PTEAM = ds.aggregate(rows)
        teams = defaultdict(set); gs = defaultdict(int)
        for r in rows:
            teams[r["espn_id"]].add(r["team"]); gs[r["espn_id"]] += r["_gs"]
        # players: ESPN season totals where box is >10% light on minutes
        for (eid, yy), t in tot.items():
            if yy != y: continue
            e = espn_totals(t["stats"])
            if e["min"] > 1.1 * P[eid]["min"] + 20 if eid in P else e["min"] > 0:
                P[eid] = {**P[eid], **e} if eid in P else e
                NAME.setdefault(eid, t.get("name"))
                tm = (t.get("teams") or [None])[-1]
                if tm and eid not in PTEAM: PTEAM[eid] = tm
                for tm in t.get("teams") or []: teams[eid].add(tm)
                gs[eid] = max(gs[eid], int(t["stats"].get("gamesStarted") or 0))
                fills["player"] += 1
        # teams: ESPN team-season totals where box team minutes are >10% light
        for (yy, tm), st in tteam.items():
            if yy != y: continue
            e = espn_totals(st)
            if tm not in T or T[tm]["min"] < 0.9 * e["min"]:
                T[tm] = {**T[tm], **e} if tm in T else e
                fills["team"] += 1
        adv = ds.compute(P, T, O, NAME, PTEAM, y)
        # replacement level: TI/40 where cumulative minutes (worst→best) reach 15%
        pl = sorted(((a["ti40"], a["min"]) for a in adv.values() if a["ti40"] is not None))
        tot_min, acc, repl = sum(m for _, m in pl), 0, pl[0][0] if pl else 0
        for t, m in pl:
            acc += m
            if acc >= REPL_PCTL * tot_min: repl = t; break
        qual = sorted(a["ti40"] for a in adv.values() if a["min"] >= STAR_QUAL_MIN and a["ti40"] is not None)
        star_cut = qual[int(STAR_PCTL * (len(qual) - 1))] if qual else 99
        for eid, a in adv.items():
            a.pop("owa", None); a.pop("dwa", None)           # college-calibrated; not valid here
            a.update({"gs": gs[eid], "n_teams": len(teams[eid]), "teams": sorted(teams[eid]),
                      "par": round((a["ti40"] - repl) * a["min"] / 40.0, 1),
                      "star_season": a["min"] >= STAR_QUAL_MIN and a["ti40"] >= star_cut,
                      "repl_ti40": round(repl, 2), "star_cut_ti40": round(star_cut, 2),
                      "tot": {k: round(P[eid].get(k) or 0) for k in TOT_KEYS}})
            out[(str(eid), y)] = a
        if not quiet:
            print(f"  NBA {y}: {len(adv)} players, repl TI/40 {repl:.1f}, star cut {star_cut:.1f}", flush=True)
    print(f"  NBA {season_type}: ESPN season-total fallbacks {fills['player']} player-seasons, {fills['team']} team-seasons")
    return out


def tier(seasons):
    if not seasons: return 0
    if any(s["star_season"] for s in seasons): return 4
    if any(s["gs"] >= START_GS and s["min"] >= START_MIN for s in seasons): return 3
    return 2 if sum(s["min"] for s in seasons) >= ROT_MIN else 1


TIER_NAME = {0: "No NBA", 1: "Cup of coffee", 2: "Rotation", 3: "Starter", 4: "Star"}


def main():
    print("NBA seasons (owned formulas)…", flush=True)
    NBA = nba_seasons()
    nba_years = sorted({y for _, y in NBA})
    if not nba_years:
        raise SystemExit("no NBA box scores yet — run scrape_nba.py")
    last_nba = max(nba_years)
    bio = {p["espn_id"]: p for p in read_jsonl(DATA / "nba_players.jsonl") if not p.get("missing")}
    to_col = {e: (b.get("college_athlete_id") or e) for e, b in bio.items()}   # nba id -> college id
    nba_id = {c: e for e, c in to_col.items()}
    # full draft lists (scrape_nba.py draft phase): includes picks who never played, keyed by
    # college id. A few records point at the NBA athlete instead — map those through the bio.
    draft = {}
    for d in read_jsonl(DATA / "nba_draft.jsonl"):
        cid = d.get("college_athlete_id")
        if not cid and d.get("athlete_ref_league") == "nba":
            pass                                            # no id stored for these; bio covers them
        if cid: draft[cid] = d
    by_player = defaultdict(list)                           # keyed by COLLEGE id
    for (eid, y), a in NBA.items():
        by_player[to_col.get(eid, eid)].append(a)

    print("College inputs…", flush=True)
    col = defaultdict(dict)                                 # espn_id -> season -> row
    for r in csv.DictReader(open(DATA / "player_advanced.csv")):
        y = int(r["season_year"])
        prev = col[r["espn_id"]].get(y)
        if not prev or int(r["min"] or 0) > int(prev["min"] or 0):
            col[r["espn_id"]][y] = r
    hist = {}
    for h in sb_all("player_history", "espn_id,season_year,height,position,weight", "id.asc"):
        if h.get("espn_id"):
            hist[(str(h["espn_id"]), h["season_year"])] = h
    ts = {(t["team"], t["season_year"]): t for t in sb_all("team_seasons", "team,season_year,srs,conference", "team.asc,season_year.asc")}
    still = {str(p["espn_id"]) for p in sb_all("players", "espn_id", "id.asc") if p.get("espn_id")}
    arch = {}
    for y in range(2014, 2027):
        f = ROOT / f"archetypes_{y}.json" if y < 2026 else ROOT / "archetypes.json"
        if f.exists():
            for eid, v in json.load(open(f))["players"].items():
                arch[(eid, y)] = v.get("a")
    print(f"  {len(col)} college players, {len(hist)} history rows, {len(ts)} team-seasons, "
          f"{len(still)} on current rosters", flush=True)

    rows, linked = [], set()
    for eid, seasons in col.items():
        if eid in still:
            continue                                        # hasn't left college yet
        F = max(seasons)
        if F >= 2026 and eid not in by_player:
            continue                                        # 2026 exit, no NBA season possible yet
        f = seasons[F]
        p = seasons.get(F - 1)
        h = hist.get((eid, F)) or hist.get((eid, F - 1)) or {}
        t = ts.get((f["team"], F)) or {}
        cmin = sum(int(s["min"] or 0) for s in seasons.values())
        cti = sum(num(s["ti40"]) * int(s["min"] or 0) for s in seasons.values() if num(s["ti40"]) is not None)
        nb = sorted(by_player.get(eid, []), key=lambda a: a["season_year"])
        win = [a for a in nb if F < a["season_year"] <= F + WINDOW]
        peak = max((a for a in win if a["min"] >= NBA_MIN_QUAL), key=lambda a: a["ti40"], default=None)
        b = bio.get(nba_id.get(eid, eid), {})
        if nb: linked.add(eid)
        row = {
            "espn_id": eid, "nba_espn_id": nba_id.get(eid) if eid in by_player else None, "name": f["name"], "final_season": F, "final_team": f["team"],
            "conference": t.get("conference"), "team_srs": t.get("srs"),
            "college_seasons": len(seasons), "first_season_censored": min(seasons) == 2010,
            "height_in": ht_in(h.get("height")), "weight": h.get("weight"), "pos": h.get("position"),
            "archetype": arch.get((eid, F)),
            **{f"c_{k}": num(f[k]) for k in ("g", "min", "ppg", "rpg", "apg", "ts_pct", "efg_pct", "tp_pct",
               "ft_pct", "pts40", "reb40", "ast40", "usg_pct", "ast_pct", "tov_pct", "orb_pct", "drb_pct",
               "stl_pct", "blk_pct", "ti40", "ti100", "owa", "dwa")},
            "c_ti40_prev": num(p["ti40"]) if p else None,
            "c_career_min": cmin, "c_career_ti40": round(cti / cmin, 2) if cmin else None,
            # overall pick from the draft list; bio fallback (bio "selection" is the pick in round)
            "draft_year": (draft.get(eid) or {}).get("draft_year") or b.get("draft_year"),
            "draft_round": (draft.get(eid) or {}).get("round") or b.get("draft_round"),
            "draft_pick": (draft.get(eid) or {}).get("overall")
                          or (b.get("draft_pick") + (30 if b.get("draft_round") == 2 else 0) if b.get("draft_pick") else None),
            "nba_dob": b.get("dob"), "nba_height_in": b.get("height_in"),
            "window_complete": F + WINDOW <= last_nba and F + 1 >= min(nba_years),
            "nba_games_w4": sum(a["g"] for a in win), "nba_min_w4": sum(a["min"] for a in win),
            "nba_starts_w4": sum(a["gs"] for a in win), "nba_par_w4": round(sum(a["par"] for a in win), 1),
            "nba_peak_ti40_w4": peak["ti40"] if peak else None,
            "nba_peak_season_w4": peak["season_year"] if peak else None,
            "tier_w4": tier(win), "tier_w4_name": TIER_NAME[tier(win)],
            "nba_seasons": len(nb), "nba_min": sum(a["min"] for a in nb),
            "nba_par": round(sum(a["par"] for a in nb), 1),
            "nba_first_season": nb[0]["season_year"] if nb else None,
            "nba_last_season": nb[-1]["season_year"] if nb else None,
            "tier_career": tier(nb), "tier_career_name": TIER_NAME[tier(nb)],
        }
        rows.append(row)

    rows.sort(key=lambda r: (-r["nba_par"], r["name"] or ""))
    with open(DATA / "nba_bridge.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)
    json.dump({f"{e}|{y}": a for (e, y), a in NBA.items()}, open(DATA / "nba_player_seasons.json", "w"),
              separators=(",", ":"))
    unl = [{"espn_id": e, "name": b.get("name"), "college": b.get("college"),
            "draft_year": b.get("draft_year"), "nba_min": sum(a["min"] for a in by_player[to_col[e]])}
           for e, b in bio.items() if b.get("played_college") and to_col[e] in by_player and to_col[e] not in col]
    unl.sort(key=lambda u: -u["nba_min"])
    json.dump(unl, open(DATA / "nba_unlinked.json", "w"), indent=1)

    # ---- report ----
    nba_col = [e for e, b in bio.items() if b.get("played_college") and to_col[e] in by_player]
    print(f"\nBridge: {len(rows)} college players  |  NBA seasons scraped: {nba_years}")
    print(f"  NBA players who played college: {len(nba_col)}  linked to college data: "
          f"{len(linked)}  unlinked: {len(unl)} (see nba_unlinked.json)")
    comp = [r for r in rows if r["window_complete"]]
    print(f"  complete 4-yr windows: {len(comp)}")
    for k in range(5):
        n = sum(1 for r in comp if r["tier_w4"] == k)
        print(f"    {TIER_NAME[k]:<14} {n:>6}  ({100*n/max(1,len(comp)):.2f}%)")


if __name__ == "__main__":
    sys.exit(main())
