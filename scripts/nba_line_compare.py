#!/usr/bin/env python3
"""
nba_line_compare.py — TDC Bet proof of concept: one NBA game, the sportsbook's whole board vs our numbers.

Free data only:
  lines   ESPN's odds feed (DraftKings): spread / total / moneyline, halves, quarters, team totals, and every
          player prop + milestone ladder (sports.core.api.espn.com .../competitions/{id}/odds/100/propBets)
  players ESPN rosters + injury status, this season's game logs (site.web.api.espn.com gamelog), and last
          season's per-minute rates from our own scrape (scripts/data/nba_box.jsonl)
  model   scripts/data/prop_model_nba.json (fit 2024-25, tested 2025-26 — calibrated within ~2 pts)

Our numbers:
  player  rate = this season's per-minute production, shrunk toward last season's (k_prior minutes); minutes =
          this season's, shrunk toward last season's, then scaled so each team's healthy rotation plays 240
  team    points = the sum of its players' projected points, nudged half-way toward the opponent's defense
          (last season's points allowed vs league) + 1.2 each way for home court
  P(over) negative binomial (REB/AST/3PM) or normal sd = k*sqrt(mean) (PTS and point combos), as fitted

  python3 scripts/nba_line_compare.py                 # every game today
  python3 scripts/nba_line_compare.py 401909858       # one game
Writes scripts/data/nba_compare/<game id>.json and scripts/data/nba_compare/index.json.
"""
import json, os, sys, math, re, urllib.request, datetime
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(DATA, "nba_compare")
CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba"
SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
SEASON = 2027
LAST = 2026
HCA = 1.2                  # points each way
SD_MARGIN, SD_TOTAL, SD_TEAM = 12.0, 17.5, 10.5
PM_K = 300
# Our weight when blending with the market's no-vig price. Graded results (593 picks, Oct 24–27 2026) put the best weight
# on our prop numbers at 0 and on our game numbers at ~0.15: where we disagreed with the market, the market was right.
W_PROP = 0.10
W_GAME = 0.15
# What a logged pick must clear (same graded nights: the losses were long shots + one-sided ladders; the only thing that
# held up was buying below the market's own fair price). One pick per player.
PICK_RULES = {"min_cost": 0.35, "max_cost": 0.70, "min_market_edge": 0.015, "min_sources": 2}
RAW = []                # every team's unscaled projected points this run (for the league calibration)             # minutes of "average" (0) plus-minus every player starts with


_CACHE = {}


def getj(url):
    if url in _CACHE:
        return _CACHE[url]
    _CACHE[url] = _getj(url)
    return _CACHE[url]


def _getj(url):
    for _ in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "tdc"}), timeout=40))
        except Exception:
            pass
    return None


def Phi(z):
    return 0.5 * (1 + math.erf(z / 2 ** 0.5))


def implied(o):
    return 100 / (o + 100) if o > 0 else -o / (-o + 100)


def am(s):
    try:
        return int(round(float(str(s).replace("+", ""))))
    except Exception:
        return None


def dec(o):
    return 1 + o / 100 if o > 0 else 1 + 100 / -o


def fair(p):
    if p <= 0.001 or p >= 0.999:
        return None
    o = -100 * p / (1 - p) if p >= 0.5 else 100 * (1 - p) / p
    return int(round(o))


# ── the prop model ─────────────────────────────────────────────────────────
MODEL = json.load(open(os.path.join(DATA, "prop_model_nba.json")))["stats"]
STAT_KEYS = {"pts": ["pts"], "reb": ["reb"], "ast": ["ast"], "tpm": ["tpm"], "pra": ["pts", "reb", "ast"],
             "pr": ["pts", "reb"], "pa": ["pts", "ast"], "ra": ["reb", "ast"]}
PROP_TYPES = {"Total Points": "pts", "Total Rebounds": "reb", "Total Assists": "ast", "Total 3-Point Field Goals": "tpm",
              "Total Points, Rebounds, and Assists": "pra", "Total Points and Rebounds": "pr", "Total Points and Assists": "pa",
              "Total Assists and Rebounds": "ra"}
MILE_TYPES = {"Points Milestones": "pts", "Rebounds Milestones": "reb", "Assists Milestones": "ast", "3-Point Field Goals Milestones": "tpm",
              "Points + Assists + Rebounds Milestones": "pra", "Points + Rebounds Milestones": "pr", "Points + Assists Milestones": "pa",
              "Rebounds + Assists Milestones": "ra"}
LABEL = {"pts": "Points", "reb": "Rebounds", "ast": "Assists", "tpm": "Threes", "pra": "Pts+Reb+Ast", "pr": "Pts+Reb", "pa": "Pts+Ast", "ra": "Reb+Ast"}


def nb_cdf(mu, var, k):
    mu = max(mu, 0.05)
    if var <= mu * 1.0001:
        p = math.exp(-mu); c = p
        for i in range(1, k + 1):
            p *= mu / i; c += p
        return c
    r = mu * mu / (var - mu); q = r / (r + mu); p = math.exp(r * math.log(q)); c = p
    for i in range(1, k + 1):
        p *= (i - 1 + r) / i * (1 - q); c += p
    return c


def p_over(stat, mu, rate, sdm, line):
    """P(stat > line). Point-based stats: normal (fitted k); the rest: negative binomial (fitted alpha)."""
    if stat in ("pts", "pra", "pr", "pa"):
        k = MODEL["pra" if stat != "pts" else "pts"]["k"]
        sd = k * math.sqrt(max(mu, 0.1))
        return min(0.999, max(0.001, 1 - Phi((line - mu) / sd)))
    if stat == "ra":                       # reb + ast: NB with the average of their dispersions
        a = (MODEL["reb"]["alpha"] + MODEL["ast"]["alpha"]) / 2
    else:
        a = MODEL[stat]["alpha"]
    var = mu + a * mu * mu + (rate * (sdm or 5)) ** 2 * 0.5
    return min(0.999, max(0.001, 1 - nb_cdf(mu, var, int(math.floor(line)))))


