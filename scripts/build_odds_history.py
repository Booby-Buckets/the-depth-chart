#!/usr/bin/env python3
"""
build_odds_history.py — Betting Hub, Phase B: overlay REAL historical lines.

Source-agnostic. It ingests closing lines from a standard CSV (from a Kaggle export,
a purchased dump, or the-odds-api historical endpoint — any source, one format),
matches each line to our own game results (games.jsonl), and computes the things
bettors actually track:
    • ATS record  — did the team cover the closing spread
    • O/U record  — did the game go over / under the closing total
    • Edge vs close — our power-rating line minus the market's closing spread
These merge into bet_trends_teams.json as a "history" block, so the Betting Lab shows
real ATS/O-U next to the model trends. Nothing here fabricates a line — if no line
file is present, the page just keeps the model-only trends.

INPUT — drop one CSV per season (or one combined) in scripts/data/odds_raw/ with columns:
    date,home,away,spread,total,ml_home,ml_away
      date        YYYY-MM-DD
      home,away   team names (any reasonable form; matched fuzzily to our teams)
      spread      HOME closing spread (negative = home favored, e.g. -6.5)
      total       closing game total (points)
      ml_home,ml_away  American moneyline (optional)
Rows that don't match a final game (by date + team) are reported and skipped.

  python3 scripts/build_odds_history.py                 # ingest scripts/data/odds_raw/*.csv
  python3 scripts/build_odds_history.py --demo 2025     # LOCAL TEST ONLY: fabricates lines
                                                        #   from real results to exercise the
                                                        #   plumbing. Never commit its output.
"""
import json, os, sys, csv, glob, re, time, urllib.request, urllib.parse, urllib.error
from collections import defaultdict
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "data")
GAMES = os.path.join(DATA, "games.jsonl")
RAW_DIR = os.path.join(DATA, "odds_raw")
HCA = 3.3
DEFAULT_SEASONS = [2022, 2023, 2024, 2025, 2026]   # last 5 played seasons (the-odds-api covers ~late-2020+)

# ── team-name normalization: reduce "Duke", "Duke Blue Devils", "DUKE" → same key ──
MASCOT_STOP = set("""blue devils devils wildcats tigers bulldogs cougars gators aggies
huskies volunteers cavaliers cyclones boilermakers jayhawks razorbacks fighting illini
cardinals hurricanes eagles bears wolverines spartans hawkeyes gaels red raiders seahawks
zips rams lopes utes hoosiers buckeyes badgers cornhuskers terrapins nittany lions
demon deacons yellow jackets tar heels wolfpack orange hokies seminoles panthers knights
bearcats bruins trojans sun devils golden gophers musketeers friars pirates bluejays
gamecocks commodores rebels crimson tide mean green golden eagles ragin cajuns owls
minutemen catamounts privateers redhawks red storm crimson vandals broncos mustangs
lobos aztecs falcons flames phoenix runnin rebels anteaters gauchos toreros dons
waves highlanders titans matadors 49ers roadrunners bobcats mountaineers
""".split())
_st = re.compile(r"\bst\.?\b")
def norm(name):
    n = (name or "").lower().strip()
    n = n.replace("&", "and")
    n = _st.sub("state", n)                       # "ohio st" -> "ohio state" (rough)
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    n = re.sub(r"\b(university|univ|the|of)\b", " ", n)
    toks = [t for t in n.split() if t and t not in MASCOT_STOP]
    return " ".join(toks).strip()


def load_games():
    """Return (by_key, name_index). by_key maps (date, nhome, naway) -> game."""
    by_key, name_full = {}, {}
    with open(GAMES) as f:
        for line in f:
            g = json.loads(line)
            if g.get("status") != "STATUS_FINAL":
                continue
            if g.get("home_score") is None or g.get("away_score") is None:
                continue
            nh, na = norm(g["home"]), norm(g["away"])
            by_key[(g["date"], nh, na)] = g
            name_full[nh] = g["home"]; name_full[na] = g["away"]
    return by_key, name_full


def _shift(date, days):
    from datetime import datetime, timedelta
    try:
        return (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=days)).strftime("%Y-%m-%d")
    except ValueError:
        return date

