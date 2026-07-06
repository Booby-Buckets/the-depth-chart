#!/usr/bin/env python3
"""
scrape_shots.py — shot-location data from ESPN play-by-play.

For every played game we have (games table), fetch ESPN's summary endpoint,
pull the field-goal attempts (excl. free throws) with their x/y coordinate,
shooter espn_id, team_id, made/missed, value (2/3), distance and period, and
upsert into Supabase `shots` (see schema_shots.sql).

Resumable: done game_ids are checkpointed to data/shots_done.json.

Usage:
  python3 scripts/scrape_shots.py                       # seasons 2022-2026, upload
  python3 scripts/scrape_shots.py --seasons 2025 2026   # specific seasons
  python3 scripts/scrape_shots.py --team-id 130 --season 2026 --sample
        # scrape only one team's games -> data/sample_shots.json (no upload; for testing)
"""
import json, os, re, sys, time, urllib.request
from collections import defaultdict

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR={"apikey":KEY,"Authorization":"Bearer "+KEY}
UA="Mozilla/5.0"
SUMMARY="https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=%s"
D=os.path.join(os.path.dirname(__file__),"data")
DONE=os.path.join(D,"shots_done.json")
DELAY=0.35
FT_RE=re.compile(r"free throw",re.I)
DIST_RE=re.compile(r"(\d+)[- ]foot")
AST_RE=re.compile(r"\(([^)]+?)\s+assists?\)",re.I)

def shot_type(txt):
    """Normalize ESPN PBP text to a shot-type bucket. Order matters: the
    specific qualifiers ('floating', 'tip in', 'pullup') must be checked
    before the generic 'jump shot' / 'layup' they contain."""
    t=txt.lower()
    if "tip"      in t: return "tip"
    if "dunk"     in t: return "dunk"
    if "floating" in t or "floater" in t: return "floater"
    if "hook"     in t: return "hook"
    if "pullup"   in t or "pull up" in t or "pull-up" in t: return "pullup"
    if "step back" in t or "stepback" in t or "step-back" in t: return "stepback"
    if "fadeaway" in t or "fade away" in t: return "fadeaway"
    if "layup"    in t or "lay up" in t or "lay-up" in t or "layin" in t or "lay in" in t: return "layup"
    return "jumper"

def sb_get(path):
    req=urllib.request.Request(SB+"/rest/v1/"+path,headers=HDR)
    with urllib.request.urlopen(req,timeout=40) as r: return json.load(r)

def games_for(seasons, team_id=None):
    out=[]
    for y in seasons:
        q="games?select=id,season_year,home_id,away_id&home_score=not.is.null&season_year=eq.%d"%y
        if team_id: q+="&or=(home_id.eq.%d,away_id.eq.%d)"%(team_id,team_id)
        frm=0
        while True:
            req=urllib.request.Request(SB+"/rest/v1/"+q,headers={**HDR,"Range-Unit":"items","Range":"%d-%d"%(frm,frm+999)})
            b=None
            for a in range(5):
                try: b=json.load(urllib.request.urlopen(req,timeout=45)); break
                except Exception: time.sleep(3*(a+1))
            if b is None: b=[]
            out+=b
            if len(b)<1000: break
            frm+=1000
    return out

def fetch(url):
    for a in range(3):
        try:
            req=urllib.request.Request(url,headers={"User-Agent":UA})
            with urllib.request.urlopen(req,timeout=30) as r: return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code==404: return None
            time.sleep(1.5*(a+1))
        except Exception:
            time.sleep(1.5*(a+1))
    return None

