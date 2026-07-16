#!/usr/bin/env python3
"""
build_player_buzz.py — real per-player SOCIAL buzz for the player-page "Buzz" tab.

Pulls Reddit (r/CollegeBasketball) discussion for each notable player via Reddit's
free OAuth "application-only" API and writes scripts/data/player_buzz.json, keyed by
espn_id (name fallback) — the SAME key scheme as build_player_news.py, so the page
merges headlines (Google News) + buzz (Reddit) per player. We store only the post
title, subreddit, score, comment count and permalink (outbound link) — no comment
bodies — i.e. standard aggregator behavior, and every card links back to Reddit.

Reddit blocks unauthenticated API calls from datacenter IPs (so the cron needs
OAuth). Credentials come from env — register a free "script"/"web app" at
https://www.reddit.com/prefs/apps and export:

  REDDIT_CLIENT_ID       (the string under the app name)
  REDDIT_CLIENT_SECRET   (the "secret" field)
  REDDIT_UA              (optional, e.g. "the-depth-chart/0.1 by u/yourname")

Usage: python3 build_player_buzz.py [min_grade] [limit]
"""
import base64, json, os, re, sys, time, html, urllib.request, urllib.parse

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(__file__),"data")
OUT=os.path.join(D,"player_buzz.json")

CID=os.environ.get("REDDIT_CLIENT_ID")
CSECRET=os.environ.get("REDDIT_CLIENT_SECRET")
UA=os.environ.get("REDDIT_UA") or "the-depth-chart-cbb/0.1 (buzz aggregator)"

MIN_GRADE=int(sys.argv[1]) if len(sys.argv)>1 else 80
LIMIT=int(sys.argv[2]) if len(sys.argv)>2 else 400
PER_PLAYER=5
SUBS="CollegeBasketball"          # comma-joined subs to restrict the search to
MIN_SCORE=2                       # drop near-zero-engagement noise

def get_players():
    q=("players?select=name,espn_id,team,position,tdc_grade&tdc_grade=gte.%d"
       "&order=tdc_grade.desc.nullslast&limit=%d"%(MIN_GRADE,LIMIT))
    req=urllib.request.Request(SB+"/rest/v1/"+q,headers=HDR)
    return json.load(urllib.request.urlopen(req,timeout=60))

def get_token():
    if not (CID and CSECRET):
        raise SystemExit("Missing REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET env vars "
                         "(register a free app at https://www.reddit.com/prefs/apps).")
    auth=base64.b64encode(("%s:%s"%(CID,CSECRET)).encode()).decode()
    body=urllib.parse.urlencode({"grant_type":"client_credentials"}).encode()
    req=urllib.request.Request("https://www.reddit.com/api/v1/access_token",data=body,
        headers={"Authorization":"Basic "+auth,"User-Agent":UA})
    tok=json.load(urllib.request.urlopen(req,timeout=30)).get("access_token")
    if not tok: raise SystemExit("Reddit returned no access_token — check credentials.")
    return tok

def fetch_buzz(token, name, tries=2):
    q='"%s"'%name                 # exact-name phrase keeps common names from flooding
    url="https://oauth.reddit.com/r/%s/search?"%SUBS+urllib.parse.urlencode(
        {"q":q,"restrict_sr":"on","sort":"relevance","t":"month","limit":15})
    hdr={"Authorization":"bearer "+token,"User-Agent":UA}
    last=None
    for _ in range(tries):
        try:
            data=json.load(urllib.request.urlopen(urllib.request.Request(url,headers=hdr),timeout=25))
            break
        except Exception as e:
            last=e; time.sleep(2)
    else:
        raise last               # all attempts failed -> caller keeps last-known buzz
    posts=[]
    for c in data.get("data",{}).get("children",[]):
        d=c.get("data",{}) or {}
        title=html.unescape((d.get("title") or "").strip())
        score=int(d.get("score") or 0)
        if not title or score<MIN_SCORE: continue
        posts.append({"title":title,"score":score,
                      "comments":int(d.get("num_comments") or 0),
                      "sub":d.get("subreddit"),
                      "url":"https://www.reddit.com"+(d.get("permalink") or ""),
                      "created":int(d.get("created_utc") or 0)})
    # rank by engagement (score + comments), keep the top few
    posts.sort(key=lambda x:-(x["score"]+x["comments"]))
    return posts[:PER_PLAYER]

def main():
    players=get_players()
    old={}
    if os.path.exists(OUT):
        try: old=json.load(open(OUT)).get("players",{})
        except Exception: old={}
    token=get_token()
    print("fetching Reddit buzz for %d players (grade >= %d)…"%(len(players),MIN_GRADE))
    buzz={}; got=0; kept=0
    for i,p in enumerate(players):
        name=p.get("name")
        if not name: continue
        key=str(p["espn_id"]) if p.get("espn_id") else "n:"+name.lower().strip()
        failed=False
        try:
            items=fetch_buzz(token, name)
        except Exception:
            failed=True; items=[]
        if items:
            buzz[key]={"name":name,"team":p.get("team"),"items":items}; got+=1
        elif failed and key in old:
            buzz[key]=old[key]; kept+=1         # fetch failed -> preserve prior buzz
        # a valid-empty result (no chatter) simply gets no entry
        if (i+1)%50==0:
            print("  %d/%d  (%d fresh, %d kept)"%(i+1,len(players),got,kept))
        time.sleep(0.7)          # ~85/min, under Reddit's 100 QPM OAuth ceiling
    payload={"generated_utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
             "source":"reddit","subs":SUBS,"min_grade":MIN_GRADE,
             "count":len(buzz),"fresh":got,"kept":kept,"players":buzz}
    json.dump(payload,open(OUT,"w"),indent=1,sort_keys=True)
    print("wrote %d players (%d fresh, %d kept) -> %s"%(len(buzz),got,kept,OUT))
    for k in list(buzz)[:3]:
        print("\n%s (%s):"%(buzz[k]["name"],buzz[k]["team"]))
        for a in buzz[k]["items"][:3]:
            print("  - r/%s [%s↑ %sc] %s"%(a["sub"],a["score"],a["comments"],a["title"][:80]))

if __name__=="__main__": main()
