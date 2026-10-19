#!/usr/bin/env python3
"""Pull box scores for the 2026-27 preseason scrimmages (scripts/data/scrimmages_2027.json).

For every scrimmage on or before today with no box score yet, look at the home team's (then the
away team's) athletics site schedule page (Sidearm: /sports/mens-basketball/schedule/2026-27), find
the game's box-score link (/sports/mens-basketball/stats/2026-27/<opponent>/boxscore/<id>), parse
the linescore + both teams' player tables, and write them into scrimmage_results_2027.json:

    results[id] = {hs, as, src, auto_note, box: {home: {team, players, totals}, away: {...}}}

hs/as follow the LISTED home team in scrimmages_2027.json (also on neutral floors). A hand-entered
result (from a PDF or screenshot the owner sends) is never overwritten unless --force.

The same box page carries the full play-by-play (Nuxt payload `periodsWithPlays` on the new Sidearm
layout, a "play-by-play" table per half on the classic one). It goes to scrimmage_pbp_2027.json
(kept out of the results file, which every team page loads):

    pbp[id] = {src, plays: ["per|clock|side|name|ACTION|TYPE|hs|as|flags", ...]}

side h/a = the LISTED home/away, hs/as the running score after the play in the same order, name = the
box-score name when the checkname ("SARR,DAME") matches one (else the checkname, or TEAM), flags p =
in the paint, f = fastbreak. scrimmage.html (tdc-scrimflow.js) rebuilds game flow, rotations, +/- and
five-man lineups from it. Hand-entered results are left alone; their PBP is still saved if the source
is a Sidearm box page.

Scrimmage stats never write to games / box_scores /
player_history; scrim_reality.py weights them and the projection build blends them in lightly.

    python3 scripts/scrim_boxes.py            # fetch what's missing
    python3 scripts/scrim_boxes.py --force    # refetch every played game
    python3 scripts/scrim_boxes.py --dry      # report, don't write
    python3 scripts/scrim_boxes.py --pbp      # (re)fetch the play-by-play of every box already in
"""
import html, json, re, sys, datetime, time, unicodedata
from html.parser import HTMLParser
from pathlib import Path
import requests

DATA = Path(__file__).parent / "data"
GAMES = DATA / "scrimmages_2027.json"
RES = DATA / "scrimmage_results_2027.json"
PBP = DATA / "scrimmage_pbp_2027.json"
SITES = DATA / "school_sites_2027.json"
SEASON = "2026-27"
S = requests.Session()
S.headers["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"


def get(url):
    for i in range(2):
        try:
            r = S.get(url, timeout=30)
            if r.ok: return r.text
            if r.status_code == 404: return None
        except requests.RequestException:
            pass
        time.sleep(2)
    return None


class Tables(HTMLParser):
    def __init__(self):
        super().__init__(); self.tables = []; self.cur = None; self.row = None; self.cell = None
    def handle_starttag(self, t, a):
        if t == "table": self.cur = []; self.tables.append(self.cur)
        elif t == "tr" and self.cur is not None: self.row = []
        elif t in ("td", "th") and self.row is not None: self.cell = ""
    def handle_endtag(self, t):
        if t in ("td", "th") and self.cell is not None: self.row.append(re.sub(r"\s+", " ", self.cell).strip()); self.cell = None
        elif t == "tr" and self.row is not None: self.cur.append(self.row); self.row = None
    def handle_data(self, d):
        if self.cell is not None: self.cell += d


def words(s):
    s = re.sub(r"\b(st|st\.)\b", "state", s.lower())
    return [w for w in re.split(r"[^a-z0-9]+", s) if w and w not in ("university", "of", "the")]


def school(full, sites):
    """every way a site may spell the school: NCAA short name ('UIW'), the site slug ('incarnate-word'),
    and the ESPN name minus its mascot ('Incarnate Word')."""
    rec = sites.get(full) or {}
    forms = [rec.get("ncaa"), (rec.get("slug") or "").replace("-", " "), re.sub(r"\s+\S+$", "", full)]
    out = []
    for f in forms:
        w = words(f or "")
        if w and w not in out: out.append(w)
    return out


def find_box(site, opp_words):
    """box-score URLs on a team's schedule page whose opponent slug matches the opponent."""
    h = get(f"{site}/sports/mens-basketball/schedule/{SEASON}")
    if not h: return []
    links = set(re.findall(r'href="(/sports/mens-basketball/stats/%s/([^/"]+)/boxscore/(\d+))"' % SEASON, h))
    out = []
    for path, slug, _id in links:
        sw = slug.split("-")
        for ow in opp_words:
            hit = sum(1 for w in ow if w in sw)
            if hit and hit >= min(2, len(ow)): out.append(site + path); break
    return out


_SCHED = {}
def sched_text(site):
    """a team's schedule page as plain text (cached per run)"""
    if site not in _SCHED:
        h = get(f"{site}/sports/mens-basketball/schedule/{SEASON}") or ""
        h = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S)
        _SCHED[site] = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h)))
    return _SCHED[site]


MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DATE_RE = re.compile(r"\b(%s)\.? (\d{1,2})\b" % "|".join(MON))
def sched_entry(site, date, opp_words):
    """what the schedule page says about the game on `date` vs this opponent when there's no box-score link:
    ('score', mine, theirs) from a "W, 94-61" result, ('canceled', None, None), or None. A game's text sits
    between the previous game's date and its own (opponent, venue, result, then "Oct 7 (Wed) 7:00")."""
    t = sched_text(site)
    if not t: return None
    d = datetime.date.fromisoformat(date); want = (MON[d.month - 1], d.day)
    marks = [m for m in DATE_RE.finditer(t)]
    for i, m in enumerate(marks):
        if (m.group(1), int(m.group(2))) != want: continue
        seg = t[(marks[i - 1].end() + 20) if i else max(0, m.start() - 400): m.start()]
        sw = words(seg)
        if not any(sum(1 for w in ow if w in sw) >= min(2, len(ow)) for ow in opp_words): continue
        if re.search(r"\b(cancell?ed|postponed)\b", seg, re.I): return ("canceled", None, None)
        r = re.search(r"\b([WL])\s*,?\s*(\d{2,3})\s*-\s*(\d{2,3})\b", seg)
        if r:
            a, b = int(r.group(2)), int(r.group(3))
            return ("score", max(a, b), min(a, b)) if r.group(1) == "W" else ("score", min(a, b), max(a, b))
    return None


def sched_dates(site, opp_words):
    """every date a team's schedule page lists this opponent on: each mention of the opponent's name is tied to the
    nearest date on the page (Sidearm prints a game's date right before or right after its opponent)."""
    t = sched_text(site)
    if not t: return set()
    marks = [(m.start(), m.group(1), int(m.group(2))) for m in DATE_RE.finditer(t)]
    if not marks: return set()
    out = set()
    for ow in opp_words:
        if not ow: continue
        for m in re.finditer(r"\b" + r"\W+".join(re.escape(w) for w in ow) + r"\b", t, re.I):
            pos, mon, day = min(marks, key=lambda k: abs(k[0] - m.start()))
            mi = MON.index(mon) + 1
            out.add(datetime.date(SEASON_START + (mi < 7), mi, day).isoformat())
    return out
SEASON_START = int(SEASON[:4])


def split(v):
    m = re.match(r"\s*(\d+)\s*-\s*(\d+)", v or "")
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def num(v):
    try: return int(v)
    except (TypeError, ValueError): return None


