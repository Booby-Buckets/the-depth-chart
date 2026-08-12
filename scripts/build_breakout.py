#!/usr/bin/env python3
"""build_breakout.py — which STYLE archetypes tend to develop into stars (Rich Moss GT paper's
SGA insight: cluster membership as a leading indicator of a breakout).

Pools every player-season 2014..2026, assigns each a style archetype (same features/templates as
build_archetypes.py), then follows each player's career: for a NON-STAR YOUNG player (his first
observed season, grade <= 84), did he reach STAR grade (>= 88) in a later season? The breakout
RATE per young-season archetype is the signal — plus average grade gain and example breakouts.

Output: breakout.json { archetype: {rate, n, avg_gain, star, examples:[{n,from,to}]} }.
Run: python3 scripts/build_breakout.py
"""
import json, os, math, re, urllib.request
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from scipy.optimize import linear_sum_assignment

SB='https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1'
KEY='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'
HERE=os.path.dirname(__file__); K=10
YEARS=list(range(2014,2027))
FEAT=['ht','usg','ast','tp_rate','ft_rate','orb','drb','blk','stl']
YOUNG_MAX=84   # not already a star as a young player
STAR=88        # reached star grade later
# (same templates as build_archetypes.py — keep names in sync)
from importlib import util as _u
_spec=_u.spec_from_file_location('ba', os.path.join(HERE,'build_archetypes.py'))
_ba=_u.module_from_spec(_spec); _spec.loader.exec_module(_ba)
TEMPLATES=_ba.TEMPLATES; COLOR=_ba.COLOR

def q(p):
    r=urllib.request.Request(SB+p,headers={'apikey':KEY,'Authorization':'Bearer '+KEY}); return json.load(urllib.request.urlopen(r,timeout=90))
def qpage(base):   # paginate (Supabase caps 1000/request); stable order required
    rows=[]; off=0
    while True:
        b=q(base+('&' if '?' in base else '?')+'order=espn_id.asc&limit=1000&offset=%d'%off)
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
    rows=[]
    for yr in YEARS:
        adv={str(r['espn_id']):r for r in qpage('/player_advanced?season_year=eq.%d&select=espn_id,usg_pct,ast_pct,orb_pct,drb_pct,blk_pct,stl_pct'%yr) if r.get('espn_id') is not None}
        ph=qpage('/player_history?season_year=eq.%d&select=espn_id,name,height,fga,tpa,fta,mpg,gp,tdc_grade'%yr)
        for r in ph:
            eid=r.get('espn_id')
            if eid is None: continue
            a=adv.get(str(eid))
            if not a: continue
            mpg,gp,fga=f(r.get('mpg')),f(r.get('gp')),f(r.get('fga'))
            g=f(r.get('tdc_grade'))
            if not mpg or not gp or gp<8 or mpg<10 or not fga or fga<2 or g is None: continue
            ff={'usg':f(a.get('usg_pct')),'ast':f(a.get('ast_pct')),
                'tp_rate':(f(r.get('tpa')) or 0)/fga,'ft_rate':(f(r.get('fta')) or 0)/fga,
                'orb':f(a.get('orb_pct')),'drb':f(a.get('drb_pct')),
                'blk':f(a.get('blk_pct')),'stl':f(a.get('stl_pct')),'ht':ht_in(r.get('height'))}
            if any(v is None for v in ff.values()): continue
            rows.append({'e':eid,'name':r['name'],'yr':yr,'g':g,'f':ff})
    print('player-seasons pooled:',len(rows))
    X=np.array([[r['f'][k] for k in FEAT] for r in rows])
    Xs=StandardScaler().fit_transform(X)
    km=KMeans(n_clusters=K,n_init=10,random_state=42).fit(Xs)
    T=np.array([[tpl[1].get(k,0.0) for k in FEAT] for tpl in TEMPLATES])
    cost=np.linalg.norm(km.cluster_centers_[:,None,:]-T[None,:,:],axis=2)
    ri,ci=linear_sum_assignment(cost)
    cname={int(ri[i]):TEMPLATES[int(ci[i])][0] for i in range(len(ri))}
    for i,r in enumerate(rows): r['arch']=cname[int(km.labels_[i])]
    # career trajectories by espn_id
    car={}
    for r in rows: car.setdefault(r['e'],[]).append(r)
    stats={n:{'n':0,'break':0,'gain':0.0,'ex':[]} for n,_ in TEMPLATES}
    for eid,seasons in car.items():
        seasons.sort(key=lambda r:r['yr'])
        first=seasons[0]; later=[s for s in seasons if s['yr']>first['yr']]
        if not later: continue                       # need a later season to observe development
        if first['g']>YOUNG_MAX: continue            # already a star as a young player
        peak=max(s['g'] for s in later)
        A=first['arch']; st=stats[A]
        st['n']+=1; st['gain']+=(peak-first['g'])
        if peak>=STAR:
            st['break']+=1
            st['ex'].append({'n':first['name'],'from':int(first['g']),'to':int(peak)})
    out={'meta':{'years':[YEARS[0],YEARS[-1]],'young_max':YOUNG_MAX,'star':STAR},'archetypes':{}}
    print('\n%-22s %5s %6s %7s'%('archetype','n','break%','avgGain'))
    for n,_ in TEMPLATES:
        s=stats[n]; rate=(s['break']/s['n']) if s['n'] else 0; gain=(s['gain']/s['n']) if s['n'] else 0
        ex=sorted(s['ex'],key=lambda x:-(x['to']-x['from']))[:6]
        out['archetypes'][n]={'rate':round(rate,3),'n':s['n'],'star':s['break'],'avg_gain':round(gain,2),'color':COLOR[n],'examples':ex}
        print('%-22s %5d %5.0f%% %7.1f'%(n,s['n'],rate*100,gain))
    path=os.path.join(HERE,'..','breakout.json')
    json.dump(out,open(path,'w'),separators=(',',':'))
    print('\nwrote',os.path.abspath(path))

if __name__=='__main__':
    main()
