#!/usr/bin/env python3
"""
build_coach_rundowns.py — a season-by-season "Team Rundown" for each coach.

For EVERY season a coach coached, emits a rich card's worth of data:
  - record + SRS + conference + NCAA-tournament result (from team_seasons)
  - the top 7 players that year (by TDC grade)
  - a style identity (pace / shot diet / star usage) + strengths & weaknesses
    (percentiles of that season's team_style vs all 7,000 team-seasons)
  - over/under-performance: how the team did vs what the ROSTER'S TALENT predicted,
    shown BOTH ways — SRS lift and win lift (talent->expected via league regression)

Output: scripts/data/coach_rundowns/<coach_slug>.json  (one small file per coach,
fetched on demand by coach.html — coach_pages.json is already 3.5MB, so we do NOT
inline this). Each file: {"seasons":[... newest first ...]}.

Run after build_coach_pages.py (same data sources / crosswalk). Reads:
  bbref_seasons (rosters+grades), team_seasons (srs/wins/ncaa), team_style.json.
"""
import json, os, re, urllib.request
from collections import defaultdict
import numpy as np

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(__file__),"data")
OUTDIR=os.path.join(D,"coach_rundowns")

def get_all(path):
    rows,frm=[],0
    while True:
        req=urllib.request.Request(SB+"/rest/v1/"+path,headers={**HDR,"Range-Unit":"items","Range":"%d-%d"%(frm,frm+999)})
        b=json.load(urllib.request.urlopen(req,timeout=90)); rows+=b
        if len(b)<1000: break
        frm+=1000
    return rows

def norm(s): return re.sub(r"[^a-z0-9 ]","",(s or "").lower()).strip()
def keys(full):
    # ESPN names are full ('Gonzaga Bulldogs'); generate mascot-stripped candidates
    # so they match coach_seasons.school ('Gonzaga').
    w=norm(full).split(); out={norm(full)}
    for i in (1,2):
        if len(w)>i: out.add(" ".join(w[:-i]))
    return out

# Rotation weighting for roster talent: starters count most. Talent = weighted mean
# of a team-season's graded players, top grades first.
TAL_W=[5,4,3,2,2,1,1,1]
def talent(grades):
    g=sorted(grades,reverse=True)[:len(TAL_W)]
    if not g: return None
    w=TAL_W[:len(g)]
    return sum(a*b for a,b in zip(g,w))/sum(w)

# Style metrics that have a clear "better = higher" direction (used for
# strengths/weaknesses). Pace / 3PA-rate / star-share are IDENTITY, not good/bad,
# and are surfaced separately in the header line.
DIR_METRICS=[("ast_rate","Ball movement"),("opp_tov_pg","Forcing turnovers"),
             ("stl_pg","Getting steals"),("oreb_pg","Offensive rebounding"),
             ("bench_min_pct","Bench depth"),("ft_rate","Getting to the line")]
IDENT_METRICS=["poss_pg","three_pa_rate","top_scorer_share"]

def pctl_fn(sorted_arr):
    n=len(sorted_arr)
    def f(v):
        if v is None or n==0: return None
        return int(round(np.searchsorted(sorted_arr,v,side="right")/n*100))
    return f

def ncaa_label(res, seed):
    if not res: return None
    m={"Champion":"National Champions","Champions":"National Champions","Runner-Up":"National Runner-Up",
       "Final Four":"Final Four","Final 4":"Final Four","Elite Eight":"Elite Eight","Elite 8":"Elite Eight",
       "Sweet Sixteen":"Sweet 16","Sweet 16":"Sweet 16","Round of 32":"Round of 32","2nd Round":"Round of 32",
       "Round of 64":"Round of 64","1st Round":"Round of 64","First Round":"Round of 64"}
    lbl=m.get(res, res)
    return lbl