def parse_box(h):
    p = Tables(); p.feed(h)
    # two Sidearm layouts: "Team | 1 | 2 | Total" and "Team | 1 | 2 | Total F | Records" with
    # "Winner MUR Murray St." / "WSU Wichita St." labels and "##" player sheets ("77 Domon,Roman")
    line = next((t for t in p.tables if t and t[0] and t[0][0] == "Team" and any(c.startswith("Total") for c in t[0])), None)
    if not line: return None
    ti = next(i for i, c in enumerate(line[0]) if c.startswith("Total"))
    def lab(x):
        x = re.sub(r"^Winner\s+", "", x.strip()); w = x.split()
        return " ".join(w[1:]) if len(w) > 1 and re.fullmatch(r"[A-Z&]{2,6}", w[0]) and not re.fullmatch(r"[A-Z&]{2,6}", w[1]) else x
    teams = [(lab(r[0]), num(r[ti])) for r in line[1:] if len(r) > ti]
    sheets = [t for t in p.tables if t and len(t[0]) > 1 and t[0][0] in ("#", "##") and t[0][1] == "Player"]
    if len(teams) != 2 or len(sheets) != 2: return None
    out = []
    for (name, score), t in zip(teams, sheets):
        hdr = [c.lower() for c in t[0]]; ix = {c: i for i, c in enumerate(hdr)}
        players, totals = [], None
        for r in t[1:]:
            if len(r) < len(hdr): continue
            if r[0] == "Totals" or r[1] == "Totals": totals = r; continue
            if r[0] == "TM" or r[1].endswith("TEAM"): continue
            nm = re.sub(r"^\d+\s+", "", r[ix["player"]])
            if "," in nm: last, first = [x.strip() for x in nm.split(",", 1)]; nm = f"{first} {last}"
            fgm, fga = split(r[ix["fg"]]); tpm, tpa = split(r[ix["3pt"]]); ftm, fta = split(r[ix["ft"]])
            orb, drb = split(r[ix.get("orb-drb", -1)]) if "orb-drb" in ix else (None, None)
            players.append({"name": nm, "no": r[0], "gs": r[ix.get("gs", 2)] == "*", "min": num(r[ix["min"]]),
                            "fgm": fgm, "fga": fga, "tpm": tpm, "tpa": tpa, "ftm": ftm, "fta": fta,
                            "oreb": orb, "dreb": drb, "reb": num(r[ix["reb"]]), "pf": num(r[ix["pf"]]),
                            "ast": num(r[ix["a"]]), "tov": num(r[ix["to"]]), "blk": num(r[ix["blk"]]),
                            "stl": num(r[ix["stl"]]), "pts": num(r[ix["pts"]])})
        tot = None
        if totals:
            fgm, fga = split(totals[ix["fg"]]); tpm, tpa = split(totals[ix["3pt"]]); ftm, fta = split(totals[ix["ft"]])
            tot = {"fgm": fgm, "fga": fga, "tpm": tpm, "tpa": tpa, "ftm": ftm, "fta": fta, "reb": num(totals[ix["reb"]]),
                   "ast": num(totals[ix["a"]]), "tov": num(totals[ix["to"]]), "stl": num(totals[ix["stl"]]),
                   "blk": num(totals[ix["blk"]]), "pts": num(totals[ix["pts"]])}
        out.append({"label": name, "score": score, "players": players, "totals": tot})
    return out


# ── play-by-play ─────────────────────────────────────────────────────────────
def nuxt_data(h):
    """the Nuxt devalue payload (flat array, values point at indices) → a resolver"""
    m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
    if not m: return None
    A = json.loads(m.group(1)); memo = {}
    WRAP = ("Reactive", "ShallowReactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef")
    def r(i):
        if i in memo: return memo[i]
        v = A[i]
        if isinstance(v, list):
            if v and isinstance(v[0], str) and v[0] in WRAP: out = r(v[1]) if len(v) > 1 else None
            elif v and isinstance(v[0], str) and v[0] in ("Set", "Map", "Date", "RegExp", "Error", "BigInt", "NaN", "Infinity", "-Infinity", "-0", "undefined", "null"): out = None
            else:
                out = []; memo[i] = out; out.extend(r(x) for x in v); return out
        elif isinstance(v, dict):
            out = {}; memo[i] = out
            for k, x in v.items(): out[k] = r(x) if isinstance(x, int) and not isinstance(x, bool) else x
            return out
        else: out = v
        memo[i] = out; return out
    for i, v in enumerate(A):
        if isinstance(v, dict) and "periodsWithPlays" in v: return r(i)
    return None


