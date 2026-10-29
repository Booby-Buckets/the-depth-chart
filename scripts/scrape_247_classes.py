#!/usr/bin/env python3
"""scrape_247_classes.py — 247Sports' two class rankings (their own 247Sports list and the industry 247 Composite)
for every class, committed AND uncommitted, with the school each player signed with.

Output (gitignored, like recruiting_247.json): scripts/data/r247_classes.json
  {"<class>": {"<247 id>": {name, pos, ht, wt, hs, home, school, slug, r247, rat247, rcomp, ratcomp, stars}}}

    python3 scripts/scrape_247_classes.py              # 2008 .. next class + 3
    python3 scripts/scrape_247_classes.py 2027 2030    # just these classes
"""
import datetime, json, re, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_commits import fetch, clean, pid, meta, size

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "data" / "r247_classes.json"
PAGES = 8          # 50 a page on most classes -> deep enough for every ranked high-major recruit
SLEEP = 1.0


def parse(page):
    rows = []
    for it in re.split(r"rankings-page__list-item", page)[1:]:
        a = re.search(r'rankings-page__name-link"\s+href="([^"]+)"[^>]*>([^<]+)', it)
        if not a or not pid(a.group(1)): continue
        rk = re.search(r'class="rank-column".*?<div class="primary">\s*([0-9]+)', it, re.S)
        sc = re.search(r'class="score[^"]*">\s*([0-9.]+)', it)
        mt = re.search(r'class="meta">\s*([^<]*)', it)
        hs, home = meta(mt.group(1) if mt else "")
        ht, wt = size((re.search(r'class="metrics">\s*([^<]*)', it) or [None, ""])[1])
        pos = re.search(r'class="position">\s*([A-Za-z]{1,3})', it)
        sl = re.search(r'img-link"\s+href="[^"]*/college/([a-z0-9-]+)/season/', it)
        sch = re.search(r'img-link".*?title="([^"]+)"', it, re.S)
        rows.append({"id": pid(a.group(1)), "name": clean(a.group(2)), "pos": pos.group(1).upper() if pos else "",
                     "ht": ht, "wt": wt, "hs": hs, "home": home,
                     "slug": sl.group(1) if sl else None, "school": clean(sch.group(1)) if sl and sch else None,
                     "rank": int(rk.group(1)) if rk else None, "rating": float(sc.group(1)) if sc else None,
                     "stars": len(re.findall(r"icon-starsolid yellow", it)) or None})
    return rows


def pull(year, kind):
    seen, out = set(), []
    base = "https://247sports.com/season/%d-basketball/%s/?InstitutionGroup=HighSchool" % (year, kind)
    for pg in range(1, PAGES + 1):
        try: rows = parse(fetch(base + ("&Page=%d" % pg if pg > 1 else "")))
        except Exception as e: print("  %d %s p%d failed: %s" % (year, kind, pg, e)); break
        fresh = [r for r in rows if r["id"] not in seen]
        if not fresh: break
        seen |= {r["id"] for r in fresh}; out += fresh
        time.sleep(SLEEP)
    return out


def main():
    d = datetime.date.today()
    nxt = d.year + 1 if d.month >= 7 else d.year
    a = [int(x) for x in sys.argv[1:3]]
    y0, y1 = (a[0], a[1]) if len(a) == 2 else (2008, nxt + 3)
    data = json.load(open(OUT)) if OUT.exists() else {}
    for year in range(y0, y1 + 1):
        own, comp = pull(year, "recruitrankings"), pull(year, "compositerecruitrankings")
        cls = {}
        for r, k in [(r, "247") for r in own] + [(r, "comp") for r in comp]:
            p = cls.setdefault(r["id"], {})
            for f in ("name", "pos", "ht", "wt", "hs", "home", "slug", "school"):
                if r.get(f) and not p.get(f): p[f] = r[f]
            if k == "247": p.update({"r247": r["rank"], "rat247": r["rating"]})
            else: p.update({"rcomp": r["rank"], "ratcomp": r["rating"], "stars": r["stars"]})
        if cls: data[str(year)] = cls
        print("%d: 247 %d · composite %d · %d players (%d committed)" % (year, len(own), len(comp), len(cls), sum(1 for p in cls.values() if p.get("slug"))))
        OUT.write_text(json.dumps(data, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
