#!/usr/bin/env python3
"""
build_chart_twins.py — SHOT CHART TWINS (owner, Nov 22 2026: "shot chart twins ... so you can see shot chart positions that
match up with other similar players").

The Shot Profile Twin (build_shot_twins.py / tdc-twin.js) matches four broad buckets (FT / rim / mid / three). This one
matches WHERE on the floor a player shoots from, the same ten spots the site's shot chart draws (tdc-shotchart.js zone10:
rim, paint, left/middle/right mid-range, left/right corner 3, left/right wing 3, top 3), plus HOW (dunks, floaters and
hooks, off-the-dribble jumpers, assisted makes) and how often.

Source: the cached ESPN game summaries in scripts/data/espn_pbp_cache/*.json.gz (shot coordinates are complete for 2025-26
and 2026-27; 2024-25 only ~37%, so players need more logged attempts there). Coordinates are feet from the basket
(x 25 = rim, y out from the rim); court y = y + 5.25, exactly as tdc-shotchart.js reads them.

Writes scripts/data/chart_twins.json — one row per player-season with the counts the page needs to draw his chart and
match him (tdc-charttwin.js does the matching in the browser):
  python3 scripts/build_chart_twins.py
"""
import gzip, json, math, os, re, sys
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, 'data', 'espn_pbp_cache')
OUT = os.path.join(ROOT, 'data', 'chart_twins.json')
SEASONS = (2025, 2026, 2027)
MIN_FGA = {2025: 120, 2026: 100, 2027: 35}      # logged attempts with a location (2024-25 is partial, 2026-27 is young)

HOOP_X, HOOP_Y, R3, CORNER_X = 25.0, 5.25, 22.15, 3.35
CORNER_Y = HOOP_Y + math.sqrt(R3 * R3 - (HOOP_X - CORNER_X) ** 2)
ZONES = ['rim', 'paint', 'midl', 'midc', 'midr', 'c3l', 'c3r', 'w3l', 'w3r', 't3']
TYPES = ['dunk', 'layup', 'tip', 'float', 'pull', 'jump']   # float = floater/hook, pull = pull-up/step-back/fadeaway


def zone10(x, y, sv):
    """Same rules as tdc-shotchart.js zone10 (court feet: x across, y from the baseline)."""
    if sv == 3:
        if y <= CORNER_Y - 0.4:
            return 'c3l' if x < HOOP_X else 'c3r'
        return 'w3l' if x < 19 else ('w3r' if x > 31 else 't3')
    if math.hypot(x - HOOP_X, y - HOOP_Y) <= 4:
        return 'rim'
    if 19 <= x <= 31 and y <= 19:
        return 'paint'
    return 'midl' if x < 19 else ('midr' if x > 31 else 'midc')


def stype(txt, ty):
    t = (txt or '').lower()
    if 'tip' in t or ty == 'TipShot': return 'tip'
    if 'dunk' in t or ty == 'DunkShot': return 'dunk'
    if 'float' in t or 'hook' in t: return 'float'
    if 'layup' in t or 'lay up' in t or 'lay-up' in t or ty == 'LayUpShot': return 'layup'
    if 'pullup' in t or 'pull up' in t or 'pull-up' in t or 'step back' in t or 'stepback' in t or 'fadeaway' in t: return 'pull'
    return 'jump'


AST_RE = re.compile(r'\(([^)]+?)\s+assists?\)|assisted by', re.I)


