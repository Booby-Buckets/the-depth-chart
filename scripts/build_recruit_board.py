#!/usr/bin/env python3
"""build_recruit_board.py — consensus recruit rankings for every class, what each recruit became, and how well
each recruiting service called it.

Inputs (all local):
  scripts/data/rsci.json            RSCI top-100 per class 1998+ with every service's own rank (scrape_rsci.py)
  scripts/data/r247_classes.json    247Sports + 247 Composite lists 2008+, committed and not (scrape_247_classes.py)
  data/commits_ledger.json          live commitments for the upcoming classes (build_commits.py)
  scripts/data/derived_stats_<y>.json, stat_overall_history.json, nba_bridge.csv, nba_draft.jsonl  -> outcomes

Consensus rank (ours): each recruit's average rank across the services that ranked his class (a service that ranked
the class but left him out counts as one past the end of its list), re-ranked within the class. Classes with no
RSCI list yet (two+ years out) fall back to the 247 Composite, itself an industry average.

Outcome score (0-100, classes 2009+): college (career Wins Added) and pro (NBA minutes, draft slot as the tie-breaker
for players who barely played), each a percentile within the class's ranked pool; the better of the two weighs 70%. "Expected" is what
recruits ranked around him scored across every finished class; the verdict compares the two.

Writes data/recruits/index.json, data/recruits/<class>.json, data/recruits/sites.json.
Service-by-service ranks only ship for finished classes (the report card's evidence); current and future classes
ship our consensus only.

    python3 scripts/build_recruit_board.py               # every class (run locally: needs the full raw scrapes)
    python3 scripts/build_recruit_board.py --upcoming    # nightly in CI: just the classes still being recruited
"""
import csv, datetime, json, re, statistics, sys, unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "scripts" / "data"
OUT = ROOT / "data" / "recruits"
sys.path.insert(0, str(ROOT / "scripts"))
from build_commits import team_resolver

# never judged: players whose careers ended in tragedy, not on the court
NO_VERDICT = {"terrence clarke"}
FIRST_STATS = 2010          # first college season (season_year) we have box stats for
FINISHED_SEASONS = 4        # a class is "finished" once it has had this many college seasons
# RSCI's column names -> one name per service. Old two-letter codes only where we're sure who they were:
# RC = Rivals.com; SC = Scout; DT = Dave Telep (Scout's national analyst through 2010, ESPN's from 2011).
SVC = {"Rivals": "Rivals", "RC": "Rivals", "Rivals/On3": "On3", "On3": "On3", "247Sports": "247Sports",
       "ESPN": "ESPN", "Scout": "Scout", "SC": "Scout", "VC": "VerbalCommits", "PrepStars": "PrepStars", "PS": "PrepStars"}
REPORT = ["ESPN", "Rivals", "247Sports", "Scout", "On3", "VerbalCommits", "PrepStars", "247 Composite"]


def svc_name(col, year):
    if col == "DT": return "Scout" if year <= 2010 else "ESPN"
    return SVC.get(col)


