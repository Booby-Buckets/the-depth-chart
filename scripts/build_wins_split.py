#!/usr/bin/env python3
"""build_wins_split.py — OWNED Offensive & Defensive Wins Added, from box_scores.

OWA = the OFFENSIVE slice of TI (pts/ast/oreb/misses/tov), run through the same
      above-replacement × volume ÷ points-per-win conversion as Wins Added.
DWA = Dean Oliver's DEFENSIVE Win Shares math (individual Defensive Rating from
      stops + team defense), computed from our owned player/team/opponent box
      aggregates. Validated here against bbref's real DWS to confirm faithfulness.

Per your spec: OWA + DWA do NOT have to sum to WA (each is its own calibrated read;
intangibles + regression mean the parts don't reconcile — that's honest).

Usage: python3 build_wins_split.py [season]   (default 2025, with bbref validation)
"""
import os, sys, math, importlib.util
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
_CLI = sys.argv[1:]
sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location("ds", os.path.join(HERE, "derived_stats.py"))
ds = importlib.util.module_from_spec(spec); spec.loader.exec_module(ds)   # reuse aggregate()/poss()
ag = ds.ag

# OWA calibration (set to match bbref OWS median; tuned below per season pool)
OWA_REPL = 3.0      # replacement offensive TI/40
OWA_PPW = 60.0      # points-per-win for the offensive slice (recalibrated at runtime)


def team_games(t):
    return (t["min"] / 200.0) if t.get("min") else 0   # college: 5*40=200 player-min per game


def owa_of(a):
    # offensive TI slice
    ti = (1.0 * a["pts"] + 0.8 * a["oreb"] + 0.7 * a["ast"]
          - 0.5 * (a["fga"] - a["fgm"]) - 0.35 * (a["fta"] - a["ftm"]) - 1.0 * a["tov"])
    ti40 = ti * 40.0 / (a["min"] + 100.0)
    return (ti40 - OWA_REPL) * (a["min"] / 40.0)   # raw; divide by PPW after calibration


def dwa_components(a, t, o, lg):
    """Oliver DWS for one player. a=player, t=team, o=opponent-allowed, lg=league dict."""
    MP = a["min"]
    Tm_MP = t["min"]
    if MP < 1 or Tm_MP < 1:
        return None
    Tm_DefPoss = ds.poss(o)                      # opponent possessions = team defensive poss
    if Tm_DefPoss <= 0:
        return None
    # rates from opponent (what the team allowed) + team defensive boards
    DORp = o["oreb"] / (o["oreb"] + t["dreb"]) if (o["oreb"] + t["dreb"]) > 0 else 0
    DFGp = o["fgm"] / o["fga"] if o["fga"] > 0 else 0
    denom = DFGp * (1 - DORp) + (1 - DFGp) * DORp
    FMwt = (DFGp * (1 - DORp)) / denom if denom > 0 else 0
    Stops1 = a["stl"] + a["blk"] * FMwt * (1 - 1.07 * DORp) + a["dreb"] * (1 - FMwt)
    ftmiss = (1 - (o["ftm"] / o["fta"])) ** 2 if o["fta"] > 0 else 0
    Stops2 = ((((o["fga"] - o["fgm"] - t["blk"]) / Tm_MP) * FMwt * (1 - 1.07 * DORp)
              + ((o["tov"] - t["stl"]) / Tm_MP)) * MP
             + (a["pf"] / t["pf"] if t["pf"] > 0 else 0) * 0.4 * o["fta"] * ftmiss)
    Stops = Stops1 + Stops2
    Stopp = (Stops * Tm_MP) / (Tm_DefPoss * MP) if (Tm_DefPoss * MP) > 0 else 0
    Tm_DRtg = 100.0 * o["pts"] / Tm_DefPoss
    scposs = o["fgm"] + (1 - ftmiss) * o["fta"] * 0.4
    DPtsPerScPoss = o["pts"] / scposs if scposs > 0 else 1.0
    DRtg = Tm_DRtg + 0.2 * (100 * DPtsPerScPoss * (1 - Stopp) - Tm_DRtg)
    # marginal defense (Oliver): player share of team def-poss, vs a baseline 1.08x league
    marg_def = (MP / Tm_MP) * Tm_DefPoss * (1.08 * lg["pts_per_poss"] - DRtg / 100.0)
    Tm_pace = ds.poss(t) / team_games(t) if team_games(t) else lg["pace"]
    mpw = 0.32 * lg["pts_per_g"] * (Tm_pace / lg["pace"]) if lg["pace"] else 1.0
    dws = marg_def / mpw if mpw else 0
    return {"drtg": DRtg, "dwa": dws}


