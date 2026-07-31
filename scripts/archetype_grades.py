#!/usr/bin/env python3
"""archetype_grades.py — PROTOTYPE of the expectation-relative player rating.

Methodology (per user 2026-07-30):
  1. Player profile = position + height + minutes.
  2. Expected production for that profile, learned from 20 yrs of history:
     expected per-40 rate for each stat as a function of (position, height).
  3. Relative score = (actual − expected) / spread — how unusual for his type.
  4. Category scores (Scoring/Creation/Efficiency/Defense/Rebounding/Shooting/
     Versatility) built from those RELATIVE numbers, not raw stats.
  5. Weighted → 1-100 rating.
The "archetype bonus" (small guard who rebounds, big who shoots) falls out for
free: those players sit far above their positional baseline on that stat.
"""
import urllib.request, json, re, math
import numpy as np

KEY='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'; SB='https://izlqhnxowdhtdofkwrho.supabase.co'
HDR={'apikey':KEY,'Authorization':'Bearer '+KEY}

def get(path, cols):
    rows, frm = [], 0
    while True:
        req=urllib.request.Request(SB+"/rest/v1/"+path+"&select="+cols,
            headers={**HDR,'Range-Unit':'items','Range':'%d-%d'%(frm,frm+999)})
        b=json.load(urllib.request.urlopen(req,timeout=90)); rows+=b
        if len(b)<1000: break
        frm+=1000
    return rows

def ht_in(h):
    if not isinstance(h,str): return None
    m=re.match(r'^\s*(\d)\s*-\s*(\d{1,2})\s*$',h); return int(m.group(1))*12+int(m.group(2)) if m else None

def npos(p):
    p=(p or '').upper().replace('0','').strip()
    if p in ('PG','G'): return 'PG'
    if p in ('SG','CG'): return 'SG'
    if p in ('SF','F','GF'): return 'SF'
    if p in ('PF','FC'): return 'PF'
    if p=='C': return 'C'
    if p.startswith('G'): return 'SG'
    if p.startswith('C'): return 'C'
    return 'SF'

def num(v):
    try: return float(v)
    except: return None

# per-40 rate stats we model an expectation for (counting stats)
RATE=['rpg','oreb','dreb','apg','stl','blk','tpa','fga','fta','tovs','ppg']
# efficiency stats (compared to position, height less relevant)
EFF=['fg_pct','tp_pct','ft_pct']

def per40(r, k):
    m=num(r.get('mpg')); v=num(r.get(k))
    if m is None or m<1 or v is None: return None
    return v*40.0/m

def load_reference():
    rows=get("player_history?mpg=gte.10&height=not.is.null&gp=gte.5",
             "position,height,mpg,ppg,rpg,apg,stl,blk,tpa,fga,fta,tovs,oreb,dreb,fg_pct,tp_pct,ft_pct")
    pop=[]
    for r in rows:
        h=ht_in(r.get('height'));
        if h is None: continue
        pop.append({'pos':npos(r.get('position')),'ht':h,
                    **{k:per40(r,k) for k in RATE},
                    **{k:num(r.get(k)) for k in EFF}})
    return pop

def fit_expectations(pop):
    """expected[pos][stat] = (poly coeffs over height, residual std)."""
    exp={}
    for pos in ['PG','SG','SF','PF','C']:
        sub=[p for p in pop if p['pos']==pos]
        exp[pos]={}
        for stat in RATE+EFF:
            xs=np.array([p['ht'] for p in sub if p.get(stat) is not None])
            ys=np.array([p[stat] for p in sub if p.get(stat) is not None])
            if len(xs)<50:
                exp[pos][stat]=(np.array([float(np.mean(ys)) if len(ys) else 0.0]), float(np.std(ys)) if len(ys)>1 else 1.0)
                continue
            # quadratic height fit (rate vs height within position)
            coef=np.polyfit(xs,ys,2)
            resid=ys-np.polyval(coef,xs)
            exp[pos][stat]=(coef, float(np.std(resid)) or 1.0)
    return exp

def expected(exp,pos,ht,stat):
    coef,sd=exp[pos][stat]; return float(np.polyval(coef,ht)), sd

def rel(exp,pos,ht,stat,actual):
    if actual is None: return 0.0
    e,sd=expected(exp,pos,ht,stat); return (actual-e)/ (sd or 1.0)

