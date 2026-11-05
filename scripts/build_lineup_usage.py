#!/usr/bin/env python3
"""build_lineup_usage.py — who actually shared the floor, at which position (owner, Nov 2026, from KenPom's past-5 lineups).

The team Lineups tab only knew starting fives. ESPN's play-by-play logs every substitution with the player's id and its box
score marks the starters, so each game can be walked second by second. For every team:

  scripts/data/lineup_usage/<season>/<slug of ESPN full name>.json
  {team, season, p:{espn_id:[name, position score, height inches, listed]}, l:[[5 espn_ids],...], o:[the same fives, PG..C],
   g:[[game id, date, opponent, [[lineup index, seconds, points for, points against],...]],...]}

Lineups are stored per game, so the page can total any window (season, last 10, last 5). Each five is placed by trying all 120
arrangements and keeping the one closest to everyone's listed positions. Position score (1 PG to 5 C: listed spots, height and
how he actually plays) breaks ties and stands in when nothing is listed, so a three-guard lineup puts its biggest guard at the 3.

A game is kept only if the walk is reliable: five men per side for 95%+ of the time and each player's minutes within 15% of the
box score in total. Re-runs skip games already in the file, so the nightly run only fetches new finals.

  python3 scripts/build_lineup_usage.py --season 2027
  python3 scripts/build_lineup_usage.py --season 2026 --limit 40 --check --dry    # validate without writing
"""
import argparse, collections, concurrent.futures as cf, gzip, itertools, json, os, re, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, "data"); CACHE = os.path.join(DATA, "espn_pbp_cache")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"
KEY = os.environ.get("SUPABASE_ANON_KEY", "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye")
ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event="
SLOT = {"PG": 1, "SG": 2, "G": 1.5, "SF": 3, "GF": 2.5, "F": 3.5, "PF": 4, "FC": 4, "C": 5}

def get(url, headers):
    for a in range(4):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=45))
        except Exception as e: err = e; time.sleep(1.5 * (a + 1))
    print("  failed", url[:90], err, flush=True); return None
def sb(q): return get(SB + q, {"apikey": KEY, "Authorization": "Bearer " + KEY}) or []
def slug(s): return re.sub(r"[^a-z0-9]+", "-", str(s or "").lower()).strip("-")
def nk(s): return re.sub(r"[^a-z]", "", str(s or "").lower())
def inches(h):
    m = re.match(r"^\s*(\d)-(\d{1,2})", str(h or "")); return int(m.group(1)) * 12 + int(m.group(2)) if m else None
def secs(clock):
    m = re.match(r"^(\d+):(\d+)", str(clock or "")); return int(m.group(1)) * 60 + int(m.group(2)) if m else None

def summary(gid):
    fp = os.path.join(CACHE, f"{gid}.json.gz")
    if os.path.exists(fp):
        try:
            d = json.load(gzip.open(fp))
            if d and d.get("plays") and (d.get("boxscore") or {}).get("players"): return d
        except Exception: pass
    d = get(ESPN + str(gid), {"User-Agent": "Mozilla/5.0"})
    if d and d.get("plays"):
        try: os.makedirs(CACHE, exist_ok=True); json.dump(d, gzip.open(fp, "wt"))
        except Exception: pass
    return d

