#!/usr/bin/env python3
"""
build_pbp_analytics.py — mine the NCAA play-by-play we already fetch for on/off into
possession-level analytics the site doesn't have yet:

  1. Assist networks      — who creates for whom (assister -> scorer, counts + points)
  2. Pace of play          — transition vs half-court rate from the game clock
  3. Hidden points         — points off turnovers, second-chance points, and-1s, runs
  4. Block matchups        — who blocks whom
  5. Lineup four factors   — eFG / TOV% / ORB% / FTr per reconstructed 5-man unit

Isolated from build_onoff.py (imports its helpers, never edits it) so the live on/off
scrape is untouched. Writes scripts/data/team_pbp.json + scripts/data/lineups.json.

Usage:
  python3 build_pbp_analytics.py --season 2025 --limit 8 --verbose   # validate
  python3 build_pbp_analytics.py --season 2025                       # full season -> JSON
"""
import json, re, os, time, argparse
from collections import defaultdict
from itertools import combinations

from build_onoff import (http, norm, scoreboard, match_our_game, our_games_on,
                         sb_get, PROXY, season_dates, _minf, r1)

DATADIR = os.path.join(os.path.dirname(__file__), "data")
ASSIST_RE = re.compile(r'\(([^()]+?) assists\)')
BLOCK_RE  = re.compile(r"blocks (.+?)'s")
STEAL_RE  = re.compile(r'\(([^()]+?) steals\)')
DRAW_RE   = re.compile(r'\(([^()]+?) draws the foul\)')
TRANSITION_SECS = 7          # a shot within 7s of gaining the ball = transition


def clock_secs(c):
    if not c:
        return None
    p = str(c).split(":")
    try:
        return int(p[0]) * 60 + int(p[1])
    except Exception:
        return None


def shot_pts(desc):
    return 3 if "three point" in desc.lower() else 2


