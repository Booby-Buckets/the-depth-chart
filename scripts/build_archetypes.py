#!/usr/bin/env python3
"""build_archetypes.py — cluster D-I players into STYLE archetypes (Rich Moss GT paper).

Style, not quality: features are how a player PLAYS (size, ball-dominance, playmaking,
spacing, rim pressure, rebounding, rim protection, perimeter activity) — never efficiency
or wins, so a Rim Protector and a Two-Way Big separate by role, not by how good they are.

k-means (k=10) on standardized features; clusters are matched to fixed archetype TEMPLATES
via the Hungarian algorithm so the labels stay stable across re-runs (a cluster is named by
its profile, not its random id). Output winning_value-style: archetypes.json maps
espn_id -> archetype name (+ the archetype dictionary with descriptions & colors for the UI).

Run: python3 scripts/build_archetypes.py
"""
import json, os, math, re, urllib.request
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from scipy.optimize import linear_sum_assignment

SB='https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1'
KEY='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'
SEASON=2026; K=10
HERE=os.path.dirname(__file__)
FEAT=['ht','usg','ast','tp_rate','ft_rate','orb','drb','blk','stl']

# fixed archetype templates (z-signatures on FEAT). Clusters are Hungarian-matched to these,
# so names track the PROFILE and stay stable even if k-means renumbers clusters.
TEMPLATES=[
 ('Two-Way Big',        {'ht':0.9,'drb':1.6,'orb':1.3,'tp_rate':-1.1,'blk':0.6}),
 ('Rim Protector',      {'blk':3.0,'orb':1.5,'ht':1.5,'tp_rate':-1.4,'ast':-0.9}),
 ('Rim-Runner',         {'orb':1.6,'ft_rate':1.4,'ht':1.1,'tp_rate':-1.4,'ast':-0.7}),
 ('Lead Creator',       {'ast':2.1,'usg':1.1,'stl':0.6,'ht':-1.1,'orb':-0.8}),
 ('Point-of-Attack Guard',{'stl':2.0,'ast':0.6,'ht':-0.7,'orb':-0.3}),
 ('Scoring Guard',      {'tp_rate':0.6,'ast':0.5,'usg':0.3,'ht':-1.1,'drb':-0.9}),
 ('Shot Creator',       {'usg':1.1,'drb':0.3,'ht':0.3,'stl':-0.2,'blk':-0.2}),
 ('3&D Wing',           {'tp_rate':1.3,'ft_rate':-0.9,'usg':-0.7,'ht':-0.1}),
 ('Slashing Wing',      {'ft_rate':1.0,'stl':0.2,'usg':-0.4,'blk':-0.4}),
 ('Glue Forward',       {'ht':0.7,'drb':0.6,'orb':0.4,'ast':-0.6,'usg':-0.5}),
]
DESC={
 'Two-Way Big':'Interior forward who rebounds both ends and scores inside — the do-it-all frontcourt anchor.',
 'Rim Protector':'Shot-blocking, offensive-rebounding big who lives at the rim; the defensive anchor.',
 'Rim-Runner':'Rolls, crashes the offensive glass and draws fouls — vertical spacing, little range.',
 'Lead Creator':'Ball-dominant lead guard who runs the offense — high usage AND high assists.',
 'Point-of-Attack Guard':'Small, disruptive on-ball defender who steals, pushes and sets up teammates.',
 'Scoring Guard':'Undersized combo guard who shoots and creates his own — a bucket-getter.',
 'Shot Creator':'High-usage wing/forward who manufactures shots off the dribble — the primary scorer.',
 '3&D Wing':'Low-usage spot-up shooter who spaces the floor and guards — the connective 3&D role.',
 'Slashing Wing':'Attacks the rim and draws fouls, pressures the ball — a two-way slasher.',
 'Glue Forward':'Low-usage forward who rebounds and connects without needing the ball — the glue guy.',
}
COLOR={'Two-Way Big':'#c0417d','Rim Protector':'#6f5bd0','Rim-Runner':'#3b83d4','Lead Creator':'#d89a2a',
 'Point-of-Attack Guard':'#2aa3a3','Scoring Guard':'#d8622a','Shot Creator':'#cc3355','3&D Wing':'#2a9d5a',
 'Slashing Wing':'#c07a2a','Glue Forward':'#7a8590'}

