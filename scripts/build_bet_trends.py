#!/usr/bin/env python3
"""
build_bet_trends.py — Betting Hub, Phase A: trend engine on our OWN data.

No purchased odds needed. Two products, both from data we already own:

  TEAM trends   (games.jsonl + team_seasons.srs) — over the last N seasons, per team:
      straight-up record, home/away/neutral splits, scoring (PF/PA/total), and
      performance vs our power-rating line (avg actual margin minus the SRS-implied
      line, plus how often they beat that number as a favorite / underdog). This is
      the model-vs-result backtest that becomes the "edge" layer once real lines land.

  PLAYER prop trends  (box_scores) — over the last N seasons, per player per stat
      (pts / reb / ast / 3pm / PRA): games, average, spread (stdev), floor/ceiling,
      home vs away split, and a season-over-season trend. Lets the cheat sheet compute
      an approximate hit-rate for any prop line and flag players trending up/down.

Reads are all via the public anon key (read-only, like the other build_*.py). Writes:
      scripts/data/bet_trends_teams.json
      scripts/data/bet_trends_players.json

  python3 scripts/build_bet_trends.py            # teams + players, last 5 seasons
  python3 scripts/build_bet_trends.py --teams    # teams only (fast, local)
  python3 scripts/build_bet_trends.py --players  # players only (heavy box pull)
  python3 scripts/build_bet_trends.py --seasons 2024,2025,2026
"""
import json, os, sys, math, urllib.request, urllib.parse
from collections import defaultdict

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "data")
GAMES = os.path.join(HERE, "data", "games.jsonl")

HCA = 3.3          # home-court advantage on the point-spread scale
DEFAULT_SEASONS = [2022, 2023, 2024, 2025, 2026]   # last 5 played seasons (2021-22 .. 2025-26)
MIN_GP_PLAYER = 10


def get(path):
    """Paginated GET (1000-row pages) via Range header."""
    out, frm = [], 0
    while True:
        h = {**HDR, "Range-Unit": "items", "Range": "%d-%d" % (frm, frm + 999)}
        req = urllib.request.Request(SB + "/rest/v1/" + path, headers=h)
        b = json.load(urllib.request.urlopen(req, timeout=90))
        out += b
        if len(b) < 1000:
            break
        frm += 1000
    return out


