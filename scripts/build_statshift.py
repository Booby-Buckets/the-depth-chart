#!/usr/bin/env python3
"""
build_statshift.py — Stat Line Shift (Oct 2026, owner: "can we build something like this", from a
databallr-style "Stat Line Shift" screenshot): how each player's OWN line changes with a given
teammate on the floor vs off it.

Same feed and game matching as build_wowy.py (NCAA play-by-play, the only one that logs
substitutions), but every stint also carries a box per player, from who the event text names:
shots, rebounds, assists, turnovers, steals, blocks, missed FTs. One feed never logs made free
throws, so a point the score shows beyond the field goals goes to: that row's shooter, else the FT
miss / and-one at the same clock, else the player on the floor with the most made FTs in the real
box score still unaccounted for. Low-leverage (garbage) time is removed like the WOWY page.

Per team, for every player A and every teammate B: A's box, his team's box and the opponent's box,
and the seconds, over the stints A played WITH B. "Without" = A's total minus "with" (it includes
games B missed). Usage, +/- and per-possession rates are computed on the page.

Output: scripts/data/statshift/<season>/index.json   {teams:[{team, file}], built, games}
        scripts/data/statshift/<season>/players.json {espn_id: team file}   (the player page's lookup)
        scripts/data/statshift/<season>/<slug>.json  {team, F, players:[{id,name,all:[...]}], w:{A:{B:[...]}}}
  each [...] = 13 player fields + 13 team fields + 13 opponent fields + seconds (F order)

Usage:
  python3 -u scripts/build_statshift.py --season 2026 --limit 40 --verbose   # check attribution vs box scores
  python3 -u scripts/build_statshift.py --season 2026
"""
import json, os, re, sys, time, argparse
from collections import defaultdict
sys.path.insert(0, os.path.dirname(__file__))
import build_onoff as B
import build_wowy as W

F = ("pts", "fga", "fgm", "tpa", "tpm", "fta", "ftm", "orb", "drb", "tov", "ast", "stl", "blk")
NF = len(F)
IX = {f: i for i, f in enumerate(F)}
OUT = os.path.join(B.DATADIR, "statshift")
PAREN = re.compile(r"\(([^()]*?) (assists|steals|blocks)\)", re.I)
THREE = re.compile(r"three point|3 pointer|3-pt|3pt", re.I)
MISS = re.compile(r"(misses|missed)\b")
TWO = re.compile(r"two point|2 pointer|layup|dunk|tip|hook|alley|putback", re.I)

def blank(): return dict.fromkeys(F, 0)

def kind(desc):
    """build_wowy's event kinds, plus the made "3 Pointer by X" of the no-GOOD feed (otherwise its threes read as FTs)"""
    d = desc.lower()
    if re.match(r"^3 pointer by", d): return "fga"
    if "free throw" in d and "subbing" not in d:   # "miss" alone also hits "Southern Miss." and "Namisse"
        return "ftmiss" if MISS.search(d) else "ft"
    return W.kind(desc)

def box_season(season, gids):
    """{game_id: {espn_id: row}} for the season's games, 40 games a request (a season-wide ordered scan times out)"""
    fp = os.path.join(W.CACHE, f"boxfull_{season}.json")
    out = {}
    if os.path.exists(fp):
        try: out = json.load(open(fp))
        except Exception: out = {}
    need = sorted({str(g) for g in gids} - set(out))
    for i in range(0, len(need), 40):
        chunk = need[i:i + 40]
        rows = B.sb_get(f"box_scores?game_id=in.({','.join(chunk)})&select=game_id,espn_id,pts,fga,fgm,tpa,tpm,fta,ftm,oreb,dreb,ast,tov,stl,blk")
        for g in chunk: out.setdefault(g, {})
        for r in rows or []:
            if r.get("espn_id") is not None: out[str(r["game_id"])][str(r["espn_id"])] = r
        if i % 800 == 0: print(f"  box {i}/{len(need)}", flush=True)
    if need:
        os.makedirs(W.CACHE, exist_ok=True); json.dump(out, open(fp, "w"))
    return out

