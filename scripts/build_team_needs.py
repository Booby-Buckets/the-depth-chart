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
import json, os, re, difflib, urllib.request
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


# sheet short name -> Sports-Reference school (coach_seasons spelling)
SR_ALIAS={"UConn":"Connecticut","BYU":"Brigham Young","LSU":"Louisiana State","USC":"Southern California",
 "TCU":"Texas Christian","SMU":"Southern Methodist","VCU":"Virginia Commonwealth","UNLV":"Nevada-Las Vegas",
 "Miami":"Miami (FL)","St. John's":"St. John's (NY)","Ole Miss":"Mississippi","Loyola Chicago":"Loyola (IL)",
 "FAU":"Florida Atlantic","NC-State":"North Carolina State","NC State":"North Carolina State",
 "Pitt":"Pittsburgh","UMass":"Massachusetts","ECU":"East Carolina","UTSA":"UTSA","USF":"South Florida",
 "UNC Asheville":"North Carolina-Asheville","UNC Greensboro":"North Carolina-Greensboro"}
# player_history (Sports-Reference) spellings -> sheet/ESPN short names, so a fallback roster
# neither duplicates a rostered team ("Connecticut" vs "UConn") nor misses its rating.
HIST_ALIAS={v:k for k,v in SR_ALIAS.items() if k not in ('NC State','USF','UTSA')}
HIST_ALIAS.update({'Albany (NY)':'Albany','College of Charleston':'Charleston','Illinois-Chicago':'UIC',
 'Louisiana-Monroe':'UL Monroe','Maryland-Baltimore County':'UMBC','Saint Francis (PA)':'Saint Francis',
 'Tennessee-Martin':'UT Martin','Southern Mississippi':'Southern Miss','Loyola (MD)':'Loyola Maryland',
 'Central Connecticut State':'Central Connecticut','FDU':'Fairleigh Dickinson','IU Indy':'IU Indianapolis',
 'San Jose State':'San José State','St. Thomas':'St. Thomas-Minnesota','Southeastern Louisiana':'SE Louisiana',
 'Appalachian State':'App State','North Carolina State':'NC-State','Pittsburgh':'Pittsburgh'})
RATING_ALIAS={'ECU':'East Carolina','UMass':'Massachusetts','Albany':'UAlbany'}
SCHOOL_WORDS={'State','Tech','A&M','Atlantic','Christian','Southern','International','Gulf','Central',
 'Baptist','Poly','Methodist','Wesleyan','Northern','Eastern','Western','(OH)','(FL)','Chicago','Maryland'}
# one label per conference (the sheet uses codes, predictive_ratings full names for the rest)
_CONF={'b10':'Big Ten','bigten':'Big Ten','big12':'Big 12','bigeast':'Big East','pac12':'Pac-12','a10':'A-10',
 'atlantic10':'A-10','aac':'American','american':'American','americanathletic':'American','acc':'ACC','sec':'SEC',
 'wcc':'WCC','westcoast':'WCC','mwc':'Mountain West','mountainwest':'Mountain West','mvc':'Missouri Valley',
 'cusa':'Conference USA','conferenceusa':'Conference USA','mac':'MAC','midamerican':'MAC','maac':'MAAC',
 'metroatlanticathletic':'MAAC','caa':'CAA','coastalathletic':'CAA','swac':'SWAC','southwesternathletic':'SWAC',
 'meac':'MEAC','mideasternathletic':'MEAC','asun':'ASUN','atlanticsun':'ASUN','ovc':'OVC','ohiovalley':'OVC',
 'nec':'NEC','coastalathleticassociation':'CAA','northeast':'NEC','wac':'WAC','westernathletic':'WAC','uac':'UAC','unitedathletic':'UAC',
 'socon':'SoCon','southern':'SoCon'}
_NICK={'mike':'michael','penny':'anfernee','bill':'william','bob':'robert','bobby':'robert','jim':'james',
 'tom':'thomas','tommy':'thomas','rick':'richard','rich':'richard','dan':'daniel','danny':'daniel','matt':'matthew',
 'chris':'christopher','steve':'steven','tj':'tj','jeff':'jeffrey','greg':'gregory','joe':'joseph','tony':'anthony'}
