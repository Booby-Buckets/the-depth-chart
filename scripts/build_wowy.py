#!/usr/bin/env python3
"""
build_wowy.py — WOWY lineups (Oct 2026, owner: "build this", from databallr's WOWY Lineups page).

Same source and game matching as build_onoff.py (NCAA play-by-play, the only feed that logs
substitutions; cached in scripts/data/pbp_cache), but every stint carries a full box for both
sides, so each player and each 2/3/4/5-man unit gets the four factors on and off the floor:

  ORtg / DRtg / Net (per 100), TS%, eFG%, TOV%, ORB%, FT rate — and the same for the opponent
  (opp TS%, opp eFG%, opp TOV%) plus DRB% — with minutes and possessions.

Possessions = FGA − ORB + TOV + 0.44·FTA. Points and made free throws come from score changes
(one feed never logs made FTs), shots from the event text. Blocks are NOT extra shots (the miss is
already logged — build_onoff.py counted both, which is why it needed POSS_CAL 0.90).

Low-leverage removed (the default, like databallr's "Med/High"): second-half play with the margin
20+ inside 10:00, 15+ inside 5:00 or 12+ inside 2:00 is kept out of every number.

RAPM: ridge regression on the stints (offense and defense columns per player, rows weighted by
possessions), so each player's number accounts for who he played with and against.

Output: scripts/data/wowy_<season>.json  { league, players:[...], units:{team:{2:[],3:[],4:[],5:[]}} }

Usage:
  python3 -u scripts/build_wowy.py --season 2026 --limit 40 --verbose   # check on 40 games
  python3 -u scripts/build_wowy.py --season 2026                        # full season
"""
import json, os, re, sys, time, argparse
from collections import defaultdict
from itertools import combinations
sys.path.insert(0, os.path.dirname(__file__))
import build_onoff as B

DATADIR = B.DATADIR
CACHE = os.path.join(DATADIR, "wowy_cache")
F = ("pts", "fga", "fgm", "tpa", "tpm", "fta", "ftm", "orb", "drb", "tov", "ast", "stl", "blk")
MIN_UNIT_POSS = {2: 80, 3: 60, 4: 45, 5: 30}
TOP_UNITS = 15

def blank(): return dict.fromkeys(F, 0)

import unicodedata
def nn(s):
    """name key: repair UTF-8 read as Latin-1 ("BukumiroviÄ\x87"), drop accents, then build_onoff's norm"""
    s = str(s or "")
    try:
        if any(ord(c) > 127 for c in s): s = s.encode("latin-1").decode("utf-8")
    except Exception: pass
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return B.norm(s)

def cached_json(name, fn):
    os.makedirs(CACHE, exist_ok=True)
    fp = os.path.join(CACHE, name)
    if os.path.exists(fp):
        try: return json.load(open(fp))
        except Exception: pass
    v = fn()
    if v: json.dump(v, open(fp, "w"))
    return v

def secs_of(clock):
    m = re.match(r"^(\d+):(\d+)", str(clock or ""))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None

def low_leverage(per, secs, margin):
    if per != 2 or secs is None: return False
    m = abs(margin)
    return (secs <= 600 and m >= 20) or (secs <= 300 and m >= 15) or (secs <= 120 and m >= 12)

SUB2 = re.compile(r"^Subbing (in|out) for (.+)$")
THREE = re.compile(r"three point|3 pointer|3-pt|3pt", re.I)
def kind(desc):
    d = desc.lower()
    if "subbing" in d: return "sub"
    if "free throw" in d: return "ftmiss" if "miss" in d else "ft"
    if "turnover" in d or "shot clock" in d: return "tov"
    if "offensive rebound" in d: return "orb"
    if "defensive rebound" in d: return "drb"
    if d.startswith("assist by"): return "ast"
    if d.startswith("steal by") or "steals)" in d: return "stl"
    if d.startswith("block by") or " blocks" in d: return "blk"
    # no leading \b on the verb: "Jah Shortmisses three point…" runs the name into it
    if re.search(r"(makes|misses|missed|good)\b", d) or re.match(r"^(jumper|2 pointer|3 pointer|layup|slam dunk|tip in|hook shot|dunk) by", d):
        return "fga"
    return None

