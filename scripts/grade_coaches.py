#!/usr/bin/env python3
"""
grade_coaches.py — a 0-100 TDC Coach Grade + national rank, layered onto the
existing coach_profiles.json. Blends four dimensions the user asked for:

  1. Winning & team quality  — SRS (opponent-adjusted) + win% + over/under-performance
                                vs roster talent (did he win as much as his talent should?)
  2. Tournament / peak        — NCAA resume (deep runs, Final Fours, titles) + peak SRS
  3. Player development       — the existing dev metric (how much players improve)
  4. Consistency             — season-to-season stability: win% floor (worst seasons)
                                + win% volatility (swings) + a small tenure factor

Sample-sensitive components (quality, tournament) are regressed toward the mean for
short tenures so a one-year wonder can't top the list. Also attaches a per-season
timeline (record, SRS, conf, NCAA seed/result, and that year's playstyle) so the
detail view can show how a coach and his tendencies evolved year to year.

Reads:  data/coach_profiles.json, data/coach_seasons.json, data/team_style.json,
        team_seasons (tournament results, pulled live)
Writes: data/coach_profiles.json (enriched in place)

Usage: python3 scripts/grade_coaches.py
"""
import json, os, re, sys, urllib.request
from collections import defaultdict

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(__file__),"data")

# reuse the same bbref-school -> ESPN-name crosswalk as build_coach_profiles.py
ALIAS={
 "Connecticut":"UConn Huskies","St. John's (NY)":"St. John's Red Storm","Pittsburgh":"Pitt Panthers",
 "Southern California":"USC Trojans","Louisiana State":"LSU Tigers","North Carolina State":"NC State Wolfpack",
 "Brigham Young":"BYU Cougars","Central Florida":"UCF Knights","Texas Christian":"TCU Horned Frogs",
 "Virginia Commonwealth":"VCU Rams","Massachusetts":"UMass Minutemen","Miami (FL)":"Miami Hurricanes",
 "Miami (OH)":"Miami (OH) RedHawks","Southern Methodist":"SMU Mustangs","Albany (NY)":"UAlbany Great Danes",
 "Appalachian State":"App State Mountaineers","Central Connecticut State":"Central Connecticut Blue Devils",
 "College of Charleston":"Charleston Cougars","FDU":"Fairleigh Dickinson Knights",
 "IU Indy":"IU Indianapolis Jaguars","Illinois-Chicago":"UIC Flames","Louisiana-Monroe":"UL Monroe Warhawks",
 "Loyola (IL)":"Loyola Chicago Ramblers","Loyola (MD)":"Loyola Maryland Greyhounds",
 "Maryland-Baltimore County":"UMBC Retrievers","Maryland-Eastern Shore":"Maryland Eastern Shore Hawks",
 "Massachusetts-Lowell":"UMass Lowell River Hawks","Nevada-Las Vegas":"UNLV Rebels","Nicholls State":"Nicholls Colonels",
 "Queens (NC)":"Queens University Royals","Saint Francis (PA)":"Saint Francis Red Wolves",
 "San Jose State":"San José State Spartans","Southeastern Louisiana":"Southeastern Louisiana Lions",
 "Southern Mississippi":"Southern Miss Golden Eagles","St. Francis (NY)":"St. Francis Brooklyn Terriers",
 "Texas-Rio Grande Valley":"UT Rio Grande Valley Vaqueros",
}
# NCAA run value (impact of getting that far) — Champion far outweighs a 1st-round exit
RESVAL={"Round of 64":1,"Round of 32":2.5,"Sweet 16":5,"Elite Eight":8,"Final Four":13,"Runner-Up":17,"Champion":24}
STYLE=["poss_pg","rotation_size","three_pa_rate","ast_rate","ft_rate","opp_tov_pg","oreb_pg","top_scorer_share"]

def _norm(s): return re.sub(r"[^a-z0-9 ]","",(s or "").lower()).strip()
def jload(n): return json.load(open(os.path.join(D,n)))

def pull_team_seasons():
    rows,frm=[],0
    while True:
        req=urllib.request.Request(
            f"{SB}/rest/v1/team_seasons?select=team,season_year,srs,wins,losses,ncaa_seed,ncaa_result,conf_champ",
            headers={**HDR,"Range-Unit":"items","Range":f"{frm}-{frm+999}"})
        b=json.load(urllib.request.urlopen(req,timeout=60)); rows+=b
        if len(b)<1000: break
        frm+=1000
    return rows

