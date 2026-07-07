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
    rows,frm=[],0
    while True:
        req=urllib.request.Request(SB+"/rest/v1/"+path,headers={**HDR,"Range-Unit":"items","Range":"%d-%d"%(frm,frm+999)})
        b=json.load(urllib.request.urlopen(req,timeout=60)); rows+=b
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
    rows=get_all("bbref_seasons?select=espn_id,player,school,season_year,class,pos,tdc_grade&tdc_grade=not.is.null&espn_id=not.is.null")

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

    # per-player arcs
    byp=defaultdict(list)
    for r in rows:
        try: byp[r["espn_id"]].append((int(r["season_year"]),r["player"],r["school"],int(r["tdc_grade"]),r["_conf"],r["_lvl"]))
        except Exception: pass
    risers=[]; jumps=[]; busts=[]
    for pid,ss in byp.items():
        ss.sort()
        if len(ss)<2: continue
        first=ss[0]; peak=max(ss,key=lambda x:x[3]); last=ss[-1]; nm=ss[-1][1]
        if first[3]<=93:
            risers.append({"espn_id":pid,"player":nm,"from_school":first[2],"peak_school":peak[2],
                "from_year":first[0],"peak_year":peak[0],"from":first[3],"peak":peak[3],"gain":peak[3]-first[3],
                "seasons":len(ss),"conf":peak[4],"lvl":peak[5],"year":peak[0]})
        for i in range(1,len(ss)):
            jumps.append({"espn_id":pid,"player":nm,"school":ss[i][2],"year":ss[i][0],
                "from":ss[i-1][3],"to":ss[i][3],"jump":ss[i][3]-ss[i-1][3],"conf":ss[i][4],"lvl":ss[i][5]})
        busts.append({"espn_id":pid,"player":nm,"school":last[2],"from":first[3],"to":last[3],
            "drop":last[3]-first[3],"seasons":len(ss),"conf":peak[4],"lvl":peak[5],"year":last[0]})

    # keep a generous pool so filtered views still have depth
    risers=sorted(risers,key=lambda x:-x["gain"])[:400]
    jumps=sorted(jumps,key=lambda x:-x["jump"])[:400]
    busts=sorted(busts,key=lambda x:x["drop"])[:200]

    confs=sorted({r["_conf"] for r in rows if r["_conf"]}, key=lambda c:({"high":0,"mid":1,"low":2}[CONF_LVL(c)],c))
    years=sorted({r["season_year"] for r in rows})
    out={"buckets":buckets,
         "conferences":[{"name":c,"level":CONF_LVL(c)} for c in confs],
         "years":[years[0],years[-1]],
         "risers":risers,"jumps":jumps,"busts":busts,
         "total_seasons":len(rows),"matched_seasons":matched}
    json.dump(out,open(OUT,"w"))
    print("seasons:%d  conf-matched:%d (%.0f%%)  buckets:%d  confs:%d"%(
        len(rows),matched,100*matched/len(rows),len(buckets),len(confs)))
    print("years:",years[0],"-",years[-1])
    print("top risers:",[ "%s +%d"%(r["player"],r["gain"]) for r in risers[:4]])

# level lookup by short conf name
_LVL={v[0]:v[1] for v in CONF.values()}
def CONF_LVL(c): return _LVL.get(c,"mid")

if __name__=="__main__": main()