def parse_shots(data, game_id, season_year):
    out=[]
    for p in (data.get("plays") or []):
        if not p.get("shootingPlay") or not p.get("coordinate"): continue
        txt=p.get("text") or ""
        if FT_RE.search(txt): continue                       # skip free throws
        c=p["coordinate"]
        ath=(p.get("participants") or [{}])[0].get("athlete") or {}
        dm=DIST_RE.search(txt)
        sv=p.get("scoreValue")
        if not sv: sv=3 if "three" in txt.lower() else 2
        def i(v):
            try: return int(v)
            except Exception: return None
        try: pid=int(p["id"])
        except Exception: continue
        made=bool(p.get("scoringPlay"))
        ast_id=None; ast_name=None
        if made:
            am=AST_RE.search(txt)
            if am:
                ast_name=am.group(1).strip()
                parts=p.get("participants") or []
                if len(parts)>1:
                    ast_id=i((parts[1].get("athlete") or {}).get("id"))
        out.append({"id":pid,"game_id":game_id,"season_year":season_year,
            "espn_id":i(ath.get("id")),"team_id":i((p.get("team") or {}).get("id")),
            "x":c.get("x"),"y":c.get("y"),"made":made,
            "sv":i(sv),"dist":i(dm.group(1)) if dm else None,
            "period":i((p.get("period") or {}).get("number")),
            "stype":shot_type(txt),"ast_id":ast_id,"ast_name":ast_name})
    return out

def upload(rows):
    for i in range(0,len(rows),500):
        chunk=rows[i:i+500]
        req=urllib.request.Request(SB+"/rest/v1/shots?on_conflict=id",
            data=json.dumps(chunk).encode(),method="POST",
            headers={**HDR,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"})
        ok=False
        for a in range(5):
            try: urllib.request.urlopen(req,timeout=90).read(); ok=True; break
            except urllib.error.HTTPError as e: print("  upload http err",e.code,e.read()[:150]); return False
            except Exception as e: print("  upload retry (%s)"%type(e).__name__); time.sleep(3*(a+1))
        if not ok: return False
    return True

def main():
    args=sys.argv[1:]
    sample="--sample" in args
    team_id=None; season=None; seasons=[2022,2023,2024,2025,2026]
    if "--team-id" in args: team_id=int(args[args.index("--team-id")+1])
    if "--season" in args: season=int(args[args.index("--season")+1]); seasons=[season]
    if "--seasons" in args:
        seasons=[int(x) for x in args[args.index("--seasons")+1:] if x.isdigit()]

    games=games_for(seasons, team_id)
    print("games to consider: %d" % len(games))

    if sample:
        allshots=[]
        for i,g in enumerate(games):
            data=fetch(SUMMARY % g["id"])
            if data: allshots+=parse_shots(data,g["id"],g["season_year"])
            time.sleep(DELAY)
            if (i+1)%10==0: print("  %d/%d  (%d shots)"%(i+1,len(games),len(allshots)))
        os.makedirs(D,exist_ok=True)
        json.dump(allshots,open(os.path.join(D,"sample_shots.json"),"w"))
        print("wrote %d shots -> data/sample_shots.json"%len(allshots)); return

    # full backfill w/ checkpoint + incremental upload
    done=set()
    if os.path.exists(DONE):
        try: done=set(json.load(open(DONE)))
        except Exception: done=set()
    buf=[]; pending=[]; n_shots=0; t0=time.time()
    todo=[g for g in games if g["id"] not in done]
    print("remaining: %d (already done: %d)" % (len(todo),len(done)))
    for i,g in enumerate(todo):
        data=fetch(SUMMARY % g["id"])
        if data: buf+=parse_shots(data,g["id"],g["season_year"])
        pending.append(g["id"]); time.sleep(DELAY)
        if len(buf)>=1500 or i==len(todo)-1:
            # only mark games done + clear the buffer if the upload actually succeeds
            if not buf or upload(buf):
                n_shots+=len(buf); buf=[]
                for gid in pending: done.add(gid)
                pending=[]
                json.dump(list(done),open(DONE,"w"))
            # else: keep buf + pending, retry on the next flush (no data/checkpoint loss)
        if (i+1)%200==0:
            el=time.time()-t0; print("  %d/%d games  %d shots  %.0fs  (~%.1f games/s)"%(i+1,len(todo),n_shots,el,(i+1)/max(1,el)))
    print("DONE: %d shots uploaded across %d games"%(n_shots,len(todo)))

if __name__=="__main__": main()
