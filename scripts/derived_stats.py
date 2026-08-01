#!/usr/bin/env python3
"""derived_stats.py — compute our OWN advanced stats from raw box scores.

WHY THIS EXISTS
  Sports-Reference / Basketball-Reference derived numbers (bpm, per, ws, usg%, ts%,
  the whole bbref_seasons.advanced blob, and team_seasons.srs) are scraped values we do
  not own. This module rebuilds the advanced layer from `box_scores` — raw player-game
  lines sourced from ESPN — so every derived number is reproducible from data we own and
  defined by code we can point to. No SR value is read or copied anywhere in here.

WHAT IT COMPUTES  (all from raw box_scores, one pass per season)
  Standard rate stats (universal public formulas, computed from OUR totals):
    ts_pct, efg_pct, per-40 lines, usg_pct,
    ast_pct, orb_pct, drb_pct, trb_pct, stl_pct, blk_pct, tov_pct
  Our own value metric (OUR weights — the BPM/PER/WS replacement):
    ti40  — TDC Impact per-40  (transparent linear box value, see TI_W)
    ti100 — TDC Impact per-100 team possessions

DATA MODEL
  Each box_scores row is one player's line in one game: (player, espn_id, team, opp, min,
  pts, fga/fgm, fta/ftm, tpa/tpm, oreb, dreb, reb, ast, stl, blk, tov, pf).
  team/opp are full ESPN names ("Duke Blue Devils"). So for a season:
    player totals  = sum rows grouped by espn_id
    team totals    = sum rows grouped by team           (what a team DID)
    opponent totals= sum rows grouped by opp            (what a team ALLOWED)
  Possessions (team) ~= FGA + 0.44*FTA - ORB + TOV.

USAGE
  python3 derived_stats.py 2026            # one season -> data/derived_stats_2026.json (+ validation csv)
  python3 derived_stats.py all             # every covered season (2010-2026)
  python3 derived_stats.py 2026 --validate # also emit a bbref TS%/USG% comparison csv

Writes data/derived_stats_<year>.json keyed by espn_id. DB writes are the owner's to run
(anon key is RLS-blocked); this module only produces the numbers + review artifacts.
"""
import os, sys, csv, json, importlib.util, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv_backup = sys.argv[:]
sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location("ag", os.path.join(HERE, "archetype_grades.py"))
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
sys.argv = sys.argv_backup
D = os.path.join(HERE, "data")

# ── our own TDC Impact weights (points-equivalent value of each box event) ──
# These are OURS. Rationale: reward production, tax inefficiency. Tunable in one place.
# Deliberately pf-free: personal fouls live only in box_scores, not in player_history or
# the ESPN per-game feed, so excluding them keeps TI *identical* wherever it's computed
# (this Python batch AND the Apps Script ingest mirror, scripts/tdc_derived.gs).
TI_W = {
    "pts": 1.00,          # a point is a point
    "oreb": 0.80,         # offensive board ~= a fresh possession
    "dreb": 0.30,         # defensive board = ending a possession
    "ast": 0.70,          # created value, discounted (shooter finishes)
    "stl": 1.40,          # takeaway = possession swing
    "blk": 0.90,          # erased shot
    "miss_fg": -0.50,     # per missed field goal (fga - fgm)
    "miss_ft": -0.35,     # per missed free throw (fta - ftm)
    "tov": -1.00,         # lost possession
}
MIN_MP_QUAL = 40          # season minutes floor to publish a rate stat (else null)
REG_MP = 100              # per-40 regression: pull low-minute lines toward 0

# Offensive & Defensive Wins Added — owned signals mapped to the familiar OWS/DWS scale
# by a fixed linear calibration (validated in build_wins_split.py: DWA r=0.96, OWA r=0.91
# vs bbref; constants stable across seasons). OWA = offensive TI slice; DWA = Dean Oliver's
# DWS math from our own player/team/opponent box aggregates. They do NOT sum to WA.
OWA_REPL = 3.0
OWA_A, OWA_B = -0.10, 0.0092     # owa = OWA_A + OWA_B * ((ti_off/40 - REPL) * min/40)
DWA_A, DWA_B = 0.186, 0.74       # dwa = DWA_A + DWA_B * (Oliver DWS from owned box)


