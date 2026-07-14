#!/usr/bin/env python3
"""
build_player_news.py — real per-player headlines for the player-page "Buzz" tab.

Pulls Google News RSS (a public syndication feed) for each notable player and
writes scripts/data/player_news.json, keyed by espn_id (name fallback). The page
fetches this and shows real, attributed, outbound-linked headlines — no scraping
of article bodies, just titles + source + link (standard aggregator behavior).

Scope: players in the `players` pool with tdc_grade >= MIN_GRADE (the notable
names people actually look up), newest run overwrites. Re-run periodically to
keep it fresh (headlines go stale). "Headlines first, tweets later" — no tweets
here yet.

Usage: python3 build_player_news.py [min_grade] [limit]
"""
import json, os, re, sys, time, html, urllib.request, urllib.parse

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY="sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR={"apikey":KEY,"Authorization":"Bearer "+KEY}
D=os.path.join(os.path.dirname(__file__),"data")
OUT=os.path.join(D,"player_news.json")

MIN_GRADE=int(sys.argv[1]) if len(sys.argv)>1 else 80
LIMIT=int(sys.argv[2]) if len(sys.argv)>2 else 400
PER_PLAYER=5

def get_players():
    q=("players?select=name,espn_id,team,position,tdc_grade&tdc_grade=gte.%d"
       "&order=tdc_grade.desc.nullslast&limit=%d"%(MIN_GRADE,LIMIT))
    req=urllib.request.Request(SB+"/rest/v1/"+q,headers=HDR)
    return json.load(urllib.request.urlopen(req,timeout=60))

def school(team):
    # "Gonzaga Bulldogs" -> "Gonzaga"; "Texas Tech Red Raiders" -> "Texas Tech".
    # Drop a trailing mascot word or two; keep at least the first token.
    w=(team or "").split()
    if len(w)<=1: return team or ""
    # common 2-word mascots -> drop last 2, else drop last 1
    two={"red raiders","blue devils","tar heels","golden gophers","fighting irish",
         "crimson tide","golden eagles","yellow jackets","demon deacons","scarlet knights",
         "green wave","ragin cajuns","horned frogs","mean green","sun devils","aggies"}
    tail2=" ".join(w[-2:]).lower()
    return " ".join(w[:-2]) if tail2 in two and len(w)>2 else " ".join(w[:-1])

def clean_title(t, source):
    t=html.unescape(t or "").strip()
    if source and t.endswith(" - "+source): t=t[:-(len(source)+3)].strip()
    return re.sub(r"\s*-\s*[^-]+$","",t) if t.endswith(" - "+ (source or "")) else t

def fetch_news(name, team):
    q='"%s" %s basketball'%(name, school(team))
    url="https://news.google.com/rss/search?"+urllib.parse.urlencode(
        {"q":q,"hl":"en-US","gl":"US","ceid":"US:en"})
    req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"})
    xml=urllib.request.urlopen(req,timeout=20).read().decode("utf-8","ignore")
    items=re.findall(r"<item>(.*?)</item>",xml,re.S)[:PER_PLAYER]
    out=[]
    for it in items:
        tm=re.search(r"<title>(.*?)</title>",it,re.S)
        lm=re.search(r"<link>(.*?)</link>",it,re.S)
        sm=re.search(r"<source[^>]*>(.*?)</source>",it,re.S)
        dm=re.search(r"<pubDate>(.*?)</pubDate>",it,re.S)
        src=html.unescape(sm.group(1)) if sm else ""
        title=tm.group(1) if tm else ""
        # strip the " - Source" suffix Google appends
        title=html.unescape(title).strip()
        if src and title.endswith(" - "+src): title=title[:-(len(src)+3)].strip()
        if not title: continue
        out.append({"title":title,"source":src,
                    "url":(lm.group(1).strip() if lm else ""),
                    "date":(dm.group(1).strip() if dm else "")})
    return out

def main():
    players=get_players()
    print("fetching news for %d players (grade >= %d)…"%(len(players),MIN_GRADE))
    news={}; got=0
    for i,p in enumerate(players):
        name=p.get("name")
        if not name: continue
        try:
            items=fetch_news(name, p.get("team") or "")
        except Exception as e:
            items=[]
        if items:
            key=str(p["espn_id"]) if p.get("espn_id") else "n:"+name.lower().strip()
            news[key]={"name":name,"team":p.get("team"),"items":items}
            got+=1
        if (i+1)%25==0:
            print("  %d/%d  (%d with news)"%(i+1,len(players),got))
        time.sleep(0.25)   # be polite to the feed
    payload={"generated_utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
             "min_grade":MIN_GRADE,"count":got,"players":news}
    json.dump(payload,open(OUT,"w"))
    print("wrote %d players with headlines -> %s"%(got,OUT))
    # sample
    for k in list(news)[:3]:
        print("\n%s (%s):"%(news[k]["name"],news[k]["team"]))
        for a in news[k]["items"][:3]:
            print("  -",a["source"],"·",a["title"][:80])

if __name__=="__main__": main()
