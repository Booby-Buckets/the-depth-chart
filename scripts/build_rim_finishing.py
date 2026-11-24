#!/usr/bin/env python3
"""
build_rim_finishing.py — DUNKS vs LAYUPS per player-season, from the cached ESPN play-by-play
(scripts/data/espn_pbp_cache/*.json.gz, 2022-23 onward; logged field goals match the box scores within 1% every season).

ESPN tags each shot: DunkShot, LayUpShot, TipShot. A tip-in dunk counts as a dunk. Other tip-ins are stored on their own,
but ESPN only split them out from 2024-25 on (they were called layups before), so pages show layups + tip-ins together to
keep seasons comparable. The shot TYPE is used, never a word search of the whole text (Jalik DUNKley).

Writes scripts/data/rim_finishing/: <season>.json (every player, for boards) and p_<espn % 32>.json (what one player's page
loads: his seasons with D-I percentiles and dunk rank). A season is kept from its last file when the cache holds fewer of
its games than that file was built from (the nightly job only has this season cached).
  python3 scripts/build_rim_finishing.py
"""
import gzip, json, math, os, re, sys
from bisect import bisect_left, bisect_right
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, 'data', 'espn_pbp_cache')
OUT = os.path.join(ROOT, 'data', 'rim_finishing')
SHARDS = 32
FIRST = 2023
DIST_FROM = 2026
KEEP_MIN = 5          # rim attempts for a row to be stored
COLS = ['espn', 'name', 'team', 'season', 'min', 'g', 'fga', 'dm', 'da', 'dast', 'lm', 'la', 'last', 'tm', 'ta']
BOX = {'PTS': 'pts', 'REB': 'reb', 'OREB': 'oreb', 'AST': 'ast', 'STL': 'stl', 'BLK': 'blk', 'TO': 'tov', '3PT': 'tp', 'FT': 'ft', 'FG': 'fg'}
# season files only: team id, position, height (in), weight, class (1 Fr .. 4 Sr, 5 Gr), D-I season number,
# dn/ds = located shots and their summed distance (feet), mn/ms = the makes. Locations are complete from 2025-26 (and match
# ESPN's "N-foot" text within ~0.5 ft), 10-27% of shots before that, so earlier seasons carry none. 40+ ft heaves left out.
# how he got there (0 first D-I season, 1 returning, 2 transfer), then box-score totals
SX = ['fgm', 'dn', 'ds', 'mn', 'ms']      # these also go to the player page
XCOLS = ['tid', 'pos', 'ht', 'wt', 'cls', 'exp', 'how', 'gs', 'pts', 'reb', 'oreb', 'ast', 'stl', 'blk', 'tov', 'fgm', 'fgat', 'tpm', 'tpa', 'ftm', 'fta', 'dn', 'ds', 'mn', 'ms']
TCOLS = ['g', 'dm', 'da', 'lm', 'la', 'odm', 'oda', 'olm', 'ola', 'fgm', 'dn', 'ds', 'mn', 'ms']   # team totals: layups incl. tip-ins, o = allowed
sys.path.insert(0, ROOT)


def d1_teams(s):
    """{espn team id: [team, conference]} — ESPN also has box scores for the non-D-I opponents; they stay off the boards."""
    import build_fingerprint as F
    for y in (s, s - 1):      # no rows for a season until it ends: last season's D-I list
        ts = F.sb(f'team_seasons?season_year=eq.{y}&select=team,team_id,conference&order=team_id.asc')
        d = {str(t['team_id']): [t['team'], t['conference']] for t in ts if t.get('conference')}
        if len(d) > 300: return d
    raise SystemExit(f'no D-I team list for {s}')


CLS = {'fr': 1, '1': 1, 'fy': 1, 'f': 1, 'so': 2, '2': 2, 's': 2, 'jr': 3, 'j': 3, '3': 3, 'th': 3, 'sr': 4, '4': 4, 'fo': 4, 'gr': 5, '5': 5, '6': 5, 'fi': 1, 'se': 2}


def cls_num(t):
    t = re.sub(r'^(r-|rs[. ]|red(shirt)? ?|r\.? )', '', (t or '').strip().lower())
    return CLS.get(t[:2]) or (CLS.get(t[:1]) if t[:1].isdigit() else None)