if __name__=='__main__':
    print("loading 20yr reference population…")
    pop=load_reference(); print("  qualified seasons:",len(pop))
    exp=fit_expectations(pop)

    # ── VALIDATION 1: the user's rebounding example ──
    print("\n== Expected RPG (per-40) by profile ==")
    for pos,ht,lbl in [('PG',74,"6'2\" PG"),('PF',81,"6'9\" PF"),('C',84,"7'0\" C"),('SG',77,"6'5\" SG")]:
        e,sd=expected(exp,pos,ht,'rpg'); print(f"  {lbl:9s} expected {e:4.1f}/40  (spread {sd:.1f})")

    # ── VALIDATION 2: archetype outliers get rewarded ──
    print("\n== 'Unusual for his type' — relative z-scores ==")
    tests=[("6'2\" PG, 7 RPG",'PG',74,'rpg',7.0),
           ("6'9\" PF, 7 RPG",'PF',81,'rpg',7.0),
           ("6'2\" G, 1.5 BLK",'PG',74,'blk',1.5),
           ("6'10\" C, 1.5 BLK",'C',82,'blk',1.5),
           ("6'8\" wing, 6 APG",'SF',80,'apg',6.0),
           ("6'11\" C, 5 3PA",'C',83,'tpa',5.0)]
    for lbl,pos,ht,stat,val in tests:
        e,sd=expected(exp,pos,ht,stat)
        print(f"  {lbl:18s} actual {val:4.1f}/40  expected {e:4.1f}  →  {rel(exp,pos,ht,stat,val):+.2f} z (unusual = high)")

# ── FULL RATING (category rollup) ────────────────────────────────────────────
def ts_of(r):
    ppg=num(r.get('ppg')); fga=num(r.get('fga')); fta=num(r.get('fta'))
    if not ppg or fga is None: return None
    den=2*((fga or 0)+0.44*(fta or 0));  return (ppg/den*100) if den>0 else None

WEIGHTS={'Scoring':0.20,'Creation':0.20,'Efficiency':0.15,'Defense':0.20,'Rebounding':0.10,'Shooting':0.10,'Versatility':0.05}

def rate_player(exp, r):
    pos=npos(r.get('position')); ht=ht_in(r.get('height'))
    if ht is None: return None
    def rz(stat, actual): return rel(exp,pos,ht,stat,actual)
    p40={k:per40(r,k) for k in RATE}
    cats={}
    cats['Scoring']    = rz('ppg', p40['ppg'])
    cats['Creation']   = 0.6*rz('apg',p40['apg']) + 0.4*(-rz('tovs',p40['tovs']))
    ts=ts_of(r); cats['Efficiency'] = rz('fg_pct',num(r.get('fg_pct'))) if ts is None else (rz('fg_pct',num(r.get('fg_pct')))*0.5 + ((ts-54)/6)*0.5)
    cats['Defense']    = 0.5*rz('stl',p40['stl']) + 0.5*rz('blk',p40['blk'])
    cats['Rebounding'] = 0.5*rz('oreb',p40['oreb']) + 0.5*rz('dreb',p40['dreb'])
    cats['Shooting']   = 0.5*rz('tpa',p40['tpa']) + 0.5*rz('tp_pct',num(r.get('tp_pct')))
    above=[c for c in ['Scoring','Creation','Defense','Rebounding','Shooting'] if cats[c]>0.75]
    cats['Versatility']= (len(above)-1)*0.7
    z=sum(WEIGHTS[c]*cats[c] for c in WEIGHTS)
    # minutes/role scaler: full production only counts if he's actually on the floor
    m=num(r.get('mpg')) or 0; role=min(1.0, m/26.0)
    rating=72 + 7.5*z*role
    return max(40,min(99,round(rating))), cats, z

if __name__=='__main__' and '--rate' in __import__('sys').argv:
    pop=load_reference(); exp=fit_expectations(pop)
    cur=get("players?tdc_grade=not.is.null&mpg=gte.12&gp=gte.20&height=not.is.null",
            "name,team,position,height,mpg,gp,ppg,rpg,apg,stl,blk,tpa,fga,fta,tovs,oreb,dreb,fg_pct,tp_pct,ft_pct,tdc_grade")
    out=[]
    for r in cur:
        res=rate_player(exp,r)
        if res: out.append((res[0],r,res[1]))
    out.sort(key=lambda x:-x[0])
    print("\n== PROTOTYPE archetype rating — top 20 ==")
    for rt,r,cats in out[:20]:
        print(f"  {rt}  {r['name'][:20]:20s} {r['team'][:14]:14s} {npos(r['position'])} {r['height']}  (old grade {r['tdc_grade']})")
    print("\n== David Mirkovic — category breakdown (relative z) ==")
    for rt,r,cats in out:
        if r['name']=='David Mirkovic':
            print(f"  rating {rt}  (old grade {r['tdc_grade']})")
            for c in WEIGHTS: print(f"    {c:12s} {cats[c]:+.2f}  (weight {int(WEIGHTS[c]*100)}%)")
            break
