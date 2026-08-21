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

def main():
    teamseasons=get("team_seasons?season_year=eq.%d&select=team,team_id,conference,wins,losses,ppg,oppg,srs,ncaa_seed"%CUR)
    rows=season_boxscores(CUR)
    quad=build_quadrant(rows, teamseasons)
    print("quadrant: %d teams"%len(quad))
    bub=build_bubbles(rows)
    print("bubbles: %d players"%len(bub))
    march=build_march()
    print("march: %d seasons"%len(march))
    drop=build_dropoff(quad, rows)
    print("dropoff: %d tourney teams"%len(drop))
    json.dump(quad, open(os.path.join(D,"chart_quadrant.json"),"w"))
    json.dump(bub,  open(os.path.join(D,"chart_bubbles.json"),"w"))
    json.dump(march,open(os.path.join(D,"chart_march.json"),"w"))
    json.dump(drop, open(os.path.join(D,"chart_dropoff.json"),"w"))
    print("wrote 4 JSONs to", D)

if __name__=="__main__": main()