def main():
    P = {}   # (season, espn) -> record
    games_by = defaultdict(int)
    files = sorted(f for f in os.listdir(CACHE) if f.endswith('.json.gz'))
    seen_games = 0
    for i, f in enumerate(files):
        try:
            d = json.load(gzip.open(os.path.join(CACHE, f)))
        except Exception:
            continue
        season = ((d.get('header') or {}).get('season') or {}).get('year')
        if season not in SEASONS:
            continue
        plays = d.get('plays') or []
        if not plays:
            continue
        seen_games += 1
        games_by[season] += 1
        names, teams, mins = {}, {}, {}
        for tb in (d.get('boxscore') or {}).get('players') or []:
            tm = tb.get('team') or {}
            tname = tm.get('location') or tm.get('displayName') or ''
            for st in tb.get('statistics') or []:
                labels = st.get('labels') or st.get('keys') or []
                mi = labels.index('MIN') if 'MIN' in labels else None
                for a in st.get('athletes') or []:
                    ath = a.get('athlete') or {}
                    aid = ath.get('id')
                    if not aid: continue
                    names[aid] = ath.get('displayName') or ''
                    teams[aid] = tname
                    if mi is not None:
                        try: mins[aid] = float((a.get('stats') or [])[mi])
                        except Exception: pass
        played = set()
        for p in plays:
            if not p.get('shootingPlay') or p.get('pointsAttempted') not in (2, 3):
                continue
            parts = p.get('participants') or []
            if not parts: continue
            aid = ((parts[0] or {}).get('athlete') or {}).get('id')
            co = p.get('coordinate') or {}
            x, y = co.get('x'), co.get('y')
            if aid is None or x is None or y is None or not (-3 <= x <= 53) or not (-3 <= y <= 47):
                continue
            sv = p.get('pointsAttempted')
            cy = y + HOOP_Y
            z = zone10(float(x), float(cy), sv)
            r = P.get((season, aid))
            if r is None:
                r = P[(season, aid)] = {'a': [0] * 10, 'm': [0] * 10, 't': [0] * 6, 'astM': 0, 'made': 0, 'fga': 0,
                                        'min': 0.0, 'g': 0, 'name': names.get(aid, ''), 'team': teams.get(aid, '')}
            zi = ZONES.index(z)
            made = bool(p.get('scoringPlay'))
            r['a'][zi] += 1; r['fga'] += 1
            if made:
                r['m'][zi] += 1; r['made'] += 1
                if len(parts) > 1 or AST_RE.search(p.get('text') or ''): r['astM'] += 1
            r['t'][TYPES.index(stype(p.get('text'), (p.get('type') or {}).get('text')))] += 1
            if names.get(aid): r['name'] = names[aid]
            if teams.get(aid): r['team'] = teams[aid]
            played.add(aid)
        for aid in played:
            r = P[(season, aid)]
            r['g'] += 1
            r['min'] += mins.get(aid, 0.0)
        if (i + 1) % 2000 == 0:
            print(f'  {i + 1}/{len(files)} files · {len(P)} player-seasons', flush=True)

    # league shares / make rates per season (every logged attempt, before the volume floor)
    lg = {}
    for s in SEASONS:
        A = [0] * 10; M = [0] * 10
        for (ss, _), r in P.items():
            if ss != s: continue
            for k in range(10): A[k] += r['a'][k]; M[k] += r['m'][k]
        tot = sum(A) or 1
        lg[s] = {'share': [round(A[k] / tot, 4) for k in range(10)], 'fg': [round(M[k] / A[k], 4) if A[k] else 0 for k in range(10)], 'fga': sum(A)}

    # the nightly build only has THIS season's games cached (actions/cache key pbp-<season>): a season with no games here
    # keeps its rows and league numbers from the last file instead of disappearing
    prev = None
    try: prev = json.load(open(OUT))
    except Exception: pass
    kept = {}
    if prev:
        for s in SEASONS:
            if games_by.get(s, 0) < 200 and str(s) in (prev.get('lg') or {}):
                lg[s] = prev['lg'][str(s)]
                kept[s] = [r for r in prev.get('rows') or [] if r[3] == s]
    rows = []
    for s in kept: rows.extend(kept[s])
    for (s, aid), r in P.items():
        if s in kept: continue
        if r['fga'] < MIN_FGA[s] or r['min'] <= 0:
            continue
        rows.append([int(aid), r['name'], r['team'], s, round(r['min']), r['g'], r['fga'], r['made'], r['astM']] + r['a'] + r['m'] + r['t'])
    rows.sort(key=lambda x: (-x[3], -x[6]))
    cols = ['espn', 'name', 'team', 'season', 'min', 'g', 'fga', 'made', 'astM'] + ['a_' + z for z in ZONES] + ['m_' + z for z in ZONES] + ['t_' + t for t in TYPES]
    out = {'meta': {'built': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), 'src': 'build_chart_twins.py (ESPN play-by-play shot locations)',
                    'zones': ZONES, 'types': TYPES, 'min_fga': MIN_FGA, 'games': seen_games, 'kept_from_last_build': sorted(kept),
                    'note': '2024-25 shot locations are partial (~37% of games); 2025-26 and 2026-27 are complete'},
           'lg': lg, 'cols': cols, 'rows': rows}
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    by = defaultdict(int)
    for r in rows: by[r[3]] += 1
    print(f'games {seen_games} · player-seasons kept {len(rows)} {dict(by)} · {os.path.getsize(OUT) / 1e6:.2f} MB -> {OUT}')


if __name__ == '__main__':
    main()