def inches(h):
    m = re.match(r"^\s*(\d)\D+(\d{1,2})", str(h or ''))
    v = int(m.group(1)) * 12 + int(m.group(2)) if m else None
    return v if v and 62 <= v <= 92 else None


class Bio:
    """Height / weight / class / D-I season number / transfer, per player-season. Class: 2026-27 rosters, and
    2025-26 counted back one from player_history's 'yr' (which is the NEXT season's class; ~89% agree with a second source).
    Earlier seasons have no class on file (counting seasons back only agreed ~70-76%), so they stay blank."""
    def __init__(self):
        import build_fingerprint as F
        self.hist = {}
        for y in range(FIRST, 2027):
            for x in F.sb(f'player_history?season_year=eq.{y}&espn_id=not.is.null&select=espn_id,height,weight,yr&order=id.asc'):
                self.hist[(x['espn_id'], y)] = x
        self.adv = defaultdict(dict)
        for y in range(2010, 2027):
            for x in F.sb(f'player_advanced?season_year=eq.{y}&select=espn_id,team&order=espn_id.asc'):
                self.adv[x['espn_id']][y] = x['team']
        self.now = {x['espn_id']: x for x in F.sb('players?espn_id=not.is.null&select=espn_id,position,height,class_year&order=id.asc')}
        b, i = json.load(open(os.path.join(ROOT, 'data', 'player_bio.json'))), 0
        self.last = {}
        for dx, vx in zip(b['d'], b['v']):
            i += dx; self.last[i] = b['k'][vx].split('|')
        self.seen = defaultdict(dict)          # espn -> {season: team name} from this build

    def cls(self, e, y):
        n = self.now.get(e); ys = self.adv.get(e, {})
        if y >= 2027: return (cls_num(n['class_year']) if n else None) or cls_num((self.last.get(e) or ['', '', ''])[2])
        if y < 2026: return None
        h = self.hist.get((e, 2026))
        if h and cls_num(h['yr']):
            return max(1, cls_num(h['yr']) - 1)
        if y == 2026 and n and cls_num(n['class_year']): return max(1, cls_num(n['class_year']) - 1)
        return None

    def row(self, e, y, team):
        h = self.hist.get((e, y)) or {}; n = self.now.get(e) or {}; l = self.last.get(e) or ['', '', '']
        ht = (inches(n.get('height')) if y >= 2027 else inches(h.get('height'))) or inches(l[0])
        wt = h.get('weight') or (int(l[1]) if l[1].isdigit() else None)
        past = dict(self.adv.get(e, {})); past.update({q: t for q, t in self.seen.get(e, {}).items() if q < y})
        prev = [q for q in past if q < y]
        how = 0 if not prev else (1 if past[max(prev)] == team else 2)
        return [ht, int(wt) if wt and 130 <= int(wt) <= 400 else None, self.cls(e, y), len(prev) + 1, how]


VERB = re.compile(r'\b(?:makes|made|misses|missed)\b(.*?)(?:\(|\.|assisted|blocked|$)', re.I)


def kind(p):
    ty = (p.get('type') or {}).get('text')
    if ty == 'DunkShot': return 'd'
    if ty == 'LayUpShot': return 'l'
    if ty == 'TipShot':
        m = VERB.search(p.get('text') or '')
        return 'd' if m and re.search(r'\bdunk\b', m.group(1), re.I) else 't'
    return None


