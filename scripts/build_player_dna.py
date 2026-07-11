#!/usr/bin/env python3
"""build_player_dna.py — per player-season statistical fingerprint (the building
block for roster->projected DNA, matchup player-value, and player/team/coach fit).
Rate stats come from bbref_seasons.advanced/pergame (already computed); percentiles
are POSITION-RELATIVE (G/W/B) within the season's rotation pool. v1 = rate
fingerprint; shot diet/quality (from `shots`) is a later enrichment.
Output: scripts/data/player_dna.json  (keyed season -> espn_id)."""
import json, sys, urllib.request, pathlib
from collections import defaultdict
SB="https://izlqhnxowdhtdofkwrho.supabase.co"; K="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H={"apikey":K,"Authorization":"Bearer "+K}
OUT=pathlib.Path(__file__).parent/"data"/"player_dna.json"
def GET(p,to=90): return json.load(urllib.request.urlopen(urllib.request.Request(SB+"/rest/v1/"+p,headers=H),timeout=to))
def f(d,k):
    try:
        v=d.get(k); return float(v) if v not in (None,"") else None
    except: return None
def htin(h):
    import re; m=re.match(r"(\d+)-(\d+)",str(h or "")); return int(m[1])*12+int(m[2]) if m else None

def sweep(S):
    rows=[];off=0
    while True:
        b=GET(f"bbref_seasons?season_year=eq.{S}&espn_id=not.is.null&select=espn_id,player,school,pos,height,pergame,advanced,tdc_grade&order=bbref_id.asc&limit=1000&offset={off}")
        if not b: break
        rows+=b; off+=1000
        if len(b)<1000: break
    print(f"[{S}] {len(rows)} bbref player-seasons",flush=True)
    P={}
    for r in rows:
        adv=r.get("advanced") or {}; pg=r.get("pergame") or {}
        mp=f(pg,"mp_per_g")
        if mp is None: continue
        pos=(r.get("pos") or "").upper(); h=htin(r.get("height"))
        grp = 'B' if ('C' in pos or (h and h>=82)) else ('G' if (pos[:1]=='G' or (h and h<=75)) else 'W')
        fga=f(pg,"fga_per_g") or 0; fg3a=f(pg,"fg3a_per_g")
        fp=dict(name=r.get("player"),school=r.get("school"),pos=pos or "",grp=grp,mpg=round(mp,1),
            tdc_grade=r.get("tdc_grade"),
            usg=f(adv,"usg_pct"), ts=(f(adv,"ts_pct") or 0)*100, bpm=f(adv,"bpm"), obpm=f(adv,"obpm"), dbpm=f(adv,"dbpm"),
            ast_pct=f(adv,"ast_pct"), orb_pct=f(adv,"orb_pct"), drb_pct=f(adv,"drb_pct"), trb_pct=f(adv,"trb_pct"),
            stl_pct=f(adv,"stl_pct"), blk_pct=f(adv,"blk_pct"), tov_pct=f(adv,"tov_pct"),
            pts=f(pg,"pts_per_g"), reb=f(pg,"trb_per_g"), ast=f(pg,"ast_per_g"),
            tpa_rate=round(100*fg3a/fga,1) if (fga and fg3a is not None) else 0,
            ftr=round(100*(f(pg,"fta_per_g") or 0)/fga,1) if fga else 0,
            fg3_pct=(f(pg,"fg3_pct") or 0)*100, efg=(f(pg,"efg_pct") or 0)*100)
        eid=str(r["espn_id"])
        # keep the higher-minutes row if a player appears twice (transfer mid-season is one row anyway)
        if eid not in P or (fp["mpg"] or 0)>(P[eid]["mpg"] or 0): P[eid]=fp
    # position-relative percentiles within the rotation pool (mpg>=10)
    METR={"usg":1,"ts":1,"bpm":1,"ast_pct":1,"orb_pct":1,"drb_pct":1,"trb_pct":1,"stl_pct":1,"blk_pct":1,"tov_pct":-1,"pts":1,"tpa_rate":1,"fg3_pct":1,"ftr":1}
    pool=defaultdict(list)
    for p in P.values():
        if (p["mpg"] or 0)>=10:
            for m in METR:
                if p.get(m) is not None: pool[(p["grp"],m)].append(p[m])
    for k in pool: pool[k].sort()
    import bisect
    for p in P.values():
        pc={}
        for m,dr in METR.items():
            arr=pool.get((p["grp"],m)); v=p.get(m)
            if arr and v is not None:
                r=100*bisect.bisect_left(arr,v)/len(arr); pc[m]=round(r if dr>0 else 100-r)
        p["pct"]=pc
        # light archetype tags from position-relative percentiles
        tags=[]
        if pc.get("blk_pct",0)>=80 and p["grp"]=='B': tags.append("Rim Protector")
        if pc.get("ast_pct",0)>=85: tags.append("Playmaker")
        if pc.get("usg",0)>=85 and pc.get("pts",0)>=80: tags.append("Primary Scorer")
        if pc.get("tpa_rate",0)>=75 and pc.get("fg3_pct",0)>=60: tags.append("Shooter")
        if pc.get("stl_pct",0)>=80: tags.append("Disruptor")
        if pc.get("trb_pct",0)>=85: tags.append("Rebounder")
        if pc.get("ts",0)>=85 and pc.get("usg",0)>=60: tags.append("Efficient Scorer")
        p["tags"]=tags
    return {"players":P,"n_rotation":sum(1 for p in P.values() if (p['mpg'] or 0)>=10)}

data=json.loads(OUT.read_text()) if OUT.exists() else {}
for s in [int(x) for x in sys.argv[1:]] or [2026]:
    data[str(s)]=sweep(s); print(f"[{s}] {len(data[str(s)]['players'])} players, {data[str(s)]['n_rotation']} rotation.",flush=True)
OUT.write_text(json.dumps(data,separators=(',',':')))
print("wrote",OUT,flush=True)
