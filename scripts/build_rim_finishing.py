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
import gzip, json, os, re
from bisect import bisect_left, bisect_right
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, 'data', 'espn_pbp_cache')
OUT = os.path.join(ROOT, 'data', 'rim_finishing')
SHARDS = 32
FIRST = 2023
KEEP_MIN = 5          # rim attempts for a row to be stored
COLS = ['espn', 'name', 'team', 'season', 'min', 'g', 'fga', 'dm', 'da', 'dast', 'lm', 'la', 'last', 'tm', 'ta']
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

    def rec(s, aid):
        return P.setdefault((s, aid), dict(name='', team='', last_dt='', min=0.0, g=0, fga=0, dm=0, da=0, dast=0, lm=0, la=0, last=0, tm=0, ta=0))

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
        for tb in (d.get('boxscore') or {}).get('players') or []:
            tm = tb.get('team') or {}
            for st in tb.get('statistics') or []:
                labels = st.get('labels') or st.get('keys') or []
                mi = labels.index('MIN') if 'MIN' in labels else None
                for a in st.get('athletes') or []:
                    ath = a.get('athlete') or {}
                    if not ath.get('id') or mi is None: continue
                    try: mn = float(a['stats'][mi])
                    except Exception: continue
                    if mn <= 0: continue
                    r = rec(s, ath['id']); r['g'] += 1; r['min'] += mn
                    if dt >= r['last_dt']:
                        r['last_dt'] = dt; r['name'] = ath.get('displayName') or r['name']; r['team'] = tm.get('location') or tm.get('displayName') or r['team']
        for p in plays:
            ty = (p.get('type') or {}).get('text')
            if not p.get('shootingPlay') or ty == 'MadeFreeThrow': continue
            parts = p.get('participants') or []
            aid = ((parts[0] or {}).get('athlete') or {}).get('id') if parts else None
            if not aid: continue
            r = rec(s, aid); r['fga'] += 1
            k = kind(p)
            if not k: continue
            made = bool(p.get('scoringPlay'))
            r[k + 'a'] += 1
            if made:
                r[k + 'm'] += 1
                if k != 't' and re.search(r'assist', p.get('text') or '', re.I): r['dast' if k == 'd' else 'last'] += 1

    os.makedirs(OUT, exist_ok=True)
    built = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
    dump = lambda f, o: json.dump(o, open(os.path.join(OUT, f), 'w'), separators=(',', ':'), ensure_ascii=False)
    prev = {int(f[:4]): json.load(open(os.path.join(OUT, f))) for f in os.listdir(OUT) if re.fullmatch(r'\d{4}\.json', f)}
    S, ix = {}, {c: i for i, c in enumerate(COLS)}
    for s in sorted(set(prev) | set(games)):
        if s in prev and games.get(s, 0) < prev[s]['games']:
            S[s] = prev[s]; print(s, 'kept', prev[s]['games'], 'games (cache has', games.get(s, 0), ')'); continue
        rows = [[int(a), r['name'], r['team'], s, round(r['min']), r['g'], r['fga']] + [r[c] for c in COLS[7:]]
                for (ss, a), r in P.items() if ss == s and r['min'] > 0 and r['name'] and r['da'] + r['la'] + r['ta'] >= KEEP_MIN]
        rows.sort(key=lambda x: (-x[7], x[0]))
        lg = {c: sum(r[c] for (ss, _), r in P.items() if ss == s) for c in COLS[6:]}   # every shot, not just the stored rows
        # percentile pool: 30 rim attempts over a full season, scaled down while the season is young
        qual = max(10, min(30, round(30 * games[s] / 6100)))
        S[s] = {'season': s, 'built': built, 'games': games[s], 'qual': qual, 'cols': COLS, 'lg': lg, 'rows': rows}
        dump(f'{s}.json', S[s])
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
        dm = sorted((r[ix['dm']] for r in d['rows']), reverse=True)
        for r in d['rows']:
            x = v[r[0]]
            pc = [pct(k, x[k + 1]) for k in range(4)] if x[0] else None
            rank = bisect_left([-y for y in dm], -r[ix['dm']]) + 1 if r[ix['dm']] else None
            shards[r[0] % SHARDS].setdefault(str(r[0]), []).append(r[2:] + [pc, rank])
    lgs = {s: dict(d['lg'], qual=d['qual'], n=sum(1 for _ in d['rows'])) for s, d in S.items()}
    for k in range(SHARDS):
        dump(f'p_{k}.json', {'cols': COLS[2:] + ['pct', 'rank'], 'pct': ['dunks per game', 'dunk share of rim shots', 'layup FG%', 'rim FG%'], 'lg': lgs, 'players': shards[k]})
    for s, d in S.items():
        L = d['lg']; print(s, d['games'], 'games', len(d['rows']), 'players  qual', d['qual'], f"dunk FG {L['dm']/L['da']:.3f}  layup FG {(L['lm']+L['tm'])/(L['la']+L['ta']):.3f}")


if __name__ == '__main__':
    main()