def analyze_game(nid, og):
    """Walk one game's play-by-play once and return every analytics bucket."""
    pbp = http(f"{PROXY}/game/{nid}/play-by-play")
    if not pbp or not pbp.get("periods"):
        return None, "no-pbp"
    teams = pbp.get("teams", [])
    if len(teams) != 2:
        return None, "teams"
    box = sb_get(f"box_scores?game_id=eq.{og['id']}&select=player,espn_id,team,starter,min")
    if not box:
        return None, "no-box"
    bteams = list({b["team"] for b in box if b.get("team")})
    if len(bteams) < 2:
        return None, "box-teams<2"

    def tov(a, b):
        return len(set(norm(a).split()) & set(norm(b).split()))

    h_team = max(bteams, key=lambda bt: (tov(bt, og["home"]), -tov(bt, og["away"])))
    a_team = max([bt for bt in bteams if bt != h_team], key=lambda bt: tov(bt, og["away"]))
    ncaa_home = next((t for t in teams if t.get("isHome")), teams[0])
    box_home = max([h_team, a_team],
                   key=lambda bt: tov(ncaa_home["nameShort"], bt) + tov(ncaa_home.get("nameFull", ""), bt))
    box_away = a_team if box_home == h_team else h_team
    teamname = {"H": box_home, "A": box_away}

    def side_map(bteam):
        rows = [b for b in box if b["team"] == bteam and b.get("espn_id") is not None]
        n2e = {norm(b["player"]): str(b["espn_id"]) for b in rows}
        st = [b for b in rows if b.get("starter")]
        if len(st) != 5:
            rows.sort(key=lambda b: -_minf(b.get("min"))); st = rows[:5]
        return n2e, [str(b["espn_id"]) for b in st][:5]

    hn2e, hstart = side_map(box_home)
    an2e, astart = side_map(box_away)
    if len(hstart) != 5 or len(astart) != 5:
        return None, "starters(%d,%d)" % (len(hstart), len(astart))
    n2e = {"H": hn2e, "A": an2e}
    names = {str(b["espn_id"]): b["player"] for b in box if b.get("espn_id") is not None}
    on = {"H": set(hstart), "A": set(astart)}

    # actor resolution: firstName/lastName are empty in older-format games and isHome isn't
    # always reliable, so resolve the acting player by the longest leading-name match against
    # both rosters — which also tells us the side. (The name is always in the description text.)
    roster = sorted([(nm, eid, sd) for sd in ("H", "A") for nm, eid in n2e[sd].items() if nm],
                    key=lambda x: -len(x[0]))
    def resolve_actor(nd):
        for nm, eid, sd in roster:
            if nd == nm or nd.startswith(nm + " "):
                return eid, sd
        return None, None

    # ── analytics accumulators ─────────────────────────────────────────
    A = {
        "assist_net": defaultdict(lambda: defaultdict(lambda: {"n": 0, "pts": 0})),  # assister -> scorer
        "player": defaultdict(lambda: {"ast": 0, "ast_pts": 0, "fgm": 0, "fgm_ast": 0,
                                        "blk": 0, "blkd": 0}),                        # per espn
        "block_net": defaultdict(lambda: defaultdict(int)),                           # blocker -> blocked
        "team": {s: {"fga": 0, "tfga": 0, "tpts": 0, "pts": 0, "poss": 0,
                     "pts_off_to": 0, "second_chance": 0, "and1": 0, "run": 0}
                 for s in ("H", "A")},
        "lineup": defaultdict(lambda: {"oPts": 0, "oPoss": 0.0, "dPts": 0, "dPoss": 0.0,
                                       "fgm": 0, "fga": 0, "fg3m": 0, "fta": 0, "tov": 0, "oreb": 0,
                                       "opp_dreb": 0, "secs": 0,
                                       # DEFENSIVE four-factor components (the opponent's offense while
                                       # THIS five is on defense) — needed for a correct def_rtg
                                       # denominator. Without these def_rtg reused the offensive poss.
                                       "opp_fga": 0, "opp_fta": 0, "opp_tov": 0, "opp_oreb": 0}),
    }
    SUB_RE = re.compile(r'^Subbing (in|out) for (.+?)-(.+)$')

    poss_side = None       # side currently with the ball
    poss_start = None      # clock (s) when they gained it
    last_to_side = None    # side that just turned it over (for pts-off-TO)
    sc_flag = None         # side currently on a second-chance possession
    run_side = None; run_pts = 0
    prev_h = prev_a = None
    last_make = None       # (side, eid) for and-1 detection

    def unit_key(side):
        u = frozenset(on[side])
        return (side, u) if len(u) == 5 else None

    for per in pbp["periods"]:
        prev_h = prev_a = None
        poss_side = poss_start = last_to_side = sc_flag = None
        run_side = None; run_pts = 0
        for pl in per.get("playbyplayStats", []):
            desc = pl.get("eventDescription", "") or ""
            dl = desc.lower()
            nd = norm(desc)
            actor, aside = resolve_actor(nd)
            side = aside if aside else ("H" if pl.get("isHome") else "A")
            other = "A" if side == "H" else "H"
            clk = clock_secs(pl.get("clock"))

            # score deltas -> points, runs, pts-off-TO, second-chance, lineup pts
            try:
                h = int(pl.get("homeScore") or 0); a = int(pl.get("visitorScore") or 0)
            except Exception:
                h = a = 0
            if prev_h is not None:
                for sc_side, dpts in (("H", h - prev_h), ("A", a - prev_a)):
                    if dpts <= 0:
                        continue
                    A["team"][sc_side]["pts"] += dpts
                    run_pts = run_pts + dpts if run_side == sc_side else dpts
                    run_side = sc_side
                    A["team"][sc_side]["run"] = max(A["team"][sc_side]["run"], run_pts)
                    if last_to_side and last_to_side != sc_side:
                        A["team"][sc_side]["pts_off_to"] += dpts
                    if sc_flag == sc_side:
                        A["team"][sc_side]["second_chance"] += dpts
                    uk_o = unit_key(sc_side)
                    if uk_o:
                        A["lineup"][uk_o]["oPts"] += dpts
                        # NOTE: fta is counted ONCE at the explicit "free throw" event below (for both
                        # makes and misses). The old +1-inference here ALSO added fta on a made FT, so
                        # every made FT double-counted fta → inflated possessions → deflated every
                        # ORtg/DRtg (the systematic ~med-83 symptom). Removed. [VERIFY: if a --verbose
                        # run shows lineup FTA far BELOW the box FTA, this feed omits made-FT events and
                        # you'd restore `if dpts==1: fta+=1` here instead.]
                    uk_d = unit_key("A" if sc_side == "H" else "H")
                    if uk_d:
                        A["lineup"][uk_d]["dPts"] += dpts
                if h - prev_h > 0 or a - prev_a > 0:
                    last_to_side = None
            prev_h, prev_a = h, a

            # substitutions -> update on-court five
            m = SUB_RE.match(desc)
            if m:
                io, tm, player = m.group(1), m.group(2), m.group(3)
                sd = None
                for t in teams:
                    if norm(tm) in (norm(t["nameShort"]), norm(t.get("nameFull", ""))):
                        sd = "H" if t.get("isHome") else "A"; break
                if sd is not None:
                    eid = n2e[sd].get(norm(player))
                    if eid:
                        on[sd].add(eid) if io == "in" else on[sd].discard(eid)
                continue

            made = "makes" in dl
            missed = "misses" in dl
            is_fga = (made or missed) and "free throw" not in dl
            uk = unit_key(side)

            if is_fga:
                A["team"][side]["fga"] += 1
                if uk:
                    A["lineup"][uk]["fga"] += 1
                duk = unit_key(other)                 # the five ON DEFENSE for this shot
                if duk:
                    A["lineup"][duk]["opp_fga"] += 1
                if poss_side == side and poss_start is not None and clk is not None and (poss_start - clk) <= TRANSITION_SECS:
                    A["team"][side]["tfga"] += 1
                    if made:
                        A["team"][side]["tpts"] += shot_pts(desc)
                if made:
                    if actor:
                        A["player"][actor]["fgm"] += 1
                    if uk:
                        A["lineup"][uk]["fgm"] += 1
                        if "three point" in dl:
                            A["lineup"][uk]["fg3m"] += 1
                    am = ASSIST_RE.search(desc)
                    if am and actor:
                        A["player"][actor]["fgm_ast"] += 1
                        aeid = n2e[side].get(norm(am.group(1)))
                        if aeid:
                            c = A["assist_net"][aeid][actor]
                            c["n"] += 1; c["pts"] += shot_pts(desc)
                            A["player"][aeid]["ast"] += 1
                            A["player"][aeid]["ast_pts"] += shot_pts(desc)
                    last_make = (side, actor)
                    poss_side = other; poss_start = clk; sc_flag = None   # made -> other team's ball

            if "blocks" in dl and actor:
                A["player"][actor]["blk"] += 1
                bm = BLOCK_RE.search(desc)
                if bm:
                    beid = n2e[other].get(norm(bm.group(1)))
                    if beid:
                        A["block_net"][actor][beid] += 1
                        A["player"][beid]["blkd"] += 1

            if "offensive rebound" in dl:
                if uk:
                    A["lineup"][uk]["oreb"] += 1
                duk = unit_key(other)                 # defense allowed this offensive rebound
                if duk:
                    A["lineup"][duk]["opp_oreb"] += 1
                sc_flag = side                 # second-chance possession begins
                poss_side = side               # keep the ball; poss_start unchanged (a putback isn't transition)

            if "defensive rebound" in dl:
                off_uk = unit_key(other)       # the team that missed = offense; credit its ORB chance
                if off_uk:
                    A["lineup"][off_uk]["opp_dreb"] += 1
                poss_side = side; poss_start = clk; sc_flag = None   # new possession for rebounder

            if "turnover" in dl or "shot clock" in dl:
                if uk:
                    A["lineup"][uk]["tov"] += 1
                duk = unit_key(other)                 # defense forced this turnover
                if duk:
                    A["lineup"][duk]["opp_tov"] += 1
                last_to_side = side
                poss_side = other; poss_start = clk; sc_flag = None

            if "free throw" in dl:             # every FT event = one attempt (makes AND misses)
                if uk:
                    A["lineup"][uk]["fta"] += 1
                duk = unit_key(other)                 # defense sent this offense to the line
                if duk:
                    A["lineup"][duk]["opp_fta"] += 1

            # and-1: last made FG's shooter draws a shooting foul on the same trip
            if "shooting foul" in dl and "draws the foul" in dl and last_make:
                dm = DRAW_RE.search(desc)
                if dm:
                    deid, _ = resolve_actor(norm(dm.group(1)))
                    if deid and deid == last_make[1]:
                        A["team"][last_make[0]]["and1"] += 1
                        last_make = None

    eid_team = {}
    for sd in ("H", "A"):
        for eid in n2e[sd].values():
            eid_team[eid] = teamname[sd]
    return {"an": A, "teamname": teamname, "names": names, "eid_team": eid_team}, "ok"


