#!/usr/bin/env python3
"""
build_onoff.py — college on/off (WOWY) from NCAA play-by-play (which, unlike ESPN,
logs substitutions). Reconstructs the on-court five stint-by-stint and computes each
player's on-court vs off-court offensive/defensive rating and net on/off.

Output: scripts/data/player_onoff.json (per player-season) — a static file like
shot_genome_players.json, so no Supabase write / service key is needed.

Usage:
  python3 build_onoff.py --season 2025 --limit 30 --verbose   # validate on 30 games
  python3 build_onoff.py --season 2025                        # full season -> JSON
  python3 build_onoff.py --season 2025 --resume               # continue a run
"""
import json, re, sys, time, os, urllib.request, urllib.error, argparse
from collections import defaultdict
from datetime import date, timedelta

SB  = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
UA  = "Mozilla/5.0 (TDC on/off builder)"
PROXY = "https://ncaa-api.henrygd.me"
NCAA_SB = "https://data.ncaa.com/casablanca/scoreboard/basketball-men/d1/%d/%02d/%02d/scoreboard.json"
DATADIR = os.path.join(os.path.dirname(__file__), "data")
SUB_RE = re.compile(r'^Subbing (in|out) for (.+?)-(.+)$')

def http(url, headers=None, tries=4):
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (400, 404): return None
        except Exception:
            pass
        time.sleep(0.5 * (a + 1))
    return None

def norm(s):
    s = (s or "").lower()
    s = re.sub(r'[.\'’]', '', s)
    s = re.sub(r'\b(jr|sr|iii|ii|iv)\b', '', s)
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def sb_get(path):
    return http(SB + "/rest/v1/" + path, headers=HDR) or []

# ── scoreboard for a day -> [{nid, home, away}] ─────────────────────────
def scoreboard(d):
    j = http(NCAA_SB % (d.year, d.month, d.day))
    out = []
    for g in (j or {}).get("games", []):
        game = g.get("game", {})
        url = game.get("url", "")   # /game/{nid}
        m = re.search(r'/game/(\d+)', url)
        if not m: continue
        hg, ag = game.get("home", {}), game.get("away", {})
        h = hg.get("names", {}) or {}; a = ag.get("names", {}) or {}
        def sc(x):
            try: return int(x.get("score"))
            except: return None
        out.append({"nid": m.group(1),
                    "home": h.get("short") or h.get("full") or "",
                    "away": a.get("short") or a.get("full") or "",
                    "hs": sc(hg), "as": sc(ag)})
    return out

def _tov(a, b): return len(set(norm(a).split()) & set(norm(b).split()))

# ── match an NCAA game to OUR game: team-token overlap disambiguated by final score ─
def match_our_game(our_games, ncaa):
    nh, na, nhs, nas = ncaa["home"], ncaa["away"], ncaa.get("hs"), ncaa.get("as")
    best = None; best_key = (-1, 99)
    for g in our_games:
        # orientation 1: NCAA home == our home
        s1 = min(_tov(nh, g["home"]), _tov(na, g["away"]))
        d1 = abs((g.get("home_score") or -99) - (nhs or -1)) + abs((g.get("away_score") or -99) - (nas or -1)) if (nhs is not None) else 99
        # orientation 2: flipped
        s2 = min(_tov(nh, g["away"]), _tov(na, g["home"]))
        d2 = abs((g.get("home_score") or -99) - (nas or -1)) + abs((g.get("away_score") or -99) - (nhs or -1)) if (nhs is not None) else 99
        s, d = (s1, d1) if (s1, -d1) >= (s2, -d2) else (s2, d2)
        if s < 1: continue                     # both teams must share at least one token
        key = (s, d)                            # more overlap, then closest score, wins
        if (key[0], -key[1]) > (best_key[0], -best_key[1]):
            best_key = key; best = g
    # accept only a confident match: token overlap + exact score (or score unknown but unique tokens)
    if best is None: return None
    if best_key[1] == 0 or (nhs is None and best_key[0] >= 1): return best
    return None

