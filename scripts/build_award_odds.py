"""build_award_odds.py — trained individual-award odds -> scripts/data/award_odds.json.

Mirrors the football site's Heisman model (the-depth-chart-cfb/scripts/heisman_model.py +
build_awards.py): a CONDITIONAL LOGIT per award. Within one "race" (a season for National Player of
the Year, a conference-season for the conference awards) P(player wins) = softmax(beta . x) over
every eligible player in that race. Fit with L2 on the real winners vs everyone they beat, and
checked by leaving one season out (how often the real winner is the model's #1 / top 3).

Races and labels (Supabase `awards`, 2007-2026; National POY hard-coded below — not in the table):
  npoy   National Player of the Year   all D-I contenders, one race per season
  poy    Conference Player of the Year   one race per conference-season
  dpoy   Conference Defensive POY        one race per conference-season
  roy    Conference Freshman/Rookie      freshmen only
  sixth  Conference Sixth Man            bench players (started < 40% of his games)

Training rows: Basketball Reference player-seasons (`bbref_seasons`, the only per-season stat source
that covers all 20 years and carries class + games started) joined to team success from
`team_seasons` (win %, Power Rating/SRS, conference, rank inside the conference). The site's own
statistical overall (stat_overall_history.csv, 2010+) is used as a feature where it exists; the
model picks per award whether that beats the box-only version (see VARIANTS).

Forecast (2026-27): the season has not started, so each player's line is the site's PROJECTED line
(stat_overall_projected.json for returners/transfers, the public freshman line — FR_BASE x role x
team fit, as tdc-freshman.js builds it — for newcomers) and his team's strength is the published
projected Power Rating (predictive_ratings). As in the football build, the rest of the season is
simulated N_SIMS times (production drifts around the projection, team strength drifts, a small
chance he misses the year) and softmax probabilities are averaged, with an early-season
temperature that flattens the board: T = 1 + 1.5 x (share of the season still to play) — 2.5
preseason, 1.0 at the end. Once games are played, pass --live (or it auto-detects season-to-date
rows in player_advanced for SEASON) and each player's line becomes a games-weighted blend of what
he has done and his projection.

Run:  python3 scripts/build_award_odds.py            (uses the local pull cache if present)
      python3 scripts/build_award_odds.py --refresh  (re-pull everything from Supabase)
Read-only against Supabase (public anon key). Writes scripts/data/award_odds.json.
"""
import csv, json, math, os, pickle, random, re, sys, time, unicodedata, urllib.request
from collections import Counter, defaultdict

import numpy as np
from scipy.optimize import minimize

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "scripts", "data")
CACHE = os.path.join(DATA, "award_odds_cache.pkl")          # *.pkl is gitignored
OUT = os.path.join(DATA, "award_odds.json")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
OWNER_ID = "c5784cf4-dd77-4429-b0e6-578a0c1c5c8f"            # freshman-editor blob (public read)
SEASON = 2027                                                 # 2026-27, spring year
SEASONS = list(range(2007, 2027))
N_SIMS = 800
TOP_NATIONAL = 20
TOP_CONF = 5

# AP / consensus National Player of the Year (season_year = spring year). 2026 left out: not
# confirmed from data in the project.
NPOY = {2007: ("Kevin Durant", "Texas"), 2008: ("Tyler Hansbrough", "North Carolina"),
        2009: ("Blake Griffin", "Oklahoma"), 2010: ("Evan Turner", "Ohio State"),
        2011: ("Jimmer Fredette", "BYU"), 2012: ("Anthony Davis", "Kentucky"),
        2013: ("Trey Burke", "Michigan"), 2014: ("Doug McDermott", "Creighton"),
        2015: ("Frank Kaminsky", "Wisconsin"), 2016: ("Buddy Hield", "Oklahoma"),
        2017: ("Frank Mason III", "Kansas"), 2018: ("Jalen Brunson", "Villanova"),
        2019: ("Zion Williamson", "Duke"), 2020: ("Obi Toppin", "Dayton"),
        2021: ("Luka Garza", "Iowa"), 2022: ("Oscar Tshiebwe", "Kentucky"),
        2023: ("Zach Edey", "Purdue"), 2024: ("Zach Edey", "Purdue"), 2025: ("Cooper Flagg", "Duke")}
CAT = {"poy": "Player of the Year", "dpoy": "Defensive Player of the Year",
       "roy": "Rookie of the Year", "sixth": "Sixth Man of the Year"}


# ───────────────────────────── Supabase pulls ─────────────────────────────
def sb_get(path, page=1000):
    """Paginated GET. STABLE ORDER required (PostgREST offset pages skip/dupe rows without it)."""
    if "order=" not in path:
        first = path.split("select=", 1)[1].split("&", 1)[0].split(",")[0].split(":")[0]
        path += f"&order={first}.asc"
    out, off = [], 0
    while True:
        url = f"{SB}/rest/v1/{path}&limit={page}&offset={off}"
        for attempt in range(5):
            try:
                ch = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=90))
                break
            except Exception as e:
                if attempt == 4:
                    raise RuntimeError(f"FAILED {url}: {e}")
                time.sleep(1.5 * (attempt + 1))
        out += ch
        if len(ch) < page:
            return out
        off += page


BB_SEL = ("bbref_id,player,school,school_slug,class,pos,espn_id,"
          "g:pergame->>games,gs:pergame->>games_started,mp:pergame->>mp_per_g,"
          "pts:pergame->>pts_per_g,trb:pergame->>trb_per_g,drb:pergame->>drb_per_g,"
          "ast:pergame->>ast_per_g,stl:pergame->>stl_per_g,blk:pergame->>blk_per_g,"
          "tov:pergame->>tov_per_g,fga:pergame->>fga_per_g,fta:pergame->>fta_per_g,"
          "ts:advanced->>ts_pct,usg:advanced->>usg_pct,ws:advanced->>ws,dws:advanced->>dws,"
          "ows:advanced->>ows,bpm:advanced->>bpm")