# ── quick validation harness ────────────────────────────────────────────
def validate(season, limit, verbose):
    done = 0
    for d in season_dates(season):
        sb = scoreboard(d)
        if not sb:
            continue
        our = our_games_on(d)
        if not our:
            continue
        for ncaa in sb:
            og = match_our_game(our, ncaa)
            if not og:
                continue
            res, why = analyze_game(ncaa["nid"], og)
            if res is None:
                if verbose:
                    print(f"  skip {ncaa['away']}@{ncaa['home']}: {why}")
                continue
            done += 1
            _print_game(ncaa, res)
            time.sleep(0.15)
            if done >= limit:
                return
    print(f"\n(validated {done} games)")


def _print_game(ncaa, res):
    A = res["an"]; nm = res["names"]; tn = res["teamname"]
    print(f"\n=== {ncaa['away']} @ {ncaa['home']} ===")
    for s in ("H", "A"):
        t = A["team"][s]
        trate = 100 * t["tfga"] / t["fga"] if t["fga"] else 0
        print(f"  {tn[s][:22]:22} pts {t['pts']:>3} | transition {trate:4.1f}% of FGA "
              f"| off-TO {t['pts_off_to']:>2} | and-1 {t['and1']:>2} | best run {t['run']:>2}")
    # top assist connections
    conns = []
    for aeid, tgts in A["assist_net"].items():
        for seid, v in tgts.items():
            conns.append((v["n"], nm.get(aeid, aeid), nm.get(seid, seid)))
    conns.sort(reverse=True)
    if conns:
        print("  top feeds:", "; ".join(f"{a}->{s} x{n}" for n, a, s in conns[:3]))
    # top block matchup
    blk = [(n, nm.get(b, b), nm.get(v, v)) for b, vs in A["block_net"].items() for v, n in vs.items()]
    blk.sort(reverse=True)
    if blk:
        print("  blocks:", "; ".join(f"{b} rejected {v} x{n}" for n, b, v in blk[:2]))
    # a sample lineup four factors (the unit with most offensive possessions-ish -> most fga)
    lus = sorted(A["lineup"].items(), key=lambda kv: -kv[1]["fga"])[:1]
    for (side, unit), l in lus:
        efg = 100 * (l["fgm"] + 0.5 * l["fg3m"]) / l["fga"] if l["fga"] else 0
        orb = 100 * l["oreb"] / (l["oreb"] + l["opp_dreb"]) if (l["oreb"] + l["opp_dreb"]) else 0
        ftr = 100 * l["fta"] / l["fga"] if l["fga"] else 0
        who = ", ".join(nm.get(e, e).split()[-1] for e in list(unit)[:5])
        print(f"  top {tn[side][:14]} unit ({who}): eFG {efg:.1f} | ORB% {orb:.0f} | FTr {ftr:.0f} | fga {l['fga']}")


