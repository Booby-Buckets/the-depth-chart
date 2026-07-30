#!/usr/bin/env python3
"""
build_team_needs.py — per-team positional need + context for the Portal Fit tool.

For every team that has a real projected roster (the `players` table, ~79 high-
major/notable programs), emits:
  - per-position strength: best grade, starter grade+name, 2nd-best, depth count
    (PG/SG/SF/PF/C, slotted from listed position + height)
  - projected rank / rating / conference (from predictive_ratings, season 2027)
  - current coach slug/name/archetype (coach_seasons + coach_profiles)

Output: scripts/data/team_needs.json  { generated_for, teams:[...] }.
The client fit engine (tdc-portalfit.js) joins this with a player's archetype to
score need / team-success / player-success / coaching fit per team.
"""
import json, os, re, urllib.request
from collections import defaultdict

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(__file__),"data")

def get_all(path):
    rows,frm=[],0
    while True:
        req=urllib.request.Request(SB+"/rest/v1/"+path,headers={**HDR,"Range-Unit":"items","Range":"%d-%d"%(frm,frm+999)})
        b=json.load(urllib.request.urlopen(req,timeout=90)); rows+=b
        if len(b)<1000: break
        frm+=1000
    return rows

def norm(s): return re.sub(r"[^a-z0-9]","",(s or "").lower())
def htin(h):
    m=re.match(r"(\d+)\D+(\d+)", h or ""); return (int(m.group(1))*12+int(m.group(2))) if m else 0

POS=['PG','SG','SF','PF','C']
def slot(pos, h):
    p=(pos or '').upper().strip()
    if p=='PG': return 'PG'
    if p in ('SG','CG'): return 'SG'
    if p in ('SF','GF'): return 'SF'
    if p=='PF': return 'PF'
    if p=='C': return 'C'
    if p=='G': return 'PG' if (h and h<=74) else 'SG'
    if p=='F': return 'PF' if (h and h>=80) else 'SF'
    h=h or 78
    return 'PG' if h<=73 else 'SG' if h<=77 else 'SF' if h<=80 else 'PF' if h<=83 else 'C'

# ── forward-looking projected grade (mirror of tdc-projgrade.js gradeSolo) ─────────
# so the portal's "best grade at each spot" / upgrade math uses the SAME OVR the
# player/team pages show. Coupled override keyed by players.id; else a class-based
# development bump; incoming freshmen (no prior minutes) keep their editor OVR.
try:
    _COUPLED = (json.load(open(os.path.join(D,"player_coupled_grades.json"))) or {}).get("grades",{})
except Exception: _COUPLED = {}
try:
    _DEV = (json.load(open(os.path.join(D,"dev_curves.json"))) or {}).get("bpm_delta",{})
except Exception: _DEV = {}
try:
    _BR = (json.load(open(os.path.join(D,"projgrade_bridge.json"))) or {}).get("b",1.174)
except Exception: _BR = 1.174
try:
    _VERS = (json.load(open(os.path.join(D,"versatility_adj.json"))) or {}).get("bumps",{})
except Exception: _VERS = {}
def _vers_of(p):
    e = p.get('espn_id')
    if e is None: return 0.0
    try: return float(_VERS.get(str(e), 0) or 0)
    except (TypeError, ValueError): return 0.0
def _cls_trans(yr):
    y=(yr or "").lower()
    if "fr" in y: return "so"
    if "so" in y: return "jr"
    if "jr" in y: return "sr"
    return None
def _qtier(q): return "low" if q<73 else ("mid" if q<84 else "high")

def grade(p):
    try: g=float(p.get('tdc_grade'))
    except (TypeError,ValueError): return None
    pid=p.get('id')
    # base = coupled override (vers-free) OR class-dev-bumped OR freshman raw
    base=None
    if pid is not None and str(pid) in _COUPLED:
        try: base=float(_COUPLED[str(pid)])
        except (TypeError,ValueError): base=None
    if base is None:
        try: mpg=float(p.get('mpg') or 0)
        except (TypeError,ValueError): mpg=0
        if mpg<=0: base=g                    # freshman / no prior role → demonstrated (already a projection)
        else:
            trans=_cls_trans(p.get('class_year') or p.get('yr'))
            devbpm=(_DEV.get(trans,{}) or {}).get(_qtier(g),0) if trans else 0
            base=g + devbpm*_BR
    return round(base + _vers_of(p))         # + versatility bump, on top (matches the live display)

