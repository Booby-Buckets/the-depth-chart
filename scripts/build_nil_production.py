#!/usr/bin/env python3
"""NIL PRODUCTION PRICE (owner, Nov 18 2026: "Lets not use the grade. We need to be a lot more analytical in the prices").

Every price on the player NIL tab's three numbers (last year · expected · on current form) comes from ONE chain, no grade:

  1. Wins Added from the box-score line (the site's owned WA, scripts/derived_stats.py):
       TI    = pts + .8 oreb + .3 dreb + .7 ast + 1.4 stl + .9 blk − .5 missed FG − .35 missed FT − tov
       TI/40 = TI·40/(min+100)      WA = (TI/40 − 5)·(min/40)/69.87
     on a standard 31-game season at his minutes per game, so a missed month doesn't read as worse play.
  2. × level: the league he produced it in (conference strength, level_adj.json, same K as the overall's SOS):
       level = clip(1 − 0.42·(1 − conf strength / top conf strength), 0.5, 1)
  3. → dollars by RANK: the n-th percentile of adjusted WA among 2025-26 D-I players is paid what the n-th percentile
     of the current NIL market pays (nil-data.json values). The market sets the dollar shape; production sets the order.

Writes data/nil_production.json: {meta, curve:[[wa,$M]...], level:{team: mult}, exp:{espn_id: {wa,lvl,val,mpg,team}}}.
The page computes the last-year and current-form numbers live from the same curve and levels (its own season lines),
and reads `exp` for the expected price so the national rank is on one scale.
"""
import json, re, sys, urllib.request, urllib.parse, os

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"; KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = 31; K = 0.42