# ── full-season aggregation -> team_pbp.json + lineups.json ─────────────
def run(season, limit=0, verbose=False):
    team = defaultdict(lambda: {"gp": 0, "fga": 0, "tfga": 0, "pts": 0, "off_to": 0,
                                "second_chance": 0, "and1": 0, "best_run": 0})
    anet = defaultdict(lambda: defaultdict(lambda: {"n": 0, "pts": 0}))   # team -> (aeid,seid) -> ...
    bnet = defaultdict(lambda: defaultdict(int))                          # team -> (beid,veid) -> n
    players = defaultdict(lambda: {"name": None, "team": None, "ast": 0, "ast_pts": 0,
                                   "fgm": 0, "fgm_ast": 0, "blk": 0, "blkd": 0})
    units = defaultdict(lambda: defaultdict(lambda: {"oPts": 0, "dPts": 0, "fga": 0, "fgm": 0,
                                                     "fg3m": 0, "fta": 0, "tov": 0, "oreb": 0, "opp_dreb": 0}))
    name = {}
    matched = processed = 0; failed = defaultdict(int)

    for d in season_dates(season):
        sb = scoreboard(d)
        if not sb: continue
        our = our_games_on(d)
        if not our: continue
        for ncaa in sb:
            og = match_our_game(our, ncaa)
            if not og: failed["no-game-match"] += 1; continue
            matched += 1
            res, why = analyze_game(ncaa["nid"], og)
            if res is None: failed[why] += 1; continue
            processed += 1
            A = res["an"]; et = res["eid_team"]; name.update(res["names"])
            for s in ("H", "A"):
                tn = res["teamname"][s]; t = team[tn]; a = A["team"][s]
                t["gp"] += 1
                t["fga"] += a["fga"]; t["tfga"] += a["tfga"]; t["pts"] += a["pts"]
                t["off_to"] += a["pts_off_to"]; t["second_chance"] += a["second_chance"]
                t["and1"] += a["and1"]; t["best_run"] = max(t["best_run"], a["run"])
            for aeid, tgts in A["assist_net"].items():
                tm = et.get(aeid)
                for seid, v in tgts.items():
                    c = anet[tm][(aeid, seid)]; c["n"] += v["n"]; c["pts"] += v["pts"]
            for beid, vs in A["block_net"].items():
                tm = et.get(beid)
                for veid, n in vs.items():
                    bnet[tm][(beid, veid)] += n
            for eid, p in A["player"].items():
                if not eid: continue
                pl = players[eid]; pl["name"] = res["names"].get(eid) or pl["name"]; pl["team"] = et.get(eid) or pl["team"]
                for k in ("ast", "ast_pts", "fgm", "fgm_ast", "blk", "blkd"): pl[k] += p[k]
            for (side, unit), l in A["lineup"].items():
                tn = res["teamname"][side]; u = units[tn][unit]
                for k in u: u[k] += l.get(k, 0)
            if processed % 100 == 0:
                print(f"  ...checkpoint {processed} games ({d})", flush=True)
                _write(season, team, anet, bnet, players, units, name)
            if limit and matched >= limit:
                return _write(season, team, anet, bnet, players, units, name, matched, processed, failed, verbose)
            time.sleep(0.1)
    return _write(season, team, anet, bnet, players, units, name, matched, processed, failed, verbose)


