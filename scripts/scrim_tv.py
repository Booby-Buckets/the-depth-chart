#!/usr/bin/env python3
"""Fill the TV / stream for 2026-27 scrimmages (scripts/data/scrimmages_2027.json -> "tv") from the schools'
own schedule pages (/sports/mens-basketball/schedule/2026-27 — allowed by every site's robots.txt; the
/documents/ paths some sites disallow are never touched).

Two page layouts:
  new Sidearm (Nuxt) game cards:  <div class="s-game-card__header__tv ..."><div> TV: ACCNX</div></div>
  classic Sidearm schedule rows:  <span class="sidearm-schedule-game-coverage-tv-content"> MW+ </span>
A card is matched to a scrimmage by its date ("Oct 7") and the opponent's name. The home team's page is
read first, then the away team's. A TV already in the file is kept unless --force.

    python3 scripts/scrim_tv.py          # upcoming + today's scrimmages with no TV yet
    python3 scripts/scrim_tv.py --all    # every scrimmage, past ones too
    python3 scripts/scrim_tv.py --force  # re-read TV even where one is set
    python3 scripts/scrim_tv.py --dry    # report, don't write
"""
import json, re, sys, datetime, html as H
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import scrim_boxes as sb

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


def find_tv(site, date, opp_forms):
    d = datetime.date.fromisoformat(date)
    day = re.compile(r"\b%s\.?\s+%d\b" % (MON[d.month - 1], d.day))
    for c in cards(page(site)):
        c = c[:30000]
        t = text(c)
        if not day.search(t):
            continue
        tw = set(sb.words(t))
        if not any(sum(1 for w in ow if w in tw) >= min(2, len(ow)) for ow in opp_forms):
            continue
        return tv_of(c), True
    return None, False


def main():
    force, dry, every = "--force" in sys.argv, "--dry" in sys.argv, "--all" in sys.argv
    doc = json.loads(sb.GAMES.read_text())
    sites = json.loads(sb.SITES.read_text())
    today = datetime.date.today().isoformat()
    todo = [g for g in doc["games"] if (every or g["date"] >= today) and (force or not g.get("tv"))]
    print(f"{len(todo)} scrimmages to check")
    got = 0
    for g in todo:
        tv, seen = None, False
        for me, opp in ((g["home"], g["away"]), (g["away"], g["home"])):
            site = (sites.get(me) or {}).get("site")
            if not site:
                continue
            tv, hit = find_tv(site, g["date"], sb.school(opp, sites))
            seen = seen or hit
            if tv:
                break
        tag = f"{g['date']} {g['away']} at {g['home']}"
        if tv:
            if tv != g.get("tv"):
                g["tv"] = tv; got += 1
            print(f"  ok {tag}: {tv}")
        else:
            print(f"  -- {tag}: {'listed, no TV given' if seen else 'not found on either schedule'}")
    if got and not dry:
        sb.GAMES.write_text(json.dumps(doc, indent=1, ensure_ascii=False))
        print(f"wrote TV for {got} scrimmage(s)")


if __name__ == "__main__":
    main()
