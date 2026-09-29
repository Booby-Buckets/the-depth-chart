"""Small data file for the Lineup Lab's "How this lineup wins" panel (team.html).

Reads scripts/data/team_dna.json (4 MB, too big for the lab to load) and writes
scripts/data/lab_factors.json with only what the panel needs:
  - win_model: points of per-game margin per +5 of each four factor (fit on 2025-26 games)
  - mean / dist: the 2025-26 D-I value of each factor for every team (sorted), for ranks
  - margin_dist: each 2025-26 team's per-game margin (net * tempo / 100), sorted
  - proj: every projected 2026-27 team's four factors + net + tempo (the lab's anchor)
  - def_fit: how box stats move the defensive factors, fit on 2025-26 teams
    (team_seasons spg/bpg/rpg joined to team_dna by full team name):
      dTOV% = a + b * steals per 100 possessions   (r2 0.77)
      deFG% = a + b * blocks per game               (r2 0.24)
      dDRB% = a + b * rebounds per game             (r2 0.27)
Run after build_projected_dna.py / sweep_team_dna.py:  python3 scripts/build_lab_factors.py
"""
import json, os, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DNA = json.load(open(os.path.join(HERE, 'data', 'team_dna.json')))
SEASON, PROJ = '2026', '2027'
F = ['oeFG', 'oTOV', 'oORB', 'oFTr', 'deFG', 'dTOV', 'dDRB']

teams = DNA[SEASON]['teams']
wm = DNA[SEASON]['meta']['win_model']

SB = 'https://izlqhnxowdhtdofkwrho.supabase.co'
KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'
req = urllib.request.Request(f'{SB}/rest/v1/team_seasons?season_year=eq.{SEASON}&select=team,spg,bpg,rpg&order=team.asc&limit=1000',
                             headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY})
ts = json.load(urllib.request.urlopen(req, timeout=60))
rows = [(r, teams[r['team']]) for r in ts if r['team'] in teams and r['spg'] and r['bpg'] and r['rpg']]
if len(rows) < 250:
    raise SystemExit(f'only {len(rows)} team_seasons rows matched team_dna — refusing to write')

def fit(y, x):
    A = np.column_stack([np.ones(len(y)), x]); c = np.linalg.lstsq(A, y, rcond=None)[0]
    r2 = 1 - ((y - A @ c) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    return {'a': round(float(c[0]), 3), 'b': round(float(c[1]), 3), 'r2': round(float(r2), 3)}

arr = lambda f: np.array([f(r, t) for r, t in rows], float)
tempo = arr(lambda r, t: t['tempo'])
def_fit = {
    'dTOV': fit(arr(lambda r, t: t['dTOV']), arr(lambda r, t: r['spg']) / tempo * 100),
    'deFG': fit(arr(lambda r, t: t['deFG']), arr(lambda r, t: r['bpg'])),
    'dDRB': fit(arr(lambda r, t: t['dDRB']), arr(lambda r, t: r['rpg'])),
}

vals = {f: sorted(round(t[f], 1) for t in teams.values() if f in t) for f in F}
out = {
    'season': SEASON,
    'win_model': {f: wm[f] for f in F},
    'mean': {f: round(float(np.mean(vals[f])), 2) for f in F},
    'dist': vals,
    'margin_dist': sorted(round(t['net'] * t['tempo'] / 100, 1) for t in teams.values()),
    'tempo_mean': round(float(np.mean([t['tempo'] for t in teams.values()])), 1),
    'box_mean': {k: round(float(np.mean([r[k] for r, _ in rows])), 2) for k in ('spg', 'bpg', 'rpg')},
    'def_fit': def_fit,
    'proj': {k: {**{f: t[f] for f in F if f in t}, 'net': t.get('net'), 'tempo': t.get('tempo')}
             for k, t in DNA[PROJ]['teams'].items()},
}
path = os.path.join(HERE, 'data', 'lab_factors.json')
json.dump(out, open(path, 'w'), separators=(',', ':'))
print('wrote', path, os.path.getsize(path), 'bytes;', len(out['proj']), 'projected teams;', def_fit)