def main():
    os.makedirs(OUTDIR,exist_ok=True)

    print("fetching graded player-seasons…")
    bb=[]
    for yr in range(2007,2027):
        bb+=get_all("bbref_seasons?select=school_slug,season_year,player,espn_id,tdc_grade,pos&tdc_grade=not.is.null&season_year=eq.%d"%yr)
    print("  %d rows"%len(bb))
    idx=defaultdict(list)   # (school_slug, year) -> [rows]
    for r in bb:
        if r.get("school_slug") and r.get("espn_id"):
            idx[(r["school_slug"],r["season_year"])].append(r)

    print("fetching team_seasons (srs / ncaa result)…")
    ts=get_all("team_seasons?select=team,season_year,srs,wins,losses,ncaa_result,ncaa_seed,conf_champ")
    ts_by_key=defaultdict(list)   # stripped name -> [rows]; may collide (Alabama vs Alabama State)
    for r in ts:
        for k in keys(r["team"]): ts_by_key[(k,r["season_year"])].append(r)
    # A coach's school ('Alabama') can strip-match several ESPN teams ('Alabama
    # Crimson Tide' AND 'Alabama State Hornets' both reduce to 'alabama'). Resolve
    # the collision with the SRS fingerprint from coach_seasons — the real program's
    # SRS (+25) is unmistakable next to the minor school's (-8).
    def resolve_team(school, yr, srs):
        cands=ts_by_key.get((norm(school),yr))
        if not cands: return None
        if len(cands)==1 or srs is None: return min(cands,key=lambda r:len(r["team"]))
        return min(cands,key=lambda r:abs((r["srs"] if r.get("srs") is not None else -999)-srs))

    print("indexing team_style + percentiles…")
    style_rows=json.load(open(os.path.join(D,"team_style.json")))
    style_by_name={(r["team"],r["season_year"]):r for r in style_rows}   # exact ESPN name
    style_by_key=defaultdict(list)                                       # fallback when unresolved
    for r in style_rows:
        for k in keys(r["team"]): style_by_key[(k,r["season_year"])].append(r)
    # per-metric percentile functions (pooled across all team-seasons)
    pct={}
    for m,_ in DIR_METRICS:
        vals=sorted(r[m] for r in style_rows if r.get(m) is not None)
        pct[m]=pctl_fn(np.array(vals,dtype=float))
    for m in IDENT_METRICS:
        vals=sorted(r[m] for r in style_rows if r.get(m) is not None)
        pct[m]=pctl_fn(np.array(vals,dtype=float))

    seasons=json.load(open(os.path.join(D,"coach_seasons.json")))

    # ── talent -> performance regressions (league-wide) ──
    print("fitting talent -> SRS / win% regressions…")
    T,S,W=[],[],[]
    for s in seasons:
        rows=idx.get((s["school_slug"],s["season_year"]))
        if not rows: continue
        tal=talent([int(r["tdc_grade"]) for r in rows])
        if tal is None: continue
        gp=(s.get("wins") or 0)+(s.get("losses") or 0)
        if s.get("srs") is not None: T.append(tal); S.append(s["srs"])
        if gp>0: W.append((tal, s["wins"]/gp))
    srs_m,srs_b=np.polyfit(T,S,1)
    wt=[x[0] for x in W]; wp=[x[1] for x in W]
    win_m,win_b=np.polyfit(wt,wp,1)
    print("  SRS = %.3f*talent %+.2f  (n=%d)"%(srs_m,srs_b,len(T)))
    print("  win%%= %.4f*talent %+.3f (n=%d)"%(win_m,win_b,len(W)))

    by_coach=defaultdict(list)
    for s in seasons:
        if s.get("coach_slug"): by_coach[s["coach_slug"]].append(s)

    written=0
    for slug,ss in by_coach.items():
        ss=sorted(ss,key=lambda x:-x["season_year"])   # newest first
        out_seasons=[]
        for s in ss:
            yr=s["season_year"]; nk=norm(s["school"])
            rows=idx.get((s["school_slug"],yr),[])
            roster=sorted(rows,key=lambda r:-int(r["tdc_grade"]))[:7]
            grades=[int(r["tdc_grade"]) for r in rows]
            tal=talent(grades)

            srs=s.get("srs"); wins=s.get("wins"); losses=s.get("losses")
            gp=(wins or 0)+(losses or 0)
            tm=resolve_team(s["school"],yr,srs) or {}
            st=style_by_name.get((tm.get("team"),yr)) if tm else None
            if not st:
                sc=style_by_key.get((nk,yr)); st=min(sc,key=lambda r:len(r["team"])) if sc else None
            pace=shot=star=None; strengths=[]; weaknesses=[]
            if st:
                pp=pct["poss_pg"](st.get("poss_pg"))
                pace="Up-tempo" if (pp or 0)>=70 else "Grind-it-out" if (pp is not None and pp<=30) else "Balanced tempo"
                tp=pct["three_pa_rate"](st.get("three_pa_rate"))
                shot="Three-heavy" if (tp or 0)>=70 else "Paint-focused" if (tp is not None and tp<=30) else "Balanced shot diet"
                sp=pct["top_scorer_share"](st.get("top_scorer_share"))
                star="Star-centric" if (sp or 0)>=70 else "Egalitarian" if (sp is not None and sp<=30) else "Balanced scoring"
                scored=[]
                for m,lbl in DIR_METRICS:
                    p=pct[m](st.get(m))
                    if p is not None: scored.append((lbl,p))
                strengths=[{"l":l,"p":p} for l,p in sorted(scored,key=lambda x:-x[1]) if p>=68][:3]
                weaknesses=[{"l":l,"p":p} for l,p in sorted(scored,key=lambda x:x[1]) if p<=32][:3]

            exp_srs=exp_wins=srs_lift=win_lift=None
            if tal is not None:
                if srs is not None:
                    exp_srs=round(srs_m*tal+srs_b,1); srs_lift=round(srs-exp_srs,1)
                if gp>0:
                    ewp=min(1.0,max(0.0,win_m*tal+win_b)); exp_wins=round(ewp*gp,1)
                    win_lift=round(wins-exp_wins,1)

            out_seasons.append({
                "yr":yr,"school":s["school"],"conf":s.get("conf"),
                "wins":wins,"losses":losses,"srs":round(srs,1) if srs is not None else None,
                "ncaa":ncaa_label(tm.get("ncaa_result"),tm.get("ncaa_seed")),"seed":tm.get("ncaa_seed"),
                "roster":[{"player":r["player"],"espn_id":r["espn_id"],"grade":int(r["tdc_grade"]),"pos":r.get("pos")} for r in roster],
                "talent":round(tal,1) if tal is not None else None,
                "pace":pace,"shot":shot,"star":star,
                "strengths":strengths,"weaknesses":weaknesses,
                "exp_srs":exp_srs,"srs_lift":srs_lift,
                "exp_wins":exp_wins,"win_lift":win_lift,
            })
        json.dump({"seasons":out_seasons},open(os.path.join(OUTDIR,slug+".json"),"w"))
        written+=1
    print("wrote %d coach rundown files to %s"%(written,OUTDIR))

    # validation
    for slug in ("nate-oats-1","mark-few-1","tommy-lloyd-1"):
        fp=os.path.join(OUTDIR,slug+".json")
        if os.path.exists(fp):
            d=json.load(open(fp))["seasons"]
            print("\n%s — %d seasons"%(slug,len(d)))
            for c in d[:3]:
                print("  %d %s: %s-%s SRS %s | exp_srs %s lift %s | exp_wins %s lift %s | %s%s"%(
                    c["yr"],c["school"],c["wins"],c["losses"],c["srs"],c["exp_srs"],c["srs_lift"],
                    c["exp_wins"],c["win_lift"],(c["pace"] or "?"),(" · "+c["ncaa"]) if c["ncaa"] else ""))
                print("     top3:",", ".join("%s(%d)"%(r["player"],r["grade"]) for r in c["roster"][:3]))
                print("     +:",[x["l"] for x in c["strengths"]]," -:",[x["l"] for x in c["weaknesses"]])

if __name__=="__main__": main()
