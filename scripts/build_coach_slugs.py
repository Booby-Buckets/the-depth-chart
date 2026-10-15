#!/usr/bin/env python3
"""Coach name -> coach page index for tdc-coachlink.js (every page links coach names to coach.html).
Reads scripts/data/coach_profiles.json, writes data/coach_slugs.json: {normName: [[slug, "School A|School B", last_year], ...]}.
Rerun after build_coach_profiles."""
import json, re, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = json.load(open(os.path.join(ROOT, 'scripts/data/coach_profiles.json')))
out, il = {}, {}
SUF = {'jr', 'sr', 'ii', 'iii', 'iv'}
for p in P:
    if not p.get('coach') or not p.get('coach_slug'): continue
    k = re.sub(r'[^a-z]', '', p['coach'].lower())
    schools = '|'.join(s.strip() for s in (p.get('schools') or '').split(',') if s.strip())
    row = [p['coach_slug'], schools, p.get('last_year') or 0]
    out.setdefault(k, []).append(row)
    # first initial + last name ("Mike"/"Michael Boynton" -> "m|boynton") for sheet nickname spellings
    w = [x for x in re.sub(r'[^a-z ]', '', p['coach'].lower()).split() if x not in SUF]
    if len(w) >= 2: il.setdefault(w[0][0] + '|' + w[-1], []).append(row)
for d in (out, il):
    for k in d: d[k].sort(key=lambda x: -x[2])
out['_il'] = il
json.dump(out, open(os.path.join(ROOT, 'data/coach_slugs.json'), 'w'), separators=(',', ':'))
print(len(out), 'coach names')
