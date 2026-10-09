#!/usr/bin/env python3
"""Fill the TV / stream (and missing tip times) for 2026-27 scrimmages (scripts/data/scrimmages_2027.json -> "tv") from the schools'
own schedule pages (/sports/mens-basketball/schedule/2026-27 — allowed by every site's robots.txt; the
/documents/ paths some sites disallow are never touched).

Two page layouts:
  new Sidearm (Nuxt) game cards:  <div class="s-game-card__header__tv ..."><div> TV: ACCNX</div></div>
  classic Sidearm schedule rows:  <span class="sidearm-schedule-game-coverage-tv-content"> MW+ </span>
Missing tip times are filled too, converted to Eastern (the file's zone): a time with its own zone ("7:00 PM PT")
converts directly; a bare one ("7 p.m.") uses the site's zone, learned by lining its regular-season cards up
with ESPN's UTC start times. A time already in the file is never overwritten. A card is matched to a scrimmage by its date ("Oct 7") and the opponent's name. The home team's page is
read first, then the away team's. A TV already in the file is kept unless --force.

    python3 scripts/scrim_tv.py          # upcoming + today's scrimmages with no TV yet
    python3 scripts/scrim_tv.py --all    # every scrimmage, past ones too
    python3 scripts/scrim_tv.py --force  # re-read TV even where one is set
    python3 scripts/scrim_tv.py --dry    # report, don't write
"""
import json, re, sys, datetime, html as H
from zoneinfo import ZoneInfo
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import scrim_boxes as sb

ET = ZoneInfo("America/New_York")
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_pages = {}


def page(site):
    if site not in _pages:
        _pages[site] = sb.get(f"{site}/sports/mens-basketball/schedule/{sb.SEASON}") or ""
    return _pages[site]


def cards(h):
    """split a schedule page into one HTML chunk per game"""
    parts = re.split(r'<(?:div|li)[^>]*class="(?:[^"]*\s)?(?:s-game-card|sidearm-schedule-game)[\s"]', h)
    return parts[1:]


def text(chunk):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", chunk))).strip()


def tv_of(chunk):
    m = re.search(r's-game-card__header__tv[^>]*>\s*<div[^>]*>\s*TV:\s*([^<]+)<', chunk)
    if not m:
        m = re.search(r'coverage-tv-content[^>]*>\s*(?:<[^>]+>\s*)*([^<]+?)\s*<', chunk)
    if not m:
        m = re.search(r'\bTV:\s*([A-Za-z0-9+&/\- ]{2,24}?)(?=\s{2,}|<| Radio| Watch| Live| Tickets| Preview|$)', text(chunk))
    v = H.unescape(m.group(1)).strip(" :-") if m else ""
    v = re.sub(r"(?i)^(big ?ten|big 10|b1g) ?\+$", "B1G+", v)   # sites spell Big Ten Plus four ways
    v = re.sub(r"(?i)^sec network ?\+$", "SECN+", v)
    return v if v and v.lower() not in ("tbd", "tba", "none", "n/a") else None


TIME = re.compile(r"\b(\d{1,2})(?::(\d\d))?\s*([ap])\.?\s?m\.?(?:\s*(ET|EDT|EST|CT|CDT|CST|MT|MDT|MST|PT|PDT|PST)\b)?", re.I)
ZONE = {"E": 0, "C": -1, "M": -2, "P": -3}             # hours behind Eastern
ARIZONA = {"https://arizonawildcats.com", "https://thesundevils.com", "https://gculopes.com", "https://nauathletics.com"}
ESPN_SCHED = ("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/"
              "teams/{}/schedule?seasontype=2")
_zone = {}


def card_for(site, date, opp_forms):
    """(card html, card text) for the game on `date` vs the opponent, or None"""
    d = datetime.date.fromisoformat(date)
    day = re.compile(r"\b%s\.?\s+%d\b" % (MON[d.month - 1], d.day))
    for c in cards(page(site)):
        c = c[:30000]
        t = text(c)
        m = day.search(t)
        if not m:
            continue
        tw = set(sb.words(t))
        if not any(sum(1 for w in ow if w in tw) >= min(2, len(ow)) for ow in opp_forms):
            continue
        return c, t[m.end():m.end() + 60]
    return None


def card_time(after_date):
    """('7:00 PM' clock minutes, zone letter or None) from the text right after the card's date"""
    m = TIME.search(after_date)
    if not m:
        return None, None
    h = int(m.group(1)) % 12 + (12 if m.group(3).lower() == "p" else 0)
    return h * 60 + int(m.group(2) or 0), (m.group(4) or "")[:1].upper() or None