def match_game(by_key, date, home, away):
    nh, na = norm(home), norm(away)
    # try the given date and ±1 day (UTC/ET rollover in feeds), both team orders
    for d in (date, _shift(date, -1), _shift(date, 1)):
        g = by_key.get((d, nh, na))
        if g:
            return g, False
        g = by_key.get((d, na, nh))          # feed had teams swapped
        if g:
            return g, True
    return None, None


def ingest_rows(rows, by_key):
    """rows: list of dicts w/ date,home,away,spread,total,ml_home,ml_away.
    Returns per-team aggregates and a match report."""
    agg = defaultdict(lambda: defaultdict(lambda: {
        "ats_w": 0, "ats_l": 0, "ats_p": 0, "ov": 0, "un": 0, "ou_p": 0,
        "edge": 0.0, "edn": 0, "g": 0}))   # team -> season -> rec
    matched = unmatched = 0
    for r in rows:
        try:
            spread = float(r["spread"]) if r.get("spread") not in (None, "") else None
            total = float(r["total"]) if r.get("total") not in (None, "") else None
        except ValueError:
            continue
        g, swapped = match_game(by_key, r["date"], r["home"], r["away"])
        if not g:
            unmatched += 1
            continue
        matched += 1
        yr = g["season"]
        hs, as_ = g["home_score"], g["away_score"]
        # spread is given HOME-perspective in the feed; if teams were swapped, flip it
        home_spread = spread if (spread is None or not swapped) else -spread
        # actual margins
        for team, opp_pts, tm_pts, tm_spread, is_home in (
            (g["home"], as_, hs, home_spread, True),
            (g["away"], hs, as_, (None if home_spread is None else -home_spread), False),
        ):
            rec = agg[team][yr]
            rec["g"] += 1
            if tm_spread is not None:
                res = (tm_pts - opp_pts) + tm_spread     # >0 cover, =0 push, <0 loss
                if res > 0: rec["ats_w"] += 1
                elif res < 0: rec["ats_l"] += 1
                else: rec["ats_p"] += 1
            if total is not None:
                tot = hs + as_
                if tot > total: rec["ov"] += 1
                elif tot < total: rec["un"] += 1
                else: rec["ou_p"] += 1
    return agg, matched, unmatched


def merge_into_trends(agg):
    """Attach a per-team 'history' block (all seasons summed + per season) onto the
    existing bet_trends_teams.json so the page can show real ATS/O-U."""
    path = os.path.join(DATA, "bet_trends_teams.json")
    trends = json.load(open(path))
    teams = trends["teams"]
    def summ(seasons):
        w=l=p=ov=un=oup=gg=0
        for s in seasons:
            w+=s["ats_w"]; l+=s["ats_l"]; p+=s["ats_p"]; ov+=s["ov"]; un+=s["un"]; oup+=s["ou_p"]; gg+=s["g"]
        atsg=w+l
        oug=ov+un
        return {"g":gg,"ats":f"{w}-{l}"+(f"-{p}" if p else ""),"atsPct":round(w/atsg,3) if atsg else None,
                "ou":f"{ov}-{un}"+(f"-{oup}" if oup else ""),"ovPct":round(ov/oug,3) if oug else None}
    hit=0
    for team, seasons in agg.items():
        if team not in teams:
            continue
        hit+=1
        block=summ(list(seasons.values()))
        block["bySeason"]={str(yr):summ([rec]) for yr,rec in seasons.items()}
        teams[team]["history"]=block
    trends.setdefault("meta",{})["hasHistory"]=hit>0
    json.dump(trends, open(path,"w"), separators=(",",":"))
    print("  merged real-line history onto %d teams" % hit, flush=True)


# ── the-odds-api HISTORICAL integration ────────────────────────────────────
# Docs: https://the-odds-api.com/liveapi/guides/v4/#get-historical-odds
# Key comes from the ODDS_API_KEY env var — NEVER hardcode/commit it. Historical
# access requires a paid plan; each request costs 10 credits × markets × regions.
API_BASE = "https://api.the-odds-api.com/v4"
SPORT = "basketball_ncaab"
DEFAULT_SNAPS = ["16:30", "23:30"]      # UTC: ~11:30am ET (day games) + ~6:30pm ET (night games)


