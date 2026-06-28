#!/usr/bin/env python3
"""Normalize player_history.team to bare school names (e.g. 'Duke Blue Devils' ->
'Duke') so it matches bbref_seasons + the player pages + teams.name. The 2025-26
rows are already bare; this converts the older ESPN-mascot rows."""
import os,re,sys,json,time,urllib.parse,requests
from pathlib import Path
DATA=Path(__file__).parent/"data"; SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY=os.environ.get("SUPABASE_SERVICE_KEY") or re.search(r'SB_KEY\s*=\s*"([^"]+)"',(DATA.parent/"load_supabase.py").read_text()).group(1)
H={"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json"}
def norm(s): return re.sub(r"\s+"," ",re.sub(r"[&.]","",str(s).lower())).strip()
bares=set()
for l in (DATA/"bbref.jsonl").read_text().splitlines():
    try: b=json.loads(l)
    except: continue
    if b.get("school"): bares.add(b["school"])
bare_norm=sorted(((norm(b),b) for b in bares), key=lambda x:-len(x[0]))
def to_bare(team):
    n=norm(team)
    for bn,b in bare_norm:
        if n==bn or n.startswith(bn+" "): return b
    return None
def fetch_all(u):
    r=[]
    while True:
        s=len(r); d=None
        for _ in range(6):
            try: j=requests.get(SB+u,headers={**H,"Range-Unit":"items","Range":f"{s}-{s+999}"},timeout=60).json()
            except Exception: j=None
            if isinstance(j,list): d=j; break
            time.sleep(2)
        if not d: break
        r+=d
    return r
def main(write=False):
    teams={r["team"] for r in fetch_all("/rest/v1/team_seasons?select=team&order=team") if r.get("team")}
    mapping={t:to_bare(t) for t in teams if to_bare(t) and to_bare(t)!=t}
    print(f"{len(teams)} mascot teams -> {len(mapping)} need renaming")
    print("  sample:", list(mapping.items())[:6])
    unmatched=[t for t in teams if not to_bare(t)]
    if unmatched: print(f"  unmatched ({len(unmatched)}):", unmatched[:8])
    if not write: print("DRY RUN — pass --write"); return
    ok=0
    for old,new in mapping.items():
        u=f"{SB}/rest/v1/player_history?team=eq.{urllib.parse.quote(old,safe='')}"
        for _ in range(4):
            try: r=requests.patch(u,headers={**H,"Prefer":"return=minimal"},json={"team":new},timeout=90)
            except Exception: time.sleep(3); continue
            if r.status_code in (200,204): ok+=1; break
            time.sleep(3)
        time.sleep(0.02)
    print(f"  renamed {ok}/{len(mapping)} teams")
if __name__=="__main__": main(write="--write" in sys.argv)