def process_game(nid, og, gbox):
    """→ {stints:[{H,A,secs,low,h,a,p:{eid:box}}], teamH, teamA, names}"""
    pbp = B.pbp_json(nid)
    if not pbp or not pbp.get("periods"): return None, "no-pbp"
    teams = pbp.get("teams", [])
    if len(teams) != 2: return None, "teams"
    box = W.cached_json(f"box_{og['id']}.json", lambda: B.sb_get(f"box_scores?game_id=eq.{og['id']}&select=player,espn_id,team,starter,min"))
    if not box: return None, "no-box"
    bteams = list({b["team"] for b in box if b.get("team")})
    if len(bteams) < 2: return None, "box-teams<2"
    tov = B._tov
    h_team = max(bteams, key=lambda bt: (tov(bt, og["home"]), -tov(bt, og["away"])))
    a_team = max([bt for bt in bteams if bt != h_team], key=lambda bt: tov(bt, og["away"]))
    def side_map(bteam):
        rows = [b for b in box if b["team"] == bteam and b.get("espn_id") is not None]
        n2e = {W.nn(b["player"]): str(b["espn_id"]) for b in rows}
        last = defaultdict(list)
        for b in rows: last[W.nn(b["player"]).split(" ")[-1]].append(str(b["espn_id"]))
        for k, v in last.items():
            if len(v) == 1: n2e.setdefault("~" + k, v[0])
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
    # who did it: each player's name with the spaces squeezed out, both "First Last" and "Last First", longest first,
    # found anywhere in the text (one feed glues the verb on: "Connor Dowmisses three point jump shot")
    akeys = {}
    for sd in ("H", "A"):
        ks = set()
        for k, e in n2e[sd].items():
            if k.startswith("~") or len(k) < 4: continue
            ks.add((k.replace(" ", ""), e))
            p = k.split(" ")
            if len(p) > 1: ks.add(("".join(p[1:] + p[:1]), e))
        akeys[sd] = sorted(ks, key=lambda x: -len(x[0]))
    def actor(text, sd):
        c = W.nn(text).replace(" ", "")
        for k, e in akeys[sd]:
            if k in c: return e
        return None
    ftleft = {e: int(r.get("ftm") or 0) for e, r in (gbox or {}).items()}
    # the "Jumper MISSED by …" feed has no 2 or 3 on misses: take it from ESPN's play-by-play by period, clock and team
    amb = any("MISSED by" in (pl.get("eventDescription") or "") for per in pbp["periods"] for pl in per.get("playbyplayStats", []))
    EM, eteam = (W.espn_misses(og["id"]) if amb else ([], {}))
    side_team = {tid: ("H" if tov(nm, box_home) >= tov(nm, box_away) else "A") for tid, nm in eteam.items()}
    def miss_is3(pn, s, side):
        best = None
        for m in EM:
            if m["used"] or m["per"] != pn or side_team.get(m["team"]) != side or m["secs"] is None or s is None: continue
            dd = abs(m["secs"] - s)
            if dd <= 4 and (best is None or dd < best[0]): best = (dd, m)
        if best: best[1]["used"] = True; return 1.0 if best[1]["is3"] else 0.0
        return 0.45

    stints = []
    def fresh(): return {False: [blank(), blank(), 0.0, {}], True: [blank(), blank(), 0.0, {}]}
    cur = fresh()
    def close():
        nonlocal cur
        for low in (False, True):
            h, a, s, pb = cur[low]
            if s <= 0 and not any(h.values()) and not any(a.values()): continue
            stints.append({"H": sorted(on["H"]), "A": sorted(on["A"]), "secs": s, "low": low, "h": h, "a": a, "p": pb})
        cur = fresh()
    bad = 0
    hi_h = hi_a = 0
    for per in pbp["periods"]:
        pn = int(per.get("periodNumber") or 1)
        prev_sig = None; last_secs = 1200 if pn <= 2 else 300
        last_miss = None
        last_ft = {"H": None, "A": None}; last_fg = {"H": None, "A": None}
        pend = {"H": [], "A": []}   # made FGs the score hasn't shown yet: [team box, player box or None, value or None]
        def credit(bucket, dh, da, row_side, row_kind, row_who, s):
            """the score moved: pay any made field goal still owed (the feed often moves the score a line late), the
            rest is made free throws, credited to a shooter"""
            for sd, d in (("H", dh), ("A", da)):
                if d <= 0: continue
                bx = bucket[0] if sd == "H" else bucket[1]
                bx["pts"] += d
                while d > 0 and pend[sd]:
                    tb, pbx, val = pend[sd][0]
                    if val is None:   # a made "Jumper" with no 2 or 3 in the text: the score says which
                        val = 3 if d >= 3 else 2
                        for b in (tb, pbx):
                            if b is not None and val == 3: b["tpa"] += 1; b["tpm"] += 1
                        if pbx is not None: pbx["pts"] += val
                    if d >= val: d -= val; pend[sd].pop(0)
                    else: pend[sd][0] = [tb, pbx, val - d]; d = 0
                if d <= 0: continue
                bx["ftm"] += d; bx["fta"] += d
                for _ in range(d):
                    e = None
                    if sd == row_side and row_kind == "ft" and row_who: e = row_who
                    elif last_ft[sd] and last_ft[sd][1] == s: e = last_ft[sd][0]
                    elif last_fg[sd] and last_fg[sd][1] == s: e = last_fg[sd][0]
                    else:
                        cand = [x for x in on[sd] if ftleft.get(x, 0) > 0]
                        if cand: e = max(cand, key=lambda x: ftleft[x])
                    if e:
                        b = bucket[3].setdefault(e, blank()); b["ftm"] += 1; b["fta"] += 1; b["pts"] += 1
                        if ftleft.get(e, 0) > 0: ftleft[e] -= 1
        rows = per.get("playbyplayStats", [])
        def sc(pl):
            try: return int(pl.get("homeScore") or 0), int(pl.get("visitorScore") or 0)
            except Exception: return 0, 0
        for ri, pl in enumerate(rows):
            desc = pl.get("eventDescription", "") or ""
            hs, as_ = sc(pl)
            s = W.secs_of(pl.get("clock"))
            low = W.low_leverage(pn, s, hs - as_)
            bucket = cur[low]
            if s is not None and s <= last_secs:
                bucket[2] += last_secs - s; last_secs = s
            # one feed drops in stray rows carrying a score from much later (42-51 between two 2-2 rows) and another
            # resets it: a jump of more than 6 counts only if the next different score doesn't fall back below it
            dh = max(0, hs - hi_h); da = max(0, as_ - hi_a)
            if dh + da > 6:
                nxt = next((sc(q) for q in rows[ri + 1:] if sc(q) != (hs, as_) and sc(q)[0] >= 0), None)
                if nxt is not None and (nxt[0] < hs or nxt[1] < as_): dh = da = 0
            hi_h += dh; hi_a += da
            m = W.SUB2.match(desc)
            if m:
                credit(bucket, dh, da, None, None, None, s)
                close(); bucket = cur[low]
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
                pk = W.nn(player)
                eid = n2e[side].get(pk) or n2e[side].get("~" + (pk.split(" ")[-1] if pk else "")) or actor(player, side)
                if eid is None: bad += 1; continue
                (on[side].add if io == "in" else on[side].discard)(eid)
                continue
            side = "H" if pl.get("isHome") else "A"
            other = "A" if side == "H" else "H"
            box_s = bucket[0] if side == "H" else bucket[1]
            def pbox(e): return bucket[3].setdefault(e, blank())
            k = kind(desc)
            who = actor(re.sub(r"\(.*?\)", "", desc), side) if k in ("fga", "orb", "drb", "tov", "stl", "blk", "ast", "ftmiss", "ft") else None
            dl = desc.lower(); sig = re.sub(r"\s+", "", re.sub(r"\(.*?\)", "", dl))
            dup = bool(sig) and sig == prev_sig
            prev_sig = sig
            if not dup:
                for pm in PAREN.finditer(desc):   # "(X assists)" is a teammate; "(X steals)" / "(X blocks)" the other side
                    v = pm.group(2).lower()
                    if v == "assists": box_s["ast"] += 1
                    e = actor(pm.group(1), side if v == "assists" else other)
                    if e: pbox(e)[{"assists": "ast", "steals": "stl", "blocks": "blk"}[v]] += 1
            if not dup and k == "fga":
                made = not MISS.search(dl)
                pb = pbox(who) if who else None
                box_s["fga"] += 1
                if pb is not None: pb["fga"] += 1
                last_miss = None if made else (side, False)
                if made:
                    box_s["fgm"] += 1
                    if pb is not None: pb["fgm"] += 1; last_fg[side] = (who, s)
                    if THREE.search(desc):
                        for b in (box_s, pb):
                            if b is not None: b["tpa"] += 1; b["tpm"] += 1
                        if pb is not None: pb["pts"] += 3
                        pend[side].append([box_s, pb, 3])
                    elif TWO.search(desc):
                        if pb is not None: pb["pts"] += 2
                        pend[side].append([box_s, pb, 2])
                    else: pend[side].append([box_s, pb, None])
                else:
                    p3 = 1.0 if THREE.search(desc) else 0.0 if TWO.search(desc) else miss_is3(pn, s, side)
                    box_s["tpa"] += p3
                    if pb is not None: pb["tpa"] += p3
            elif not dup and k in ("orb", "drb"):
                if last_miss is not None:
                    if not last_miss[1]:
                        rk = "orb" if last_miss[0] == side else "drb"
                        box_s[rk] += 1
                        if who: pbox(who)[rk] += 1
                    last_miss = None
                else:
                    box_s[k] += 1
                    if who: pbox(who)[k] += 1
            elif not dup and k in ("tov", "stl", "blk", "ast"):
                if k != "ast" or "assists)" not in dl: box_s[k] += 1
                if who: pbox(who)[k] += 1
            elif not dup and k == "ftmiss":
                box_s["fta"] += 1
                if who: pbox(who)["fta"] += 1; last_ft[side] = (who, s)
                last_miss = (side, bool(re.search(r"\b(1 of 2|1 of 3|2 of 3)\b", dl)))
            credit(bucket, dh, da, side, k, who, s)
    close()
    tot = {"H": blank(), "A": blank()}
    for st in stints:
        for f in F: tot["H"][f] += st["h"][f]; tot["A"][f] += st["a"][f]
    for sd in ("H", "A"):
        p = W.poss(tot[sd])
        if p < 45 or p > 110: return None, "bad-poss"
        o = 100 * tot[sd]["pts"] / p
        if o < 55 or o > 150: return None, "bad-ortg"
    if bad > 8: return None, "bad-subs"
    names = {str(b["espn_id"]): b["player"] for b in box if b.get("espn_id") is not None}
    return {"stints": stints, "teamH": box_home, "teamA": box_away, "names": names}, "ok"