def main():
    P, games = {}, defaultdict(int)
    T = defaultdict(lambda: [0] * len(TCOLS))     # (season, team id)

    def rec(s, aid):
        return P.setdefault((s, aid), dict(name='', team='', tid='', pos='', gs=0, pts=0, reb=0, oreb=0, ast=0, stl=0, blk=0, tov=0, fgm=0, fgat=0, tpm=0, tpa=0, ftm=0, fta=0, dn=0, ds=0.0, mn=0, ms=0.0, last_dt='', min=0.0, g=0, fga=0, dm=0, da=0, dast=0, lm=0, la=0, last=0, tm=0, ta=0))

    for f in sorted(os.listdir(CACHE)):
        if not f.endswith('.json.gz'): continue
        try: d = json.load(gzip.open(os.path.join(CACHE, f)))
        except Exception: continue
        hd = d.get('header') or {}
        s = (hd.get('season') or {}).get('year')
        plays = d.get('plays') or []
        if not s or s < FIRST or not plays: continue
        dt = ((hd.get('competitions') or [{}])[0] or {}).get('date') or ''
        games[s] += 1
        on, tids = {}, []
        for tb in (d.get('boxscore') or {}).get('players') or []:
            tm = tb.get('team') or {}
            tid = str(tm.get('id') or ''); tids.append(tid); T[(s, tid)][0] += 1
            for st in tb.get('statistics') or []:
                labels = st.get('labels') or st.get('keys') or []
                mi = labels.index('MIN') if 'MIN' in labels else None
                for a in st.get('athletes') or []:
                    ath = a.get('athlete') or {}
                    if not ath.get('id') or mi is None: continue
                    try: mn = float(a['stats'][mi])
                    except Exception: continue
                    if mn <= 0: continue
                    on[ath['id']] = tid
                    r = rec(s, ath['id']); r['g'] += 1; r['min'] += mn; r['gs'] += bool(a.get('starter'))
                    for lab, v in zip(labels, a['stats']):
                        c = BOX.get(lab)
                        if not c: continue
                        try:
                            if '-' in v:
                                x, z = map(int, v.split('-')); r[c + 'm'] += x; r['fgat' if c == 'fg' else c + 'a'] += z
                            else: r[c] += int(v)
                        except (ValueError, KeyError): pass
                    if dt >= r['last_dt']:
                        r['last_dt'] = dt; r['name'] = ath.get('displayName') or r['name']; r['team'] = tm.get('location') or tm.get('displayName') or r['team']
                        r['tid'] = tid; r['pos'] = ((ath.get('position') or {}).get('abbreviation') or r['pos'])[:1]
        for p in plays:
            ty = (p.get('type') or {}).get('text')
            if not p.get('shootingPlay') or ty == 'MadeFreeThrow': continue
            parts = p.get('participants') or []
            aid = ((parts[0] or {}).get('athlete') or {}).get('id') if parts else None
            if not aid: continue
            r = rec(s, aid); r['fga'] += 1
            made = bool(p.get('scoringPlay'))
            tid = on.get(aid); t9 = T[(s, tid)] if tid else None
            if made and t9: t9[9] += 1
            co = p.get('coordinate') or {}; x, y = co.get('x'), co.get('y')
            if s >= DIST_FROM and x is not None and y is not None and -3 <= x <= 53 and -8 <= y <= 50:
                ft = math.hypot(x - 25, y)
                if ft < 40:
                    r['dn'] += 1; r['ds'] += ft
                    if made: r['mn'] += 1; r['ms'] += ft
                    if t9:
                        t9[10] += 1; t9[11] += ft
                        if made: t9[12] += 1; t9[13] += ft
            k = kind(p)
            if not k: continue
            r[k + 'a'] += 1
            for t in tids if tid else []:
                b = 0 if t == tid else 4
                j = (1 if k == 'd' else 3) + b
                T[(s, t)][j] += made; T[(s, t)][j + 1] += 1
            if made:
                r[k + 'm'] += 1
                if k != 't' and re.search(r'assist', p.get('text') or '', re.I): r['dast' if k == 'd' else 'last'] += 1

    os.makedirs(OUT, exist_ok=True)
    built = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
    dump = lambda f, o: json.dump(o, open(os.path.join(OUT, f), 'w'), separators=(',', ':'), ensure_ascii=False)
    prev = {int(f[:4]): json.load(open(os.path.join(OUT, f))) for f in os.listdir(OUT) if re.fullmatch(r'\d{4}\.json', f)}
    bio = None
    S, ix = {}, {c: i for i, c in enumerate(COLS)}
    for s in sorted(set(prev) | set(games)):
        if s in prev and games.get(s, 0) < prev[s]['games']:
            S[s] = prev[s]; print(s, 'kept', prev[s]['games'], 'games (cache has', games.get(s, 0), ')'); continue
        d1 = d1_teams(s)
        bio = bio or Bio()
        for (ss, a), r in P.items():
            if r['tid'] in d1: bio.seen[int(a)][ss] = d1[r['tid']][0]
        rows = [[int(a), r['name'], r['team'], s, round(r['min']), r['g'], r['fga']] + [r[c] for c in COLS[7:]] + [r['tid'], r['pos'] if r['pos'] in 'GFC' else ''] + bio.row(int(a), s, d1[r['tid']][0]) + [round(r[c]) for c in XCOLS[7:]]
                for (ss, a), r in P.items() if ss == s and r['min'] > 0 and r['name'] and r['tid'] in d1 and r['da'] + r['la'] + r['ta'] >= KEEP_MIN]
        rows.sort(key=lambda x: (-x[7], x[0]))
        lg = {c: round(sum(r[c] for (ss, _), r in P.items() if ss == s and r['tid'] in d1)) for c in COLS[6:] + SX}   # every D-I shot, not just the stored rows
        # percentile pool: 30 rim attempts over a full season, scaled down while the season is young
        qual = max(10, min(30, round(30 * games[s] / 6100)))
        S[s] = {'season': s, 'built': built, 'games': games[s], 'qual': qual, 'cols': COLS + XCOLS, 'lg': lg, 'teams': d1,
                'tcols': TCOLS, 'team_totals': {t: [round(x) for x in v] for (ss, t), v in T.items() if ss == s and t in d1}, 'rows': rows}
        dump(f'{s}.json', S[s])
    if bio:     # who is on a 2026-27 roster (position there), and who was drafted: joined by the board, not baked into rows
        dr = json.load(open(os.path.join(ROOT, 'data', 'nba_drafted.json')))
        ids = {r[0] for d in S.values() for r in d['rows']}
        dump('status.json', {'through': dr['through'], 'drafted': {k: v for k, v in dr['d'].items() if int(k) in ids},
                             'active': {str(e): (x['position'] or '') for e, x in bio.now.items() if e in ids}})
    shards = defaultdict(dict)
    for s, d in S.items():
        v = {}
        for r in d['rows']:
            g = lambda c: r[ix[c]]
            rim = g('da') + g('la') + g('ta'); lay = g('la') + g('ta')
            v[r[0]] = (rim >= d['qual'], g('dm') / g('g'), g('da') / rim, (g('lm') + g('tm')) / lay if lay >= d['qual'] / 2 else None,
                       (g('dm') + g('lm') + g('tm')) / rim)
        pool = [[x[k] for x in v.values() if x[0] and x[k] is not None] for k in range(1, 5)]
        for q in pool: q.sort()
        pct = lambda k, x: round(100 * (bisect_left(pool[k], x) + bisect_right(pool[k], x)) / 2 / len(pool[k])) if x is not None and pool[k] else None
        xi = {c: i for i, c in enumerate(d['cols'])}
        dm = sorted((r[ix['dm']] for r in d['rows']), reverse=True)
        for r in d['rows']:
            x = v[r[0]]
            pc = [pct(k, x[k + 1]) for k in range(4)] if x[0] else None
            rank = bisect_left([-y for y in dm], -r[ix['dm']]) + 1 if r[ix['dm']] else None
            shards[r[0] % SHARDS].setdefault(str(r[0]), []).append(r[2:len(COLS)] + [r[xi[c]] if c in xi and xi[c] < len(r) else None for c in SX] + [pc, rank])
    lgs = {s: dict(d['lg'], qual=d['qual'], n=sum(1 for _ in d['rows'])) for s, d in S.items()}
    for k in range(SHARDS):
        dump(f'p_{k}.json', {'cols': COLS[2:] + SX + ['pct', 'rank'], 'pct': ['dunks per game', 'dunk share of rim shots', 'layup FG%', 'rim FG%'], 'lg': lgs, 'players': shards[k]})
    for s, d in S.items():
        L = d['lg']; print(s, d['games'], 'games', len(d['rows']), 'players  qual', d['qual'], f"dunk FG {L['dm']/L['da']:.3f}  layup FG {(L['lm']+L['tm'])/(L['la']+L['ta']):.3f}")


if __name__ == '__main__':
    main()
