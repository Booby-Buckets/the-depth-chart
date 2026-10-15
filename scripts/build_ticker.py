#!/usr/bin/env python3
"""build_ticker.py — the scores strip at the top of every page (tdc-ticker.js, loaded by tdc-nav.js).

Writes scripts/data/ticker.json: every scrimmage / exhibition and every scheduled game from 3 days ago to 10 days
ahead (US Eastern dates), compact — teams (short name, logo, our rank), date, time, TV, the final score when it's
in, and the page to open. The page overlays live ESPN scores for today's games itself, so this file only has to be
fresh for finals and the slate; a stale file still renders (the page picks the days around today).

Sources: scrimmages_2027.json + scrimmage_results_2027.json, schedule_2027.json + results_2027.json, our ranks from
predictive_ratings, logos from team-colors.js. Runs in the scrimmage + results workflows; writes only on change.

  python3 scripts/build_ticker.py
"""
import json, os, re, urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "data")
ROOT = os.path.dirname(HERE)
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
BACK, AHEAD = 3, 10


def load(name, default=None):
    p = os.path.join(D, name)
    return json.load(open(p)) if os.path.exists(p) else default


def norm(s): return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", (s or "").lower().replace("&", " "))).strip()


def team_colors():
    """window.TDC_TEAM_COLORS={...} from team-colors.js -> {normalized name: logo}"""
    src = open(os.path.join(ROOT, "team-colors.js")).read()
    i = src.index("window.TDC_TEAM_COLORS=") + len("window.TDC_TEAM_COLORS=")
    obj, _ = json.JSONDecoder().raw_decode(src[i:])
    return {k: v.get("logo") for k, v in obj.items()}


def ranks():
    try:
        req = urllib.request.Request(SB + "predictive_ratings?season=eq.2027&select=data&limit=1", headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
        rows = json.load(urllib.request.urlopen(req, timeout=60))
        teams = rows[0]["data"]["teams"]
        return {t["full"]: (t.get("rank"), t.get("team")) for t in teams if t.get("full")}
    except Exception as e:
        print("  ranks unavailable:", e)
        return {}


def main():
    et = datetime.now(timezone.utc) - timedelta(hours=4)
    today = et.date()
    lo, hi = (today - timedelta(days=BACK)).isoformat(), (today + timedelta(days=AHEAD)).isoformat()
    logos, R = team_colors(), ranks()

    def logo(full):
        n = norm(full)
        if n in logos: return logos[n]
        w = n.split()   # "Seattle U Redhawks" -> "seattle u" -> "seattle": shortest prefix with a logo
        for k in range(len(w) - 1, 0, -1):
            if " ".join(w[:k]) in logos: return logos[" ".join(w[:k])]
        return None

    def side(full):
        rk, short = R.get(full, (None, None))
        if not short:   # not in our ratings (non-D-I): drop the mascot
            w = full.split(); short = " ".join(w[:-1]) if len(w) > 1 else full
        return {"n": short, "l": logo(full), "r": rk}

    out = []
    # scrimmages / exhibitions
    S = load("scrimmages_2027.json", {}); G = S["games"] if isinstance(S, dict) else S
    RES = (load("scrimmage_results_2027.json", {}) or {}).get("results", {})
    for g in G:
        if not (lo <= g["date"] <= hi): continue
        r = RES.get(g["id"], {})
        fin = r.get("hs") is not None and r.get("as") is not None
        out.append({"id": g["id"], "d": g["date"], "t": g.get("time") or "", "tv": g.get("tv") or "", "k": "s",
                    "a": side(g["away"]), "h": side(g["home"]), "as": r.get("as") if fin else None, "hs": r.get("hs") if fin else None,
                    "st": "f" if fin else "p", "nt": 1 if g.get("neutral") else 0, "u": "scrimmage.html?id=" + g["id"]})
    # the season: schedule + finals
    sc = load("schedule_2027.json", {"teams": [], "games": []}); T = sc["teams"]
    rs = load("results_2027.json", {"teams": [], "games": []}); RT = rs.get("teams", [])
    fin = {g[0]: (RT[g[2]], RT[g[3]], g[4], g[5]) for g in rs.get("games", [])}
    for g in sc["games"]:
        gid, d = g[0], g[1]
        if not (lo <= d <= hi): continue
        home, away = T[g[2]], T[g[3]]
        f = fin.get(gid)
        out.append({"id": gid, "d": d, "t": "", "tv": "", "k": "g", "a": side(away), "h": side(home),
                    "as": f[3] if f else None, "hs": f[2] if f else None, "st": "f" if f else "p", "nt": int(g[4]) if len(g) > 4 else 0,
                    "u": ("game.html?id=%s" % gid) if gid and gid > 0 else ""})
    # in a day: finals first, then by tip time as listed ("7:00 PM"), then name
    def tkey(e):
        m = re.match(r"(\d+):(\d+)\s*([AP]M)", e["t"] or "", re.I)
        mins = ((int(m.group(1)) % 12) + (12 if m.group(3).upper() == "PM" else 0)) * 60 + int(m.group(2)) if m else 9999
        return (e["d"], 0 if e["st"] == "f" else 1, mins, e["h"]["n"])
    out.sort(key=tkey)
    body = {"window": [lo, hi], "games": out}
    dst = os.path.join(D, "ticker.json")
    try:
        old = json.load(open(dst)); old.pop("built", None)
    except Exception:
        old = None
    if body == old:
        print(f"ticker.json unchanged ({len(out)} games)"); return
    json.dump(dict(built=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), **body), open(dst, "w"), separators=(",", ":"))
    print(f"ticker.json: {len(out)} games {lo} to {hi} ({sum(1 for e in out if e['k'] == 's')} scrimmages, {sum(1 for e in out if e['st'] == 'f')} final)")


if __name__ == "__main__":
    main()