ESPN_CACHE = os.path.join(DATADIR, "espn_pbp_cache")
def espn_misses(gid):
    """missed field goals in ESPN's play-by-play for the same game (our game ids ARE ESPN ids):
    [{per, secs, team_id, is3}] — ESPN marks every shot 2 or 3 (pointsAttempted)"""
    import gzip
    os.makedirs(ESPN_CACHE, exist_ok=True)
    fp = os.path.join(ESPN_CACHE, f"{gid}.json.gz")
    d = None
    if os.path.exists(fp):
        try: d = json.load(gzip.open(fp))
        except Exception: d = None
    if d is None:
        d = B.http(f"https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={gid}")
        if d and d.get("plays"):
            try: json.dump(d, gzip.open(fp, "wt"))
            except Exception: pass
        time.sleep(0.15)
    out, teams = [], {}
    for c in (((d or {}).get("header") or {}).get("competitions") or [{}])[0].get("competitors", []):
        t = c.get("team") or {}; teams[str(t.get("id"))] = " ".join(filter(None, [t.get("location"), t.get("name"), t.get("displayName"), t.get("shortDisplayName")]))
    for pl in (d or {}).get("plays") or []:
        if not pl.get("shootingPlay") or pl.get("scoringPlay"): continue
        if "free throw" in (pl.get("text") or "").lower(): continue
        pa = pl.get("pointsAttempted")
        if pa not in (2, 3): continue
        out.append({"per": (pl.get("period") or {}).get("number") or 1, "secs": secs_of((pl.get("clock") or {}).get("displayValue")),
                    "team": str((pl.get("team") or {}).get("id")), "is3": pa == 3, "used": False})
    return out, teams

