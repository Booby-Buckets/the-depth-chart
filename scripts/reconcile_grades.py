#!/usr/bin/env python3
"""
reconcile_grades.py — fix stale grades for name-mismatched players.

Some bbref_seasons rows carry a real v4 grade but no espn_id (the bbref name didn't
match the site name — nicknames like "Kevin" vs "Boopie" Miller, Jr./accents, etc.).
Because grade_sync keys on espn_id, those players keep an OLD inflated grade on the
site. This script matches each unlinked-but-graded bbref row to the player_history
player with the same season + stat fingerprint (ppg/apg/mpg/games), links the espn_id
on bbref_seasons, and pushes the v4 grade onto player_history.

  python3 reconcile_grades.py            # DRY RUN — report matches, no writes
  python3 reconcile_grades.py --write    # link espn_ids + update player_history grades
"""
import re, sys, time, requests
from pathlib import Path
from collections import defaultdict

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
K=re.search(r'SB_KEY\s*=\s*"([^"]+)"',(Path(__file__).parent/"load_supabase.py").read_text()).group(1)
H={"apikey":K,"Authorization":f"Bearer {K}"}

def f(v):
    try: return float(v)
    except (TypeError,ValueError): return None

import unicodedata
def _ascii(s):
    # strip accents; salvage common UTF-8 mojibake (e.g. "JosuÃ©" -> "Josue")
    s=str(s or "")
    try: s=s.encode("latin-1").decode("utf-8")
    except Exception: pass
    return "".join(c for c in unicodedata.normalize("NFKD",s) if not unicodedata.combining(c))
def last_name(name):
    toks=re.sub(r"[.\-']"," ",_ascii(name).lower()).split()
    # drop trailing suffixes so "Simmons II"/"Jones Jr" match on the real surname
    while len(toks)>1 and toks[-1] in ("jr","sr","ii","iii","iv","v"): toks.pop()
    return toks[-1] if toks else ""
def same_person(a,b):
    la,lb=last_name(a),last_name(b)
    return bool(la) and (la==lb or la.startswith(lb) or lb.startswith(la))

def fetch_all(tbl, sel, extra=""):
    rows=[]; pg=0
    while True:
        r=requests.get(f"{SB}/rest/v1/{tbl}?{sel}{extra}",
                       headers={**H,"Range-Unit":"items","Range":f"{pg*1000}-{pg*1000+999}"},timeout=90)
        try: j=r.json()
        except Exception: j=None
        if not isinstance(j,list) or not j: break
        rows+=j
        if len(j)<1000: break
        pg+=1
    return rows

