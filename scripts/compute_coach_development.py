#!/usr/bin/env python3
"""
compute_coach_development.py — "who gets the most (or least) out of their players."

For every player who ran it back at the same school under the same coach, we
measure their year-over-year TDC-grade change, then subtract the LEAGUE-AVERAGE
change for that class jump (Fr→So players improve on their own — we only want
the part the coach is responsible for). A coach's development score is the mean
of that residual across all their returners.

Merges dev fields into scripts/data/coach_profiles.json:
  dev_delta  — avg grade improvement vs expected (the headline number)
  dev_raw    — avg raw grade change
  dev_n      — returner-transitions in the sample
  dev_pctl   — 0-100 vs all coaches with a meaningful sample
Optionally --upload to patch coach_profiles in Supabase.

Usage:  python3 scripts/compute_coach_development.py
"""
import json, os, sys, urllib.request
from collections import defaultdict

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(__file__),"data")
CLS={"FR":1,"SO":2,"JR":3,"SR":4}
MIN_N=8   # returner-transitions needed to earn a percentile

def cls_ord(c):
    c=(c or "").upper().replace("R-","").strip()
    return CLS.get(c[:2],0)

def fetch_grades():
    rows,frm=[],0
    while True:
        url=SB+"/rest/v1/bbref_seasons?select=espn_id,season_year,school_slug,class,tdc_grade&espn_id=not.is.null&tdc_grade=not.is.null&school_slug=not.is.null"
        req=urllib.request.Request(url,headers={**HDR,"Range-Unit":"items","Range":"%d-%d"%(frm,frm+999)})
        try:
            with urllib.request.urlopen(req,timeout=60) as r: b=json.load(r)
        except Exception as e: print("fetch err @%d %s"%(frm,e)); break
        rows+=b
        if len(b)<1000: break
        frm+=1000
        if frm%10000==0: print("  fetched",frm)
    return rows

def main():
    coach_seasons=json.load(open(os.path.join(D,"coach_seasons.json")))
    coach_at={(r["school_slug"],r["season_year"]):(r.get("coach_slug"),r.get("coach")) for r in coach_seasons}
    print("fetching graded player-seasons…")
    grades=fetch_grades()
    print("  %d rows"%len(grades))

    # group by player (espn_id) -> season rows
    byp=defaultdict(list)
    for g in grades:
        try: byp[g["espn_id"]].append((int(g["season_year"]),g["school_slug"],g.get("class"),int(g["tdc_grade"])))
        except Exception: pass

    # collect returner transitions (same school + same coach in both years)
    trans=[]   # (coach_slug, coach, from_ord, to_ord, delta_grade)
    for pid,seasons in byp.items():
        seasons.sort()
        for i in range(1,len(seasons)):
            y0,s0,c0,g0=seasons[i-1]; y1,s1,c1,g1=seasons[i]
            if y1!=y0+1 or s1!=s0: continue                 # consecutive, same school
            co0=coach_at.get((s0,y0)); co1=coach_at.get((s1,y1))
            if not co1 or not co0 or co1[0]!=co0[0] or not co1[0]: continue   # same coach both years
            o0,o1=cls_ord(c0),cls_ord(c1)
            trans.append((co1[0],co1[1],o0,o1,g1-g0))

    # league expected grade change per class transition
    exp_sum=defaultdict(float); exp_n=defaultdict(int)
    for cs,cn,o0,o1,d in trans:
        exp_sum[(o0,o1)]+=d; exp_n[(o0,o1)]+=1
    expected={k:exp_sum[k]/exp_n[k] for k in exp_sum}

    # per-coach residual (actual - expected)
    dev=defaultdict(lambda:{"res":0.0,"raw":0.0,"n":0})
    for cs,cn,o0,o1,d in trans:
        e=expected.get((o0,o1),0.0)
        dv=dev[cs]; dv["res"]+=(d-e); dv["raw"]+=d; dv["n"]+=1

    profiles=json.load(open(os.path.join(D,"coach_profiles.json")))
    # attach
    scores=[]
    for P in profiles:
        d=dev.get(P["coach_slug"])
        if d and d["n"]>0:
            P["dev_delta"]=round(d["res"]/d["n"],2); P["dev_raw"]=round(d["raw"]/d["n"],2); P["dev_n"]=d["n"]
            if d["n"]>=MIN_N: scores.append(P["dev_delta"])
        else:
            P["dev_delta"]=None; P["dev_raw"]=None; P["dev_n"]=0
    scores.sort()
    def pctl(v):
        if v is None or not scores: return None
        return round(sum(1 for x in scores if x<=v)/len(scores)*100)
    for P in profiles:
        P["dev_pctl"]=pctl(P["dev_delta"]) if (P.get("dev_n") or 0)>=MIN_N else None

    json.dump(profiles,open(os.path.join(D,"coach_profiles.json"),"w"))
    print("transitions: %d  coaches with dev: %d  qualified(n>=%d): %d"%(
        len(trans),sum(1 for P in profiles if P.get("dev_n")),MIN_N,len(scores)))
    print("expected grade change by class jump:",{f"{k[0]}->{k[1]}":round(v,2) for k,v in sorted(expected.items()) if exp_n[k]>=50})
    rated=[P for P in profiles if P.get("dev_pctl") is not None]
    print("\n-- develops players MOST (vs expected) --")
    for P in sorted(rated,key=lambda x:-x["dev_delta"])[:6]:
        print("  %-22s %+.2f/yr  (raw %+.2f, n=%d)  %s"%(P["coach"][:22],P["dev_delta"],P["dev_raw"],P["dev_n"],P["archetype"]))
    print("-- develops players LEAST --")
    for P in sorted(rated,key=lambda x:x["dev_delta"])[:5]:
        print("  %-22s %+.2f/yr  (raw %+.2f, n=%d)"%(P["coach"][:22],P["dev_delta"],P["dev_raw"],P["dev_n"]))

    if "--upload" in sys.argv:
        for P in profiles:
            body=json.dumps({"dev_delta":P["dev_delta"],"dev_raw":P["dev_raw"],"dev_n":P["dev_n"],"dev_pctl":P["dev_pctl"]}).encode()
            req=urllib.request.Request(SB+"/rest/v1/coach_profiles?coach_slug=eq."+P["coach_slug"],data=body,method="PATCH",
                headers={**HDR,"Content-Type":"application/json"})
            try: urllib.request.urlopen(req,timeout=30).read()
            except Exception: pass

if __name__=="__main__": main()
