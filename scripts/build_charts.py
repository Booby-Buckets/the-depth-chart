#!/usr/bin/env python3
"""
build_charts.py — precompute datasets for the analytics visualizations, shipped
as small JSONs (same pattern as the other scripts/data/*.json files).

Outputs:
  data/chart_quadrant.json  team offensive vs defensive efficiency (current season)
  data/chart_bubbles.json   player scoring volume vs efficiency (current season)
  data/chart_march.json     tournament-team scoring: regular season vs NCAA tourney, by year
  data/chart_dropoff.json   current tourney teams' offensive rating: reg season -> March

Efficiency is tempo-free: points per 100 possessions, poss = FGA + 0.44*FTA - OREB + TOV.
"""
import json, os, sys, time, urllib.request, urllib.parse
from collections import defaultdict

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(__file__),"data")
CUR=2026                                   # fallback; auto-detected below so it advances yearly

def get(path):
    for a in range(5):
        try:
            req=urllib.request.Request(SB+"/rest/v1/"+path,headers=HDR)
            with urllib.request.urlopen(req,timeout=60) as r: return json.load(r)
        except Exception as e:
            if a==4: raise
            time.sleep(2*(a+1))

def _latest_ncaa_season(fb):
    """Latest season with a completed NCAA tournament — so the 'offense held up in
    March' + dropoff charts advance to the current year automatically each season."""
    try:
        r=get("postseason_games?tournament=eq.NCAA%20Tournament&select=season_year&order=season_year.desc&limit=1")
        return int(r[0]["season_year"]) if r else fb
    except Exception:
        return fb
CUR=_latest_ncaa_season(CUR)

def get_all(path, page=1000):
    """paged fetch via Range header"""
    out=[]; frm=0
    while True:
        for a in range(5):
            try:
                req=urllib.request.Request(SB+"/rest/v1/"+path,
                    headers={**HDR,"Range-Unit":"items","Range":"%d-%d"%(frm,frm+page-1)})
                b=json.load(urllib.request.urlopen(req,timeout=90)); break
            except Exception:
                if a==4: b=[]; break
                time.sleep(2*(a+1))
        out+=b
        if len(b)<page: break
        frm+=page
    return out

def poss(t): return t["fga"]+0.44*t["fta"]-t["oreb"]+t["tov"]

# ── fetch current-season box scores once (drives quadrant + bubbles + tourney offense) ──
def season_boxscores(year):
    print("fetching %d box scores…"%year)
    rows=get_all("box_scores?season_year=eq.%d&select=game_id,team,opp,pts,fga,fta,oreb,tov,tpm,espn_id,player"%year)
    print("  %d rows"%len(rows))
    return rows

def team_game_totals(rows):
    """(game_id,team) -> summed team totals"""
    tg=defaultdict(lambda:{"pts":0,"fga":0,"fta":0,"oreb":0,"tov":0,"opp":None})
    for r in rows:
        k=(r["game_id"],r["team"])
        t=tg[k]
        for f in ("pts","fga","fta","oreb","tov"): t[f]+=r.get(f) or 0
        t["opp"]=r.get("opp")
    return tg

def build_quadrant(rows, teamseasons):
    d1={t["team"]:t for t in teamseasons}         # D-1 teams this season
    tg=team_game_totals(rows)
    # opponent points per (game_id, team): the other team's pts in that game
    game_teams=defaultdict(dict)                    # game_id -> {team: totals}
    for (gid,team),t in tg.items(): game_teams[gid][team]=t
    agg=defaultdict(lambda:{"pf":0,"pa":0,"po":0.0,"pd":0.0,"g":0})
    for gid,teams in game_teams.items():
        if len(teams)!=2: continue
        names=list(teams.keys())
        for i,nm in enumerate(names):
            opp=names[1-i]; me=teams[nm]; ot=teams[opp]
            a=agg[nm]; a["pf"]+=me["pts"]; a["pa"]+=ot["pts"]
            a["po"]+=poss(me); a["pd"]+=poss(ot); a["g"]+=1
    out=[]
    for nm,a in agg.items():
        if nm not in d1 or a["po"]<50 or a["g"]<12: continue
        ortg=100*a["pf"]/a["po"]; drtg=100*a["pa"]/a["pd"]
        ts=d1[nm]
        out.append({"team":nm,"team_id":ts.get("team_id"),"conf":ts.get("conference"),
            "ortg":round(ortg,1),"drtg":round(drtg,1),"net":round(ortg-drtg,1),
            "w":ts.get("wins"),"l":ts.get("losses"),"seed":ts.get("ncaa_seed"),"g":a["g"]})
    out.sort(key=lambda x:-x["net"])
    return out

