#!/usr/bin/env python3
"""
apply_recruiting.py — join the (private, gitignored) 247 recruiting scrape to the
players table by name, and emit a DERIVED pedigree coefficient per player used by
the projected-grade upside. The shipped file (scripts/data/recruit_pedigree.json)
contains ONLY espn_id -> coefficient (0..1) — never 247's names/ranks/ratings — so
we don't republish their rankings; a coefficient is our own model input.

  coefficient = how highly touted (0 = 3-star/unranked, 1 = elite 5-star), from the
  247 Composite rating (0-100). The projected-grade _upside() in tdc-projgrade.js
  turns it into a bounded bump for YOUNG players whose production undersells them.

Usage: python3 apply_recruiting.py [--write]   (default: dry-run match report)
"""
import json, os, re, sys, unicodedata, urllib.request

D = os.path.join(os.path.dirname(__file__), "data")
RAW = os.path.join(D, "recruiting_247.json")
OUT = os.path.join(D, "recruit_pedigree.json")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}

SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b")
def norm(s):
    s = unicodedata.normalize("NFKD", (s or "")).encode("ascii", "ignore").decode()
    s = s.lower().replace(".", " ").replace("'", "")
    s = SUFFIX.sub("", s)
    return re.sub(r"[^a-z ]", " ", s).split()
def key(s):
    w = norm(s)
    return " ".join(w)

# players class (2025-26 snapshot) -> the recruiting class year they entered on
def expected_class_year(yr):
    y = (yr or "").lower(); red = "r-" in y or "rs" in y or "r " in y
    base = {"fr": 2025, "so": 2024, "jr": 2023, "sr": 2022, "gr": 2021}
    for k, v in base.items():
        if k in y:
            return v - (1 if red else 0)
    return None

def ped_coef(rating):
    if rating is None: return 0.0
    return max(0.0, min(1.0, (rating - 85.0) / 13.0))   # 85→0 (mid 3★), 98→1 (elite 5★)

def get_players():
    out = []
    for off in range(0, 6000, 1000):
        q = ("players?select=espn_id,name,yr,class_year,tdc_grade&tdc_grade=not.is.null"
             "&order=name.asc&limit=1000&offset=%d" % off)
        rows = json.load(urllib.request.urlopen(urllib.request.Request(SB + "/rest/v1/" + q, headers=HDR), timeout=60))
        out += rows
        if len(rows) < 1000: break
    return out

def main(write=False):
    raw = json.load(open(RAW))["classes"]
    # name -> list of (classYear, record)
    by_name = {}
    for yr, recs in raw.items():
        for r in recs:
            by_name.setdefault(key(r["name"]), []).append((int(yr), r))

    players = get_players()
    ped = {}; matched = 0; samples = []
    for p in players:
        if not p.get("espn_id"): continue
        cands = by_name.get(key(p.get("name")))
        if not cands: continue
        exp = expected_class_year(p.get("yr") or p.get("class_year"))
        # disambiguate same-name recruits by nearest expected recruiting class
        rec = min(cands, key=lambda c: abs(c[0] - exp) if exp else 0)[1] if len(cands) > 1 else cands[0][1]
        coef = round(ped_coef(rec.get("rating")), 3)
        if coef <= 0: continue
        ped[str(p["espn_id"])] = coef
        matched += 1
        samples.append((coef, rec.get("rank"), rec.get("rating"), p.get("name"), p.get("yr"), p.get("tdc_grade")))

    print("players fetched: %d | matched to a rated recruit: %d" % (len(players), matched))
    print("\ntop matches (coef · 247rank · rating · player · yr · grade):")
    for c, rk, rt, nm, yr, g in sorted(samples, reverse=True)[:18]:
        print("  %.2f  #%-3s %-5s  %-22s %-5s g%s" % (c, rk, rt, str(nm)[:22], str(yr), g))
    for name in ("Braylon Mullins", "Alijah Arenas"):
        hit = [s for s in samples if s[3] == name]
        print("  CHECK %-16s -> %s" % (name, ("coef %.2f (247 #%s, %s)" % (hit[0][0], hit[0][1], hit[0][2])) if hit else "NO MATCH"))

    if not write:
        print("\nDRY RUN — pass --write to emit %s" % OUT); return
    import time
    json.dump({"generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "note": "derived pedigree coefficient (0-1) per espn_id; not 247 rankings",
               "players": ped}, open(OUT, "w"), indent=0, sort_keys=True)
    print("\nwrote %d pedigree coefficients -> %s" % (len(ped), OUT))

if __name__ == "__main__":
    main(write="--write" in sys.argv)
