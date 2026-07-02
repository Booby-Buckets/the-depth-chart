#!/usr/bin/env python3
"""Mine bbref_seasons for year-over-year projection trends.

Pairs consecutive seasons per player (bbref_id) and measures:
  1. per-40 rate growth by class transition x position group
  2. efficiency (TS/FG/3P/FT) deltas by class transition
  3. lag-1 shrinkage slopes (regression to the mean) per stat
  4. minutes progression by class x prior-minutes tier
  5. advanced-stat (BPM/PER/WS40/USG) lag models
  6. which current stats predict next-season scoring (correlation scan)

Writes trend tables to scripts/data/proj_trends.json for the JS engine.
Raw season rows are cached in scripts/data/proj_seasons_cache.json.
"""
import json, os, sys, time, urllib.request, urllib.parse

SB  = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "data", "proj_seasons_cache.json")
OUT   = os.path.join(HERE, "data", "proj_trends.json")

SEL = ",".join([
    "bbref_id","player","school","season_year","class","pos","height","tdc_grade",
    "mpg:pergame->>mp_per_g","ppg:pergame->>pts_per_g","rpg:pergame->>trb_per_g",
    "apg:pergame->>ast_per_g","stl:pergame->>stl_per_g","blk:pergame->>blk_per_g",
    "tovs:pergame->>tov_per_g","fga:pergame->>fga_per_g","fgm:pergame->>fg_per_g",
    "tpa:pergame->>fg3a_per_g","tpm:pergame->>fg3_per_g","fta:pergame->>fta_per_g",
    "gp:pergame->>games",
    "fg_pct:pergame->>fg_pct","tp_pct:pergame->>fg3_pct","ft_pct:pergame->>ft_pct",
    "per:advanced->>per","bpm:advanced->>bpm","obpm:advanced->>obpm","dbpm:advanced->>dbpm",
    "ws40:advanced->>ws_per_40","ts:advanced->>ts_pct","usg:advanced->>usg_pct",
    "astp:advanced->>ast_pct","trbp:advanced->>trb_pct","tovp:advanced->>tov_pct",
])

