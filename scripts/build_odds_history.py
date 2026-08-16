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
import json, os, sys, csv, glob, re
from collections import defaultdict

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "data")
GAMES = os.path.join(DATA, "games.jsonl")
RAW_DIR = os.path.join(DATA, "odds_raw")
HCA = 3.3

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


def match_game(by_key, date, home, away):
    nh, na = norm(home), norm(away)
    g = by_key.get((date, nh, na))
    if g:
        return g, False
    g = by_key.get((date, na, nh))          # feed had teams swapped
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