# ── TEAM TRENDS ────────────────────────────────────────────────────────────
def build_team_trends(seasons):
    print("Team trends — seasons %s" % seasons, flush=True)
    # SRS by (season, team) for the model line
    srs = {}
    for yr in seasons:
        for r in get("team_seasons?season_year=eq.%d&select=team,srs&srs=not.is.null" % yr):
            srs[(yr, r["team"])] = float(r["srs"])
    print("  loaded %d team-season SRS rows" % len(srs), flush=True)
    # season scoring rates (points for / against) for the model TOTAL line — used for
    # real over/under hit-rates: a game's projected total is the average of the two teams'
    # typical game totals (PF+PA), and a team's projected points is (its PF + opp PA)/2.
    sco = {}
    for yr in seasons:
        for r in get("team_seasons?season_year=eq.%d&select=team,ppg,oppg&ppg=not.is.null&oppg=not.is.null" % yr):
            sco[(yr, r["team"])] = (float(r["ppg"]), float(r["oppg"]))
    print("  loaded %d team-season scoring rows" % len(sco), flush=True)

    # blank aggregate: overall + per-season, straight-up + splits + vs-line
    def blank():
        return {"g": 0, "w": 0, "l": 0, "pf": 0.0, "pa": 0.0,
                "hg": 0, "hw": 0, "ag": 0, "aw": 0, "ng": 0, "nw": 0,
                "vsline": 0.0, "vln": 0,               # sum(actual_margin - model_line), count
                "favg": 0, "favbeat": 0, "dogg": 0, "dogbeat": 0,
                "ouover": 0, "oun": 0,                 # game total OVER our projected total, count
                "ttover": 0, "ttn": 0}                 # team's OWN points OVER their projected points, count

    agg = defaultdict(blank)          # team -> overall
    byseason = defaultdict(lambda: defaultdict(blank))   # team -> season -> agg

    seen = 0
    with open(GAMES) as f:
        for line in f:
            g = json.loads(line)
            yr = g.get("season")
            if yr not in seasons:
                continue
            if g.get("status") != "STATUS_FINAL":
                continue
            hs, as_ = g.get("home_score"), g.get("away_score")
            if hs is None or as_ is None:
                continue
            home, away = g.get("home"), g.get("away")
            neutral = bool(g.get("neutral"))
            margin = hs - as_                      # home perspective
            seen += 1

            for team, opp, is_home, tm_pts, op_pts in (
                (home, away, True, hs, as_),
                (away, home, False, as_, hs),
            ):
                tm_margin = tm_pts - op_pts
                for bucket in (agg[team], byseason[team][yr]):
                    bucket["g"] += 1
                    bucket["pf"] += tm_pts
                    bucket["pa"] += op_pts
                    won = tm_margin > 0
                    bucket["w"] += won
                    bucket["l"] += (not won)
                    if neutral:
                        bucket["ng"] += 1; bucket["nw"] += won
                    elif is_home:
                        bucket["hg"] += 1; bucket["hw"] += won
                    else:
                        bucket["ag"] += 1; bucket["aw"] += won
                # vs the power-rating line (needs both SRS)
                st, so = srs.get((yr, team)), srs.get((yr, opp))
                if st is not None and so is not None:
                    line = st - so + (0 if neutral else (HCA if is_home else -HCA))  # team perspective
                    diff = tm_margin - line
                    for bucket in (agg[team], byseason[team][yr]):
                        bucket["vsline"] += diff; bucket["vln"] += 1
                        if line > 0:      # favored
                            bucket["favg"] += 1; bucket["favbeat"] += (tm_margin > line)
                        elif line < 0:    # underdog
                            bucket["dogg"] += 1; bucket["dogbeat"] += (tm_margin > line)
                # over/under vs our MODEL total (needs both teams' season scoring)
                sc_t, sc_o = sco.get((yr, team)), sco.get((yr, opp))
                if sc_t and sc_o:
                    proj_total = ((sc_t[0] + sc_t[1]) + (sc_o[0] + sc_o[1])) / 2.0
                    exp_team = (sc_t[0] + sc_o[1]) / 2.0     # team's projected points vs this opp
                    actual_total = tm_pts + op_pts
                    for bucket in (agg[team], byseason[team][yr]):
                        bucket["oun"] += 1; bucket["ouover"] += (actual_total > proj_total)
                        bucket["ttn"] += 1; bucket["ttover"] += (tm_pts > exp_team)

    def pack(b):
        g = b["g"] or 1
        return {
            "g": b["g"], "w": b["w"], "l": b["l"],
            "winpct": round(b["w"] / g, 3),
            "ppg": round(b["pf"] / g, 1), "oppg": round(b["pa"] / g, 1),
            "margin": round((b["pf"] - b["pa"]) / g, 1),
            "total": round((b["pf"] + b["pa"]) / g, 1),
            "home": {"g": b["hg"], "w": b["hw"], "pct": round(b["hw"] / (b["hg"] or 1), 3)},
            "away": {"g": b["ag"], "w": b["aw"], "pct": round(b["aw"] / (b["ag"] or 1), 3)},
            "neutral": {"g": b["ng"], "w": b["nw"]},
            # vs our power-rating line: + = beats projection
            "vsLine": round(b["vsline"] / (b["vln"] or 1), 1),
            "favBeat": {"g": b["favg"], "pct": round(b["favbeat"] / (b["favg"] or 1), 3)},
            "dogBeat": {"g": b["dogg"], "pct": round(b["dogbeat"] / (b["dogg"] or 1), 3)},
            # real over/under hit-rates vs our MODEL total (not a sportsbook line)
            "ouOver": {"g": b["oun"], "pct": round(b["ouover"] / (b["oun"] or 1), 3)},
            "ttOver": {"g": b["ttn"], "pct": round(b["ttover"] / (b["ttn"] or 1), 3)},
        }

    out = {}
    for team, b in agg.items():
        if b["g"] < 10:
            continue
        rec = pack(b)
        rec["bySeason"] = {str(yr): pack(byseason[team][yr]) for yr in seasons if byseason[team][yr]["g"]}
        out[team] = rec

    meta = {"seasons": seasons, "hca": HCA, "games": seen, "teams": len(out)}
    payload = {"meta": meta, "teams": out}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "bet_trends_teams.json"), "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print("  wrote bet_trends_teams.json — %d teams over %d games" % (len(out), seen), flush=True)


