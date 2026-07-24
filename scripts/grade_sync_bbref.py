#!/usr/bin/env python3
"""Push canonical bbref_seasons grades onto players roster + player_history so the
Player Database (roster.html) matches the player pages. Fetches per-season to
avoid deep-offset pagination timeouts."""
import os,re,sys,time,json,requests
from pathlib import Path
from collections import defaultdict
SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY=os.environ.get("SUPABASE_SERVICE_KEY") or re.search(r'SB_KEY\s*=\s*"([^"]+)"',(Path(__file__).parent/"load_supabase.py").read_text()).group(1)
H={"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json"}
def GET(url):
    for _ in range(6):
        try:
            d=requests.get(SB+url,headers=H,timeout=60)
            j=d.json()
            if isinstance(j,list): return j
        except Exception: pass
        time.sleep(2)
    return []
def fetch_season(tbl,yr,sel):
    rows=[]; pg=0
    while True:
        d=requests.get(f"{SB}/rest/v1/{tbl}?{sel}&season_year=eq.{yr}",headers={**H,"Range-Unit":"items","Range":f"{pg*1000}-{pg*1000+999}"},timeout=60)
        try: j=d.json()
        except: j=None
        if not isinstance(j,list) or not j:
            if pg==0 or (isinstance(j,list) and not j): break
            time.sleep(2); continue
        rows+=j
        if len(j)<1000: break
        pg+=1
    return rows
def patch(tbl,pay):
    by=defaultdict(list)
    for r in pay: by[r["tdc_grade"]].append(r["id"])
    ok=0
    for grade,ids in by.items():
        for i in range(0,len(ids),300):
            ch=ids[i:i+300]
            for _ in range(4):
                try: r=requests.patch(f"{SB}/rest/v1/{tbl}?id=in.({','.join(map(str,ch))})",headers={**H,"Prefer":"return=minimal"},json={"tdc_grade":grade},timeout=90)
                except Exception: time.sleep(3); continue
                if r.status_code in (200,204): ok+=len(ch); break
                time.sleep(3)
            time.sleep(0.02)
    print(f"  {tbl}: updated {ok}")
def main(write=False):
    g_by={}; latest={}
    for yr in range(2007,2027):  # include null grades (game-capped) so player_history gets cleared too
        for r in fetch_season("bbref_seasons",yr,"select=espn_id,tdc_grade&espn_id=not.is.null"):
            eid=int(r["espn_id"]); gr=r["tdc_grade"]; gr=int(gr) if gr is not None else None
            g_by[(eid,yr)]=gr
            if gr is not None and (eid not in latest or yr>latest[eid][0]): latest[eid]=(yr,gr)
    print(f"bbref grades: {len(g_by):,} player-seasons, {len(latest):,} players")
    # manual grade overrides (../grade-overrides.json -> by_name): applied to the players
    # (current-roster) grade AFTER the model, for players the v4 model can't grade to the
    # eye without distorting the population (see grade-v4-plan memory). player_history keeps
    # the model grades — the override is only the player's current overall.
    import os
    ov={}
    try:
        ov=json.load(open(os.path.join(os.path.dirname(__file__),os.pardir,"grade-overrides.json"))).get("by_name",{})
    except Exception as e:
        print(f"  (no grade-overrides.json: {e})")
    pl=GET("/rest/v1/players?select=id,espn_id,name&espn_id=not.is.null&order=id&limit=2000")
    pp=[]; n_ov=0
    for p in pl:
        eid=int(p["espn_id"]); nm=p.get("name")
        if nm in ov: pp.append({"id":int(p["id"]),"tdc_grade":str(int(ov[nm]))}); n_ov+=1
        elif eid in latest: pp.append({"id":int(p["id"]),"tdc_grade":str(latest[eid][1])})
    if ov: print(f"  applied {n_ov}/{len(ov)} grade overrides: {', '.join(ov.keys())}")
    hh=[]
    for yr in range(2012,2027):
        for h in fetch_season("player_history",yr,"select=id,espn_id&espn_id=not.is.null"):
            k=(int(h["espn_id"]),yr)
            if k in g_by: hh.append({"id":int(h["id"]),"tdc_grade":(str(g_by[k]) if g_by[k] is not None else None)})
    print(f"players: {len(pp)}/{len(pl)} matched | player_history: {len(hh)} matched")
    if not write: print("DRY RUN — pass --write"); return
    patch("players",pp); patch("player_history",hh)
if __name__=="__main__": main(write="--write" in sys.argv)
