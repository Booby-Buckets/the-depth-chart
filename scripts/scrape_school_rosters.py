#!/usr/bin/env python3
"""Scrape men's basketball rosters from each school's OFFICIAL athletics site.

Why not ESPN: in Sept 2026 ESPN's "2026-27" rosters were a mix — some current (Duke),
many just last season relabeled (Arizona, Indiana). School sites are the source of truth.

Input : scripts/data/school_sites.json  {our team name: {espn_id, domain, roster_path?}}
Output: scripts/data/school_rosters_2027.json
        [{team, domain, url, platform, season, players:[{name, jersey, pos, cls, ht, wt,
          hometown, high_school, prev_school}], error?}]

Platforms handled (one parser each):
  sidearm-next   SIDEARM "nextgen" (Nuxt) — s-person-card, label/value pairs
  sidearm-legacy SIDEARM classic — li.sidearm-roster-player with per-field span classes
  wmt            WMT Digital — .roster-card-item cards

Polite by design: robots.txt is checked for every site (skipped if disallowed), ONE page per
school, and a User-Agent that names the site. St. Bonaventure disallows us -> left out.

    python3 scripts/scrape_school_rosters.py            # all teams
    python3 scripts/scrape_school_rosters.py Duke Iowa  # just these
"""
import concurrent.futures as cf
import html as H
import json
import os
import re
import sys
import urllib.request
import urllib.robotparser

HERE = os.path.dirname(os.path.abspath(__file__))
SITES = os.path.join(HERE, 'data', 'school_sites.json')
OUT = os.path.join(HERE, 'data', 'school_rosters_2027.json')
UA = 'Mozilla/5.0 (compatible; TheDepthChartRosters/1.0; +https://www.thedepthchartcbb.com)'
SEASON = '2026-27'


def fetch(url, timeout=45):
    r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=timeout)
    return r.read().decode('utf-8', 'ignore'), r.geturl()


def allowed(domain, url):
    rp = urllib.robotparser.RobotFileParser()
    try:
        txt, _ = fetch(f'https://{domain}/robots.txt', 20)
        rp.parse(txt.splitlines())
    except Exception:
        return True          # no robots.txt = no restriction
    return rp.can_fetch(UA, url)


def text(s):
    s = re.sub(r'<[^>]+>', ' ', s or '')
    s = H.unescape(s).replace('′', "'").replace('″', '"').replace("''", '"')
    return re.sub(r'\s+', ' ', s).strip()


def clean_ht(s):
    m = re.search(r"(\d)\s*['′-]\s*(\d{1,2})", s or '')
    return f"{m.group(1)}-{m.group(2)}" if m else (s or '').strip()


def clean_wt(s):
    m = re.search(r'(\d{3})', s or '')
    return int(m.group(1)) if m else None


CLS = [(r'^(r-?|rs\.?\s*|redshirt\s*)?(fr|freshman)', 'Fr'), (r'^(r-?|rs\.?\s*|redshirt\s*)?(so|sophomore)', 'So'),
       (r'^(r-?|rs\.?\s*|redshirt\s*)?(jr|junior)', 'Jr'), (r'^(r-?|rs\.?\s*|redshirt\s*)?(sr|senior)', 'Sr'),
       (r'^(gr|grad|graduate|5th|fifth)', 'Gr')]


def clean_cls(s):
    t = (s or '').strip().lower()
    for pat, v in CLS:
        m = re.match(pat, t)
        if m:
            return ('R-' + v) if (m.lastindex and m.lastindex >= 2 and m.group(1)) else v
    return (s or '').strip()


def season_of(h):
    # the season the page is SHOWING: a selected <option>, else the page title / hero heading
    for pat in (r'<option[^>]*selected[^>]*>\s*(\d{4}-\d{2})(?!\d)', r'<title>[^<]*?(\d{4}-\d{2})(?!\d)',
                r'<h1[^>]*>[^<]*?(\d{4}-\d{2})(?!\d)', r'aria-current="true"[^>]*>\s*(\d{4}-\d{2})'):
        m = re.search(pat, h, re.I)
        if m:
            return m.group(1)
    return None


