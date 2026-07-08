#!/usr/bin/env python3
"""
compute_player_development.py — how college careers arc, now filterable.

Rolls 20 years of graded player-seasons into:
  - buckets: a compact (year, conference, class, series) -> [sum,count] aggregation
    so the development curve can be filtered client-side by year range, conference
    and level (high/mid/low-major) in any combination.
  - risers / jumps / busts: biggest career climbs, single-season breakouts and
    declines, each tagged with conference + level + year for the same filtering.

Conference comes from team_seasons (comprehensive, per-year); level is derived
from a conference->tier classification. Output: scripts/data/development.json
"""
import json, os, re, urllib.request
from collections import defaultdict

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(__file__),"data")
OUT=os.path.join(D,"development.json")
CLS={"FR":1,"SO":2,"JR":3,"SR":4}

# conference (as stored in team_seasons) -> (display short name, level)
CONF={
 "Atlantic Coast Conference":("ACC","high"), "Big Ten Conference":("Big Ten","high"),
 "Big 12 Conference":("Big 12","high"), "Southeastern Conference":("SEC","high"),
 "Big East Conference":("Big East","high"), "Pac-12 Conference":("Pac-12","high"),
 "Atlantic 10 Conference":("Atlantic 10","mid"), "American Conference":("American","mid"),
 "Mountain West Conference":("Mountain West","mid"), "West Coast Conference":("West Coast","mid"),
 "Missouri Valley Conference":("Missouri Valley","mid"), "Conference USA":("C-USA","mid"),
 "Mid-American Conference":("MAC","mid"), "Sun Belt Conference":("Sun Belt","mid"),
 "Coastal Athletic Association":("CAA","mid"), "Big West Conference":("Big West","mid"),
 "Atlantic Sun Conference":("ASUN","low"), "Ohio Valley Conference":("Ohio Valley","low"),
 "Horizon League":("Horizon","low"), "Southwestern Athletic Conference":("SWAC","low"),
 "Patriot League":("Patriot","low"), "Big Sky Conference":("Big Sky","low"),
 "Metro Atlantic Athletic Conference":("MAAC","low"), "Mid-Eastern Athletic Conference":("MEAC","low"),
 "Northeast Conference":("Northeast","low"), "America East Conference":("America East","low"),
 "Big South Conference":("Big South","low"), "Ivy League":("Ivy","low"),
 "Summit League":("Summit","low"), "Mid Continent Conference":("Summit","low"),
 "Southland Conference":("Southland","low"), "Southern Conference":("Southern","low"),
 "United Athletic Conference":("United Athletic","low"), "Division I Independents":("Independent","low"),
}

def get_all(path):
    import time
    rows,frm=[],0
    while True:
        req=urllib.request.Request(SB+"/rest/v1/"+path,headers={**HDR,"Range-Unit":"items","Range":"%d-%d"%(frm,frm+999)})
        b=None
        for a in range(5):
            try: b=json.load(urllib.request.urlopen(req,timeout=90)); break
            except Exception: time.sleep(2*(a+1))
        if b is None: raise RuntimeError("fetch failed: "+path)
        rows+=b
        if len(b)<1000: break
        frm+=1000
    return rows

def norm(s): return re.sub(r"[^a-z0-9 ]","",(s or "").lower()).strip()

def build_school_conf():
    """ (year, plain_school) -> conference, from team_seasons full names.
        team names are 'Iowa Hawkeyes' etc; generate plain-name keys by dropping
        trailing mascot words so bbref's 'Iowa' matches. """
    ts=get_all("team_seasons?select=season_year,team,conference")
    byyear=defaultdict(dict); glob={}
    for r in ts:
        conf=r.get("conference");
        if not conf: continue
        w=norm(r["team"]).split()
        keys=set([norm(r["team"])])
        for i in (1,2,3):
            if len(w)>i: keys.add(" ".join(w[:-i]))
        for k in keys:
            byyear[r["season_year"]].setdefault(k,conf); glob.setdefault(k,conf)
    # supplement with the hand-curated conf_map (abbrev), mapped to a full name
    try:
        cm=json.load(open(os.path.join(D,"conf_map.json")))
        ABBR={"SEC":"Southeastern Conference","B10":"Big Ten Conference","BIG-12":"Big 12 Conference",
              "ACC":"Atlantic Coast Conference","Big-East":"Big East Conference","PAC-12":"Pac-12 Conference",
              "A10":"Atlantic 10 Conference","WCC":"West Coast Conference","AAC":"American Conference",
              "MWC":"Mountain West Conference","MVC":"Missouri Valley Conference","CUSA":"Conference USA",
              "MAC":"Mid-American Conference","Big West":"Big West Conference","CAA":"Coastal Athletic Association",
              "Big Sky":"Big Sky Conference","Sun Belt":"Sun Belt Conference","ASUN":"Atlantic Sun Conference",
              "MAAC":"Metro Atlantic Athletic Conference","OVC":"Ohio Valley Conference","NEC":"Northeast Conference",
              "SWAC":"Southwestern Athletic Conference","MEAC":"Mid-Eastern Athletic Conference"}
        for sch,ab in cm.get("school_conf",{}).items():
            full=ABBR.get(ab)
            if full: glob.setdefault(norm(sch),full)
    except Exception as e: print("conf_map supplement skipped:",e)
    return byyear,glob