def main():
    print("fetching players (projected rosters)…")
    players=get_all("players?select=id,name,team,position,height,class_year,yr,tdc_grade,depth_order,ppg,apg,tp_pct,mpg,usage_pct,is_injured,espn_id")
    by_team=defaultdict(list)
    for p in players:
        if p.get('team') and not p.get('is_injured'): by_team[p['team']].append(p)
    print("  %d players across %d teams"%(len(players),len(by_team)))
    cur_keys={norm(t) for t in by_team}

    # fallback rosters: teams WITHOUT an entered 2026-27 roster get their most-recent
    # (2025-26) roster from player_history so the portal tool covers every rated program,
    # not just the ~79 with projected rosters. Flagged roster_src='recent' so the UI can note it.
    print("fetching player_history 2025-26 (fallback rosters)…")
    hist=get_all("player_history?season_year=eq.2026&tdc_grade=not.is.null&select=name,team,position,height,tdc_grade,ppg,apg,tp_pct,mpg,espn_id")
    hist_by_team=defaultdict(list)
    for p in hist:
        if p.get('team') and norm(p['team']) not in cur_keys: hist_by_team[p['team']].append(p)
    print("  %d history players across %d fallback teams"%(len(hist),len(hist_by_team)))

    print("fetching predictive_ratings (2027)…")
    pr=get_all("predictive_ratings?season=eq.2027&select=data")
    ratings={}   # exact + prefix keys → rating. Non-rostered teams are stored under their
                 # FULL name ("Gonzaga Bulldogs") while player_history uses the short name
                 # ("Gonzaga"), so index each rating under its full name AND every leading
                 # prefix (mascot stripped). Teams are rank-sorted, so a higher-ranked team
                 # wins an ambiguous prefix ("alabama" → Alabama, not Alabama State).
    if pr and pr[0].get('data',{}).get('teams'):
        for t in pr[0]['data']['teams']:
            r={'rank':t.get('rank'),'rating':t.get('rating'),'conf':t.get('conf'),
               'full':t.get('full'),'allPlay':t.get('allPlay')}
            for nm in (t.get('team'), t.get('full')):
                if not nm: continue
                w=nm.split()
                for i in range(len(w),0,-1):
                    k=norm(' '.join(w[:i]))
                    if k and k not in ratings: ratings[k]=r   # longest/first (higher-ranked) wins
    print("  %d rating keys"%len(ratings))

    # current coach per team from coach_seasons (latest season)
    coach_seasons=json.load(open(os.path.join(D,"coach_seasons.json")))
    latest={}
    for s in coach_seasons:
        k=norm(s.get('school'));
        if not k or not s.get('coach_slug'): continue
        if k not in latest or s['season_year']>latest[k]['season_year']: latest[k]=s
    profs={p['coach_slug']:p for p in json.load(open(os.path.join(D,"coach_profiles.json")))}

    def pos_profile(roster):
        cols=defaultdict(list)
        for p in roster:
            g=grade(p)
            if g is None: continue
            cols[slot(p.get('position'), htin(p.get('height')))].append((g,p))
        posdata={}
        for pos in POS:
            lst=sorted(cols.get(pos,[]), key=lambda x:-x[0])
            if lst:
                st=lst[0][1]
                posdata[pos]={'best':round(lst[0][0],1),
                    'second':round(lst[1][0],1) if len(lst)>1 else None,
                    'depth':len([x for x in lst if x[0]>=62]),
                    'starter':st.get('name'),'starterGrade':round(lst[0][0],1)}
            else:
                posdata[pos]={'best':None,'second':None,'depth':0,'starter':None,'starterGrade':None}
        return posdata
    def make_team(team, roster, src):
        nk=norm(team)
        r=ratings.get(nk,{}); co=latest.get(nk); cslug=co['coach_slug'] if co else None
        prof=profs.get(cslug) if cslug else None
        return {
            'team':team, 'full':r.get('full') or team, 'conf':r.get('conf'),
            'rank':r.get('rank'), 'rating':r.get('rating'), 'allPlay':r.get('allPlay'),
            'coach_slug':cslug, 'coach':(co or {}).get('coach'),
            'archetype':(prof or {}).get('archetype'),
            'pos':pos_profile(roster), 'roster_src':src,
        }
    out=[make_team(team, roster, 'current') for team, roster in by_team.items()]
    seen={norm(t['team']) for t in out}
    for team, roster in hist_by_team.items():
        nk=norm(team)
        if nk in seen or len(roster)<6: continue   # need a real roster; no dupes
        seen.add(nk); out.append(make_team(team, roster, 'recent'))
    # rank order (rated first, by rank), then unrated alpha
    out.sort(key=lambda t:(t['rank'] is None, t['rank'] if t['rank'] is not None else 9999, t['team']))
    json.dump({'generated_for':2027,'teams':out}, open(os.path.join(D,"team_needs.json"),"w"))
    rated=sum(1 for t in out if t['rank'] is not None); coached=sum(1 for t in out if t['coach_slug'])
    cur=sum(1 for t in out if t.get('roster_src')=='current'); rec=sum(1 for t in out if t.get('roster_src')=='recent')
    print("wrote team_needs.json — %d teams (%d current roster, %d recent-roster fallback, %d ranked, %d with coach)"%(len(out),cur,rec,rated,coached))
    # spot-check: which teams most need a PG (weakest best-PG)?
    pgneed=sorted([t for t in out if t['pos']['PG']['best'] is not None and t['rank']],
                  key=lambda t:t['pos']['PG']['best'])[:8]
    print("\nWeakest at PG (top portal-PG needs among ranked teams):")
    for t in pgneed:
        print("  #%-3s %-16s PG best %s (%s) · coach %s"%(t['rank'],t['team'],t['pos']['PG']['best'],t['pos']['PG']['starter'],t.get('archetype') or '—'))

if __name__=="__main__": main()
