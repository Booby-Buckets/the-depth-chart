#!/usr/bin/env python3
"""
build_dev_curves.py — empirical player development curves from 20 yrs of bbref_seasons.

Projections that just echo last year (±1%) are wrong; real year-over-year change is
much larger and depends on class transition (Fr->So->Jr->Sr) and current level. This
mines consecutive college seasons of the SAME player and measures how BPM and per-40
production actually move, so the projection engine can apply a realistic curve.

Output: scripts/data/dev_curves.json
  { "bpm_delta": { "so": {"low":+x,"mid":+y,"high":+z}, ... },   # additive BPM change by class transition x prior-BPM tier
    "rate_mult": { "so": {...}, ... },                           # multiplicative per-40 scoring change
    "meta": {...} }

Usage: python3 scripts/build_dev_curves.py
"""
import urllib.request, json, os
from collections import defaultdict
from statistics import median

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
OUT = os.path.join(os.path.dirname(__file__), "data", "dev_curves.json")


def q(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(SB + "/rest/v1/" + path, headers=H), timeout=60))


def q_all(path):
    """Paginate past PostgREST's 1000-row cap via Range headers."""
    out = []; start = 0
    while True:
        h = dict(H); h["Range-Unit"] = "items"; h["Range"] = f"{start}-{start+999}"
        req = urllib.request.Request(SB + "/rest/v1/" + path, headers=h)
        chunk = json.load(urllib.request.urlopen(req, timeout=60))
        out += chunk
        if len(chunk) < 1000: break
        start += 1000
    return out


def cls(c):
    c = (c or "").lower()
    if c.startswith("fr"): return "fr"
    if c.startswith("so"): return "so"
    if c.startswith("jr"): return "jr"
    if c.startswith("sr") or c.startswith("gr"): return "sr"
    return None


def tier(bpm):
    return "low" if bpm < 0 else ("mid" if bpm < 5 else "high")


def num(d, k):
    try: return float(d.get(k))
    except Exception: return None


def main():
    # pull every player-season with a real role, year by year (cheap, ~20 requests)
    rows = []
    for yr in range(2005, 2027):
        try:
            r = q_all(f"bbref_seasons?season_year=eq.{yr}&select=bbref_id,season_year,class,advanced,pergame")
        except Exception as e:
            print("skip", yr, str(e)[:60]); continue
        rows += r
        print(f"  {yr}: {len(r)}", flush=True)
    # index by player
    byp = defaultdict(list)
    for x in rows:
        bid = x.get("bbref_id")
        if not bid: continue
        adv = x.get("advanced") or {}; pg = x.get("pergame") or {}
        bpm = num(adv, "bpm"); mp = num(pg, "mp_per_g")
        if bpm is None or mp is None or mp < 8: continue
        # per-40 scoring proxy = points per 40 (from fg2/fg3/ft per-game scaled)
        f2 = num(pg, "fg2_per_g") or 0; f3 = num(pg, "fg3_per_g") or 0; ft = num(pg, "ft_per_g") or 0
        pts = 2 * f2 + 3 * f3 + ft
        p40 = pts * 40.0 / mp if mp else 0
        byp[bid].append({"yr": x["season_year"], "cls": cls(x.get("class")), "bpm": bpm, "p40": p40, "mp": mp})

    bpm_delta = defaultdict(lambda: defaultdict(list))   # transition -> tier -> [delta]
    rate_mult = defaultdict(lambda: defaultdict(list))
    abs_change = []                                       # for the "1% vs 9%" validation
    for bid, ss in byp.items():
        ss.sort(key=lambda s: s["yr"])
        for a, b in zip(ss, ss[1:]):
            if b["yr"] != a["yr"] + 1: continue          # consecutive seasons only
            trans = b["cls"]                              # the class he BECOMES (so=after fr yr)
            if trans not in ("so", "jr", "sr"): continue
            t = tier(a["bpm"])
            bpm_delta[trans][t].append(b["bpm"] - a["bpm"])
            if a["p40"] > 3:
                rate_mult[trans][t].append(b["p40"] / a["p40"])
                abs_change.append(abs(b["p40"] / a["p40"] - 1))

    def agg(d, f=median):
        out = {}
        for tr, tiers in d.items():
            out[tr] = {t: round(f(v), 3) for t, v in tiers.items() if len(v) >= 25}
        return out

    curves = {"bpm_delta": agg(bpm_delta), "rate_mult": agg(rate_mult),
              "meta": {"players": len(byp), "pairs": sum(len(v) for tiers in bpm_delta.values() for v in tiers.values())}}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(curves, open(OUT, "w"), indent=0)

    # validation: is real YoY change ">>1%"?
    ac = sorted(abs_change)
    if ac:
        med = ac[len(ac) // 2] * 100
        p75 = ac[len(ac) * 3 // 4] * 100
        p90 = ac[len(ac) * 9 // 10] * 100
        print(f"\nYoY per-40 scoring change (|Δ|): median {med:.0f}% · p75 {p75:.0f}% · p90 {p90:.0f}%  (n={len(ac)})")
    print("BPM development (median additive Δ by class transition x prior tier):")
    for tr in ("so", "jr", "sr"):
        print(f"  {tr:>3}:", curves["bpm_delta"].get(tr, {}))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