# ── PLAYER PROP TRENDS ─────────────────────────────────────────────────────
def build_player_trends(seasons):
    print("Player prop trends — seasons %s" % seasons, flush=True)
    # per player: espn_id -> {name, team(last), stat -> {all:[], home:[], away:[], bySeason:{yr:[]}}}
    logs = defaultdict(lambda: {"name": None, "team": None,
                                "stat": defaultdict(lambda: {"all": [], "home": [], "away": [], "sea": defaultdict(list)})})
    STATS = ["pts", "reb", "ast", "tpm", "pra"]

    for yr in seasons:
        teams = sorted({t["team"] for t in get("team_seasons?season_year=eq.%d&select=team&team=not.is.null" % yr)})
        for i, tm in enumerate(teams):
            rows = get("box_scores?season_year=eq.%d&team=eq.%s&select=espn_id,player,team,pts,reb,ast,tpm,min,game_id"
                       % (yr, urllib.parse.quote(tm)))
            # home/away: infer from games.jsonl later is costly; use per-game team side via game_id map not available here,
            # so we approximate home/away by comparing to a games index below. For v1 we skip precise venue and mark all.
            for r in rows:
                eid = r.get("espn_id")
                if eid is None or (r.get("min") or 0) == 0:
                    continue
                P = logs[eid]
                P["name"] = r.get("player"); P["team"] = r.get("team")
                vals = {"pts": r.get("pts") or 0, "reb": r.get("reb") or 0, "ast": r.get("ast") or 0,
                        "tpm": r.get("tpm") or 0}
                vals["pra"] = vals["pts"] + vals["reb"] + vals["ast"]
                for s in STATS:
                    P["stat"][s]["all"].append(vals[s])
                    P["stat"][s]["sea"][yr].append(vals[s])
            if (i + 1) % 80 == 0:
                print("    %d/%d %d teams (%d players)" % (i + 1, len(teams), yr, len(logs)), flush=True)

    def summ(a):
        n = len(a)
        if not n:
            return None
        m = sum(a) / n
        sd = math.sqrt(sum((x - m) ** 2 for x in a) / n) if n > 1 else 0.0
        sa = sorted(a)
        return {"g": n, "avg": round(m, 1), "sd": round(sd, 1),
                "lo": sa[0], "hi": sa[-1],
                "p25": sa[int(0.25 * (n - 1))], "med": sa[int(0.5 * (n - 1))], "p75": sa[int(0.75 * (n - 1))]}

    # keep only players active in the last two seasons — props are only bettable on
    # current players, and it keeps the file loadable (graduated players just bloat it).
    active_seasons = set(sorted(seasons)[-2:])
    out = {}
    for eid, P in logs.items():
        pts = P["stat"]["pts"]
        if len(pts["all"]) < MIN_GP_PLAYER:
            continue
        if not (active_seasons & set(pts["sea"].keys())):
            continue
        rec = {"name": P["name"], "team": P["team"], "stats": {}}
        for s in ["pts", "reb", "ast", "tpm", "pra"]:
            d = P["stat"][s]
            base = summ(d["all"])
            if not base:
                continue
            # per-season kept lightweight (games + average) — enough for the trend arrow
            base["bySeason"] = {str(yr): {"g": len(v), "avg": round(sum(v) / len(v), 1)}
                                for yr, v in sorted(d["sea"].items()) if v}
            rec["stats"][s] = base
        out[str(eid)] = rec

    payload = {"meta": {"seasons": seasons, "players": len(out), "min_gp": MIN_GP_PLAYER}, "players": out}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "bet_trends_players.json"), "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print("  wrote bet_trends_players.json — %d players" % len(out), flush=True)


def main():
    args = sys.argv[1:]
    seasons = DEFAULT_SEASONS
    if "--seasons" in args:
        seasons = [int(x) for x in args[args.index("--seasons") + 1].split(",")]
    do_teams = ("--players" not in args) or ("--teams" in args)
    do_players = ("--teams" not in args) or ("--players" in args)
    if do_teams:
        build_team_trends(seasons)
    if do_players:
        build_player_trends(seasons)


if __name__ == "__main__":
    main()
