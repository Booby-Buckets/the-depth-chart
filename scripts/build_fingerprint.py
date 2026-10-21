#!/usr/bin/env python3
"""build_fingerprint.py — the Skill Fingerprint: every D-I player's value split into 15 skills, in points per
100 possessions he was on the floor for, schedule-adjusted. Our own credit model on ESPN play-by-play.

THE MODEL (credit accounting). Every possession starts worth B (the league's points per possession). Each event
moves the possession's expected value, and that change is credited to the players involved:
  made FG (p pts)   p - B            shooter, or shooter + passer (an assist takes A_Z[zone] of it: the passer gets
                                     more on a layup, less on a three the shooter had to make)
  missed FG         -B(1-r)          shooter                     (r = the league's offensive-rebound rate)
  off. rebound      +B(1-r)          rebounder (REB_SH of it)
  def. rebound      rB  (defense)    rebounder (REB_SH of it)
  turnover          -B               ball handler; a steal hands STEAL_SH of the defense's +B to the stealer
  blocked shot      the miss's B(1-r) to the defense, BLOCK_SH of it to the blocker
  FT trip           points - B (0 after an and-one): the shooter's execution (made - f per attempt, f = league
                    FT%) is "Free throws"; the rest (f x attempts - B) is the foul — credit to the fouled player
                    ("Drawing fouls"), blame to the fouler ("Fouls")
The defense's total in a game is exactly minus the offense's; what the steal / block / rebound / foul carve-outs
don't assign goes to the five on the floor by minutes ("Team defense") — college play-by-play has no matchup data.
Scoring credits are split by zone (rim, putbacks, mid-range, threes) and an unassisted make keeps the passer's
share as "Self-creation".

SCHEDULE: B is moved by the opponent — a player's offensive credits are measured against B + (opponent adjD - avg)/100
(a weak defense raises the bar), his defensive credits against B + (opponent adjO - avg)/100 (from team_dna.json).

    python3 scripts/build_fingerprint.py 2026          # one season (play-by-play cached in scripts/data/espn_pbp_cache)
Writes scripts/data/fingerprint/<season>.json.
"""
import gzip, json, os, re, sys, time, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(HERE, "data")
CACHE = os.path.join(D, "espn_pbp_cache"); OUT = os.path.join(D, "fingerprint")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"
KEY = re.search(r"sb_publishable_[A-Za-z0-9_-]+", open(os.path.join(HERE, "..", "player.html")).read()).group(0)
SUM = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event="

A_Z = {"rim": 0.40, "put": 0.10, "mid": 0.25, "three": 0.30}   # the passer's share of an assisted make
STEAL_SH, BLOCK_SH = 0.70, 0.50
REB_SH = 0.70             # the rebounder's share of a rebound's value: box-outs and the shot's angle are team work (the rest of a
                          # defensive board goes to the five on the floor; the rest of an offensive one to nobody)
MIN_POSS = 500            # percentile pool: ~250+ minutes
SKILLS = [   # key, label, group
    ("rim", "Rim finishing", "Scoring"), ("put", "Putbacks", "Scoring"), ("mid", "Mid-range", "Scoring"),
    ("three", "Three-point shooting", "Scoring"), ("ft", "Free throws", "Scoring"),
    ("self", "Self-creation", "Creation"), ("pass", "Passing", "Creation"), ("drawn", "Drawing fouls", "Creation"),
    ("tov", "Ball security", "Creation"),
    ("oreb", "Offensive rebounding", "Rebounding"), ("dreb", "Defensive rebounding", "Rebounding"),
    ("stl", "Steals", "Defense"), ("blk", "Blocks", "Defense"), ("foul", "Fouls", "Defense"), ("team", "Team defense", "Defense")]
OFF = {"rim", "put", "mid", "three", "ft", "self", "pass", "drawn", "tov", "oreb"}

