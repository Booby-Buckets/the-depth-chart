#!/usr/bin/env python3
"""Scrape REAL historical player awards from sports-reference into `awards`.

Coverage (seasons 2007-2026):
  - Consensus All-America 1st/2nd teams (decade pages)
  - Per conference (all 32 in team_seasons -- see CONFS):
      * award winners (POY, DPOY, ROY, 6MOY, MIP, Tournament MVP)
      * All-Conference 1st/2nd/3rd teams
    Coverage varies by league: SR has no All-Conference teams for several
    mid-majors before ~2015, so those seasons store award winners only.

Row shape (public.awards): season_year, player, team, category, detail
  detail = 'National' for All-America, else the short conference code from
  CONFS (ACC / B10 / WCC / MVC / ...). conference.html maps league names to
  these; awards.html uses them directly as its pill labels.

Re-runnable: deletes the scope it rewrites (per season+detail) before insert.
Polite to sports-reference: ~3.2s between requests, browser UA, 429 backoff.
"""
import json, re, time, urllib.request, urllib.parse, sys
import html as html_mod

SB_URL = "https://izlqhnxowdhtdofkwrho.supabase.co"
import os
def _service_key():
    # never committed: env var first, else the untracked local pipeline config
    k = os.environ.get("SUPABASE_SERVICE_KEY")
    if k: return k
    try:
        import importlib.util, pathlib
        p = pathlib.Path(__file__).parent / "load_supabase.py"
        spec = importlib.util.spec_from_file_location("_ls", p)
        m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
        return m.SB_KEY
    except Exception:
        raise SystemExit("Set SUPABASE_SERVICE_KEY (service key) to run this script.")
SB_KEY = _service_key()
H = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json"}
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

YEARS = range(2007, 2027)
# (detail code, sports-reference slug) for every conference in team_seasons.
# The code is what `awards.detail` stores and what awards.html shows as its pill
# label; the first five keep their original values so existing rows stay valid.
# conference.html maps team_seasons.conference -> these codes (AWCODE).
CONFS = [
    ("ACC","acc"), ("B10","big-ten"), ("BIG-12","big-12"), ("Big-East","big-east"), ("SEC","sec"),
    ("A-10","atlantic-10"), ("A-Sun","atlantic-sun"), ("Am. East","america-east"),
    ("American","american"), ("Big Sky","big-sky"), ("Big South","big-south"),
    ("Big West","big-west"), ("CAA","coastal"), ("CUSA","cusa"), ("Horizon","horizon"),
    ("Ivy","ivy"), ("MAAC","maac"), ("MAC","mac"), ("MEAC","meac"), ("MVC","mvc"),
    ("MWC","mwc"), ("NEC","nec"), ("OVC","ovc"), ("Pac-12","pac-12"),
    ("Patriot","patriot"), ("SoCon","southern"), ("Southland","southland"),
    ("SWAC","swac"), ("Summit","summit"), ("Sun Belt","sun-belt"), ("UAC","uac"),
    ("WCC","wcc"),
]
AWARD_MAP = {  # conf-awards rows worth keeping (player awards only — no coaches)
    "POY": "Player of the Year", "DPOY": "Defensive Player of the Year",
    "ROY": "Rookie of the Year", "6MOY": "Sixth Man of the Year",
    "MIP": "Most Improved Player", "Tourney MVP": "Tournament MVP",
}

def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                html = r.read().decode("utf-8", "replace")
            time.sleep(3.2)
            return html.replace("<!--", "").replace("-->", "")   # SR hides tables in comments
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            if e.code == 429: print("  429 — backing off 60s", flush=True); time.sleep(60); continue
            if i == tries-1: raise
            time.sleep(8)
        except Exception:
            if i == tries-1: raise
            time.sleep(8)
    return None

def cells(row_html):
    # entities must be decoded or schools like "Texas A&M" get stored as "Texas A&amp;M",
    # which then fails every downstream name/logo lookup
    out = []
    for m in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row_html, re.S):
        out.append(html_mod.unescape(re.sub(r"<[^>]+>", "", m)).replace("\xa0", " ").strip())
    return out