def build_bubbles(rows, top=70):
    pl=defaultdict(lambda:{"pts":0,"fga":0,"fta":0,"tpm":0,"name":None,"team":None,"g":set()})
    for r in rows:
        eid=r.get("espn_id");
        if not eid: continue
        p=pl[eid]
        for f in ("pts","fga","fta","tpm"): p[f]+=r.get(f) or 0
        p["name"]=r.get("player"); p["team"]=r.get("team"); p["g"].add(r.get("game_id"))
    out=[]
    for eid,p in pl.items():
        tsa=p["fga"]+0.44*p["fta"]
        if tsa<50: continue
        ts=p["pts"]/(2*tsa) if tsa else 0
        out.append({"espn_id":eid,"player":p["name"],"team":p["team"],"pts":p["pts"],
            "fga":p["fga"],"ts":round(ts*100,1),"g":len(p["g"])})
    out.sort(key=lambda x:-x["pts"])
    return out[:top]

def build_march():
    """tournament teams: regular-season scoring vs their NCAA-tournament scoring, by year"""
    out=[]
    for yr in range(2001,CUR+1):
        ts=get("team_seasons?season_year=eq.%d&ncaa_seed=not.is.null&select=team,ppg"%yr)
        if not ts: continue
        reg=sum(t["ppg"] for t in ts if t.get("ppg"))/max(1,len([t for t in ts if t.get("ppg")]))
        pg=get("postseason_games?tournament=eq.NCAA%%20Tournament&season_year=eq.%d&select=home_score,away_score"%yr)
        scores=[]
        for g in pg:
            if g.get("home_score") is not None: scores.append(g["home_score"])
            if g.get("away_score") is not None: scores.append(g["away_score"])
        if not scores: continue
        tny=sum(scores)/len(scores)
        out.append({"year":yr,"reg":round(reg,1),"tny":round(tny,1),"diff":round(tny-reg,1)})
    return out

def build_dropoff(quadrant, cur_rows):
    """current tourney teams: reg-season ORtg (full season) vs NCAA-tourney ORtg"""
    pg=get("postseason_games?tournament=eq.NCAA%%20Tournament&season_year=eq.%d&select=id,home,away,home_id,away_id"%CUR)
    tny_ids=set(g["id"] for g in pg)
    if not tny_ids: return []
    # tourney box scores
    idlist=",".join(str(i) for i in tny_ids)
    trows=get_all("box_scores?game_id=in.(%s)&select=game_id,team,pts,fga,fta,oreb,tov"%idlist)
    tg=team_game_totals(trows)
    tny=defaultdict(lambda:{"pts":0,"po":0.0,"g":0})
    for (gid,team),t in tg.items():
        a=tny[team]; a["pts"]+=t["pts"]; a["po"]+=poss(t); a["g"]+=1
    regmap={q["team"]:q for q in quadrant}
    out=[]
    for team,a in tny.items():
        if a["po"]<20 or team not in regmap: continue
        tny_ortg=100*a["pts"]/a["po"]
        reg_ortg=regmap[team]["ortg"]
        out.append({"team":team,"team_id":regmap[team]["team_id"],"seed":regmap[team]["seed"],
            "reg":round(reg_ortg,1),"tny":round(tny_ortg,1),"diff":round(tny_ortg-reg_ortg,1),
            "games":a["g"],"season":CUR})
    out.sort(key=lambda x:-x["reg"])
    return out

