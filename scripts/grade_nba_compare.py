#!/usr/bin/env python3
"""
grade_nba_compare.py — grade TDC Bet's NBA line-check picks (scripts/data/nba_compare/picks_<date>.json).

Each pick was logged before tip at the cheapest price across DraftKings / Kalshi / Polymarket (cost = dollars to
win $1, fees in). Finals and player lines come from ESPN's game summary. Each pick gets res 'w'|'l'|'p'|'void'
and profit per $1 staked; each day file gets a summary (record, units, ROI, by source, by market kind).
Run nightly (and safe to rerun: graded picks are skipped).
"""
import json, os, re, glob, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "nba_compare")
TICK = {"SA": "SAS", "GS": "GSW", "NO": "NOP", "NY": "NYK", "UTAH": "UTA", "WSH": "WAS"}
STAT = {"pts": ["PTS"], "reb": ["REB"], "ast": ["AST"], "tpm": ["3PT"], "pra": ["PTS", "REB", "AST"], "pr": ["PTS", "REB"], "pa": ["PTS", "AST"], "ra": ["REB", "AST"]}


def getj(url):
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "tdc"}), timeout=40))
    except Exception:
        return None


def nkey(nm):
    return re.sub(r"[^a-z ]", "", (nm or "").lower().replace(" jr.", "").replace(" iii", "").replace(" ii", "")).strip()


def box(gid):
    d = getj("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=%s" % gid)
    if not d:
        return None
    comp = (d.get("header") or {}).get("competitions", [{}])[0]
    if not ((comp.get("status") or {}).get("type") or {}).get("completed"):
        return None
    score = {}
    for c in comp.get("competitors", []):
        ab = c["team"]["abbreviation"]; score[TICK.get(ab, ab)] = float(c.get("score") or 0)
    players = {}
    for t in (d.get("boxscore") or {}).get("players", []):
        for st in t.get("statistics", []):
            lab = st.get("labels") or st.get("names") or []
            for a in st.get("athletes", []):
                vals = dict(zip(lab, a.get("stats") or []))
                if not vals or a.get("didNotPlay"):
                    continue
                def num(v):
                    try:
                        return float(str(v).split("-")[0])
                    except Exception:
                        return 0.0
                players[nkey(a["athlete"]["displayName"])] = {k: num(v) for k, v in vals.items()}
    return {"score": score, "players": players}


def grade(p, g, b):
    k = p["key"].split("|"); kind = p["kind"]
    H, A = g["home"], g["away"]; H, A = TICK.get(H, H), TICK.get(A, A)
    sc = b["score"]; hm = sc.get(H, 0) - sc.get(A, 0)
    if kind == "ml":
        v = hm if k[1] == H else -hm
    elif kind == "sp":
        v = (hm if k[1] == H else -hm) + float(k[2])
    elif kind == "tot":
        t = sc.get(H, 0) + sc.get(A, 0); v = (t - float(k[2])) if k[1] == "over" else (float(k[2]) - t)
    elif kind == "tt":
        t = sc.get(k[1], 0); v = (t - float(k[3])) if k[2] == "over" else (float(k[3]) - t)
    elif kind == "prop":
        pl = b["players"].get(k[1])
        if not pl:
            return "void", None
        val = sum(pl.get(x, 0) for x in STAT.get(k[2], [])); L = float(k[4])
        v = (val - L) if k[3] == "over" else (L - val)
        return ("w" if v > 0 else "l" if v < 0 else "p"), val
    else:
        return None, None
    return ("w" if v > 0 else "l" if v < 0 else "p"), None


def main():
    for path in sorted(glob.glob(os.path.join(OUT, "picks_*.json"))):
        log = json.load(open(path)); changed = False
        for gid, g in log["games"].items():
            if all(p.get("res") for p in g["picks"]):
                continue
            b = box(gid)
            if not b:
                continue
            g["final"] = b["score"]
            for p in g["picks"]:
                if p.get("res"):
                    continue
                r, val = grade(p, g, b)
                if not r:
                    continue
                p["res"] = r; p["actual"] = val
                p["profit"] = round((1 / p["cost"] - 1) if r == "w" else (-1 if r == "l" else 0), 4)
                changed = True
        if changed or "summary" not in log:
            allp = [p for g in log["games"].values() for p in g["picks"] if p.get("res") in ("w", "l", "p")]
            def summ(ps):
                w = sum(p["res"] == "w" for p in ps); l = sum(p["res"] == "l" for p in ps); u = sum(p["profit"] for p in ps)
                return {"n": len(ps), "w": w, "l": l, "units": round(u, 2), "roi": round(u / len(ps), 4) if ps else None,
                        "exp": round(sum(p["ev"] for p in ps), 2)}
            log["summary"] = dict(summ(allp), by_src={s: summ([p for p in allp if p["src"] == s]) for s in ("dk", "kalshi", "poly")},
                                  by_kind={k: summ([p for p in allp if p["kind"] == k]) for k in ("ml", "sp", "tot", "tt", "prop")})
            json.dump(log, open(path, "w"), separators=(",", ":"))
            s = log["summary"]; print("%s: %d graded · %d-%d · %+.2f units" % (os.path.basename(path), s["n"], s["w"], s["l"], s["units"]))


def rollup():
    """results.json: every graded day + the running total, for the page."""
    days, allp, v2 = [], [], []
    for path in sorted(glob.glob(os.path.join(OUT, "picks_*.json")), reverse=True):
        log = json.load(open(path))
        if log.get("summary", {}).get("n"):
            days.append({"date": log["date"], "summary": log["summary"], "rules": log.get("rules", "v1")})
            got = [p for g in log["games"].values() for p in g["picks"] if p.get("res") in ("w", "l", "p")]
            allp += got
            if log.get("rules") == "v2":
                v2 += got
    def summ(ps):
        w = sum(p["res"] == "w" for p in ps); l = sum(p["res"] == "l" for p in ps); u = sum(p["profit"] for p in ps)
        return {"n": len(ps), "w": w, "l": l, "units": round(u, 2), "roi": round(u / len(ps), 4) if ps else None, "exp": round(sum(p["ev"] for p in ps), 2)}
    total = dict(summ(allp), by_src={s: summ([p for p in allp if p["src"] == s]) for s in ("dk", "kalshi", "poly")},
                 by_kind={k: summ([p for p in allp if p["kind"] == k]) for k in ("ml", "sp", "tot", "tt", "prop")})
    v1 = [p for p in allp if p not in v2]
    json.dump({"days": days, "total": total, "v2": summ(v2), "v1": summ(v1)}, open(os.path.join(OUT, "results.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
    rollup()
