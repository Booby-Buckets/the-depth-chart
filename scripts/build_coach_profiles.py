#!/usr/bin/env python3
"""
build_coach_profiles.py — turn coach_seasons + team_style into coach PROFILES.

For every coach we join their season-by-season teams to that team-season's
style, average the tendencies across their whole career (games-weighted),
convert each to a 0-100 percentile vs all coaches, then assign a readable
ARCHETYPE + descriptor tags.

Inputs (JSON produced by the other two scripts, or --from-db to pull tables):
  scripts/data/coach_seasons.json
  scripts/data/team_style.json
Output:
  scripts/data/coach_profiles.json   (and --upload to Supabase coach_profiles)

Usage:
  python3 scripts/build_coach_profiles.py
  python3 scripts/build_coach_profiles.py --from-db --upload
"""
import json, os, re, sys, urllib.request
from collections import defaultdict

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(__file__),"data")

# bbref school name -> ESPN team name, where a prefix match won't work
ALIAS={
 "Connecticut":"UConn Huskies","St. John's (NY)":"St. John's Red Storm",
 "Pittsburgh":"Pitt Panthers","Southern California":"USC Trojans",
 "Louisiana State":"LSU Tigers","North Carolina State":"NC State Wolfpack",
 "Brigham Young":"BYU Cougars","Central Florida":"UCF Knights",
 "Texas Christian":"TCU Horned Frogs","Virginia Commonwealth":"VCU Rams",
 "Massachusetts":"UMass Minutemen","Miami (FL)":"Miami Hurricanes",
 "Miami (OH)":"Miami (OH) RedHawks","Southern Methodist":"SMU Mustangs",
 # mid/low-majors with divergent ESPN names
 "Albany (NY)":"UAlbany Great Danes","Appalachian State":"App State Mountaineers",
 "Central Connecticut State":"Central Connecticut Blue Devils",
 "College of Charleston":"Charleston Cougars","FDU":"Fairleigh Dickinson Knights",
 "IU Indy":"IU Indianapolis Jaguars","Illinois-Chicago":"UIC Flames",
 "Louisiana-Monroe":"UL Monroe Warhawks","Loyola (IL)":"Loyola Chicago Ramblers",
 "Loyola (MD)":"Loyola Maryland Greyhounds","Maryland-Baltimore County":"UMBC Retrievers",
 "Maryland-Eastern Shore":"Maryland Eastern Shore Hawks","Massachusetts-Lowell":"UMass Lowell River Hawks",
 "Nevada-Las Vegas":"UNLV Rebels","Nicholls State":"Nicholls Colonels",
 "Queens (NC)":"Queens University Royals","Saint Francis (PA)":"Saint Francis Red Wolves",
 "San Jose State":"San José State Spartans","Southeastern Louisiana":"Southeastern Louisiana Lions",
 "Southern Mississippi":"Southern Miss Golden Eagles","St. Francis (NY)":"St. Francis Brooklyn Terriers",
 "Texas-Rio Grande Valley":"UT Rio Grande Valley Vaqueros",
}

def _norm(s): return re.sub(r"[^a-z0-9 ]","",(s or "").lower()).strip()

def load(name, table, select):
    p=os.path.join(D,name)
    if "--from-db" not in sys.argv and os.path.exists(p):
        return json.load(open(p))
    rows,frm=[],0
    while True:
        req=urllib.request.Request("%s/rest/v1/%s?select=%s"%(SB,table,select),
            headers={**HDR,"Range-Unit":"items","Range":"%d-%d"%(frm,frm+999)})
        b=json.load(urllib.request.urlopen(req,timeout=60)); rows+=b
        if len(b)<1000: break
        frm+=1000
    return rows

def build_crosswalk(schools, espn_names):
    """school (bbref) -> ESPN team name."""
    espn=list(espn_names)
    xw={}
    for school in schools:
        if school in ALIAS and ALIAS[school] in espn_names: xw[school]=ALIAS[school]; continue
        ns=_norm(school)
        # exact-prefix: ESPN "Duke Blue Devils" startswith "Duke "
        cand=[e for e in espn if _norm(e)==ns or _norm(e).startswith(ns+" ")]
        if cand: xw[school]=min(cand,key=len); continue
        # loose: ESPN words start with school words
        cand=[e for e in espn if _norm(e).startswith(ns)]
        if cand: xw[school]=min(cand,key=len)
    return xw

def pctl_maps(profiles, keys):
    out={}
    for k in keys:
        vals=sorted(p[k] for p in profiles if p.get(k) is not None)
        out[k]=vals
    def pct(k,v):
        vals=out[k]
        if not vals or v is None: return 50
        lo=sum(1 for x in vals if x<=v)
        return round(lo/len(vals)*100)
    return pct