def nk(s):
    """name key: accents, punctuation, suffixes and initials' dots out ("C.J. Rosser Jr." -> "cj rosser")"""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[.'’`]", "", s).replace("-", " ")
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", s)
    return re.sub(r"[^a-z ]", " ", re.sub(r"\s+", " ", s)).strip()


def last(s):
    p = nk(s).split()
    return p[-1] if p else ""


def city(s):
    return re.sub(r"[^a-z]", "", (s or "").split(",")[0].lower())


def this_class():
    d = datetime.date.today()
    return d.year + 1 if d.month >= 7 else d.year


# ── outcomes ──────────────────────────────────────────────────────────────────────────
def load_outcomes():
    seasons = defaultdict(list)          # espn -> [(season, team, min, wa)]
    by_name = defaultdict(set)           # name key -> {espn}
    for f in sorted(D.glob("derived_stats_*.json")):
        y = int(f.stem.split("_")[-1])
        for e, r in json.load(open(f)).items():
            seasons[e].append((y, r.get("team") or "", r.get("min") or 0, (r.get("owa") or 0) + (r.get("dwa") or 0)))
            by_name[nk(r.get("name"))].add(e)
    ovr = defaultdict(int)
    for y, m in json.load(open(D / "stat_overall_history.json")).items():
        for e, v in m.items():
            if v and v > ovr[e]: ovr[e] = v
    nba = {r["espn_id"]: r for r in csv.DictReader(open(D / "nba_bridge.csv"))}
    draft, draft_name = {}, defaultdict(list)
    for l in open(D / "nba_draft.jsonl"):
        r = json.loads(l)
        if r.get("college_athlete_id"): draft[str(r["college_athlete_id"])] = r
        draft_name[nk(r["name"])].append(r)
    nba_seasons = defaultdict(lambda: [0, 9999])       # (name key, nba id) -> [career minutes, first season]
    for r in json.load(open(D / "nba_player_seasons.json")).values():
        t = nba_seasons[(nk(r["name"]), r["espn_id"])]; t[0] += r.get("min") or 0; t[1] = min(t[1], r["season_year"])
    pro_min = defaultdict(list)
    for (k, _), (m, fs) in nba_seasons.items(): pro_min[k].append((fs, m))
    return seasons, by_name, ovr, nba, draft, draft_name, pro_min


def link(p, year, school_full, O):
    """espn_id of the recruit's college career: name match whose first season is his freshman (or redshirt) year;
    when several namesakes fit, the one at his school"""
    seasons, by_name = O[0], O[1]
    fy = year + 1
    cands = []
    for e in by_name.get(nk(p["name"]), ()):
        first = min(s[0] for s in seasons[e])
        ok = fy <= first <= fy + 1 if fy > FIRST_STATS else (first == FIRST_STATS and any(s[0] <= fy + 3 for s in seasons[e]))
        if ok: cands.append(e)
    if len(cands) > 1 and school_full:
        at = [e for e in cands if any(s[1] == school_full for s in seasons[e])]
        cands = at or cands
    if len(cands) == 1: return cands[0]
    if not cands and school_full:   # nickname / spelling: same surname at the same school in his freshman year
        for e in {e for k, v in by_name.items() if k.split() and k.split()[-1] == last(p["name"]) for e in v}:
            ss = sorted(seasons[e])
            if ss and ss[0][1] == school_full and fy <= ss[0][0] <= fy + 1: cands.append(e)
        if len(cands) == 1: return cands[0]
    return None


def outcome(e, p, year, O):
    seasons, _, ovr, nba, draft, draft_name, pro_min = O
    o = {}
    if e:
        ss = seasons[e]
        o.update({"espn": e, "yrs": len(ss), "min": int(sum(s[2] for s in ss)), "wa": round(sum(s[3] for s in ss), 1),
                  "ovr": ovr.get(e) or None})
        b = nba.get(e)
        if b:
            o["nba_min"] = int(float(b.get("nba_min") or 0))
            if b.get("tier_career_name") and b["tier_career_name"] != "No NBA": o["tier"] = b["tier_career_name"]
        dr = draft.get(e)
        if dr: o["pick"] = dr["overall"]; o["dy"] = dr["draft_year"]
    if "pick" not in o:   # straight to the pros (prep school, G League, overseas) — no college record
        for dr in draft_name.get(nk(p["name"]), []):
            if year <= dr["draft_year"] <= year + 3 and not dr.get("college_athlete_id"):
                o.update({"pick": dr["overall"], "dy": dr["draft_year"], "pro": 1})
                m = [mn for fs, mn in pro_min.get(nk(p["name"]), []) if fs >= dr["draft_year"]]
                if m: o["nba_min"] = int(max(m))
    return o


def pct_rank(vals):
    """value -> percentile (0-100), ties share the average"""
    s = sorted(vals); n = len(s)
    pos = defaultdict(list)
    for i, v in enumerate(s): pos[v].append(i)
    return {v: 100.0 * statistics.mean(ix) / max(1, n - 1) for v, ix in pos.items()}


# ── build ─────────────────────────────────────────────────────────────────────────────
def main():
    rsci = json.load(open(D / "rsci.json"))
    r247 = json.load(open(D / "r247_classes.json")) if (D / "r247_classes.json").exists() else {}
    led = json.load(open(ROOT / "data" / "commits_ledger.json"))
    resolve = team_resolver()
    O = None if "--upcoming" in sys.argv else load_outcomes()   # outcome files are local-only; upcoming classes aren't judged anyway
    NOW = this_class()
    last_season = max((int(f.stem.split("_")[-1]) for f in D.glob("derived_stats_*.json")), default=NOW - 1)
    classes = sorted({int(y) for y in rsci} | {int(y) for y in r247} | {r["cls"] for r in led["recruits"].values()})
    upcoming = "--upcoming" in sys.argv   # nightly: only the classes still being recruited; finished classes stay as built
    if upcoming: classes = [c for c in classes if c >= NOW]
    ledger_by = defaultdict(dict)
    for r in led["recruits"].values(): ledger_by[r["cls"]][r["id"]] = r

    OUT.mkdir(parents=True, exist_ok=True)
    allp, index = {}, []
    for year in classes:
        R = rsci.get(str(year), {"players": [], "services": []})
        B = r247.get(str(year), {})
        # merge RSCI rows onto 247 rows: name, then surname + hometown
        pool, by_nk, by_lc = [], {}, {}
        for pid, b in B.items():
            p = dict(b, id=pid, svc={}); pool.append(p)
            by_nk.setdefault(nk(b["name"]), p); by_lc.setdefault((last(b["name"]), city(b.get("home"))), p)
            if b.get("rcomp"): p["svc"]["247 Composite"] = b["rcomp"]
            if b.get("r247"): p["svc"]["247Sports"] = b["r247"]
        for r in R["players"]:
            p = by_nk.get(nk(r["name"])) or by_lc.get((last(r["name"]), city(r.get("home"))))
            if p is None:
                p = {"name": r["name"], "pos": r.get("pos"), "ht": r.get("ht"), "home": r.get("home"), "svc": {}}; pool.append(p)
            p["rsci"] = r["rsci"]
            if r.get("home"): p["home"] = r["home"]   # RSCI lists the hometown; 247's line is the high school's town
            if r.get("college") and not p.get("school"): p["school"] = r["college"]
            for col, v in r["svc"].items():
                s = svc_name(col, year)
                if not s or (s == "247Sports" and "247Sports" in p["svc"]): continue   # 247's own list already came from 247
                p["svc"][s] = v
        # live ledger for upcoming classes: commitment status + any commit 247's lists don't rank
        L = ledger_by.get(year, {})
        for p in pool:
            l = L.get(p.get("id"))
            if l:
                p["status"] = l["status"]; p["school"] = l.get("school") or p.get("school")
                p["team"] = l.get("team"); p["date"] = l.get("commit_date")
        for lid, l in L.items():
            if not any(p.get("id") == lid for p in pool):
                pool.append({"id": lid, "name": l["name"], "pos": l.get("pos"), "ht": l.get("ht"), "wt": l.get("wt"), "hs": l.get("hs"),
                             "home": l.get("home"), "school": l.get("school"), "team": l.get("team"), "status": l["status"],
                             "date": l.get("commit_date"), "svc": {}})

        # consensus: average rank over the services that ranked this class (missing = one past the list's end)
        lens = defaultdict(int)
        for p in pool:
            for s, v in p["svc"].items(): lens[s] = max(lens[s], v)
        rsci_svcs = {s for p in pool for s in p["svc"] if s not in ("247 Composite", "247Sports")} | ({"247Sports"} if R["players"] else set())
        use = sorted(rsci_svcs) if rsci_svcs else (["247 Composite"] if "247 Composite" in lens else ["247Sports"])
        if (year < 2004 or len(rsci_svcs - {"247Sports"}) < 2) and R["players"]:
            use = ["RSCI"]   # early classes: the services are initials we can't name, so RSCI's own consensus stands in
            lens["RSCI"] = max(p.get("rsci") or 0 for p in pool)
        if R["players"] and "247 Composite" in lens: use.append("247 Composite")
        rk = lambda p, s: p.get("rsci") if s == "RSCI" else p["svc"].get(s)
        for p in pool:
            have = [s for s in use if rk(p, s)]
            p["_score"] = statistics.mean(rk(p, s) or lens[s] + 1 for s in use) if have else None
            p["_n"] = len(have)
        ranked = sorted([p for p in pool if p["_score"] is not None], key=lambda p: (p["_score"], -p["_n"], p["name"]))
        for i, p in enumerate(ranked): p["cr"] = i + 1

        finished = year + FINISHED_SEASONS <= last_season
        judged = year >= FIRST_STATS - 1 and year + 1 <= last_season
        for p in pool:
            p["team"] = p.get("team") or (resolve(p["school"]) if p.get("school") else None)
            if not p.get("status"):
                p["status"] = ("committed" if p.get("school") else "uncommitted") if year >= NOW else ("enrolled" if p.get("school") else "")
            if judged and O:
                p["out"] = outcome(link(p, year, p["team"], O), p, year, O)
        allp[year] = (pool, ranked, finished, judged, use)

    # outcome score: percentile within the class's consensus top 150 (the pool the services actually rank)
    for year, (pool, ranked, finished, judged, use) in allp.items():
        if not judged: continue
        top = ranked[:150]
        cw = pct_rank([p["out"].get("wa", 0) for p in top])
        nv = lambda o: o.get("nba_min", 0) + (61 - o["pick"]) * 15 if o.get("pick") else o.get("nba_min", 0)
        cn = pct_rank([nv(p["out"]) for p in top])
        for p in pool:
            o = p["out"]
            if p.get("cr") and p["cr"] <= 150:
                # the better of the two counts most: an elite college career OR an NBA one both live up to the hype
                hi, lo = sorted([cw[o.get("wa", 0)], cn[nv(o)]], reverse=True)
                o["score"] = round(0.7 * hi + 0.3 * lo)

    # where each finished in his class (1 = best career of the class's ranked pool) — "which site was closest"
    for year, (pool, ranked, finished, judged, use) in allp.items():
        sc = sorted([p for p in ranked[:150] if "score" in (p.get("out") or {})], key=lambda p: -p["out"]["score"])
        for i, p in enumerate(sc): p["out"]["or"] = i + 1

    # expected score by consensus rank, from finished classes (±6-rank window)
    by_rank = defaultdict(list)
    for year, (pool, ranked, finished, judged, use) in allp.items():
        if finished and judged:
            for p in ranked[:150]:
                if "score" in p["out"]: by_rank[p["cr"]].append(p["out"]["score"])
    expect = {}
    for r in range(1, 151):
        w = [v for k in range(max(1, r - 6), min(150, r + 6) + 1) for v in by_rank.get(k, [])]
        expect[r] = round(statistics.mean(w)) if w else None
    for year, (pool, ranked, finished, judged, use) in allp.items():
        for p in ranked[:150]:
            o = p.get("out") or {}
            if "score" not in o or expect.get(p["cr"]) is None: continue
            o["exp"] = expect[p["cr"]]
            d = o["score"] - o["exp"]
            if nk(p["name"]) in NO_VERDICT: o.pop("exp", None); o.pop("score", None); continue
            if not finished: o["verdict"] = "early"
            elif p["cr"] <= 25 and o["score"] < 30: o["verdict"] = "bust"
            elif p["cr"] > 60 and o["score"] >= 85: o["verdict"] = "steal"
            elif d >= 20: o["verdict"] = "over"
            elif d <= -20: o["verdict"] = "under"
            else: o["verdict"] = "met"

    # report card: per service, per finished class — rank correlation with the outcome, top-10 hits, top-25 busts
    sites = defaultdict(lambda: {"years": {}})
    for year, (pool, ranked, finished, judged, use) in sorted(allp.items()):
        if not (finished and judged): continue
        scored = [p for p in ranked[:150] if "score" in p.get("out", {})]
        best20 = {id(p) for p in sorted(scored, key=lambda p: -p["out"]["score"])[:20]}
        for s in REPORT + ["TDC Consensus"]:
            if s == "TDC Consensus": rk = {id(p): p["cr"] for p in scored if p["cr"] <= 100}
            else: rk = {id(p): p["svc"][s] for p in scored if s in p.get("svc", {}) and p["svc"][s] <= 100}
            if len(rk) < 40: continue
            ps = [p for p in scored if id(p) in rk]
            rho = spearman([-rk[id(p)] for p in ps], [p["out"]["score"] for p in ps])
            t10 = sorted(ps, key=lambda p: rk[id(p)])[:10]
            t25 = sorted(ps, key=lambda p: rk[id(p)])[:25]
            miss = sorted([p for p in t25], key=lambda p: p["out"]["score"])[:3]
            sites[s]["years"][year] = {"rho": round(rho, 3), "n": len(ps), "hit10": sum(id(p) in best20 for p in t10),
                                       "bust25": sum(p["out"]["score"] < 30 for p in t25),
                                       "miss": [[p["name"], rk[id(p)], p["out"]["score"]] for p in miss]}
    for s, v in sites.items():
        ys = v["years"].values()
        v.update({"classes": len(ys), "rho": round(statistics.mean(y["rho"] for y in ys), 3),
                  "hit10": round(statistics.mean(y["hit10"] for y in ys), 2), "bust25": round(statistics.mean(y["bust25"] for y in ys), 2)})

    # write
    for year, (pool, ranked, finished, judged, use) in allp.items():
        rows = []
        for p in sorted(pool, key=lambda p: (p.get("cr") or 10**6, p["name"])):
            r = {"n": p["name"], "pos": p.get("pos") or "", "ht": fix_ht(p.get("ht")), "home": p.get("home") or "", "hs": p.get("hs") or "",
                 "school": p.get("school") or "", "team": p.get("team") or "", "st": p.get("status") or "", "cr": p.get("cr"),
                 "date": p.get("date")}
            if year < NOW and p.get("svc"): r["svc"] = {k: v for k, v in p["svc"].items() if k in REPORT}
            if p.get("out"): r["out"] = p["out"]
            rows.append({k: v for k, v in r.items() if v not in (None, "", {})})
        (OUT / ("%d.json" % year)).write_text(json.dumps({"class": year, "finished": finished, "judged": judged,
                                                           "services": use, "players": rows}, separators=(",", ":")))
        index.append({"class": year, "players": len(rows), "ranked": len(ranked), "finished": finished, "judged": judged,
                      "committed": sum(1 for p in pool if p.get("status") in ("committed", "signed")),
                      "uncommitted": sum(1 for p in pool if p.get("status") == "uncommitted"),
                      "linked": sum(1 for p in ranked[:100] if (p.get("out") or {}).get("espn") or (p.get("out") or {}).get("pro"))})
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if upcoming and (OUT / "index.json").exists():
        old = json.load(open(OUT / "index.json"))
        keep = [c for c in old["classes"] if c["class"] not in {c["class"] for c in index}]
        old.update({"generated_utc": stamp, "now": NOW, "classes": sorted(keep + index, key=lambda c: c["class"])})
        (OUT / "index.json").write_text(json.dumps(old, separators=(",", ":")))
    else:
        (OUT / "index.json").write_text(json.dumps({"generated_utc": stamp, "now": NOW, "classes": index, "expect": expect}, separators=(",", ":")))
        (OUT / "sites.json").write_text(json.dumps(dict(sites), separators=(",", ":")))
    for c in index:
        print("%d  %4d players  ranked %4d  committed %3d  uncommitted %3d  top-100 linked %3s%s"
              % (c["class"], c["players"], c["ranked"], c["committed"], c["uncommitted"], c["linked"] if c["judged"] else "-",
                 "  finished" if c["finished"] else ""))
    for s in sorted(sites, key=lambda s: -sites[s]["rho"]):
        v = sites[s]; print("%-15s classes %2d  rho %.3f  top-10 hits %.1f  top-25 busts %.1f" % (s, v["classes"], v["rho"], v["hit10"], v["bust25"]))


def fix_ht(h):
    """6'3'' / 6’7" / 6-3 -> 6-3"""
    m = re.match(r"\s*(\d)\D+(\d{1,2})", h or "")
    return "%s-%s" % m.groups() if m else ""


def spearman(a, b):
    ra, rb = pct_rank(a), pct_rank(b)
    x, y = [ra[v] for v in a], [rb[v] for v in b]
    mx, my = statistics.mean(x), statistics.mean(y)
    num = sum((i - mx) * (j - my) for i, j in zip(x, y))
    den = (sum((i - mx) ** 2 for i in x) * sum((j - my) ** 2 for j in y)) ** 0.5
    return num / den if den else 0.0


if __name__ == "__main__":
    main()