def table_rows(html, table_id):
    m = re.search(r'<table[^>]*id="%s"[^>]*>(.*?)</table>' % re.escape(table_id), html, re.S)
    if not m:
        # some pages put the id on a wrapper div around a bare <table>
        m = re.search(r'<div[^>]*id="%s"[^>]*>.*?<table[^>]*>(.*?)</table>' % re.escape(table_id), html, re.S)
    if not m: return []
    return re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(1), re.S)

def sb(method, path, body=None):
    req = urllib.request.Request(SB_URL + path, headers={**H, "Prefer": "return=minimal"},
                                 data=json.dumps(body).encode() if body is not None else None, method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status

def replace_rows(season, detail, rows):
    q = f"/rest/v1/awards?season_year=eq.{season}&detail=eq.{urllib.parse.quote(detail)}"
    sb("DELETE", q)
    if rows: sb("POST", "/rest/v1/awards", rows)

def scrape_all_america():
    print("— Consensus All-America —", flush=True)
    pages = ["consensus-all-america-2000-2009", "consensus-all-america-2010-2019", "consensus-all-america-2020-2029"]
    by_season = {}
    for pg in pages:
        html = get(f"https://www.sports-reference.com/cbb/awards/men/{pg}.html")
        if not html: continue
        for yr in YEARS:
            for team_no in (1, 2):
                for row in table_rows(html, f"all-americans-{yr}_{team_no}"):
                    c = cells(row)
                    if len(c) >= 2 and c[0] and c[0] not in ("Player","Totals","Shooting","Per Game"):
                        by_season.setdefault(yr, []).append({
                            "season_year": yr, "player": c[0], "team": c[1],
                            "category": f"Consensus All-America · {'1st' if team_no==1 else '2nd'} Team",
                            "detail": "National"})
    for yr, rows in sorted(by_season.items()):
        replace_rows(yr, "National", rows)
        print(f"  {yr}: {len(rows)} All-Americans", flush=True)

def scrape_conf(code, slug):
    print(f"— {code} —", flush=True)
    for yr in YEARS:
        html = get(f"https://www.sports-reference.com/cbb/conferences/{slug}/men/{yr}.html")
        if not html:
            print(f"  {yr}: no page", flush=True); continue
        rows = []
        # award winners
        for row in table_rows(html, "conf-awards"):
            c = cells(row)
            if len(c) >= 3 and c[0] in AWARD_MAP:
                rows.append({"season_year": yr, "player": c[1], "team": c[2],
                             "category": AWARD_MAP[c[0]], "detail": code})
        # all-conference teams (rows grouped under 1st/2nd/3rd Team header cells)
        current = None
        for row in table_rows(html, "all-conf"):
            c = cells(row)
            if not c: continue
            if c[0] in ("1st Team", "2nd Team", "3rd Team"):
                current = c[0]
                c = c[1:]
            if current and len(c) >= 2 and c[0] and c[0] not in ("Player","Totals","Shooting","Per Game"):
                rows.append({"season_year": yr, "player": c[0], "team": c[1],
                             "category": f"All-Conference · {current}", "detail": code})
        replace_rows(yr, code, rows)
        print(f"  {yr}: {len(rows)} rows", flush=True)

ORIGINAL = {"acc", "big-ten", "big-12", "big-east", "sec"}   # scraped before mid-majors were added

if __name__ == "__main__":
    only = sys.argv[1] if len(sys.argv) > 1 else None
    if only == "new":            # only the conferences not covered by the first run
        for code, slug in CONFS:
            if slug in ORIGINAL: continue
            scrape_conf(code, slug)
        print("done"); raise SystemExit
    if not only or only == "aa":
        scrape_all_america()
    for code, slug in CONFS:
        if only and only not in ("aa", None) and only.lower() != slug: continue
        if only == "aa": continue
        scrape_conf(code, slug)
    print("done")