# ── WMT (Nuxt) — the page embeds the full roster as a devalue-encoded __NUXT_DATA__ blob.
# Reading it beats the HTML: every WMT layout (cards / table / list) carries the same records,
# each tagged with its season, so we can take exactly the 2026-27 roster.
def nuxt_decode(h):
    m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
    if not m:
        return None
    arr = json.loads(m.group(1))
    memo = {}
    WRAP = ('ShallowReactive', 'Reactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef')
    SPECIAL = ('Set', 'Map', 'Date', 'RegExp', 'BigInt', 'undefined', 'NaN', 'Infinity', '-Infinity', '-0')

    def r(i):
        if not isinstance(i, int) or isinstance(i, bool) or i < 0 or i >= len(arr):
            return i
        if i in memo:
            return memo[i]
        v = arr[i]
        if isinstance(v, list):
            if v and isinstance(v[0], str) and v[0] in WRAP:
                out = r(v[1]) if len(v) > 1 else None
            elif v and isinstance(v[0], str) and v[0] in SPECIAL:
                out = None
            else:
                out = []
                memo[i] = out
                out.extend(r(x) for x in v)
                return out
        elif isinstance(v, dict):
            out = {}
            memo[i] = out
            for k, x in v.items():
                out[k] = r(x)
            return out
        else:
            out = v
        memo[i] = out
        return out
    return r(0)


def nuxt_walk(o, seen=None):
    seen = set() if seen is None else seen
    if id(o) in seen:
        return
    seen.add(id(o))
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from nuxt_walk(v, seen)
    elif isinstance(o, list):
        for v in o:
            yield from nuxt_walk(v, seen)


def parse_wmt_json(h):
    """-> (players, season) or (None, None) when the page has no WMT roster records."""
    try:
        d = nuxt_decode(h)
    except Exception:
        return None, None
    if d is None:
        return None, None
    recs = [o for o in nuxt_walk(d) if 'roster_id' in o and isinstance(o.get('player'), dict) and 'first_name' in o['player']]
    if not recs:
        return None, None

    def season(x):
        r = x.get('roster') if isinstance(x.get('roster'), dict) else {}
        s = r.get('season') if isinstance(r.get('season'), dict) else {}
        return s.get('name') or ''
    seasons = sorted({season(x) for x in recs}, reverse=True)
    want = SEASON if SEASON in seasons else (seasons[0] if seasons else '')
    out, seen = [], set()
    for x in recs:
        if season(x) != want:
            continue
        pl = x['player']
        name = (pl.get('full_name') or f"{pl.get('first_name', '')} {pl.get('last_name', '')}").strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        cl = x.get('class_level') if isinstance(x.get('class_level'), dict) else {}
        po = x.get('player_position') if isinstance(x.get('player_position'), dict) else {}
        ft, inch = x.get('height_feet') or pl.get('height_feet'), x.get('height_inches') or pl.get('height_inches')
        out.append({'name': text(name), 'jersey': x.get('jersey_number_label') or pl.get('jersey_number_label'),
                    'pos': po.get('name') or po.get('abbreviation'), 'cls': clean_cls(cl.get('name')),
                    'ht': f"{ft}-{inch or 0}" if ft else None, 'wt': x.get('weight') or pl.get('weight'),
                    'hometown': pl.get('hometown'), 'high_school': pl.get('high_school'),
                    'prev_school': pl.get('previous_school') or ''})
    return out, want


def norm_season(s):
    """'2025-2026' / '2025-26' / "2025-26 Men's Basketball Roster" -> '2025-26'."""
    m = re.search(r'(20\d\d)\s*[-\u2013/]\s*(?:20)?(\d\d)(?!\d)', s or '')
    return f"{m.group(1)}-{m.group(2)}" if m else None


