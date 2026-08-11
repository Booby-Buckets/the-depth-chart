#!/usr/bin/env python3
"""Winning Score / Winning Value — the Hakes-Sauer "which skills win" lens applied per player.

A player's WINNING SCORE weights his skills by how much each actually predicts team winning
(from a standardized win% regression on 7,024 team-seasons: efficiency, offensive rebounding,
ball security, defense and steals win; raw scoring volume and assists barely move it). It is:
  - position-relative (a guard's skills judged vs guards, a big's vs bigs),
  - efficiency-led but with an efficiency x creation-load term (rewards volume ONLY when it's
    efficient; punishes empty volume), so real stars outrank role players,
  - playmaking-aware (creation load = usage + assists; plus an assist-to-turnover quality term),
  - strength-of-schedule nudged (team SRS), so mid-major stat inflation is tempered.

Output winning_value.json maps espn_id + normalized name -> {ws, wwins} where ws is a 0-100ish
score and wwins is a Wins-Added-equivalent (WS regressed onto owa+dwa) that the site converts to
a $ Winning Value at the live market $/win rate. This is DISTINCT from market value (what the NIL
market pays) and cost (what a player is actually paid) — the three are compared, not conflated.

Run:  python3 scripts/build_winning_value.py   (read-only pulls; writes winning_value.json)
"""
import json, os, math, statistics as st, urllib.request, urllib.parse

SB  = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1'
KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'
SEASON = 2026
HERE = os.path.dirname(__file__)

def q(p):
    r = urllib.request.Request(SB + p, headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY})
    return json.load(urllib.request.urlopen(r, timeout=90))

def pull(tbl):
    rows, off = [], 0
    while True:
        b = q(tbl + ('&' if '?' in tbl else '?') + 'order=espn_id.asc&limit=1000&offset=%d' % off)
        if not b: break
        rows += b; off += 1000
        if len(b) < 1000: break
    return rows

def f(v):
    try:
        x = float(v); return x if math.isfinite(x) else None
    except Exception:
        return None

def norm(s):
    return ''.join(ch for ch in (s or '').lower() if ch.isalnum())

def bucket(ps):
    ps = (ps or '').upper()
    if ps.startswith('C') or ps in ('PF', 'FC', 'F/C'): return 'C'
    if ps.startswith('S') or ps in ('GF', 'F'): return 'F'
    return 'G'

# win-driver skill weights (relative importance from the team win% regression) + genome efficiency
W = {'sm':0.045,'ts_pct':0.030,'lq':0.020,'orb_pct':0.040,'drb_pct':0.034,'stl_pct':0.034,
     'tp_pct':0.024,'ft_pct':0.018,'blk_pct':0.016,'tov_pct':-0.038,'ast_pct':0.022}