# ── reconstruct one game -> per-espn on-court tallies + team totals ──────
def process_game(nid, og):
    pbp = http(f"{PROXY}/game/{nid}/play-by-play")
    if not pbp or not pbp.get("periods"): return None, "no-pbp"
    teams = pbp.get("teams", [])
    if len(teams) != 2: return None, "teams"
    home_is = {t["isHome"]: t for t in teams}
    # our box for this game -> name->espn + starters, split by side
    box = sb_get(f"box_scores?game_id=eq.{og['id']}&select=player,espn_id,team,starter,min")
    if not box: return None, "no-box"
    # box has exactly 2 team names — map each to our home/away by token overlap
    bteams = list({b["team"] for b in box if b.get("team")})
    if len(bteams) < 2: return None, "box-teams<2"
    def tov(a, b):
        return len(set(norm(a).split()) & set(norm(b).split()))
    h_team = max(bteams, key=lambda bt: (tov(bt, og["home"]), -tov(bt, og["away"])))
    a_team = max([bt for bt in bteams if bt != h_team], key=lambda bt: tov(bt, og["away"]))
    def side_map(bteam):
        rows = [b for b in box if b["team"] == bteam and b.get("espn_id") is not None]
        n2e = {norm(b["player"]): str(b["espn_id"]) for b in rows}
        st = [b for b in rows if b.get("starter")]
        if len(st) != 5:                       # fallback: top-5 by minutes
            rows.sort(key=lambda b: -_minf(b.get("min"))); st = rows[:5]
        return n2e, [str(b["espn_id"]) for b in st][:5]
    # key the two sides to the NCAA home/away (isHome), so subs + score deltas align
    ncaa_home = next((t for t in teams if t.get("isHome")), teams[0])
    ncaa_away = next((t for t in teams if not t.get("isHome")), teams[1])
    box_home = max([h_team, a_team], key=lambda bt: tov(ncaa_home["nameShort"], bt) + tov(ncaa_home.get("nameFull",""), bt))
    box_away = a_team if box_home == h_team else h_team
    hn2e, hstart = side_map(box_home)   # "H" = NCAA home team
    an2e, astart = side_map(box_away)   # "A" = NCAA away team
    if len(hstart) != 5 or len(astart) != 5: return None, "starters(%d,%d)" % (len(hstart), len(astart))

    on = {"H": set(hstart), "A": set(astart)}   # espn ids on court
    n2e = {"H": hn2e, "A": an2e}
    # accumulators
    acc = defaultdict(lambda: {"onF":0,"onA":0,"onP":0.0,"onDP":0.0,"side":None})
    tot = {"H":{"F":0,"A":0,"P":0.0}, "A":{"F":0,"A":0,"P":0.0}}
    # a stint = play window between subs; tally pts + poss components per side, then attribute
    stint = {"H":{"pts":0,"fga":0,"oreb":0,"tov":0,"fta":0}, "A":{"pts":0,"fga":0,"oreb":0,"tov":0,"fta":0}}
    prev_h = prev_a = None
    bad = 0

    def side_of_play(pl):
        return "H" if pl.get("isHome") else "A"

    def poss(s): return max(0.0, s["fga"] - s["oreb"] + s["tov"] + 0.44 * s["fta"])

    def close_stint():
        hp, ap = poss(stint["H"]), poss(stint["A"])
        hpts, apts = stint["H"]["pts"], stint["A"]["pts"]
        if hp == 0 and ap == 0 and hpts == 0 and apts == 0:
            return  # empty stint (back-to-back subs)
        for e in list(on["H"]):                 # home: scores hpts, allows apts
            a = acc[e]; a["side"] = "H"
            a["onF"] += hpts; a["onA"] += apts; a["onP"] += hp; a["onDP"] += ap
        for e in list(on["A"]):                 # away: scores apts, allows hpts
            a = acc[e]; a["side"] = "A"
            a["onF"] += apts; a["onA"] += hpts; a["onP"] += ap; a["onDP"] += hp
        tot["H"]["F"] += hpts; tot["H"]["A"] += apts; tot["H"]["P"] += hp
        tot["A"]["F"] += apts; tot["A"]["A"] += hpts; tot["A"]["P"] += ap
        for k in stint:
            stint[k] = {"pts":0,"fga":0,"oreb":0,"tov":0,"fta":0}

    for per in pbp["periods"]:
        prev_h = prev_a = None
        for pl in per.get("playbyplayStats", []):
            desc = pl.get("eventDescription","")
            # score delta -> points to whichever side scored
            try: h=int(pl.get("homeScore") or 0); a=int(pl.get("visitorScore") or 0)
            except: h=a=0
            if prev_h is not None:
                dh, da = h-prev_h, a-prev_a
                if dh>0: stint["H"]["pts"] += dh
                if da>0: stint["A"]["pts"] += da
                # made free throws are NOT logged as events (only misses are) — a +1
                # score jump IS a made FT, so count it toward FTA for the possession math
                if dh==1: stint["H"]["fta"] += 1
                if da==1: stint["A"]["fta"] += 1
            prev_h, prev_a = h, a
            m = SUB_RE.match(desc)
            if m:
                close_stint()
                io, team, player = m.group(1), m.group(2), m.group(3)
                side = None                        # match sub's team name to home/away
                for t in teams:
                    if norm(team) in (norm(t["nameShort"]), norm(t["nameFull"])):
                        side = "H" if t["isHome"] else "A"; break
                if side is None: bad+=1; continue
                eid = n2e[side].get(norm(player))
                if eid is None: bad+=1; continue
                if io=="in": on[side].add(eid)
                else: on[side].discard(eid)
                continue
            # possession-component tallies for the acting side
            side = side_of_play(pl)
            c = classify(desc)
            if c=="fga": stint[side]["fga"]+=1
            elif c=="ft": stint[side]["fta"]+=1
            elif c=="oreb": stint[side]["oreb"]+=1
            elif c=="tov": stint[side]["tov"]+=1
            elif "blocks" in desc.lower():          # a blocked shot is a missed FGA for the OFFENSE
                other = "A" if side=="H" else "H"; stint[other]["fga"]+=1
    close_stint()
    names = {str(b["espn_id"]): b["player"] for b in box if b.get("espn_id") is not None}
    return {"acc":acc, "tot":tot, "bad":bad, "teamH":box_home, "teamA":box_away, "names":names}, "ok"