def parse_sidearm_json(h):
    """SIDEARM nextgen embeds the roster store in __NUXT_DATA__ too. The roster's displayTitle
    ("2026-27 Men's Basketball Roster") says which season the page is really showing — schools
    that haven't posted the new roster still serve LAST season here, so this is the season check.
    -> (players, season) or (None, None)."""
    try:
        d = nuxt_decode(h)
    except Exception:
        return None, None
    if d is None:
        return None, None
    stores = [o for o in nuxt_walk(d) if 'rosterPlayers' in o and 'roster' in o]
    if not stores:
        return None, None
    season = None
    for st in stores:
        r = st.get('roster')
        for v in (r.values() if isinstance(r, dict) else []):
            if isinstance(v, dict) and v.get('displayTitle'):
                season = norm_season(v['displayTitle']) or season
    out, seen = [], set()
    for x in nuxt_walk(d):
        if not ('firstName' in x and 'lastName' in x and ('academicYearLong' in x or 'heightFeet' in x)):
            continue
        name = f"{x.get('firstName') or ''} {x.get('lastName') or ''}".strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        ft, inch = x.get('heightFeet'), x.get('heightInches')
        out.append({'name': text(name), 'jersey': x.get('jerseyNumber'), 'pos': x.get('positionShort') or x.get('positionLong'),
                    'cls': clean_cls(x.get('academicYearShort') or x.get('academicYearLong')),
                    'ht': f"{ft}-{inch or 0}" if ft else None, 'wt': x.get('weight'),
                    'hometown': x.get('hometown'), 'high_school': x.get('highSchool'),
                    'prev_school': x.get('previousSchool') or ''})
    return out, season


def parse_sidearm_next(h):
    out = []
    for c in re.split(r'data-test-id="s-person-card-list__root"', h)[1:]:
        c = c[:20000]
        name = re.search(r'aria-label="([^"]+?) jersey number', c) or re.search(r'aria-label="([^"]+?) full bio', c)
        if not name:
            continue
        # label/value pairs: <span class="sr-only">Label</span> value
        t = re.sub(r'<[^>]+>', '|', c)
        t = re.sub(r'(\s*\|\s*)+', '|', H.unescape(t))
        f = {}
        for lab in ('Jersey Number', 'Position', 'Academic Year', 'Height', 'Weight', 'Hometown', 'Last School',
                    'Previous School', 'High School', 'Class'):
            m = re.search(r'\|' + lab + r'\|([^|]+)', t)
            if m:
                f[lab] = m.group(1).strip()
        if 'Position' not in f and 'Academic Year' not in f:
            continue          # a staff card
        prev = f.get('Previous School') or f.get('Last School') or ''
        out.append({'name': text(name.group(1)), 'jersey': f.get('Jersey Number'), 'pos': f.get('Position'),
                    'cls': clean_cls(f.get('Academic Year') or f.get('Class')), 'ht': clean_ht(f.get('Height')),
                    'wt': clean_wt(f.get('Weight')), 'hometown': f.get('Hometown'),
                    'high_school': f.get('High School'), 'prev_school': prev})
    return out


def span(c, cls):
    m = re.search(r'class="[^"]*\b' + re.escape(cls) + r'\b[^"]*"[^>]*>(.*?)</(span|div|a|h3|p)>', c, re.S)
    return text(m.group(1)) if m else ''


def parse_sidearm_legacy(h):
    out = []
    for c in re.split(r'<li[^>]*class="sidearm-roster-player[ "]', h)[1:]:
        c = c[:15000]
        nm = re.search(r'class="sidearm-roster-player-name"[^>]*>.*?<a[^>]*>(.*?)</a>', c, re.S)
        name = text(nm.group(1)) if nm else (span(c, 'sidearm-roster-player-first-name') + ' ' + span(c, 'sidearm-roster-player-last-name')).strip()
        if not name:
            continue
        pos = span(c, 'sidearm-roster-player-position-long-short') or span(c, 'sidearm-roster-player-position')
        out.append({'name': name, 'jersey': span(c, 'sidearm-roster-player-jersey-number'),
                    'pos': re.sub(r'\s+\d.*$', '', pos).strip(), 'cls': clean_cls(span(c, 'sidearm-roster-player-academic-year')),
                    'ht': clean_ht(span(c, 'sidearm-roster-player-height')), 'wt': clean_wt(span(c, 'sidearm-roster-player-weight')),
                    'hometown': span(c, 'sidearm-roster-player-hometown'), 'high_school': span(c, 'sidearm-roster-player-highschool'),
                    'prev_school': span(c, 'sidearm-roster-player-previous-school')})
    return out