def main():
    adv = pull('/player_advanced?season_year=eq.%d&select=espn_id,name,team,g,min,ppg,ts_pct,orb_pct,drb_pct,ast_pct,stl_pct,blk_pct,tov_pct,tp_pct,ft_pct,usg_pct,owa,dwa' % SEASON)
    ph  = {str(r['espn_id']): r for r in pull('/player_history?season_year=eq.%d&select=espn_id,position' % SEASON) if r.get('espn_id') is not None}
    srs = {r['team']: r.get('srs') for r in q('/team_seasons?season_year=eq.%d&select=team,srs&limit=500' % SEASON)}
    genome = {}
    gp = os.path.join(HERE, 'data', 'shot_genome_players.json')
    if os.path.exists(gp):
        for p in json.load(open(gp)).get('players', []):
            if p.get('espn_id') is not None:
                genome[str(p['espn_id'])] = {'lq': p.get('lq'), 'sm': p.get('smAdj')}

    P = []
    for r in adv:
        g, mn = f(r.get('g')), f(r.get('min'))
        if not g or not mn or g < 10 or mn / g < 14:   # rotation players only
            continue
        eid = str(r.get('espn_id')); hh = ph.get(eid, {}); gg = genome.get(eid, {})
        d = {'espn_id': r.get('espn_id'), 'name': r['name'], 'pos': bucket(hh.get('position')),
             'usg': f(r.get('usg_pct')) or 0, 'owa': f(r.get('owa')) or 0, 'dwa': f(r.get('dwa')) or 0,
             'srs': f(srs.get(r.get('team'))), 'lq': f(gg.get('lq')), 'sm': f(gg.get('sm'))}
        for c in ['ts_pct','orb_pct','drb_pct','ast_pct','stl_pct','blk_pct','tov_pct','tp_pct','ft_pct']:
            d[c] = f(r.get(c))
        tv = d.get('tov_pct'); d['asttov'] = (d['ast_pct'] / tv) if (d.get('ast_pct') is not None and tv and tv > 0) else None
        P.append(d)

    # position-relative standardization
    keys = ['ts_pct','orb_pct','drb_pct','ast_pct','stl_pct','blk_pct','tov_pct','tp_pct','ft_pct','lq','sm','usg','asttov']
    S = {}
    for b in ('G','F','C'):
        for k in keys:
            vals = [p[k] for p in P if p['pos'] == b and p.get(k) is not None]
            S[(b,k)] = {'m': st.mean(vals) if vals else 0.0, 's': (st.pstdev(vals) or 1.0) if vals else 1.0}
    def z(p,k):
        v = p.get(k)
        if v is None: return 0.0
        s = S[(p['pos'],k)]; return (v - s['m']) / s['s']

    srsv = [p['srs'] for p in P if p['srs'] is not None]
    sm_, ss_ = (st.mean(srsv), st.pstdev(srsv) or 1.0) if srsv else (0.0, 1.0)

    for p in P:
        base = sum(W[k] * z(p,k) for k in W)
        eff  = (z(p,'sm') + z(p,'ts_pct') + z(p,'lq')) / 3.0          # efficiency composite
        load = z(p,'usg') + z(p,'ast_pct')                            # creation load = shots + assists
        p['ws_raw'] = base + 0.040*(load*eff) + 0.010*z(p,'usg') + 0.020*z(p,'asttov')
        sosz = ((p['srs'] - sm_) / ss_) if p['srs'] is not None else 0.0
        p['ws_raw'] += 0.030 * sosz

    wm = st.mean([p['ws_raw'] for p in P]); wsd = st.pstdev([p['ws_raw'] for p in P]) or 1.0
    for p in P:
        p['ws'] = round(50 + 15 * (p['ws_raw'] - wm) / wsd, 1)      # 0-100ish, mean 50 sd 15

    # winning-wins: regress actual owned wins (owa+dwa) on ws so Winning Score converts to a wins
    # figure the site can price at the live $/win rate. Simple OLS y = a + b*ws.
    xs = [p['ws'] for p in P]; ys = [p['owa'] + p['dwa'] for p in P]
    xb, yb = st.mean(xs), st.mean(ys)
    b = sum((x-xb)*(y-yb) for x,y in zip(xs,ys)) / sum((x-xb)**2 for x in xs)
    a = yb - b*xb
    for p in P:
        p['wwins'] = round(max(0.0, a + b*p['ws']), 2)

    out = {'meta': {'season': SEASON, 'n': len(P), 'wwins_fit': {'a': round(a,4), 'b': round(b,4)},
                    'note': 'ws = winning score (win-driver-weighted, position-relative, SOS-nudged); '
                            'wwins = wins-added-equivalent; price at live $/win for Winning Value.'},
           'players': {}, 'by_name': {}}
    for p in P:
        rec = {'ws': p['ws'], 'wwins': p['wwins'], 'pos': p['pos']}
        if p['espn_id'] is not None:
            out['players'][str(p['espn_id'])] = rec
        out['by_name'][norm(p['name'])] = rec
    path = os.path.join(HERE, '..', 'winning_value.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print('wrote %s  (%d players; ws mean=%.1f; wwins b=%.4f)' % (os.path.abspath(path), len(P), wm and 50, b))

if __name__ == '__main__':
    main()
