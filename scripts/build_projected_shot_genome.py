#!/usr/bin/env python3
"""build_projected_shot_genome.py — project each 2026-27 team's OFFENSE Shot Genome
(Look Quality, Shot-Making SM+, Creation) from its returning players' 2025-26 per-player
shot genome, weighted by projected role. Mirrors build_projected_dna.py:
  - returners = 2026-27 roster players (players table) whose espn_id has a 2025-26 genome
  - projected shot volume  = last FGA scaled by projected/last minutes
  - LookQ / Shot-Making    = projected-FGA-weighted average of per-player lq / smAdj
  - Creation (crAdjPg)     = sum of per-player per-game created xPts, role-scaled
Freshmen / players with no 2025-26 shot sample are excluded (no data to project), same as
the DNA projection. Output: scripts/data/shot_genome_projected.json = {"2027": {full_name:
{off:{lq,smAdj,pct:{lq,smAdj}}, crAdjPg, crPct, n, projected:true}}} — shaped to match what
team.html's Shot-Genome cards already read from shot_genome_teams.json.

    python3 scripts/build_projected_shot_genome.py
"""
import json, urllib.request, pathlib
from collections import defaultdict

D = pathlib.Path(__file__).parent / "data"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
K = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": K, "Authorization": "Bearer " + K}
MIN_RET = 3        # need at least this many returners with a shot sample to project
MIN_FGA = 150      # and a real combined shot volume


def _get(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(SB + path, headers=H), timeout=60))


def _paged(path):
    out, off = [], 0
    while True:
        b = json.load(urllib.request.urlopen(urllib.request.Request(
            SB + path + "&limit=1000&offset=%d" % off, headers=H), timeout=60))
        if not b:
            break
        out += b
        off += 1000
        if len(b) < 1000:
            break
    return out


def _pctl(vals):
    s = sorted(vals)
    n = len(s)
    def f(v):
        if n <= 1:
            return 50
        below = sum(1 for x in s if x < v)
        return round(100 * below / (n - 1))
    return f


def main():
    # per-player 2025-26 genome by espn_id
    gp = json.load(open(D / "shot_genome_players.json"))["players"]
    gen = {}
    for p in gp:
        if p.get("espn_id") is not None:
            gen[p["espn_id"]] = p

    # last-season minutes / games per player (to scale volume into a projected role)
    ph = _paged("/rest/v1/player_history?season_year=eq.2026&espn_id=not.is.null"
                "&select=espn_id,mpg,gp&order=espn_id.asc")
    lastMin = {r["espn_id"]: r for r in ph if r.get("espn_id") is not None}

    # 2026-27 rosters
    roster = _paged("/rest/v1/players?name=neq.%E2%80%94&select=team,espn_id,mpg,tdc_grade"
                    "&order=team.asc,espn_id.asc")
    byteam = defaultdict(list)
    for p in roster:
        byteam[p["team"]].append(p)

    # authoritative short->full name map (same one build_projected_dna uses) so the keys
    # match what team.html / the index look shot genome up by.
    s2f = {}
    try:
        pr = _get("/rest/v1/predictive_ratings?season=eq.2027&select=data&limit=1")
        for t in (pr[0]["data"]["teams"] if pr else []):
            if t.get("team") and t.get("full"):
                s2f[t["team"].lower()] = t["full"]
    except Exception as e:
        print("warn: no short->full map (%s)" % e)

    def grade_mpg(g):
        if g is None or g == "":
            return None
        g = float(g)
        return 26 if g >= 92 else 22 if g >= 88 else 15 if g >= 82 else 10 if g >= 78 else 6

    proj = {}
    for team, ros in byteam.items():
        wsum = 0.0
        lqw = smw = 0.0
        crpg = 0.0
        n = 0
        for p in ros:
            eid = p.get("espn_id")
            g = gen.get(eid) if eid is not None else None
            if not g or g.get("fga") is None:
                continue
            projm = p.get("mpg")
            if projm in (None, ""):
                projm = grade_mpg(p.get("tdc_grade"))
            if projm in (None, ""):
                continue
            projm = float(projm)
            lm = lastMin.get(eid) or {}
            last_mpg = lm.get("mpg") or projm
            last_gp = lm.get("gp") or 30
            try:
                last_mpg = float(last_mpg) or projm
            except Exception:
                last_mpg = projm
            scale = projm / max(6.0, last_mpg)          # role change vs last year
            scale = max(0.3, min(1.8, scale))            # bound so a role swing can't explode it
            projfga = (g["fga"] or 0) * scale
            if projfga <= 0:
                continue
            lqw += (g.get("lq") or 0) * projfga
            smw += (g.get("smAdj") or 0) * projfga
            wsum += projfga
            # per-game creation, role-scaled (crAdj is a season total of adjusted xPts)
            if g.get("crAdj") is not None:
                crpg += (g["crAdj"] / max(1, float(last_gp))) * scale
            n += 1
        if n < MIN_RET or wsum < MIN_FGA:
            continue
        full = s2f.get(team.lower()) or team
        proj[full] = {
            "off": {"lq": round(lqw / wsum, 1), "smAdj": round(smw / wsum, 2)},
            "crAdjPg": round(crpg, 1),
            "n": n, "projected": True,
        }

    # national percentiles across the projected field (cards show a percentile)
    lqf = _pctl([t["off"]["lq"] for t in proj.values()])
    smf = _pctl([t["off"]["smAdj"] for t in proj.values()])
    crf = _pctl([t["crAdjPg"] for t in proj.values()])
    for t in proj.values():
        t["off"]["pct"] = {"lq": lqf(t["off"]["lq"]), "smAdj": smf(t["off"]["smAdj"])}
        t["crPct"] = crf(t["crAdjPg"])

    out = {"2027": proj, "meta": {"projected": True,
           "note": "offense shot genome projected from returning players' 2025-26 per-player genome"}}
    json.dump(out, open(D / "shot_genome_projected.json", "w"), separators=(",", ":"))
    print("projected %d teams -> shot_genome_projected.json" % len(proj))
    for tm in ["Duke Blue Devils", "Houston Cougars", "Florida Gators", "Gonzaga Bulldogs"]:
        t = proj.get(tm)
        if t:
            print("  %-22s LookQ %s  SM %s (pct %s)  Creation %s (pct %s)  [%d returners]"
                  % (tm, t["off"]["lq"], t["off"]["smAdj"], t["off"]["pct"]["smAdj"],
                     t["crAdjPg"], t["crPct"], t["n"]))


if __name__ == "__main__":
    main()