def sb(q):
    out = []
    for off in range(0, 10 ** 6, 1000):
        for t in range(4):
            try:
                r = json.load(urllib.request.urlopen(urllib.request.Request(SB + q + f"&limit=1000&offset={off}", headers={"apikey": KEY, "Authorization": "Bearer " + KEY}), timeout=60)); break
            except Exception:
                time.sleep(2 * (t + 1))
        else:
            raise SystemExit("supabase failed: " + q)
        out += r
        if len(r) < 1000: return out

def summary(gid):
    fp = os.path.join(CACHE, f"{gid}.json.gz")
    if os.path.exists(fp):
        try: return json.load(gzip.open(fp))
        except Exception: pass
    for t in range(4):
        try:
            j = json.load(urllib.request.urlopen(SUM + str(gid), timeout=30))
            keep = {k: j.get(k) for k in ("header", "boxscore", "plays", "gameInfo")}
            os.makedirs(CACHE, exist_ok=True); gzip.open(fp, "wt").write(json.dumps(keep)); return keep
        except Exception:
            time.sleep(1.5 * (t + 1))
    return None

DIST = re.compile(r"(\d+)-foot")
FT_OF = re.compile(r"free throw (\d) of (\d)", re.I)

def zone(p):
    if (p.get("pointsAttempted") or 0) == 3: return "three"
    ty, tx = p["type"]["text"], p.get("text", "").lower()
    if ty == "TipShot" or "tip" in tx or "putback" in tx: return "put"
    if ty in ("DunkShot", "LayUpShot") or "layup" in tx or "dunk" in tx: return "rim"
    m = DIST.search(tx)
    return "rim" if (m and int(m.group(1)) <= 4) else "mid"

def parse(s):
    """one game -> (team ids, minutes {team:{pid:min}}, names, event list). Each event: (side team, credits) where
    credits = [(pid or None, skill, a, b)] on the OFFENSE's books (value = a + b*B); defense carve-outs are listed
    with side='def' and carry the defense's own sign."""
    comp = ((s.get("header") or {}).get("competitions") or [{}])[0]
    teams = [str(c["id"]) for c in comp.get("competitors") or []]
    if len(teams) != 2: return None
    mins, names = {t: {} for t in teams}, {}
    for bp in (s.get("boxscore") or {}).get("players") or []:
        tid = str(bp["team"]["id"]); st = (bp.get("statistics") or [{}])[0]
        keys = st.get("keys") or []
        if tid not in mins or "minutes" not in keys: continue
        ki = keys.index("minutes")
        for a in st.get("athletes") or []:
            try: m = float(a["stats"][ki])
            except Exception: continue
            if m > 0:
                pid = str(a["athlete"]["id"]); mins[tid][pid] = m; names[pid] = a["athlete"].get("displayName")
                if a.get("starter"): names.setdefault("_starters", {}).setdefault(tid, []).append(pid)
                pos = ((a["athlete"].get("position") or {}).get("abbreviation") or "")
                if pos: names.setdefault("_pos", {})[pid] = pos
    return teams, mins, names, s.get("plays") or []

