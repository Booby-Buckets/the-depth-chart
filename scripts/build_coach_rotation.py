#!/usr/bin/env python3
"""
build_coach_rotation.py — each program's PROJECTED ROTATION SHAPE from its current coach's
track record: how many minutes the 1st..10th man gets (shares of 200), how big the rotation is.

  • current coach: teams.head_coach (the roster sheet — an offseason hire counts, the scrape
    doesn't know him yet) → coach_seasons slug (name match, then first-initial+last name)
  • his recent team-seasons (last ROT_YEARS, any school) → player_history rows for that
    team-season → total minutes per player (mpg × gp) → sorted → share of 200 by rank
  • recency-weighted average; shrunk toward the national shape by seasons of evidence
    (1 season = 1/3 weight, 3+ = full); coaches with no history (or unresolved) get the
    national shape. Result is the per-team SLOT table the projection build and the live
    depth-chart engine both use for role minutes.

Writes scripts/data/coach_rotation.json:
  { "_natl": {slots:[10], top5, rot_size, seasons},
    "<short team>": {coach, slug, seasons, slots:[10], top5, rot_size, raw:[10]|null, src:[["Florida",2026],..]} }
Read-only vs the DB.
"""
import json, os, re, sys, urllib.request
from collections import defaultdict

SB="https://izlqhnxowdhtdofkwrho.supabase.co"; KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),"data")
ROT_YEARS=int(os.environ.get("ROT_YEARS","5"))        # seasons of coach history to use
CUR=2026                                                # last completed season
REC_W=[1.0,0.85,0.7,0.55,0.45]                          # recency weights (most recent first)
SHRINK_N=float(os.environ.get("ROT_SHRINK_N","3"))     # seasons for full confidence

def get(path):
    out=[]; off=0
    while True:
        req=urllib.request.Request(f"{SB}/rest/v1/{path}{'&' if '?' in path else '?'}offset={off}&limit=1000",headers=H)
        rows=json.load(urllib.request.urlopen(req)); out+=rows
        if len(rows)<1000: return out
        off+=1000

norm=lambda s:re.sub(r"[^a-z0-9]","",(s or "").lower())
def il(s):
    p=re.sub(r"[^a-z ]"," ",(s or "").lower()).split()
    return (p[0][0]+"|"+p[-1]) if len(p)>=2 else None

print("Pulling teams, coach seasons, player history...",file=sys.stderr)
teams=get("teams?select=name,head_coach,coach")
seas=json.load(open(os.path.join(D,"coach_seasons.json")))
# sheet spellings / nicknames that the scrape writes differently
NAME_FIX={"pennyhardaway":"anfernee hardaway","ericmussleman":"eric musselman","markmasden":"mark madsen","philmarteli":"phil martelli"}
clean=lambda s: re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?","",(s or "").lower()).strip()
byName={}; byIL=defaultdict(set); lastYr={}
for s in seas:
    if s.get("coach") and s.get("coach_slug"):
        sl=s["coach_slug"]; lastYr[sl]=max(lastYr.get(sl,0),s.get("season_year",0))
        byName.setdefault(norm(clean(s["coach"])),set()).add(sl)
        k=il(clean(s["coach"]))
        if k: byIL[k].add(sl)
def resolve(hc):
    """sheet head-coach name -> slug (exact, fixed spelling, first-initial+last); a duplicate
    name (father/son) goes to the one who coached most recently"""
    if not hc: return None
    q=norm(clean(hc)); q=norm(NAME_FIX.get(q,q))
    cands=byName.get(q)
    if not cands:
        k=il(clean(hc)); cands=byIL.get(k) if k else None
        if not cands:
            import difflib
            m=difflib.get_close_matches(q,list(byName.keys()),n=1,cutoff=0.88)
            cands=byName.get(m[0]) if m else None
    if not cands: return None
    return max(cands,key=lambda sl:lastYr.get(sl,0))
# player_history for the recent seasons: team, season, mpg, gp (stable order → no page drops)
hist=defaultdict(list)   # (team_short, year) -> [minutes]
for yr in range(CUR-ROT_YEARS+1, CUR+1):
    rows=get(f"player_history?select=team,season_year,mpg,gp&season_year=eq.{yr}&order=id.asc")
    for r in rows:
        m=(r.get("mpg") or 0)*(r.get("gp") or 0)
        if m>0: hist[(r["team"],yr)].append(m)
    print(f"  {yr}: {len(rows)} rows",file=sys.stderr)