def game_dates(season):
    """Dates (YYYY-MM-DD) that actually had final games this season — snapshot only these."""
    dates = set()
    with open(GAMES) as f:
        for line in f:
            g = json.loads(line)
            if g.get("season") == season and g.get("status") == "STATUS_FINAL" and g.get("date"):
                dates.add(g["date"])
    return sorted(dates)


def api_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "the-depth-chart/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.load(r)
        rem = r.headers.get("x-requests-remaining")
        used = r.headers.get("x-requests-last")
        return body, rem, used


def _median(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else round((xs[n // 2 - 1] + xs[n // 2]) / 2, 1)


def consensus_line(ev):
    """Median closing spread(home) / total / moneyline across all books in one snapshot event."""
    home, away = ev.get("home_team"), ev.get("away_team")
    sp, tot, mlh, mla = [], [], [], []
    for bk in ev.get("bookmakers", []):
        for mk in bk.get("markets", []):
            key = mk.get("key")
            for o in mk.get("outcomes", []):
                if key == "spreads" and o.get("name") == home and o.get("point") is not None:
                    sp.append(float(o["point"]))
                elif key == "totals" and o.get("name") == "Over" and o.get("point") is not None:
                    tot.append(float(o["point"]))
                elif key == "h2h" and o.get("price") is not None:
                    (mlh if o.get("name") == home else mla).append(float(o["price"]))
    return {"spread": _median(sp), "total": _median(tot),
            "ml_home": _median(mlh), "ml_away": _median(mla), "home": home, "away": away}


def _et_date(commence_iso):
    """Map a UTC commence_time to the US-Eastern calendar date (rough -5h; ±1 match covers DST)."""
    try:
        dt = datetime.fromisoformat(commence_iso.replace("Z", "+00:00")) - timedelta(hours=5)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return (commence_iso or "")[:10]


def api_backfill(seasons, key, snaps, markets, regions, dry_run):
    days = []
    for s in seasons:
        days += game_dates(s)
    days = sorted(set(days))
    calls = len(days) * len(snaps)
    per = 10 * len(markets.split(",")) * len(regions.split(","))
    print("Backfill plan: seasons %s · %d game-days · %d snaps/day = %d calls" %
          (seasons, len(days), len(snaps), calls), flush=True)
    print("Estimated credits: %d calls × %d = ~%d credits (historical = 10 × markets × regions per call)" %
          (calls, per, calls * per), flush=True)
    if dry_run:
        print("[dry-run] no API calls made. Set ODDS_API_KEY and drop --dry-run to run for real.", flush=True)
        return None
    if not key:
        print("ERROR: ODDS_API_KEY not set. `export ODDS_API_KEY=...` then re-run.", flush=True)
        return None

    rows_by_key = {}   # (event id) -> best (latest-pre-tip) line row
    snap_ts_cache = {}
    for i, d in enumerate(days):
        # gather each snapshot for the day; keep, per event, the latest snap before tip
        for snap in snaps:
            ts = "%sT%s:00Z" % (d, snap)
            url = "%s/historical/sports/%s/odds?apiKey=%s&regions=%s&markets=%s&oddsFormat=american&date=%s" % (
                API_BASE, SPORT, urllib.parse.quote(key), regions, markets, ts)
            try:
                body, rem, used = api_get(url)
            except urllib.error.HTTPError as e:
                print("  HTTP %s at %s — %s" % (e.code, ts, e.read()[:120]), flush=True)
                if e.code in (401, 422):   # bad key / no historical access — stop
                    return None
                continue
            except Exception as e:
                print("  fetch error at %s: %s" % (ts, e), flush=True)
                continue
            snap_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            for ev in (body.get("data") or []):
                ct = ev.get("commence_time")
                try:
                    tip = datetime.fromisoformat(ct.replace("Z", "+00:00"))
                except Exception:
                    continue
                if snap_dt >= tip:            # snapshot at/after tip — not a pre-tip line
                    continue
                prev = snap_ts_cache.get(ev["id"])
                if prev is None or snap_dt > prev:   # keep the latest pre-tip snapshot
                    line = consensus_line(ev)
                    rows_by_key[ev["id"]] = {"date": _et_date(ct), "home": line["home"], "away": line["away"],
                                             "spread": line["spread"], "total": line["total"],
                                             "ml_home": line["ml_home"], "ml_away": line["ml_away"]}
                    snap_ts_cache[ev["id"]] = snap_dt
        if (i + 1) % 25 == 0:
            print("  %d/%d days · %d events · credits remaining: %s" %
                  (i + 1, len(days), len(rows_by_key), rem if 'rem' in dir() else "?"), flush=True)
    rows = list(rows_by_key.values())
    print("Collected %d game lines from the API." % len(rows), flush=True)
    return rows


def demo(season, by_key):
    """LOCAL TEST ONLY — fabricate closing lines from real results to exercise the
    pipeline. Output is NOT committed/deployed; it just proves the math + matching."""
    import statistics
    rows=[]
    with open(GAMES) as f:
        for line in f:
            g=json.loads(line)
            if g.get("season")!=season or g.get("status")!="STATUS_FINAL": continue
            if g.get("home_score") is None: continue
            # fabricate a "line" ~ actual margin nudged, total ~ actual nudged (deterministic, no RNG)
            margin=g["home_score"]-g["away_score"]
            fake_spread=-round((margin*0.8)+ (1 if margin%2 else -1),1)   # home-perspective
            fake_total=round((g["home_score"]+g["away_score"]) - (g["home_score"]%3) + 1.5,1)
            rows.append({"date":g["date"],"home":g["home"],"away":g["away"],
                         "spread":fake_spread,"total":fake_total,"ml_home":"","ml_away":""})
    print("  [demo] fabricated %d lines for %d" % (len(rows),season), flush=True)
    return rows


def main():
    args=sys.argv[1:]
    by_key, _ = load_games()
    print("loaded %d final games" % len(by_key), flush=True)
    if "--demo" in args:
        yr=int(args[args.index("--demo")+1])
        rows=demo(yr, by_key)
        agg,m,u=ingest_rows(rows, by_key)
        print("  matched %d / unmatched %d (%.1f%% matched)" % (m,u,100*m/(m+u or 1)), flush=True)
        # print a sample team so we can eyeball the math; DO NOT write output in demo mode
        for t in ("Houston Cougars","Duke Blue Devils"):
            if t in agg:
                s=list(agg[t].values())[0]
                print("   %s: ATS %d-%d-%d  O/U %d-%d  (%d g)" %
                      (t,s["ats_w"],s["ats_l"],s["ats_p"],s["ov"],s["un"],s["g"]), flush=True)
        return
    if "--api" in args:
        # pull historical lines straight from the-odds-api
        seasons = DEFAULT_SEASONS
        if "--season" in args:
            seasons = [int(args[args.index("--season")+1])]
        elif "--seasons" in args:
            seasons = [int(x) for x in args[args.index("--seasons")+1].split(",")]
        snaps = DEFAULT_SNAPS
        if "--snaps" in args:
            snaps = args[args.index("--snaps")+1].split(",")
        markets = args[args.index("--markets")+1] if "--markets" in args else "spreads,totals,h2h"
        regions = args[args.index("--regions")+1] if "--regions" in args else "us"
        key = os.environ.get("ODDS_API_KEY", "")
        rows = api_backfill(seasons, key, snaps, markets, regions, dry_run=("--dry-run" in args))
        if not rows:
            return
        agg, m, u = ingest_rows(rows, by_key)
        print("matched %d / unmatched %d (%.1f%% matched)" % (m, u, 100*m/(m+u or 1)), flush=True)
        if m == 0:
            print("No rows matched — not writing.")
            return
        merge_into_trends(agg)
        print("done.", flush=True)
        return
    files=sorted(glob.glob(os.path.join(RAW_DIR,"*.csv")))
    if not files:
        print("No line files in %s — drop CSVs (date,home,away,spread,total,ml_home,ml_away)." % RAW_DIR)
        print("Nothing to do; the page keeps model-only trends.")
        return
    rows=[]
    for fp in files:
        with open(fp, newline="") as f:
            rows+=list(csv.DictReader(f))
    print("read %d line rows from %d file(s)" % (len(rows),len(files)), flush=True)
    agg,m,u=ingest_rows(rows, by_key)
    print("matched %d / unmatched %d (%.1f%% matched)" % (m,u,100*m/(m+u or 1)), flush=True)
    if m==0:
        print("No rows matched — check date format (YYYY-MM-DD) and team names. Not writing.")
        return
    merge_into_trends(agg)
    print("done.", flush=True)


if __name__ == "__main__":
    main()