def tally(plays, teams, L, lineup=None):
    """turn a game's plays into credit rows. L = league constants {r, rf, f}.
    lineup = {team: [starter ids]} turns on floor tracking: then a third value comes back, ctxs[i] = the context of
    rows[i] — (players on the floor for teams[0], for teams[1], close-and-late flag)."""
    other = {teams[0]: teams[1], teams[1]: teams[0]}
    rows = []          # (off_team, pid, skill, a, b, is_def)
    cnt = {t: defaultdict(float) for t in teams}
    pc = defaultdict(lambda: defaultdict(float)); cnt["_p"] = pc     # per player: fga, fgm, astd (assisted makes), tpa, fta, tov
    last_miss = None   # ('fg'|'ft', team)
    last_foul = {}     # defending team -> (pid, clock)
    trip = None        # open FT trip
    last_make = None   # (team, clock) of the latest made FG, for and-ones
    last_miss_box = [None]
    ctxs = [] if lineup else None
    on = {t: list(lineup.get(t) or [])[:5] for t in teams} if lineup else None
    seen = {}; state = {"clutch": False}
    def add(row):
        rows.append(row)
        if ctxs is not None: ctxs.append((tuple(on[teams[0]]), tuple(on[teams[1]]), state["clutch"]))
    def floor(t, pid, i):
        """substitutions miss some swaps (halftime above all): a player who acts is on the floor; if that makes six,
        the one who has gone longest without being seen leaves"""
        seen[pid] = i
        if pid in on[t]: return
        on[t].append(pid)
        if len(on[t]) > 5: on[t].remove(min((x for x in on[t] if x != pid), key=lambda x: seen.get(x, -1)))
    hs = as_ = 0; home = None
    def close_trip():
        nonlocal trip
        if not trip: return
        t, sh, made, att, andone, missed_last = trip["t"], trip["pid"], trip["made"], trip["att"], trip["andone"], trip["miss_last"]
        if trip["n"] is None: andone = trip["after_make"] and att == 1   # unlabelled feed: a lone FT after a make = and-one
        if missed_last: last_miss_box[0] = ("ft", t)
        f = L["f"]
        b_tot = (0.0 if andone else -1.0) + (L["rf"] if missed_last else 0.0)
        add((t, sh, "ft", made - f * att, 0.0, False))
        add((t, sh, "drawn", f * att, b_tot, False))
        fl = trip.get("fouler")
        if fl: add((t, fl, "foul", -f * att, -b_tot, True))     # the fouler wears the foul part (defense sign)
        trip = None
    for p in plays:
        ty = p["type"]["text"]; tx = (p.get("text") or ""); tl = tx.lower()
        tid = str((p.get("team") or {}).get("id") or "")
        parts = [str(x["athlete"]["id"]) for x in p.get("participants") or [] if x.get("athlete")]
        clock = (p.get("period") or {}).get("number"), (p.get("clock") or {}).get("displayValue")
        if tid not in other: continue
        if on is not None:
            i = len(seen) + 1
            per = (p.get("period") or {}).get("number") or 1
            try: mm, ss = (p.get("clock") or {}).get("displayValue", "20:00").split(":"); left = int(mm) * 60 + float(ss)
            except Exception: left = 1200
            state["clutch"] = per >= 2 and left <= 300 and abs(hs - as_) <= 5
            hs, as_ = p.get("homeScore", hs) or hs, p.get("awayScore", as_) or as_
            if ty == "Substitution":
                if parts:
                    pid = parts[0]
                    if "subbing out" in tl and pid in on[tid]: on[tid].remove(pid)
                    elif "subbing in" in tl: seen[pid] = i; on[tid].append(pid) if pid not in on[tid] else None
                    if len(on[tid]) > 5: on[tid].remove(min((x for x in on[tid] if x != pid), key=lambda x: seen.get(x, -1)))
                continue
            for k_, pid in enumerate(parts[:2]):
                if ty == "Substitution": break
                floor(tid if not (k_ == 0 and ty in ("Steal", "Block Shot")) else tid, pid, i) if (k_ == 0 or "assist" in tl) else None
        is_ft = "free throw" in tl or "FreeThrow" in ty
        if trip and not (is_ft and tid == trip["t"]) and ty not in ("Substitution", "ShortTimeOut", "RegularTimeOut", "OfficialTVTimeOut", "Dead Ball Rebound"):
            close_trip()
            if last_miss_box[0]: last_miss, last_miss_box[0] = last_miss_box[0], None
        if ty == "PersonalFoul" or (ty.endswith("Foul") and "technical" not in tl):
            if parts: last_foul[tid] = (parts[0], clock)
            continue
        if is_ft:
            # "free throw 1 of 2" — some feeds just say "made Free Throw.": then a trip is the team's run of FTs,
            # closed by the next real event
            m = FT_OF.search(tx); k, n = (int(m.group(1)), int(m.group(2))) if m else (None, None)
            made = 1.0 if p.get("scoringPlay") else 0.0
            cnt[tid]["fta"] += 1; cnt[tid]["pts"] += made
            if parts: pc[parts[0]]["fta"] += 1
            if "technical" in tl:   # a technical's shots are a bonus with no possession at stake
                add((tid, parts[0] if parts else None, "ft", made - L["f"], 0.0, False)); continue
            if not trip:
                fl = last_foul.get(other[tid])
                andone = (n == 1 and last_make == (tid, clock))
                trip = {"t": tid, "pid": parts[0] if parts else None, "made": 0.0, "att": 0, "andone": andone, "n": n,
                        "after_make": last_make == (tid, clock), "miss_last": False, "fouler": fl[0] if fl else None}
            trip["made"] += made; trip["att"] += 1
            trip["miss_last"] = (made == 0) if n is None else (made == 0 and k >= n)
            if n is not None and k >= n:
                close_trip()
                if last_miss_box[0]: last_miss, last_miss_box[0] = last_miss_box[0], None
            continue
        if p.get("shootingPlay") and (p.get("pointsAttempted") or 0) in (2, 3):
            z = zone(p); sh = parts[0] if parts else None; pts = float(p["pointsAttempted"])
            cnt[tid]["fga"] += 1
            if sh:
                pc[sh]["fga"] += 1; pc[sh]["tpa"] += pts == 3
                if p.get("scoringPlay"): pc[sh]["fgm"] += 1; pc[sh]["astd"] += (len(parts) > 1 and "assist" in tl)
            if p.get("scoringPlay"):
                cnt[tid]["pts"] += pts; last_make = (tid, clock); last_miss = None
                ast = parts[1] if (len(parts) > 1 and "assist" in tl) else None
                a = A_Z[z]
                add((tid, sh, z, (1 - a) * pts, -(1 - a), False))
                add((tid, ast, "pass", a * pts, -a, False) if ast else (tid, sh, "self", a * pts, -a, False))
            else:
                add((tid, sh, z, 0.0, -(1 - L["r"]), False)); last_miss = ("fg", tid)
            continue
        if ty == "Block Shot":
            if parts: add((other[tid], parts[0], "blk", 0.0, BLOCK_SH * (1 - L["r"]), True))
            continue
        if "Rebound" in ty:
            if not last_miss: continue
            kind, shot_t = last_miss; last_miss = None
            r = L["r"] if kind == "fg" else L["rf"]
            pid = parts[0] if parts else None
            if tid == shot_t:
                cnt[tid]["oreb"] += 1; add((tid, pid, "oreb", 0.0, REB_SH * (1 - r), False))
                add((tid, None, "_oreb", 0.0, (1 - REB_SH) * (1 - r), False))
            else:
                add((shot_t, None, "_dreb", 0.0, -r, False))                  # the offense's loss
                if pid: add((shot_t, pid, "dreb", 0.0, REB_SH * r, True))             # the rebounder's carve-out
            continue
        if "Turnover" in ty:
            cnt[tid]["tov"] += 1; last_miss = None
            if parts: pc[parts[0]]["tov"] += 1
            add((tid, parts[0] if parts else None, "tov", 0.0, -1.0, False))
            continue
        if ty == "Steal":
            if parts: add((other[tid], parts[0], "stl", 0.0, STEAL_SH, True))
            continue
    close_trip()
    return (rows, cnt, ctxs) if lineup else (rows, cnt)

