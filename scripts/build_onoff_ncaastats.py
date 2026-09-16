#!/usr/bin/env python3
"""
build_onoff_ncaastats.py — on/off (WOWY) for PAST seasons from stats.ncaa.org play-by-play.

Why a second builder: build_onoff.py reads the NCAA's newer data.ncaa.com feed, which no
longer serves games before 2024-25. stats.ncaa.org still carries every season's play-by-play
WITH substitutions ("Player, substitution in/out") — the only public source that does — but
it sits behind an Akamai bot check that rejects curl/headless Chrome. So this script drives
the machine's real Google Chrome through Playwright (a small window parked off-screen) and
reads the pages like a person would. ~1s per game → a full season is a few hours.

Pipeline (same stint model + writer as build_onoff.py, imported from it):
  1. scoreboard per date  → contest ids + teams + scores
  2. match each contest to OUR games row (token overlap + exact final score)
  3. play-by-play page     → events; substitutions drive the on-court sets, score deltas
                             give points, shot/reb/tov/FT events give possessions
  4. player names → espn_id via our box_scores for that game
  5. finish() writes scripts/data/player_onoff.json[season] (with the sanity guard)

Usage:
  python3 scripts/build_onoff_ncaastats.py --season 2024 --limit 25 --verbose   # smoke test
  python3 scripts/build_onoff_ncaastats.py --season 2024                        # full season
  --resume continues from the on-disk cache (pages are cached under data/ncaa_pbp_cache).
Requires: pip3 install playwright   (uses channel="chrome" — the installed Google Chrome).
"""
import argparse, json, os, re, sys, time
from collections import defaultdict
from datetime import date, timedelta
sys.path.insert(0, os.path.dirname(__file__))
import build_onoff as B          # norm, sb_get, our_games_on, match_our_game, finish, _minf
B.POSS_CAL = 1.0                 # stats.ncaa.org events are clean — no possession fudge

DATADIR = os.path.join(os.path.dirname(__file__), "data")
CACHE = os.path.join(DATADIR, "ncaa_pbp_cache")
BASE = "https://stats.ncaa.org"
SUB_RE = re.compile(r"^(.*?),\s*substitution (in|out)\s*$", re.I)

# ── the browser ────────────────────────────────────────────────────────────
class Browser:
    def __init__(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self.fails = 0
        self._launch()
    def _launch(self):
        self.b = self._pw.chromium.launch(channel="chrome", headless=False,
                    args=["--disable-blink-features=AutomationControlled", "--window-position=3000,3000", "--window-size=900,700"])
        self.ctx = self.b.new_context(viewport={"width": 900, "height": 700})
        self.ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined});")
        self.pg = self.ctx.new_page()
    def _relaunch(self):
        try: self.b.close()
        except Exception: pass
        self._launch(); self.fails = 0
    def get(self, url, need=None, tries=3):
        for a in range(tries):
            try:
                self.pg.goto(url, wait_until="domcontentloaded", timeout=45000)
                for _ in range(15):                      # Akamai interstitial → wait it out
                    html = self.pg.content()
                    if "akamai_validation" in html or "bm-verify" in html:
                        time.sleep(2); continue
                    if need and need not in html:
                        time.sleep(1); continue
                    self.fails = 0
                    return html
                return self.pg.content()
            except Exception as e:
                # a wedged tab never recovers on its own: a run once sat 30 min timing out on
                # every goto while a fresh browser fetched the same pages in 2 s. Replace the
                # page, and after three straight misses the whole browser.
                self.fails += 1
                print(f"   fetch error ({type(e).__name__}) on {url.rsplit('/',2)[-2]} — {'relaunching browser' if self.fails >= 3 else 'new page'}", flush=True)
                try:
                    if self.fails >= 3: self._relaunch()
                    else:
                        try: self.pg.close()
                        except Exception: pass
                        self.pg = self.ctx.new_page()
                except Exception: pass
                time.sleep(3 * (a + 1))
        return ""
    def close(self):
        try: self.b.close(); self._pw.stop()
        except Exception: pass

def cached(nid, kind, fetch):
    fp = os.path.join(CACHE, f"{nid}_{kind}.html")
    if os.path.exists(fp) and os.path.getsize(fp) > 5000:
        return open(fp).read()
    html = fetch()
    if html and len(html) > 5000:
        os.makedirs(CACHE, exist_ok=True)
        open(fp, "w").write(html)
    return html