PLAY_RE = re.compile(r"^(GOOD|MISS|SUB|REBOUND|ASSIST|TURNOVER|STEAL|BLOCK|FOUL|TIMEOUT)\s*(\S*)\s+by\s+(.+?)\s*((?:\([^)]*\)\s*)*)$", re.I)
def raw_plays(h):
    """([(period, clock, sidearm_side 'h'/'a', checkname, action, type, home_score|None, away_score|None, flags)],
    {'h': code, 'a': code}) — codes are the page's own team abbreviations ('DU', 'BEL')"""
    g = nuxt_data(h)
    if g and g.get("periodsWithPlays"):
        out = []; codes = {"h": g.get("homeTeamId") or "", "a": g.get("visitingTeamId") or ""}
        for P in g["periodsWithPlays"]:
            n = int(P.get("number") or 1)
            for p in P.get("plays") or []:
                fl = ("p" if p.get("isInThePaint") else "") + ("f" if p.get("isAFastbreak") else "")
                out.append((n, p.get("time") or "", "h" if p.get("isHomeTeam") else "a", (p.get("checkname") or "").strip(),
                            (p.get("action") or "").upper(), (p.get("type") or "").upper(),
                            num(p.get("homeScore")), num(p.get("visitingScore")), fl))
        return out, codes
    # classic layout: one table per period — time | away play | away score | · | home score | home play | ...
    t = Tables(); t.feed(h)
    pers = [x for x in t.tables if x and x[0] and x[0][0] == "Time Remaining" and len(x[0]) >= 6]
    out = []; codes = {"h": pers[0][0][5], "a": pers[0][0][1]} if pers else {}
    for n, tb in enumerate(pers, 1):
        clock = ""
        for r in tb[1:]:
            if len(r) < 6: continue
            if r[0] and r[0] != "--": clock = r[0]
            side, txt = ("a", r[1]) if r[1] else ("h", r[5])
            m = PLAY_RE.match(txt or "")
            if not m: continue
            fl = ("p" if "in the paint" in txt.lower() else "") + ("f" if "fastbreak" in txt.lower() else "")
            sc = lambda v: num(re.sub(r"\s*\(.*", "", v or "").strip())
            out.append((n, clock, side, m.group(3).strip(), m.group(1).upper(), m.group(2).upper(), sc(r[4]), sc(r[2]), fl))
    return out, codes


def _nk(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s.lower()))


def check_to_name(check, players):
    """'SARR,DAME' / 'BOUMTJE BOUMTJE,JOAQ' → the box-score name ('Dame Sarr'), or None"""
    if "," not in check: return None
    last, first = (_nk(x) for x in check.split(",", 1))
    if not last: return None
    hits = [p["name"] for p in players if last in _nk(p["name"]) and _nk(p["name"]).startswith(first[:3])]
    if len(hits) != 1: hits = [p["name"] for p in players if _nk(p["name"]).endswith(last) and _nk(p["name"]).startswith(first)] or hits
    if len(hits) != 1: hits = [p["name"] for p in players if _nk(p["name"]) == first + last]   # "Jr., George Turkson"
    return hits[0] if len(hits) == 1 else None


