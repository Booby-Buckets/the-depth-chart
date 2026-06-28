#!/usr/bin/env python3
"""Generate 51-breakpoint national percentile tables for advanced + per-40 stats
(same pool as the per-game NAT_PCT: bbref_seasons, mpg>=8). Prints a JS object to
merge into player.html's NAT_PCT."""
import re,requests,json
SB="https://izlqhnxowdhtdofkwrho.supabase.co"
key=re.search(r'SB_KEY\s*=\s*"(sb_secret_[^"]+)"',open("load_supabase.py").read()).group(1)
H={"apikey":key,"Authorization":f"Bearer {key}"}
def g(x):
    try: return float(x)
    except: return None
def fetch(u):
    r=[];s=0
    while True:
        b=requests.get(f"{SB}/rest/v1/{u}",headers={**H,"Range-Unit":"items","Range":f"{s}-{s+999}"},timeout=60).json()
        if not isinstance(b,list) or not b: break
        r+=b;s+=1000
        if len(b)<1000: break
    return r
# advanced keys (in _advanced), per40 keys (in _per40), pergame efg
ADV=["bpm","obpm","dbpm","per","ts_pct","usg_pct","ws","ows","dws","ws_per_40","ast_pct","trb_pct","orb_pct","drb_pct","stl_pct","blk_pct","tov_pct"]
P40=["pts_per_min","trb_per_min","ast_per_min","stl_per_min","blk_per_min","tov_per_min"]
vals={k:[] for k in ADV+P40+["efg_pct"]}
for r in fetch("bbref_seasons?select=pergame,per40,advanced"):
    pg=r.get("pergame") or {}; p4=r.get("per40") or {}; a=r.get("advanced") or {}
    mp=g(pg.get("mp_per_g"))
    if mp is None or mp<8: continue
    for k in ADV:
        v=g(a.get(k))
        if v is not None: vals[k].append(v)
    for k in P40:
        v=g(p4.get(k))
        if v is not None: vals[k].append(v)
    e=g(pg.get("efg_pct"))
    if e is not None: vals["efg_pct"].append(e)
def bps(arr):
    arr=sorted(arr); n=len(arr)
    return [round(arr[min(n-1,int(p/100*n))],3) for p in range(0,101,2)]
out={}
# js key map -> nat_pct key used in metrics
KEYMAP={"pts_per_min":"pts40","trb_per_min":"reb40","ast_per_min":"ast40","stl_per_min":"stl40","blk_per_min":"blk40","tov_per_min":"tov40"}
for k,arr in vals.items():
    if len(arr)<500: continue
    out[KEYMAP.get(k,k)]=bps(arr)
print("// counts:", {k:len(v) for k,v in vals.items() if v})
open("/tmp/nat_adv.json","w").write(json.dumps(out,separators=(',',':')))
print(f"stats: {len(out)} | sample bpm[::10]:", out.get("bpm",[])[::10])
print("ts_pct[::10]:", out.get("ts_pct",[])[::10], "| usg_pct[::10]:", out.get("usg_pct",[])[::10])