def walk(d):
    """-> {team id: {name, opp, ath:{id:(name, box min)}, runs:{five: [secs, pf, pa]}}}, or (None, why)"""
    box = (d.get("boxscore") or {}).get("players") or []
    if len(box) != 2: return None, "no-box"
    T = {}
    for b in box:
        tid = str(b["team"]["id"]); st = b["statistics"][0]; names = st.get("names") or st.get("labels") or []
        im = names.index("MIN") if "MIN" in names else 0
        ath, on = {}, set()
        for a in st.get("athletes") or []:
            if not (a.get("athlete") or {}).get("id"):   # ESPN blanks some athletes; a starter we can't name makes the five unknowable
                if a.get("starter"): return None, "starters"
                continue
            aid = str(a["athlete"]["id"]); s = a.get("stats") or []
            try: m = float(s[im]) if len(s) > im else 0.0
            except Exception: m = 0.0
            ath[aid] = (a["athlete"].get("displayName"), m)
            if a.get("starter"): on.add(aid)
        if len(on) != 5: return None, "starters"
        T[tid] = {"name": b["team"].get("displayName"), "ath": ath, "on": on, "runs": collections.defaultdict(lambda: [0.0, 0, 0]), "sec": collections.Counter(), "good": 0.0, "all": 0.0}
    a, b = list(T)
    T[a]["opp"], T[b]["opp"] = T[b]["name"], T[a]["name"]
    comp = ((d.get("header") or {}).get("competitions") or [{}])[0]
    side = {str(c["team"]["id"]): c.get("homeAway") for c in comp.get("competitors") or []}
    if set(side) != {a, b}: return None, "sides"
    plays = d.get("plays") or []
    if sum(1 for p in plays if (p.get("type") or {}).get("text") == "Substitution") < 10: return None, "no-subs"
    per, left = 1, 1200; hs = vs = 0
    def tick(to, dh=0, dv=0):
        dt = max(0, left - to)
        for tid, t in T.items():
            t["all"] += dt
            if len(t["on"]) == 5:
                t["good"] += dt; k = tuple(sorted(t["on"])); r = t["runs"][k]; r[0] += dt
                for x in t["on"]: t["sec"][x] += dt
    for p in plays:
        pn = (p.get("period") or {}).get("number") or per
        if pn != per:
            tick(0); per = pn; left = 1200 if pn <= 2 else 300
        s = secs((p.get("clock") or {}).get("displayValue"))
        if s is not None and s <= left: tick(s); left = s
        nh, nv = p.get("homeScore"), p.get("awayScore")
        if isinstance(nh, int) and isinstance(nv, int) and (nh > hs or nv > vs):   # points go to the fives on the floor now
            dh, dv = max(0, nh - hs), max(0, nv - vs); hs, vs = max(hs, nh), max(vs, nv)
            for tid, t in T.items():
                if len(t["on"]) != 5: continue
                r = t["runs"][tuple(sorted(t["on"]))]; home = side[tid] == "home"
                r[1] += dh if home else dv; r[2] += dv if home else dh
        if (p.get("type") or {}).get("text") == "Substitution":
            tid = str((p.get("team") or {}).get("id")); ps = p.get("participants") or []; txt = (p.get("text") or "").lower()
            if tid in T and ps and (ps[0].get("athlete") or {}).get("id"):
                x = str(ps[0]["athlete"]["id"])
                if "subbing in" in txt: T[tid]["on"].add(x)
                elif "subbing out" in txt: T[tid]["on"].discard(x)
    tick(0)
    for tid, t in T.items():
        if t["all"] < 2300: return None, "short"
        if t["good"] / t["all"] < 0.95: return None, "not-five"
        tot = sum(m for _, m in t["ath"].values())
        if tot <= 0: return None, "no-minutes"
        err = sum(abs(t["sec"][x] / 60 - m) for x, (_, m) in t["ath"].items())
        t["minerr"] = err / tot
        if err / tot > 0.15: return None, "minutes-off"
    return T, "ok"

def position_scores(season):
    """the roster sheet by espn id and team|name, plus that season's stat lines (the listing of a player who has since left)"""
    out, off = {}, 0
    while True:
        rows = sb(f"players?select=espn_id,name,team,position,position2,height&order=id.asc&limit=1000&offset={off}")
        for r in rows:
            if r.get("espn_id") is not None: out[str(r["espn_id"])] = r
            out["n:" + nk(r.get("team")) + "|" + nk(r.get("name"))] = r
        off += 1000
        if len(rows) < 1000: break
    hist, off = {}, 0
    while True:
        rows = sb(f"player_history?select=espn_id,position,height,mpg,apg,rpg,blk,gp&season_year=eq.{season}&espn_id=not.is.null&order=id.asc&limit=1000&offset={off}")
        for r in rows:
            k = str(r["espn_id"])
            if k not in hist or (r.get("gp") or 0) > (hist[k].get("gp") or 0): hist[k] = r
        off += 1000
        if len(rows) < 1000: break
    return out, hist