def pull():
    d = {}
    d["awards"] = sb_get("awards?select=id,season_year,category,team,player,detail&order=id.asc")
    d["bbref"] = []
    for y in SEASONS:
        d["bbref"] += [dict(r, season_year=y) for r in
                       sb_get(f"bbref_seasons?season_year=eq.{y}&select={BB_SEL}&order=bbref_id.asc,school_slug.asc")]
        print(f"  bbref {y}: {len(d['bbref'])}", file=sys.stderr)
    d["team_seasons"] = sb_get("team_seasons?select=season_year,team,conference,wins,losses,conf_wins,conf_losses,srs,ncaa_seed"
                               "&order=season_year.asc,team.asc")
    d["adv"] = []
    for y in range(2012, SEASON + 1):
        d["adv"] += sb_get(f"player_advanced?season_year=eq.{y}&select=espn_id,season_year,team,g,min,ppg,rpg,apg,"
                           f"ts_pct,usg_pct,owa,dwa&order=espn_id.asc,team.asc")
    d["players"] = sb_get("players?name=neq.%E2%80%94&select=id,name,team,espn_id,position,yr,class_year,tdc_grade,"
                          "mpg,depth_order,is_injured,hometown&order=id.asc")
    pr = json.load(urllib.request.urlopen(urllib.request.Request(
        f"{SB}/rest/v1/predictive_ratings?season=eq.{SEASON}&select=data", headers=H), timeout=60))
    blob = pr[0]["data"] if pr else {}
    d["ratings"] = json.loads(blob) if isinstance(blob, str) else blob
    fb = json.load(urllib.request.urlopen(urllib.request.Request(
        f"{SB}/rest/v1/profiles?id=eq.{OWNER_ID}&select=freshman_projections", headers=H), timeout=60))
    d["fresh_blob"] = (fb[0].get("freshman_projections") if fb else None) or {}
    d["team_seasons_now"] = sb_get(f"team_seasons?season_year=eq.{SEASON}&select=team,wins,losses&order=team.asc")
    # season-to-date lines (empty until games are played) — blended with the projection in forecast_rows
    d["std"] = sb_get(f"player_history?season_year=eq.{SEASON}&espn_id=not.is.null&select=espn_id,team,name,gp,mpg,ppg,rpg,"
                      f"apg,stl,blk,dreb,fga,fta&order=espn_id.asc,team.asc")
    d["pulled"] = time.strftime("%Y-%m-%d %H:%M")
    return d


def load(refresh=False):
    if not refresh and os.path.exists(CACHE):
        return pickle.load(open(CACHE, "rb"))
    print("pulling from Supabase…", file=sys.stderr)
    d = pull()
    pickle.dump(d, open(CACHE, "wb"))
    return d


# ───────────────────────────── name helpers ─────────────────────────────
SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]", " ", s.replace("'", "").replace(".", ""))
    s = SUFFIX.sub(" ", s)
    return " ".join(s.split())


def tnorm(s):
    s = norm(s)
    s = re.sub(r"\b(university|univ|of|the|at)\b", " ", s)
    s = s.replace("saint", "st").replace("state", "st")
    return " ".join(s.split())


def fnum(x, d=0.0):
    try:
        v = float(x)
        return v if math.isfinite(v) else d
    except (TypeError, ValueError):
        return d


