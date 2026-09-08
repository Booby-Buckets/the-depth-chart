#!/usr/bin/env python3
"""Build nil-defense.json — a per-player defensive / foul profile for the NIL model.

Reads ONLY via the public anon key (read-only; never the service/secret key). Pulls, for every
espn_id in nil-data.json:
  - player_advanced (2026): owa, dwa, blk_pct, stl_pct, drb_pct   (owned defense + disruption)
  - box_scores (2026) aggregated: fouls per 40  (availability / discipline the box grade underrates)
Then computes position-aware flags + a modest NIL value multiplier (defMult, discount-only) and
writes nil-defense.json = { "by": { "<espn>": {dwa, owa, pf40, blk_pct, stl_pct, defMult, flags[]} }, meta }.

The grade already rewards efficient scoring; this surfaces what it under-weights — foul-proneness
and a weak/limited defensive profile — so a foul-prone defensive minus (e.g. a big who fouls a lot
and protects the rim below his size) isn't valued like a clean two-way player.

Run:  cd scripts && python3 build_nil_defense.py   (writes ../nil-defense.json)
"""
import json, os, sys, urllib.request, urllib.parse

SB = 'https://izlqhnxowdhtdofkwrho.supabase.co'
KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'   # PUBLIC anon key (read-only) — never a secret key
H = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY}
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def get(path):
    req = urllib.request.Request(SB + '/rest/v1/' + path, headers=H)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())


def chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def fam(pos):
    P = (pos or '').upper().split('/')[0].strip()
    if P in ('C', 'PF', 'FC', 'F'):
        return 'big'
    if P in ('PG', 'SG', 'G', 'CG'):
        return 'guard'
    return 'wing'


def pct_rank(sorted_arr, v):
    """fraction of the (sorted) array strictly below v (0..1); None if empty/None."""
    if v is None or not sorted_arr:
        return None
    lo, hi = 0, len(sorted_arr)
    while lo < hi:
        mid = (lo + hi) // 2
        if sorted_arr[mid] < v:
            lo = mid + 1
        else:
            hi = mid
    return lo / len(sorted_arr)


def main():
    nd = json.load(open(os.path.join(ROOT, 'nil-data.json')))
    pos_by = {}
    for tn, t in nd.get('teams', {}).items():
        for p in t.get('players', []):
            e = p.get('espn_id')
            if e is not None and not p.get('walkon'):
                pos_by[int(e)] = p.get('pos')
    ids = list(pos_by.keys())
    print('rated players with espn_id: %d' % len(ids))

    # ── player_advanced (owned defense + disruption) ──
    adv = {}
    for ch in chunks(ids, 100):
        q = ('player_advanced?espn_id=in.(%s)&season_year=eq.2026'
             '&select=espn_id,owa,dwa,blk_pct,stl_pct,drb_pct,min&min=gte.120'
             % ','.join(map(str, ch)))
        for row in get(q):
            adv[int(row['espn_id'])] = row
    print('player_advanced rows: %d' % len(adv))

    # ── box_scores fouls -> per-40 ──
    foul = {}
    for ch in chunks(ids, 120):
        off = 0
        while True:
            q = ('box_scores?espn_id=in.(%s)&season_year=eq.2026'
                 '&select=espn_id,pf,min&order=game_id&limit=1000&offset=%d'
                 % (','.join(map(str, ch)), off))
            rows = get(q)
            for r in rows:
                e = int(r['espn_id'])
                a = foul.setdefault(e, [0.0, 0.0])
                a[0] += (r.get('pf') or 0)
                a[1] += (r.get('min') or 0)
            if len(rows) < 1000:
                break
            off += 1000
    pf40 = {e: (f[0] / f[1] * 40 if f[1] and f[1] > 0 else None) for e, f in foul.items()}
    print('players with foul data: %d' % sum(1 for v in pf40.values() if v is not None))

    # ── position-family distributions for calibration ──
    banks = {'big': {}, 'guard': {}, 'wing': {}}
    for e in ids:
        f = fam(pos_by[e])
        a = adv.get(e, {})
        for key, val in (('dwa', a.get('dwa')), ('stl_pct', a.get('stl_pct')),
                         ('blk_pct', a.get('blk_pct')), ('pf40', pf40.get(e))):
            if val is not None:
                banks[f].setdefault(key, []).append(float(val))
    for f in banks:
        for k in banks[f]:
            banks[f][k].sort()

    # ── per-player flags + defMult ──
    out = {}
    for e in ids:
        f = fam(pos_by[e])
        a = adv.get(e, {})
        dwa = a.get('dwa'); owa = a.get('owa'); blk = a.get('blk_pct'); stl = a.get('stl_pct')
        pf = pf40.get(e)
        flags = []
        mult = 1.0
        B = banks[f]
        # fouls (discipline / availability the box grade underrates)
        if pf is not None:
            if pf >= 4.2:
                flags.append('foul-prone')
            if pf > 3.2:
                mult -= min(0.12, (pf - 3.2) * 0.06)   # 4.5/40 -> -0.078
        # owned defense relative to position
        dr = pct_rank(B.get('dwa', []), dwa)
        if dr is not None:
            if dr <= 0.15:
                flags.append('defensive-liability'); mult -= 0.10
            elif dr >= 0.85:
                flags.append('plus-defender')
        # rim protection for bigs (size-relative)
        if f == 'big':
            br = pct_rank(B.get('blk_pct', []), blk)
            if br is not None:
                if br <= 0.20:
                    flags.append('poor-rim-protection'); mult -= 0.04
                elif br >= 0.80:
                    flags.append('rim-protector')
        # lateral activity / mobility proxy
        sr = pct_rank(B.get('stl_pct', []), stl)
        if sr is not None and sr <= 0.15:
            flags.append('low-defensive-activity')
        mult = max(0.80, round(mult, 3))
        rec = {'defMult': mult}
        if flags:
            rec['flags'] = flags
        if dwa is not None: rec['dwa'] = round(float(dwa), 2)
        if owa is not None: rec['owa'] = round(float(owa), 2)
        if pf is not None: rec['pf40'] = round(float(pf), 1)
        if blk is not None: rec['blk_pct'] = round(float(blk), 1)
        if stl is not None: rec['stl_pct'] = round(float(stl), 2)
        # only store players we actually have a signal for
        if dwa is not None or pf is not None:
            out[str(e)] = rec

    payload = {'meta': {'season': 2026, 'players': len(out),
                        'note': 'Defensive/foul profile for the NIL model. Anon read-only build. '
                                'defMult is a discount-only NIL multiplier (0.80-1.00).'},
               'by': out}
    path = os.path.join(ROOT, 'nil-defense.json')
    json.dump(payload, open(path, 'w'), separators=(',', ':'))
    print('wrote %s (%d players)' % (path, len(out)))
    # spot check
    for nm, e in (('Samet', 5238184), ('Bidunga', None)):
        if e and str(e) in out:
            print('  %s: %s' % (nm, out[str(e)]))


if __name__ == '__main__':
    main()