# ── last season, from our own scrape ───────────────────────────────────────
PRIOR = os.path.join(DATA, "nba_prior_%d.json" % LAST)


def last_season():
    """Last season's per-player totals + every team's points allowed. Read from the small committed summary
    (scripts/data/nba_prior_<yr>.json) when nba_box.jsonl (our 229 MB local scrape) isn't there, e.g. in CI."""
    if not os.path.exists(os.path.join(DATA, "nba_box.jsonl")) and os.path.exists(PRIOR):
        d = json.load(open(PRIOR))
        tot = {k: dict(v, mins=[v["min"] / max(1, v["g"])] * 2) for k, v in d["players"].items()}
        for k, v in tot.items():
            v["sdm_fixed"] = d["players"][k].get("sdm")
        return tot, d["opp_allowed"], d["lg"]
    tot = defaultdict(lambda: {"g": 0, "min": 0, "pts": 0, "reb": 0, "ast": 0, "tpm": 0, "pm": 0, "mins": []})
    allowed = defaultdict(lambda: [0, 0])
    with open(os.path.join(DATA, "nba_box.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            if r.get("season") != LAST or r.get("season_type") != "regular" or r.get("dnp") or not r.get("min"):
                continue
            t = tot[r["espn_id"]]
            t["g"] += 1; t["min"] += r["min"]; t["mins"].append(r["min"]); t["pm"] += r.get("pm") or 0
            for s, k in (("pts", "pts"), ("reb", "reb"), ("ast", "ast"), ("tpm", "fg3m")):
                t[s] += r.get(k) or 0
    with open(os.path.join(DATA, "nba_games.jsonl")) as f:
        for line in f:
            g = json.loads(line)
            if g.get("season") != LAST or g.get("season_type") != "regular" or not g.get("home_score") or not g.get("away_score") or min(g["home_score"], g["away_score"]) < 60:
                continue
            allowed[g["home"]][0] += g["away_score"]; allowed[g["home"]][1] += 1
            allowed[g["away"]][0] += g["home_score"]; allowed[g["away"]][1] += 1
    opp = {k: v[0] / v[1] for k, v in allowed.items() if v[1]}
    lg = sum(opp.values()) / len(opp) if opp else 114
    # keep the committed summary current for the scheduled job
    summ = {}
    for k, v in tot.items():
        ms = v["mins"]; mu = sum(ms) / len(ms)
        summ[k] = {"g": v["g"], "min": v["min"], "pts": v["pts"], "reb": v["reb"], "ast": v["ast"], "tpm": v["tpm"], "pm": v["pm"],
                   "sdm": round((sum((m - mu) ** 2 for m in ms) / max(1, len(ms) - 1)) ** 0.5, 1)}
    json.dump({"season": LAST, "players": summ, "opp_allowed": opp, "lg": lg}, open(PRIOR, "w"), separators=(",", ":"))
    return tot, opp, lg


def gamelog(aid):
    """This season's regular-season games: [(min, pts, reb, ast, tpm)]."""
    d = getj("https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/%s/gamelog" % aid)
    if not d:
        return []
    labels = d.get("labels") or []
    ix = {l: i for i, l in enumerate(labels)}
    out = []
    for st in d.get("seasonTypes", []):
        if "Regular" not in (st.get("displayName") or "") or str(SEASON - 1) not in (st.get("displayName") or ""):
            continue
        for c in st.get("categories", []):
            for e in c.get("events", []):
                s = e.get("stats") or []
                try:
                    mn = float(s[ix["MIN"]]);
                    if mn <= 0:
                        continue
                    tpm = int(str(s[ix["3PT"]]).split("-")[0])
                    out.append((mn, float(s[ix["PTS"]]), float(s[ix["REB"]]), float(s[ix["AST"]]), tpm))
                except Exception:
                    pass
    return out


def roster(team_id):
    d = getj("%s/teams/%s/roster" % (SITE, team_id)) or {}
    out = []
    for a in d.get("athletes", []):
        inj = (a.get("injuries") or [{}])
        status = (inj[0].get("status") if inj else None) or None
        out.append({"id": str(a["id"]), "name": a.get("displayName"), "pos": (a.get("position") or {}).get("abbreviation"), "status": status})
    return out


def all_props(gid):
    items, page = [], 1
    while True:
        d = getj("%s/events/%s/competitions/%s/odds/100/propBets?limit=1000&page=%d" % (CORE, gid, gid, page))
        if not d:
            break
        items += d.get("items", [])
        if page >= d.get("pageCount", 1):
            break
        page += 1
    return items


def ref_id(x, key):
    m = re.search(r"/%s/(\d+)" % key, (x or {}).get("$ref", ""))
    return m.group(1) if m else None


def build(gid, ev, last, opp_allowed, lg_allowed, scale=1.0):
    comp = ev["competitions"][0]
    side = {c["homeAway"]: c for c in comp["competitors"]}
    H, A = side["home"]["team"], side["away"]["team"]
    odds = getj("%s/events/%s/competitions/%s/odds" % (CORE, gid, gid)) or {}
    dk = next((i for i in odds.get("items", []) if str(i.get("provider", {}).get("id")) == "100"), None)
    props = all_props(gid)
    teams = {H["id"]: {"abbr": H["abbreviation"], "name": H["displayName"], "home": True}, A["id"]: {"abbr": A["abbreviation"], "name": A["displayName"], "home": False}}

    # players: both rosters, this season's logs (in parallel), last season's rates
    players = {}
    for tid, t in teams.items():
        for p in roster(tid):
            p["team"] = t["abbr"]; p["home"] = t["home"]; players[p["id"]] = p
    with ThreadPoolExecutor(8) as ex:
        logs = dict(zip(players, ex.map(gamelog, list(players))))
    projections = {}
    for pid, p in players.items():
        gl, ls = logs.get(pid) or [], last.get(pid)
        g = len(gl); mn = sum(x[0] for x in gl)
        if not g and not ls:
            continue
        cur = {"pts": sum(x[1] for x in gl), "reb": sum(x[2] for x in gl), "ast": sum(x[3] for x in gl), "tpm": sum(x[4] for x in gl)}
        rates = {}
        for s in ("pts", "reb", "ast", "tpm"):
            k = MODEL[s]["k_prior"]
            prior = ls[s] / ls["min"] if ls and ls["min"] else None
            rates[s] = (cur[s] + prior * k) / (mn + k) if prior is not None else (cur[s] / mn if mn else 0)
        mpg_last = ls["min"] / ls["g"] if ls else None
        # minutes: this season's role leads (2 games of last season's minutes as the prior); a player who hasn't
        # played yet, or is listed day-to-day, counts at a discount until he shows up in a box score
        mpg = (mn + mpg_last * 2) / (g + 2) if mpg_last is not None else (mn / g if g else 0)
        st = (p.get("status") or "").lower()
        if g == 0:
            mpg *= 0.5
        elif "day" in st or "question" in st:
            mpg *= 0.8
        mins = [x[0] for x in gl] or (ls["mins"] if ls else [])
        sdm = (sum((m - sum(mins) / len(mins)) ** 2 for m in mins) / max(1, len(mins) - 1)) ** 0.5 if len(mins) > 1 else 5
        if not gl and ls and ls.get("sdm_fixed") is not None:
            sdm = ls["sdm_fixed"]
        out = (p.get("status") or "").lower() == "out"
        # plus-minus per minute (last season + this one), shrunk hard toward 0: it carries defense, which points don't
        pm_tot = (ls["pm"] if ls else 0) + sum(x[5] for x in gl if len(x) > 5)
        pm_min = (ls["min"] if ls else 0) + mn
        pm_rate = pm_tot / (pm_min + PM_K)
        projections[pid] = {"pm_rate": pm_rate, "rates": rates, "mpg": mpg, "sdm": round(sdm, 1), "g": g, "last_g": ls["g"] if ls else 0, "out": out,
                            "last_line": {s: round(ls[s] / ls["g"], 1) for s in ("pts", "reb", "ast", "tpm")} if ls else None,
                            "cur_line": {s: round(cur[s] / g, 1) for s in cur} if g else None, "cur_mpg": round(mn / g, 1) if g else None}
    # 240 minutes per team: healthy rotation (8.5+ projected minutes), scaled
    for tid, t in teams.items():
        rot = [pid for pid, pr in projections.items() if players[pid]["team"] == t["abbr"] and not pr["out"] and pr["mpg"] >= 8.5]
        tot = sum(projections[pid]["mpg"] for pid in rot)
        f = max(0.88, min(1.12, 240 / tot)) if tot else 1      # nudge toward 240, never rewrite anyone's role
        for pid, pr in projections.items():
            if players[pid]["team"] != t["abbr"]:
                continue
            pr["min"] = 0 if (pr["out"] or pid not in rot) else min(42, pr["mpg"] * f)
            pr["mean"] = {s: pr["rates"][s] * pr["min"] for s in ("pts", "reb", "ast", "tpm")}

    # team points from the players, toward the opponent's defense, + home court
    pts = {}
    for tid, t in teams.items():
        mine = [pr for pid, pr in projections.items() if players[pid]["team"] == t["abbr"]]
        tm = sum(pr["min"] for pr in mine) or 240
        raw = sum(pr["mean"]["pts"] for pr in mine) * 240 / tm        # a team plays 240 minutes, however its rotation splits them
        other = [o for o in teams.values() if o is not t][0]
        d = opp_allowed.get(other["abbr"], lg_allowed)
        pts[t["abbr"]] = raw * scale * (1 + 0.5 * (d / lg_allowed - 1)) + (HCA if t["home"] else -HCA)
    RAW.extend(pts.values())
    ha, aa = H["abbreviation"], A["abbreviation"]
    # margin: each team's projected minutes x its players' plus-minus rates (5 on the floor), + home court both ways
    pmr = {t["abbr"]: sum(pr["min"] * pr["pm_rate"] for pid, pr in projections.items() if players[pid]["team"] == t["abbr"]) / 5 for t in teams.values()}
    margin = pmr[ha] - pmr[aa] + 2 * HCA
    # total: both teams' projected points (players' scoring rates x minutes, toward each defense)
    total = pts[ha] + pts[aa]
    pts[ha], pts[aa] = total / 2 + margin / 2, total / 2 - margin / 2

    def pair(entries):
        """two prices for one line → (over/home price, under/away price)"""
        return [am(e["odds"]["american"]["value"]) for e in entries]

    game = {"id": gid, "tip": ev["date"], "home": {"abbr": ha, "name": H["displayName"]}, "away": {"abbr": aa, "name": A["displayName"]},
            "ours": {"home_pts": round(pts[ha], 1), "away_pts": round(pts[aa], 1), "margin": round(margin, 1), "total": round(total, 1),
                     "p_home": round(Phi(margin / SD_MARGIN), 3)},
            "book": "DraftKings", "markets": [], "props": [], "ladders": []}

    # main game lines
    if dk:
        ho, ao = dk.get("homeTeamOdds") or {}, dk.get("awayTeamOdds") or {}
        sp = dk.get("spread")       # home's line (negative = home favoured)
        def add(kind, label, line, price, p, open_line=None, open_price=None, mkt=None):
            if price is None:
                return
            game["markets"].append({"kind": kind, "label": label, "line": line, "price": price, "open_line": open_line, "open_price": open_price,
                                    "p": round(p, 4), "p_mkt": None if mkt is None else round(mkt, 4), "ev": round(p * dec(price) - 1, 4), "fair": fair(p)})
        if sp is not None:
            hp, ap = am(ho.get("spreadOdds")), am(ao.get("spreadOdds"))
            nv = implied(hp) / (implied(hp) + implied(ap)) if hp and ap else None
            osp = (ho.get("open") or {}).get("pointSpread", {}).get("american")
            add("spread", "%s %+.1f" % (ha, sp), sp, hp, Phi((margin + sp) / SD_MARGIN), float(osp) if osp else None, None, nv)
            add("spread", "%s %+.1f" % (aa, -sp), -sp, ap, 1 - Phi((margin + sp) / SD_MARGIN), None, None, None if nv is None else 1 - nv)
        if dk.get("overUnder") is not None:
            ou = dk["overUnder"]; op, up = am(dk.get("overOdds")), am(dk.get("underOdds"))
            nv = implied(op) / (implied(op) + implied(up)) if op and up else None
            add("total", "Over %.1f" % ou, ou, op, 1 - Phi((ou - total) / SD_TOTAL), None, None, nv)
            add("total", "Under %.1f" % ou, ou, up, Phi((ou - total) / SD_TOTAL), None, None, None if nv is None else 1 - nv)
        hm, amn = am(ho.get("moneyLine")), am(ao.get("moneyLine"))
        if hm and amn:
            nv = implied(hm) / (implied(hm) + implied(amn))
            add("ml", "%s ML" % ha, None, hm, Phi(margin / SD_MARGIN), None, None, nv)
            add("ml", "%s ML" % aa, None, amn, 1 - Phi(margin / SD_MARGIN), None, None, 1 - nv)
    # team totals (full game) from the prop feed
    by_type = defaultdict(list)
    for it in props:
        by_type[it["type"]["name"]].append(it)
    abbr_of = {tid: t["abbr"] for tid, t in teams.items()}
    for it in by_type.get("Team Total Points", []):
        pass
    tt = defaultdict(list)
    for it in by_type.get("Team Total Points", []):
        tt[(ref_id(it.get("team"), "teams"), it["odds"].get("total", {}).get("value"))].append(it)
    for (tid, line), es in tt.items():
        if len(es) != 2 or tid not in abbr_of:
            continue
        ab = abbr_of[tid]; L = float(line); o, u = pair(es)
        p = 1 - Phi((L - pts[ab]) / SD_TEAM); nv = implied(o) / (implied(o) + implied(u))
        for lab, price, pp, mk in (("%s team total over %.1f" % (ab, L), o, p, nv), ("%s team total under %.1f" % (ab, L), u, 1 - p, 1 - nv)):
            game["markets"].append({"kind": "tt", "label": lab, "line": L, "price": price, "p": round(pp, 4), "p_mkt": round(mk, 4), "ev": round(pp * dec(price) - 1, 4), "fair": fair(pp)})

    # player props: main lines (over/under pairs) + milestone ladders (one-sided "X+")
    miles = defaultdict(dict)        # (pid, stat) -> {k: price}
    for tname, stat in MILE_TYPES.items():
        for it in by_type.get(tname, []):
            pid = ref_id(it.get("athlete"), "athletes"); t = it.get("current", {}).get("target", {}).get("value")
            pr = am(it["odds"]["american"]["value"])
            if pid and t is not None and pr is not None:
                miles[(pid, stat)].setdefault(int(t), []).append(pr)
    # DraftKings files a second, smaller ladder (a quarter's) under the same market id: keep the full-game one by
    # requiring the chance to fall as the number rises (walking down from the top rung), taking the likelier price
    # when a number appears twice
    for key, ks in list(miles.items()):
        clean, floor = {}, 0.0
        for k in sorted(ks, reverse=True):
            pr = max(ks[k], key=implied)
            if implied(pr) + 1e-9 >= floor:
                clean[k] = pr; floor = implied(pr)
        miles[key] = clean
    for tname, stat in PROP_TYPES.items():
        grp = defaultdict(list)
        for it in by_type.get(tname, []):
            pid = ref_id(it.get("athlete"), "athletes")
            grp[(pid, it.get("current", {}).get("target", {}).get("value"))].append(it)
        for (pid, line), es in grp.items():
            if pid not in projections or line is None or len(es) != 2:
                continue
            pr, pl = projections[pid], players[pid]
            a, b = pair(es)
            # which price is the over: the one matching the milestone at ceil(line), else the first listed
            mk = miles.get((pid, stat), {}).get(int(math.floor(line)) + 1)
            over, under = (a, b) if mk is None or abs(mk - a) <= abs(mk - b) else (b, a)
            mean = sum(pr["mean"][s] for s in STAT_KEYS[stat]); rate = sum(pr["rates"][s] for s in STAT_KEYS[stat])
            if pr["min"] <= 0:
                continue
            po = p_over(stat, mean, rate, pr["sdm"], line)
            nv = implied(over) / (implied(over) + implied(under))
            # trust: a projection needs a real sample (3+ games this season or 30+ last season), and a gap this big
            # is far more often a role change / minutes limit we can't see than a mispriced line
            why = []
            if pr["g"] < 3 and pr["last_g"] < 30:
                why.append("small sample (%d games this season, %d last)" % (pr["g"], pr["last_g"]))
            if line > 0 and abs(mean - line) / max(line, 2) > 0.3:
                why.append("our number is %d%% off the book: likely a role or minutes change we don't see" % round(abs(mean - line) / max(line, 2) * 100))
            pb = W_PROP * po + (1 - W_PROP) * nv
            game["props"].append({"pid": pid, "name": pl["name"], "team": pl["team"], "stat": stat, "label": LABEL[stat], "line": line,
                                  "over": over, "under": under, "open_line": es[0].get("open", {}).get("target", {}).get("value"),
                                  "mean": round(mean, 1), "p_over": round(po, 4), "p_mkt": round(nv, 4), "ev_over": round(po * dec(over) - 1, 4),
                                  "ev_under": round((1 - po) * dec(under) - 1, 4), "fair_over": fair(po), "min": round(pr["min"], 1), "g": pr["g"],
                                  "p_blend": round(pb, 4), "evb_over": round(pb * dec(over) - 1, 4), "evb_under": round((1 - pb) * dec(under) - 1, 4),
                                  "trust": "low" if why else "ok", "why": why, "last_g": pr["last_g"]})
    for (pid, stat), ks in miles.items():
        if pid not in projections or projections[pid]["min"] <= 0:
            continue
        pr, pl = projections[pid], players[pid]
        mean = sum(pr["mean"][s] for s in STAT_KEYS[stat]); rate = sum(pr["rates"][s] for s in STAT_KEYS[stat])
        rungs = []
        for k in sorted(ks):
            p = p_over(stat, mean, rate, pr["sdm"], k - 0.5)
            rungs.append({"k": k, "price": ks[k], "p": round(p, 4), "p_book": round(implied(ks[k]), 4), "ev": round(p * dec(ks[k]) - 1, 4), "fair": fair(p)})
        game["ladders"].append({"pid": pid, "name": pl["name"], "team": pl["team"], "stat": stat, "label": LABEL[stat], "mean": round(mean, 1), "rungs": rungs})

    game["players"] = [{"id": pid, "name": players[pid]["name"], "team": players[pid]["team"], "pos": players[pid]["pos"], "status": players[pid]["status"],
                        "min": round(pr["min"], 1), "g": pr["g"], "last_g": pr["last_g"], "sdm": pr["sdm"],
                        "rates": {s: round(v, 5) for s, v in pr["rates"].items()}, "mean": {s: round(v, 2) for s, v in pr["mean"].items()},
                        "cur": pr["cur_line"], "cur_mpg": pr["cur_mpg"], "last": pr["last_line"]}
                       for pid, pr in sorted(projections.items(), key=lambda kv: -kv[1]["min"])]
    try:
        rows, Hk, Ak = multi_sources(game, ev, game["players"])
        game["multi"] = price_multi(game, rows, Hk, Ak, projections)
        low = {p["pid"] for p in game["props"] if p["trust"] == "low"}
        for r in game["multi"]:
            if r.get("pid") in low or (r.get("pid") in projections and projections[r["pid"]]["g"] < 3 and projections[r["pid"]]["last_g"] < 30):
                r["trust"] = "low"
            if r.get("best") and (r["best"]["cost"] < 0.15 or r["best"]["cost"] > 0.85):
                r["longshot"] = True
        game["sources"] = {s: sum(1 for r in game["multi"] if s in r["src"]) for s in ("dk", "kalshi", "poly")}
    except Exception as e:
        print("  multi-source failed:", e)
        game["multi"], game["sources"] = [], {}
    game["consts"] = {"sd_margin": SD_MARGIN, "sd_total": SD_TOTAL, "sd_team": SD_TEAM, "w": W_PROP, "w_game": W_GAME, "rules": PICK_RULES}   # bet/nba-live.js re-prices with these
    game["n_lines"] = len(props) + len(game["markets"])
    game["built"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return game


# ── prediction markets: Kalshi + Polymarket, priced like a sportsbook ───────────────────────────────
# Both publish free read-only market data. An exchange price is what a $1 contract costs: Kalshi charges a taker fee
# (~0.07 x P x (1-P) per contract), Polymarket's sports markets none. "cost" below = dollars to win $1, fees in.
KALSHI = "https://api.elections.kalshi.com/trade-api/v2"
POLY = "https://gamma-api.polymarket.com"
TICK = {"SA": "SAS", "GS": "GSW", "NO": "NOP", "NY": "NYK", "UTAH": "UTA", "WSH": "WAS"}
K_SERIES = {"KXNBAGAME": "ml", "KXNBASPREAD": "sp", "KXNBATOTAL": "tot", "KXNBATEAMTOTAL": "tt", "KXNBAPTS": "pts", "KXNBAREB": "reb",
            "KXNBAAST": "ast", "KXNBA3PT": "tpm", "KXNBAPRA": "pra"}
POLY_STAT = {"Points": "pts", "Rebounds": "reb", "Assists": "ast", "3-Pointers Made": "tpm", "Pts + Reb + Ast": "pra", "Points + Rebounds + Assists": "pra"}


def nkey(nm):
    return re.sub(r"[^a-z ]", "", (nm or "").lower().replace(" jr.", "").replace(" iii", "").replace(" ii", "")).strip()


def kfee(c):
    return 0.07 * c * (1 - c)


def fnum(x):
    try:
        return float(x)
    except Exception:
        return None


def multi_sources(g, ev, players):
    """Every outcome any source prices: {key: {label, kind, src:{dk|kalshi|poly: {cost, mid, vol, thin}}}}."""
    ha, aa = g["home"]["abbr"], g["away"]["abbr"]
    H, A = TICK.get(ha, ha), TICK.get(aa, aa)
    tipet = datetime.datetime.fromisoformat(g["tip"].replace("Z", "+00:00")) - datetime.timedelta(hours=4)
    dcode = tipet.strftime("%y%b%d").upper()
    nick = {H: g["home"]["name"].split(" ")[-1], A: g["away"]["name"].split(" ")[-1]}
    if g["home"]["name"].endswith("Trail Blazers"): nick[H] = "Trail Blazers"
    if g["away"]["name"].endswith("Trail Blazers"): nick[A] = "Trail Blazers"
    by_nick = {v: k for k, v in nick.items()}
    out = {}

    def add(key, label, kind, src, cost, mid, vol=None, thin=False, extra=None):
        if cost is None or not (0.005 < cost < 0.995):
            return
        r = out.setdefault(key, {"key": "|".join(str(x) for x in key), "label": label, "kind": kind, "src": {}})
        if extra:
            r.update(extra)
        old = r["src"].get(src)
        if not old or cost < old["cost"]:
            r["src"][src] = {"cost": round(cost, 4), "mid": None if mid is None else round(mid, 4), "vol": vol, "thin": thin}

    def team_lbl(t):
        return t
    # DraftKings (from the board already parsed)
    for m in g["markets"]:
        c = 1 / dec(m["price"])
        if m["kind"] == "ml":
            t = TICK.get(m["label"].split(" ")[0], m["label"].split(" ")[0]); add(("ml", t), t + " ML", "ml", "dk", c, m["p_mkt"])
        elif m["kind"] == "spread":
            t = TICK.get(m["label"].split(" ")[0], m["label"].split(" ")[0]); add(("sp", t, m["line"]), "%s %+.1f" % (t, m["line"]), "sp", "dk", c, m["p_mkt"])
        elif m["kind"] == "total":
            sd = "over" if m["label"].startswith("Over") else "under"; add(("tot", sd, m["line"]), "%s %.1f" % (sd.title(), m["line"]), "tot", "dk", c, m["p_mkt"])
        elif m["kind"] == "tt":
            t = TICK.get(m["label"].split(" ")[0], m["label"].split(" ")[0]); sd = "over" if " over " in m["label"] else "under"
            add(("tt", t, sd, m["line"]), "%s team total %s %.1f" % (t, sd, m["line"]), "tt", "dk", c, m["p_mkt"])
    for p in g["props"]:
        nk = nkey(p["name"])
        add(("prop", nk, p["stat"], "over", p["line"]), "%s %s over %s" % (p["name"], p["label"], p["line"]), "prop", "dk", 1 / dec(p["over"]), p["p_mkt"], extra={"pid": p["pid"], "stat": p["stat"], "name": p["name"]})
        add(("prop", nk, p["stat"], "under", p["line"]), "%s %s under %s" % (p["name"], p["label"], p["line"]), "prop", "dk", 1 / dec(p["under"]), 1 - p["p_mkt"], extra={"pid": p["pid"], "stat": p["stat"], "name": p["name"]})
    for l in g["ladders"]:
        nk = nkey(l["name"])
        for r in l["rungs"]:
            # one-sided ladder rung: the vig can't be removed, so its implied chance (vig in) stands in for the market's
            add(("prop", nk, l["stat"], "over", r["k"] - 0.5), "%s %s %d+" % (l["name"], l["label"], r["k"]), "prop", "dk", 1 / dec(r["price"]), implied(r["price"]), extra={"pid": l["pid"], "stat": l["stat"], "name": l["name"]})
    # Kalshi
    for ser, kind in K_SERIES.items():
        d = getj("%s/markets?event_ticker=%s-%s%s%s&limit=200" % (KALSHI, ser, dcode, A, H)) or {}
        for m in d.get("markets", []):
            ya, yb, na = fnum(m.get("yes_ask_dollars")), fnum(m.get("yes_bid_dollars")), fnum(m.get("no_ask_dollars"))
            vol = fnum(m.get("volume_fp")) or 0
            mid = (ya + yb) / 2 if ya and yb else None
            thin = not ya or not yb or ya - yb > 0.06
            yc = ya + kfee(ya) if ya else None; nc = na + kfee(na) if na else None
            fs = fnum(m.get("floor_strike")); tk = m["ticker"].split("-")[-1]
            if kind == "ml":
                t = tk; o = H if t == A else A
                add(("ml", t), t + " ML", "ml", "kalshi", yc, mid, vol, thin)
            elif kind == "sp" and fs is not None:
                t = re.match(r"[A-Z]+", tk).group(0); o = H if t == A else A
                add(("sp", t, -fs), "%s %+.1f" % (t, -fs), "sp", "kalshi", yc, mid, vol, thin)
                add(("sp", o, fs), "%s %+.1f" % (o, fs), "sp", "kalshi", nc, None if mid is None else 1 - mid, vol, thin)
            elif kind == "tot" and fs is not None:
                add(("tot", "over", fs), "Over %.1f" % fs, "tot", "kalshi", yc, mid, vol, thin)
                add(("tot", "under", fs), "Under %.1f" % fs, "tot", "kalshi", nc, None if mid is None else 1 - mid, vol, thin)
            elif kind == "tt" and fs is not None:
                t = re.match(r"[A-Z]+", tk).group(0)
                add(("tt", t, "over", fs), "%s team total over %.1f" % (t, fs), "tt", "kalshi", yc, mid, vol, thin)
                add(("tt", t, "under", fs), "%s team total under %.1f" % (t, fs), "tt", "kalshi", nc, None if mid is None else 1 - mid, vol, thin)
            elif fs is not None:
                nm = (m.get("title") or "").split(":")[0]; nk = nkey(nm); pid = next((p["id"] for p in players if nkey(p["name"]) == nk), None)
                lab = LABEL.get(kind, kind)
                add(("prop", nk, kind, "over", fs), "%s %s %d+" % (nm, lab, int(fs + 0.5)), "prop", "kalshi", yc, mid, vol, thin, extra={"pid": pid, "stat": kind, "name": nm})
                add(("prop", nk, kind, "under", fs), "%s %s under %d" % (nm, lab, int(fs + 0.5)), "prop", "kalshi", nc, None if mid is None else 1 - mid, vol, thin, extra={"pid": pid, "stat": kind, "name": nm})
    # Polymarket
    ev_p = getj("%s/events?slug=nba-%s-%s-%s" % (POLY, A.lower(), H.lower(), tipet.strftime("%Y-%m-%d"))) or []
    for e in ev_p[:1]:
        for m in e.get("markets", []):
            q = m.get("question") or ""
            try:
                outs = json.loads(m.get("outcomes") or "[]")
            except Exception:
                outs = []
            ba, bb, vol = fnum(m.get("bestAsk")), fnum(m.get("bestBid")), round(fnum(m.get("volume")) or 0)
            if ba is None or bb is None or len(outs) != 2:
                continue
            thin = ba - bb > 0.06
            c0, c1, mid = ba, 1 - bb, (ba + bb) / 2
            mm = re.match(r"Spread: (.+?) \(([-+][\d.]+)\)$", q)
            mo = re.search(r"O/U ([\d.]+)$", q)
            if q == "%s vs. %s" % (nick[A], nick[H]) or q == "%s vs. %s" % (nick[H], nick[A]):
                t0, t1 = by_nick.get(outs[0]), by_nick.get(outs[1])
                if t0 and t1:
                    add(("ml", t0), t0 + " ML", "ml", "poly", c0, mid, vol, thin); add(("ml", t1), t1 + " ML", "ml", "poly", c1, 1 - mid, vol, thin)
            elif mm and by_nick.get(mm.group(1)):
                t = by_nick[mm.group(1)]; o = H if t == A else A; L = float(mm.group(2))
                add(("sp", t, L), "%s %+.1f" % (t, L), "sp", "poly", c0, mid, vol, thin); add(("sp", o, -L), "%s %+.1f" % (o, -L), "sp", "poly", c1, 1 - mid, vol, thin)
            elif mo and q.startswith("%s vs. %s: O/U" % (nick[A], nick[H])):
                L = float(mo.group(1)); add(("tot", "over", L), "Over %.1f" % L, "tot", "poly", c0, mid, vol, thin); add(("tot", "under", L), "Under %.1f" % L, "tot", "poly", c1, 1 - mid, vol, thin)
            elif mo and "Team Total" in q and "1H" not in q and "2H" not in q:
                t = by_nick.get(q.split(" Team Total")[0])
                if t:
                    L = float(mo.group(1)); add(("tt", t, "over", L), "%s team total over %.1f" % (t, L), "tt", "poly", c0, mid, vol, thin); add(("tt", t, "under", L), "%s team total under %.1f" % (t, L), "tt", "poly", c1, 1 - mid, vol, thin)
            elif mo and ":" in q:
                nm, rest = q.split(":", 1); st = POLY_STAT.get(rest.strip().rsplit(" O/U", 1)[0])
                if st:
                    L = float(mo.group(1)); nk = nkey(nm); pid = next((p["id"] for p in players if nkey(p["name"]) == nk), None)
                    add(("prop", nk, st, "over", L), "%s %s over %s" % (nm, LABEL[st], L), "prop", "poly", c0, mid, vol, thin, extra={"pid": pid, "stat": st, "name": nm})
                    add(("prop", nk, st, "under", L), "%s %s under %s" % (nm, LABEL[st], L), "prop", "poly", c1, 1 - mid, vol, thin, extra={"pid": pid, "stat": st, "name": nm})
    return out, H, A


def price_multi(g, rows, H, A, proj):
    """Our chance for every outcome, the consensus of the sources, the best price, and value at it."""
    ours = g["ours"]
    mh = ours["margin"]; tm = {H: ours["home_pts"], A: ours["away_pts"]}
    res = []
    for k, r in rows.items():
        key = r["key"].split("|"); kind = r["kind"]; p = None
        if kind == "ml":
            p = Phi(mh / SD_MARGIN) if key[1] == H else 1 - Phi(mh / SD_MARGIN)
        elif kind == "sp":
            me = mh if key[1] == H else -mh; p = Phi((me + float(key[2])) / SD_MARGIN)
        elif kind == "tot":
            po = 1 - Phi((float(key[2]) - ours["total"]) / SD_TOTAL); p = po if key[1] == "over" else 1 - po
        elif kind == "tt":
            po = 1 - Phi((float(key[3]) - tm.get(key[1], 110)) / SD_TEAM); p = po if key[2] == "over" else 1 - po
        elif kind == "prop" and r.get("pid") in proj and proj[r["pid"]]["min"] > 0:
            pr = proj[r["pid"]]; st = r["stat"]; L = float(key[4])
            mean = sum(pr["mean"][s] for s in STAT_KEYS[st]); rate = sum(pr["rates"][s] for s in STAT_KEYS[st])
            po = p_over(st, mean, rate, pr["sdm"], L); p = po if key[3] == "over" else 1 - po
            r["mean"] = round(mean, 1)
        liquid = {s: v for s, v in r["src"].items() if not v["thin"]}
        mids = [v["mid"] for v in liquid.values() if v["mid"] is not None]
        cons = sum(mids) / len(mids) if mids else None
        pool = liquid or {}
        best = min(pool.items(), key=lambda kv: kv[1]["cost"]) if pool else None
        r["p"] = None if p is None else round(p, 4)
        r["cons"] = None if cons is None else round(cons, 4)
        w = W_PROP if kind == "prop" else W_GAME
        pb = None if (p is None or cons is None) else w * p + (1 - w) * cons     # no market number → no value claim
        r["p_blend"] = None if pb is None else round(pb, 4)
        if best:
            r["best"] = {"src": best[0], "cost": best[1]["cost"]}
            r["ev"] = None if pb is None else round(pb / best[1]["cost"] - 1, 4)
            costs = [v["cost"] for v in liquid.values()]
            r["gap_c"] = round((max(costs) - min(costs)) * 100, 1) if len(costs) > 1 else None
        r["n_src"] = len(r["src"])
        res.append(r)
    return res


def main():
    from zoneinfo import ZoneInfo
    today = datetime.datetime.now(ZoneInfo("America/New_York")).strftime("%Y%m%d")   # the NBA's slate day, not UTC's
    sb = getj("%s/scoreboard?dates=%s" % (SITE, today)) or {}
    want = sys.argv[1] if len(sys.argv) > 1 else None
    events = [e for e in sb.get("events", []) if not want or e["id"] == want]
    # a game's page freezes at tip: rebuilding it later would show live in-game prices as if they were the pregame board
    now = datetime.datetime.now(datetime.timezone.utc)
    started = {e["id"] for e in events if datetime.datetime.fromisoformat(e["date"].replace("Z", "+00:00")) <= now and os.path.exists(os.path.join(OUT, e["id"] + ".json"))}
    last, opp, lg = last_season()
    os.makedirs(OUT, exist_ok=True)
    # keep the repo small: game boards only for today's slate and yesterday's (pick logs are kept for good)
    if not want:
        keep = {e["id"] for e in events}
        yday = getj("%s/scoreboard?dates=%s" % (SITE, (datetime.datetime.strptime(today, "%Y%m%d") - datetime.timedelta(days=1)).strftime("%Y%m%d"))) or {}
        keep |= {e["id"] for e in yday.get("events", [])}
        for f in os.listdir(OUT):
            if re.match(r"^\d+\.json$", f) and f[:-5] not in keep:
                os.remove(os.path.join(OUT, f))
    idx = []
    # pass 1: raw team points for every game today; scale = last season's league scoring / tonight's raw average
    # (a sum of rotation players' scoring rates overstates a team: it leaves out the deep bench and garbage time)
    for ev in events:                       # the whole slate, tipped games included: one game is too few to calibrate on
        build(ev["id"], ev, last, opp, lg)
    scale = (lg / (sum(RAW) / len(RAW))) if RAW else 1.0
    print("team-points calibration x%.3f (league %.1f ppg last season)" % (scale, lg))
    for ev in events:
        if ev["id"] in started:
            g = json.load(open(os.path.join(OUT, ev["id"] + ".json")))
            idx.append({"id": ev["id"], "name": ev["name"], "tip": ev["date"], "lines": g.get("n_lines", 0)})
            continue
        g = build(ev["id"], ev, last, opp, lg, scale)
        BUILT[ev["id"]] = g
        # prices refresh live in the browser (bet/nba-live.js), so a board only needs re-committing when OUR numbers
        # move (injury, minutes, a new game in the log) or it's 3 h old — keeps the repo from filling with snapshots
        path = os.path.join(OUT, ev["id"] + ".json")
        fp = fingerprint(g)
        try:
            old = json.load(open(path))
        except Exception:
            old = None
        age = (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(old["built"].replace("Z", "+00:00"))).total_seconds() / 3600 if old and old.get("built") else 99
        if not old or old.get("fp") != fp or age >= 3:
            g["fp"] = fp
            json.dump(g, open(path, "w"), separators=(",", ":"))
        else:
            print("  %s: our numbers unchanged (%.1f h old) — not rewritten" % (ev["name"], age))
        idx.append({"id": ev["id"], "name": ev["name"], "tip": ev["date"], "lines": g["n_lines"]})
        print("%s · %d book lines · %d props · ours %s %+.1f, total %.1f" % (ev["name"], g["n_lines"], len(g["props"]), g["home"]["abbr"], g["ours"]["margin"], g["ours"]["total"]))
    if not want:
        json.dump({"date": today, "games": idx}, open(os.path.join(OUT, "index.json"), "w"), indent=1)
        freeze_picks(today, events)


BUILT = {}


def fingerprint(g):
    """What our side of the board depends on: projected minutes/lines/status per player + the game numbers."""
    import hashlib
    core = [g["ours"], sorted((p["id"], p["min"], p.get("status"), p["mean"].get("pts"), p["mean"].get("reb"), p["mean"].get("ast")) for p in g["players"])]
    return hashlib.md5(json.dumps(core, sort_keys=True, default=str).encode()).hexdigest()[:12]


def qualifies(r):
    """A logged pick: a standard line (no ladder rung), 35–70¢, priced by 2+ liquid sources, bought below the market's
    fair price, our model on the same side, trusted player."""
    R = PICK_RULES
    if r.get("ev") is None or not r.get("best") or r.get("cons") is None or r.get("p") is None or r.get("trust") == "low":
        return False
    if r["label"].rstrip().endswith("+"):
        return False
    c = r["best"]["cost"]
    if not (R["min_cost"] <= c <= R["max_cost"]):
        return False
    if sum(1 for v in r["src"].values() if not v["thin"]) < R["min_sources"]:
        return False
    return r["cons"] / c - 1 >= R["min_market_edge"] and r["p"] > r["cons"]


def pick_group(r):
    k = r["key"].split("|")
    if r["kind"] == "prop":
        return "|".join(k[1:4])
    if r["kind"] in ("sp", "ml"):
        return "side|" + k[1]
    if r["kind"] == "tt":
        return "|".join(k[:3])
    return "tot|" + k[1]


def freeze_picks(day, events):
    """Log the page's value picks (one per opinion, trusted, no long shots) for every game that hasn't tipped,
    at the price and source shown. Games that have started are never rewritten. Graded by grade_nba_compare.py."""
    path = os.path.join(OUT, "picks_%s.json" % day)
    log = json.load(open(path)) if os.path.exists(path) else {"date": day, "games": {}}
    now = datetime.datetime.now(datetime.timezone.utc)
    for ev in events:
        gid = ev["id"]; tip = datetime.datetime.fromisoformat(ev["date"].replace("Z", "+00:00"))
        if tip <= now:
            continue                                    # started: frozen, and never logged after tip (live prices = hindsight)
        g = BUILT.get(gid)
        if g is None:
            try:
                g = json.load(open(os.path.join(OUT, gid + ".json")))
            except Exception:
                continue
        rows = sorted([r for r in g.get("multi", []) if qualifies(r)], key=lambda r: -(r["cons"] / r["best"]["cost"]))
        seen, picks = set(), []
        for r in rows:
            grp = pick_group(r) if r["kind"] != "prop" else "player|" + (r.get("name") or r["key"].split("|")[1])   # one per player
            if grp in seen:
                continue
            seen.add(grp)
            picks.append({"key": r["key"], "kind": r["kind"], "label": r["label"], "name": r.get("name"), "stat": r.get("stat"),
                          "src": r["best"]["src"], "cost": r["best"]["cost"], "p": r["p"], "cons": r["cons"], "ev": r["ev"]})
        log["rules"] = "v2"                         # Oct 28 2026 rules (qualifies()); earlier days are v1
        log["games"][gid] = {"tip": ev["date"], "name": ev["name"], "home": g["home"]["abbr"], "away": g["away"]["abbr"], "ours": g["ours"],
                             "picks": picks, "at": now.strftime("%Y-%m-%dT%H:%M:%SZ")}
    json.dump(log, open(path, "w"), separators=(",", ":"))
    print("picks logged: %d games, %d picks" % (len(log["games"]), sum(len(x["picks"]) for x in log["games"].values())))


if __name__ == "__main__":
    main()
