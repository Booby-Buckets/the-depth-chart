#!/usr/bin/env python3
"""comp_pool.json — the player page's "Plays like" / Comps pool as ONE static file (owner, Nov 21 2026: "the website
takes a very long time to load"). It was every player_history season with 10+ mpg (~48k rows) paged out of Supabase in
~48 requests on every player page. Same columns and filter as player.html _fetchHistoryPool; columnar to stay small
(the page rebuilds the row objects). Past seasons don't change in-season: rerun after history edits."""
import json, os, urllib.request
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"; KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
COLS = ['id','name','season_year','team','position','height','ppg','rpg','apg','stl','blk','tpm','tpa','tovs','mpg','fg_pct','tp_pct','ft_pct','fga','fta','espn_id']
rows = []; off = 0
while True:
    req = urllib.request.Request(f"{SB}/rest/v1/player_history?select={','.join(COLS)}&mpg=gte.10&order=id&limit=1000&offset={off}", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    b = json.load(urllib.request.urlopen(req, timeout=60)); rows += b; off += 1000
    if len(b) < 1000: break
def rnd(v):
    if isinstance(v, float): v = round(v, 1); return int(v) if v == int(v) else v
    return v
R = [[rnd(r.get(c)) for c in COLS] for r in rows]
DICT = {}   # team / position / height: a few hundred distinct values each -> indexes (the page maps them back)
for c in ('team', 'position', 'height'):
    i = COLS.index(c); vals = sorted({r[i] for r in R if r[i] is not None}); ix = {v: k for k, v in enumerate(vals)}; DICT[c] = vals
    for r in R: r[i] = ix.get(r[i]) if r[i] is not None else None
out = {'cols': COLS, 'n': len(R), 'dict': DICT, 'rows': R}
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'comp_pool.json')
json.dump(out, open(p, 'w'), separators=(',', ':'))
print('comp_pool.json', len(rows), 'rows', os.path.getsize(p), 'bytes')
