#!/usr/bin/env python3
"""Calibrate the live win-probability model used by tdc-live.js.

Model (home team's view):
    final margin ~ Normal(mu, SD * (share of the game left) ** EXP)      EXP = 0.5 is a random walk
    mu = current margin + pregame spread * share of the game left
    share left = seconds left in regulation / 2400 (two 20:00 halves); in OT, OT clock / 2400

Data: every play of a random sample of 2025-26 D-I games from ESPN's keyless summary API
(plays carry homeScore/awayScore/period/clock). Pregame spread, two flavours:
    market  = the closing line ESPN ships in pickcenter (the cleanest pregame number)
    srs     = our own season Power Rating (team_seasons.srs) gap + 3.7 home edge
              (full-season SRS, so it peeks at the future a little — reported for comparison)
SD (and EXP) are picked by mean log loss over every in-game state (one state per play). The pure
random walk (EXP 0.5) wants SD ~15 because late leads are less safe than a random walk says
(fouling, end-of-game variance); EXP 0.4 fixes that with a tip-off SD near the pregame 11-13.

    python3 scripts/calibrate_live_wp.py [--games 400] [--cache DIR]
Writes scripts/data/live_wp_calibration.json (the table) and prints it.
"""
import argparse, json, math, os, random, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

HOSTS = ["https://site.web.api.espn.com", "https://site.api.espn.com"]
BASE = "/apis/site/v2/sports/basketball/mens-college-basketball"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HOME_ADV = 3.7
OUT = os.path.join(os.path.dirname(__file__), "data", "live_wp_calibration.json")