def score(listed2, height, ast40, rb40):
    """1 (PG) .. 5 (C). Listed position leads; height and role separate the rest and stand in when nothing is listed"""
    a, b = listed2
    la = SLOT.get(str(a or "").upper()); lb = SLOT.get(str(b or "").upper())
    hs = None if height is None else max(1.0, min(5.0, 1 + (height - 73) / 2.75))        # 6-1 -> 1, 6-4 -> 2, 6-10 -> 4, 7-0 -> 5
    rs = None
    if ast40 is not None and rb40 is not None: rs = max(1.0, min(5.0, 3 + (rb40 - 8.0) * 0.28 - (ast40 - 2.6) * 0.42))
    parts = []
    if la is not None: parts.append((0.72 * la + 0.28 * lb if lb is not None else la, 0.62))
    if hs is not None: parts.append((hs, 0.23))
    if rs is not None: parts.append((rs, 0.15))
    return round(sum(v * w for v, w in parts) / sum(w for _, w in parts), 2) if parts else 3.0

def arrange(five, P):
    """the five in PG..C order: the arrangement closest to everyone's listed spots, position score settling the rest"""
    def wants(k):
        row = P.get(k) or ["", 3.0, None, ""]
        spots = [SLOT[v] for v in str(row[3] or "").split("/") if v in SLOT]
        return spots, row[1]
    W = {k: wants(k) for k in five}
    best, bc = None, 1e9
    for perm in itertools.permutations(five):
        c = 0.0
        for i, k in enumerate(perm):
            spots, sc = W[k]; slot = i + 1
            if spots: c += min(abs(slot - v) for v in spots) ** 2
            else: c += 0.5 * (slot - sc) ** 2      # nothing listed: lean on height and role
            c += 0.04 * (slot - sc) ** 2           # the tie-break among equally listed players (two SGs: the smaller, better passer is the 1)
        if c < bc - 1e-9: best, bc = perm, c
    return list(best)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2027); ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--check", action="store_true"); ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    outd = os.path.join(DATA, "lineup_usage", str(a.season))
    games, off = [], 0
    while True:
        rows = sb(f"games?select=id,date&season_year=eq.{a.season}&status=eq.STATUS_FINAL&order=id.asc&limit=1000&offset={off}")
        games += rows; off += 1000
        if len(rows) < 1000: break
    FILES = {}; done = set()
    if os.path.isdir(outd) and not a.dry:
        for f in os.listdir(outd):
            if f.endswith(".json") and f != "index.json":
                d = json.load(open(os.path.join(outd, f))); FILES[d["team"]] = d
                done |= {g[0] for g in d["g"]}
    todo = [g for g in games if g["id"] not in done]
    if a.limit: todo = todo[:a.limit]
    print(f"season {a.season}: {len(games)} finals, {len(done)} already in, {len(todo)} to fetch", flush=True)
    stat = collections.Counter(); errs = []
    with cf.ThreadPoolExecutor(5) as ex:
        def one(g):
            try: return g, walk(summary(g["id"]) or {})
            except Exception as e: return g, (None, "bad-data")
        res = list(ex.map(one, todo))
    new = collections.defaultdict(list)
    for g, (T, why) in res:
        stat[why] += 1
        if T is None: continue
        for tid, t in T.items():
            errs.append(t["minerr"])
            new[t["name"]].append((g["id"], g["date"], t))
    print("games:", dict(stat), flush=True)
    if errs:
        errs.sort(); print(f"minutes off vs box, per team-game: median {errs[len(errs) // 2]:.3f}, p90 {errs[int(.9 * len(errs))]:.3f}", flush=True)
    if a.dry and not a.check: return
    sheet, hist = position_scores(a.season)
    # role evidence from the games on file: rates come from the real lines when present
    try: RL = json.load(open(os.path.join(DATA, f"real_lines_{a.season}.json")))["players"]
    except Exception: RL = {}
    for team, rows in new.items():
        F = FILES.setdefault(team, {"team": team, "season": a.season, "p": {}, "l": [], "g": []})
        idx = {tuple(l): i for i, l in enumerate(F["l"])}
        for gid, date, t in rows:
            for x, (nm, _) in t["ath"].items():
                F["p"].setdefault(x, [nm, 3.0, None, ""])
            rec = []
            for five, (s, pf, pa) in sorted(t["runs"].items(), key=lambda kv: -kv[1][0]):
                if s <= 0: continue
                i = idx.setdefault(five, len(F["l"]))
                if i == len(F["l"]): F["l"].append(list(five))
                rec.append([i, int(s), pf, pa])
            F["g"].append([gid, date, t["opp"], rec])
    for team, F in FILES.items():
        F["g"].sort(key=lambda g: (g[1], g[0]))
        for x, row in F["p"].items():
            r = sheet.get(x)
            if not r:
                w = team.split(" ")      # the sheet says "Notre Dame", ESPN "Notre Dame Fighting Irish": drop the mascot word by word
                for n in range(len(w), 0, -1):
                    r = sheet.get("n:" + nk(" ".join(w[:n])) + "|" + nk(row[0]))
                    if r: break
            hh = hist.get(x)
            h = (inches(r.get("height")) if r else None) or (inches(hh.get("height")) if hh else None)
            q = RL.get(x); ast = rb = None
            if q and q.get("min", 0) >= 20:
                ast = 40 * q.get("ast", 0) / q["min"]; rb = 40 * (q.get("oreb", 0) + q.get("dreb", 0) + 2 * q.get("blk", 0)) / q["min"]
            elif hh and (hh.get("mpg") or 0) > 0:
                k40 = 40 / hh["mpg"]; ast = (hh.get("apg") or 0) * k40; rb = ((hh.get("rpg") or 0) + 2 * (hh.get("blk") or 0)) * k40
            la, lb = (r.get("position"), r.get("position2")) if r else (None, None)
            if not la and hh: la = hh.get("position")   # coarse G / F / C, which height and role then split
            row[1] = score((la, lb), h, ast, rb); row[2] = h; row[3] = "/".join(v for v in (la, lb) if v)
        F["o"] = [arrange(l, F["p"]) for l in F["l"]]
    if a.check:
        names = [n for n in sorted(FILES, key=lambda t: -sum(len(g[3]) for g in FILES[t]["g"]))[:4]]
        for n in names:
            F = FILES[n]; print("\n" + n, len(F["g"]), "games")
            tot = collections.Counter()
            for g in F["g"]:
                for i, s, _, _ in g[3]: tot[i] += s
            all_s = sum(tot.values()) or 1
            for i, s in tot.most_common(4):
                five = F["o"][i]
                print(f"  {100 * s / all_s:5.1f}%  " + " | ".join(f"{F['p'].get(x, ['?'])[0]} ({F['p'].get(x, ['', 3, None, ''])[3] or '?'} {F['p'].get(x, ['', 3])[1]})" for x in five))
    if a.dry: return
    os.makedirs(outd, exist_ok=True)
    kept = 0
    for team, F in FILES.items():
        # non-D-I opponents: nothing on a roster sheet and only a game or two. Their games stay in the D-I side's file, so re-runs skip them
        if len(F["g"]) <= 3 and sum(1 for row in F["p"].values() if row[3]) < 3: continue
        json.dump(F, open(os.path.join(outd, slug(team) + ".json"), "w"), separators=(",", ":")); kept += 1
    print(f"wrote {kept} of {len(FILES)} teams to {outd}", flush=True)

if __name__ == "__main__":
    main()