def build_dropoff_all(first=2008):
    """EVERY season's tourney teams, regular season (tourney games excluded) vs NCAA tournament, on
    a whole profile: ORtg, DRtg, net, pace, eFG%, 3P%, 3PA rate, FT rate, TOV%, OREB%, opp eFG%.
    Pulls the tourney teams' box rows AND their opponents' rows (team=in / opp=in) so every game
    has both sides. Top-level reg/tny/diff stay = ORtg for the legacy single-metric reader."""
    SEL="game_id,team,opp,pts,fga,fgm,tpa,tpm,fta,oreb,dreb,tov"
    out=[]
    for yr in range(first, CUR+1):
        pg=get("postseason_games?tournament=eq.NCAA%%20Tournament&season_year=eq.%d&select=id,home,away"%yr)
        if not pg: continue
        tny_ids=set(g["id"] for g in pg)
        teams=sorted(set([g["home"] for g in pg]+[g["away"] for g in pg]))
        q=urllib.parse.quote(",".join('"%s"'%t for t in teams))
        ts={t["team"]:t for t in get("team_seasons?season_year=eq.%d&select=team,team_id,ncaa_seed&team=in.(%s)"%(yr,q))}
        rows=get_all("box_scores?season_year=eq.%d&team=in.(%s)&select=%s"%(yr,q,SEL))+get_all("box_scores?season_year=eq.%d&opp=in.(%s)&select=%s"%(yr,q,SEL))
        tg=defaultdict(lambda:{"pts":0,"fga":0,"fgm":0,"tpa":0,"tpm":0,"fta":0,"oreb":0,"dreb":0,"tov":0,"opp":None})
        seen=set()
        for r in rows:
            k=(r["game_id"],r["team"],r.get("player") or id(r))   # dedupe rows that came back from both pulls
            k2=(r["game_id"],r["team"],r["pts"],r["fga"],r["fta"],r["oreb"],r["tov"],r.get("fgm"),r.get("tpa"),r.get("dreb"))
            if k2 in seen: continue
            seen.add(k2)
            t=tg[(r["game_id"],r["team"])]
            for f in ("pts","fga","fgm","tpa","tpm","fta","oreb","dreb","tov"): t[f]+=r.get(f) or 0
            t["opp"]=r.get("opp")
        games=defaultdict(dict)
        for (gid,team),t in tg.items(): games[gid][team]=t
        Z=lambda:{"pf":0,"pa":0,"po":0.0,"pd":0.0,"fga":0,"fgm":0,"tpa":0,"tpm":0,"fta":0,"oreb":0,"dreb":0,"tov":0,"ofga":0,"ofgm":0,"otpm":0,"odreb":0,"g":0}
        reg=defaultdict(Z); tny=defaultdict(Z)
        for gid,sides in games.items():
            if len(sides)!=2: continue
            names=list(sides.keys())
            for i,nm in enumerate(names):
                if nm not in ts: continue
                me=sides[nm]; ot=sides[names[1-i]]
                a=(tny if gid in tny_ids else reg)[nm]
                a["pf"]+=me["pts"]; a["pa"]+=ot["pts"]; a["po"]+=poss(me); a["pd"]+=poss(ot); a["g"]+=1
                for f in ("fga","fgm","tpa","tpm","fta","oreb","dreb","tov"): a[f]+=me[f]
                a["ofga"]+=ot["fga"]; a["ofgm"]+=ot["fgm"]; a["otpm"]+=ot["tpm"]; a["odreb"]+=ot["dreb"]
        def prof(a):
            if a["po"]<20 or a["g"]<1: return None
            efg=lambda m,t3,att: (100.0*(m+0.5*t3)/att) if att else None
            return {"o":round(100*a["pf"]/a["po"],1),"d":round(100*a["pa"]/a["pd"],1),
                    "net":round(100*a["pf"]/a["po"]-100*a["pa"]/a["pd"],1),"pace":round(a["po"]/a["g"],1),
                    "efg":round(efg(a["fgm"],a["tpm"],a["fga"]) or 0,1),"tp":round(100.0*a["tpm"]/a["tpa"],1) if a["tpa"] else None,
                    "tpr":round(100.0*a["tpa"]/a["fga"],1) if a["fga"] else None,"ftr":round(100.0*a["fta"]/a["fga"],1) if a["fga"] else None,
                    "tov":round(100.0*a["tov"]/a["po"],1),"oreb":round(100.0*a["oreb"]/(a["oreb"]+a["odreb"]),1) if (a["oreb"]+a["odreb"]) else None,
                    "oefg":round(efg(a["ofgm"],a["otpm"],a["ofga"]) or 0,1),"g":a["g"]}
        n=0
        for team,a in tny.items():
            r=reg.get(team)
            if not r or r["g"]<12: continue
            R,T=prof(r),prof(a)
            if not R or not T: continue
            t=ts.get(team,{})
            out.append({"team":team,"team_id":t.get("team_id"),"seed":t.get("ncaa_seed"),"season":yr,"games":T["g"],
                        "reg":R["o"],"tny":T["o"],"diff":round(T["o"]-R["o"],1),"R":R,"T":T}); n+=1
        print("  dropoff %d: %d teams"%(yr,n), flush=True)
    out.sort(key=lambda x:(x["season"],-x["reg"]))
    return out

def main():
    teamseasons=get("team_seasons?season_year=eq.%d&select=team,team_id,conference,wins,losses,ppg,oppg,srs,ncaa_seed"%CUR)
    rows=season_boxscores(CUR)
    quad=build_quadrant(rows, teamseasons)
    print("quadrant: %d teams"%len(quad))
    bub=build_bubbles(rows)
    print("bubbles: %d players"%len(bub))
    march=build_march()
    print("march: %d seasons"%len(march))
    drop=build_dropoff_all()
    print("dropoff: %d tourney team-seasons"%len(drop))
    json.dump(quad, open(os.path.join(D,"chart_quadrant.json"),"w"))
    json.dump(bub,  open(os.path.join(D,"chart_bubbles.json"),"w"))
    json.dump(march,open(os.path.join(D,"chart_march.json"),"w"))
    json.dump(drop, open(os.path.join(D,"chart_dropoff.json"),"w"))
    print("wrote 4 JSONs to", D)

if __name__=="__main__": main()