def parse_pbp(h, box, hs_final=None, as_final=None):
    """the box page's play-by-play in the listed home/away frame (see the module docstring), or None"""
    raw, codes = raw_plays(h)
    if len(raw) < 50 or not box: return None
    hp, ap = box["home"]["players"], box["away"]["players"]
    # which Sidearm side is our listed home? the side whose checknames match its box
    votes = 0
    for _, _, sd, ck, *_ in raw:
        if ck == "TEAM": continue
        inh, ina = check_to_name(ck, hp) is not None, check_to_name(ck, ap) is not None
        if inh != ina: votes += (1 if inh == (sd == "h") else -1)
    flip = votes < 0
    plays, hs, as_ = [], 0, 0
    for n, clock, sd, ck, act, typ, sh, sa, fl in raw:
        side = {"h": "a", "a": "h"}[sd] if flip else sd
        if flip: sh, sa = sa, sh
        if act == "GOOD":   # the Nuxt payload carries 0-0 on plays that didn't score
            if sh is not None: hs = sh
            if sa is not None: as_ = sa
        nm = ck if ck == "TEAM" else (check_to_name(ck, hp if side == "h" else ap) or ck)
        plays.append([n, clock, side, nm.replace("|", " "), act, typ, hs, as_, fl])
    # neutral-floor pages can label the score columns the other way round from the plays: trust the final
    if plays and hs_final is not None and (plays[-1][6], plays[-1][7]) == (as_final, hs_final) != (hs_final, as_final):
        for x in plays: x[6], x[7] = x[7], x[6]
    codes = {"h": codes.get("a"), "a": codes.get("h")} if flip else codes
    return {"codes": codes, "plays": ["|".join(str(v) for v in x) for x in plays]}


def side_of(label, full, sites):
    """does a linescore label ('Michigan St.', 'UIW') belong to this team?"""
    lw = words(label)
    for sw in school(full, sites):
        if lw and all(w in sw for w in lw): return True
        if label.replace(".", "").lower() in ("".join(w[0] for w in sw), "".join(sw)): return True
    return False


def note_of(box_home, box_away, home, away):
    def top(b):
        ps = sorted([p for p in b["players"] if p["pts"] is not None], key=lambda p: -p["pts"])[:2]
        return ", ".join(f"{p['name'].split(' ', 1)[-1]} {p['pts']}" for p in ps)
    sch = lambda f: re.sub(r"\s+\S+$", "", f)
    return f"{sch(home)}: {top(box_home)} · {sch(away)}: {top(box_away)}"