# ── page parsers (regex over the HTML — no bs4 dependency) ─────────────────
TAG = re.compile(r"<[^>]+>")
def text(s): return re.sub(r"\s+", " ", TAG.sub(" ", s)).replace("&amp;", "&").replace("&#39;", "'").strip()

def parse_scoreboard(html):
    """→ [{nid, teams:[away, home], scores:[sa, sh]}]. Each game is two <tr id="contest_N"> rows
    (visitor first, home second), each with the team link and a <div id="score_…"> cell."""
    games = {}
    # a contest row embeds a linescore <table> with its own </tr>, so slice between contest rows instead
    parts = re.split(r'(<tr id="contest_\d+">)', html)
    for i in range(1, len(parts) - 1, 2):
        nid = re.search(r'contest_(\d+)', parts[i]).group(1); row = parts[i + 1]
        row = row.split('href="/contests/')[0]
        nm = re.search(r'href="/teams/\d+">\s*(.*?)\s*</a>', row, re.S)
        sc = re.search(r'id="score_\d+"[^>]*>\s*(\d+)\s*<', row, re.S)
        if not nm: continue
        name = re.sub(r"\s*\(\d+-\d+.*$", "", text(nm.group(1))).strip()
        g = games.setdefault(nid, {"nid": nid, "teams": [], "scores": []})
        g["teams"].append(name); g["scores"].append(int(sc.group(1)) if sc else None)
    return [g for g in games.values() if len(g["teams"]) == 2 and None not in g["scores"]]

