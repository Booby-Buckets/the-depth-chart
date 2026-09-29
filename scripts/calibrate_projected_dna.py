"""Calibrate the 2026-27 projected ORtg / DRtg / net (team_dna.json["2027"]) against history.

Why (owner, Sept 2026): the projected offense/defense ratings looked nothing like other
preseason ratings. Two measured problems with the roster-only projection:
  1. It is under-dispersed and pulled toward average (defense most): across 2009-2026
     preseason projections (team_dna_proj.json) vs how the seasons ended (team_dna adjO/adjD),
     actual net ~ 1.24 x projected; top teams' projected DRtg sat ~6-8 worse than they play.
  2. It ignores program / coach identity. Adding each program's last two ACTUAL seasons
     (opponent-adjusted, team_dna adjO/adjD) lifts leave-one-season-out accuracy:
     defense r .66 -> .76, offense r .72 -> .79 (Tennessee's defense was projected 109.8).

Model, fit per side in deviations from each season's D-I mean (so scoring-environment drift
between years doesn't leak in):
    actual_dev(t) = a + b*proj_dev(t) + c*adj_dev(t-1) + d*adj_dev(t-2)
with fallbacks for programs missing a prior season (proj + last year; proj only). The 2027
roster projection is moved onto the historical projection's scale by the mean offset over
programs present in both (the two builders use different baselines; their NETS agree), and the
result is re-centred on the latest actual season's D-I mean. net = ORtg - DRtg exactly.

The roster values are kept as ORtg_roster / DRtg_roster / net_roster, and they are what this
script reads, so re-running it is idempotent. Run after build_projected_dna.py and before
build_team_eff.py:   python3 scripts/calibrate_projected_dna.py
"""
import json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DNA_P = os.path.join(HERE, 'data', 'team_dna.json')
HIST_P = os.path.join(HERE, 'data', 'team_dna_proj.json')
TD = json.load(open(DNA_P))
HP = json.load(open(HIST_P))
PROJ = '2027'
seasons = sorted(s for s in TD if s.isdigit() and s != PROJ)
LAST = seasons[-1]; PREV = str(int(LAST) - 1)

def mean_adj(s):
    T = TD[s]['teams']
    return (float(np.mean([t['adjO'] for t in T.values() if t.get('adjO') is not None])),
            float(np.mean([t['adjD'] for t in T.values() if t.get('adjD') is not None])))
mA = {s: mean_adj(s) for s in seasons if any(t.get('adjO') is not None for t in TD[s]['teams'].values())}
mP = {s: (float(np.mean([v['ORtg'] for v in HP[s].values()])), float(np.mean([v['DRtg'] for v in HP[s].values()]))) for s in HP}

def adjdev(s, k, side):
    t = TD.get(s, {}).get('teams', {}).get(k)
    if not t or s not in mA: return None
    v = t.get('adjO' if side == 0 else 'adjD')
    return None if v is None else v - mA[s][side]

# training rows: [season, projO, projD, h1O, h1D, h2O, h2D, yO, yD] (None where missing)
rows = []
for s, teams in HP.items():
    if s not in mA: continue
    y = int(s); s1, s2 = str(y - 1), str(y - 2)
    for k, v in teams.items():
        yo, yd = adjdev(s, k, 0), adjdev(s, k, 1)
        if yo is None or yd is None: continue
        rows.append([y, v['ORtg'] - mP[s][0], v['DRtg'] - mP[s][1],
                     adjdev(s1, k, 0), adjdev(s1, k, 1), adjdev(s2, k, 0), adjdev(s2, k, 1), yo, yd])

def fit(side, nhist):
    """side 0=O,1=D; nhist 0/1/2 prior seasons. Returns (coefs, loso_r, n)."""
    pc, h1, h2, yc = (1, 3, 5, 7) if side == 0 else (2, 4, 6, 8)
    use = [r for r in rows if (nhist < 1 or r[h1] is not None) and (nhist < 2 or r[h2] is not None)]
    X = np.array([[1, r[pc]] + ([r[h1]] if nhist >= 1 else []) + ([r[h2]] if nhist >= 2 else []) for r in use], float)
    Y = np.array([r[yc] for r in use], float); S = np.array([r[0] for r in use])
    c = np.linalg.lstsq(X, Y, rcond=None)[0]
    pred = np.zeros(len(Y))
    for s in np.unique(S):
        tr = S != s; pred[~tr] = X[~tr] @ np.linalg.lstsq(X[tr], Y[tr], rcond=None)[0]
    return c, float(np.corrcoef(pred, Y)[0, 1]), len(Y)

