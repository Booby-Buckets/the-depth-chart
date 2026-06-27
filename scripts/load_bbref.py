#!/usr/bin/env python3
"""Load bbref.jsonl into bbref_seasons. Run schema_bbref.sql first."""
import os, re, sys, json, time, requests
from pathlib import Path
DATA=Path(__file__).parent/"data"; SB="https://izlqhnxowdhtdofkwrho.supabase.co"
def _key():
    k=os.environ.get("SUPABASE_SERVICE_KEY")
    if k: return k
    f=Path(__file__).parent/"load_supabase.py"          # local-only, holds the service key
    if f.exists():
        m=re.search(r'SB_KEY\s*=\s*"([^"]+)"', f.read_text())
        if m: return m.group(1)
    raise SystemExit("No key: set SUPABASE_SERVICE_KEY or keep load_supabase.py present")
KEY=_key(); H={"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json"}
def main(write=False):
    seen,rows={},[]
    for l in (DATA/"bbref.jsonl").read_text().splitlines():
        try:b=json.loads(l)
        except:continue
        b["season_year"]=b.pop("season",None)
        k=(b["bbref_id"],b["season_year"],b["school_slug"])
        seen[k]=b
    rows=list(seen.values())
    print(f"bbref_seasons: {len(rows)} unique player-seasons")
    if not write: print("DRY RUN — pass --write"); return
    ok=0
    for j in range(0,len(rows),500):
        b=rows[j:j+500]
        r=requests.post(f"{SB}/rest/v1/bbref_seasons?on_conflict=bbref_id,season_year,school_slug",
            headers={**H,"Prefer":"resolution=merge-duplicates,return=minimal"},json=b,timeout=90)
        if r.status_code in (200,201,204): ok+=len(b)
        else: print(f"  ERR {r.status_code}: {r.text[:200]}"); break
        time.sleep(0.05)
    print(f"  wrote {ok}")
if __name__=="__main__": main(write="--write" in sys.argv)