def parse_pbp(html):
    """→ header [teamL, teamR], periods: [[(time, side 'L'/'R', desc, scoreL, scoreR)...], ...]"""
    tables = re.findall(r"<table[^>]*>(.*?)</table>", html, re.S)
    periods, hdr = [], None
    for t in tables:
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S)
        if len(rows) < 30: continue
        cells0 = [text(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", rows[0], re.S)]
        if len(cells0) < 4 or cells0[0].lower() != "time": continue
        hdr = [cells0[1], cells0[3]]
        ev = []
        for r in rows[1:]:
            c = [text(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
            if len(c) < 4: continue
            tm, L, sc, R = c[0], c[1], c[2], c[3]
            m = re.match(r"(\d+)-(\d+)", sc)
            sL, sR = (int(m.group(1)), int(m.group(2))) if m else (None, None)
            if L: ev.append((tm, "L", L, sL, sR))
            if R: ev.append((tm, "R", R, sL, sR))
        periods.append(ev)
    return hdr, periods

# ── event grammar ──────────────────────────────────────────────────────────
# stats.ncaa.org has TWO play-by-play grammars, and a single season mixes them by game
# (2018-19 has both):
#   new  "Player Name, 2pt drivinglayup pointsinthepaint; made"   "Name, substitution in"
#        "Name, freethrow 1of2 made"  "Team, rebound offensive team"  (2019 spells shots
#        "2pt jumpshot missed")
#   old  "LAST,FIRST made Three Point Jumper"  "LAST,FIRST Enters Game" / "Leaves Game"
#        "TEAM Offensive Rebound"  "TEAM Deadball Rebound"  (uppercase, no space after the comma;
#        suffixes ride on the last name: "STOCKARD III,LEVI"; ",MICHAEL HUEITT JR" has none)
# parse_event() folds both into (name, kind, points, sub_dir).
OLD_RE = re.compile(r"^([A-Z'\-\. ]*),(\S[^,]*?) (Enters Game|Leaves Game|made .*|missed .*|Defensive Rebound|Offensive Rebound|Deadball Rebound|Turnover|Assist|Steal|Commits Foul|Blocked Shot|.*Timeout.*)$")
OLD_TEAM_RE = re.compile(r"^TEAM (.*)$")

def _old_action(act):
    """old-grammar action text → (kind, pts, sub_dir)"""
    a = act.strip(); al = a.lower()
    if al == "enters game": return "sub", 0, "in"
    if al == "leaves game": return "sub", 0, "out"
    if al.startswith("made free throw"): return "ft", 1, None
    if al.startswith("missed free throw"): return "ft", 0, None
    if al.startswith("made "): return "fga", (3 if "three point" in al else 2), None
    if al.startswith("missed "): return "fga", 0, None
    if al == "offensive rebound": return "oreb", 0, None
    if al == "defensive rebound": return "dreb", 0, None
    if al == "turnover": return "tov", 0, None
    return "other", 0, None

def _new_action(act):
    """new-grammar action text (everything after the name) → (kind, pts, sub_dir)"""
    al = act.strip().lower()
    m = re.match(r"^substitution (in|out)\b", al)
    if m: return "sub", 0, m.group(1)
    if al.startswith("freethrow"): return "ft", (1 if re.search(r"\bmade\b", al) else 0), None
    if al.startswith("turnover"): return "tov", 0, None
    if al.startswith("rebound offensive"): return ("other" if "deadball" in al else "oreb"), 0, None
    if al.startswith("rebound defensive"): return "dreb", 0, None
    m = re.match(r"^(2|3)pt\b", al)
    if m and ("made" in al or "missed" in al): return "fga", (int(m.group(1)) if re.search(r"\bmade\b", al) else 0), None
    return "other", 0, None

def parse_event(desc):
    """→ (name or None for team rows, kind, pts, sub_dir). kind ∈ sub|ft|fga|oreb|dreb|tov|other."""
    d = desc.strip()
    m = OLD_TEAM_RE.match(d)
    if m and ", " not in d:
        k, p, sd = _old_action(m.group(1)); return None, k, p, sd
    m = OLD_RE.match(d)
    if m:
        name = (m.group(2).strip() + " " + m.group(1).strip()).strip()
        k, p, sd = _old_action(m.group(3)); return name, k, p, sd
    # new grammar: the action is the text after the LAST ", " (suffix names carry an
    # extra comma: "Jimmy Nichols, Jr. , 2pt jumpshot made")
    if ", " in d:
        name, act = d.rsplit(", ", 1)
        k, p, sd = _new_action(act)
        nl = name.strip().lower()
        return (None if nl in ("team", "") else name.strip()), k, p, sd
    return None, "other", 0, None

# kept for callers / tests
def pts_of(desc): return parse_event(desc)[2]
def classify(desc): return parse_event(desc)[1]

# ── one game → per-espn tallies (same shapes build_onoff.finish expects) ───
def process_game(html, og, ncaa):
    hdr, periods = parse_pbp(html)
    if not hdr or not periods: return None, "no-pbp"
    box = B.sb_get(f"box_scores?game_id=eq.{og['id']}&select=player,espn_id,team,starter,min")
    if not box: return None, "no-box"
    bteams = list({b["team"] for b in box if b.get("team")})
    if len(bteams) < 2: return None, "box-teams<2"
    tov = lambda a, b: len(set(B.norm(a).split()) & set(B.norm(b).split()))
    # NCAA left/right header names → our two box team names
    L_team = max(bteams, key=lambda bt: (tov(bt, hdr[0]), -tov(bt, hdr[1])))
    R_team = max([bt for bt in bteams if bt != L_team], key=lambda bt: tov(bt, hdr[1]))
    if tov(L_team, hdr[0]) == 0 and tov(R_team, hdr[1]) == 0: return None, "side-map"
    def side_map(bteam):
        rows = [b for b in box if b["team"] == bteam and b.get("espn_id") is not None]
        n2e = {B.norm(b["player"]): str(b["espn_id"]) for b in rows}
        rows.sort(key=lambda b: -B._minf(b.get("min")))
        return n2e, [str(b["espn_id"]) for b in rows], rows
    Lm, Rm = side_map(L_team), side_map(R_team)
    n2e = {"L": Lm[0], "R": Rm[0]}
    byMin = {"L": Lm[1], "R": Rm[1]}
    rowsBy = {"L": Lm[2], "R": Rm[2]}
    _cache = {}
    def resolve(side, name):
        """espn_id for an NCAA-spelled name: exact normalized match, else the one box player on
        that side sharing last name + first initial (handles 'Kino Lilly Jr.' / 'D.J. Davis')."""
        key = (side, name)
        if key in _cache: return _cache[key]
        nn = B.norm(name); eid = n2e[side].get(nn)
        if eid is None and nn:
            parts = nn.split(); last = parts[-1]; fi = parts[0][0] if parts else ""
            cands = [b for b in rowsBy[side] if B.norm(b["player"]).split() and B.norm(b["player"]).split()[-1] == last and B.norm(b["player"])[0] == fi]
            if len(cands) == 1: eid = str(cands[0]["espn_id"])
        _cache[key] = eid; return eid
    acc = defaultdict(lambda: {"onF":0,"onA":0,"onP":0.0,"onDP":0.0,"side":None})
    tot = {"L":{"F":0,"A":0,"P":0.0}, "R":{"F":0,"A":0,"P":0.0}}
    stint = {s: {"pts":0,"fga":0,"oreb":0,"tov":0,"fta":0} for s in "LR"}
    on = {"L": set(), "R": set()}
    bad = 0
    def poss(s): return max(0.0, s["fga"] - s["oreb"] + s["tov"] + 0.44 * s["fta"])
    def close_stint():
        lp, rp = poss(stint["L"]), poss(stint["R"]); lpts, rpts = stint["L"]["pts"], stint["R"]["pts"]
        if lp == 0 and rp == 0 and lpts == 0 and rpts == 0: return
        for e in list(on["L"]):
            a = acc[e]; a["side"] = "L"; a["onF"] += lpts; a["onA"] += rpts; a["onP"] += lp; a["onDP"] += rp
        for e in list(on["R"]):
            a = acc[e]; a["side"] = "R"; a["onF"] += rpts; a["onA"] += lpts; a["onP"] += rp; a["onDP"] += lp
        tot["L"]["F"] += lpts; tot["L"]["A"] += rpts; tot["L"]["P"] += lp
        tot["R"]["F"] += rpts; tot["R"]["A"] += lpts; tot["R"]["P"] += rp
        for k in stint: stint[k] = {"pts":0,"fga":0,"oreb":0,"tov":0,"fta":0}
    for ev in periods:
        # who starts the period: anyone whose FIRST event this period is not "substitution in";
        # top up to five from the box (minutes order) if the log leaves a side short.
        first = {"L": {}, "R": {}}
        for tm, side, desc, _, _ in ev:
            name, kind, _, sd = parse_event(desc)
            if not name: continue
            eid = resolve(side, name)
            if eid is None or eid in first[side]: continue
            first[side][eid] = (kind == "sub" and sd == "in")
        for side in "LR":
            starters = [e for e, sub_in in first[side].items() if not sub_in]
            for e in byMin[side]:
                if len(starters) >= 5: break
                if e not in starters and not first[side].get(e, False): starters.append(e)
            on[side] = set(starters[:5])
        for tm, side, desc, sL, sR in ev:
            # points from the scoring EVENTS, not score deltas: rows sharing a clock time are
            # listed out of order on stats.ncaa.org, so the running score bounces and deltas
            # over-count (Georgia 86 vs a real 71). Event points match the box exactly.
            name, c, pts, sd = parse_event(desc)
            stint[side]["pts"] += pts
            if c == "sub":
                close_stint()
                eid = resolve(side, name) if name else None
                if eid is None: bad += 1; continue
                if sd == "in": on[side].add(eid)
                else: on[side].discard(eid)
                continue
            if c == "fga": stint[side]["fga"] += 1
            elif c == "ft": stint[side]["fta"] += 1
            elif c == "oreb": stint[side]["oreb"] += 1
            elif c == "tov": stint[side]["tov"] += 1
        close_stint()
    for s in "LR":
        p = tot[s]["P"]
        if p < 45 or p > 130: return None, "bad-poss(%s=%.0f)" % (s, p)
        o = 100 * tot[s]["F"] / p if p else 0
        if o < 50 or o > 185: return None, "bad-ortg(%s=%.0f)" % (s, o)
    names = {str(b["espn_id"]): b["player"] for b in box if b.get("espn_id") is not None}
    # finish() expects 'H'/'A' side keys: map L→H, R→A (labels only — sides are symmetric)
    acc2 = {e: dict(a, side=("H" if a["side"] == "L" else "A")) for e, a in acc.items()}
    tot2 = {"H": tot["L"], "A": tot["R"]}
    return {"acc": acc2, "tot": tot2, "bad": bad, "teamH": L_team, "teamA": R_team, "names": names}, "ok"

def season_dates(season):
    d = date(season - 1, 11, 1); end = date(season, 4, 10)
    while d <= end: yield d; d += timedelta(days=1)

def run(season, limit=0, verbose=False, resume=False):
    br = Browser()
    agg = defaultdict(lambda: {"team":None,"name":None,"onF":0,"onA":0,"onP":0.0,"onDP":0.0,"tF":0,"tA":0,"tP":0.0,"games":0})
    matched = processed = 0; failed = defaultdict(int)
    # checkpoint = done game ids + the running per-player tallies. A done-list alone is not
    # enough: resuming would skip those games AND lose their tallies, so the season would be
    # written from the remainder only.
    done_fp = os.path.join(CACHE, f"ckpt_{season}.json"); done = set()
    if resume and os.path.exists(done_fp):
        ck = json.load(open(done_fp)); done = set(ck["done"])
        for eid, x in ck["agg"].items(): agg[eid].update(x)
        matched, processed = ck["matched"], ck["processed"]; failed.update(ck["failed"])
        print(f"  resumed: {processed} games, {len(agg)} players", flush=True)
    def checkpoint():
        json.dump({"done": sorted(done), "agg": agg, "matched": matched, "processed": processed, "failed": failed}, open(done_fp, "w"))
    try:
        for d in season_dates(season):
            sb_url = f"{BASE}/contests/livestream_scoreboards?sport_code=MBB&academic_year={season}&division=1&game_date={d.month:02d}/{d.day:02d}/{d.year}"
            html = cached(f"sb_{d.isoformat()}", "sb", lambda: br.get(sb_url, need="contests/"))
            games = parse_scoreboard(html)
            if not games: continue
            our = B.our_games_on(d)
            if not our: continue
            for g in games:
                if g["nid"] in done: continue
                ncaa = {"home": g["teams"][1], "away": g["teams"][0], "hs": g["scores"][1], "as": g["scores"][0],
                        "home_alt": [g["teams"][1]], "away_alt": [g["teams"][0]]}
                og = B.match_our_game(our, ncaa)
                if not og:
                    ncaa2 = {"home": g["teams"][0], "away": g["teams"][1], "hs": g["scores"][0], "as": g["scores"][1],
                             "home_alt": [g["teams"][0]], "away_alt": [g["teams"][1]]}
                    og = B.match_our_game(our, ncaa2)
                if not og: failed["no-game-match"] += 1; continue
                matched += 1
                pbp = cached(g["nid"], "pbp", lambda: br.get(f"{BASE}/contests/{g['nid']}/play_by_play", need="Time</th>"))
                res, why = process_game(pbp, og, ncaa)
                if res is None:
                    failed[why] += 1
                    if why == "no-pbp": print(f"   no play-by-play for nid {g['nid']} {g['teams']} ({d})", flush=True)
                    if verbose and failed[why] <= 3: print(f"   skip {why}: nid {g['nid']} {g['teams']} (page {len(pbp)} chars)", flush=True)
                    continue
                processed += 1; done.add(g["nid"])
                for eid, a in res["acc"].items():
                    x = agg[eid]; x["team"] = res["teamH"] if a["side"] == "H" else res["teamA"]
                    x["name"] = res["names"].get(eid) or x.get("name")
                    x["onF"] += a["onF"]; x["onA"] += a["onA"]; x["onP"] += a["onP"]; x["onDP"] += a["onDP"]; x["games"] += 1
                    t = res["tot"][a["side"]]; x["tF"] += t["F"]; x["tA"] += t["A"]; x["tP"] += t["P"]
                if verbose and processed <= 8:
                    print(f"[{d}] {g['teams'][0]} vs {g['teams'][1]} (nid {g['nid']}, our {og['id']}) players={len(res['acc'])} bad={res['bad']}", flush=True)
                if processed % 50 == 0:
                    print(f"  ...{processed} games ({d})", flush=True)
                    checkpoint()
                    B.finish(agg, matched, processed, failed, season, write=True, verbose=False)
                if limit and processed >= limit:
                    return B.finish(agg, matched, processed, failed, season, write=False, verbose=verbose)
        checkpoint()
        return B.finish(agg, matched, processed, failed, season, write=True, verbose=verbose)
    finally:
        br.close()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, nargs="+", required=True, help="one or more seasons, run in order")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--resume", action="store_true")
    a = ap.parse_args()
    for y in a.season:
        run(y, a.limit, a.verbose, a.resume)