M = {(side, h): fit(side, h) for side in (0, 1) for h in (0, 1, 2)}
for (side, h), (c, r, n) in M.items():
    print(f"{'OD'[side]} hist={h}: coefs {np.round(c, 3)}  LOSO r {r:.3f}  n {n}")
    if not (0.2 <= c[1] <= 1.6):
        raise SystemExit(f'implausible projection weight {c[1]:.2f} ({"OD"[side]}, hist={h}) — refusing to write')

P27 = TD[PROJ]['teams']
for t in P27.values():                                  # keep the roster numbers; always calibrate from them
    for k in ('ORtg', 'DRtg', 'net'):
        if f'{k}_roster' not in t and t.get(k) is not None: t[f'{k}_roster'] = t[k]
common = [k for k in P27 if k in HP.get(LAST, {}) and P27[k].get('ORtg_roster') is not None]
if len(common) < 40: raise SystemExit(f'only {len(common)} programs overlap the historical projection — refusing to write')
offO = float(np.mean([P27[k]['ORtg_roster'] - HP[LAST][k]['ORtg'] for k in common]))
offD = float(np.mean([P27[k]['DRtg_roster'] - HP[LAST][k]['DRtg'] for k in common]))
print(f'scale offsets O {offO:+.2f} D {offD:+.2f} over {len(common)} programs; centring on {LAST} D-I mean O {mA[LAST][0]:.1f} D {mA[LAST][1]:.1f}')

used = {0: 0, 1: 0, 2: 0}
for k, t in P27.items():
    if t.get('ORtg_roster') is None or t.get('DRtg_roster') is None: continue
    po = t['ORtg_roster'] - offO - mP[LAST][0]; pd = t['DRtg_roster'] - offD - mP[LAST][1]
    h1o, h1d, h2o, h2d = adjdev(LAST, k, 0), adjdev(LAST, k, 1), adjdev(PREV, k, 0), adjdev(PREV, k, 1)
    h = 2 if None not in (h1o, h1d, h2o, h2d) else 1 if None not in (h1o, h1d) else 0
    xo = [1, po] + ([h1o] if h >= 1 else []) + ([h2o] if h >= 2 else [])
    xd = [1, pd] + ([h1d] if h >= 1 else []) + ([h2d] if h >= 2 else [])
    o = mA[LAST][0] + float(np.dot(M[(0, h)][0], xo)); d = mA[LAST][1] + float(np.dot(M[(1, h)][0], xd))
    t['ORtg'] = round(o, 1); t['DRtg'] = round(d, 1); t['net'] = round(t['ORtg'] - t['DRtg'], 1)
    t['calib'] = h; used[h] += 1

vals = [(t['ORtg'], t['DRtg']) for t in P27.values() if t.get('calib') is not None]
if not vals or not all(90 <= o <= 135 and 80 <= d <= 125 for o, d in vals):
    raise SystemExit('calibrated ratings out of range — refusing to write')

# national-style percentiles within the projected pool (Team DNA tab reads t.pct)
DIRS = {'net': 1, 'ORtg': 1, 'DRtg': -1}
pool = [t for t in P27.values() if t.get('calib') is not None]
for m, dr in DIRS.items():
    vs = sorted(t[m] for t in pool); n = len(vs)
    for t in pool:
        below = sum(1 for v in vs if v < t[m]); pc = 100 * below / n
        t.setdefault('pct', {})[m] = round(pc if dr > 0 else 100 - pc)
TD[PROJ].setdefault('meta', {})['calibration'] = {
    'from': 'team_dna_proj.json 2009-%s vs team_dna adjO/adjD' % LAST,
    'models': {f"{'OD'[s]}{h}": {'coef': [round(x, 4) for x in M[(s, h)][0]], 'loso_r': round(M[(s, h)][1], 3)} for s in (0, 1) for h in (0, 1, 2)},
    'offsets': [round(offO, 2), round(offD, 2)], 'centre': [round(mA[LAST][0], 2), round(mA[LAST][1], 2)]}
json.dump(TD, open(DNA_P, 'w'), separators=(',', ':'))
top = sorted(pool, key=lambda t: -t['net'])[:5]
names = {id(v): k for k, v in P27.items()}
print('calibrated', len(pool), 'teams (history used: 2 yrs %d, 1 yr %d, none %d)' % (used[2], used[1], used[0]))
print('top 5:', ', '.join(f"{names[id(t)]} {t['ORtg']}/{t['DRtg']} ({t['net']:+.1f})" for t in top))