def main(write=False):
    # 1) unlinked-but-graded bbref rows (the stale-prone set)
    bb=fetch_all("bbref_seasons","select=bbref_id,season_year,school,player,pos,tdc_grade,pergame",
                 "&espn_id=is.null&tdc_grade=not.is.null")
    print(f"unlinked graded bbref rows: {len(bb):,}")
    seasons=sorted({b["season_year"] for b in bb})

    # 2) player_history stat fingerprints, per season (espn_id known)
    ph_by_fp=defaultdict(list)        # (season, ppg10, apg10) -> [rows]
    ph_count=0
    for yr in seasons:
        rows=fetch_all("player_history",
                       "select=espn_id,name,team,season_year,ppg,apg,mpg,gp,tdc_grade",
                       f"&season_year=eq.{yr}&espn_id=not.is.null")
        for r in rows:
            ppg,apg=f(r.get("ppg")),f(r.get("apg"))
            if ppg is None or apg is None: continue
            ph_by_fp[(yr,round(ppg,1),round(apg,1))].append(r)
            ph_count+=1
    print(f"player_history fingerprints indexed: {ph_count:,} across {len(seasons)} seasons")

    # 3) match each bbref row to a unique player_history row by stat fingerprint
    def matches(b):
        pgd=b.get("pergame") or {}
        ppg,apg=f(pgd.get("pts_per_g")),f(pgd.get("ast_per_g"))
        mpg,gms=f(pgd.get("mp_per_g")),f(pgd.get("games"))
        if ppg is None or apg is None: return []
        cands=ph_by_fp.get((b["season_year"],round(ppg,1),round(apg,1)),[])
        out=[]
        for c in cands:
            cmpg,cg=f(c.get("mpg")),f(c.get("gp"))
            if mpg is not None and cmpg is not None and abs(mpg-cmpg)>0.6: continue
            if gms is not None and cg is not None and abs(gms-cg)>1: continue
            if not same_person(b.get("player"),c.get("name")): continue   # guard stat-collisions
            out.append(c)
        return out

    linkable=[]      # (bbref_row, espn_id)
    ambiguous=0; unmatched=0
    by_player=defaultdict(lambda:{"espn":defaultdict(int),"rows":[]})
    for b in bb:
        m=matches(b)
        ids={c["espn_id"] for c in m}
        if len(ids)==1:
            eid=next(iter(ids)); linkable.append((b,eid,m[0]))
            by_player[b["bbref_id"]]["espn"][eid]+=1
            by_player[b["bbref_id"]]["rows"].append((b,eid,m[0]))
        elif len(ids)>1: ambiguous+=1
        else: unmatched+=1

    # require a player's seasons to agree on ONE espn_id (guards against a single fluke match)
    confirmed=[]   # (bbref_row, espn_id, ph_row)
    for bid,info in by_player.items():
        if not info["espn"]: continue
        best=max(info["espn"].items(),key=lambda kv:kv[1])[0]
        for b,eid,ph in info["rows"]:
            if eid==best: confirmed.append((b,eid,ph))

    players=defaultdict(list)
    for b,eid,ph in confirmed: players[(b["bbref_id"],eid)].append((b,ph))
    print(f"\nmatched rows: {len(confirmed):,} | distinct players: {len(players):,} | ambiguous: {ambiguous} | unmatched(no ESPN row): {unmatched}")

    # show the most impactful fixes (biggest grade drops on the most recent season)
    deltas=[]
    for (bid,eid),lst in players.items():
        b,ph=max(lst,key=lambda x:x[0]["season_year"])
        old=f(ph.get("tdc_grade")); new=f(b.get("tdc_grade"))
        if old is not None and new is not None:
            deltas.append((new-old, b["player"], ph.get("name"), b["season_year"], old, new, b["school"]))
    deltas.sort(key=lambda x:x[0])
    print("\nBIGGEST CORRECTIONS (most recent season per player):")
    print(f"  {'BBREF NAME':22} {'SITE NAME':20} {'SZN':>5} {'OLD':>4} {'NEW':>4} {'Δ':>5}  TEAM")
    for d,bn,sn,yr,old,new,sch in deltas[:25]:
        print(f"  {str(bn)[:22]:22} {str(sn)[:20]:20} {yr:>5} {old:>4.0f} {new:>4.0f} {d:>+5.0f}  {sch}")

    if not write:
        print("\nDRY RUN — pass --write to link espn_ids + push grades")
        return

    # 4a) link espn_id on bbref_seasons (per bbref_id → espn_id)
    link={}
    for (bid,eid),_ in players.items(): link[bid]=eid
    ok=0
    for bid,eid in link.items():
        r=requests.patch(f"{SB}/rest/v1/bbref_seasons?bbref_id=eq.{bid}&espn_id=is.null",
                         headers={**H,"Content-Type":"application/json","Prefer":"return=minimal"},
                         json={"espn_id":eid},timeout=60)
        if r.status_code in (200,204): ok+=1
        time.sleep(0.02)
    print(f"\nlinked espn_id on {ok}/{len(link)} bbref players")

    # 4b) push v4 grade onto the matched player_history rows, grouped by grade value
    upd=defaultdict(list)   # grade -> [(espn_id, season_year)]
    for b,eid,ph in confirmed:
        g=b.get("tdc_grade")
        if g is not None: upd[str(int(g))].append((eid,b["season_year"]))
    wrote=0
    for g,pairs in upd.items():
        # patch per (espn_id, season) — small batches by espn_id list within a season
        by_yr=defaultdict(list)
        for eid,yr in pairs: by_yr[yr].append(eid)
        for yr,eids in by_yr.items():
            for i in range(0,len(eids),200):
                chunk=eids[i:i+200]
                r=requests.patch(f"{SB}/rest/v1/player_history?season_year=eq.{yr}&espn_id=in.({','.join(map(str,chunk))})",
                                 headers={**H,"Content-Type":"application/json","Prefer":"return=minimal"},
                                 json={"tdc_grade":g},timeout=90)
                if r.status_code in (200,204): wrote+=len(chunk)
                time.sleep(0.03)
    print(f"updated player_history grades: {wrote:,} rows")

if __name__=="__main__":
    main(write="--write" in sys.argv)