def sb(path):
    out = []; off = 0
    while True:
        sep = '&' if '?' in path else '?'
        req = urllib.request.Request(f"{SB}/rest/v1/{path}{sep}offset={off}&limit=1000", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
        rows = json.load(urllib.request.urlopen(req, timeout=60)); out += rows
        if len(rows) < 1000: return out
        off += 1000

def f(r, k):
    try: v = float(r.get(k)); return v if v == v else 0.0
    except Exception: return 0.0

def wa_line(r, ast='apg', tov='tovs', pts='ppg'):
    """WA per 31-game season from a per-game line."""
    mpg = f(r, 'mpg')
    if mpg <= 0: return None
    ti_g = f(r, pts) + .8*f(r, 'oreb') + .3*f(r, 'dreb') + .7*f(r, ast) + 1.4*f(r, 'stl') + .9*f(r, 'blk') \
        - .5*(f(r, 'fga')-f(r, 'fgm')) - .35*(f(r, 'fta')-f(r, 'ftm')) - f(r, tov)
    m = mpg*G; ti40 = ti_g*G*40/(m+100)
    return (ti40-5.0)*(m/40)/69.87

LV = json.load(open(os.path.join(ROOT, 'scripts/data/level_adj.json')))
TC = {k.lower(): v for k, v in LV['team_conf'].items()}
def conf_of(team):
    s = (team or '').lower().strip()
    if not s: return None
    if s in TC: return TC[s]
    hits = [(len(k[len(s):].split()), v) for k, v in TC.items() if k.startswith(s+' ')]
    if hits:
        hits.sort(); best = [h for h in hits if h[0] == hits[0][0]]
        if len(best) == 1: return best[0][1]
    for k, v in TC.items():
        if s.startswith(k+' '): return v
    return None
def level(team):
    c = conf_of(team); st = LV['conf_strength'].get(c) if c else None
    if st is None: return 0.80        # unknown league: the overall's default
    return max(0.5, min(1.0, 1 - K*(1 - st/LV['top'])))

# ---- 2025-26 production distribution
ph = sb("player_history?season_year=eq.2026&select=espn_id,team,ppg,mpg,gp,fgm,fga,ftm,fta,oreb,dreb,apg,stl,blk,tovs&order=id.asc")
teams = set(); prod = []
for r in ph:
    teams.add(r.get('team') or '')
    if f(r, 'gp') < 5 or f(r, 'mpg') < 4: continue
    w = wa_line(r)
    if w is not None: prod.append(w*level(r.get('team')))
prod.sort()

# ---- current NIL market distribution ($M), walk-ons out
nd = json.load(open(os.path.join(ROOT, 'nil-data.json')))
mkt = sorted(float(p['value']) for t in nd['teams'].values() for p in t.get('players', []) if not p.get('walkon') and p.get('value'))
for tk in nd['teams']: teams.add(tk)

# curve knots: percentile of production -> same percentile of the market
def q(a, p): i = p*(len(a)-1); lo = int(i); hi = min(lo+1, len(a)-1); return a[lo] + (a[hi]-a[lo])*(i-lo)
pcts = [0, .02, .05, .1, .15, .2, .25, .3, .35, .4, .45, .5, .55, .6, .65, .7, .75, .8, .85, .9, .93, .95, .97, .98, .99, .995, 1]
curve = []
for p in pcts:
    w, v = round(q(prod, p), 3), round(q(mkt, p), 4)
    if curve and w <= curve[-1][0]: continue
    curve.append([w, v])

def price(w):
    if w <= curve[0][0]: return curve[0][1]
    for (w0, v0), (w1, v1) in zip(curve, curve[1:]):
        if w <= w1: return v0 + (v1-v0)*(w-w0)/(w1-w0)
    # past the best season on record: keep the top segment's slope, damped
    (w0, v0), (w1, v1) = curve[-2], curve[-1]
    return v1 + 0.5*(v1-v0)/(w1-w0)*(w-w1)

# ---- expected 2026-27: the PROJECTED line (stat_overall_projected.json — the same projection the site shows; the nightly
#      build moves it a little with real games). Anyone it lacks falls back to his roster row (players table).
pl = sb("players?select=espn_id,name,position,height,weight,class_year,team,ppg,mpg,gp,fgm,fga,ftm,fta,oreb,dreb,apg,stl,blk,tovs&order=id.asc")
ros = {str(r['espn_id']): r for r in pl if r.get('espn_id') is not None}
# weight: the roster table has none, so take each player's latest listed weight from player_history
WT = {}
for r in sb("player_history?season_year=gte.2024&weight=not.is.null&select=espn_id,weight,season_year&order=id.asc"):
    e = r.get('espn_id')
    if e is None: continue
    k = str(e)
    if k not in WT or r['season_year'] >= WT[k][0]: WT[k] = (r['season_year'], r['weight'])
SP = json.load(open(os.path.join(ROOT, 'scripts/data/stat_overall_projected.json')))
short = {}
for tk, arr in (SP.get('teams') or {}).items():
    for x in arr: short[str(x.get('espn'))] = tk
def lvl_conf(c):
    st = LV['conf_strength'].get(c) if c else None
    return 0.80 if st is None else max(0.5, min(1.0, 1 - K*(1 - st/LV['top'])))
exp = {}
for e, r in ros.items():
    sp = (SP.get('players') or {}).get(e)
    line = sp if (sp and f(sp, 'mpg') > 0) else r
    if f(line, 'mpg') <= 0 or f(line, 'ppg') <= 0: continue
    w = wa_line(line)
    if w is None: continue
    lv = lvl_conf(sp.get('conf')) if (sp and sp.get('conf')) else level(r.get('team'))
    exp[e] = {'wa': round(w, 2), 'lvl': round(lv, 3), 'val': round(price(w*lv), 4), 'mpg': round(f(line, 'mpg'), 1),
              'team': r.get('team') or short.get(e), 'name': r.get('name'), 'pos': r.get('position'), 'ht': r.get('height'), 'wt': r.get('weight') or (WT.get(e) or (None, None))[1], 'cls': r.get('class_year'), 'src': 'proj' if line is sp else 'roster'}

out = {'meta': {'built': 'build_nil_production.py', 'games': G, 'k': K, 'n_prod': len(prod), 'n_mkt': len(mkt),
                'note': 'WA per 31 games x conference level -> $ by percentile against the current NIL market'},
       'curve': curve, 'level': {t: round(level(t), 3) for t in sorted(teams) if t}, 'exp': exp}
json.dump(out, open(os.path.join(ROOT, 'data/nil_production.json'), 'w'), separators=(',', ':'))
print('prod', len(prod), 'mkt', len(mkt), 'exp', len(exp), 'curve', curve[:3], '...', curve[-3:])