def main():
    y = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    t0 = time.time()
    ts = sb(f"team_seasons?season_year=eq.{y}&select=team,team_id,conference&order=team_id.asc")
    d1 = {str(t["team_id"]): t for t in ts if t.get("conference")}
    dna = (json.load(open(os.path.join(D, "team_dna.json"))).get(str(y)) or {}).get("teams") or {}
    games = [g for g in sb(f"games?season_year=eq.{y}&status=eq.STATUS_FINAL&select=id,home_id,away_id&order=id.asc")
             if str(g["home_id"]) in d1 or str(g["away_id"]) in d1]
    with ThreadPoolExecutor(8) as ex: S = list(ex.map(lambda g: summary(g["id"]), games))
    G = [x for x in (parse(s) for s in S if s and s.get("plays")) if x]
    print(f"{y}: {len(G)}/{len(games)} games with play-by-play", file=sys.stderr)

    # league constants from a first pass (counts are model-free)
    L0 = {"r": 0.3, "rf": 0.12, "f": 0.72}
    agg = defaultdict(float)
    for teams, mins, names, plays in G:
        rows, cnt = tally(plays, teams, L0)
        for t in teams:
            c = cnt[t]; agg["pts"] += c["pts"]; agg["poss"] += c["fga"] - c["oreb"] + c["tov"] + 0.44 * c["fta"]
            agg["oreb"] += c["oreb"]; agg["fta"] += c["fta"]
        for (t, pid, sk, a, b, isd) in rows:
            if sk == "ft": agg["ftm"] += a + L0["f"]; agg["ftc"] += 1
            if sk == "oreb" and b > 0: agg["or_fg"] += 1
            if sk == "_dreb": agg["dr_fg"] += 1
    L = {"r": agg["or_fg"] / max(1, agg["or_fg"] + agg["dr_fg"]), "rf": 0.12, "f": agg["ftm"] / max(1, agg["ftc"])}
    # B = the value that makes the league's offensive credits sum to zero (every credit is a + b*B), so an average
    # possession scores 0 and every skill reads as points above an average possession
    sa = sb_ = 0.0
    for teams, mins, names, plays in G:
        rows, _ = tally(plays, teams, L)
        for (t, pid, sk, a, b, isd) in rows:
            if not isd: sa += a; sb_ += b
    B = sa / -sb_
    print(f"  box-formula pts/poss {agg['pts'] / agg['poss']:.3f}; accounting B {B:.3f}", file=sys.stderr)
    print(f"  league: B={B:.3f} pts/poss, OREB rate {L['r']:.3f}, FT% {L['f']:.3f}", file=sys.stderr)

    # schedule: each team's adjusted O and D (pts/100) vs the league average
    full = {tid: t["team"] for tid, t in d1.items()}
    adjO = {tid: dna[full[tid]]["adjO"] for tid in d1 if full[tid] in dna and dna[full[tid]].get("adjO") is not None}
    adjD = {tid: dna[full[tid]]["adjD"] for tid in d1 if full[tid] in dna and dna[full[tid]].get("adjD") is not None}
    lgO = sum(adjO.values()) / max(1, len(adjO)); lgD = sum(adjD.values()) / max(1, len(adjD))

    V = defaultdict(lambda: defaultdict(float))      # pid -> skill -> points
    ST = defaultdict(lambda: defaultdict(float)); POS = {}
    P = defaultdict(float); M = defaultdict(float); TM = {}; NM = {}; GP = defaultdict(int)
    for teams, mins, names, plays in G:
        rows, cnt = tally(plays, teams, L)
        other = {teams[0]: teams[1], teams[1]: teams[0]}
        for pid, c_ in cnt["_p"].items():
            for k_, v_ in c_.items(): ST[pid][k_] += v_
        POS.update(names.get("_pos") or {})
        for t in teams:
            o = other[t]
            B_off = B + ((adjD.get(o, lgD) - lgD) / 100.0 if o in d1 else 0.0)    # t's offense vs o's defense
            B_def = B + ((adjO.get(o, lgO) - lgO) / 100.0 if o in d1 else 0.0)    # t's defense vs o's offense
            c = cnt[t]; poss = c["fga"] - c["oreb"] + c["tov"] + 0.44 * c["fta"]
            tm = sum(mins[t].values()) or 200.0
            for pid, m in mins[t].items():
                P[pid] += poss * m / (tm / 5.0); M[pid] += m; TM[pid] = t; NM[pid] = names.get(pid); GP[pid] += 1
            # t's offense
            for (ot, pid, sk, a, b, isd) in rows:
                if ot == t and not isd and pid and sk[0] != "_": V[pid][sk] += a + b * B_off
            # t's defense = minus o's offense (at B_def), carve-outs to individuals, the rest by minutes
            tot = sum(-(a + b * B_def) for (ot, pid, sk, a, b, isd) in rows if ot == o and not isd)
            carved = 0.0
            for (ot, pid, sk, a, b, isd) in rows:
                if ot == o and isd and pid in mins[t]:
                    v = a + b * B_def; V[pid][sk] += v; carved += v
            resid = tot - carved
            for pid, m in mins[t].items(): V[pid]["team"] += resid * m / tm
    keys = [k for k, _, _ in SKILLS]
    players = {}
    for pid, poss in P.items():
        if poss < 50 or TM.get(pid) not in d1: continue
        per = [round(100.0 * V[pid][k] / poss, 2) for k in keys]
        c_ = ST[pid]
        players[pid] = {"n": NM.get(pid), "t": full.get(TM[pid]), "g": GP[pid], "min": round(M[pid]), "poss": round(poss), "v": per,
                        "pos": POS.get(pid, ""), "use": round(100.0 * (c_["fga"] + 0.44 * c_["fta"] + c_["tov"]) / poss, 1),   # possessions used per 100
                        "astd": round(c_["astd"] / c_["fgm"], 3) if c_["fgm"] else None, "tpar": round(c_["tpa"] / c_["fga"], 3) if c_["fga"] else None}
    pool = [p for p in players.values() if p["poss"] >= MIN_POSS]
    import bisect
    cols = list(zip(*[p["v"] for p in pool]))
    srt = [sorted(c) for c in cols]
    avg = [sum(c) / len(c) for c in cols]
    def pct(i, v): s = srt[i]; return round(100.0 * bisect.bisect_left(s, v) / max(1, len(s) - 1))
    tots = sorted(sum(p["v"][i] for i in range(len(keys)) if keys[i] in OFF) for p in pool), sorted(sum(p["v"][i] for i in range(len(keys)) if keys[i] not in OFF) for p in pool), sorted(sum(p["v"]) for p in pool)
    for p in players.values():
        p["p"] = [pct(i, v) for i, v in enumerate(p["v"])]
        o = sum(p["v"][i] for i in range(len(keys)) if keys[i] in OFF); dd = sum(p["v"]) - o
        p["o"], p["d"], p["tot"] = round(o, 2), round(dd, 2), round(o + dd, 2)
        p["op"], p["dp"], p["tp"] = [round(100.0 * bisect.bisect_left(s, v) / max(1, len(s) - 1)) for s, v in zip(tots, (o, dd, o + dd))]
        p["q"] = 1 if p["poss"] >= MIN_POSS else 0
    q = lambda s, f: s[min(len(s) - 1, int(f * len(s)))]
    skills = [{"k": k, "label": lab, "group": g, "avg": round(avg[i], 2), "p10": round(q(srt[i], .1), 2), "p90": round(q(srt[i], .9), 2),
               "spread": round(q(srt[i], .9) - q(srt[i], .1), 2), "best": round(srt[i][-1], 2)} for i, (k, lab, g) in enumerate(SKILLS)]
    os.makedirs(OUT, exist_ok=True)
    doc = {"season": y, "built": time.strftime("%Y-%m-%d"), "B": round(B, 4), "league": {k: round(v, 4) for k, v in L.items()},
           "min_poss": MIN_POSS, "pool": len(pool), "skills": skills,
           "totals": {k: round(sum(p[k] for p in pool) / len(pool), 2) for k in ("o", "d", "tot")}, "players": players}
    json.dump(doc, open(os.path.join(OUT, f"{y}.json"), "w"), separators=(",", ":"))
    print(f"fingerprint {y}: {len(players)} players ({len(pool)} in the percentile pool), {time.time() - t0:.0f}s", file=sys.stderr)

if __name__ == "__main__":
    main()