def run(season, validate=True):
    cols = "espn_id,player,team,opp,min,pts,fga,fgm,fta,ftm,tpa,tpm,oreb,dreb,reb,ast,stl,blk,tov,pf"
    print(f"[{season}] fetching box_scores…")
    rows = ag.get(f"box_scores?season_year=eq.{season}", cols)
    P, T, O, NAME, PTEAM = ds.aggregate(rows)
    # league aggregates
    lg_poss = sum(ds.poss(t) for t in T.values())
    lg_pts = sum(t["pts"] for t in T.values())
    lg_g = sum(team_games(t) for t in T.values())
    lg = {"pts_per_poss": lg_pts / lg_poss if lg_poss else 1.0,
          "pts_per_g": lg_pts / lg_g if lg_g else 70.0,
          "pace": lg_poss / lg_g if lg_g else 68.0}
    print(f"[{season}] league: {lg['pts_per_poss']:.3f} pts/poss, {lg['pts_per_g']:.1f} pts/g, pace {lg['pace']:.1f}")

    out = {}
    for eid, a in P.items():
        tm = PTEAM.get(eid); t = T.get(tm); o = O.get(tm)
        if not t or not o or a["min"] < 40:
            continue
        d = dwa_components(a, t, o, lg)
        out[str(eid)] = {"owa_raw": owa_of(a), "dwa": d["dwa"] if d else None, "min": a["min"], "name": NAME.get(eid)}

    # calibrate OWA_PPW so median owa ≈ bbref OWS median (fetched below), else 0.5
    import statistics
    if validate:
        bb = ag.get(f"bbref_seasons?select=espn_id,advanced&season_year=eq.{season}&espn_id=not.is.null", "")
        bows, bdws = {}, {}
        for b in bb:
            adv = b.get("advanced") or {}
            try:
                if adv.get("ows") not in (None, ""): bows[str(b["espn_id"])] = float(adv["ows"])
                if adv.get("dws") not in (None, ""): bdws[str(b["espn_id"])] = float(adv["dws"])
            except (TypeError, ValueError): pass
        # DWA vs bbref DWS
        pairs = [(out[e]["dwa"], bdws[e]) for e in out if e in bdws and out[e]["dwa"] is not None]
        if pairs:
            xs, ys = zip(*pairs); n = len(xs)
            mx, my = sum(xs)/n, sum(ys)/n
            sxy = sum((xs[i]-mx)*(ys[i]-my) for i in range(n))
            sxx = sum((x-mx)**2 for x in xs); syy = sum((y-my)**2 for y in ys)
            r = sxy/math.sqrt(sxx*syy) if sxx*syy > 0 else 0
            b_d = sxy/sxx; a_d = my - b_d*mx   # linear map mine -> bbref DWS scale
            print(f"[{season}] DWA vs bbref DWS: n={n} r={r:.3f} | mine median={statistics.median(xs):.2f} bbref median={statistics.median(ys):.2f} | mean {mx:.2f} vs {my:.2f}")
            print(f"[{season}]   DWA calibration to DWS scale: dwa_cal = {a_d:.3f} + {b_d:.3f}*dwa_raw")
            print("  top DWA (mine) vs their DWS:")
            for e in sorted(out, key=lambda e: -(out[e]['dwa'] or -9))[:6]:
                print(f"    {out[e]['name'][:22]:22} mine {out[e]['dwa']:.2f}  bbref {bdws.get(e,'—')}")
        # OWA calibration to bbref OWS median + correlation
        owsmed = statistics.median(list(bows.values())) if bows else 0.5
        raw = sorted(out[e]["owa_raw"] for e in out)
        rawmed = raw[len(raw)//2] or 1.0
        ppw = rawmed/owsmed if owsmed else 60.0
        op = [(out[e]["owa_raw"]/ppw, bows[e]) for e in out if e in bows]
        if op:
            xs, ys = zip(*op); n = len(xs); mx, my = sum(xs)/n, sum(ys)/n
            sxy = sum((xs[i]-mx)*(ys[i]-my) for i in range(n))
            sxx = sum((x-mx)**2 for x in xs); syy = sum((y-my)**2 for y in ys)
            r = sxy/math.sqrt(sxx*syy) if sxx*syy > 0 else 0
            # linear map from raw offensive-TI-slice -> bbref OWS scale
            raws=[out[e]["owa_raw"] for e in out if e in bows]; ows=[bows[e] for e in out if e in bows]
            mrx=sum(raws)/len(raws); mry=sum(ows)/len(ows)
            srxy=sum((raws[i]-mrx)*(ows[i]-mry) for i in range(len(raws))); srxx=sum((x-mrx)**2 for x in raws)
            b_o=srxy/srxx; a_o=mry-b_o*mrx
            print(f"[{season}] OWA vs bbref OWS: n={n} r={r:.3f} | mine median={statistics.median(xs):.2f} bbref={owsmed:.2f}")
            print(f"[{season}]   OWA calibration to OWS scale: owa_cal = {a_o:.3f} + {b_o:.5f}*owa_raw")
            for e in sorted(out, key=lambda e: -out[e]['owa_raw'])[:5]:
                print(f"    {out[e]['name'][:22]:22} OWA {out[e]['owa_raw']/ppw:.2f}  bbref OWS {bows.get(e,'—')}")


if __name__ == "__main__":
    run(int(_CLI[0]) if _CLI else 2025)
