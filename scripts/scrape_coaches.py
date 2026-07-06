#!/usr/bin/env python3
"""
scrape_coaches.py — build the coach ↔ team-season history.

Sports Reference CBB school pages list the head coach for every season, with
W/L and SRS. We already have SR school slugs in bbref_seasons.school_slug, so
we fetch one page per school and parse its seasons table.

Output: scripts/data/coach_seasons.json  — a list of
  {season_year, school, school_slug, coach, coach_slug, wins, losses, srs, conf}
season_year uses our convention (the ENDING year: SR "2024-25" -> 2025).

Optionally upserts to Supabase table `coach_seasons` (see schema_coaching.sql)
when --upload is passed.

Usage:
  python3 scripts/scrape_coaches.py                # scrape + write JSON
  python3 scripts/scrape_coaches.py --upload       # also push to Supabase
  python3 scripts/scrape_coaches.py --limit 5      # smoke test on 5 schools
"""
import json, os, re, sys, time, urllib.request, urllib.parse

SB  = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
UA  = "Mozilla/5.0 (compatible; TheDepthChart/1.0)"
YMIN, YMAX = 2007, 2026            # season_year window we cover
DELAY = 3.0                        # seconds between SR requests (respect rate limits)
OUT = os.path.join(os.path.dirname(__file__), "data", "coach_seasons.json")


def sb_get(path):
    req = urllib.request.Request(SB + "/rest/v1/" + path, headers=HDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def school_list():
    """Distinct (school, school_slug) from bbref_seasons — union a few seasons so
    we also catch schools that only existed early in the window."""
    seen = {}
    for yr in (2025, 2018, 2010):
        try:
            rows = sb_get("bbref_seasons?select=school,school_slug&season_year=eq.%d" % yr)
        except Exception as e:
            print("  warn: season %d fetch failed (%s)" % (yr, e)); rows = []
        for r in rows:
            sl = (r.get("school_slug") or "").strip()
            if sl and sl not in seen:
                seen[sl] = r.get("school") or sl
    return sorted(seen.items())        # [(slug, school), ...]


def fetch(url, tries=4):
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 429:               # rate limited — back off hard
                time.sleep(20 * (a + 1)); continue
            if e.code == 404:
                return None
            time.sleep(3 * (a + 1))
        except Exception:
            time.sleep(3 * (a + 1))
    return None


def _cell(row, stat):
    m = re.search(r'data-stat="' + stat + r'"[^>]*>(.*?)</t[dh]>', row, re.S)
    return re.sub(r"<[^>]+>", "", m.group(1)).strip() if m else None


def parse_school(html, slug, school):
    html = html.replace("<!--", "").replace("-->", "")   # SR comments out some tables
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        season = _cell(row, "season")
        coach_cell = _cell(row, "coaches")
        if not season or not coach_cell or not re.match(r"\d{4}-\d{2}", season):
            continue
        yr = int(season[:4]) + 1                      # "2024-25" -> 2025
        if yr < YMIN or yr > YMAX:
            continue
        # coach slug from the link, name without the "(W-L)" suffix
        cslug = None
        m = re.search(r'/cbb/coaches/([a-z0-9\-]+)\.html', row)
        if m:
            cslug = m.group(1)
        # a season can list 2 coaches (mid-season change); keep the first (primary)
        coach = re.split(r"\s*\(", coach_cell)[0].strip()
        coach = re.split(r"\s*,\s*", coach)[0].strip()
        def num(x):
            try: return int(x)
            except Exception: return None
        def fl(x):
            try: return float(x)
            except Exception: return None
        out.append({
            "season_year": yr, "school": school, "school_slug": slug,
            "coach": coach, "coach_slug": cslug,
            "wins": num(_cell(row, "wins")), "losses": num(_cell(row, "losses")),
            "srs": fl(_cell(row, "srs")), "conf": _cell(row, "conf_abbr"),
        })
    return out


def upload(rows):
    # upsert in chunks on (school_slug, season_year)
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        body = json.dumps(chunk).encode()
        req = urllib.request.Request(
            SB + "/rest/v1/coach_seasons?on_conflict=school_slug,season_year",
            data=body, method="POST",
            headers={**HDR, "Content-Type": "application/json",
                     "Prefer": "resolution=merge-duplicates"})
        try:
            urllib.request.urlopen(req, timeout=60).read()
            print("  uploaded rows %d-%d" % (i, i + len(chunk)))
        except urllib.error.HTTPError as e:
            print("  upload error:", e.code, e.read()[:200]); return


def main():
    limit = None; do_upload = False
    for a in sys.argv[1:]:
        if a == "--upload": do_upload = True
        elif a.startswith("--limit"): limit = int(sys.argv[sys.argv.index(a) + 1])
    schools = school_list()
    if limit: schools = schools[:limit]
    print("scraping %d schools…" % len(schools))
    all_rows = []
    for i, (slug, school) in enumerate(schools):
        url = "https://www.sports-reference.com/cbb/schools/%s/men/" % slug
        html = fetch(url)
        if html:
            rows = parse_school(html, slug, school)
            all_rows += rows
            print("  [%d/%d] %-28s %d seasons" % (i + 1, len(schools), school, len(rows)))
        else:
            print("  [%d/%d] %-28s FAILED" % (i + 1, len(schools), school))
        time.sleep(DELAY)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(all_rows, f)
    print("wrote %d coach-seasons -> %s" % (len(all_rows), OUT))
    if do_upload:
        upload(all_rows)


if __name__ == "__main__":
    main()