def classify(desc):
    d = desc.lower()
    if 'subbing' in d: return 'sub'
    if 'free throw' in d: return 'ft'
    if 'turnover' in d or 'shot clock' in d: return 'tov'
    if 'offensive rebound' in d: return 'oreb'
    if 'defensive rebound' in d: return 'dreb'
    if 'makes' in d or 'misses' in d: return 'fga'
    return 'other'

# possession calibration: event-parsed possessions run a touch low (missed made-FTs
# are recovered, but a few turnover/steal edge cases still slip through), so ratings
# come out ~10-13% high. Scale possessions so league-average ORtg lands near the true
# ~104. Re-tune from a full-season run's mean ORtg (mean/104) if needed.
POSS_CAL = 1.12

def season_dates(season):
    # season 2025 == 2024-25: Nov (season-1) .. Apr (season)
    d = date(season-1, 11, 1); end = date(season, 4, 12)
    while d <= end:
        yield d; d += timedelta(days=1)

def run(season, limit=0, verbose=False):
    # aggregate per espn_id: on/off across matched games
    agg = defaultdict(lambda: {"team":None,"name":None,"onF":0,"onA":0,"onP":0.0,"onDP":0.0,
                               "tF":0,"tA":0,"tP":0.0,"games":0})   # tF/tA/tP = team totals for off-court calc
    matched=0; processed=0; failed=defaultdict(int)
    for d in season_dates(season):
        sb = scoreboard(d)
        if not sb: continue
        our = our_games_on(d)
        if not our: continue
        our_by = our
        for ncaa in sb:
            og = match_our_game(our_by, ncaa)
            if not og: failed["no-game-match"]+=1; continue
            matched+=1
            res, why = process_game(ncaa["nid"], og)
            if res is None: failed[why]+=1; continue
            processed+=1
            # fold into season agg: on-court tallies + the team-game total (for off-court)
            for eid, a in res["acc"].items():
                g = agg[eid]; g["team"] = res["teamH"] if a["side"]=="H" else res["teamA"]
                g["name"] = res["names"].get(eid) or g.get("name")
                g["onF"]+=a["onF"]; g["onA"]+=a["onA"]; g["onP"]+=a["onP"]; g["onDP"]+=a["onDP"]; g["games"]+=1
                t = res["tot"][a["side"]]        # off-court = team total - player's on-court
                g["tF"]+=t["F"]; g["tA"]+=t["A"]; g["tP"]+=t["P"]
            if verbose and processed<=6:
                print(f"[{d}] {ncaa['away']} @ {ncaa['home']} (nid {ncaa['nid']}, our {og['id']}) "
                      f"players={len(res['acc'])} bad_events={res['bad']}")
            if processed % 100 == 0:            # checkpoint: persist partial results
                print(f"  ...checkpoint at {processed} games ({d})", flush=True)
                finish(agg, matched, processed, failed, season, write=True, verbose=False)
            if limit and matched>=limit:
                return finish(agg, matched, processed, failed, season, write=False, verbose=verbose)
            time.sleep(0.1)                     # be polite to the NCAA feed
    return finish(agg, matched, processed, failed, season, write=True, verbose=verbose)

