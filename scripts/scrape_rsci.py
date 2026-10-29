#!/usr/bin/env python3
"""scrape_rsci.py — the RSCI (Recruiting Services Consensus Index) top-100 for every class, 1998 on.

RSCIhoops (sites.google.com/site/rscihoops) publishes each class as a public Google Sheet: the consensus rank
plus every service's own rank that year (ESPN, 247Sports, Rivals, Scout, On3, VC… the set changes over time),
height, position, hometown and college. We take each class's FINAL list (or the newest list for a class that
hasn't finished), export the sheet as CSV and keep every service column.

Output: scripts/data/rsci.json  {"<class>": {"list": "2018 Final", "services": [...], "players": [...]}}
(gitignored with the other raw rankings; only derived numbers ship).

    python3 scripts/scrape_rsci.py
"""
import csv, io, json, re, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "data" / "rsci.json"
SITE = "https://sites.google.com/site/rscihoops/home"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124 Safari/537.36")
# list-name order of preference for a class: the final list wins, then the latest in-season one
PREF = ["final", "midseason", "fall", "summer", "pre-summer"]
# sheet columns that are NOT a service's rank
NOT_SERVICE = {"rsci", "chg", "avg", "dev", "total", "ht", "pos", "city", "college", "school", "hometown", "name", "player", ""}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Language": "en-US,en;q=0.9"})
    return urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "ignore")


def lists():
    """{class: (slug, label)} — the preferred list per class from the site's nav"""
    page = get(SITE + "/rankings")
    found = {}
    for slug in set(re.findall(r"/site/rscihoops/home/rankings/((\d{4})-[a-z-]+)", page)):
        slug, yr = slug
        kind = slug[5:]
        if kind not in PREF: continue
        cur = found.get(yr)
        if cur is None or PREF.index(kind) < PREF.index(cur[5:]):
            found[yr] = slug
    return {int(y): s for y, s in found.items()}


def parse(text):
    """header row = the one with an RSCI column; services = the columns between the name and Total"""
    rows = list(csv.reader(io.StringIO(text)))
    hi = next(i for i, r in enumerate(rows) if any(c.strip().upper() == "RSCI" for c in r))
    low = [h.strip().lower() for h in rows[hi]]
    c_rk = low.index("rsci")
    c_tot = low.index("total") if "total" in low else len(low)
    col = lambda *names: next((i for i, h in enumerate(low) if h in names), None)
    c_ht, c_pos = col("ht", "height"), col("pos", "position")
    c_city, c_col = col("city", "hometown"), col("college", "school")
    c_nm = col("player name", "player", "name")
    body = [r for r in rows[hi + 1:] if len(r) > c_rk and r[c_rk].strip().isdigit()]
    if c_nm is None:   # unlabeled: the column (left of Total) that holds "First Last" in the most rows
        c_nm = max(range(c_tot), key=lambda i: sum(1 for r in body if i < len(r) and re.search(r"[A-Za-z]{2,}\.? +[A-Za-z]", r[i])))
    services = [(i, rows[hi][i].strip()) for i in range(c_nm + 1, c_tot) if low[i] and low[i] not in NOT_SERVICE]
    cell = lambda r, i: r[i].strip() if i is not None and i < len(r) else ""
    out = []
    for r in rows[hi + 1:]:
        if len(r) <= c_rk or not r[c_rk].strip().isdigit() or not cell(r, c_nm): continue
        sv = {s: int(cell(r, i)) for i, s in services if re.fullmatch(r"\d+", cell(r, i))}
        out.append({"rsci": int(r[c_rk]), "name": cell(r, c_nm), "svc": sv, "ht": cell(r, c_ht), "pos": cell(r, c_pos),
                    "home": cell(r, c_city), "college": cell(r, c_col)})
    return [s for _, s in services], out


def main():
    data = json.load(open(OUT)) if OUT.exists() else {}
    for yr, slug in sorted(lists().items()):
        try:
            page = get("%s/rankings/%s" % (SITE, slug))
            sid = re.search(r"spreadsheets/d/([A-Za-z0-9_-]+)", page).group(1)
            services, players = parse(get("https://docs.google.com/spreadsheets/d/%s/export?format=csv" % sid))
        except Exception as e:
            print("%d %s: FAILED %s" % (yr, slug, e)); continue
        data[str(yr)] = {"list": slug, "sheet": sid, "services": services, "players": players}
        print("%d %-16s %3d players  services: %s" % (yr, slug, len(players), ", ".join(services)))
        time.sleep(0.8)
    OUT.write_text(json.dumps(data, indent=1, sort_keys=True))
    print("wrote %d classes -> %s" % (len(data), OUT.name))


if __name__ == "__main__":
    main()
