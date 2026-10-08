#!/usr/bin/env python3
"""Pull box scores for the 2026-27 preseason scrimmages (scripts/data/scrimmages_2027.json).

For every scrimmage on or before today with no box score yet, look at the home team's (then the
away team's) athletics site schedule page (Sidearm: /sports/mens-basketball/schedule/2026-27), find
the game's box-score link (/sports/mens-basketball/stats/2026-27/<opponent>/boxscore/<id>), parse
the linescore + both teams' player tables, and write them into scrimmage_results_2027.json:

    results[id] = {hs, as, src, auto_note, box: {home: {team, players, totals}, away: {...}}}

hs/as follow the LISTED home team in scrimmages_2027.json (also on neutral floors). A hand-entered
result (from a PDF or screenshot the owner sends) is never overwritten unless --force.

Scrimmage stats never write to games / box_scores /
player_history; scrim_reality.py weights them and the projection build blends them in lightly.

    python3 scripts/scrim_boxes.py            # fetch what's missing
    python3 scripts/scrim_boxes.py --force    # refetch every played game
    python3 scripts/scrim_boxes.py --dry      # report, don't write
"""
import json, re, sys, datetime, time
from html.parser import HTMLParser
from pathlib import Path
import requests

DATA = Path(__file__).parent / "data"
GAMES = DATA / "scrimmages_2027.json"
RES = DATA / "scrimmage_results_2027.json"
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
    force, dry = "--force" in sys.argv, "--dry" in sys.argv
    games = json.loads(GAMES.read_text())["games"]
    res = json.loads(RES.read_text())
    sites = json.loads(SITES.read_text())
    today = datetime.date.today().isoformat()
    todo = [g for g in games if g["date"] <= today and (force or "box" not in res["results"].get(g["id"], {}))
            and not (res["results"].get(g["id"], {}).get("manual") and not force)]
    print(f"{len(todo)} played scrimmages without a box score")
    got = 0
    for g in todo:
        url = None
        for me, opp in ((g["home"], g["away"]), (g["away"], g["home"])):
            site = (sites.get(me) or {}).get("site")
            if not site: continue
            c = find_box(site, school(opp, sites))
            if c: url = sorted(c)[-1]; break
        if not url:
            print(f"  -- {g['date']} {g['away']} at {g['home']}: no box score found"); continue
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
        print(f"  ok {g['date']} {g['away']} {ab['score']} at {g['home']} {hb['score']}  ({len(hb['players'])}+{len(ab['players'])} players)")
    if got and not dry:
        RES.write_text(json.dumps(res, indent=1))
        print(f"wrote {got} box score(s) to {RES.name}")


if __name__ == "__main__":
    main()
