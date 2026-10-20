"""Residual test of the roster offensive Wins Added add-on on top of the calibrated offense model (Oct 20 2026; adopted in
calibrate_projected_dna.py as OWA_B). Needs scripts/data/player_dna.json (local, gitignored) and _bt_player_adv.json
(python3 scripts/backtest_wa_split.py --pull). Run from the repo root: python3 scripts/backtest_owa_addon.py
"""
# Offense add-on test on top of the CALIBRATED model (owner weights + coach value-added + playmaker), LOSO by season.
import json, os, sys, numpy as np, collections
R=os.path.dirname(os.path.abspath(__file__))+'/'
src=open(R+'calibrate_projected_dna.py').read()
src=src[:src.index("used = {0: 0, 1: 0, 2: 0}")]          # everything up to applying it to 2027 (no writes)
ns={'__file__':R+'calibrate_projected_dna.py'}; sys.argv=['x']; exec(compile(src,'calib','exec'),ns)
HP,mA,mP,adjdev,hist,COACH_AT,SCALE,ROSTER_W,_ores,OVA_B,PLAY_B,OVA_K,OVA_BACK,_MINS=[ns[k] for k in 'HP mA mP adjdev hist COACH_AT SCALE ROSTER_W _ores OVA_B PLAY_B OVA_K OVA_BACK _MINS'.split()]
PD=json.load(open(R+'data/player_dna.json'))
pa=json.load(open(R+'data/_bt_player_adv.json'))
prev=collections.defaultdict(dict)
for r in pa:
    if r['espn_id'] is None or not r['min']: continue
    d=prev[r['season_year']].setdefault(str(r['espn_id']),[0,0,0]); d[0]+=r['min']; d[1]+=r['owa'] or 0; d[2]+=r['dwa'] or 0
def coach_va_h(coach,y):
    if not coach: return 0.0
    v=[ns['_ores'][(coach,yy)] for yy in range(y-OVA_BACK,y) if (coach,yy) in ns['_ores']]
    return (sum(v)/len(v))*len(v)/(len(v)+OVA_K) if v else 0.0
rows=[]
for s,teams in HP.items():
    if s not in mA: continue
    y=int(s); PDp=PD.get(str(y-1),{}).get('players',{})
    for k,v in teams.items():
        yo=adjdev(s,k,0)
        if yo is None: continue
        h=hist(s,k,COACH_AT.get((y,k)))
        a,b=SCALE[0]; roster=a+b*(v['ORtg']-mP[s][0]); hs=[x for x in (h[0],h[2]) if x is not None]
        base=ROSTER_W[0]*roster+(1-ROSTER_W[0])*(sum(hs)/len(hs)) if hs else roster
        mins=_MINS.get((k,y)) or {}
        if not mins: continue
        tot=sum(mins.values()) or 1
        best=None; owa=obpm=unk=0.0
        for pid,m in mins.items():
            q=PDp.get(str(pid))
            if q and (q.get('mpg') or 0)>=15 and q.get('ast_pct') is not None: best=q['ast_pct'] if best is None else max(best,q['ast_pct'])
            pv=prev[y-1].get(str(pid))
            if pv and pv[0]>=100: owa+=m/tot*pv[1]*1000/pv[0]
            else: unk+=m/tot
            if q and q.get('obpm') is not None and (q.get('mpg') or 0)>=5: obpm+=m/tot*q['obpm']
        pm=(best-25)/10 if best is not None else 0.0
        pred=base+OVA_B*coach_va_h(COACH_AT.get((y,k)),y)+PLAY_B*pm
        rows.append(dict(S=y,res=yo-pred,owa=owa,obpm=obpm,unk=unk,y=yo,pred=pred))
print('rows',len(rows))
def cen(key):
    m=collections.defaultdict(list)
    for r in rows: m[r['S']].append(r[key])
    mu={s:np.mean(v) for s,v in m.items()}
    for r in rows: r[key+'c']=r[key]-mu[r['S']]
for k in ('owa','obpm','unk'): cen(k)
def loso(X):
    S=np.array([r['S'] for r in rows]); Y=np.array([r['res'] for r in rows]); A=np.array([[1]+[r[x] for x in X] for r in rows]); p=np.zeros(len(Y)); better=0
    for s in np.unique(S):
        tr=S!=s; c=np.linalg.lstsq(A[tr],Y[tr],rcond=None)[0] if X else np.array([np.mean(Y[tr])]); p[~tr]=A[~tr][:, :len(c)]@c
        if np.mean(abs(Y[~tr]-p[~tr]))<np.mean(abs(Y[~tr]-np.mean(Y[tr]))): better+=1
    full=np.linalg.lstsq(A,Y,rcond=None)[0]
    return np.mean(abs(Y-p)), better, len(np.unique(S)), np.round(full,3)
print('calibrated model alone (intercept only)  MAE %.3f'%loso([])[0])
for X in (['owac'],['owac','unkc'],['obpmc'],['obpmc','owac']):
    m,b,n,c=loso(X); print('+',X,'MAE %.3f  better in %d/%d seasons  coefs %s'%(m,b,n,c))
