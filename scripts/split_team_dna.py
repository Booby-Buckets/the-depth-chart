#!/usr/bin/env python3
"""team_dna_recent.json = just the 2026 and 2027 seasons of team_dna.json (owner, Nov 21 2026: "the website takes a very
long time to load"). team_dna.json holds every season since 2007 (4.3 MB, ~1 MB gzipped) and the shared scripts that ride
on most pages (tdc-rating, tdc-proj, tdc-roles, tdc-postseason) read only 2026 or 2027 of it. Pages that browse history
(dossier, DNA sheet, lineups, analytics, compare, matchup) keep reading the full file. Run after anything that rewrites
team_dna.json (rebuild-projections.yml does)."""
import json, os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
full = json.load(open(os.path.join(D, 'team_dna.json')))
out = {k: full[k] for k in ('2026', '2027') if k in full}
json.dump(out, open(os.path.join(D, 'team_dna_recent.json'), 'w'), separators=(',', ':'))
print('team_dna_recent.json', sorted(out), os.path.getsize(os.path.join(D, 'team_dna_recent.json')), 'bytes')