def cnorm(n):   # coach name for matching: lowercase, no suffix/punctuation, nickname -> given name
    w=[x for x in re.sub(r"[^a-z ]","",(n or "").lower().replace('.','')).split() if x not in ('jr','sr','ii','iii','iv')]
    if w: w[0]=_NICK.get(w[0],w[0])
    return ' '.join(w)
def conf_label(c):
    if not c: return None
    k=norm(re.sub(r'\bconference\b','',c,flags=re.I))
    return _CONF.get(k) or re.sub(r'\s*Conference\s*$','',c).strip()

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

try:
    _SOP=(json.load(open(os.path.join(D,"stat_overall_projected.json"))) or {}).get("players",{})
except Exception: _SOP={}
def grade(p):
    # the statistical projected overall (what every page shows) — never the sheet's hand grade
    e=p.get('espn_id')
    if e is not None and str(e) in _SOP and _SOP[str(e)].get('ovr') is not None:
        return round(float(_SOP[str(e)]['ovr']))
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
        tm=HIST_ALIAS.get(p.get('team'), p.get('team'))   # SR spellings -> the name everything else uses
        if tm and norm(tm) not in cur_keys: hist_by_team[tm].append(p)
    print("  %d history players across %d fallback teams"%(len(hist),len(hist_by_team)))

    print("fetching predictive_ratings (2027)…")
    pr=get_all("predictive_ratings?season=eq.2027&select=data")
    ratings={}   # exact + mascot-stripped keys → rating. Non-rostered teams are stored under
                 # their FULL name ("Gonzaga Bulldogs") while player_history uses the short name
                 # ("Gonzaga"). Keys are filled in passes: exact names first, then 1 trailing word
                 # stripped, then 2... so "Michigan" resolves to Michigan Wolverines (1 word off)
                 # and never to Michigan State Spartans (2 words off) — the old single-pass prefix
                 # loop let a higher-ranked "X State" steal "X" (Michigan/Iowa/Texas/Ohio).
    if pr and pr[0].get('data',{}).get('teams'):
        rts=[]
        for t in pr[0]['data']['teams']:
            r={'rank':t.get('rank'),'rating':t.get('rating'),'conf':t.get('conf'),
               'full':t.get('full'),'allPlay':t.get('allPlay')}
            rts.append((r,[(t.get('team') or '').split(), (t.get('full') or '').split()]))
        for strip in range(0,3):
            for r,names in rts:
                for j,w in enumerate(names):
                    if not w or (strip and (j==0 or len(w)-strip<1)): continue   # only strip the mascot off FULL names
                    if strip>=2 and w[len(w)-strip] in SCHOOL_WORDS: continue   # "Ohio State Buckeyes" is not "Ohio"
                    k=norm(' '.join(w[:len(w)-strip]))
                    if k and k not in ratings: ratings[k]=r
    print("  %d rating keys"%len(ratings))

    # current coach per team: the owner's `teams.head_coach` (the sheet — current for every
    # rostered program, incl. hires coach_seasons hasn't seen yet, e.g. Mick Cronin/UCLA), matched
    # to a coach profile by name; else the latest coach_seasons row, with Sports-Reference school
    # spellings aliased ("St. John's (NY)", "Connecticut", "Miami (FL)", ...).
    coach_seasons=json.load(open(os.path.join(D,"coach_seasons.json")))
    latest={}
    for s in coach_seasons:
        k=norm(s.get('school'));
        if not k or not s.get('coach_slug'): continue
        if k not in latest or s['season_year']>latest[k]['season_year']: latest[k]=s
    for short,sr in SR_ALIAS.items():
        if norm(sr) in latest and norm(short) not in latest: latest[norm(short)]=latest[norm(sr)]
    prof_list=json.load(open(os.path.join(D,"coach_profiles.json")))
    profs={p['coach_slug']:p for p in prof_list}
    by_coach=defaultdict(list)
    by_cn=defaultdict(list)
    for p in prof_list: by_coach[norm(p.get('coach'))].append(p); by_cn[cnorm(p.get('coach'))].append(p)
    teams_tbl=get_all("teams?select=name,conference,head_coach,coach")
    sheet={norm(t['name']):t for t in teams_tbl if t.get('name')}
    def coach_for(team):
        nk=norm(team); row=sheet.get(nk); name=row and (row.get('head_coach') or row.get('coach'))
        if name:
            sch={norm(team), norm(SR_ALIAS.get(team,''))}
            at=lambda c: bool(sch & {norm(x) for x in (c.get('schools') or '').split(',')})
            cands=by_coach.get(norm(name),[]) or by_coach.get(cnorm(name),[])
            if not cands:   # sheet spellings: "Mike White"/"Michael White", "Mussleman", "Jr."
                cn=cnorm(name); last=cn.split()[-1] if cn else ''
                cands=[c for c in prof_list if cnorm(c.get('coach')).split()[-1:]==[last] and at(c)]
                if not cands:
                    close=difflib.get_close_matches(cn, list(by_cn), n=1, cutoff=0.86)
                    cands=by_cn.get(close[0],[]) if close else []
            here=[c for c in cands if at(c)]
            pick=(here or sorted(cands,key=lambda c:-(c.get('last_year') or 0)) or [None])[0]
            return name,(pick or {}).get('coach_slug')
        co=latest.get(nk)
        return ((co or {}).get('coach'),(co or {}).get('coach_slug'))

    def pos_profile(roster):
        cols=defaultdict(list)
        for p in roster:
            g=grade(p)
            if g is None: continue
            cols[slot(p.get('position'), htin(p.get('height')))].append((g,p))
        posdata={}
        def dorder(p):
            try: d=int(p.get('depth_order')) if p.get('depth_order') is not None else None
            except (TypeError,ValueError): d=None
            return d
        def mpg_of(p):
            try: return float(p.get('mpg') or 0)
            except (TypeError,ValueError): return 0.0
        for pos in POS:
            lst=sorted(cols.get(pos,[]), key=lambda x:-x[0])
            if lst:
                # 'best' = highest grade at the slot (the upgrade-math bar). The STARTER is who
                # actually starts there per the depth chart — lowest depth_order, then most
                # minutes, then grade — NOT the best-graded body, which can be a bench piece.
                ranked=sorted(lst, key=lambda x:((dorder(x[1]) if dorder(x[1]) is not None else 99), -mpg_of(x[1]), -x[0]))
                st_g,st=ranked[0]; sd=dorder(st)
                # Only a top-5 depth-chart slot is a real starter. If nobody in the top 5 is
                # slotted here (the starters play adjacent spots), the slot has NO set starter —
                # name the top reserve instead of promoting a bench piece to "starter".
                real=(sd is not None and sd<=5)
                posdata[pos]={'best':round(lst[0][0],1),
                    'second':round(lst[1][0],1) if len(lst)>1 else None,
                    'depth':len([x for x in lst if x[0]>=62]),
                    'starter':(st.get('name') if real else None),'starterGrade':(round(st_g,1) if real else None),
                    'starterDepth':sd,'topReserve':(None if real else st.get('name'))}
            else:
                posdata[pos]={'best':None,'second':None,'depth':0,'starter':None,'starterGrade':None}
        return posdata
    def make_team(team, roster, src):
        nk=norm(team)
        r=ratings.get(nk) or ratings.get(norm(RATING_ALIAS.get(team,''))) or {}; cname,cslug=coach_for(team)
        prof=profs.get(cslug) if cslug else None
        conf=r.get('conf') or (sheet.get(nk) or {}).get('conference') or (latest.get(nk) or {}).get('conf')
        return {
            'team':team, 'full':r.get('full') or team, 'conf':conf_label(conf),
            'rank':r.get('rank'), 'rating':r.get('rating'), 'allPlay':r.get('allPlay'),
            'coach_slug':cslug, 'coach':cname,
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