def conf_of(school,year,byyear,glob):
    k=norm(school)
    return (byyear.get(year,{}).get(k)) or glob.get(k)

def co(c): return CLS.get((c or "").upper().replace("R-","")[:2],0)
def grp(p):
    p=(p or "").upper()
    return "G" if p in ("G","PG","SG") else "B" if p in ("C","PF","F-C","C-F") else "F"
SER={"G":0,"F":1,"B":2}

def main():
    byyear,glob=build_school_conf()
    rows=[]  # fetch per year so pagination stays shallow (deep offsets 500)
    for yr in range(2007,2027):
        rows+=get_all("bbref_seasons?select=espn_id,player,school,season_year,class,pos,tdc_grade&tdc_grade=not.is.null&espn_id=not.is.null&season_year=eq.%d"%yr)

    # tag every season with conference + level
    matched=0
    for r in rows:
        conf=conf_of(r["school"],r["season_year"],byyear,glob)
        r["_conf"],r["_lvl"]=(CONF.get(conf,(None,None)) if conf else (None,None))
        if r["_conf"]: matched+=1

    # curve buckets: (year, confShort, classNum, seriesIdx) -> [sum, count]
    agg=defaultdict(lambda:[0,0])
    for r in rows:
        o=co(r["class"]);
        if not o or not r["_conf"]: continue
        g=int(r["tdc_grade"]); s=SER[grp(r["pos"])]
        b=agg[(r["season_year"],r["_conf"],o,s)]; b[0]+=g; b[1]+=1
    buckets=[[y,c,o,s,v[0],v[1]] for (y,c,o,s),v in agg.items()]

    # ship a compact per-player career dataset so the risers/breakouts can be
    # recomputed client-side for ANY filter (always the true top-N of the slice,
    # not a slice of a global top-400 pool). schools + conferences are interned.
    confs=sorted({r["_conf"] for r in rows if r["_conf"]}, key=lambda c:({"high":0,"mid":1,"low":2}[CONF_LVL(c)],c))
    confidx={c:i for i,c in enumerate(confs)}
    schools=sorted({r["school"] for r in rows if r.get("school")})
    schidx={s:i for i,s in enumerate(schools)}
    years=sorted({r["season_year"] for r in rows})

    byp=defaultdict(list)
    for r in rows:
        try: byp[r["espn_id"]].append((int(r["season_year"]),r["player"],r["school"],int(r["tdc_grade"]),r["_conf"]))
        except Exception: pass
    players=[]
    for pid,ss in byp.items():
        ss.sort()
        if len(ss)<2: continue
        grades=[x[3] for x in ss]
        maxj=max((ss[i][3]-ss[i-1][3] for i in range(1,len(ss)) if ss[i][0]==ss[i-1][0]+1), default=0)
        if (max(grades)-grades[0])<3 and maxj<3: continue   # drop flat careers (never top a list)
        # season = [year, grade, confIdx, schoolIdx]
        seasons=[[x[0],x[3],confidx.get(x[4],-1),schidx.get(x[2],-1)] for x in ss]
        players.append([pid, ss[-1][1], seasons])

    out={"buckets":buckets,
         "conferences":[{"name":c,"level":CONF_LVL(c)} for c in confs],
         "schools":schools,
         "years":[years[0],years[-1]],
         "players":players,
         "total_seasons":len(rows),"matched_seasons":matched}
    json.dump(out,open(OUT,"w"))
    print("seasons:%d  conf-matched:%d (%.0f%%)  buckets:%d  confs:%d"%(
        len(rows),matched,100*matched/len(rows),len(buckets),len(confs)))
    print("years:",years[0],"-",years[-1]," players(>=2 seasons, non-flat):",len(players)," schools:",len(schools))

# level lookup by short conf name
_LVL={v[0]:v[1] for v in CONF.values()}
def CONF_LVL(c): return _LVL.get(c,"mid")

if __name__=="__main__": main()