def fetch_year(y):
    rows, offset = [], 0
    while True:
        url = f"{SB}/rest/v1/bbref_seasons?season_year=eq.{y}&select={urllib.parse.quote(SEL, safe=',:>-')}"
        req = urllib.request.Request(url, headers={
            "apikey": KEY, "Authorization": f"Bearer {KEY}",
            "Range-Unit": "items", "Range": f"{offset}-{offset+999}"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    batch = json.load(r)
                break
            except Exception as e:
                if attempt == 2: raise
                time.sleep(2)
        rows += batch
        if len(batch) < 1000: break
        offset += 1000
    return rows

def load_seasons():
    if os.path.exists(CACHE):
        with open(CACHE) as f: return json.load(f)
    all_rows = []
    for y in range(2007, 2027):
        t0=time.time(); rows = fetch_year(y); all_rows += rows
        print(f"  {y}: {len(rows)} rows ({time.time()-t0:.1f}s)", flush=True)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w") as f: json.dump(all_rows, f)
    return all_rows

def f(v):
    try:
        x = float(v)
        return x
    except (TypeError, ValueError):
        return None

def ht_in(h):
    if not h: return None
    try:
        a,b = str(h).split("-"); return int(a)*12+int(b)
    except Exception: return None

def pos_group(pos, hin):
    p = (str(pos or "").upper().split("/")[0] or "")
    if p in ("PG","SG","CG","G"): return "G"
    if p == "SF": return "W"
    if p in ("PF","C"): return "B"
    if p == "F": return "B" if (hin and hin >= 80) else "W"
    if hin:
        if hin >= 80: return "B"
        if hin < 74: return "G"
    return "W"

CLASS_MAP = {"FR":"FR","SO":"SO","JR":"JR","SR":"SR"}
def cls(c):
    c = str(c or "").upper().replace(".","").replace("R-","")
    return CLASS_MAP.get(c[:2], None)

def median(xs):
    xs = sorted(xs); n = len(xs)
    if not n: return None
    return xs[n//2] if n%2 else (xs[n//2-1]+xs[n//2])/2

def mean(xs): return sum(xs)/len(xs) if xs else None

def trimmed(xs, p=0.05):
    xs = sorted(xs); k = int(len(xs)*p)
    return xs[k:len(xs)-k] if len(xs) > 2*k else xs

def ols(xs, ys):
    """slope, intercept, r for y ~ x"""
    n = len(xs)
    if n < 30: return None
    mx, my = mean(xs), mean(ys)
    sxx = sum((x-mx)**2 for x in xs); sxy = sum((x-mx)*(y-my) for x,y in zip(xs,ys))
    syy = sum((y-my)**2 for y in ys)
    if sxx == 0 or syy == 0: return None
    b = sxy/sxx
    return {"b": round(b,4), "a": round(my-b*mx,4), "r": round(sxy/(sxx*syy)**0.5,3),
            "mx": round(mx,3), "my": round(my,3), "n": n}

def main():
    print("Loading seasons…", flush=True)
    rows = load_seasons()
    print(f"total rows: {len(rows)}", flush=True)

    # index by bbref_id
    by_id = {}
    for r in rows:
        if r.get("bbref_id"): by_id.setdefault(r["bbref_id"], []).append(r)

    pairs = []
    for pid, seas in by_id.items():
        seas.sort(key=lambda r: r["season_year"])
        for i in range(len(seas)-1):
            a, b = seas[i], seas[i+1]
            if b["season_year"] - a["season_year"] != 1: continue
            ma, mb = f(a.get("mpg")), f(b.get("mpg"))
            ga, gb = f(a.get("gp")), f(b.get("gp"))
            if not ma or not mb or ma < 8 or mb < 8: continue     # rotation both years
            if not ga or not gb or ga < 10 or gb < 10: continue   # real samples
            pairs.append((a, b))
    print(f"usable consecutive pairs: {len(pairs)}", flush=True)

    trends = {"pairs": len(pairs)}

    # ── 1. per-40 rate growth by class transition x position group ──
    RATE_KEYS = ["ppg","rpg","apg","stl","blk","tovs","fga","tpa","fta"]
    growth = {}
    for a, b in pairs:
        c = cls(a.get("class"))
        if not c or c == "SR": continue
        g = pos_group(a.get("pos"), ht_in(a.get("height")))
        transfer = a.get("school") != b.get("school")
        key = f"{c}|{g}"
        ma, mb = f(a["mpg"]), f(b["mpg"])
        for k in RATE_KEYS:
            va, vb = f(a.get(k)), f(b.get(k))
            if va is None or vb is None or va/ma*40 < 0.35: continue  # rate too tiny → ratio noise
            ra, rb = va/ma*40, vb/mb*40
            growth.setdefault(key, {}).setdefault(k, []).append(rb/ra)
            growth.setdefault(f"{c}|ALL", {}).setdefault(k, []).append(rb/ra)
            if not transfer:
                growth.setdefault(f"{c}|{g}|stay", {}).setdefault(k, []).append(rb/ra)
    trends["rate_growth"] = {
        key: {k: round(median(trimmed(v)),4) for k,v in d.items() if len(v) >= 40}
        for key, d in growth.items()}

    # ── 2. efficiency deltas by class transition ──
    eff = {}
    for a, b in pairs:
        c = cls(a.get("class"))
        if not c or c == "SR": continue
        for k, lo in (("ts",0.3),("fg_pct",0.25),("tp_pct",0.15),("ft_pct",0.3)):
            va, vb = f(a.get(k)), f(b.get(k))
            if va is None or vb is None or va < lo: continue
            eff.setdefault(c, {}).setdefault(k, []).append((vb-va)*100)  # pct points
    trends["eff_delta"] = {
        c: {k: round(mean(trimmed(v)),2) for k,v in d.items() if len(v) >= 40}
        for c, d in eff.items()}

    # ── 3. lag-1 shrinkage (regression to the mean) per per-40 stat + advanced ──
    shrink = {}
    for k, get in [
        ("p40", lambda r,m: (f(r.get("ppg")) or 0)/m*40),
        ("r40", lambda r,m: (f(r.get("rpg")) or 0)/m*40),
        ("a40", lambda r,m: (f(r.get("apg")) or 0)/m*40),
        ("s40", lambda r,m: (f(r.get("stl")) or 0)/m*40),
        ("b40", lambda r,m: (f(r.get("blk")) or 0)/m*40),
        ("ts",  lambda r,m: f(r.get("ts"))),
        ("usg", lambda r,m: f(r.get("usg"))),
        ("bpm", lambda r,m: f(r.get("bpm"))),
        ("per", lambda r,m: f(r.get("per"))),
        ("ws40",lambda r,m: f(r.get("ws40"))),
        ("tp_pct", lambda r,m: f(r.get("tp_pct"))),
        ("fg_pct", lambda r,m: f(r.get("fg_pct"))),
        ("ft_pct", lambda r,m: f(r.get("ft_pct"))),
        ("t40", lambda r,m: (f(r.get("tovs")) or 0)/m*40),
    ]:
        xs, ys = [], []
        for a, b in pairs:
            va, vb = get(a, f(a["mpg"])), get(b, f(b["mpg"]))
            if va is None or vb is None: continue
            xs.append(va); ys.append(vb)
        m = ols(xs, ys)
        if m: shrink[k] = m
    trends["lag1"] = shrink

    # ── 4. minutes progression: class x prior-mpg tier ──
    mins = {}
    for a, b in pairs:
        c = cls(a.get("class"))
        if not c or c == "SR": continue
        ma, mb = f(a["mpg"]), f(b["mpg"])
        tier = "lo" if ma < 15 else ("mid" if ma < 24 else "hi")
        mins.setdefault(f"{c}|{tier}", []).append(mb-ma)
    trends["mpg_delta"] = {k: round(mean(trimmed(v)),2) for k,v in mins.items() if len(v) >= 40}

    # ── 4b. advanced-stat delta by class transition (BPM/PER/WS40/USG points) ──
    advd = {}
    for a, b in pairs:
        c = cls(a.get("class"))
        if not c or c == "SR": continue
        for k in ("bpm","per","ws40","usg"):
            va, vb = f(a.get(k)), f(b.get(k))
            if va is None or vb is None: continue
            advd.setdefault(c, {}).setdefault(k, []).append(vb-va)
    trends["adv_delta"] = {
        c: {k: round(mean(trimmed(v)),3) for k,v in d.items() if len(v) >= 40}
        for c, d in advd.items()}

    # ── 5. usage-change → efficiency-change coupling ──
    xs, ys = [], []
    for a, b in pairs:
        ua, ub, ta, tb = f(a.get("usg")), f(b.get("usg")), f(a.get("ts")), f(b.get("ts"))
        if None in (ua, ub, ta, tb): continue
        xs.append(ub-ua); ys.append((tb-ta)*100)
    trends["usg_ts_coupling"] = ols(xs, ys)

    # ── 6. predictor scan: what correlates with NEXT-season pts/40? ──
    def corr(get):
        xs, ys = [], []
        for a, b in pairs:
            va = get(a)
            if va is None: continue
            mb = f(b["mpg"]); vb = (f(b.get("ppg")) or 0)/mb*40
            xs.append(va); ys.append(vb)
        m = ols(xs, ys)
        return (m["r"], m["n"]) if m else (None, 0)
    scan = {}
    for name, get in [
        ("p40_now",  lambda r: (f(r.get("ppg")) or 0)/f(r["mpg"])*40 if f(r.get("mpg")) else None),
        ("usg",      lambda r: f(r.get("usg"))),
        ("per",      lambda r: f(r.get("per"))),
        ("bpm",      lambda r: f(r.get("bpm"))),
        ("obpm",     lambda r: f(r.get("obpm"))),
        ("ws40",     lambda r: f(r.get("ws40"))),
        ("ts",       lambda r: f(r.get("ts"))),
        ("grade",    lambda r: f(r.get("tdc_grade"))),
        ("fta_rate", lambda r: (f(r.get("fta")) or 0)/f(r["fga"]) if f(r.get("fga")) else None),
    ]:
        r, n = corr(get)
        if r is not None: scan[name] = {"r": r, "n": n}
    trends["next_p40_corr"] = scan

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fp: json.dump(trends, fp, indent=1)
    print(json.dumps({k: v for k, v in trends.items() if k != "rate_growth"}, indent=1)[:3000])
    print("\nrate_growth keys:", sorted(trends["rate_growth"].keys()))
    print(f"\nwrote {OUT}")

if __name__ == "__main__":
    main()