def q(p):
    r=urllib.request.Request(SB+p,headers={'apikey':KEY,'Authorization':'Bearer '+KEY}); return json.load(urllib.request.urlopen(r,timeout=90))
def pull(t):
    rows=[];off=0
    while True:
        b=q(t+('&' if '?' in t else '?')+'order=espn_id.asc&limit=1000&offset=%d'%off)
        if not b: break
        rows+=b; off+=1000
        if len(b)<1000: break
    return rows
def f(v):
    try: x=float(v); return x if math.isfinite(x) else None
    except: return None
def ht_in(s):
    m=re.match(r'(\d+)-(\d+)',s or ''); return int(m.group(1))*12+int(m.group(2)) if m else None

def main():
    adv={str(r['espn_id']):r for r in pull('/player_advanced?season_year=eq.%d&select=espn_id,team,usg_pct,ast_pct,orb_pct,drb_pct,blk_pct,stl_pct'%SEASON) if r.get('espn_id') is not None}
    ph=pull('/player_history?season_year=eq.%d&select=espn_id,name,position,height,fga,tpa,fta,mpg,gp,tdc_grade'%SEASON)
    rows=[]
    for r in ph:
        eid=str(r.get('espn_id')); a=adv.get(eid)
        if not a: continue
        mpg,gp,fga=f(r.get('mpg')),f(r.get('gp')),f(r.get('fga'))
        if not mpg or not gp or gp<10 or mpg<12 or not fga or fga<2: continue
        ff={'usg':f(a.get('usg_pct')),'ast':f(a.get('ast_pct')),
            'tp_rate':(f(r.get('tpa')) or 0)/fga,'ft_rate':(f(r.get('fta')) or 0)/fga,
            'orb':f(a.get('orb_pct')),'drb':f(a.get('drb_pct')),
            'blk':f(a.get('blk_pct')),'stl':f(a.get('stl_pct')),'ht':ht_in(r.get('height'))}
        if any(v is None for v in ff.values()): continue
        rows.append({'espn_id':r['espn_id'],'name':r['name'],'f':ff,
                     'team':(a.get('team') or ''),'grade':f(r.get('tdc_grade')) or 0})
    X=np.array([[r['f'][k] for k in FEAT] for r in rows])
    scaler=StandardScaler().fit(X); Xs=scaler.transform(X)
    km=KMeans(n_clusters=K,n_init=10,random_state=42).fit(Xs)
    cent=km.cluster_centers_   # z-space (K x 9)
    # Hungarian: match each cluster to a unique template by nearest z-signature
    T=np.array([[tpl[1].get(k,0.0) for k in FEAT] for tpl in TEMPLATES])
    cost=np.linalg.norm(cent[:,None,:]-T[None,:,:],axis=2)   # K x K
    ri,ci=linear_sum_assignment(cost)
    cluster_name={int(ri[i]):TEMPLATES[int(ci[i])][0] for i in range(len(ri))}
    def norm(s): return ''.join(ch for ch in (s or '').lower() if ch.isalnum())
    players={}; by_name={}; roster={}
    for i,r in enumerate(rows):
        nm=cluster_name[int(km.labels_[i])]
        if r['espn_id'] is not None: players[str(r['espn_id'])]={'a':nm}
        by_name[norm(r['name'])]={'a':nm}
        roster.setdefault(nm,[]).append({'n':r['name'],'t':r['team'],'g':round(r['grade']),'e':r['espn_id']})
    for nm in roster: roster[nm]=sorted(roster[nm],key=lambda x:-x['g'])   # best first
    counts={}
    for v in players.values(): counts[v['a']]=counts.get(v['a'],0)+1
    out={'meta':{'season':SEASON,'k':K,'n':len(players),'features':FEAT},
         'archetypes':[{'name':n,'desc':DESC[n],'color':COLOR[n],'count':counts.get(n,0)} for n,_ in TEMPLATES],
         'players':players,'by_name':by_name,'roster':roster}
    path=os.path.join(HERE,'..','archetypes.json')
    json.dump(out,open(path,'w'),separators=(',',':'))
    print('wrote %s  (%d players)'%(os.path.abspath(path),len(players)))
    for n,_ in TEMPLATES: print('  %-22s %d'%(n,counts.get(n,0)))

if __name__=='__main__':
    main()