def _z():
    return {k: 0.0 for k in ("min pts fga fgm fta ftm tpa tpm oreb dreb reb ast stl blk tov pf g").split()}


def aggregate(rows):
    """One pass -> (player_totals by espn_id, team_totals by team, opp_totals by team)."""
    P, T, O = defaultdict(_z), defaultdict(_z), defaultdict(_z)
    NAME, PTEAM = {}, {}
    for r in rows:
        eid = r.get("espn_id")
        tm, op = r.get("team"), r.get("opp")
        def add(d, key):
            a = d[key]
            for k in ("min pts fga fgm fta ftm tpa tpm oreb dreb reb ast stl blk tov pf").split():
                a[k] += (r.get(k) or 0)
            a["g"] += 1
        if eid is not None:
            add(P, eid); NAME[eid] = r.get("player"); PTEAM[eid] = tm
        if tm:
            add(T, tm)
        if op:
            add(O, op)   # rows where THIS team is the opponent = what `op` allowed
    return P, T, O, NAME, PTEAM


def poss(a):
    """Estimated possessions from a totals dict."""
    return a["fga"] + 0.44 * a["fta"] - a["oreb"] + a["tov"]


def owa_raw(a):
    """Offensive slice of TI (pts/ast/oreb/misses/tov), above-replacement × volume."""
    ti = (1.0 * a["pts"] + 0.8 * a["oreb"] + 0.7 * a["ast"]
          - 0.5 * (a["fga"] - a["fgm"]) - 0.35 * (a["fta"] - a["ftm"]) - 1.0 * a["tov"])
    ti40 = ti * 40.0 / (a["min"] + REG_MP)
    return (ti40 - OWA_REPL) * (a["min"] / 40.0)


def dwa_raw(a, t, o, lg_ppp, lg_ppg, lg_pace):
    """Dean Oliver's Defensive Win Shares for one player, from owned box aggregates.
    a=player, t=team, o=opponent-allowed totals, lg=league rates."""
    MP, Tm_MP = a["min"], t["min"]
    if MP < 1 or Tm_MP < 1 or not o:
        return None
    Tm_DefPoss = poss(o)                       # opponent possessions = team defensive poss
    if Tm_DefPoss <= 0:
        return None
    DORp = o["oreb"] / (o["oreb"] + t["dreb"]) if (o["oreb"] + t["dreb"]) > 0 else 0
    DFGp = o["fgm"] / o["fga"] if o["fga"] > 0 else 0
    den = DFGp * (1 - DORp) + (1 - DFGp) * DORp
    FMwt = (DFGp * (1 - DORp)) / den if den > 0 else 0
    Stops1 = a["stl"] + a["blk"] * FMwt * (1 - 1.07 * DORp) + a["dreb"] * (1 - FMwt)
    ftmiss = (1 - (o["ftm"] / o["fta"])) ** 2 if o["fta"] > 0 else 0
    Stops2 = ((((o["fga"] - o["fgm"] - t["blk"]) / Tm_MP) * FMwt * (1 - 1.07 * DORp)
              + ((o["tov"] - t["stl"]) / Tm_MP)) * MP
             + (a["pf"] / t["pf"] if t["pf"] > 0 else 0) * 0.4 * o["fta"] * ftmiss)
    Stopp = ((Stops1 + Stops2) * Tm_MP) / (Tm_DefPoss * MP) if (Tm_DefPoss * MP) > 0 else 0
    Tm_DRtg = 100.0 * o["pts"] / Tm_DefPoss
    scposs = o["fgm"] + (1 - ftmiss) * o["fta"] * 0.4
    DPtsScPoss = o["pts"] / scposs if scposs > 0 else 1.0
    DRtg = Tm_DRtg + 0.2 * (100 * DPtsScPoss * (1 - Stopp) - Tm_DRtg)
    marg_def = (MP / Tm_MP) * Tm_DefPoss * (1.08 * lg_ppp - DRtg / 100.0)
    Tm_pace = poss(t) / (t["min"] / 200.0) if t["min"] else lg_pace
    mpw = 0.32 * lg_ppg * (Tm_pace / lg_pace) if lg_pace else 1.0
    return marg_def / mpw if mpw else None


def safe(n, d):
    return (n / d) if d else None