# FULL-FIDELITY trios/pairs: aggregate every k-man subset over the COMPLETE set of
# five-man units (not just the top-12 lineups the client used to derive from). A trio's
# stats = the sum over every five-man unit it appeared in — exact possessions/net, since
# the units are mutually-exclusive possession windows.
def _combos(us, nm, size, minposs):
    SUM = ("oPts", "dPts", "fga", "fgm", "fg3m", "tov", "fta", "oreb", "opp_dreb",
           "opp_fga", "opp_oreb", "opp_tov", "opp_fta")
    agg = {}
    for unit, l in us.items():
        oposs = l["fga"] - l["oreb"] + l["tov"] + 0.44 * l["fta"]
        if oposs <= 0 or len(unit) < size: continue
        for combo in combinations(sorted(unit), size):
            a = agg.get(combo)
            if a is None:
                a = agg[combo] = {k: 0 for k in SUM}; a["units"] = 0
            a["units"] += 1
            for k in SUM:
                a[k] += l.get(k, 0)
    rows = []
    for combo, a in agg.items():
        oposs = a["fga"] - a["oreb"] + a["tov"] + 0.44 * a["fta"]
        dposs = a["opp_fga"] - a["opp_oreb"] + a["opp_tov"] + 0.44 * a["opp_fta"]
        if oposs < minposs or dposs < minposs: continue
        ortg = 100 * a["oPts"] / oposs
        drtg = 100 * a["dPts"] / dposs               # defensive denominator (was offensive poss)
        efg = 100 * (a["fgm"] + 0.5 * a["fg3m"]) / a["fga"] if a["fga"] else None
        rows.append({
            "players": [nm(e) for e in combo], "poss": round((oposs + dposs) / 2), "units": a["units"],
            "off_rtg": r1(ortg), "def_rtg": r1(drtg), "net": r1(ortg - drtg), "efg": r1(efg),
            "tov_pct": r1(100 * a["tov"] / oposs),
            "orb_pct": r1(100 * a["oreb"] / (a["oreb"] + a["opp_dreb"])) if (a["oreb"] + a["opp_dreb"]) else None,
        })
    rows.sort(key=lambda r: -r["poss"])
    return rows