TWO = re.compile(r"two point|2 pointer|layup|dunk|tip|hook|alley|putback", re.I)
def process_game(nid, og):
    """→ list of stints [{H:[ids],A:[ids],secs,low,h:{box},a:{box}}], team names, names map"""
    pbp = B.pbp_json(nid)
    if not pbp or not pbp.get("periods"): return None, "no-pbp"
    teams = pbp.get("teams", [])
    if len(teams) != 2: return None, "teams"
    box = cached_json(f"box_{og['id']}.json", lambda: B.sb_get(f"box_scores?game_id=eq.{og['id']}&select=player,espn_id,team,starter,min"))
    if not box: return None, "no-box"
    bteams = list({b["team"] for b in box if b.get("team")})
    if len(bteams) < 2: return None, "box-teams<2"
    tov = B._tov
    h_team = max(bteams, key=lambda bt: (tov(bt, og["home"]), -tov(bt, og["away"])))
    a_team = max([bt for bt in bteams if bt != h_team], key=lambda bt: tov(bt, og["away"]))
    def side_map(bteam):
        rows = [b for b in box if b["team"] == bteam and b.get("espn_id") is not None]
        n2e = {nn(b["player"]): str(b["espn_id"]) for b in rows}
        last = defaultdict(list)
        for b in rows: last[nn(b["player"]).split(" ")[-1]].append(str(b["espn_id"]))
        for k, v in last.items():
            if len(v) == 1: n2e.setdefault("~" + k, v[0])   # unique surname on the roster: a fallback key
        st = [b for b in rows if b.get("starter")]
        if len(st) != 5:
            rows.sort(key=lambda b: -B._minf(b.get("min"))); st = rows[:5]
        return n2e, [str(b["espn_id"]) for b in st][:5]
    ncaa_home = next((t for t in teams if t.get("isHome")), teams[0])
    box_home = max([h_team, a_team], key=lambda bt: tov(ncaa_home["nameShort"], bt) + tov(ncaa_home.get("nameFull", ""), bt))
    box_away = a_team if box_home == h_team else h_team
    hn2e, hstart = side_map(box_home); an2e, astart = side_map(box_away)
    if len(hstart) != 5 or len(astart) != 5: return None, "starters"
    on = {"H": set(hstart), "A": set(astart)}; n2e = {"H": hn2e, "A": an2e}
    # half of 2024-25 logs substitutions only as "<Team> lineup change (four names)" — never all five, so who is on the
    # floor can't be followed. Those games would credit the starters with every minute: skip them (CBBD covers that season)
    if sum(1 for per in pbp["periods"] for pl in per.get("playbyplayStats", []) if (pl.get("eventDescription") or "").startswith("Subbing")) < 20:
        return None, "no-subs"
    # one play-by-play format says "Jumper MISSED by …" with no 2 or 3: fill those from ESPN by period, clock and team
    amb = any("MISSED by" in (pl.get("eventDescription") or "") for per in pbp["periods"] for pl in per.get("playbyplayStats", []))
    EM, eteam = (espn_misses(og["id"]) if amb else ([], {}))
    side_team = {}
    if EM:
        for tid, nm in eteam.items():
            side_team[tid] = "H" if tov(nm, box_home) >= tov(nm, box_away) else "A"
    def miss_is3(pn, s, side):
        best = None
        for m in EM:
            if m["used"] or m["per"] != pn or side_team.get(m["team"]) != side or m["secs"] is None or s is None: continue
            dd = abs(m["secs"] - s)
            if dd <= 4 and (best is None or dd < best[0]): best = (dd, m)
        if best: best[1]["used"] = True; return 1.0 if best[1]["is3"] else 0.0
        return 0.45   # no ESPN match: about the share of missed jumpers that are threes
    stints = []; cur = {"secs": 0.0, "low": {False: [blank(), blank(), 0.0], True: [blank(), blank(), 0.0]}}
    bad = 0

    def close():
        for low in (False, True):
            h, a, s = cur["low"][low]
            if s <= 0 and not any(h.values()) and not any(a.values()): continue
            stints.append({"H": sorted(on["H"]), "A": sorted(on["A"]), "secs": round(s, 1), "low": low, "h": dict(h), "a": dict(a)})
        cur["low"] = {False: [blank(), blank(), 0.0], True: [blank(), blank(), 0.0]}

    for per in pbp["periods"]:
        pn = int(per.get("periodNumber") or 1)
        prev_h = prev_a = None; prev_sig = None; last_secs = 1200 if pn <= 2 else 300
        last_miss = None   # (side, dead_ball) of the last missed shot: decides who an unlabelled rebound belongs to
        last_shot = None   # (side, clock) of the last missed field goal: a block line right after it is the same shot
        pend = {"H": [], "A": []}   # made field goals whose points the score hasn't shown yet: [box, value or None]
        def credit(bucket, dh, da):
            """the score moved: first pay any made field goal still owed (the feed often updates the score a line
            late — on the next foul, rebound or substitution), the rest is made free throws"""
            for sd, d in (("H", dh), ("A", da)):
                if d <= 0: continue
                bx = bucket[0] if sd == "H" else bucket[1]
                bx["pts"] += d
                while d > 0 and pend[sd]:
                    fbox, val = pend[sd][0]
                    if val is None:   # a made "Jumper" with no 2 or 3 in the text: the score says which
                        val = 3 if d >= 3 else 2
                        fbox["tpa"] += 1 if val == 3 else 0; fbox["tpm"] += 1 if val == 3 else 0
                    if d >= val: d -= val; pend[sd].pop(0)
                    else: pend[sd][0] = [fbox, val - d]; d = 0
                if d > 0: bx["ftm"] += d; bx["fta"] += d
        for pl in per.get("playbyplayStats", []):
            desc = pl.get("eventDescription", "") or ""
            try: hs = int(pl.get("homeScore") or 0); as_ = int(pl.get("visitorScore") or 0)
            except Exception: hs = as_ = 0
            s = secs_of(pl.get("clock"))
            low = low_leverage(pn, s, hs - as_)
            bucket = cur["low"][low]
            if s is not None and s <= last_secs:
                bucket[2] += last_secs - s; last_secs = s
            # credit points only when the score passes its high-water mark: a scorer's correction (down, then back up)
            # was being counted twice — that was the +7% of made free throws vs the box score
            dh = (hs - prev_h) if prev_h is not None else 0
            da = (as_ - prev_a) if prev_a is not None else 0
            prev_h = hs if prev_h is None else max(prev_h, hs); prev_a = as_ if prev_a is None else max(prev_a, as_)
            m = SUB2.match(desc)
            if m:
                credit(bucket, dh, da)   # points that arrive on a substitution line belong to the five before it
                close()
                # "Subbing in for Bethune-Cookman-Quentin Heady": the team name can hold hyphens too, so try every
                # split until the left part is one of the two teams (build_onoff's regex cut at the first hyphen)
                io, rest = m.group(1), m.group(2)
                side = player = None
                parts = rest.split("-")
                for cut in range(1, len(parts)):
                    tm = "-".join(parts[:cut])
                    for t in teams:
                        if B.norm(tm) in (B.norm(t["nameShort"]), B.norm(t.get("nameFull", ""))):
                            side = "H" if t["isHome"] else "A"; player = "-".join(parts[cut:]); break
                    if side: break
                if side is None: bad += 1; continue
                pk = nn(player)
                eid = n2e[side].get(pk) or n2e[side].get("~" + (pk.split(" ")[-1] if pk else ""))
                if eid is None: bad += 1; continue
                (on[side].add if io == "in" else on[side].discard)(eid)
                continue
            side = "H" if pl.get("isHome") else "A"
            box_s = bucket[0] if side == "H" else bucket[1]
            k = kind(desc)
            if "assists)" in desc.lower(): box_s["ast"] += 1
            dl = desc.lower(); sig = re.sub(r"\s+", "", re.sub(r"\(.*?\)", "", dl))
            dup = bool(sig) and sig == prev_sig
            prev_sig = sig
            if not dup and k == "fga":
                made = not re.search(r"miss", dl)
                box_s["fga"] += 1
                last_miss = None if made else (side, False)
                last_shot = None if made else (side, s)
                if made:
                    box_s["fgm"] += 1
                    if THREE.search(desc): box_s["tpa"] += 1; box_s["tpm"] += 1; pend[side].append([box_s, 3])
                    elif TWO.search(desc): pend[side].append([box_s, 2])
                    else: pend[side].append([box_s, None])
                else:
                    if THREE.search(desc): p3 = 1.0
                    elif TWO.search(desc): p3 = 0.0
                    else: p3 = miss_is3(pn, s, side) if amb else 0.0
                    box_s["tpa"] += p3
            elif not dup and k in ("orb", "drb"):
                # one feed labels EVERY rebound "defensive rebound", so the label can't be trusted: a rebound by the
                # side that missed is offensive. The "team rebound" between two free throws is not a rebound at all,
                # and team (dead-ball) rebounds are left out like the box score does (they ran ORB +10%)
                team_reb = bool(re.match(r"^team\b", dl) or re.search(r"'s team\b|\bteam$", dl))
                if not team_reb:   # 2024-25 writes team rebounds as the nickname ("Tigers offensive rebound") or no name
                    mm = re.match(r"^(.*?) (offensive|defensive) rebound", desc, re.I) or re.search(r"rebound by .*?'s (.+)$", desc, re.I)
                    rn = nn(mm.group(1)) if mm else ""
                    known = bool(rn) and any(rn in n2e[x] or ("~" + rn.split(" ")[-1]) in n2e[x] for x in ("H", "A"))
                    nick = any(nn(t).endswith(" " + rn) or nn(t) == rn for t in (box_home, box_away)) if rn else True
                    team_reb = (not known) and (not rn or nick or " " not in rn)
                if last_miss is not None:
                    if not last_miss[1] and not team_reb:
                        box_s["orb" if last_miss[0] == side else "drb"] += 1
                    last_miss = None
                elif not team_reb:
                    box_s[k] += 1
            elif not dup and k == "blk":
                box_s["blk"] += 1
                # 2024-25 writes a blocked shot ONLY as "X blocks Y's two point layup" (no miss line): then it is the
                # shooter's missed attempt. 2025-26 also logs the miss itself, so only count it when no miss by the
                # shooting side was just logged at this clock.
                shooter = "A" if side == "H" else "H"
                if not (last_shot and last_shot[0] == shooter and last_shot[1] == s):
                    sbx = bucket[0] if shooter == "H" else bucket[1]
                    sbx["fga"] += 1; sbx["tpa"] += 1 if THREE.search(desc) else 0
                    last_miss = (shooter, False)
            elif not dup and k in ("tov", "stl"):
                box_s[k] += 1
            elif not dup and k == "ast":
                box_s["ast"] += 1
            elif not dup and k == "ftmiss":
                box_s["fta"] += 1
                last_miss = (side, bool(re.search(r"\b(1 of 2|1 of 3|2 of 3)\b", dl)))
            credit(bucket, dh, da)
    close()
    # the same partial-feed guard as build_onoff: a complete game has ~55-80 possessions a side
    tot = {"H": blank(), "A": blank()}
    for st in stints:
        for f in F: tot["H"][f] += st["h"][f]; tot["A"][f] += st["a"][f]
    for sd in ("H", "A"):
        p = poss(tot[sd])
        if p < 45 or p > 110: return None, "bad-poss"
        o = 100 * tot[sd]["pts"] / p
        if o < 55 or o > 150: return None, "bad-ortg"
    if bad > 8: return None, "bad-subs"   # lineups we can't follow would credit the wrong players
    names = {str(b["espn_id"]): b["player"] for b in box if b.get("espn_id") is not None}
    return {"stints": stints, "teamH": box_home, "teamA": box_away, "names": names, "bad": bad}, "ok"