def finish(agg, matched, processed, failed, season, write, verbose):
    rows=[]
    for eid,g in agg.items():
        if g["onP"]<20: continue
        onP, onDP = g["onP"]*POSS_CAL, g["onDP"]*POSS_CAL
        on_o = 100*g["onF"]/onP if onP else None
        on_d = 100*g["onA"]/onDP if onDP else None
        offF=g["tF"]-g["onF"]; offA=g["tA"]-g["onA"]; offP=(g["tP"]-g["onP"])*POSS_CAL
        off_o = 100*offF/offP if offP>10 else None
        off_d = 100*offA/offP if offP>10 else None
        on_net = (on_o-on_d) if (on_o is not None and on_d is not None) else None
        off_net = (off_o-off_d) if (off_o is not None and off_d is not None) else None
        rows.append({"espn_id":eid,"name":g.get("name"),"team":g["team"],"season":season,"games":g["games"],
                     "on_poss":round(g["onP"]),"off_poss":round(max(0,offP)),
                     "on_o":r1(on_o),"on_d":r1(on_d),"on_net":r1(on_net),
                     "off_o":r1(off_o),"off_d":r1(off_d),"off_net":r1(off_net),
                     "onoff_net": r1(on_net-off_net) if (on_net is not None and off_net is not None) else None})
    print(f"\n== season {season}: matched {matched} games, processed {processed}, "
          f"players {len(rows)} ==")
    print("failures:", dict(failed))
    if verbose:
        f = lambda v: '  -  ' if v is None else f'{v:>5}'
        rows.sort(key=lambda r:-(r["onoff_net"] if r["onoff_net"] is not None else -99))
        for r in rows[:12]:
            print(f"  {(r['team'] or '?')[:18]:18} espn {r['espn_id']:>8}  on {f(r['on_net'])}  off {f(r['off_net'])}  on/off {f(r['onoff_net'])}  ({r['on_poss']}p)")
    if write:
        os.makedirs(DATADIR, exist_ok=True)
        path=os.path.join(DATADIR,"player_onoff.json")
        blob={}
        try:
            if os.path.exists(path): blob=json.load(open(path))
        except: pass
        blob[str(season)]=rows
        json.dump(blob, open(path,"w"))
        print("wrote", path, "season", season, len(rows), "players")
    return rows

def our_games_on(d):
    ds=d.isoformat()
    return sb_get(f"games?date=eq.{ds}&select=id,home,away,home_score,away_score")

def r1(v): return None if v is None else round(v,1)

def _minf(v):
    if v is None: return 0.0
    s = str(v)
    if ':' in s:
        try: m, sec = s.split(':'); return int(m) + int(sec)/60.0
        except: return 0.0
    try: return float(s)
    except: return 0.0

if __name__ == "__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--verbose", action="store_true")
    a=ap.parse_args()
    run(a.season, a.limit, a.verbose)