def parse_wmt(h):
    out = []
    h = re.sub(r'<script.*?</script>|<style.*?</style>', '', h, flags=re.S)
    # player cards only (staff cards live in .roster-staff-members)
    staff = h.find('roster-staff-members')
    body = h[:staff] if staff > 0 else h
    for c in body.split('class="roster-card-item"')[1:]:
        c = c[:12000]
        nm = re.search(r'roster-card-item__title[^>]*>(.*?)</', c, re.S) or re.search(r'roster-card-item__title-link[^>]*>(.*?)</a>', c, re.S)
        if not nm or not text(nm.group(1)):
            continue
        jersey = re.search(r'roster-card-jersey-number[^>]*>(.*?)</', c, re.S)
        pos = re.search(r'roster-card-item__position[^>]*>(.*?)</', c, re.S)
        fields = {text(l): text(v) for l, v in re.findall(
            r'roster-player-card-profile-field__label[^>]*>(.*?)</[^>]+>.*?roster-player-card-profile-field__value[^>]*>(.*?)</', c, re.S)}
        t = text(c)
        ht = re.search(r"(\d)\s*['′]\s*(\d{1,2})", t)
        wt = re.search(r'(\d{3})\s*lbs', t)
        cl = re.search(r'\b(Redshirt\s+)?(Freshman|Sophomore|Junior|Senior|Graduate|Fr\.|So\.|Jr\.|Sr\.|Gr\.)', t)
        out.append({'name': text(nm.group(1)), 'jersey': text(jersey.group(1)).lstrip('#') if jersey else None,
                    'pos': text(pos.group(1)) if pos else None, 'cls': clean_cls(''.join(x or '' for x in cl.groups())) if cl else None,
                    'ht': f"{ht.group(1)}-{ht.group(2)}" if ht else None, 'wt': int(wt.group(1)) if wt else None,
                    'hometown': fields.get('Hometown'), 'high_school': fields.get('High School'),
                    'prev_school': fields.get('Previous School') or fields.get('Last School') or ''})
    return out


def parse_roster_item(h):
    """Kentucky / South Carolina template: <li class="roster__item roster-item" itemprop="athlete">
    with the number, name and "Guard - 6'1" 170 lbs Freshman" in one info block."""
    out = []
    for c in h.split('class="roster__item roster-item"')[1:]:
        c = c[:6000]
        nm = re.search(r'roster-item__name[^>]*>(.*?)</', c, re.S)
        if not nm or not text(nm.group(1)):
            continue
        num = re.search(r'roster-item__number[^>]*>(.*?)</', c, re.S)
        info = re.search(r'roster-item__info[^>]*>(.*?)</(?:div|p|span)>', c, re.S)
        t = text(info.group(1)) if info else text(c)
        pos = re.match(r'\s*([A-Za-z/ ]+?)\s*-', t)
        ht = re.search(r"(\d)\s*'\s*(\d{1,2})", t)
        wt = re.search(r'(\d{3})\s*lbs', t)
        cl = re.search(r'\b(Redshirt\s+)?(Freshman|Sophomore|Junior|Senior|Graduate)', t)
        out.append({'name': text(nm.group(1)), 'jersey': text(num.group(1)) if num else None,
                    'pos': pos.group(1).strip() if pos else None,
                    'cls': clean_cls(''.join(x or '' for x in cl.groups())) if cl else None,
                    'ht': f"{ht.group(1)}-{ht.group(2)}" if ht else None, 'wt': int(wt.group(1)) if wt else None,
                    'hometown': None, 'high_school': None, 'prev_school': ''})
    return out


