#!/usr/bin/env python3
"""
scrape_recruiting.py — pull 247Sports Composite recruiting rankings for the classes
currently on college rosters, to use as a PRIVATE pedigree signal for the projected
grade. The raw rankings are NEVER served to the site (recruiting_247.json is
gitignored); only a derived, bounded pedigree factor influences a player's projected
OVR — we don't republish 247's rankings as a visible feature.

Per-recruit fields kept: name, class year, composite rating (0-100), national rank,
position. Output: scripts/data/recruiting_247.json  { "<year>": [ {...}, ... ] }.

Usage: python3 scrape_recruiting.py [startYear] [endYear] [pagesPerYear]
       (defaults 2022..2026, 2 pages ≈ top 300 each)
"""
import json, os, re, sys, time, html, urllib.request

D = os.path.join(os.path.dirname(__file__), "data")
OUT = os.path.join(D, "recruiting_247.json")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124 Safari/537.36")

Y0 = int(sys.argv[1]) if len(sys.argv) > 1 else 2022
Y1 = int(sys.argv[2]) if len(sys.argv) > 2 else 2026
PAGES = int(sys.argv[3]) if len(sys.argv) > 3 else 2

def fetch(url, tries=3):
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")
        except Exception as e:
            last = e; time.sleep(3)
    raise last

def parse(page_html):
    out = []
    for it in re.split(r"rankings-page__list-item", page_html)[1:]:
        nm = re.search(r'rankings-page__name-link"[^>]*>([^<]+)', it)
        if not nm:
            continue
        rk = re.search(r'class="rank-column".*?<div class="primary">\s*([0-9]+)', it, re.S)
        rt = re.search(r'class="score[^"]*">\s*([0-9.]+)', it)
        pos = re.search(r'position"[^>]*>\s*([A-Za-z]{1,3})', it)
        out.append({
            "name": html.unescape(nm.group(1)).strip(),
            "rank": int(rk.group(1)) if rk else None,
            "rating": float(rt.group(1)) if rt else None,
            "pos": pos.group(1).upper() if pos else None,
        })
    return out

def main():
    data = {}
    for yr in range(Y0, Y1 + 1):
        recruits, seen = [], set()
        for pg in range(1, PAGES + 1):
            url = "https://247sports.com/season/%d-basketball/recruitrankings/%s" % (
                yr, ("?Page=%d" % pg if pg > 1 else ""))
            try:
                rows = parse(fetch(url))
            except Exception as e:
                print("  %d p%d FAILED: %s" % (yr, pg, e)); continue
            fresh = [r for r in rows if r["name"] and r["name"].lower() not in seen]
            for r in fresh:
                seen.add(r["name"].lower())
            recruits += fresh
            print("  %d p%d: +%d (%d total)" % (yr, pg, len(fresh), len(recruits)))
            if not fresh:
                break
            time.sleep(1.5)   # be polite
        data[str(yr)] = recruits
        print("%d class: %d recruits" % (yr, len(recruits)))
    payload = {"generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "source": "247sports_composite", "classes": data}
    json.dump(payload, open(OUT, "w"), indent=1, sort_keys=True)
    tot = sum(len(v) for v in data.values())
    print("wrote %d recruits across %d classes -> %s" % (tot, len(data), OUT))

if __name__ == "__main__":
    main()