def clip(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


# ───────────────────────────── history: player-season rows ─────────────────────────────
def team_context(ts_rows):
    """(season, ESPN team) -> games, win %, Power Rating (SRS), conference (may be None — ~15%% of
    team_seasons rows, mostly pre-2021, carry no conference; resolve_conferences fills them)."""
    ctx = {}
    for r in ts_rows:
        g = (r.get("wins") or 0) + (r.get("losses") or 0)
        if not g:
            continue
        ctx[(r["season_year"], r["team"])] = {"season": r["season_year"], "team": r["team"], "conf": r.get("conference"),
                                              "g": g, "winpct": (r["wins"] or 0) / g, "srs": fnum(r.get("srs"))}
    return ctx


def rank_conferences(ctx):
    groups = defaultdict(list)
    for c in ctx.values():
        if c["conf"]:
            groups[(c["season"], c["conf"])].append(c)
    for grp in groups.values():
        grp.sort(key=lambda c: -c["srs"])
        mean = sum(c["srs"] for c in grp) / len(grp)
        for i, c in enumerate(grp):
            c["crank"], c["cn"], c["cmean"] = i + 1, len(grp), mean
    for c in ctx.values():
        c.setdefault("crank", 8); c.setdefault("cn", 12); c.setdefault("cmean", 0.0)


def resolve_conferences(ctx, joined, rows):
    """Fill missing team_seasons conferences: (1) the award `detail` of that team's honorees that
    season, mapped to the full conference name; (2) the team's nearest season that has one."""
    d2c = defaultdict(Counter)
    for a, i in joined:
        c = ctx[(rows[i]["season"], rows[i]["team"])]["conf"]
        if c and a.get("detail") and a["detail"] != "National":
            d2c[a["detail"]][c] += 1
    d2c = {k: v.most_common(1)[0][0] for k, v in d2c.items()}
    vote = defaultdict(Counter)
    for a, i in joined:
        if a.get("detail") in d2c:
            vote[(rows[i]["season"], rows[i]["team"])][d2c[a["detail"]]] += 1
    by_team = defaultdict(dict)
    for (y, t), c in ctx.items():
        if c["conf"]:
            by_team[t][y] = c["conf"]
    filled = Counter()
    for (y, t), c in ctx.items():
        if c["conf"]:
            continue
        if vote.get((y, t)):
            c["conf"] = vote[(y, t)].most_common(1)[0][0]; filled["award"] += 1
        elif by_team[t]:
            c["conf"] = by_team[t][min(by_team[t], key=lambda yy: abs(yy - y))]; filled["nearest"] += 1
    for r in rows:
        r["conf"] = ctx[(r["season"], r["team"])]["conf"]
    rank_conferences(ctx)
    return dict(filled)


def fit_winpct(ctx):
    """win % from Power Rating + conference strength — lets a projected rating stand in for a record."""
    rows = [c for c in ctx.values() if c["conf"]]
    X = np.array([[1.0, c["srs"], c["cmean"]] for c in rows])
    y = np.array([c["winpct"] for c in rows])
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    return b


def slug_team_map(d):
    """bbref school_slug -> ESPN full team name (team_seasons key), by majority vote over players who
    appear in both bbref_seasons and player_advanced (same espn_id + season)."""
    adv = {(r["espn_id"], r["season_year"]): r["team"] for r in d["adv"]}
    vote = defaultdict(Counter)
    for r in d["bbref"]:
        t = adv.get((r["espn_id"], r["season_year"]))
        if t:
            vote[r["school_slug"]][t] += 1
    return {s: c.most_common(1)[0][0] for s, c in vote.items()}


def stat_ovr_history():
    out = {}
    with open(os.path.join(DATA, "stat_overall_history.csv")) as f:
        for r in csv.DictReader(f):
            out[(int(r["espn_id"]), int(r["season_year"]))] = float(r["ovr"])
    return out


def ts_of(ppg, fga, fta):
    den = 2 * (fga + 0.44 * fta)
    return ppg / den if den > 0.5 else 0.5


def feats(line, team, cls):
    """ONE feature builder for history and forecast. line = per-game box + usg/ts/dws/ovr;
    team = {srs, winpct, crank, cn}."""
    g_share = clip(line["played"], 0, 1)
    return {
        "ppg": line["ppg"], "rpg": line["rpg"], "apg": line["apg"],
        "spg": line["spg"], "bpg": line["bpg"], "drpg": line["drpg"],
        "ts": clip(line["ts"], 0.3, 0.8), "usg": clip(line["usg"], 5, 40), "mpg": line["mpg"],
        "dws": line["dws"], "ovr": line["ovr"], "played": g_share,
        "fr": 1.0 if cls == "FR" else 0.0,
        "srs": team["srs"], "winpct": team["winpct"],
        "crank": -math.log(max(1, team["crank"])), "ctop": 1.0 if team["crank"] == 1 else 0.0,
    }


def history_rows(d):
    ctx = team_context(d["team_seasons"])
    smap = slug_team_map(d)
    ovr = stat_ovr_history()
    rows = []
    for r in d["bbref"]:
        team = smap.get(r["school_slug"])
        t = ctx.get((r["season_year"], team))
        g = fnum(r["g"])
        if not t or g < 1:
            continue
        ppg, fga, fta = fnum(r["pts"]), fnum(r["fga"]), fnum(r["fta"])
        ts = fnum(r["ts"]) or ts_of(ppg, fga, fta)
        o = ovr.get((r["espn_id"], r["season_year"])) if r.get("espn_id") else None
        line = {"ppg": ppg, "rpg": fnum(r["trb"]), "apg": fnum(r["ast"]), "spg": fnum(r["stl"]),
                "bpg": fnum(r["blk"]), "drpg": fnum(r["drb"]), "ts": ts, "usg": fnum(r["usg"], 15),
                "mpg": fnum(r["mp"]), "dws": fnum(r["dws"]) * 30.0 / t["g"],     # per 30-game season
                "ovr": o, "played": g / t["g"]}
        rows.append({"season": r["season_year"], "name": r["player"], "nname": norm(r["player"]),
                     "school": r["school"], "team": team, "conf": t["conf"], "cls": (r["class"] or "").upper(),
                     "espn_id": r.get("espn_id"), "bid": r["bbref_id"], "gs_share": fnum(r["gs"]) / g, "g": g,
                     "line": line, "tctx": t})
    return rows, ctx


def impute_ovr(rows):
    """stat overall exists 2010+ for players with an espn_id; fill the rest from a box regression
    (fit on rows that have it) so the owned-metric variant has a value for everyone."""
    K = ["ppg", "rpg", "apg", "spg", "bpg", "ts", "usg", "mpg", "dws"]
    have = [r for r in rows if r["line"]["ovr"] is not None and r["line"]["mpg"] >= 5]
    X = np.array([[1.0] + [r["line"][k] for k in K] for r in have])
    y = np.array([r["line"]["ovr"] for r in have])
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    n = 0
    for r in rows:
        if r["line"]["ovr"] is None:
            r["line"]["ovr"] = float(clip(np.dot(b, [1.0] + [r["line"][k] for k in K]), 50, 99))
            r["ovr_imputed"] = True
            n += 1
    return n, len(rows)


# ───────────────────────────── labels ─────────────────────────────
def join_awards(d, rows):
    """award rows -> history row index. Name match inside the season (bbref and the awards table
    share Sports-Reference spellings), '(2)' repeat markers stripped, team used to break ties,
    difflib fallback for diacritics/apostrophes."""
    import difflib
    by = defaultdict(list)
    names_by_season = defaultdict(set)
    for i, r in enumerate(rows):
        by[(r["season"], r["nname"])].append(i)
        names_by_season[r["season"]].add(r["nname"])

    def pick(season, player, team):
        n = norm(re.sub(r"\s*\(\d+\)\s*$", "", player))
        hits = by.get((season, n))
        if not hits:
            close = difflib.get_close_matches(n, names_by_season[season], n=3, cutoff=0.86)
            hits = [i for c in close for i in by[(season, c)]]
        if not hits:
            return None
        if len(hits) == 1:
            return hits[0]
        tn = tnorm(team)
        return max(hits, key=lambda i: max(difflib.SequenceMatcher(None, tn, tnorm(rows[i]["school"])).ratio(),
                                           difflib.SequenceMatcher(None, tn, tnorm(rows[i]["team"])).ratio())
                   + 0.001 * rows[i]["line"]["mpg"])

    joined = []
    stats = Counter()
    for a in d["awards"]:
        c = a["category"].split(" · ")[0]
        stats[c + "|n"] += 1
        i = pick(a["season_year"], a["player"], a["team"])
        if i is None:
            continue
        stats[c + "|ok"] += 1
        joined.append((a, i))
    for y, (nm, tm) in NPOY.items():
        stats["National POY|n"] += 1
        i = pick(y, nm, tm)
        if i is not None:
            stats["National POY|ok"] += 1
            joined.append(({"season_year": y, "category": "National POY", "detail": "National", "player": nm, "team": tm}, i))
    rates = {}
    for k in sorted({k.split("|")[0] for k in stats}):
        rates[k] = {"rows": stats[k + "|n"], "joined": stats[k + "|ok"],
                    "rate": round(stats[k + "|ok"] / max(1, stats[k + "|n"]), 4)}
    return joined, rates


def conf_of_detail(joined, rows):
    """award `detail` (e.g. 'BIG-12', 'Am. East') -> team_seasons conference for that season, by the
    majority conference of every joined honoree (All-Conference included) — handles realignment."""
    vote = defaultdict(Counter)
    for a, i in joined:
        if a.get("detail") and a["detail"] != "National":
            vote[(a["season_year"], a["detail"])][rows[i]["conf"]] += 1
    return {k: c.most_common(1)[0][0] for k, c in vote.items()}


# ───────────────────────────── races + conditional logit ─────────────────────────────
BOX = {
    "npoy":  ["ppg", "rpg", "apg", "spg", "bpg", "ts", "usg", "played", "srs", "winpct"],
    "poy":   ["ppg", "rpg", "apg", "spg", "bpg", "ts", "usg", "played", "winpct", "crank", "ctop"],
    "dpoy":  ["bpg", "spg", "drpg", "dws", "mpg", "ppg", "played", "winpct", "crank"],
    "roy":   ["ppg", "rpg", "apg", "spg", "bpg", "ts", "mpg", "played", "winpct", "crank"],
    "sixth": ["ppg", "rpg", "apg", "ts", "mpg", "played", "winpct", "crank"],
}
# "owned" variant = the same box set + the site's statistical overall (stat_overall_history, 2010+)
VARIANTS = {"box": lambda a: BOX[a], "owned": lambda a: BOX[a] + ["ovr"]}
AWARD_NAME = {"npoy": "National Player of the Year", "poy": "Conference Player of the Year",
              "dpoy": "Conference Defensive Player of the Year", "roy": "Conference Freshman of the Year",
              "sixth": "Conference Sixth Man of the Year"}
BASELINE = {"npoy": "ppg", "poy": "ppg", "dpoy": "bpg", "roy": "ppg", "sixth": "ppg"}   # naive "who'd you guess"


def eligible(award, r):
    L = r["line"]
    if award == "npoy":
        return L["mpg"] >= 20 and L["played"] >= 0.5 and L["ppg"] >= 10
    if award == "poy":
        return L["mpg"] >= 15 and L["played"] >= 0.4
    if award == "dpoy":
        return L["mpg"] >= 12 and L["played"] >= 0.4
    if award == "roy":
        return r["cls"] == "FR" and L["mpg"] >= 8 and L["played"] >= 0.3
    if award == "sixth":
        return r.get("bench", r.get("gs_share", 1) <= 0.4) and L["mpg"] >= 10 and L["played"] >= 0.4
    return False


def build_races(award, rows, joined, cm):
    """-> list of races {season, key, idx:[row idx], win:[positions in idx]}; + coverage stats."""
    by_sc = defaultdict(list)
    for i, r in enumerate(rows):
        by_sc[(r["season"], r["conf"])].append(i)
    races, cov = [], Counter()
    if award == "npoy":
        by_s = defaultdict(list)
        for i, r in enumerate(rows):
            if eligible("npoy", r):
                by_s[r["season"]].append(i)
        for a, i in joined:
            if a["category"] != "National POY":
                continue
            cov["winners"] += 1
            pool = by_s[a["season_year"]]
            if i not in pool:
                continue
            cov["in_pool"] += 1
            races.append({"season": a["season_year"], "key": "National", "idx": pool, "win": [pool.index(i)]})
        return races, cov
    win = defaultdict(set)
    for a, i in joined:
        if a["category"] == CAT[award]:
            conf = cm.get((a["season_year"], a["detail"]))
            if conf:
                win[(a["season_year"], conf)].add(i)
    for (y, conf), ws in sorted(win.items()):
        pool = [i for i in by_sc[(y, conf)] if eligible(award, rows[i])]
        cov["winners"] += len(ws)
        inp = [pool.index(i) for i in ws if i in pool]
        cov["in_pool"] += len(inp)
        if inp and len(pool) >= 3:
            races.append({"season": y, "key": conf, "idx": pool, "win": inp})
    return races, cov


def matrix(races, rows, F):
    X, rid, w = [], [], []
    for k, race in enumerate(races):
        nw = len(race["win"])
        for j, i in enumerate(race["idx"]):
            f = rows[i]["f"]
            X.append([f[c] for c in F]); rid.append(k); w.append(1.0 / nw if j in race["win"] else 0.0)
    return np.array(X, float), np.array(rid), np.array(w)


def _seg(z, rid, nr):
    m = np.full(nr, -np.inf)
    np.maximum.at(m, rid, z)
    e = np.exp(z - m[rid])
    s = np.zeros(nr)
    np.add.at(s, rid, e)
    return e / s[rid], np.log(s) + m


def fit_logit(X, rid, w, l2):
    nr = rid.max() + 1

    def f(b):
        z = X @ b
        p, lse = _seg(z, rid, nr)
        loss = (lse.sum() - (w * z).sum()) / nr + 0.5 * l2 * b @ b
        grad = X.T @ (p - w) / nr + l2 * b
        return loss, grad
    return minimize(f, np.zeros(X.shape[1]), jac=True, method="L-BFGS-B").x


def evaluate(races, rows, F, l2, seasons_eval=None):
    """leave-one-season-out: fit on every other season, score the held-out season's races."""
    X, rid, w = matrix(races, rows, F)
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = (X - mu) / sd
    season = np.array([races[k]["season"] for k in rid])
    res = []
    for y in sorted(set(season)):
        if seasons_eval and y not in seasons_eval:
            continue
        tr, te = season != y, season == y
        rk_tr = np.unique(rid[tr], return_inverse=True)[1]
        b = fit_logit(Z[tr], rk_tr, w[tr], l2)
        z = Z[te] @ b
        r_te = rid[te]
        for k in np.unique(r_te):
            m = r_te == k
            zz, ww = z[m], w[te][m]
            p = np.exp(zz - zz.max()); p /= p.sum()
            order = np.argsort(-zz)
            ranks = [int(np.where(order == j)[0][0]) + 1 for j in np.where(ww > 0)[0]]
            base = X[te][m][:, F.index(BASELINE_F)] if BASELINE_F in F else None
            brank = None
            if base is not None:
                bo = np.argsort(-base)
                brank = min(int(np.where(bo == j)[0][0]) + 1 for j in np.where(ww > 0)[0])
            res.append({"season": int(y), "key": races[k]["key"], "rank": min(ranks), "n": int(m.sum()),
                        "p": float(p[ww > 0].sum()), "ll": float(-np.log(max(1e-12, p[ww > 0].sum()))),
                        "brank": brank})
    return res


BASELINE_F = "ppg"


def summarize(res):
    n = len(res)
    return {"races": n, "top1": sum(r["rank"] == 1 for r in res), "top3": sum(r["rank"] <= 3 for r in res),
            "top1_pct": round(sum(r["rank"] == 1 for r in res) / max(1, n), 3),
            "top3_pct": round(sum(r["rank"] <= 3 for r in res) / max(1, n), 3),
            "avg_field": round(sum(r["n"] for r in res) / max(1, n), 1),
            "winner_prob": round(sum(r["p"] for r in res) / max(1, n), 3),
            "logloss": round(sum(r["ll"] for r in res) / max(1, n), 3),
            "uniform_logloss": round(sum(math.log(r["n"]) for r in res) / max(1, n), 3),
            "baseline_top1_pct": round(sum(r["brank"] == 1 for r in res if r["brank"]) / max(1, n), 3)}


def train(award, rows, joined, cm):
    global BASELINE_F
    BASELINE_F = BASELINE[award]
    races, cov = build_races(award, rows, joined, cm)
    print(f"\n== {AWARD_NAME[award]}: {len(races)} races, winners in pool {cov['in_pool']}/{cov['winners']}")
    best = None
    owned_seasons = set(range(2010, 2027))
    for vname, fv in VARIANTS.items():
        F = fv(award)
        for l2 in (0.003, 0.03, 0.3):
            res = evaluate(races, rows, F, l2, owned_seasons)   # compare variants on the seasons where ovr is real
            s = summarize(res)
            print(f"   {vname:5s} l2={l2:<5}  #1 {s['top1']}/{s['races']} ({s['top1_pct']:.0%})  top3 {s['top3_pct']:.0%}"
                  f"  logloss {s['logloss']:.3f} (uniform {s['uniform_logloss']:.3f})")
            if best is None or s["logloss"] < best[0]:
                best = (s["logloss"], vname, l2, F)
    _, vname, l2, F = best
    res = evaluate(races, rows, F, l2)                             # final: every season held out in turn
    s = summarize(res)
    print(f"   -> {vname} l2={l2}: all seasons #1 {s['top1']}/{s['races']} ({s['top1_pct']:.0%}), top3 {s['top3_pct']:.0%},"
          f" naive '{BASELINE_F}' #1 {s['baseline_top1_pct']:.0%}")
    X, rid, w = matrix(races, rows, F)
    mu, sd = X.mean(0), X.std(0) + 1e-9
    b = fit_logit((X - mu) / sd, rid, w, l2)
    print("   beta", {f: round(float(v), 2) for f, v in zip(F, b)})
    model = {"feats": F, "mu": mu.tolist(), "sd": sd.tolist(), "beta": b.tolist(), "variant": vname, "l2": l2}
    val = dict(s, variant=vname, seasons=f"{min(r['season'] for r in res)}-{max(r['season'] for r in res)}",
               winners_in_pool=f"{cov['in_pool']}/{cov['winners']}")
    if award == "npoy":
        val["by_season"] = [{"season": r["season"], "rank": r["rank"], "p": round(r["p"], 3)} for r in res]
    return model, val


# ───────────────────────────── 2026-27 forecast lines ─────────────────────────────
def fr_base():
    """FR_BASE (grade tier x position -> per-32 freshman line), parsed from tdc-proj.js so the
    public freshman line here stays the one the site shows."""
    src = open(os.path.join(ROOT, "tdc-proj.js")).read()
    i = src.index("var FR_BASE = {") + len("var FR_BASE = ")
    j = src.index("};", i) + 1
    js = src[i:j].replace("'", '"')
    js = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', js)
    js = re.sub(r",(\s*[}\]])", r"\1", js)
    return json.loads(js)


FR_ROLE = {"star": (30, 1.16), "starter": (24, 1.0), "rotation": (15, 0.85), "bench": (9, 0.72)}
FR_USG = {"star": 24.5, "starter": 20.0, "rotation": 17.0, "bench": 15.0}


def fresh_line(p, prof, fit, FRB):
    """Python port of tdc-freshman.js line() for the PUBLIC view (no owner archetype/sliders):
    grade-tier base -> role minutes -> team fit (fresh_fit.json) -> minutes/usage overrides."""
    prof = prof or {}
    ovr = fnum(prof.get("ovr"), None) if prof.get("ovr") not in (None, "") else None
    grade = ovr if ovr is not None else (fnum(p.get("tdc_grade"), 0) or 70)
    pos = p.get("position") if p.get("position") in ("PG", "SG", "SF", "PF", "C") else "SG"
    tier = "92+" if grade >= 92 else "85-91" if grade >= 85 else "75-84" if grade >= 75 else "below75"
    b = dict(FRB[tier][pos])
    b["fg_pct"] = clip(b["fg_pct"], 30, 70); b["tp_pct"] = clip(b["tp_pct"], 0, 48); b["ft_pct"] = clip(b["ft_pct"], 45, 95)
    role = prof.get("role") or ("star" if grade >= 90 else "starter" if grade >= 82 else "rotation" if grade >= 74 else "bench")
    mpg, usg = FR_ROLE.get(role, FR_ROLE["starter"])
    sc = mpg / 32
    b["apg"] = min(b["apg"] * sc, 6.0) / sc; b["ppg"] = min(b["ppg"] * sc * usg, 22) / (sc * usg)
    b["rpg"] = min(b["rpg"] * sc, 11) / sc; b["stl"] = min(b["stl"] * sc, 2.3) / sc; b["blk"] = min(b["blk"] * sc, 3.0) / sc
    L = {"mpg": mpg, "ppg": b["ppg"] * sc * usg, "rpg": b["rpg"] * sc, "apg": b["apg"] * sc, "dreb": b["dreb"] * sc,
         "stl": b["stl"] * sc, "blk": b["blk"] * sc}

    def soft(k_soft, k_hard, cap, comp):
        s, h = k_soft * L["mpg"], min(cap, k_hard * L["mpg"])
        if L["ppg"] > s:
            L["ppg"] = min(h, s + (L["ppg"] - s) * comp)
    if fit and fit.get("mpg", 0) > 0:
        km = clip(fit["mpg"] / L["mpg"], 0.4, 1.8)
        kp = clip((fit.get("ppg") or 0) / max(0.1, min(b["ppg"] * sc * usg, 22)), 0.35, 2.6)
        for k in ("rpg", "apg", "dreb", "stl", "blk"):
            L[k] *= km
        L["ppg"] *= kp; L["mpg"] = fit["mpg"]
        soft(0.55, 0.95, 24, 0.45)
    m_ov = fnum(prof.get("mpg"), 0) if prof.get("mpg") not in (None, "") else 0
    if m_ov > 0 and abs(m_ov - L["mpg"]) > 0.05:
        k = m_ov / L["mpg"]
        for x in ("ppg", "rpg", "apg", "dreb", "stl", "blk"):
            L[x] *= k
        L["mpg"] = m_ov
        soft(0.55, 0.95, 24, 0.45)
    u_auto = FR_USG.get(role, 20.0)
    u_ov = fnum(prof.get("usg"), 0) if prof.get("usg") not in (None, "") else 0
    L["usg"] = u_ov if u_ov > 0 else u_auto
    if u_ov > 0 and abs(u_ov - u_auto) > 0.05:
        ku = clip(u_ov / max(6, u_auto), 0.25, 2.6)
        L["ppg"] *= ku; L["apg"] *= clip(1 + (ku - 1) * 0.3, 0.8, 1.25)
        soft(0.55, 1.05, 26, 0.5)
    fg, tp, ft = b["fg_pct"] / 100, b["tp_pct"] / 100, b["ft_pct"] / 100
    pps = 2 * fg + 0.42 * tp + 0.28 * ft
    fga = max(0.3, L["ppg"] / pps)
    L["ts"] = ts_of(L["ppg"], fga, 0.28 * fga)
    L["ovr"] = grade
    return L


def fit_dws_maps(d, rows):
    """projection carries owned DWA (season wins) — map it onto the bbref DWS-per-30-games scale the
    model was trained on; freshmen get DWS from their steals/blocks/boards/minutes."""
    dwa = {(r["espn_id"], r["season_year"]): r.get("dwa") for r in d["adv"] if r.get("dwa") is not None}
    pairs = [(dwa[(r["espn_id"], r["season"])], r["line"]["dws"]) for r in rows
             if r.get("espn_id") and (r["espn_id"], r["season"]) in dwa and r["line"]["mpg"] >= 10]
    a = np.array(pairs)
    b_dwa = np.polyfit(a[:, 0], a[:, 1], 1)
    K = ["spg", "bpg", "drpg", "mpg"]
    h = [r for r in rows if r["line"]["mpg"] >= 8]
    X = np.array([[1.0] + [r["line"][k] for k in K] for r in h])
    b_box, *_ = np.linalg.lstsq(X, np.array([r["line"]["dws"] for r in h]), rcond=None)
    print(f"   dwa->dws map: dws = {b_dwa[1]:.3f} + {b_dwa[0]:.3f} x dwa  (r={np.corrcoef(a[:, 0], a[:, 1])[0, 1]:.2f}, n={len(a)})")
    return (lambda x: float(np.polyval(b_dwa, x))), (lambda L: float(np.dot(b_box, [1.0] + [L[k] for k in K])))


def injury_status(blob, team, name):
    rec = blob.get(f"tdc_inj:{team}:{name}")
    if not rec:
        return 1.0
    if rec.get("play") is False or rec.get("timeline") in ("season", "multi"):
        return 0.0
    return {"1-3m": 0.75, "<1m": 0.92}.get(rec.get("timeline"), 0.85)


CONF_LABEL = {"ACC": "ACC", "B10": "Big Ten", "SEC": "SEC", "BIG-12": "Big 12", "A10": "Atlantic 10",
              "AAC": "American", "Big-East": "Big East", "PAC-12": "Pac-12"}


def forecast_rows(d, dwa_map, dws_box, winb):
    """every rostered 2026-27 player -> projected line + team context (+ season-to-date blend)."""
    proj = json.load(open(os.path.join(DATA, "stat_overall_projected.json")))["players"]
    ffit = json.load(open(os.path.join(DATA, "fresh_fit.json")))
    FRB = fr_base()
    blob = d.get("fresh_blob") or {}
    teams = {t["team"]: t for t in d["ratings"]["teams"]}
    # projected team context: rating = projected Power Rating (SRS scale); win % from the history fit
    by_conf = defaultdict(list)
    for t in teams.values():
        by_conf[t["conf"]].append(t)
    tctx = {}
    for conf, grp in by_conf.items():
        mean = sum(t["rating"] for t in grp) / len(grp)
        for t in grp:
            tctx[t["team"]] = {"srs": float(t["rating"]), "cmean": mean, "conf": conf, "cn": len(grp), "full": t["full"]}
    std = {int(r["espn_id"]): r for r in (d.get("std") or []) if r.get("espn_id") and (r.get("gp") or 0) > 0}
    team_now = {r["team"]: r for r in (d.get("team_seasons_now") or [])}
    out = []
    for p in d["players"]:
        if not p.get("name") or p["team"] not in tctx or p.get("is_injured"):
            continue
        if (p.get("hometown") or "").strip().lower() in ("injured", "out"):
            continue
        avail = injury_status(blob, p["team"], p["name"])
        if avail <= 0:
            continue
        yr = (p.get("yr") or p.get("class_year") or "").lower()
        cls = "FR" if re.match(r"^(r-)?fr", yr) else "SO" if "so" in yr else "JR" if "jr" in yr else "SR"
        pr = proj.get(str(p["espn_id"])) if p.get("espn_id") else None
        if pr:
            L = {"ppg": pr["ppg"], "rpg": pr["rpg"], "apg": pr["apg"], "spg": pr["stl"], "bpg": pr["blk"],
                 "drpg": pr.get("dreb") or pr["rpg"] * 0.72, "ts": ts_of(pr["ppg"], pr.get("fga") or 0, pr.get("fta") or 0),
                 "usg": pr.get("proj_usg") or pr.get("usg") or 18, "mpg": pr["mpg"], "ovr": float(pr["ovr"]),
                 "dws": dwa_map(pr.get("dwa") or 0.0)}
            src = "projection"
        else:
            prof = blob.get(f"tdc_fr:{p['team']}:{p['name']}")
            F = fresh_line(p, prof, (ffit.get(p["team"]) or {}).get(p["name"]), FRB)
            L = {"ppg": F["ppg"], "rpg": F["rpg"], "apg": F["apg"], "spg": F["stl"], "bpg": F["blk"], "drpg": F["dreb"],
                 "ts": F["ts"], "usg": F["usg"], "mpg": F["mpg"], "ovr": float(F["ovr"])}
            L["dws"] = dws_box(L)
            src = "newcomer"
        L["played"] = 0.97 * avail
        # in-season: blend what he has done with the projection, weighted by games played
        s = std.get(int(p["espn_id"])) if p.get("espn_id") else None
        gp = 0
        if s:
            gp = s["gp"]
            w = gp / (gp + 8.0)
            A = {"ppg": s.get("ppg"), "rpg": s.get("rpg"), "apg": s.get("apg"), "spg": s.get("stl"),
                 "bpg": s.get("blk"), "drpg": s.get("dreb"), "mpg": s.get("mpg")}
            for k, v in A.items():
                if v is not None:
                    L[k] = w * float(v) + (1 - w) * L[k]
            if s.get("fga"):
                L["ts"] = w * ts_of(s["ppg"] or 0, s["fga"] or 0, s.get("fta") or 0) + (1 - w) * L["ts"]
            tn = team_now.get(tctx[p["team"]]["full"])
            if tn and (tn["wins"] + tn["losses"]):
                L["played"] = min(1.0, gp / (tn["wins"] + tn["losses"])) * 0.5 + L["played"] * 0.5
        out.append({"name": p["name"], "team": p["team"], "full": tctx[p["team"]]["full"], "conf": tctx[p["team"]]["conf"],
                    "pos": p.get("position") or "", "yr": p.get("yr") or p.get("class_year") or "", "cls": cls,
                    "espn_id": p.get("espn_id"), "line": L, "src": src, "gp": gp})
    # sixth man: outside his team's projected top five in minutes
    by_team = defaultdict(list)
    for r in out:
        by_team[r["team"]].append(r)
    for grp in by_team.values():
        grp.sort(key=lambda r: -r["line"]["mpg"])
        for i, r in enumerate(grp):
            r["bench"] = i >= 5
    return out, tctx


def season_left(d, tctx):
    """share of the regular season still to play (1.0 preseason) from team_seasons SEASON records."""
    now = d.get("team_seasons_now") or []
    if not now:
        return 1.0
    played = [r["wins"] + r["losses"] for r in now]
    return clip(1 - float(np.median(played)) / 31.0, 0.0, 1.0)


# ───────────────────────────── simulation ─────────────────────────────
F_ELIG = {   # forecast eligibility (a notch looser than training so the simulated spread decides)
    "npoy": lambda r: r["line"]["mpg"] >= 18 and r["line"]["ppg"] >= 8,
    "poy": lambda r: r["line"]["mpg"] >= 12,
    "dpoy": lambda r: r["line"]["mpg"] >= 10,
    "roy": lambda r: r["cls"] == "FR" and r["line"]["mpg"] >= 3,
    "sixth": lambda r: r.get("bench") and r["line"]["mpg"] >= 8,
}


def simulate(models, frows, tctx, winb, left, Ts, n_sims=N_SIMS, seed=7):
    """Monte Carlo the season around each projected line; returns {T: {award: mean softmax prob}}.
    Several temperatures share one set of draws (the calibration below scores a grid of them)."""
    rnd = np.random.default_rng(seed)
    n = len(frows)
    teams = sorted(tctx)
    tix = {t: i for i, t in enumerate(teams)}
    team_of = np.array([tix[r["team"]] for r in frows])
    conf_of_team = np.array([tctx[t]["conf"] for t in teams])
    base_srs = np.array([tctx[t]["srs"] for t in teams])
    confs = sorted(set(conf_of_team))
    conf_idx = {c: np.where(conf_of_team == c)[0] for c in confs}
    K = ["ppg", "rpg", "apg", "spg", "bpg", "drpg", "ts", "usg", "mpg", "dws", "ovr", "played"]
    B0 = {k: np.array([r["line"][k] for r in frows], float) for k in K}
    fr = np.array([1.0 if r["cls"] == "FR" else 0.0 for r in frows])
    pconf = np.array([r["conf"] for r in frows])
    races = {}
    for a in models:
        el = np.array([bool(F_ELIG[a](r)) for r in frows])
        if a == "npoy":
            races[a] = {"National": np.where(el)[0]}
        else:
            races[a] = {c: np.where(el & (pconf == c))[0] for c in confs}
            races[a] = {c: ix for c, ix in races[a].items() if len(ix) >= 2}
    acc = {T: {a: np.zeros(n) for a in models} for T in Ts}
    # how much the season can still move: full spread preseason, shrinking as games are played
    sd_team, sd_prod, sd_ovr = 4.5 * left ** 0.5, 0.20 * left ** 0.5, 3.5 * left ** 0.5
    for _ in range(n_sims):
        srs = base_srs + rnd.normal(0, sd_team, len(teams))
        crank = np.zeros(len(teams)); cmean = np.zeros(len(teams))
        for c, ix in conf_idx.items():
            order = ix[np.argsort(-srs[ix])]
            crank[order] = np.arange(1, len(ix) + 1)
            cmean[ix] = srs[ix].mean()
        winpct = np.clip(winb[0] + winb[1] * srs + winb[2] * cmean, 0.05, 0.97)
        m = np.clip(rnd.normal(1.0, sd_prod, n), 0.4, 1.8)
        inj = rnd.random(n)
        played = np.where(inj < 0.03 * left, 0.1, np.where(inj < 0.11 * left, rnd.uniform(0.35, 0.85, n), 1.0)) * B0["played"]
        f = {"ppg": B0["ppg"] * m, "rpg": B0["rpg"] * m, "apg": B0["apg"] * m, "spg": B0["spg"] * m,
             "bpg": B0["bpg"] * m, "drpg": B0["drpg"] * m, "dws": B0["dws"] * m,
             "ts": np.clip(B0["ts"] + rnd.normal(0, 0.025 * left ** 0.5, n), 0.3, 0.8),
             "usg": np.clip(B0["usg"] * m ** 0.5, 5, 40), "mpg": B0["mpg"], "played": played,
             "ovr": B0["ovr"] + rnd.normal(0, sd_ovr, n), "fr": fr,
             "srs": srs[team_of], "winpct": winpct[team_of], "crank": -np.log(crank[team_of]),
             "ctop": (crank[team_of] == 1).astype(float)}
        for a, M in models.items():
            X = np.column_stack([f[c] for c in M["feats"]])
            z0 = ((X - np.array(M["mu"])) / np.array(M["sd"])) @ np.array(M["beta"])
            for T in Ts:
                z = z0 / T
                for c, ix in races[a].items():
                    e = np.exp(z[ix] - z[ix].max())
                    acc[T][a][ix] += e / e.sum()
    return {T: {a: v / n_sims for a, v in accT.items()} for T, accT in acc.items()}, races


def calibrate_preseason(models, rows, joined, cm, winb, Ts=(1.0, 1.5, 2.0, 2.5, 3.0, 4.0)):
    """What temperature makes a PRESEASON board honest? Backtest 2008-2026 with the crudest preseason
    projection there is — each returner's previous-season line, his new team's previous-season Power
    Rating — through the same simulation, and score the real winner's probability per temperature.
    Only races won by a returner count (a freshman / newcomer winner has no prior line to test)."""
    by_bid = {(r["bid"], r["season"]): r for r in rows}
    ctx_prev = {}
    for r in rows:
        ctx_prev[(r["season"], r["team"])] = r["tctx"]
    wins = defaultdict(set)
    for a, i in joined:
        if a["category"] == CAT["poy"]:
            conf = cm.get((a["season_year"], a["detail"]))
            if conf:
                wins[a["season_year"]].add(rows[i]["bid"])
        if a["category"] == "National POY":
            wins[("n", a["season_year"])].add(rows[i]["bid"])
    ll = {T: {"poy": [], "npoy": []} for T in Ts}
    rk = {"poy": [], "npoy": []}          # rank of the real winner on the preseason board (T-independent)
    skipped = Counter()
    for y in range(2008, 2027):
        fr_, tctx = [], {}
        for r in rows:
            if r["season"] != y:
                continue
            prev = by_bid.get((r["bid"], y - 1))
            tprev = ctx_prev.get((y - 1, r["team"]))
            if not prev or not tprev or prev["line"]["mpg"] < 8:
                continue
            L = dict(prev["line"]); L["played"] = 0.97
            fr_.append({"team": r["team"], "conf": r["conf"], "cls": r["cls"], "line": L, "bid": r["bid"]})
            tctx[r["team"]] = {"srs": tprev["srs"], "conf": r["conf"]}
        if not fr_:
            continue
        probs, races = simulate({"poy": models["poy"], "npoy": models["npoy"]}, fr_, tctx, winb, 1.0, Ts, n_sims=120, seed=y)
        pos = {x["bid"]: k for k, x in enumerate(fr_)}
        for T in Ts:
            for bid in wins[y]:
                k = pos.get(bid)
                if k is None:
                    skipped["poy"] += (T == Ts[0]); continue
                c = fr_[k]["conf"]
                if c in races["poy"] and k in set(races["poy"][c]):
                    ll[T]["poy"].append(math.log(max(1e-9, probs[T]["poy"][k])))
                    if T == Ts[0]:
                        ix = races["poy"][c]
                        rk["poy"].append(int((probs[T]["poy"][ix] > probs[T]["poy"][k]).sum()) + 1)
            for bid in wins[("n", y)]:
                k = pos.get(bid)
                if k is None or k not in set(races["npoy"]["National"]):
                    skipped["npoy"] += (T == Ts[0]); continue
                ll[T]["npoy"].append(math.log(max(1e-9, probs[T]["npoy"][k])))
                if T == Ts[0]:
                    ix = races["npoy"]["National"]
                    rk["npoy"].append(int((probs[T]["npoy"][ix] > probs[T]["npoy"][k]).sum()) + 1)
    print("\npreseason temperature backtest (previous-season line as the projection):")
    table = []
    for T in Ts:
        a, b = ll[T]["poy"], ll[T]["npoy"]
        table.append({"T": T, "poy_ll": round(-sum(a) / max(1, len(a)), 3), "npoy_ll": round(-sum(b) / max(1, len(b)), 3),
                      "poy_n": len(a), "npoy_n": len(b)})
        print(f"   T={T:<4}  conf POY winner log-loss {table[-1]['poy_ll']:.3f} (n={len(a)})   "
              f"national {table[-1]['npoy_ll']:.3f} (n={len(b)})")
    best = min(table, key=lambda t: t["poy_ll"] * t["poy_n"] + t["npoy_ll"] * t["npoy_n"])
    print(f"   best preseason T = {best['T']}  (winners with no prior line skipped: {dict(skipped)})")
    summ = {a: {"races": len(v), "top1": sum(x == 1 for x in v), "top3": sum(x <= 3 for x in v),
                "top5": sum(x <= 5 for x in v)} for a, v in rk.items()}
    print(f"   preseason board, real winner: conf POY #1 {summ['poy']['top1']}/{summ['poy']['races']}, top3 "
          f"{summ['poy']['top3']}; national #1 {summ['npoy']['top1']}/{summ['npoy']['races']}, top5 {summ['npoy']['top5']}")
    return best["T"], {"grid": table, "board": summ, "skipped_no_prior_line": dict(skipped)}


# ───────────────────────────── main ─────────────────────────────
def main():
    refresh = "--refresh" in sys.argv
    d = load(refresh)
    rows, ctx = history_rows(d)
    joined, rates = join_awards(d, rows)
    filled = resolve_conferences(ctx, joined, rows)
    cm = conf_of_detail(joined, rows)
    n_imp, n_all = impute_ovr(rows)
    print(f"history: {n_all} player-seasons 2007-2026 (stat overall imputed for {n_imp}); "
          f"team_seasons conferences filled: {filled}")
    print("award join rates:")
    for k, v in rates.items():
        print(f"   {k:<30s} {v['joined']}/{v['rows']}  ({v['rate']:.1%})")
    for r in rows:
        r["f"] = feats(r["line"], r["tctx"], r["cls"])
    models, val = {}, {}
    for a in ("npoy", "poy", "dpoy", "roy", "sixth"):
        models[a], val[a] = train(a, rows, joined, cm)
    winb = fit_winpct(ctx)
    dwa_map, dws_box = fit_dws_maps(d, rows)
    frows, tctx = forecast_rows(d, dwa_map, dws_box, winb)
    left = season_left(d, tctx)
    T_pre, t_table = calibrate_preseason(models, rows, joined, cm, winb)
    T = 1 + (T_pre - 1) * left          # full preseason flattening, fading to T=1 at season's end
    probs, races = simulate(models, frows, tctx, winb, left, [T])
    probs = probs[T]
    mode = "preseason" if left >= 0.999 else "in-season"
    print(f"\nforecast: {len(frows)} rostered players ({sum(r['src'] == 'newcomer' for r in frows)} newcomers), "
          f"{mode}, temperature {T:.2f}, {N_SIMS} sims")

    def card(i, p):
        r = frows[i]
        L = r["line"]
        return {"name": r["name"], "team": r["team"], "conf": r["conf"], "pos": r["pos"], "yr": r["yr"],
                "espn_id": r["espn_id"], "p": round(float(p), 4), "ovr": round(L["ovr"]),
                "ppg": round(L["ppg"], 1), "rpg": round(L["rpg"], 1), "apg": round(L["apg"], 1),
                "spg": round(L["spg"], 1), "bpg": round(L["bpg"], 1), "mpg": round(L["mpg"], 1),
                "src": r["src"]}

    def top(a, ix, k):
        order = ix[np.argsort(-probs[a][ix])][:k]
        return [card(i, probs[a][i]) for i in order]

    national = top("npoy", races["npoy"]["National"], TOP_NATIONAL)
    confs = {}
    for c in sorted({r["conf"] for r in frows}):
        entry = {"label": CONF_LABEL.get(c, c), "teams": len({r["team"] for r in frows if r["conf"] == c})}
        for a in ("poy", "dpoy", "roy", "sixth"):
            ix = races[a].get(c)
            entry[a] = top(a, ix, TOP_CONF) if ix is not None else []
        confs[c] = entry
    out = {"season": SEASON, "label": "2026-27", "mode": mode, "built": time.strftime("%Y-%m-%d"),
           "temperature": round(T, 2), "preseason_T": T_pre, "temperature_backtest": t_table, "sims": N_SIMS, "season_left": round(left, 3),
           "fields": {"national": int(len(races["npoy"]["National"])), "players": len(frows),
                      "teams": len({r["team"] for r in frows})},
           "validation": val, "join": rates,
           "npoy_winners": {str(y): v[0] for y, v in NPOY.items()},
           "national": national, "conferences": confs}
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"), allow_nan=False)
    print("\nNational POY — top 10 (" + mode + "):")
    for x in national[:10]:
        print(f"   {x['p']:6.1%}  {x['name']:<24s} {x['team']:<16s} {x['ppg']:>4}/{x['rpg']}/{x['apg']}  ovr {x['ovr']}")
    for c, e in confs.items():
        print(f"{e['label']}: POY " + ", ".join(f"{x['name']} {x['p']:.0%}" for x in e["poy"][:3])
              + " | DPOY " + ", ".join(f"{x['name']} {x['p']:.0%}" for x in e["dpoy"][:2])
              + " | FOY " + ", ".join(f"{x['name']} {x['p']:.0%}" for x in e["roy"][:2]))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