# ── CBBD source (2023-24): every play carries the ten players on the floor, so stints come straight from it ──
CBBD_API = "https://api.collegebasketballdata.com"
CBBD_CACHE = os.path.join(DATADIR, "cbbd_cache")
def cbbd_day(d, key):
    """all plays for one day (not only shots), cached gz — one API call per day, ~150 a season"""
    import gzip, urllib.parse
    os.makedirs(CBBD_CACHE, exist_ok=True)
    fp = os.path.join(CBBD_CACHE, f"playsall_{d}.json.gz")
    if os.path.exists(fp):
        try: return json.load(gzip.open(fp))
        except Exception: pass
    if not key: return None
    url = CBBD_API + "/plays/date?" + urllib.parse.urlencode({"date": d})
    for a in range(4):
        try:
            req = urllib.request.Request(url, headers={"Authorization": "Bearer " + key, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=300) as r:
                v = json.loads(r.read().decode()); print(f"  {d}: {len(v)} plays (calls left {r.headers.get('X-CallLimit-Remaining')})", flush=True)
                json.dump(v, gzip.open(fp, "wt")); time.sleep(0.6); return v
        except Exception as e:
            print("  retry", d, e, flush=True); time.sleep(3 * (a + 1))
    return None

def process_cbbd_game(plays, gid):
    """one game's CBBD plays → the same {stints, teamH, teamA, names} process_game returns"""
    box = cached_json(f"box_{gid}.json", lambda: B.sb_get(f"box_scores?game_id=eq.{gid}&select=player,espn_id,team,starter,min"))
    if not box: return None, "no-box"
    bteams = list({b["team"] for b in box if b.get("team")})
    if len(bteams) < 2: return None, "box-teams<2"
    p0 = plays[0]
    home = p0["team"] if p0.get("isHomeTeam") else p0["opponent"]; away = p0["opponent"] if p0.get("isHomeTeam") else p0["team"]
    box_home = max(bteams, key=lambda bt: (B._tov(bt, home), -B._tov(bt, away)))
    box_away = next(bt for bt in bteams if bt != box_home)
    def keys(team):
        rows = [b for b in box if b["team"] == team and b.get("espn_id") is not None]
        m = {nn(b["player"]): str(b["espn_id"]) for b in rows}
        last = defaultdict(list)
        for b in rows: last[nn(b["player"]).split(" ")[-1]].append(str(b["espn_id"]))
        for k, v in last.items():
            if len(v) == 1: m.setdefault("~" + k, v[0])
        return m
    km = {"H": keys(box_home), "A": keys(box_away)}
    cid = {}
    def eid(pl, sd):
        k = (pl.get("id"), sd)
        if k not in cid:
            n = nn(pl.get("name")); cid[k] = km[sd].get(n) or km[sd].get("~" + (n.split(" ")[-1] if n else ""))
        return cid[k]
    plays = sorted(plays, key=lambda p: (p.get("period") or 1, -(p.get("secondsRemaining") or 0), p.get("id") or 0))
    stints = []; cur = None; bad = 0; last_secs = {}; last_miss = None
    def flush():
        if cur and (cur["secs"] > 0 or any(cur["h"].values()) or any(cur["a"].values())): stints.append(cur)
    prev = {"H": None, "A": None}
    for pl in plays:
        fl = pl.get("onFloor") or []
        hsd = {True: "H", False: "A"}[bool(pl.get("isHomeTeam"))]
        tname = pl.get("team")
        H, A = [], []
        for x in fl:
            sd = hsd if x.get("team") == tname else ("A" if hsd == "H" else "H")
            e = eid(x, sd)
            (H if sd == "H" else A).append(e)
        # CBBD's on-floor lists are noisy (9, 11, even 13 names). Repair a side against its previous five: too few →
        # top up with the previous five's missing men; too many → keep who was already on, then newcomers, to five
        for sd in ("H", "A"):
            L = [e for e in (H if sd == "H" else A) if e is not None]
            L = list(dict.fromkeys(L))
            pv = prev[sd]
            if len(L) != 5 and pv:
                if len(L) < 5: L += [e for e in pv if e not in L][:5 - len(L)]
                else: L = ([e for e in L if e in pv] + [e for e in L if e not in pv])[:5]
            if sd == "H": H = L
            else: A = L
        if None in H or None in A or len(H) != 5 or len(A) != 5: bad += 1; continue
        prev["H"], prev["A"] = list(H), list(A)
        per = pl.get("period") or 1; secs = pl.get("secondsRemaining")
        low = low_leverage(per, secs, (pl.get("homeScore") or 0) - (pl.get("awayScore") or 0))
        key = (tuple(sorted(H)), tuple(sorted(A)), low)
        if cur is None or cur["key"] != key:
            flush(); cur = {"key": key, "H": list(key[0]), "A": list(key[1]), "secs": 0.0, "low": low, "h": blank(), "a": blank()}
        ls = last_secs.get(per, 1200 if per <= 2 else 300)
        if secs is not None and secs <= ls: cur["secs"] += ls - secs; last_secs[per] = secs
        bx = cur["h"] if hsd == "H" else cur["a"]
        t = (pl.get("playType") or ""); tl = t.lower(); made = bool(pl.get("scoringPlay"))
        team_play = not (pl.get("participants") or [])
        if t in ("JumpShot", "LayUpShot", "DunkShot", "TipShot") or (pl.get("shootingPlay") and "free" not in tl):
            si = pl.get("shotInfo") or {}
            is3 = si.get("range") == "three_pointer" or pl.get("scoreValue") == 3
            bx["fga"] += 1; bx["tpa"] += 1 if is3 else 0
            if made: bx["fgm"] += 1; bx["tpm"] += 1 if is3 else 0; bx["pts"] += 3 if is3 else 2; last_miss = None
            else: last_miss = hsd
            if si.get("assisted"): bx["ast"] += 1
        elif "freethrow" in tl.replace(" ", ""):
            bx["fta"] += 1
            if made: bx["ftm"] += 1; bx["pts"] += 1
            else: last_miss = hsd
        elif "offensive rebound" in tl and not team_play: bx["orb"] += 1
        elif "defensive rebound" in tl and not team_play: bx["drb"] += 1
        elif "turnover" in tl: bx["tov"] += 1
        elif tl == "steal": bx["stl"] += 1
        elif "block" in tl: bx["blk"] += 1
    flush()
    for st in stints: st.pop("key", None); st["secs"] = round(st["secs"], 1)
    if bad > max(15, 0.06 * len(plays)): return None, "bad-onfloor"   # lineups we can't follow
    tot = {"H": blank(), "A": blank()}
    for st in stints:
        for f in F: tot["H"][f] += st["h"][f]; tot["A"][f] += st["a"][f]
    for sd in ("H", "A"):
        pp = poss(tot[sd])
        if pp < 45 or pp > 110: return None, "bad-poss"
    names = {str(b["espn_id"]): b["player"] for b in box if b.get("espn_id") is not None}
    return {"stints": stints, "teamH": box_home, "teamA": box_away, "names": names, "bad": bad}, "ok"

def cbbd_games(season):
    """→ [(gid, plays)] for the season from the CBBD day files (pulls missing days with CBBD_KEY)"""
    key = (os.environ.get("CBBD_KEY") or "").strip()
    days = sorted({r["date"] for r in B.sb_get(f"games?select=date&season_year=eq.{season}&order=date&limit=10000")})
    out = []
    missing = 0
    for d in days:
        v = cbbd_day(d, key)
        if v is None: missing += 1; continue
        g = defaultdict(list)
        for pl in v: g[str(pl.get("gameSourceId") or pl.get("gameId"))].append(pl)
        out.extend(g.items())
    if missing: print(f"*** {missing} of {len(days)} days have no CBBD plays — set CBBD_KEY to pull them ***", flush=True)
    return out

def poss(b): return max(0.0, b["fga"] - b["orb"] + b["tov"] + 0.44 * b["fta"])

def rates(o, d, secs, lg=None):
    """four factors for a unit: o = its own box, d = the opponent's box while it was on"""
    po, pd = poss(o), poss(d)
    def pct(n, den): return round(100 * n / den, 1) if den > 0 else None
    def ts(b): return pct(b["pts"], 2 * (b["fga"] + 0.44 * b["fta"]))
    def efg(b): return pct(b["fgm"] + 0.5 * b["tpm"], b["fga"])
    out = {"min": round(secs / 60, 1), "poss": round((po + pd) / 2),
           "o": pct(o["pts"], po), "d": pct(d["pts"], pd),
           "ts": ts(o), "efg": efg(o), "tov": pct(o["tov"], po), "orb": pct(o["orb"], o["orb"] + d["drb"]),
           "ftr": pct(o["fta"], o["fga"]), "ast": pct(o["ast"], o["fgm"]),
           "ots": ts(d), "oefg": efg(d), "otov": pct(d["tov"], pd), "drb": pct(d["drb"], d["drb"] + o["orb"])}
    out["net"] = round(out["o"] - out["d"], 1) if out["o"] is not None and out["d"] is not None else None
    out.update({"tp": pct(o["tpm"], o["tpa"]), "tpar": pct(o["tpa"], o["fga"]), "ftp": pct(o["ftm"], o["fta"]), "otp": pct(d["tpm"], d["tpa"])})
    if lg:   # luck adjusted: own FT%, and the opponent's 3P% and FT%, set to the D-I average (what a unit controls stays)
        L3, LF = lg["tp3"], lg["ft"]
        op = o["pts"] - (o["ftm"] - o["fta"] * LF)
        dp = d["pts"] - (d["ftm"] - d["fta"] * LF) - 3 * (d["tpm"] - d["tpa"] * L3)
        out["ol"] = pct(op, po); out["dl"] = pct(dp, pd)
        out["netl"] = round(out["ol"] - out["dl"], 1) if out["ol"] is not None and out["dl"] is not None else None
    return out

def add(dst, src):
    for f in F: dst[f] += src[f]

def run(season, limit=0, verbose=False, source="ncaa"):
    if source == "cbbd":
        games = cbbd_games(season)
        print(f"season {season}: {len(games)} CBBD games", flush=True)
        work = [(gid, (lambda gid=gid, pl=pl: process_cbbd_game(pl, gid))) for gid, pl in games]
        return aggregate(season, work, limit, verbose)
    games_fp = os.path.join(CACHE, f"games_{season}.json")
    gmap = {}
    if os.path.exists(games_fp):
        try: gmap = json.load(open(games_fp))
        except Exception: gmap = {}
    if not gmap:   # nid -> our game, by day (scoreboards are the slow, rate-limited part — kept once)
        for d in B.season_dates(season):
            sb = B.scoreboard(d)
            if not sb: continue
            our = B.our_games_on(d)
            for ncaa in sb or []:
                og = B.match_our_game(our or [], ncaa)
                if og: gmap[ncaa["nid"]] = og
            time.sleep(0.05)
            if verbose: print(d, len(gmap), flush=True)
        os.makedirs(CACHE, exist_ok=True); json.dump(gmap, open(games_fp, "w"))
    print(f"season {season}: {len(gmap)} matched games", flush=True)
    work = [(nid, (lambda nid=nid, og=og: process_game(nid, og))) for nid, og in gmap.items()]
    return aggregate(season, work, limit, verbose)

def aggregate(season, work, limit, verbose):
    P = defaultdict(lambda: {"team": None, "name": None, "games": 0, "on_o": blank(), "on_d": blank(), "on_s": 0.0, "tm_o": blank(), "tm_d": blank(), "tm_s": 0.0})
    U = {n: defaultdict(lambda: {"o": blank(), "d": blank(), "s": 0.0, "team": None}) for n in (2, 3, 4, 5)}
    STINTS = []; names = {}; fails = defaultdict(int); done = 0
    for i, (nid, fn) in enumerate(work):
        if limit and done >= limit: break
        res, why = fn()
        if res is None: fails[why] += 1; continue
        done += 1; names.update(res["names"])
        seen = set(); gt = {"H": [blank(), blank(), 0.0], "A": [blank(), blank(), 0.0]}
        for st in res["stints"]:
            if st["low"]: continue
            for sd, own, opp, team in (("H", st["h"], st["a"], res["teamH"]), ("A", st["a"], st["h"], res["teamA"])):
                add(gt[sd][0], own); add(gt[sd][1], opp); gt[sd][2] += st["secs"]
                ids = st[sd]
                for e in ids:
                    p = P[e]; p["team"] = team; add(p["on_o"], own); add(p["on_d"], opp); p["on_s"] += st["secs"]; seen.add((e, sd))
                if len(ids) == 5:
                    for n in (2, 3, 4, 5):
                        for c in combinations(ids, n):
                            u = U[n][c]; u["team"] = team; add(u["o"], own); add(u["d"], opp); u["s"] += st["secs"]
            if len(st["H"]) == 5 and len(st["A"]) == 5:
                STINTS.append((tuple(st["H"]), tuple(st["A"]), poss(st["h"]), st["h"]["pts"], poss(st["a"]), st["a"]["pts"]))
        for e, sd in seen:   # team totals for the games he played (off-court = team − on-court)
            p = P[e]; p["games"] += 1; add(p["tm_o"], gt[sd][0]); add(p["tm_d"], gt[sd][1]); p["tm_s"] += gt[sd][2]
        if done % 250 == 0: print(f"  {done} games", flush=True)
    print(f"processed {done}; failures {dict(fails)}", flush=True)

    # league: every full-strength stint, both sides
    tot_o = blank(); tot_d = blank()
    for c, u in U[5].items(): add(tot_o, u["o"]); add(tot_d, u["d"])
    league = rates(tot_o, tot_d, 0)
    LG = {"tp3": tot_o["tpm"] / max(1, tot_o["tpa"]), "ft": tot_o["ftm"] / max(1, tot_o["fta"])}
    league.update({"tp3_raw": round(LG["tp3"], 4), "ft_raw": round(LG["ft"], 4)})
    print(f"[league] ORtg {league['o']}  TS {league['ts']}  TOV {league['tov']}  ORB {league['orb']}  3P% {league['tp']}  3PAr {league['tpar']}  FT% {league['ftp']}", flush=True)
    if not league["o"] or not (90 <= league["o"] <= 120):
        print("*** SANITY FAIL: league ORtg implausible — not writing ***"); return

    rapm = ridge(STINTS, league["o"]) if STINTS else {}
    players = []
    for e, p in P.items():
        if p["on_s"] < 60 * 30: continue   # 30+ minutes
        on = rates(p["on_o"], p["on_d"], p["on_s"], LG)
        off_o = {f: p["tm_o"][f] - p["on_o"][f] for f in F}; off_d = {f: p["tm_d"][f] - p["on_d"][f] for f in F}
        off = rates(off_o, off_d, max(0.0, p["tm_s"] - p["on_s"]), LG) if p["tm_s"] - p["on_s"] >= 60 * 20 else None
        r = rapm.get(e)
        players.append({"id": e, "name": names.get(e) or p.get("name"), "team": p["team"], "g": p["games"], "on": on, "off": off,
                        "rapm": r})
    units = defaultdict(dict)
    for n in (2, 3, 4, 5):
        byteam = defaultdict(list)
        for c, u in U[n].items():
            r = rates(u["o"], u["d"], u["s"], LG)
            if r["poss"] < MIN_UNIT_POSS[n]: continue
            byteam[u["team"]].append({"ids": list(c), "r": r})
        for t, arr in byteam.items():
            arr.sort(key=lambda x: -x["r"]["poss"])
            units[t][str(n)] = arr[:TOP_UNITS]
    # two files: players (the WOWY tab + league leaders, loads with the page) and units (2/3/4/5-man, loaded on demand)
    out = {"season": season, "built": time.strftime("%Y-%m-%d"), "low_leverage_removed": True, "games": done,
           "league": league, "players": players}
    uo = {"season": season, "names": {e: names.get(e) for e in {i for t in units.values() for n in t.values() for u in n for i in u["ids"]}}, "units": units}
    json.dump(uo, open(os.path.join(DATADIR, f"wowy_units_{season}.json"), "w"), separators=(",", ":"))
    fp = os.path.join(DATADIR, f"wowy_{season}.json")
    json.dump(out, open(fp, "w"), separators=(",", ":"))
    print(f"wrote {fp}: {len(players)} players, {sum(len(v) for t in units.values() for v in t.values())} units, {os.path.getsize(fp)//1024} KB")
    if verbose:
        for p in sorted(players, key=lambda x: -(x["on"]["poss"]))[:8]:
            print(f"  {p['name'][:22]:22} {p['team'][:16]:16} on {p['on']['net']:>6} off {(p['off'] or {}).get('net')} rapm {p['rapm']}")

def ridge(stints, avg, lam=None):
    """offense + defense RAPM per 100. Each stint gives two rows (home offense vs away defense and back),
    weighted by possessions; ridge shrinks every player toward zero (= league average)."""
    try:
        import numpy as np
        from scipy.sparse import csr_matrix
        from scipy.sparse.linalg import lsqr
    except Exception:
        print("numpy/scipy missing — RAPM skipped"); return {}
    idx = {}
    for h, a, *_ in stints:
        for e in h + a:
            if e not in idx: idx[e] = len(idx)
    n = len(idx); rows, cols, vals, y, w = [], [], [], [], []
    r = 0
    for h, a, hp, hpts, ap, apts in stints:
        for off, de, p, pts in ((h, a, hp, hpts), (a, h, ap, apts)):
            if p <= 0.5: continue
            sw = p ** 0.5
            for e in off: rows.append(r); cols.append(idx[e]); vals.append(sw)
            for e in de: rows.append(r); cols.append(n + idx[e]); vals.append(sw)
            y.append(sw * (100 * pts / p - avg)); r += 1
    X = csr_matrix((vals, (rows, cols)), shape=(r, 2 * n))
    lam = lam or float(os.environ.get("RAPM_LAMBDA", "1500"))
    sol = lsqr(X, np.array(y), damp=lam ** 0.5)[0]
    out = {}
    for e, i in idx.items():
        o, d = float(sol[i]), -float(sol[n + i])   # defense: allowing fewer points is positive
        out[e] = {"o": round(o, 1), "d": round(d, 1), "net": round(o + d, 1)}
    print(f"[rapm] {r} rows, {n} players, lambda {lam}", flush=True)
    return out

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--source", default="ncaa", choices=["ncaa", "cbbd"], help="cbbd = CollegeBasketballData on-floor plays (2023-24); needs CBBD_KEY to pull")
    a = ap.parse_args()
    run(a.season, a.limit, a.verbose, a.source)
