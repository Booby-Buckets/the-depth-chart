#!/usr/bin/env python3
"""Commitment ledger (recruiting.html): every high-school commit to every program, for every class from
next year's out, kept forever.

Reads 247Sports' public pages:
  /season/<y>-basketball/recruitrankings/  -> ranked recruits + the school each is committed to (discovers programs)
  /season/<y>-basketball/teamrankings/     -> every program 247 has a class for (discovers programs)
  /college/<slug>/season/<y>-basketball/commits/  -> the program's full class: commits (with date), signees, enrollees

and merges what it sees into data/commits_ledger.json. The ledger never forgets. A player who leaves a class
is marked "decommitted" (or moved, if he shows up at another school in the same run) and his history keeps
every step. Public file = facts only (name, position, size, high school, hometown, school, dates, status).
247's star ratings and ranks go to the gitignored scripts/data/commits_247_private.json, the same rule
as recruiting_247.json: we don't republish their rankings.

    python3 scripts/build_commits.py                 # the next 4 classes (2027-2030 during 2026-27)
    python3 scripts/build_commits.py 2020 2026       # backfill past classes (enrolled)
    python3 scripts/build_commits.py --full          # also re-sweep every program the ledger has ever seen
"""
import datetime, html, json, re, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "commits_ledger.json"
PRIV = ROOT / "scripts" / "data" / "commits_247_private.json"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124 Safari/537.36")
CONF = json.load(open(ROOT / "scripts" / "data" / "conf_members_2027.json"))["teams"]   # ESPN full -> league
SLEEP = 1.0
LIVE = ("committed", "signed")        # statuses a sweep can take away
MAX_DROP = 0.25                      # more decommits than this share of a class in one run = a layout change, not news


def today():
    return datetime.date.today().isoformat()


def default_classes():
    d = datetime.date.today()
    base = d.year + 1 if d.month >= 7 else d.year   # 2026-27 season: the 2027 class is the next to enroll
    return list(range(base, base + 4))


