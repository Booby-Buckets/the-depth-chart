#!/usr/bin/env python3
"""
grade_bet_edges.py — grade TDC Bet's logged edge-board bets (scripts/data/bet_picks_2027.json → "edges").

Game markets from final scores (results_2027.json; first halves from ESPN's linescores), player props from
box_scores (public Supabase table, matched by ESPN game id + player id). Each graded bet gets
  res: 'w' | 'l' | 'p'   and   actual: the number it was graded on.
Ungradeable yet (not final, box score missing) stays open and is retried the next night.
Run nightly after the results ingest (rebuild-projections.yml).
"""
import json, os, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
PICKS = os.path.join(DATA, "bet_picks_2027.json")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
STAT = {"pts": ["pts"], "reb": ["reb"], "ast": ["ast"], "tpm": ["tpm"], "pra": ["pts", "reb", "ast"]}


def getj(url, hdr=None):
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=hdr or {"User-Agent": "tdc"}), timeout=60))
    except Exception:
        return None


def halves(gid):
    """(home 1H, away 1H) from ESPN's summary linescores, or None."""
    j = getj("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=%s" % gid)
    try:
        comp = j["header"]["competitions"][0]
        side = {c["homeAway"]: c for c in comp["competitors"]}
        h = float(side["home"]["linescores"][0]["displayValue"]); a = float(side["away"]["linescores"][0]["displayValue"])
        return h, a
    except Exception:
        return None


def wlp(v):
    return "w" if v > 0 else "l" if v < 0 else "p"


def main():
    H = json.load(open(PICKS))
    E = H.get("edges") or {}
    if not E:
        print("no logged edges"); return
    R = json.load(open(os.path.join(DATA, "results_2027.json")))
    T = R.get("teams", [])
    res = {str(a[0]): {"home": T[a[2]], "away": T[a[3]], "hs": a[4], "as": a[5]} for a in R.get("games", [])}
    box_cache, half_cache, n = {}, {}, 0
    for k, e in E.items():
        if e.get("res"):
            continue
        r = res.get(str(e["gid"]))
        if not r:
            continue
        m, side, pt = e["m"], e["side"], e["bet"]["point"]
        hm = r["hs"] - r["as"]
        if m == "spread":
            v = (hm if side == "home" else -hm) + pt; e["actual"] = hm
        elif m == "total":
            t = r["hs"] + r["as"]; v = (t - pt) if side == "over" else (pt - t); e["actual"] = t
        elif m == "ml":
            v = hm if side == "home" else -hm; e["actual"] = hm
        elif m == "tt":
            sc = r["hs"] if e.get("team") == r["home"] else r["as"]; v = (sc - pt) if side == "over" else (pt - sc); e["actual"] = sc
        elif m == "h1":
            if e["gid"] not in half_cache:
                half_cache[e["gid"]] = halves(e["gid"])
            hh = half_cache[e["gid"]]
            if not hh:
                continue
            if side in ("over", "under"):
                t = hh[0] + hh[1]; v = (t - pt) if side == "over" else (pt - t); e["actual"] = t
            else:
                d = hh[0] - hh[1]; v = (d if side == "home" else -d) + pt; e["actual"] = d
        elif m == "prop":
            gid = e["gid"]
            if gid not in box_cache:
                rows = getj("%s/rest/v1/box_scores?game_id=eq.%s&select=espn_id,min,pts,reb,ast,tpm" % (SB, gid), {"apikey": KEY, "Authorization": "Bearer " + KEY}) or []
                box_cache[gid] = {str(x["espn_id"]): x for x in rows}
            row = box_cache[gid].get(str(e.get("pid")))
            if not row:
                if box_cache[gid]:
                    e["res"] = "void"; e["actual"] = None; n += 1   # box score is in and he didn't play: books void it
                continue
            val = sum(row.get(s) or 0 for s in STAT.get(e.get("stat"), []))
            v = (val - pt) if side == "over" else (pt - val); e["actual"] = val
        else:
            continue
        e["res"] = wlp(v); n += 1
    json.dump(H, open(PICKS, "w"), separators=(",", ":"))
    print("graded %d edge bets · %d total logged" % (n, len(E)))


if __name__ == "__main__":
    main()
