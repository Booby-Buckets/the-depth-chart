#!/usr/bin/env python3
"""
Add opponent-adjusted efficiency (adjO / adjD / adjNet) to scripts/data/team_dna.json.

The stored ORtg/DRtg/net are RAW — averaged over a team's games with no strength-of-
schedule adjustment — so mid-majors that blow out weak conferences show elite raw net
ratings (High Point +18.6, Saint Mary's +19.8) next to real high-majors. This runs a
KenPom-style iterative adjustment using each team's actual schedule (from the games
table) to solve for schedule-adjusted offense/defense, anchored to the season league
average. Read-only (public anon key); no box-score re-pull needed — it reuses the raw
per-team O/D already in team_dna.json plus the opponent list from `games`.

Usage: python3 scripts/adjust_team_dna.py [season ...]   (default: all actual seasons)
"""
import json, sys, urllib.request, urllib.parse, os

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H={"apikey":KEY,"Authorization":"Bearer "+KEY}
PATH=os.path.join(os.path.dirname(__file__),"data","team_dna.json")

def get(url):
    req=urllib.request.Request(url,headers=H)
    with urllib.request.urlopen(req,timeout=60) as r:
        return json.loads(r.read().decode())

def fetch_games(year):
    out=[]; page=0
    while True:
        url=(f"{SB}/rest/v1/games?select=home,away,home_score,away_score&season_year=eq.{year}"
             f"&status=eq.STATUS_FINAL&limit=1000&offset={page*1000}")
        rows=get(url)
        out+=rows
        if len(rows)<1000: break
        page+=1
    return out

def fix_records(teams, games):
    """Recount W/L from the authoritative `games` table (the swept W/L is counted
    from box-score point sums, which are wrong for ~half of teams when box data is
    incomplete). Also recompute exp_wins (Pythagorean over the true game count) and
    luck = actual W - exp_wins. Returns count of corrected teams."""
    rec={}
    for g in games:
        for side,my,op in [(g.get("home"),g.get("home_score"),g.get("away_score")),
                           (g.get("away"),g.get("away_score"),g.get("home_score"))]:
            if side is None or my is None or op is None: continue
            r=rec.setdefault(side,[0,0])
            if my>op: r[0]+=1
            else: r[1]+=1
    fixed=0
    for name,t in teams.items():
        if name not in rec: continue
        w,l=rec[name]; g=w+l
        if g<1: continue
        oR=t.get("ORtg"); dR=t.get("DRtg")
        if oR and dR:
            pyth=oR**11.5/(oR**11.5+dR**11.5)
            t["exp_wins"]=round(pyth*g,1); t["luck"]=round(w-pyth*g,1)
        if t.get("w")!=w or t.get("l")!=l: fixed+=1
        t["w"]=w; t["l"]=l
    return fixed

def adjust(teams, games, iters=60):
    """Opponent-adjusted efficiency. Single-rating SRS on net efficiency margin
    (rating = MOV + mean-opponent-rating, mean-centered each pass -> converges), then
    split the schedule adjustment evenly into adjO/adjD. teams: {name:{ORtg,DRtg}}.
    Returns {name:(adjO,adjD)}."""
    have=set(t for t,v in teams.items() if v.get("ORtg") is not None and v.get("DRtg") is not None)
    sched={t:[] for t in have}
    for g in games:
        h,a=g.get("home"),g.get("away")
        if h in have and a in have:
            sched[h].append(a); sched[a].append(h)
    played=[t for t in have if sched[t]]
    if not played: return {}
    rawO={t:float(teams[t]["ORtg"]) for t in played}
    rawD={t:float(teams[t]["DRtg"]) for t in played}
    lg=sum(rawO[t] for t in played)/len(played)          # league avg efficiency (≈ avg O ≈ avg D)
    rawNet={t:rawO[t]-rawD[t] for t in played}
    rating=dict(rawNet)
    for _ in range(iters):
        new={t:rawNet[t]+sum(rating[o] for o in sched[t])/len(sched[t]) for t in played}
        m=sum(new.values())/len(played)                  # center to 0 each pass (net margins sum ~0)
        rating={t:new[t]-m for t in played}
    # Pure SRS gives the correct ORDER but over-widens the top (assortative schedules
    # compound). Rescale the spread to match the raw net-efficiency spread so magnitudes
    # stay realistic (a matchup projection uses these), keeping the schedule-adjusted order.
    import statistics
    rawMean=sum(rawNet.values())/len(played)
    sdRaw=statistics.pstdev(rawNet.values()); sdRate=statistics.pstdev(rating.values()) or 1
    sc=sdRaw/sdRate
    res={}
    for t in have:
        if t in played:
            adjNet=rating[t]*sc+rawMean                   # scaled, schedule-adjusted net
            sos=adjNet-rawNet[t]                          # total schedule adjustment
            res[t]=(round(rawO[t]+sos/2,1), round(rawD[t]-sos/2,1))
        else:
            res[t]=(round(float(teams[t]["ORtg"]),1), round(float(teams[t]["DRtg"]),1))
    return res

def main():
    dna=json.load(open(PATH))
    seasons=sys.argv[1:] or [s for s in dna if s.isdigit() and s!="2027"]
    for s in sorted(seasons):
        if s not in dna: print(f"  {s}: not in team_dna"); continue
        teams=dna[s]["teams"]
        games=fetch_games(int(s))
        rfixed=fix_records(teams,games)
        res=adjust(teams,games)
        if not res: print(f"  {s}: no adjustable teams"); continue
        for t,(ao,ad) in res.items():
            teams[t]["adjO"]=ao; teams[t]["adjD"]=ad; teams[t]["adjNet"]=round(ao-ad,1)
        json.dump(dna,open(PATH,"w"),separators=(",",":"))
        top=sorted(res.items(),key=lambda kv:kv[1][0]-kv[1][1],reverse=True)[:8]
        print(f"  {s}: adjusted {len(res)} teams, fixed {rfixed} records, from {len(games)} games")
        for t,(ao,ad) in top:
            raw=dna[s]['teams'][t].get('net')
            print(f"      {t:30} adjNet {ao-ad:+6.1f}  (raw net {raw:+6.1f})")

if __name__=="__main__":
    main()