def fetch(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
                                                       "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})
            return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")
        except Exception as e:
            last = e; time.sleep(3 * (i + 1))
    raise last


def clean(s):
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


def pid(href):
    """247 player id from /player/cj-rosser-46151476/... (the id is the number at the end of the first slug)"""
    m = re.search(r"/player/[a-z0-9-]*?-(\d+)(?:/|$)", href or "", re.I)
    return m.group(1) if m else None


def meta(s):
    """'Southeastern Prep (Orlando, FL)' -> ('Southeastern Prep', 'Orlando, FL')"""
    s = clean(s)
    m = re.match(r"(.*?)\s*\(([^()]*)\)\s*$", s)
    return (m.group(1).strip(), m.group(2).strip()) if m else (s, "")


def size(s):
    m = re.search(r"([0-9]-[0-9]{1,2})\s*/\s*([0-9]{2,3})", s or "")
    return (m.group(1), int(m.group(2))) if m else ("", None)


def parse_rankings(page, year):
    """ranked recruits on a class page; school slug when committed"""
    rows = []
    for it in re.split(r"rankings-page__list-item", page)[1:]:
        a = re.search(r'rankings-page__name-link"\s+href="([^"]+)"[^>]*>([^<]+)', it)
        if not a: continue
        rk = re.search(r'class="rank-column".*?<div class="primary">\s*([0-9]+)', it, re.S)
        sc = re.search(r'class="score[^"]*">\s*([0-9.]+)', it)
        st = len(re.findall(r"icon-starsolid yellow", it))
        sl = re.search(r'img-link"\s+href="[^"]*/college/([a-z0-9-]+)/season/', it)
        rows.append({"id": pid(a.group(1)), "name": clean(a.group(2)), "cls": year,
                     "slug": sl.group(1) if sl else None,
                     "rank": int(rk.group(1)) if rk else None, "rating": float(sc.group(1)) if sc else None,
                     "stars": st or None})
    return [r for r in rows if r["id"]]


def parse_team(page, year):
    """one program's class page -> (school name, [recruits]); None when the page isn't a class page"""
    if 'ri-page__list' not in page and 'ri-page__heading' not in page:
        return None
    h1 = re.search(r'ri-page__heading">\s*(.*?)\s+\d{4} Basketball Commits', page, re.S)
    school = clean(h1.group(1)) if h1 else None
    out, section = [], None
    lst = re.search(r'data-js="recruit-list">(.*?)</ul>', page, re.S)
    body = lst.group(1) if lst else ""
    for li in re.split(r'<li class="ri-page__list-item', body)[1:]:
        hd = re.search(r'<b class="name">\s*([^<(]+)', li)
        if "list-header" in li[:40] and hd:
            section = clean(hd.group(1)).lower(); continue
        if section and section.startswith("transfer"):
            continue                                   # college transfers belong to the portal page
        a = re.search(r'ri-page__name-link"\s+href="([^"]+)"[^>]*>([^<]+)', li)
        if not a: continue
        mt = re.search(r'class="meta">\s*([^<]*)', li)
        hs, home = meta(mt.group(1) if mt else "")
        ht, wt = size((re.search(r'class="metrics">\s*([^<]*)', li) or [None, ""])[1])
        pos = re.search(r'class="position">\s*([A-Za-z]{1,3})', li)
        cd = re.search(r'class="commit-date[^"]*">\s*([^<]*)', li)
        cd = clean(cd.group(1)) if cd else ""
        dm = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", cd)
        date = "%s-%02d-%02d" % (dm.group(3), int(dm.group(1)), int(dm.group(2))) if dm else None
        low = (cd + " " + (section or "")).lower()
        status = ("enrolled" if "enroll" in low else "signed" if "sign" in low else "committed")
        sc = re.search(r'class="score[^"]*">\s*([0-9.]+)', li)
        st = len(re.findall(r"icon-starsolid yellow", li))
        rk = re.search(r'class="natrank"[^>]*>\s*([0-9]+)', li)
        out.append({"id": pid(a.group(1)), "name": clean(a.group(2)), "cls": year, "pos": pos.group(1).upper() if pos else "",
                    "ht": ht, "wt": wt, "hs": hs, "home": home, "status": status, "date": date,
                    "soft": bool(section and "soft" in section),
                    "rating": float(sc.group(1)) if sc else None, "stars": st or None,
                    "rank": int(rk.group(1)) if rk else None})
    return school, [r for r in out if r["id"]]


def team_resolver():
    """247 school name ('Duke', 'NC State', 'Miami (OH)') -> ESPN full ('Duke Blue Devils'), same longest-school rule as the portal"""
    sys.path.insert(0, str(ROOT / "scripts"))
    from school_xwalk import prefix_pick
    try:
        from build_coach_profiles import ALIAS
    except Exception:
        ALIAS = {}
    fulls = list(CONF)
    n = lambda s: re.sub(r"[^a-z0-9 ]", "", (s or "").lower().replace("&", " and ").replace("-", " ")).strip()
    FN = {n(f): f for f in fulls}; names = list(FN)
    EXTRA = {"UConn": "UConn Huskies", "Connecticut": "UConn Huskies", "Ole Miss": "Ole Miss Rebels", "Pitt": "Pitt Panthers",
             "Pittsburgh": "Pitt Panthers", "UMass": "Massachusetts Minutemen", "Penn": "Pennsylvania Quakers",
             "American": "American University Eagles", "FAU": "Florida Atlantic Owls", "Hawaii": "Hawai'i Rainbow Warriors",
             "ECU": "East Carolina Pirates", "Southeastern Louisiana": "SE Louisiana Lions", "UT Martin": "UT Martin Skyhawks",
             "Miami": "Miami Hurricanes", "Miami (FL)": "Miami Hurricanes", "Miami (OH)": "Miami (OH) RedHawks",
             "NC State": "NC State Wolfpack", "N.C. State": "NC State Wolfpack", "USC": "USC Trojans", "LSU": "LSU Tigers",
             "UCF": "UCF Knights", "SMU": "SMU Mustangs", "TCU": "TCU Horned Frogs", "BYU": "BYU Cougars", "VCU": "VCU Rams",
             "UNLV": "UNLV Rebels", "St. John's": "St. John's Red Storm", "Saint Mary's": "Saint Mary's Gaels",
             "Loyola Chicago": "Loyola Chicago Ramblers", "Texas A&M": "Texas A&M Aggies"}
    SCH = sorted({n(k) for k in EXTRA} | {n(k) for k in ALIAS})
    cache = {}
    def resolve(s):
        if not s: return None
        if s in cache: return cache[s]
        f = None
        if n(s) in FN: f = FN[n(s)]
        elif EXTRA.get(s) in FN.values(): f = EXTRA[s]
        elif ALIAS.get(s) in FN.values(): f = ALIAS[s]
        else:
            hit = prefix_pick(n(s), names, [x for x in SCH if x != n(s)])
            f = FN[hit] if hit else None
        cache[s] = f; return f
    return resolve


def discover(year):
    """program slugs with a class this year + ranked recruits seen on the class rankings"""
    slugs, ranked = set(), []
    for pg in range(1, 30):
        u = "https://247sports.com/season/%d-basketball/teamrankings/%s" % (year, "?Page=%d" % pg if pg > 1 else "")
        try: page = fetch(u)
        except Exception as e: print("  teamrankings %d p%d failed: %s" % (year, pg, e)); break
        got = set(re.findall(r"college/([a-z0-9-]+)/season/%d-basketball/commits" % year, page))
        if not got - slugs: break
        slugs |= got; time.sleep(SLEEP)
    seen = set()
    for pg in range(1, 30):
        u = "https://247sports.com/season/%d-basketball/recruitrankings/?InstitutionGroup=HighSchool%s" % (year, "&Page=%d" % pg if pg > 1 else "")
        try: rows = parse_rankings(fetch(u), year)
        except Exception as e: print("  recruitrankings %d p%d failed: %s" % (year, pg, e)); break
        fresh = [r for r in rows if r["id"] not in seen]
        if not fresh: break
        for r in fresh:
            seen.add(r["id"])
            if r["slug"]: slugs.add(r["slug"])
        ranked += fresh; time.sleep(SLEEP)
    return slugs, ranked


def event(rec, kind, day, **kw):
    e = {"date": day, "event": kind}; e.update({k: v for k, v in kw.items() if v is not None})
    rec.setdefault("history", []).append(e)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    full = "--full" in sys.argv
    classes = list(range(int(args[0]), int(args[1]) + 1)) if len(args) == 2 else default_classes()
    led = json.load(open(OUT)) if OUT.exists() else {"recruits": {}, "slugs": {}}
    priv = json.load(open(PRIV)) if PRIV.exists() else {}
    R, SL = led["recruits"], led.setdefault("slugs", {})
    resolve, day = team_resolver(), today()
    unresolved = set()

    for year in classes:
        print("== %d class" % year)
        slugs, ranked = discover(year)
        for r in ranked:   # private: 247's rank/rating/stars
            priv.setdefault(r["id"], {}).update({"rank": r["rank"], "rating": r["rating"], "stars": r["stars"], "cls": year})
        # every program a live recruit is filed under gets re-checked, so a decommit can't hide
        slugs |= {v["slug"] for v in R.values() if v.get("cls") == year and v.get("status") in LIVE and v.get("slug")}
        if full: slugs |= set(SL)
        seen, swept = {}, set()
        for i, slug in enumerate(sorted(slugs)):
            u = "https://247sports.com/college/%s/season/%d-basketball/commits/" % (slug, year)
            try: parsed = parse_team(fetch(u), year)
            except Exception as e: print("  %s failed: %s" % (slug, e)); continue
            time.sleep(SLEEP)
            if parsed is None: print("  %s: not a class page" % slug); continue
            school, rows = parsed
            school = school or SL.get(slug, {}).get("name") or slug
            full_name = resolve(school)
            if not full_name: unresolved.add(school)
            SL[slug] = {"name": school, "team": full_name, "conf": CONF.get(full_name)}
            swept.add(slug)
            for r in rows:
                seen[r["id"]] = (slug, r)
                p = priv.setdefault(r["id"], {})
                for k in ("rating", "stars", "rank"):
                    if r.get(k) is not None: p[k] = r[k]
                p["cls"] = year
            if (i + 1) % 25 == 0: print("  %d/%d programs" % (i + 1, len(slugs)))

        # merge what we saw
        added = moved = 0
        for rid, (slug, r) in seen.items():
            rec = R.get(rid)
            school, full_name = SL[slug]["name"], SL[slug]["team"]
            info = {k: r[k] for k in ("name", "pos", "ht", "wt", "hs", "home") if r.get(k) not in (None, "")}
            if rec is None:
                rec = R[rid] = {"id": rid, "cls": year, "first_seen": day}
                rec.update(info)
                event(rec, r["status"], r["date"] or day, school=school)
                added += 1
            else:
                rec.update(info)
                if rec.get("slug") != slug and rec.get("slug"):
                    event(rec, "flipped", day, school=school, frm=rec.get("school"))
                    moved += 1
                elif rec.get("status") != r["status"] or rec.get("cls") != year:
                    event(rec, r["status"], r["date"] or day, school=school)
            rec.update({"cls": year, "slug": slug, "school": school, "team": full_name, "status": r["status"],
                        "soft": r["soft"] or None, "last_seen": day})
            if r["date"]: rec["commit_date"] = r["date"]
            elif not rec.get("commit_date") and r["status"] == "committed": rec["commit_date"] = rec.get("first_seen")

        # gone from a program we swept cleanly, and not at any other -> decommitted
        gone = [v for v in R.values() if v.get("cls") == year and v.get("status") in LIVE
                and v.get("slug") in swept and v["id"] not in seen]
        live = sum(1 for v in R.values() if v.get("cls") == year and v.get("status") in LIVE) or 1
        if len(gone) > max(3, MAX_DROP * live):
            print("  !! %d of %d live commits vanished at once: skipping decommits (check the page layout)" % (len(gone), live))
            gone = []
        for v in gone:
            event(v, "decommitted", day, school=v.get("school"))
            v["status"], v["decommit_date"] = "decommitted", day
        print("  %d programs, %d recruits seen: +%d new, %d flipped, %d decommitted"
              % (len(swept), len(seen), added, moved, len(gone)))

    led.update({"generated_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "source": "247Sports team commit pages (facts only)"})
    led["classes"] = sorted({v["cls"] for v in R.values()})
    OUT.write_text(json.dumps(led, indent=1, sort_keys=True))
    PRIV.parent.mkdir(exist_ok=True)
    PRIV.write_text(json.dumps(priv, indent=1, sort_keys=True))
    print("ledger: %d recruits across classes %s -> %s" % (len(R), led["classes"], OUT.name))
    if unresolved: print("unresolved schools (no ESPN team match): %s" % ", ".join(sorted(unresolved)))


if __name__ == "__main__":
    main()