def crosswalk(schools, espn_names):
    espn=list(espn_names); xw={}
    for school in schools:
        if school in ALIAS and ALIAS[school] in espn_names: xw[school]=ALIAS[school]; continue
        ns=_norm(school)
        cand=[e for e in espn if _norm(e)==ns or _norm(e).startswith(ns+" ")]
        if cand: xw[school]=min(cand,key=len); continue
        cand=[e for e in espn if _norm(e).startswith(ns)]
        if cand: xw[school]=min(cand,key=len)
    return xw

def pctl(vals):
    s=sorted(vals)
    def f(v):
        if v is None or not s: return 50
        return round(sum(1 for x in s if x<=v)/len(s)*100)
    return f

def main():
    profiles=jload("coach_profiles.json")
    coach_seasons=jload("coach_seasons.json")
    team_style=jload("team_style.json")
    ts=pull_team_seasons()
    ts_ix={(r["team"],r["season_year"]):r for r in ts}
    style_ix={(r["team"],r["season_year"]):r for r in team_style}
    xw=crosswalk({r["school"] for r in coach_seasons if r.get("school")},{r["team"] for r in ts})

    seasons_by=defaultdict(list)
    for r in coach_seasons:
        if r.get("coach_slug"): seasons_by[r["coach_slug"]].append(r)

    # ── per-coach raw dimension inputs + season timeline ──
    for P in profiles:
        rows=sorted(seasons_by.get(P["coach_slug"],[]),key=lambda x:x["season_year"])
        srs=[r["srs"] for r in rows if r.get("srs") is not None]
        tourpts=0.0; apps=0; titles=0; f4=0; best=None; conf_titles=0
        timeline=[]
        for r in rows:
            esp=xw.get(r.get("school")); tsr=ts_ix.get((esp,r["season_year"])) if esp else None
            seed=tsr.get("ncaa_seed") if tsr else None
            res=tsr.get("ncaa_result") if tsr else None
            cc=bool(tsr.get("conf_champ")) if tsr else False
            if res:
                apps+=1; tourpts+=RESVAL.get(res,1)
                if res=="Champion": titles+=1
                if res in ("Final Four","Runner-Up","Champion"): f4+=1
                order=["Round of 64","Round of 32","Sweet 16","Elite Eight","Final Four","Runner-Up","Champion"]
                if best is None or order.index(res)>order.index(best): best=res
            if cc: conf_titles+=1
            st=style_ix.get((esp,r["season_year"])) if esp else None
            timeline.append({"y":r["season_year"],"school":r.get("school"),
                "w":r.get("wins"),"l":r.get("losses"),"srs":r.get("srs"),"conf":r.get("conf"),
                "seed":seed,"result":res,"conf_champ":cc,
                **({k:st.get(k) for k in STYLE} if st else {})})
        peak=sum(sorted(srs,reverse=True)[:3])/min(3,len(srs)) if srs else None
        pos_frac=(sum(1 for s in srs if s>0)/len(srs)) if srs else 0.0
        # season-to-season CONSISTENCY signals (tenure-robust, unlike a raw SD which
        # a short tenure deflates):
        #  - downside: WIN% of his WORST ~40% of seasons. A low floor = boom/bust. Uses
        #    win% (what a fan sees) not SRS, which a tough-schedule league props up even
        #    in bad win years.
        #  - volatility: SD of per-season win% — the swings a fan sees (9 wins → 22 → 9).
        wps=[r["wins"]/(r["wins"]+r["losses"]) for r in rows
             if r.get("wins") is not None and r.get("losses") is not None and (r["wins"]+r["losses"])>0]
        _wm=(sum(wps)/len(wps)) if wps else 0.0
        wpsd=((sum((x-_wm)**2 for x in wps)/len(wps))**0.5) if len(wps)>=3 else None
        wps_sorted=sorted(wps)
        _kd=max(1,int(round(len(wps)*0.4))) if wps else 0
        downside=(sum(wps_sorted[:_kd])/_kd) if _kd else None
        P["_srs"]=P.get("avg_srs"); P["_wp"]=P.get("win_pct")
        P["_tourpts"]=round(tourpts,1); P["_peak"]=round(peak,2) if peak is not None else None
        P["_posfrac"]=round(pos_frac,3); P["_seasons"]=P.get("seasons",len(rows))
        P["_downside"]=round(downside,3) if downside is not None else None
        P["_wpsd"]=round(wpsd,4) if wpsd is not None else None
        # over/under-performance vs ROSTER TALENT (career avg SRS lift from the
        # precomputed rundowns): a coach who wins less than his talent predicts —
        # Stackhouse's NBA-laden rosters going 9-23 — is docked on Winning & Quality.
        try:
            rd=json.load(open(os.path.join(D,"coach_rundowns",P["coach_slug"]+".json")))
            lifts=[s.get("srs_lift") for s in rd.get("seasons",[]) if s.get("srs_lift") is not None]
            P["_overperf"]=round(sum(lifts)/len(lifts),3) if lifts else None
        except Exception:
            P["_overperf"]=None
        P["tourney"]={"apps":apps,"titles":titles,"final_fours":f4,"best":best,"conf_titles":conf_titles}
        # (per-season timeline is redundant with coach_seasons.json / coach_pages.json — not stored)

    # ── percentile each raw input across the coach pool ──
    fp={k:pctl([P[k] for P in profiles if P.get(k) is not None])
        for k in ["_srs","_wp","_tourpts","_peak","_posfrac","_seasons","_downside","_wpsd","_overperf"]}
    # 65% of coaches never made the NCAA tournament, so a raw percentile of 0 tourney
    # points lands ~65th (everyone's tied at 0). Instead: never-made-it → the floor,
    # and rank ONLY the coaches who actually made it into the top band.
    # Scored on an ABSOLUTE curve, not a percentile. Percentile rank threw away
    # magnitude: among the third of coaches who ever reached the field, a dozen
    # early exits and a pair of national titles both landed in the top few
    # percentiles, so Sean Miller (0 Final Fours) scored the same 98 as Dan
    # Hurley (2 titles, 3 Final Fours). RESVAL already prices a title at 24x a
    # Round-of-64 trip; the percentile was flattening that back out.
    _tp_all=sorted([P["_tourpts"] for P in profiles if P.get("_tourpts")], reverse=True)
    _TP_REF=_tp_all[2] if len(_tp_all)>2 else (_tp_all[0] if _tp_all else 1.0)
    def _tp_score(v):
        if not v or v<=0: return 8               # never reached the NCAA tournament
        return 30 + 70*min(1.0, (v/_TP_REF)**0.60)   # made it → 30..100 by how deep he went
    for P in profiles:
        cred=P["_seasons"]/(P["_seasons"]+2.0)              # small-sample shrink
        quality  = 0.50*fp["_srs"](P["_srs"]) + 0.20*fp["_wp"](P["_wp"]) + 0.30*fp["_overperf"](P["_overperf"])
        # peak SRS is regular-season strength, which `quality` already pays for —
        # at 38% it was letting teams that were great in February but went home in
        # March score like teams that actually won in March.
        tourney  = 0.80*_tp_score(P["_tourpts"]) + 0.20*fp["_peak"](P["_peak"])
        # Development is regressed toward neutral by SAMPLE SIZE, the same way quality
        # and tourney are regressed by tenure. It used to be applied raw, so a coach
        # with 14 returner-transitions carried the same weight as one with 98 -- and
        # because compute_coach_development only earns a percentile at MIN_N=8, the
        # result was a cliff: 7 observations -> a neutral 50, 8 -> a raw extreme.
        # Dusty May (1 title, 2 Final Fours) sat at the 3rd percentile on 14 returners,
        # which alone cost him ~8.5 composite points and ~45 rank places. Portal-built
        # rosters and mid-season school moves both starve this metric of returners.
        _dv = P.get("dev_pctl") if P.get("dev_pctl") is not None else 50
        _dn = P.get("dev_n") or 0
        develop  = 50 + (_dn/(_dn+12.0))*(_dv-50)
        # Consistency = mostly season-to-season STABILITY (low SRS variance), with a
        # smaller reward for being reliably above-average and for tenure. Short tenures
        # (<3 seasons, _srssd None) get a neutral 50 stability rather than a free high score.
        volatility = 100 - fp["_wpsd"](P["_wpsd"])    # small win% swings → more consistent (None→50)
        consist  = 0.55*fp["_downside"](P["_downside"]) + 0.30*volatility + 0.15*fp["_seasons"](P["_seasons"])
        # Only regress the RATE estimates. quality is built from SRS/win%/overperformance
        # — averages, where a short sample really is an unreliable read on true skill.
        # tourney is a CUMULATIVE achievement count: a short career already shows up as
        # fewer tournament points, so shrinking it by tenure on top of that penalises the
        # same thing twice. A Final Four happened; it is not an estimate of a Final Four.
        quality  = 50 + cred*(quality-50)
        # Success carries more of the grade than it did: a body of work with deep runs
        # should outrank a long tenure that never got out of the first weekend.
        # Tournament results carry the most weight: this grade is meant to reward what
        # a coach actually achieved, not how rarely he had a bad year. Consistency is
        # deliberately light — it scores a high floor and low variance, which flatters
        # steady mediocrity and punishes anyone who built up from a low-major job
        # (Dan Hurley scores 58 on it because he started at Wagner).
        comp = 0.30*quality + 0.46*tourney + 0.10*develop + 0.14*consist
        P["_comp"]=comp
        P["grade_parts"]={"winning":round(quality),"tournament":round(tourney),
                          "development":round(develop),"consistency":round(consist)}
    # ── stretch composite to a readable 0-100 grade (top coach ~99) + national rank ──
    comps=sorted(P["_comp"] for P in profiles)
    lo,hi=comps[len(comps)//50], comps[-1]                  # clip bottom 2% to avoid a squashed top
    # A national title is a floor, not just another input. The career-average model
    # otherwise buries a champion with a short tenure: Dusty May (title + a mid-major
    # Final Four, 8 seasons) came out 77/#126 because his 8-year sample regresses every
    # component toward the mean. Raising the COMPOSITE — rather than only the printed
    # grade — keeps the national rank consistent with the number shown.
    # 13 coaches have a title; this lifts the ones who were under 90.
    #
    # The floor is a BAND, not a single value. A flat 90 for every champion stacked
    # ranks 12-19 on the identical number and broke the tie on hundredths, so a coach
    # with two titles and three Final Fours printed the same grade as one with a single
    # title and one Final Four. Depth of resume sets which rung of the band you land on,
    # and your own composite spreads you within that rung so nobody exactly ties.
    if hi>lo:
        per_grade = (hi-lo)/59.0                          # composite units per grade point
        def _to_comp(gr): return lo + (gr-40.0)*per_grade
        for P in profiles:
            tr = P.get("tourney") or {}
            if not tr.get("titles"): continue
            rung = 90.0 + 3.5*(tr["titles"]-1) + 1.2*min(tr.get("final_fours",0), 4)
            own  = (P["_comp"]-lo)/(hi-lo)                 # 0-1 merit, breaks within-rung ties
            P["_comp"] = max(P["_comp"], _to_comp(min(96.0, rung) + 0.7*own))
    for P in profiles:
        g=(P["_comp"]-lo)/(hi-lo) if hi>lo else 0.5
        P["grade"]=max(40,min(99,round(40+g*59)))
    ranked=sorted(profiles,key=lambda P:-P["_comp"])
    for i,P in enumerate(ranked): P["rank"]=i+1
    # drop temp fields
    for P in profiles:
        for k in ["_srs","_wp","_tourpts","_peak","_posfrac","_seasons","_downside","_wpsd","_overperf","_comp","timeline"]: P.pop(k,None)

    json.dump(profiles,open(os.path.join(D,"coach_profiles.json"),"w"))
    print(f"graded {len(profiles)} coaches")
    print("\nTOP 20 by TDC Coach Grade:")
    for P in ranked[:20]:
        tr=P["tourney"]
        print(f"  {P['rank']:>3}. {P['coach'][:22]:22} {P['grade']:>3}  "
              f"{P['seasons']}s win% {P['win_pct']:.3f} srs {str(P.get('avg_srs')):>6}  "
              f"{tr['apps']}NCAA {tr['titles']}T {tr['final_fours']}FF  [{P['archetype']}]")

if __name__=="__main__": main()