def _write(season, team, anet, bnet, players, units, name,
           matched=0, processed=0, failed=None, verbose=False):
    nm = lambda e: name.get(e, e)
    out_team = {}
    for tn, t in team.items():
        gp = t["gp"] or 1
        feeds = sorted(anet[tn].items(), key=lambda kv: -kv[1]["n"])[:8]
        blks = sorted(bnet[tn].items(), key=lambda kv: -kv[1])[:6]
        tps = [p for p in players.values() if p["team"] == tn]
        out_team[tn] = {
            "gp": t["gp"],
            "transition_rate": r1(100 * t["tfga"] / t["fga"]) if t["fga"] else None,
            "off_to_pg": r1(t["off_to"] / gp), "second_chance_pg": r1(t["second_chance"] / gp),
            "and1_pg": r1(t["and1"] / gp), "best_run": t["best_run"],
            "feeds": [{"from": nm(a), "to": nm(s), "n": v["n"], "pts": v["pts"]} for (a, s), v in feeds],
            "blocks": [{"blk": nm(b), "on": nm(v), "n": n} for (b, v), n in blks],
            "ast_leaders": [{"name": p["name"], "ast": p["ast"], "pts": p["ast_pts"]}
                            for p in sorted(tps, key=lambda p: -p["ast"])[:5] if p["ast"]],
            "blk_leaders": [{"name": p["name"], "blk": p["blk"]}
                            for p in sorted(tps, key=lambda p: -p["blk"])[:5] if p["blk"]],
        }
    # ── VALIDATION (verbose): aggregate every 5-man unit per team into a team ORtg/DRtg and
    # compare to reality. A healthy team lands ORtg≈DRtg≈95-120 and oPoss≈dPoss (possessions
    # alternate). If ORtg reads ~83 the possession denominator is still inflated (check the FTA
    # double-count fix); if oPoss and dPoss diverge a lot the on-court-five tracking is dropping
    # events. Run: python3 build_pbp_analytics.py --season 2025 --limit 8 --verbose
    if verbose:
        print("\n== lineup-rating validation (team totals from summed units; expect ORtg/DRtg 95-120) ==")
        for tn, us in list(units.items())[:12]:
            oP = sum(l["oPts"] for l in us.values()); dP = sum(l["dPts"] for l in us.values())
            oPo = sum(l["fga"] - l["oreb"] + l["tov"] + 0.44 * l["fta"] for l in us.values())
            dPo = sum(l["opp_fga"] - l["opp_oreb"] + l["opp_tov"] + 0.44 * l["opp_fta"] for l in us.values())
            if oPo < 1 or dPo < 1: continue
            flag = "" if 90 <= 100 * oP / oPo <= 125 and 0.8 <= (oPo / dPo if dPo else 0) <= 1.25 else "  <-- CHECK"
            print(f"   {str(tn)[:24]:24} ORtg {100*oP/oPo:5.1f}  DRtg {100*dP/dPo:5.1f}  oPoss {oPo:6.0f} dPoss {dPo:6.0f}{flag}")
    out_lu = {}
    for tn, us in units.items():
        rows = []
        for unit, l in us.items():
            # SEPARATE offensive and defensive possessions (Oliver four-factor estimate on each end).
            oposs = l["fga"] - l["oreb"] + l["tov"] + 0.44 * l["fta"]
            dposs = l["opp_fga"] - l["opp_oreb"] + l["opp_tov"] + 0.44 * l["opp_fta"]
            if oposs < 25 or dposs < 25: continue       # meaningful sample on BOTH ends
            ortg = 100 * l["oPts"] / oposs
            drtg = 100 * l["dPts"] / dposs              # was /oposs — the def_rtg denominator bug
            efg = 100 * (l["fgm"] + 0.5 * l["fg3m"]) / l["fga"] if l["fga"] else None
            rows.append({
                "players": [nm(e) for e in unit], "poss": round((oposs + dposs) / 2),
                "off_rtg": r1(ortg), "def_rtg": r1(drtg), "net": r1(ortg - drtg),
                "efg": r1(efg), "tov_pct": r1(100 * l["tov"] / oposs),
                "orb_pct": r1(100 * l["oreb"] / (l["oreb"] + l["opp_dreb"])) if (l["oreb"] + l["opp_dreb"]) else None,
                "ftr": r1(100 * l["fta"] / l["fga"]) if l["fga"] else None,
            })
        rows.sort(key=lambda r: -r["poss"])
        if rows: out_lu[tn] = rows[:12]

    # full-fidelity trios + pairs (aggregated over ALL units, not the top-12)
    out_combos = {}
    for tn, us in units.items():
        trios = _combos(us, nm, 3, 90)[:16]
        pairs = _combos(us, nm, 2, 180)[:16]
        if trios or pairs: out_combos[tn] = {"trios": trios, "pairs": pairs}

    os.makedirs(DATADIR, exist_ok=True)
    for fn, key, data in (("team_pbp.json", "team", out_team), ("lineups.json", "lineups", out_lu), ("combos.json", "combos", out_combos)):
        path = os.path.join(DATADIR, fn)
        blob = {}
        try:
            if os.path.exists(path): blob = json.load(open(path))
        except Exception: pass
        blob[str(season)] = data
        json.dump(blob, open(path, "w"))
    if failed is not None:
        print(f"\n== season {season}: matched {matched}, processed {processed}, teams {len(out_team)} ==")
        print("failures:", dict(failed))
    print("wrote team_pbp.json + lineups.json for", season)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--validate", action="store_true", help="print per-game sanity check instead of writing")
    a = ap.parse_args()
    if a.validate:
        validate(a.season, a.limit or 8, a.verbose)
    else:
        run(a.season, a.limit, a.verbose)