def archetype(P):
    p=P["pctl"]
    tags=[]
    if p["poss_pg"]>=70: tags.append("Up-tempo")
    elif p["poss_pg"]<=30: tags.append("Grind-it-out")
    if p["rotation_size"]>=70: tags.append("Deep bench")
    elif p["rotation_size"]<=30: tags.append("Short bench")
    if p["three_pa_rate"]>=70: tags.append("Perimeter-heavy")
    elif p["three_pa_rate"]<=30: tags.append("Inside-out")
    if p["ast_rate"]>=70: tags.append("Ball movement")
    if p["opp_tov_pg"]>=72: tags.append("Turnover-forcing")
    if p["top_scorer_share"]>=72: tags.append("Star-centric")
    elif p["top_scorer_share"]<=28: tags.append("Egalitarian")
    # primary label — pick the most defining combination
    if p["rotation_size"]>=68 and p["opp_tov_pg"]>=62: a="Deep-Bench Pressure"
    elif p["poss_pg"]>=68 and p["three_pa_rate"]>=60: a="Up-Tempo Shooters"
    elif p["poss_pg"]<=32 and p["three_pa_rate"]<=42: a="Grind-It-Out Bigs"
    elif p["top_scorer_share"]>=70 and p["ast_rate"]<=40: a="Star-Centric Iso"
    elif p["ast_rate"]>=68 and p["three_pa_rate"]>=55: a="Motion Shooters"
    elif p["opp_tov_pg"]>=75: a="Turnover Hawks"
    elif p["rotation_size"]<=30: a="Seven-Man Reliant"
    else: a="Balanced System"
    return a, tags

STYLE=["poss_pg","rotation_size","bench_min_pct","three_pa_rate","ft_rate",
       "ast_rate","oreb_pg","opp_tov_pg","top_scorer_share"]

def main():
    coach_seasons=load("coach_seasons.json","coach_seasons","*")
    team_style=load("team_style.json","team_style","*")
    style_ix={(r["team"],r["season_year"]):r for r in team_style}
    schools={r["school"] for r in coach_seasons if r.get("school")}
    xw=build_crosswalk(schools,{r["team"] for r in team_style})
    print("crosswalk: %d/%d schools mapped" % (len(xw),len(schools)))

    by=defaultdict(list)
    for r in coach_seasons:
        if r.get("coach_slug"): by[r["coach_slug"]].append(r)

    profiles=[]
    for cslug,rows in by.items():
        rows=sorted(rows,key=lambda x:x["season_year"])
        agg=defaultdict(float); gsum=0; W=L=0; srs=[]; schools_seen=[]
        for r in rows:
            W+=r.get("wins") or 0; L+=r.get("losses") or 0
            if r.get("srs") is not None: srs.append(r["srs"])
            if r.get("school") and r["school"] not in schools_seen: schools_seen.append(r["school"])
            esp=xw.get(r.get("school"))
            st=style_ix.get((esp,r["season_year"])) if esp else None
            if not st: continue
            g=st.get("games") or 1
            for k in STYLE: agg[k]+=(st.get(k) or 0)*g
            gsum+=g
        if gsum==0: continue
        P={"coach_slug":cslug,"coach":rows[-1]["coach"],
           "seasons":len(rows),"first_year":rows[0]["season_year"],"last_year":rows[-1]["season_year"],
           "schools":", ".join(schools_seen),"wins":W,"losses":L,
           "win_pct":round(W/max(1,W+L),3),"avg_srs":round(sum(srs)/len(srs),2) if srs else None}
        for k in STYLE: P[k]=round(agg[k]/gsum,2)
        profiles.append(P)

    pct=pctl_maps(profiles,STYLE)
    for P in profiles:
        P["pctl"]={k:pct(k,P[k]) for k in STYLE}
        a,tags=archetype(P); P["archetype"]=a; P["tags"]=", ".join(tags)

    os.makedirs(D,exist_ok=True)
    json.dump(profiles,open(os.path.join(D,"coach_profiles.json"),"w"))
    print("built %d coach profiles" % len(profiles))
    # small preview
    for P in sorted(profiles,key=lambda x:-x["seasons"])[:8]:
        print("  %-22s %2ds  %s  [%s]" % (P["coach"][:22],P["seasons"],P["archetype"],P["tags"]))

    if "--upload" in sys.argv:
        for i in range(0,len(profiles),300):
            chunk=profiles[i:i+300]
            req=urllib.request.Request(SB+"/rest/v1/coach_profiles?on_conflict=coach_slug",
                data=json.dumps(chunk).encode(),method="POST",
                headers={**HDR,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"})
            try: urllib.request.urlopen(req,timeout=60).read(); print("  uploaded",i)
            except urllib.error.HTTPError as e: print("  upload err",e.code,e.read()[:200]); break

if __name__=="__main__": main()
