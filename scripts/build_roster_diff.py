#!/usr/bin/env python3
"""Classify every scraped 2026-27 player and diff the scraped rosters against the site.

Input : scripts/data/school_rosters_2027.json   (scrape_school_rosters.py)
        scripts/data/school_sites.json            (our team -> espn_id)
        Supabase: players, player_history (2024-2026), team_seasons (2026: conf + tier)
Output: scripts/data/roster_diff_2027.json

Each scraped player gets a `status`:
  returner       played for THIS team in 2025-26
  transfer       last D1 season was at another school  (+ from_team / from_conf / up = moved up a tier)
  freshman       no D1 history, listed Fr / R-Fr
  newcomer       no D1 history, listed So+  -> international / JUCO / D2 / prep (prev_school says which)
and, when history matched, the ESPN id (so the page links the right career — no namesake guessing:
a history row only counts if its team is this team, the listed previous school, or the name is unique).

Per team: `added` (on the school site, not on ours), `removed` (on ours, not on the school site),
and `stale_suspect` when ≥85% of the scraped roster played for this team last season
(a real 2026-27 roster always has newcomers and has lost its seniors).
"""
import collections
import difflib
import json
import os
import re
import unicodedata
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/'
KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'


def pull(path, order):
    rows, off = [], 0
    while True:   # stable ORDER BY or paginated pulls silently drop rows
        url = f"{SB}{path}{'&' if '?' in path else '?'}order={order}&limit=1000&offset={off}"
        r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY})))
        rows += r
        off += 1000
        if len(r) < 1000:
            return rows


