#!/usr/bin/env python3
"""Build the static coach-ranking payloads the conference page loads.

Two outputs, both small enough to fetch in the browser:

  data/coach-careers.json    one entry per coach  (career grade / rank / archetype)
  data/coach-<year>.json     one entry per coach-season for that year, already
                             joined to the team_seasons team name + conference

The join lives here, offline, rather than in the page: coach_seasons uses
Sports-Reference school names ("Southern Methodist") while team_seasons uses
full names with mascots ("SMU Mustangs"), and a handful need explicit aliases.
Resolving once at build time means the page can join on an exact string.

Usage:  python3 scripts/build_conf_coaches.py [--check]
"""
import json, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'scripts', 'data')
OUT  = os.path.join(ROOT, 'data')
TSY  = '/tmp/tsy'          # per-year team_seasons dumps

# School names that don't prefix-match their team_seasons counterpart.
ALIAS = {
    'Southern Methodist': 'SMU',
    'Miami (FL)': 'Miami',
    'Miami (OH)': 'Miami (OH)',
    'Texas Christian': 'TCU',
    'Central Florida': 'UCF',
    'Nevada-Las Vegas': 'UNLV',
    'Southern California': 'USC',
    'Louisiana State': 'LSU',
    'Brigham Young': 'BYU',
    'Virginia Commonwealth': 'VCU',
    'Alabama-Birmingham': 'UAB',
    'North Carolina-Greensboro': 'UNC Greensboro',
    'North Carolina-Wilmington': 'UNC Wilmington',
    'North Carolina-Asheville': 'UNC Asheville',
    'Maryland-Baltimore County': 'UMBC',
    'Maryland-Eastern Shore': 'Maryland Eastern Shore',
    'Texas-San Antonio': 'UTSA',
    'Texas-El Paso': 'UTEP',
    'Texas-Rio Grande Valley': 'UT Rio Grande Valley',
    'Missouri-Kansas City': 'Kansas City',
    'Illinois-Chicago': 'UIC',
    'Massachusetts-Lowell': 'UMass Lowell',
    'Hawaii': "Hawai'i",
    'San Jose State': 'San José State',
    'Nicholls State': 'Nicholls',
    'Central Connecticut State': 'Central Connecticut',
    'College of Charleston': 'Charleston',
    'Southern Mississippi': 'Southern Miss',
    'Appalachian State': 'App State',
    'FDU': 'Fairleigh Dickinson',
    "St. John's (NY)": "St. John's",
    'Southeastern Louisiana': 'SE Louisiana',
    'IU Indy': 'IU Indianapolis',
    'St. Francis (NY)': 'St. Francis Brooklyn',
    'St. Francis (BKN)': 'St. Francis Brooklyn',
    'Queens (NC)': 'Queens University',
    'Connecticut': 'UConn',
    'Pennsylvania': 'Penn',
    'Detroit Mercy': 'Detroit Mercy',
    'Albany (NY)': 'UAlbany',
    'Loyola (IL)': 'Loyola Chicago',
    'Loyola (MD)': 'Loyola Maryland',
    'Saint Francis (PA)': 'Saint Francis',
    'Saint Mary’s (CA)': "Saint Mary's",
    "Saint Mary's (CA)": "Saint Mary's",
    'California-Santa Barbara': 'UC Santa Barbara',
    'California-Irvine': 'UC Irvine',
    'California-Davis': 'UC Davis',
    'California-Riverside': 'UC Riverside',
    'California-San Diego': 'UC San Diego',
    'California Baptist': 'California Baptist',
    'Arkansas-Pine Bluff': 'Arkansas-Pine Bluff',
    'Arkansas-Little Rock': 'Little Rock',
    'Louisiana-Monroe': 'UL Monroe',
    'Louisiana-Lafayette': 'Louisiana',
    'Nebraska-Omaha': 'Omaha',
    'Bowling Green State': 'Bowling Green',
    'Ole Miss': 'Ole Miss',
    'Mississippi': 'Ole Miss',
    'Pitt': 'Pittsburgh',
    'Purdue-Fort Wayne': 'Purdue Fort Wayne',
    'IUPUI': 'IU Indianapolis',
    'Grambling': 'Grambling',
    'Prairie View': 'Prairie View A&M',
    'Texas A&M-Corpus Christi': 'Texas A&M-Corpus Christi',
    'St. Thomas': 'St. Thomas-Minnesota',
    'Southeast Missouri State': 'Southeast Missouri State',
    'Sam Houston': 'Sam Houston',
    'Seattle': 'Seattle U',
}