def compute(P, T, O, NAME, PTEAM, season):
    out = {}
    # league aggregates for DWA (Oliver marginal points-per-win)
    lg_poss = sum(poss(x) for x in T.values()) or 1
    lg_pts = sum(x["pts"] for x in T.values())
    lg_g = sum((x["min"] / 200.0) for x in T.values()) or 1
    lg_ppp, lg_ppg, lg_pace = lg_pts / lg_poss, lg_pts / lg_g, lg_poss / lg_g
    for eid, a in P.items():
        tm = PTEAM.get(eid)
        t = T.get(tm); o = O.get(tm)
        mp = a["min"]
        if not t or mp < 1:
            continue
        tmp = t["min"]                       # team total player-minutes
        team_poss = poss(t)
        opp_poss = poss(o) if o else team_poss
        # --- shooting (player-only, universal formulas) ---
        tsa = a["fga"] + 0.44 * a["fta"]
        ts = safe(a["pts"], 2 * tsa)
        efg = safe(a["fgm"] + 0.5 * a["tpm"], a["fga"])
        # --- usage & role (need team totals) ---
        usg = safe(100 * (a["fga"] + 0.44 * a["fta"] + a["tov"]) * (tmp / 5.0),
                   mp * (t["fga"] + 0.44 * t["fta"] + t["tov"]))
        ast_pct = safe(100 * a["ast"], (mp / (tmp / 5.0)) * t["fgm"] - a["fgm"])
        tov_pct = safe(100 * a["tov"], a["fga"] + 0.44 * a["fta"] + a["tov"])
        # --- rebounding (need team + opponent boards) ---
        orb_pct = drb_pct = trb_pct = None
        if o:
            orb_pct = safe(100 * a["oreb"] * (tmp / 5.0), mp * (t["oreb"] + o["dreb"]))
            drb_pct = safe(100 * a["dreb"] * (tmp / 5.0), mp * (t["dreb"] + o["oreb"]))
            trb_pct = safe(100 * a["reb"] * (tmp / 5.0), mp * (t["reb"] + o["reb"]))
        # --- defense (need opponent context) ---
        stl_pct = safe(100 * a["stl"] * (tmp / 5.0), mp * opp_poss) if o else None
        opp_2pa = (o["fga"] - o["tpa"]) if o else None
        blk_pct = safe(100 * a["blk"] * (tmp / 5.0), mp * opp_2pa) if opp_2pa else None
        # --- our own value metric (OUR weights) ---
        ti = (TI_W["pts"] * a["pts"] + TI_W["oreb"] * a["oreb"] + TI_W["dreb"] * a["dreb"]
              + TI_W["ast"] * a["ast"] + TI_W["stl"] * a["stl"] + TI_W["blk"] * a["blk"]
              + TI_W["miss_fg"] * (a["fga"] - a["fgm"]) + TI_W["miss_ft"] * (a["fta"] - a["ftm"])
              + TI_W["tov"] * a["tov"])
        ti40 = ti * 40.0 / (mp + REG_MP)          # per-40, minute-regressed
        ti100 = safe(ti * 100.0, (mp / (tmp / 5.0)) * team_poss) if team_poss else None
        # Offensive & Defensive Wins Added (owned; calibrated to OWS/DWS scale)
        owa = OWA_A + OWA_B * owa_raw(a)
        _dwr = dwa_raw(a, t, o, lg_ppp, lg_ppg, lg_pace)
        dwa = (DWA_A + DWA_B * _dwr) if _dwr is not None else None

        def rnd(x, n=1):
            return round(x, n) if x is not None else None
        pub = mp >= MIN_MP_QUAL
        out[str(eid)] = {
            "espn_id": eid, "name": NAME.get(eid), "team": tm, "season_year": season,
            "g": int(a["g"]), "min": int(mp),
            # per-game raw (owned, from box)
            "ppg": rnd(a["pts"] / a["g"]), "rpg": rnd(a["reb"] / a["g"]), "apg": rnd(a["ast"] / a["g"]),
            # shooting
            "ts_pct": rnd(ts, 3), "efg_pct": rnd(efg, 3),
            "fg_pct": rnd(safe(a["fgm"], a["fga"]), 3), "tp_pct": rnd(safe(a["tpm"], a["tpa"]), 3),
            "ft_pct": rnd(safe(a["ftm"], a["fta"]), 3),
            # per-40
            "pts40": rnd(a["pts"] * 40 / mp), "reb40": rnd(a["reb"] * 40 / mp), "ast40": rnd(a["ast"] * 40 / mp),
            # advanced rate (null unless qualified minutes)
            "usg_pct": rnd(usg) if pub else None,
            "ast_pct": rnd(ast_pct) if pub else None, "tov_pct": rnd(tov_pct) if pub else None,
            "orb_pct": rnd(orb_pct) if pub else None, "drb_pct": rnd(drb_pct) if pub else None,
            "trb_pct": rnd(trb_pct) if pub else None,
            "stl_pct": rnd(stl_pct, 2) if pub else None, "blk_pct": rnd(blk_pct, 2) if pub else None,
            # our own value metrics
            "ti40": rnd(ti40, 2), "ti100": rnd(ti100, 2) if pub else None,
            "owa": rnd(owa, 2), "dwa": rnd(dwa, 2),
        }
    return out


