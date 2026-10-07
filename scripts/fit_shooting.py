#!/usr/bin/env python3
"""Refit the projection shooting model (FG%/3P%/FT%) used by build_stat_overall_projected.py (SHOOT dict).
Pulls player_history 2011+, pairs each player-season with the next, maps Sports-Reference team names to the
team_seasons Power Rating (centered per season on the D-I mean) for the transfer level jump, then fits
  next% = c + b_eb*career-shrunk rate + b_last*last + b_mix*career 3PA share [+ FG: level jump, ln usage]
weighted by next-season attempts, grid-searching the shrink K. Prints the coefficients to paste into SHOOT.
    python3 scripts/fit_shooting.py   (needs scripts/data/games.jsonl + team_seasons.jsonl)"""
import os, sys, tempfile
S = tempfile.mkdtemp() + "/"
SB="https://izlqhnxowdhtdofkwrho.supabase.co"; KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
def g(p,order):
    out=[];off=0
    while True:
        r=urllib.request.Request(SB+"/rest/v1/"+p+f"&order={order}&offset={off}&limit=1000",headers={"apikey":KEY,"Authorization":"Bearer "+KEY}); b=json.load(urllib.request.urlopen(r,timeout=120)); out+=b
        if len(b)<1000: return out
        off+=1000
ph=g("player_history?select=espn_id,season_year,team,gp,mpg,ppg,fgm,fga,tpm,tpa,ftm,fta,fg_pct,tp_pct,ft_pct&season_year=gte.2011&espn_id=not.is.null","espn_id,season_year,team")
print(len(ph))
pickle.dump(ph,open(S+"ph.pkl","wb"))
ph=pickle.load(open(S+'ph.pkl','rb'))
D='scripts/data/'
exec(open('scripts/build_team_needs.py').read().split('RATING_ALIAS')[0].split('SR_ALIAS=',1)[0][-0:] if False else '')
src=open('scripts/build_team_needs.py').read()
ns={}; exec(src[src.index('SR_ALIAS='):src.index('RATING_ALIAS')],ns); HIST=ns['HIST_ALIAS']
ng=collections.Counter()
for l in open(D+'games.jsonl'):
    g=json.loads(l); ng[(g['home'],g['season'])]+=1; ng[(g['away'],g['season'])]+=1
raw={}
for l in open(D+'team_seasons.jsonl'):
    r=json.loads(l); y=r.get('season_year') or r.get('season')
    if r.get('srs') is not None: raw[(r['team'],y)]=float(r['srs'])
d1=collections.defaultdict(list)
for k,v in raw.items():
    if ng[k]>=20: d1[k[1]].append(v)
mu={y:st.mean(v) for y,v in d1.items()}
srs={k:v-mu.get(k[1],0) for k,v in raw.items()}
FULL=sorted({k[0] for k in raw})
norm=lambda s:re.sub(r'[^a-z0-9]','',s.lower().replace('saint','st').replace('state','st'))
cache={}
def full_of(sr):
    if sr in cache: return cache[sr]
    n=HIST.get(sr,sr); c=[f for f in FULL if f.startswith(n+' ')]
    if not c:
        k=norm(n); c=[f for f in FULL if norm(f).startswith(k) and len(norm(f))-len(k)<=14]
    c=sorted(c,key=len); cache[sr]=c[0] if c else None; return cache[sr]
names=collections.Counter(r['team'] for r in ph)
res=sum(c for t,c in names.items() if full_of(t))
print('mapped share',round(res/sum(names.values()),3))
f=lambda x: float(x) if x not in (None,'') else None
P=collections.defaultdict(dict)
for r in ph:
    e,y=r['espn_id'],r['season_year']; gp=f(r['gp']) or 0
    if gp<=0: continue
    rec={k:(f(r[k]) or 0)*gp for k in ('fgm','fga','tpm','tpa','ftm','fta')}
    rec['min']=(f(r['mpg']) or 0)*gp; rec['gp']=gp; rec['team']=r['team']
    if y in P[e]:
        o=P[e][y]
        for k in ('fgm','fga','tpm','tpa','ftm','fta','min','gp'): o[k]+=rec[k]
    else: P[e][y]=rec
X=[]
for e,ss in P.items():
    ys=sorted(ss)
    for y in ys:
        if y+1 not in ss: continue
        a,b=ss[y],ss[y+1]
        if a['gp']<10 or b['gp']<10 or a['min']/a['gp']<10 or b['min']/b['gp']<10: continue
        fo,fn=full_of(a['team']),full_of(b['team'])
        lo=srs.get((fo,y)) if fo else None; ln=srs.get((fn,y)) if fn else None
        if lo is None or ln is None: continue
        prev=[ss[z] for z in ys if z<y]
        X.append(dict(a=a,b=b,y=y,xfer=a['team']!=b['team'],lo=lo,ln=ln,prev=prev,ns=len(prev)))
print('pairs with levels',len(X),'transfers',sum(x['xfer'] for x in X))
pickle.dump(X,open(S+'pairs2.pkl','wb'))
X=pickle.load(open(S+'pairs2.pkl','rb'))
def pct(r,m,a): return 100*r[m]/r[a] if r[a]>0 else None
out={}
for nm,m,a,minatt,prior,uselev in [('FG','fgm','fga',100,45.0,True),('3P','tpm','tpa',60,34.5,False),('FT','ftm','fta',40,71.0,False)]:
    rows=[x for x in X if x['a'][a]>=minatt and x['b'][a]>=minatt]
    def feats(x,K):
        A,B=x['a'],x['b']
        allp=x['prev']+[A]
        pm=sum(p[m] for p in allp); pa=sum(p[a] for p in allp)
        eb=100*(pm+K*prior/100)/(pa+K); last=pct(A,m,a)
        rate=sum(p['tpa'] for p in allp)/max(1,sum(p['fga'] for p in allp))   # career 3PA share = shot mix / player type
        f=[eb,last,rate]
        if uselev:
            u_a=A['fga']/max(A['min'],1)*40; u_b=B['fga']/max(B['min'],1)*40
            f+= [max(-15,min(15,x['ln']-x['lo'])) if x['xfer'] else 0.0, np.log(max(u_b,0.5)/max(u_a,0.5))]
        return f
    best=None
    Y=np.array([pct(x['b'],m,a) for x in rows]); W=np.array([x['b'][a] for x in rows]); w=np.sqrt(W)
    for K in [25,50,75,100,150,200,300,450,600,800]:
        F=np.array([feats(x,K) for x in rows]); A_=np.c_[np.ones(len(F)),F]
        b=np.linalg.lstsq(A_*w[:,None],Y*w,rcond=None)[0]; mae=np.average(np.abs(Y-A_@b),weights=W)
        if best is None or mae<best[0]: best=(mae,K,b)
    mae,K,b=best
    names=['const','career_eb','last','3PA_share']+(['jump/pt','ln_usage'] if uselev else [])
    print(nm,'K',K,'MAE',round(mae,3),dict(zip(names,[round(v,4) for v in b])))
    out[nm]=dict(K=K,prior=prior,b=[float(v) for v in b])
json.dump(out,open(S+'shoot_model2.json','w'),indent=1)