def nk(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b\.?', '', s)
    return re.sub(r'[^a-z]', '', s)


def sr_aliases():
    """Sports-Reference spelling -> sheet short, lifted from tdc-teamname.js (the site's one resolver)."""
    js = open(os.path.join(HERE, '..', 'tdc-teamname.js')).read()
    body = re.search(r'SR2SHORT\s*=\s*\{(.*?)\};', js, re.S).group(1)
    pairs = re.findall(r"'([^']+)'\s*:\s*(?:'([^']*)'|\"([^\"]*)\")", body)
    return {a.lower(): b or c for a, b, c in pairs}


SR = None


def short(name):
    global SR
    if SR is None:
        SR = sr_aliases()
    n = (name or '').strip()
    return SR.get(n.lower()) or re.sub(r'\s*\([A-Z]{2}\)$', '', n)


def tk(s):
    s = (s or '').lower().replace('&', 'and').replace('saint ', 'st ').replace('state', 'st')
    s = re.sub(r'\(.*?\)|university|univ\.?|college|of ', '', s)
    return re.sub(r'[^a-z]', '', s)


US = set("""al ala alabama ak alaska az ariz arizona ar ark arkansas ca calif california co colo colorado ct conn connecticut
de del delaware dc d.c. fl fla florida ga georgia hi hawaii id idaho il ill illinois in ind indiana ia iowa ks kan kans kansas
ky kentucky la louisiana me maine md maryland ma mass massachusetts mi mich michigan mn minn minnesota ms miss mississippi
mo missouri mt mont montana ne neb nebr nebraska nv nev nevada nh n.h. new hampshire nj n.j. new jersey nm n.m. new mexico
ny n.y. new york nc n.c. north carolina nd n.d. north dakota oh ohio ok okla oklahoma or ore oregon pa pa. penn pennsylvania
ri r.i. rhode island sc s.c. south carolina sd s.d. south dakota tn tenn tennessee tx texas ut utah vt vermont va virginia
wa wash washington wv w.va. west virginia wi wis wisc wisconsin wy wyo wyoming usa u.s.a. united states puerto rico p.r.""".split())
US_MULTI = ['new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'rhode island',
            'south carolina', 'south dakota', 'west virginia', 'united states', 'puerto rico', 'district of columbia']


def is_international(hometown):
    """'Kaunas, Lithuania' -> True; 'Harrisburg, N.C.' / 'Plano, Texas' -> False; unknown -> False."""
    if not hometown or ',' not in hometown:
        return False
    tail = hometown.rsplit(',', 1)[1].strip().lower().rstrip('.')
    tail = re.sub(r'\s*\(.*?\)', '', tail).strip()
    if not tail or tail in US or tail + '.' in US or tail.replace('.', '') in US or tail in US_MULTI:
        return False
    return not re.fullmatch(r'[a-z]\.?\s?[a-z]\.?', tail)   # any other 2-letter abbrev = a US state


def ht_in(ht):
    m = re.match(r'(\d)-(\d{1,2})', ht or '')
    return int(m.group(1)) * 12 + int(m.group(2)) if m else None


def sheet_pos(school_pos, hist_pos, ht):
    """Roster codes the Sheet uses (PG SG SF PF C). Last season's position wins when we have it;
    otherwise school G/F/C is split by height."""
    hp = (hist_pos or '').upper().split('/')[0].strip()
    if hp in ('PG', 'SG', 'CG', 'SF', 'PF', 'C'):
        return hp
    p = re.sub(r'[^A-Z/]', '', (school_pos or '').upper().replace('GUARD', 'G').replace('FORWARD', 'F').replace('CENTER', 'C'))
    h = ht_in(ht) or 0
    first = p.split('/')[0] if p else ''
    if first == 'C' or p in ('F/C', 'FC'):
        return 'C' if first == 'C' else 'PF'
    if first == 'G':
        return 'SG' if (p in ('G/F', 'GF') or h >= 75) else 'PG'
    if first == 'F':
        return 'PF' if h >= 81 else 'SF'
    return 'SF'


def sheet_yr(cls):
    c = (cls or '').strip()
    return (c + '.') if re.fullmatch(r'(R-)?(Fr|So|Jr|Sr|Gr)', c) else c


POS5 = ['PG', 'SG', 'SF', 'PF', 'C']


def depth_order(players, cls_rank):
    """Rows 1-5 of a Sheet block are read by the team page as the STARTING FIVE (one per spot, only
    slid if it must), so they have to be a positional five, not just the five biggest minute-getters
    (UNC Wilmington: two SGs started and a 6-3 guard was slid to PF). Starters: for PG, SG, SF, PF, C
    in turn, the best available player listed there (last season's minutes, then class), falling back
    to the nearest spot. Then the bench by minutes, then class."""
    key = lambda p: (-(p.get('last_mpg') or 0), -cls_rank.get((p.get('cls') or '').replace('R-', ''), 0), -(ht_in(p.get('ht')) or 0))
    pool = sorted(players, key=key)
    used, starters = set(), []
    for pos in POS5:
        i = POS5.index(pos)
        for dist in (0, 1, 2):
            cand = [p for p in pool if id(p) not in used and p.get('sheet_pos') in POS5
                    and abs(POS5.index(p['sheet_pos']) - i) == dist]
            if cand:
                used.add(id(cand[0]))
                starters.append(cand[0])
                break
    bench = [p for p in pool if id(p) not in used]
    return starters + bench


def main():
    scraped = json.load(open(os.path.join(HERE, 'data', 'school_rosters_2027.json')))
    sites = json.load(open(os.path.join(HERE, 'data', 'school_sites.json')))
    ours = [p for p in pull('players?select=id,name,team,espn_id,hometown,tdc_grade', 'id') if p['name'] not in ('—', '-')]
    hist = pull('player_history?select=name,team,season_year,espn_id,mpg,ppg,position&season_year=gte.2024', 'id')
    ts = pull('team_seasons?select=team,team_id,conference,tier&season_year=eq.2026', 'team_id')

    # history team (short name) -> team_seasons row (conf/tier), by normalized name
    ts_by = {}
    for t in ts:
        ts_by.setdefault(tk(t['team']), t)
        ts_by.setdefault(tk(re.sub(r'\s+\S+$', '', t['team'])), t)          # drop the mascot word
        ts_by.setdefault(tk(re.sub(r'\s+\S+\s+\S+$', '', t['team'])), t)    # two-word mascots
    ts_by_id = {str(t['team_id']): t for t in ts}

    def team_info(name):
        return ts_by.get(tk(short(name))) or ts_by.get(tk(name)) or {}

    by_name = collections.defaultdict(list)
    for h in hist:
        by_name[nk(h['name'])].append(h)

    ours_by_team = collections.defaultdict(list)
    for p in ours:
        ours_by_team[p['team']].append(p)

    out = []
    for rec in scraped:
        team = rec['team']
        site = sites.get(team, {})
        me = ts_by_id.get(str(site.get('espn_id'))) or {}
        row = {'team': team, 'conf': site.get('conf'), 'coach': site.get('coach'), 'in_sheet': site.get('in_sheet', True),
               'url': rec.get('url'), 'season': rec.get('season'), 'error': rec.get('error'),
               'stale': bool(rec.get('stale') or rec.get('incomplete')), 'players': [], 'added': [], 'removed': []}
        if rec.get('stale') or rec.get('incomplete') or not rec.get('players'):
            out.append(row)
            continue
        our_names = {nk(p['name']): p for p in ours_by_team.get(team, [])}
        n_ret = 0
        for sp in rec['players']:
            k = nk(sp['name'])
            cands = sorted(by_name.get(k, []), key=lambda h: -h['season_year'])
            prev = tk(sp.get('prev_school'))
            pick = None
            for h in cands:     # this team, or the school the site lists as previous
                ht = tk(short(h['team']))
                if ht and (ht == tk(team) or (prev and (ht in prev or prev in ht))):
                    pick = h
                    break
            if not pick and cands and len({h['espn_id'] for h in cands if h['espn_id']}) == 1:
                pick = cands[0]  # a unique name across D1 is safe
            fr = (sp.get('cls') or '').endswith('Fr')
            if pick and fr and tk(short(pick['team'])) != tk(team) and not prev:
                pick = None      # a true freshman sharing an older player's name — the namesake trap
            p = dict(sp)
            p['school_idx'] = len(row['players'])     # order on the school site (tie-break the old depth order)
            if pick:
                p['espn_id'] = pick['espn_id']
                p['last_team'], p['last_season'] = pick['team'], pick['season_year']
                p['last_ppg'], p['last_mpg'] = pick.get('ppg'), pick.get('mpg')
                if tk(short(pick['team'])) == tk(team):
                    p['status'] = 'returner'          # incl. a redshirt / injury year (last row is older)
                    n_ret += pick['season_year'] == 2026
                else:
                    fi = team_info(pick['team'])
                    p['status'] = 'transfer'
                    p['from_team'], p['from_conf'] = short(pick['team']), fi.get('conference')
                    if fi.get('tier') and me.get('tier'):  # tier 1 = high major
                        p['move'] = 'up' if fi['tier'] > me['tier'] else 'down' if fi['tier'] < me['tier'] else 'lateral'
                        p['up'] = p['move'] == 'up'
            else:
                p['status'] = 'freshman' if fr or not sp.get('cls') else 'newcomer'
            p['on_site'] = k in our_names
            p['intl'] = is_international(sp.get('hometown'))
            p['sheet_pos'] = sheet_pos(sp.get('pos'), pick.get('position') if pick else None, sp.get('ht'))
            p['sheet_yr'] = sheet_yr(sp.get('cls'))
            # the Sheet's "From" column: transfer origin, or an international club / JUCO for a newcomer
            p['sheet_from'] = p.get('from_team') or (sp.get('prev_school') if p['status'] == 'newcomer' else '') or ''
            row['players'].append(p)
        # depth order for a brand-new Sheet block: last season's minutes first (returners/transfers),
        # then by class (Gr > Sr > … > Fr) — the owner reorders on the site's depth-chart editor
        CLS_RANK = {'Gr': 5, 'Sr': 4, 'Jr': 3, 'So': 2, 'Fr': 1}
        row['players'] = depth_order(row['players'], CLS_RANK)
        sk = {nk(p['name']) for p in rec['players']}
        added = [p for p in row['players'] if not p['on_site']]
        removed = [p for p in ours_by_team.get(team, []) if nk(p['name']) not in sk]
        # same person, spelled differently on the two rosters ("Scharniwski" vs "Scharnowski",
        # "Patrick Ngongba" vs "Patrick Ngongba II") -> a rename, not an add + a drop
        row['renamed'] = []
        for a in list(added):
            best, score = None, 0
            for r in removed:
                sc = difflib.SequenceMatcher(None, nk(a['name']), nk(r['name'])).ratio()
                same_last = nk(a['name'].split()[-1])[:5] == nk(r['name'].split()[-1])[:5] if a['name'].split() and r['name'].split() else False
                if sc > score and (sc >= 0.84 or (same_last and sc >= 0.7)):
                    best, score = r, sc
            if best:
                row['renamed'].append({'site': best['name'], 'school': a['name']})
                a['on_site'] = True
                a['site_name'] = best['name']
                added.remove(a)
                removed.remove(best)
        row['added'] = [p['name'] for p in added]
        row['removed'] = [p['name'] for p in removed]
        row['stale_suspect'] = n_ret / max(1, len(rec['players'])) >= 0.85
        out.append(row)

    json.dump(out, open(os.path.join(HERE, 'data', 'roster_diff_2027.json'), 'w'), indent=1, ensure_ascii=False)
    good = [r for r in out if r['players'] and not r['stale']]
    st = collections.Counter(p['status'] for r in good for p in r['players'])
    print(f"{len(good)} teams with a posted 2026-27 roster, {sum(len(r['players']) for r in good)} players: {dict(st)}")
    print(f"  up-transfers: {sum(1 for r in good for p in r['players'] if p.get('up'))}")
    print(f"  on school site but NOT on ours: {sum(len(r['added']) for r in good)}   on ours but NOT on school site: {sum(len(r['removed']) for r in good)}")
    print(f"  same player, spelled differently: {sum(len(r['renamed']) for r in good)}")
    print(f"  teams that already match exactly: {sum(1 for r in good if not r['added'] and not r['removed'])}")
    sus = [r['team'] for r in good if r.get('stale_suspect')]
    if sus:
        print('  looks like LAST season (check):', sus)
    skipped = [f"{r['team']} ({r['error']})" for r in out if not r['players'] or r['stale']]
    print('  no 2026-27 roster yet:', skipped)


if __name__ == '__main__':
    main()