def get(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def espn(path):
    err = None
    for h in HOSTS:
        try:
            return get(h + BASE + path)
        except Exception as e:  # noqa: BLE001
            err = e
    raise err


def secs_left(period, clock):
    m = re.match(r"(\d+):(\d+)", clock or "")
    s = int(m.group(1)) * 60 + int(m.group(2)) if m else 0
    if period >= 3:
        return 0, s  # regulation over; OT clock
    return (2 - period) * 1200 + s, None


def share_left(period, clock):
    reg, ot = secs_left(period, clock)
    return (ot if ot is not None else reg) / 2400.0


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def wp(spread, margin, frac, sd, exp=0.5):
    frac = max(frac, 3 / 2400)
    mu = margin + spread * frac
    return phi(mu / (sd * frac ** exp))


def slim(ev_id):
    d = espn(f"/summary?event={ev_id}")
    comp = d["header"]["competitions"][0]
    if comp["status"]["type"]["state"] != "post":
        return None
    side = {c["homeAway"]: c for c in comp["competitors"]}
    spread = None
    for pc in d.get("pickcenter") or []:
        if pc.get("spread") is not None:
            spread = -float(pc["spread"])  # ESPN spread is the home line (-8.5 = home favoured by 8.5)
            break
    plays = [(p["period"]["number"], p["clock"]["displayValue"], p.get("homeScore", 0), p.get("awayScore", 0))
             for p in d.get("plays") or [] if p.get("period")]
    if len(plays) < 100:
        return None
    return {
        "id": ev_id, "neutral": bool(comp.get("neutralSite")),
        "home": side["home"]["team"]["displayName"], "away": side["away"]["team"]["displayName"],
        "hs": int(side["home"]["score"]), "as": int(side["away"]["score"]),
        "market": spread, "plays": plays,
    }


def safe_slim(i):
    try:
        return slim(i)
    except Exception:  # noqa: BLE001
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=400)
    ap.add_argument("--cache", default=os.environ.get("TDC_LIVE_CACHE", "/tmp/tdc_live_calib"))
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    cfile = os.path.join(a.cache, "games.json")
    games = json.load(open(cfile)) if os.path.exists(cfile) else []

    if len(games) < a.games:
        random.seed(2026)
        # every ~5th day of 2025-26, Nov 5 .. Mar 15 (regular season + conference tournaments)
        import datetime as dt
        d0, d1 = dt.date(2025, 11, 5), dt.date(2026, 3, 15)
        days = [d0 + dt.timedelta(days=i) for i in range(0, (d1 - d0).days + 1, 4)]
        ids = []
        for day in days:
            sb = espn(f"/scoreboard?groups=50&limit=400&dates={day:%Y%m%d}")
            evs = [e["id"] for e in sb.get("events", []) if e["competitions"][0]["status"]["type"]["state"] == "post"]
            random.shuffle(evs)
            ids += evs[:14]
        random.shuffle(ids)
        have = {g["id"] for g in games}
        todo = [i for i in ids if i not in have][: int((a.games - len(games)) * 1.15) + 10]
        with ThreadPoolExecutor(6) as ex:
            for g in ex.map(safe_slim, todo):
                if g:
                    games.append(g)
        json.dump(games, open(cfile, "w"))
    games = games[: a.games]

    srs = {r["team"]: float(r["srs"]) for r in get(
        f"{SB}/rest/v1/team_seasons?season_year=eq.2026&srs=not.is.null&select=team,srs",
        {"apikey": KEY, "Authorization": "Bearer " + KEY})}

    def srs_spread(g):
        if g["home"] not in srs or g["away"] not in srs:
            return None
        return srs[g["home"]] - srs[g["away"]] + (0 if g["neutral"] else HOME_ADV)

    SDS = [x / 2 for x in range(20, 35)]  # 10.0 .. 17.0
    EXPS = [0.5, 0.45, 0.4, 0.35]
    PHASES = [("1st half", lambda f: f > 0.5), ("2nd half, >10:00", lambda f: 0.25 < f <= 0.5),
              ("2nd half, 10:00-4:00", lambda f: 0.1 < f <= 0.25), ("last 4:00 + OT", lambda f: f <= 0.1)]
    result = {"n_games": len(games), "model": "margin_end ~ N(margin + spread*frac, SD*frac**EXP)", "spreads": {}}
    for label, sp_of in (("market", lambda g: g["market"]), ("srs", srs_spread)):
        rows = []
        for g in games:
            sp = sp_of(g)
            if sp is None:
                continue
            y = 1 if g["hs"] > g["as"] else 0
            for (per, clk, hs, as_) in g["plays"]:
                reg, ot = secs_left(per, clk)
                f = (ot if ot is not None else reg) / 2400.0
                if f <= 0:
                    continue  # regulation/OT buzzer states carry no information
                rows.append((sp, hs - as_, f, y))
        tab = {}
        for ex in EXPS:
            for sd in SDS:
                ll_all, per_phase = 0.0, {p[0]: [0.0, 0, 0.0] for p in PHASES}
                for sp, m, f, y in rows:
                    p = min(0.99, max(0.01, wp(sp, m, f, sd, ex)))
                    ll = -(y * math.log(p) + (1 - y) * math.log(1 - p))
                    ll_all += ll
                    for name, fn in PHASES:
                        if fn(f):
                            per_phase[name][0] += ll; per_phase[name][1] += 1; per_phase[name][2] += (p - y) ** 2
                            break
                tab[(ex, sd)] = {"logloss": ll_all / len(rows),
                                 "phases": {k: {"logloss": round(v[0] / max(1, v[1]), 4), "brier": round(v[2] / max(1, v[1]), 4), "n": v[1]} for k, v in per_phase.items()}}
        best = min(tab, key=lambda k: tab[k]["logloss"])
        best_sqrt = min((k for k in tab if k[0] == 0.5), key=lambda k: tab[k]["logloss"])
        result["spreads"][label] = {
            "games": sum(1 for g in games if sp_of(g) is not None), "states": len(rows),
            "best": {"exp": best[0], "sd": best[1], "logloss": round(tab[best]["logloss"], 5), "phases": tab[best]["phases"]},
            "best_sqrt": {"exp": 0.5, "sd": best_sqrt[1], "logloss": round(tab[best_sqrt]["logloss"], 5), "phases": tab[best_sqrt]["phases"]},
            "table": {f"exp={k[0]} sd={k[1]}": round(v["logloss"], 5) for k, v in tab.items()},
        }
    json.dump(result, open(OUT, "w"), indent=1)
    for label, r in result["spreads"].items():
        print(f"\n== pregame spread: {label}  ({r['games']} games, {r['states']} play states)")
        print("  SD     " + "  ".join(f"exp {e:<5}" for e in EXPS))
        for sd in SDS:
            print(f"  {sd:5.1f}  " + "  ".join(f"{r['table'][f'exp={e} sd={sd}']:.4f}   " for e in EXPS))
        for key in ("best_sqrt", "best"):
            b = r[key]
            print(f"  {key}: SD {b['sd']} exp {b['exp']}  log loss {b['logloss']:.4f}")
            for k, v in b["phases"].items():
                print(f"    {k:22s} n={v['n']:6d}  logloss {v['logloss']:.4f}  brier {v['brier']:.4f}")


if __name__ == "__main__":
    main()