def norm(s):
    s = (s or '').lower()
    s = s.replace('&', ' and ').replace('’', "'")
    s = re.sub(r"[^a-z0-9' ]", ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def load_team_seasons():
    """year -> {normalized team name: row}, plus the raw list per year."""
    by_year = {}
    for f in sorted(glob.glob(os.path.join(TSY, '*.json'))):
        rows = json.load(open(f))
        if not rows:
            continue
        by_year[rows[0]['season_year']] = rows
    return by_year


def resolve(school, rows):
    """Match a coach_seasons school to a team_seasons row for the same year."""
    cands = [ALIAS[school]] if school in ALIAS else []
    cands.append(school)                   # a stale alias must not block a clean match
    for cand in cands:
        n = norm(cand)
        exact = [r for r in rows if norm(r['team']) == n]
        if exact:
            return exact[0]
        # "team name starts with school name" strips the mascot
        pre = [r for r in rows if norm(r['team']).startswith(n + ' ')]
        if pre:                            # e.g. "Charleston" -> Cougars / Southern
            pre.sort(key=lambda r: len(r['team']))
            return pre[0]
    return None


def main():
    check = '--check' in sys.argv
    seasons = json.load(open(os.path.join(DATA, 'coach_seasons.json')))
    profiles = json.load(open(os.path.join(DATA, 'coach_profiles.json')))
    if isinstance(profiles, dict):
        profiles = list(profiles.values())
    prof = {p['coach_slug']: p for p in profiles}
    ts = load_team_seasons()

    # per-coach season rows from the rundowns (lift metrics live only here)
    rund = {}
    for f in glob.glob(os.path.join(DATA, 'coach_rundowns', '*.json')):
        slug = os.path.basename(f)[:-5]
        try:
            rund[slug] = {s['yr']: s for s in json.load(open(f)).get('seasons', [])}
        except Exception:
            pass

    os.makedirs(OUT, exist_ok=True)

    careers = {}
    for slug, p in prof.items():
        careers[slug] = {
            'n': p.get('coach'), 'g': p.get('grade'), 'r': p.get('rank'),
            'a': p.get('archetype'), 's': p.get('seasons'),
            'w': p.get('wins'), 'l': p.get('losses'), 't': p.get('tourney'),
        }
    json.dump(careers, open(os.path.join(OUT, 'coach-careers.json'), 'w'),
              separators=(',', ':'))

    unmatched, total, wrote = set(), 0, 0
    for year, rows in sorted(ts.items()):
        out = []
        for r in seasons:
            if r.get('season_year') != year:
                continue
            total += 1
            m = resolve(r['school'], rows)
            if not m:
                unmatched.add((year, r['school']))
                continue
            y = rund.get(r['coach_slug'], {}).get(year, {})
            out.append({
                'c': r['coach_slug'], 'n': r['coach'],
                'tm': m['team'], 'cf': m['conference'],
                'w': r.get('wins'), 'l': r.get('losses'),
                'srs': y.get('srs', r.get('srs')),
                'exp': y.get('exp_srs'), 'tal': y.get('talent'),
                'lf': y.get('srs_lift'), 'wl': y.get('win_lift'),
                'ex': y.get('exp_wins'),
                'nc': m.get('ncaa_result'), 'sd': m.get('ncaa_seed'),
            })
        if out:
            json.dump(out, open(os.path.join(OUT, 'coach-%d.json' % year), 'w'),
                      separators=(',', ':'))
            wrote += len(out)

    print('coaches (career): %d' % len(careers))
    print('coach-seasons written: %d / %d  (%d unmatched)'
          % (wrote, total, len(unmatched)))
    if unmatched:
        byname = {}
        for yr, s in unmatched:
            byname.setdefault(s, []).append(yr)
        print('\nunmatched schools (%d distinct):' % len(byname))
        for s, yrs in sorted(byname.items(), key=lambda kv: -len(kv[1]))[:40]:
            print('  %-34s %d yrs  %s' % (s, len(yrs), min(yrs)))
    if not check:
        sizes = [(os.path.basename(f), os.path.getsize(f))
                 for f in sorted(glob.glob(os.path.join(OUT, '*.json')))]
        big = max(s for _, s in sizes)
        print('\n%d files, largest %.0f KB, total %.0f KB'
              % (len(sizes), big / 1024, sum(s for _, s in sizes) / 1024))


if __name__ == '__main__':
    main()
