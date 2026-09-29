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

# ── coach-aware history ────────────────────────────────────────────────────────────────────
# A program's last two seasons only say something about next year if the same coach ran them
# (Miami 7-24 under Larranaga, then 26-9 under Jai Lucas; Virginia pre-Odom vs Odom). History
# therefore follows the COACH: his own last seasons, at whatever school; none if he was not a
# head coach (then the model uses less history). coach_seasons.json = sports-reference coaches.
import re
CS = json.load(open(os.path.join(HERE, 'data', 'coach_seasons.json')))
ALIAS = {"Connecticut": "UConn Huskies", "Brigham Young": "BYU Cougars", "Louisiana State": "LSU Tigers",
 "Southern California": "USC Trojans", "Texas Christian": "TCU Horned Frogs", "Southern Methodist": "SMU Mustangs",
 "Virginia Commonwealth": "VCU Rams", "Nevada-Las Vegas": "UNLV Rebels", "Miami (FL)": "Miami Hurricanes",
 "Southern Mississippi": "Southern Miss Golden Eagles", "San Jose State": "San José State Spartans",
 "Massachusetts": "UMass Minutemen", "Louisiana-Monroe": "UL Monroe Warhawks", "Hawaii": "Hawai'i Rainbow Warriors",
 "NC State": "NC State Wolfpack", "St. John's (NY)": "St. John's Red Storm", "Mississippi": "Ole Miss Rebels",
 "Pittsburgh": "Pittsburgh Panthers", "Saint Mary's (CA)": "Saint Mary's Gaels", "Loyola (IL)": "Loyola Chicago Ramblers",
 "Albany (NY)": "UAlbany Great Danes", "Appalachian State": "App State Mountaineers", "Central Connecticut State": "Central Connecticut Blue Devils",
 "College of Charleston": "Charleston Cougars", "FDU": "Fairleigh Dickinson Knights", "IU Indy": "IU Indianapolis Jaguars",
 "Illinois-Chicago": "UIC Flames", "Loyola (MD)": "Loyola Maryland Greyhounds", "Maryland-Baltimore County": "UMBC Retrievers",
 "Maryland-Eastern Shore": "Maryland Eastern Shore Hawks", "Massachusetts-Lowell": "UMass Lowell River Hawks", "Nicholls State": "Nicholls Colonels",
 "Queens (NC)": "Queens University Royals", "Saint Francis (PA)": "Saint Francis Red Wolves", "Southeastern Louisiana": "SE Louisiana Lions",
 "St. Thomas": "St. Thomas-Minnesota Tommies", "Texas-Rio Grande Valley": "UT Rio Grande Valley Vaqueros"}
# programs the coach_seasons scrape has NO rows for at all (VCU, UCLA): their head coaches by
# season, using the slugs those coaches carry elsewhere in coach_seasons so careers connect
COACH_FILL = [('VCU Rams', y, 'anthony-grant-2') for y in (2007, 2008, 2009)] + \
             [('VCU Rams', y, 'shaka-smart-1') for y in range(2010, 2016)] + \
             [('VCU Rams', y, 'will-wade-1') for y in (2016, 2017)] + \
             [('VCU Rams', y, 'mike-rhoades-1') for y in range(2018, 2024)] + \
             [('VCU Rams', y, 'ryan-odom-1') for y in (2024, 2025)] + [('VCU Rams', 2026, 'phil-martelli-2')] + \
             [('UCLA Bruins', y, 'ben-howland-1') for y in range(2007, 2014)] + \
             [('UCLA Bruins', y, 'steve-alford-1') for y in range(2014, 2020)] + \
             [('UCLA Bruins', y, 'mick-cronin-1') for y in range(2020, 2027)]
_ALLKEYS = sorted({k for s in TD if s.isdigit() for k in TD[s]['teams']})
_MARK = re.compile(r"\b(atlantic|christian|baptist|state|southern|a&m|a&t|international|wesleyan|of|valley|pine bluff|gulf coast|tech|central|northern|western|eastern|st|chicago|ohio|fl|ny)\b")
_keymemo = {}
def school_key(school):
    """sports-reference school name -> team_dna (ESPN) key"""
    if school in _keymemo: return _keymemo[school]
    k = ALIAS.get(school) if ALIAS.get(school) in _ALLKEYS else None
    if not k:
        sl = school.lower(); c = [x for x in _ALLKEYS if x.lower() == sl or (x.lower().startswith(sl + ' ') and not _MARK.search(x.lower()[len(sl) + 1:]))]
        k = sorted(c, key=len)[0] if c else None
    _keymemo[school] = k; return k
COACH_AT = {}; SEASONS_OF = {}
for c in CS:
    k = school_key(c['school'])
    if not k: continue
    COACH_AT[(c['season_year'], k)] = c['coach_slug']; SEASONS_OF[(c['coach_slug'], c['season_year'])] = k
for k, y, slug in COACH_FILL:
    COACH_AT.setdefault((y, k), slug); SEASONS_OF.setdefault((slug, y), k)

def hist(s_target, key, coach):
    """(h1O,h1D,h2O,h2D): the coach's own two prior seasons; program seasons if the coach is unknown"""
    out = []
    for back in (1, 2):
        s = str(int(s_target) - back)
        k = SEASONS_OF.get((coach, int(s))) if coach else key
        out += [adjdev(s, k, 0), adjdev(s, k, 1)] if k else [None, None]
    return out

# training rows: [season, projO, projD, h1O, h1D, h2O, h2D, yO, yD] (None where missing)
import sys
COACH_HIST = '--program-history' not in sys.argv   # A/B switch for the report
rows = []
for s, teams in HP.items():
    if s not in mA: continue
    y = int(s); s1, s2 = str(y - 1), str(y - 2)
    for k, v in teams.items():
        yo, yd = adjdev(s, k, 0), adjdev(s, k, 1)
        if yo is None or yd is None: continue
        h = hist(s, k, COACH_AT.get((y, k))) if COACH_HIST else [adjdev(s1, k, 0), adjdev(s1, k, 1), adjdev(s2, k, 0), adjdev(s2, k, 1)]
        rows.append([y, v['ORtg'] - mP[s][0], v['DRtg'] - mP[s][1], h[0], h[1], h[2], h[3], yo, yd])

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

ROT = json.load(open(os.path.join(HERE, 'data', 'coach_rotation.json')))
def _norm(x): return re.sub(r"[^a-z0-9&' ]", ' ', x.lower().replace('-', ' ')).replace('  ', ' ').strip()
def cur_coach(full):
    fl = _norm(full); best = None
    for short, r in ROT.items():
        if short.startswith('_') or not isinstance(r, dict) or not r.get('slug'): continue
        sl = _norm(short)
        if fl == sl or (fl.startswith(sl + ' ') and not _MARK.search(fl[len(sl) + 1:])):
            if best is None or len(sl) > len(best[0]): best = (sl, r['slug'])
    return best[1] if best else COACH_AT.get((int(LAST), full))   # fallback: last season's coach
used = {0: 0, 1: 0, 2: 0}
for k, t in P27.items():
    if t.get('ORtg_roster') is None or t.get('DRtg_roster') is None: continue
    po = t['ORtg_roster'] - offO - mP[LAST][0]; pd = t['DRtg_roster'] - offD - mP[LAST][1]
    h1o, h1d, h2o, h2d = hist(PROJ, k, cur_coach(k)) if COACH_HIST else (adjdev(LAST, k, 0), adjdev(LAST, k, 1), adjdev(PREV, k, 0), adjdev(PREV, k, 1))
    t['calib_coach'] = cur_coach(k) if COACH_HIST else None
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