def parse_schema_athletes(h):
    """Generic fallback: any template that marks players up as schema.org Person with
    itemprop="athlete" (South Carolina, some WMT WordPress sites)."""
    out = []
    for c in re.split(r'<li[^>]*itemprop="athlete"', h)[1:]:
        c = c[:6000]
        nm = re.search(r'itemprop="name"[^>]*content="([^"]+)"', c) or re.search(r'alt="([^"]+)"', c)
        if not nm:
            continue
        t = text(c)
        pos = re.search(r'\b(Guard|Forward|Center|G/F|F/C|G|F|C)\b', t)
        ht = re.search(r"(\d)\s*'\s*(\d{1,2})", t)
        wt = re.search(r'(\d{3})\s*lbs', t)
        cl = re.search(r'\b(Redshirt\s+)?(Freshman|Sophomore|Junior|Senior|Graduate|Fr\.|So\.|Jr\.|Sr\.|Gr\.)', t)
        num = re.search(r'(?:#|No\.\s*)(\d{1,2})\b', t)
        out.append({'name': text(nm.group(1)), 'jersey': num.group(1) if num else None, 'pos': pos.group(1) if pos else None,
                    'cls': clean_cls(''.join(x or '' for x in cl.groups())) if cl else None,
                    'ht': f"{ht.group(1)}-{ht.group(2)}" if ht else None, 'wt': int(wt.group(1)) if wt else None,
                    'hometown': None, 'high_school': None, 'prev_school': ''})
    return out


def scrape(team, site):
    d = site['domain']
    url = f"https://{d}{site.get('roster_path') or '/sports/mens-basketball/roster'}"
    rec = {'team': team, 'domain': d, 'url': url, 'platform': None, 'season': None, 'players': []}
    try:
        if not allowed(d, url):
            rec['error'] = 'robots.txt disallows'
            return rec
        h, final = fetch(url)
        rec['url'] = final
        rec['season'] = season_of(h)
        wj, wseason = parse_wmt_json(h)
        sj, sseason = (None, None) if wj else parse_sidearm_json(h)
        if wj:
            rec['platform'], rec['players'], rec['season'] = 'wmt', wj, norm_season(wseason)
        elif sj is not None and (sj or sseason):
            rec['platform'], rec['players'] = 'sidearm-next', sj
            rec['season'] = sseason or rec['season']
        elif 's-person-card' in h:
            rec['platform'], rec['players'] = 'sidearm-next', parse_sidearm_next(h)
        elif 'sidearm-roster-player' in h:
            rec['platform'], rec['players'] = 'sidearm-legacy', parse_sidearm_legacy(h)
        elif 'class="roster__item roster-item"' in h:
            rec['platform'], rec['players'] = 'roster-item', parse_roster_item(h)
        elif 'roster-card-item' in h:
            rec['platform'], rec['players'] = 'wmt', parse_wmt(h)
        elif 'itemprop="athlete"' in h:
            rec['platform'], rec['players'] = 'schema', parse_schema_athletes(h)
        else:
            rec['platform'] = 'unknown'
        # de-dupe (some templates render a card twice for mobile/desktop)
        seen, uniq = set(), []
        for p in rec['players']:
            k = p['name'].lower()
            if k not in seen:
                seen.add(k)
                uniq.append(p)
        rec['players'] = uniq
        rec['season'] = norm_season(rec['season']) or rec['season']
        if rec['season'] and rec['season'] != SEASON:
            # the school hasn't posted the new roster yet — last season's list is NOT a 2026-27 roster
            rec['stale'] = True
            rec['error'] = f"site still shows the {rec['season']} roster (2026-27 not posted yet)"
        elif not uniq:
            rec['error'] = 'no players listed yet' if rec['season'] == SEASON else 'no players parsed'
    except Exception as e:
        rec['error'] = str(e)[:120]
    return rec


def main():
    sites = json.load(open(SITES))
    only = set(sys.argv[1:])
    todo = [(t, s) for t, s in sites.items() if (not only or t in only) and not s.get('manual')]
    prev = {}
    if only and os.path.exists(OUT):
        prev = {r['team']: r for r in json.load(open(OUT))}
    with cf.ThreadPoolExecutor(12) as ex:        # 12 DIFFERENT domains at once, one request each
        res = list(ex.map(lambda ts: scrape(*ts), todo))
    for r in res:
        prev[r['team']] = r
    out = sorted(prev.values(), key=lambda r: r['team'])
    json.dump(out, open(OUT, 'w'), indent=1, ensure_ascii=False)
    ok = [r for r in res if not r.get('error')]
    print(f"{len(ok)}/{len(res)} teams scraped, {sum(len(r['players']) for r in ok)} players")
    for r in res:
        if r.get('error') or not r.get('season'):
            print(f"  {r['team']:20s} {r.get('platform') or '-':15s} season={r.get('season')}  {r.get('error') or ''}")


if __name__ == '__main__':
    main()