def slug(t): return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")

def run(season, limit=0, verbose=False):
    gmap = json.load(open(os.path.join(W.CACHE, f"games_{season}.json")))   # built by build_wowy.py
    BOX = box_season(season, [og["id"] for og in gmap.values()])
    print(f"season {season}: {len(gmap)} games, box for {len(BOX)}", flush=True)
    ALL = defaultdict(lambda: [0.0] * (3 * NF + 1))          # (team, A) -> totals
    WITH = defaultdict(lambda: [0.0] * (3 * NF + 1))         # (team, A, B) -> with B
    names = {}; fails = defaultdict(int); done = 0
    chk = defaultdict(lambda: [0, 0])   # attribution check vs box scores, all minutes: field -> [ours, box]
    for nid, og in gmap.items():
        if limit and done >= limit: break
        gb = BOX.get(str(og["id"])) or {}
        res, why = process_game(nid, og, gb)
        if res is None: fails[why] += 1; continue
        done += 1; names.update(res["names"])
        if verbose or limit:
            tot = defaultdict(blank)
            for st in res["stints"]:
                for e, b in st["p"].items():
                    for f in F: tot[e][f] += b[f]
            for e, r in gb.items():
                for f, bf in (("pts", "pts"), ("fga", "fga"), ("fgm", "fgm"), ("tpa", "tpa"), ("tpm", "tpm"), ("ftm", "ftm"), ("fta", "fta"), ("orb", "oreb"), ("drb", "dreb"), ("ast", "ast"), ("tov", "tov"), ("stl", "stl"), ("blk", "blk")):
                    chk[f][0] += tot[e][f] if e in tot else 0; chk[f][1] += r.get(bf) or 0
        for st in res["stints"]:
            if st["low"]: continue
            for sd, own, opp, team in (("H", st["h"], st["a"], res["teamH"]), ("A", st["a"], st["h"], res["teamA"])):
                ids = st[sd]
                vec_t = [own[f] for f in F] + [opp[f] for f in F] + [st["secs"]]
                for a in ids:
                    pb = st["p"].get(a)
                    vec = [pb[f] for f in F] if pb else [0] * NF
                    vec += vec_t
                    acc = ALL[(team, a)]
                    for i, v in enumerate(vec): acc[i] += v
                    for b in ids:
                        if b == a: continue
                        acc = WITH[(team, a, b)]
                        for i, v in enumerate(vec): acc[i] += v
        if done % 500 == 0: print(f"  {done} games", flush=True)
    print(f"processed {done}; failures {dict(fails)}", flush=True)
    if chk:
        print("[attribution vs box, ours/box] " + "  ".join(f"{f} {c[0] / max(1, c[1]):.3f}" for f, c in chk.items()), flush=True)
        if chk["pts"][0] / max(1, chk["pts"][1]) < 0.85:
            print("*** SANITY FAIL: under 85% of box-score points attributed — not writing ***"); return
    if limit: return

    def rnd(v): return [round(x, 1) if i in (IX["tpa"], NF + IX["tpa"], 2 * NF + IX["tpa"]) else int(round(x)) for i, x in enumerate(v)]
    byteam = defaultdict(list)
    for (team, a), v in ALL.items():
        if v[-1] >= 60 * 10: byteam[team].append(a)   # 10+ minutes
    sd = os.path.join(OUT, str(season)); os.makedirs(sd, exist_ok=True)
    idx = []
    for team, ids in sorted(byteam.items()):
        ids.sort(key=lambda a: -ALL[(team, a)][-1])
        w = {}
        for a in ids:
            w[a] = {b: rnd(WITH[(team, a, b)]) for b in ids if b != a and (team, a, b) in WITH}
        f = slug(team) + ".json"
        json.dump({"team": team, "season": season, "F": F,
                   "players": [{"id": a, "name": names.get(a, a), "all": rnd(ALL[(team, a)])} for a in ids], "w": w},
                  open(os.path.join(sd, f), "w"), separators=(",", ":"))
        idx.append({"team": team, "file": f})
    json.dump({str(a): t["file"] for t in idx for a in byteam[t["team"]]}, open(os.path.join(sd, "players.json"), "w"), separators=(",", ":"))   # player page lookup
    json.dump({"season": season, "games": done, "built": time.strftime("%Y-%m-%d"), "teams": idx},
              open(os.path.join(sd, "index.json"), "w"), separators=(",", ":"))
    print(f"wrote {len(idx)} teams -> {sd}", flush=True)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--offline", action="store_true", help="cached play-by-play only (the proxy 502s on old games, ~2 min each)")
    a = ap.parse_args()
    if a.offline:
        _http = B.http
        B.http = lambda url, *x, **k: None if ("henrygd" in url or "espn.com" in url) else _http(url, *x, **k)
    run(a.season, a.limit, a.verbose)