def run_season(season, validate=False):
    print(f"[{season}] fetching box_scores…")
    cols = "espn_id,player,team,opp,min,pts,fga,fgm,fta,ftm,tpa,tpm,oreb,dreb,reb,ast,stl,blk,tov,pf"
    import time
    for attempt in range(5):                       # box_scores is ~120k rows/yr — flaky conns reset mid-stream
        try:
            rows = ag.get(f"box_scores?season_year=eq.{season}", cols); break
        except Exception as e:
            if attempt == 4: raise
            print(f"[{season}] fetch retry {attempt+1} ({type(e).__name__})"); time.sleep(4 * (attempt + 1))
    print(f"[{season}] {len(rows)} box rows -> aggregating")
    P, T, O, NAME, PTEAM = aggregate(rows)
    res = compute(P, T, O, NAME, PTEAM, season)
    path = os.path.join(D, f"derived_stats_{season}.json")
    with open(path, "w") as f:
        json.dump(res, f, separators=(",", ":"))
    print(f"[{season}] {len(res)} players -> {os.path.relpath(path, HERE)}")
    if validate:
        validate_vs_bbref(season, res)
    return res


def validate_vs_bbref(season, res):
    """Spot-check: our TS%/USG% vs bbref advanced (for auditing only — bbref is being retired)."""
    bb = ag.get(f"bbref_seasons?select=espn_id,player,advanced&season_year=eq.{season}&espn_id=not.is.null", "")
    rows = []
    for b in bb:
        eid = str(b["espn_id"]); adv = b.get("advanced") or {}
        ours = res.get(eid)
        if not ours or not ours.get("ts_pct"):
            continue
        try:
            bts = float(adv.get("ts_pct")) if adv.get("ts_pct") not in (None, "") else None
            busg = float(adv.get("usg_pct")) if adv.get("usg_pct") not in (None, "") else None
        except (TypeError, ValueError):
            bts = busg = None
        rows.append([eid, ours["name"], ours["min"],
                     ours["ts_pct"], bts, (round(ours["ts_pct"] - bts, 3) if bts else ""),
                     ours["usg_pct"], busg, (round(ours["usg_pct"] - busg, 1) if (busg and ours["usg_pct"]) else "")])
    rows.sort(key=lambda r: -(r[2] or 0))
    p = os.path.join(D, f"derived_validate_{season}.csv")
    with open(p, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["espn_id", "name", "min", "ours_ts", "bbref_ts", "d_ts", "ours_usg", "bbref_usg", "d_usg"])
        w.writerows(rows)
    dts = [abs(r[5]) for r in rows if r[5] != ""]
    dusg = [abs(r[8]) for r in rows if r[8] != ""]
    if dts:
        print(f"[{season}] TS% vs bbref: n={len(dts)} mean|Δ|={sum(dts)/len(dts):.4f} max|Δ|={max(dts):.3f}")
    if dusg:
        print(f"[{season}] USG% vs bbref: n={len(dusg)} mean|Δ|={sum(dusg)/len(dusg):.2f} max|Δ|={max(dusg):.1f}")
    print(f"[{season}] wrote {os.path.relpath(p, HERE)}")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    validate = "--validate" in sys.argv[1:]
    target = args[0] if args else "2026"
    if target == "all":
        for y in range(2010, 2027):
            run_season(y, validate=False)
    else:
        run_season(int(target), validate=validate)


if __name__ == "__main__":
    main()
