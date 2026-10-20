"""Backtest (Oct 20 2026, owner: "unify projected ORtg/DRtg with the power rating, Torvik-style"): does a team's
offense / defense split built from its roster's own offensive vs defensive Wins Added (prior season, per minute, weighted by
this season's minutes; DWA at 0.62) beat our roster projection (team_dna_proj.json) at predicting real adjO / adjD?

Result 2011-2026, 4,903 team-seasons, leave-one-season-out:
  offense  current 3.095 MAE (r .785) | WA 4.076 (.591) | current + WA 2.989 (.802)
  defense  current 2.964 (.734)       | WA 3.610 (.557) | current + WA 2.949 (.737)
  split (O+D tilt given the true net): current 4.907 | WA 5.007 | both 4.819
=> NOT adopted: the Wins Added split is clearly worse on its own; as an add-on it helps offense a little, defense not at all.

    python3 scripts/backtest_wa_split.py --pull   # refresh player_advanced 2010-2026 into scripts/data/_bt_player_adv.json (gitignored)
    python3 scripts/backtest_wa_split.py
"""
import sys, os
HERE=os.path.dirname(os.path.abspath(__file__)); PA=os.path.join(HERE,'data','_bt_player_adv.json')

if '--pull' in sys.argv or not os.path.exists(PA):
    import json,urllib.request,time
    K='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'; OUT=PA
    rows=[]
    for y in range(2010,2027):
        off=0
        while True:
            u=f'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/player_advanced?season_year=eq.{y}&select=espn_id,season_year,team,g,min,owa,dwa&order=espn_id.asc,team.asc&limit=1000&offset={off}'
            for i in range(4):
                try: r=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'apikey':K}),timeout=60)); break
                except Exception as e: time.sleep(3)
            rows+=r; off+=1000
            if len(r)<1000: break
        print(y,len(rows),flush=True)
    json.dump(rows,open(OUT,'w'))

import json,os,numpy as np,collections
R=os.path.join(HERE,'data')+'/'
pa=json.load(open(PA)); dna=json.load(open(R+'team_dna.json')); prj=json.load(open(R+'team_dna_proj.json'))
by=collections.defaultdict(dict)   # season -> espn -> agg (players can have 2 rows if mid-season move: sum)
for r in pa:
    if r['espn_id'] is None or r['min'] is None: continue
    d=by[r['season_year']].setdefault(r['espn_id'],{'min':0,'owa':0,'dwa':0,'team':r['team']}); d['min']+=r['min'] or 0; d['owa']+=r['owa'] or 0; d['dwa']+=r['dwa'] or 0
roster=collections.defaultdict(list)
for r in pa:
    if r['espn_id'] is None or not r['min']: continue
    roster[(r['season_year'],r['team'])].append((r['espn_id'],r['min']))
rows=[]
for S in range(2011,2027):
    T=dna.get(str(S),{}).get('teams',{}); P=prj.get(str(S),{})
    for team,t in T.items():
        aO=t.get('adjO',t.get('ORtg')); aD=t.get('adjD',t.get('DRtg'))
        if aO is None or aD is None or team not in P: continue
        ro=roster.get((S,team));
        if not ro: continue
        tot=sum(m for _,m in ro); xo=xd=unk=0
        for e,m in ro:
            pv=by[S-1].get(e)
            if pv and pv['min']>=100: xo+=m/tot*pv['owa']*40/pv['min']*1000/40; xd+=m/tot*pv['dwa']*40/pv['min']*1000/40   # per-1000-min rates
            else: unk+=m/tot
        rows.append(dict(S=S,team=team,O=aO,D=aD,pO=P[team]['ORtg'],pD=P[team]['DRtg'],xo=xo,xd=xd,unk=unk))
print('team-seasons',len(rows))
import numpy as np
def center(key):
    m=collections.defaultdict(list)
    for r in rows: m[r['S']].append(r[key])
    mu={s:np.mean(v) for s,v in m.items()}
    for r in rows: r[key+'c']=r[key]-mu[r['S']]
for k in ['O','D','pO','pD','xo','xd','unk']: center(k)
def loso(y,X):
    ys=np.array([r[y] for r in rows]); Xs=np.array([[1]+[r[x] for x in X] for r in rows]); Ss=np.array([r['S'] for r in rows]); pred=np.zeros(len(rows))
    for s in sorted(set(Ss)):
        tr=Ss!=s; b=np.linalg.lstsq(Xs[tr],ys[tr],rcond=None)[0]; pred[~tr]=Xs[~tr]@b
    e=ys-pred; return np.mean(np.abs(e)), np.corrcoef(ys,pred)[0,1]
for side,y,cur,new in [('OFFENSE','Oc',['pOc'],['xoc','unkc']),('DEFENSE','Dc',['pDc'],['xdc','unkc'])]:
    print(side)
    print('  current roster projection     MAE %.3f r %.3f'%loso(y,cur))
    print('  Torvik-style WA (own side)    MAE %.3f r %.3f'%loso(y,new))
    print('  both sides WA                 MAE %.3f r %.3f'%loso(y,['xoc','xdc','unkc']))
    print('  current + WA                  MAE %.3f r %.3f'%loso(y,cur+new))
# split test: given the TRUE net, how well does each method split it into O and D?
print('SPLIT given true net (predict O deviation):')
for r in rows: r['net']=r['Oc']-r['Dc']
print('  current split  MAE %.3f r %.3f'%loso('Oc',['netc' if False else 'pOc','pDc']))
# the split itself: with the TRUE net known, O = (net + level)/2 -> how well does each method predict the level (O+D)?
for r in rows: r['lev']=r['Oc']+r['Dc']; r['plev']=r['pOc']+r['pDc']; r['wlev']=r['xoc']-0.62*r['xdc']
print('LEVEL (offense-vs-defense tilt given the true net):')
print('  current  MAE %.3f r %.3f'%loso('lev',['plev']))
print('  WA share MAE %.3f r %.3f'%loso('lev',['wlev','unkc']))
print('  both     MAE %.3f r %.3f'%loso('lev',['plev','wlev','unkc']))