def to_et(z):
    return z.astimezone(ET)


def site_zone(site, team_full, sites, ids):
    """hours this site's listed times sit behind Eastern, learned by lining its regular-season game cards up
    with ESPN's UTC start times (majority vote). None when nothing lines up."""
    if site in _zone:
        return _zone[site]
    votes = {}
    tid = ids.get(team_full)
    try:
        ev = sb.S.get(ESPN_SCHED.format(tid), timeout=30).json().get("events", []) if tid else []
    except Exception:
        ev = []
    for e in ev:
        if not e.get("timeValid"):
            continue
        et = to_et(datetime.datetime.fromisoformat(e["date"].replace("Z", "+00:00")))
        if not (12 <= et.hour <= 21):           # keep clear of midnight so local and Eastern dates agree
            continue
        comp = (e.get("competitions") or [{}])[0].get("competitors", [])
        opp = next((x["team"].get("displayName") for x in comp if x.get("team", {}).get("id") != str(tid)), None)
        if not opp:
            continue
        hit = card_for(site, et.date().isoformat(), sb.school(opp, sites))
        if not hit:
            continue
        mins, z = card_time(hit[1])
        if mins is None or z:
            continue
        diff = (mins - (et.hour * 60 + et.minute)) / 60
        if diff in (0, -1, -2, -3):
            votes[diff] = votes.get(diff, 0) + 1
        if sum(votes.values()) >= 5:
            break
    _zone[site] = max(votes, key=votes.get) if votes else None
    return _zone[site]


def clock(mins):
    h, m = divmod(mins % 1440, 60)
    return f"{(h % 12) or 12}:{m:02d} {'PM' if h >= 12 else 'AM'}"


def et_time(site, team_full, date, after_date, sites, ids):
    """the card's tip time converted to Eastern, or None"""
    mins, z = card_time(after_date)
    if mins is None:
        return None
    if z:
        diff = ZONE[z]
    else:
        diff = site_zone(site, team_full, sites, ids)
        if diff is None:
            return None
        if site in ARIZONA and date < "2026-11-01":   # Arizona skips DST: one more hour behind Eastern before Nov 1
            diff -= 1
    return clock(mins - int(diff * 60))


def main():
    force, dry, every = "--force" in sys.argv, "--dry" in sys.argv, "--all" in sys.argv
    doc = json.loads(sb.GAMES.read_text())
    sites = json.loads(sb.SITES.read_text())
    ids = {}
    # ESPN team ids (only used to learn each site's time zone); games_2027.jsonl is gitignored, so it is
    # absent on the Actions runner — without it times fall back to the site's listed clock, never a crash
    gp = sb.DATA / "games_2027.jsonl"
    if gp.exists():
        for line in open(gp):
            r = json.loads(line)
            ids[r["home"]] = r["home_id"]; ids[r["away"]] = r["away_id"]
    today = datetime.date.today().isoformat()
    todo = [g for g in doc["games"] if (every or g["date"] >= today) and (force or not g.get("tv") or not g.get("time"))]
    print(f"{len(todo)} scrimmages to check")
    got = 0
    for g in todo:
        tv, seen, tip = None, False, None
        for me, opp in ((g["home"], g["away"]), (g["away"], g["home"])):
            site = (sites.get(me) or {}).get("site")
            if not site:
                continue
            hit = card_for(site, g["date"], sb.school(opp, sites))
            if not hit:
                continue
            seen = True
            tv = tv or tv_of(hit[0])
            if not g.get("time") and not tip:
                tip = et_time(site, me, g["date"], hit[1], sites, ids)
            if tv and (tip or g.get("time")):
                break
        tag = f"{g['date']} {g['away']} at {g['home']}"
        if tv and tv != g.get("tv") and (force or not g.get("tv")):
            g["tv"] = tv; got += 1
            print(f"  tv   {tag}: {tv}")
        if tip and not g.get("time"):          # a time already in the file (owner-entered) is never overwritten
            g["time"] = tip; got += 1
            print(f"  time {tag}: {tip} ET")
        if not seen:
            print(f"  --   {tag}: not found on either schedule")
    if got and not dry:
        sb.GAMES.write_text(json.dumps(doc, indent=1, ensure_ascii=False))
        print(f"wrote {got} TV/time fill(s)")


if __name__ == "__main__":
    main()
