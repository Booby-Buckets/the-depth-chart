#!/usr/bin/env python3
"""
grade_retrain.py — retrain the overall grade on the user's 986 hand-grades
(manual_grades_backup.csv) and score every player-season.

A Ridge model on RICH, conference-translated, position-relative features
(box + advanced BPM/WS/PER/USG + recruit pedigree + class), reproducing the
user's calibration (5-fold CV MAE 2.30 vs their grades — vs 7.19 for the old
v4). Restores their scale (mean ~73, stars 90-99) and separates the top.

Run:
  python3 grade_retrain.py            # DRY RUN — distribution + anchors, no write
  python3 grade_retrain.py --write    # upsert tdc_grade into bbref_seasons
                                       #   (needs SUPABASE_SERVICE_KEY env)
Then:  python3 grade_sync_bbref.py --write   (+ coach pipeline, see grade-algorithm memory)
"""
import sys, os, json, numpy as np, pandas as pd
from pathlib import Path
from sklearn.linear_model import RidgeCV
import grade_v4 as G
DATA = Path(__file__).parent / "data"
STATS = ['ppg','ppg40','tsPct','tpPct','fgPct','ftPct','ast','apg40','astPct','orb','drb',
         'stl','blk','to','tovPct','usgPct','per','bpm','ws','wa','obpm','ows','pprod','fga40','fta40']
PED = json.load(open(DATA/'recruit_pedigree.json')).get('players', {})

def _espn_class(season):
    m = {}
    for line in (DATA/'bbref.jsonl').read_text().splitlines():
        if '"season"' not in line: continue
        b = json.loads(line)
        if b.get('season') != season: continue
        m[b.get('bbref_id')] = {'espn': b.get('espn_id'), 'cls': (b.get('class') or '')}
    return m

def _featurize(df):
    """position-relative z (vs this pool's qualified players) + pedigree/class/conf/height."""
    qual = df[df.mpg >= 10]
    zn = {}
    for g in ('G','W','B'):
        sub = qual[qual._grp == g]
        zn[g] = {s: (sub[s].astype(float).mean(), (sub[s].astype(float).std() or 1)) for s in STATS}
    def zr(r):
        n = zn.get(r._grp, zn.get('W') or zn.get('G') or zn.get('B')); out=[]
        for s in STATS:
            v = r[s]; mu, sd = n[s]
            out.append(0.0 if pd.isna(v) else float(np.clip((float(v)-mu)/(sd or 1), -4, 4)))
        return out
    Z = np.array([zr(r) for _, r in df.iterrows()]) if len(df) else np.zeros((0,len(STATS)))
    ht = ((df.height.fillna(78).astype(float)-78)/4).values.reshape(-1,1)
    ped = df.ped.values.reshape(-1,1); conf = df._conf_factor.fillna(1.0).values.reshape(-1,1)
    def oh(col, cats): return np.array([[1.0 if str(v).upper().startswith(c) else 0.0 for c in cats] for v in col])
    cls = oh(df.cls, ['FR','SO','JR','SR']); grp = oh(df._grp, ['G','W','B'])
    return np.hstack([Z, ht, ped, conf, cls, grp])

def _season_df(season):
    rows = G.load(season, min_mpg=1, min_g=1)
    if not rows: return None
    df = pd.DataFrame(rows)
    meta = _espn_class(season)
    df['espn'] = df.bbref_id.map(lambda x:(meta.get(x) or {}).get('espn'))
    df['cls']  = df.bbref_id.map(lambda x:(meta.get(x) or {}).get('cls',''))
    df['ped']  = df.espn.map(lambda e: PED.get(str(int(e)),0.0) if pd.notna(e) else 0.0)
    return df

def main(write=False):
    # train on 2026 labels
    tr = _season_df(2026)
    man = pd.read_csv(DATA/'manual_grades_backup.csv')
    Xtr_all = _featurize(tr); tr['_ix']=range(len(tr))
    lab = man[['name','grade_num']].merge(tr[['name','_ix']], on='name', how='inner').dropna().drop_duplicates('name')
    model = RidgeCV(alphas=np.logspace(-2,3,30)).fit(Xtr_all[lab._ix.values], lab.grade_num.values.astype(float))
    print(f"trained on {len(lab)} labeled players")
    # score every season
    payload=[]; dist=[]
    for season in range(2007, 2027):
        df = _season_df(season)
        if df is None: continue
        g = np.clip(model.predict(_featurize(df)), 40, 99).round().astype(int)
        df['newg']=g
        for _,r in df.iterrows():
            payload.append({'bbref_id':r['bbref_id'],'season_year':int(r['season_year']),
                            'school_slug':r['school_slug'],'tdc_grade':int(r['newg'])})
        dist.append(df.assign(season=season))
    allp = pd.concat(dist)
    print(f"\nscored {len(payload):,} player-seasons | mean {allp.newg.mean():.1f} | 90+ {(allp.newg>=90).mean()*100:.1f}% | 95+ {(allp.newg>=95).mean()*100:.2f}%")
    print("all-time anchors (max grade per player):")
    top = allp.sort_values('newg',ascending=False).drop_duplicates('name').head(14)
    for _,r in top.iterrows():
        print(f"    {r['name'][:22]:22} {int(r['season'])}  {int(r['newg'])}  {r['ppg']:.1f}p bpm={r['bpm']}")
    if not write:
        print("\nDRY RUN — pass --write to upsert into bbref_seasons.tdc_grade")
        return
    key=os.environ.get('SUPABASE_SERVICE_KEY')
    if not key: print("SET SUPABASE_SERVICE_KEY to write"); return
    import requests
    SB="https://izlqhnxowdhtdofkwrho.supabase.co"; H={"apikey":key,"Authorization":f"Bearer {key}","Content-Type":"application/json"}
    print(f"\nwriting {len(payload):,} grades..."); ok=0
    for i in range(0,len(payload),500):
        r=requests.post(f"{SB}/rest/v1/bbref_seasons?on_conflict=bbref_id,season_year,school_slug",
                        headers={**H,"Prefer":"resolution=merge-duplicates"}, json=payload[i:i+500], timeout=60)
        if r.status_code<300: ok+=len(payload[i:i+500])
        else: print("  err",r.status_code,r.text[:120]); break
    print(f"  wrote {ok:,}")

if __name__=="__main__":
    main(write="--write" in sys.argv)