ph_teams={t for (t,_) in hist}
# bbref school -> player_history short name (exact, else the sheet's short-name prefix of an ESPN alias)
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
try:
    from build_coach_profiles import ALIAS
except Exception:
    ALIAS={}
def short_of(school):
    if school in ph_teams: return school
    full=ALIAS.get(school)
    if full:
        cands=[t for t in ph_teams if full.lower().startswith(t.lower()+" ") or full.lower()==t.lower()]
        if cands: return max(cands,key=len)
    s2=re.sub(r"\s*\(.*\)$","",school)
    if s2 in ph_teams: return s2
    return None

def shape(mins):
    """minutes list for one team-season -> shares of 200 by rank (10 slots)"""
    v=sorted(mins,reverse=True); tot=sum(v) or 1
    sh=[200.0*x/tot for x in v][:10]
    return sh+[0.0]*(10-len(sh))

# national shape (all team-seasons, equal weight)
allsh=[shape(v) for v in hist.values() if sum(v)>0 and len(v)>=7]
natl=[sum(s[i] for s in allsh)/len(allsh) for i in range(10)]
rot_of=lambda sl: sum(1 for x in sl if x>=10.0)
print("national shape:",[round(x,1) for x in natl],"top5 %.0f"%sum(natl[:5]),file=sys.stderr)

# coach -> recent team-seasons
coach_ts=defaultdict(list)
for s in seas:
    if s.get("coach_slug") and s.get("season_year",0)>CUR-ROT_YEARS:
        coach_ts[s["coach_slug"]].append((s["school"],s["season_year"]))

out={"_natl":{"slots":[round(x,1) for x in natl],"top5":round(sum(natl[:5]),1),"rot_size":rot_of(natl),"seasons":len(allsh)}}
unres=[]; nohist=[]
for t in teams:
    name=t.get("name"); hc=(t.get("head_coach") or t.get("coach") or "").strip()
    if not name: continue
    slug=resolve(hc)
    rec={"coach":hc or None,"slug":slug,"seasons":0,"slots":out["_natl"]["slots"],"top5":out["_natl"]["top5"],"rot_size":out["_natl"]["rot_size"],"raw":None,"src":[]}
    if slug:
        ts=sorted(coach_ts.get(slug,[]),key=lambda x:-x[1])
        shapes=[]; src=[]
        for school,yr in ts:
            sh=short_of(school)
            if not sh: continue
            mins=hist.get((sh,yr))
            if not mins or len(mins)<7: continue
            shapes.append(shape(mins)); src.append([sh,yr])
        if shapes:
            w=[REC_W[i] if i<len(REC_W) else 0.4 for i in range(len(shapes))]; W=sum(w)
            raw=[sum(w[j]*shapes[j][i] for j in range(len(shapes)))/W for i in range(10)]
            k=min(1.0,len(shapes)/SHRINK_N)
            sl=[natl[i]+(raw[i]-natl[i])*k for i in range(10)]
            rec.update(seasons=len(shapes),slots=[round(x,1) for x in sl],top5=round(sum(sl[:5]),1),rot_size=rot_of(sl),raw=[round(x,1) for x in raw],src=src)
        else: nohist.append((name,hc))
    else: unres.append((name,hc))
    out[name]=rec
json.dump(out,open(os.path.join(D,"coach_rotation.json"),"w"),separators=(",",":"))
n=len(out)-1; withh=sum(1 for k,v in out.items() if k!="_natl" and v["seasons"])
print(f"Wrote coach_rotation.json: {n} teams, {withh} with coach history, {len(nohist)} coaches with no usable seasons, {len(unres)} unresolved names",file=sys.stderr)
if unres: print("  unresolved:",", ".join(f"{a} ({b or '—'})" for a,b in unres[:25]),file=sys.stderr)
top=sorted(((v["top5"],k,v["coach"],v["seasons"]) for k,v in out.items() if k!="_natl" and v["seasons"]),reverse=True)
print("  heaviest starters:",[(k,c,t) for t,k,c,s in top[:5]],file=sys.stderr)
print("  deepest benches:  ",[(k,c,t) for t,k,c,s in top[-5:]],file=sys.stderr)