def main():
    force, dry, repbp = "--force" in sys.argv, "--dry" in sys.argv, "--pbp" in sys.argv
    G = json.loads(GAMES.read_text()); games = G["games"]
    res = json.loads(RES.read_text())
    pbp = json.loads(PBP.read_text()) if PBP.exists() else {}
    pbp_new = 0
    sites = json.loads(SITES.read_text())
    today = datetime.date.today().isoformat()
    todo = [g for g in games if g["date"] <= today and (force or "box" not in res["results"].get(g["id"], {}))
            and not (res["results"].get(g["id"], {}).get("manual") and not force)]
    print(f"{len(todo)} played scrimmages without a box score")
    got = 0; canceled = []; moved = []
    for g in todo:
        url = None
        for me, opp in ((g["home"], g["away"]), (g["away"], g["home"])):
            site = (sites.get(me) or {}).get("site")
            if not site: continue
            c = find_box(site, school(opp, sites))
            if c: url = sorted(c)[-1]; break
        if not url:
            # no box-score link: the schedule page may still carry the final score (WMT sites, recap-only games)
            # or say the game was canceled
            found = None
            for me, opp in ((g["home"], g["away"]), (g["away"], g["home"])):
                site = (sites.get(me) or {}).get("site")
                e = sched_entry(site, g["date"], school(opp, sites)) if site else None
                if e: found = (me, site, e); break
            if found and found[2][0] == "canceled":
                canceled.append(g); print(f"  xx {g['date']} {g['away']} at {g['home']}: canceled ({found[1]})"); continue
            rec = res["results"].get(g["id"], {})
            if found and found[2][0] == "score" and rec.get("hs") is None:
                me, site, (_, mine, theirs) = found
                hs, as_ = (mine, theirs) if me == g["home"] else (theirs, mine)
                rec.update({"hs": hs, "as": as_, "src": f"{site}/sports/mens-basketball/schedule/{SEASON}",
                            "auto_note": "Final score from the schedule page; no box score posted"})
                res["results"][g["id"]] = rec; got += 1
                print(f"  ok {g['date']} {g['away']} {as_} at {g['home']} {hs}  (score only, from {site})"); continue
            # moved? both schools' pages list the game on one other date and neither lists ours -> take their date
            if rec.get("hs") is None:
                per = []   # each page's dates for this matchup; a city named like the team ("Dayton, OH") can add a stray one,
                for me, opp in ((g["home"], g["away"]), (g["away"], g["home"])):   # so two pages must agree
                    site = (sites.get(me) or {}).get("site")
                    ds = {d for d in sched_dates(site, school(opp, sites)) if f"{SEASON_START}-10-01" <= d <= f"{SEASON_START}-11-15"} if site else set()
                    if ds: per.append(ds)
                seen = set.intersection(*per) if per else set()
                if seen and g["date"] not in seen and len(seen) == 1:
                    new = seen.pop(); moved.append((g, new))
                    print(f"  >> {g['date']} {g['away']} at {g['home']}: schedule pages list it on {new} — moving it"); continue
            print(f"  -- {g['date']} {g['away']} at {g['home']}: no box score found" + (" (score already in)" if rec.get("hs") is not None else "")); continue
        h = get(url); B = parse_box(h) if h else None
        if not B:
            print(f"  !! {url}: could not parse"); continue
        hb = next((b for b in B if side_of(b["label"], g["home"], sites)), None)
        ab = next((b for b in B if b is not hb), None)
        if hb is None:   # fall back to linescore order: away first, home second
            ab, hb = B[0], B[1]
        rec = res["results"].get(g["id"], {})
        rec.update({"hs": hb["score"], "as": ab["score"], "src": url,
                    "auto_note": note_of(hb, ab, g["home"], g["away"]),
                    "box": {"home": {"team": g["home"], **{k: hb[k] for k in ("players", "totals")}},
                            "away": {"team": g["away"], **{k: ab[k] for k in ("players", "totals")}}}})
        res["results"][g["id"]] = rec; got += 1
        pb = parse_pbp(h, rec["box"], rec["hs"], rec["as"])
        if pb: pbp[g["id"]] = {"src": url, **pb}; pbp_new += 1
        print(f"  ok {g['date']} {g['away']} {ab['score']} at {g['home']} {hb['score']}  ({len(hb['players'])}+{len(ab['players'])} players, {len(pb['plays']) if pb else 'no'} plays)")
    # play-by-play for every Sidearm box already in (hand-entered results included: only the PBP file is written)
    for gid, rec in res["results"].items():
        src = rec.get("src") or ""
        if "/boxscore/" not in src or not rec.get("box") or (gid in pbp and not repbp): continue
        h = get(src); pb = parse_pbp(h, rec["box"], rec.get("hs"), rec.get("as")) if h else None
        if pb: pbp[gid] = {"src": src, **pb}; pbp_new += 1
        print(f"  pbp {gid}: {len(pb['plays']) if pb else 'none found'}")
    if pbp_new and not dry:
        PBP.write_text(json.dumps(dict(sorted(pbp.items())), indent=0, ensure_ascii=False))
        print(f"wrote play-by-play for {pbp_new} game(s) to {PBP.name}")
    if got and not dry:
        RES.write_text(json.dumps(res, indent=1))
        print(f"wrote {got} result(s) to {RES.name}")
    if moved and not dry:   # rescheduled: same id (pages key on it), new date
        for g, d in moved: g["date"] = d
        GAMES.write_text(json.dumps(G, indent=1, ensure_ascii=False))
        print(f"moved {len(moved)} rescheduled game(s) in {GAMES.name}")
    if canceled and not dry:   # off the list every page reads, kept on record under "canceled"
        ids = {g["id"] for g in canceled}
        G["games"] = [g for g in games if g["id"] not in ids]
        G["canceled"] = (G.get("canceled") or []) + [dict(g, canceled=datetime.date.today().isoformat()) for g in canceled]
        GAMES.write_text(json.dumps(G, indent=1, ensure_ascii=False))
        print(f"moved {len(canceled)} canceled game(s) out of {GAMES.name}")


if __name__ == "__main__":
    main()
