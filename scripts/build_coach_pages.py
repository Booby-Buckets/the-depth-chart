#!/usr/bin/env python3
"""
build_coach_pages.py — per-coach detail for the full coach pages.

Joins each coach's (school_slug, season_year) tenure to the graded players who
played for them (bbref_seasons), and computes:
  - best_team:    the coach's best single season (by SRS), with that roster's top players
  - best_players: the 10 best players they ever coached (peak TDC grade under them)
  - dev_players:  the 10 biggest developers under them (grade gain first->peak under coach)
  - totals:       distinct players coached, NCAA-tournament appearances/wins

Output: scripts/data/coach_pages.json  (keyed by coach_slug), loaded by coach.html
"""
import json, os, urllib.request
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

def main():
    print("fetching graded player-seasons…")
    bb=[]  # fetch per year so pagination stays shallow (deep offsets time out)
    for yr in range(2007,2027):
        bb+=get_all("bbref_seasons?select=school_slug,season_year,player,espn_id,tdc_grade,pos,class&tdc_grade=not.is.null&season_year=eq.%d"%yr)
    print("  %d rows"%len(bb))
    # index by (school_slug, year)
    idx=defaultdict(list)
    for r in bb:
        if r.get("school_slug") and r.get("espn_id"):
            idx[(r["school_slug"],r["season_year"])].append(r)

    # NCAA tournament games (for appearances/wins per school-year)
    print("fetching NCAA tournament games…")
    pg=get_all("postseason_games?tournament=eq.NCAA%20Tournament&select=season_year,home_id,away_id,winner_id,home,away,winner")
    # map (school name, year) -> games; but we key coaches by slug/school name. Build by school display name.
    import re
    def norm(s): return re.sub(r"[^a-z0-9 ]","",(s or "").lower()).strip()
    def keys(full):
        # postseason names are full ('Gonzaga Bulldogs'); generate mascot-stripped
        # candidates so they match coach_seasons.school ('Gonzaga')
        w=norm(full).split(); out={norm(full)}
        for i in (1,2):
            if len(w)>i: out.add(" ".join(w[:-i]))
        return out
    tny=defaultdict(lambda:[0,0])  # (normschool, year) -> [appearances(1), wins]
    for g in pg:
        for side in ("home","away"):
            nm=g.get(side)
            if not nm: continue
            won=(g.get("winner")==nm)
            for k in keys(nm):
                key=(k,g["season_year"]); tny[key][0]=1
                if won: tny[key][1]+=1

    seasons=json.load(open(os.path.join(D,"coach_seasons.json")))
    by_coach=defaultdict(list)
    for s in seasons:
        if s.get("coach_slug"): by_coach[s["coach_slug"]].append(s)

    out={}
    for slug,ss in by_coach.items():
        ss=sorted(ss,key=lambda x:x["season_year"])
        # collect player-seasons under this coach, keyed by player
        pl=defaultdict(list)   # espn_id -> [(year, grade, name, pos)]
        tny_app=0; tny_wins=0
        for s in ss:
            for r in idx.get((s["school_slug"],s["season_year"]),[]):
                pl[r["espn_id"]].append((s["season_year"],int(r["tdc_grade"]),r["player"],r["pos"]))
            a=tny.get((norm(s["school"]),s["season_year"]))
            if a: tny_app+=a[0]; tny_wins+=a[1]

        # best players: peak grade under coach
        bestp=[]
        for eid,rows in pl.items():
            rows=sorted(rows)
            peak=max(rows,key=lambda x:x[1])
            bestp.append({"espn_id":eid,"player":peak[2],"pos":peak[3],"grade":peak[1],
                          "seasons":len(rows),"years":[rows[0][0],rows[-1][0]]})
        bestp.sort(key=lambda x:(-x["grade"],-x["seasons"]))
        best_players=bestp[:10]

        # dev players: biggest grade gain (first -> peak) among >=2 seasons under coach
        devs=[]
        for eid,rows in pl.items():
            if len(rows)<2: continue
            rows=sorted(rows)
            first=rows[0]; peak=max(rows,key=lambda x:x[1])
            if peak[0]<=first[0]: continue
            gain=peak[1]-first[1]
            if gain<=0: continue
            devs.append({"espn_id":eid,"player":peak[2],"pos":peak[3],"from":first[1],"to":peak[1],
                         "gain":gain,"from_year":first[0],"to_year":peak[0]})
        devs.sort(key=lambda x:(-x["gain"],-x["to"]))
        dev_players=devs[:10]

        # best team: best season by SRS
        bt=max(ss,key=lambda x:(x.get("srs") if x.get("srs") is not None else -99))
        bt_roster=sorted(idx.get((bt["school_slug"],bt["season_year"]),[]),key=lambda r:-int(r["tdc_grade"]))[:6]
        best_team={"school":bt["school"],"year":bt["season_year"],"wins":bt["wins"],"losses":bt["losses"],
                   "srs":bt.get("srs"),"conf":bt.get("conf"),
                   "roster":[{"player":r["player"],"espn_id":r["espn_id"],"grade":int(r["tdc_grade"]),"pos":r["pos"]} for r in bt_roster]}

        out[slug]={"best_team":best_team,"best_players":best_players,"dev_players":dev_players,
                   "players_coached":len(pl),"tny_apps":tny_app,"tny_wins":tny_wins}

    json.dump(out,open(os.path.join(D,"coach_pages.json"),"w"))
    print("wrote coach_pages.json for %d coaches"%len(out))
    f=out.get("mark-few-1")
    if f:
        print("Mark Few — players coached:%d  tourney: %d apps / %d wins"%(f["players_coached"],f["tny_apps"],f["tny_wins"]))
        print("  best team:",f["best_team"]["year"],f["best_team"]["school"],f["best_team"]["wins"],"-",f["best_team"]["losses"])
        print("  best players:",[ "%s(%d)"%(p["player"],p["grade"]) for p in f["best_players"][:5]])
        print("  top developers:",[ "%s %d->%d"%(p["player"],p["from"],p["to"]) for p in f["dev_players"][:4]])

if __name__=="__main__": main()
