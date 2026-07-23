#!/usr/bin/env python3
"""
build_passing_network.py — each team's passing web from the shot data.

We log who ASSISTED each made shot (shots.ast_id) and who took it (shots.espn_id),
so we can reconstruct a team's passing network: nodes = players, edges = assister
-> shooter, weighted by count and by the expected points of the look created.

Also a team CONNECTIVITY score = how spread-out the creation is (0 = one player
sets up everyone / star-dependent, 100 = everyone creates / egalitarian ball
movement), from the normalized entropy of the assist-by-creator distribution.

Current season only (2026 has ~96% shot coverage). Reads shots (anon key). Writes
  data/passing_network.json  { <full team>: {nodes, edges, connectivity, assistedPct, nAst} }

  python3 scripts/build_passing_network.py
"""
import json, os, math, urllib.request, urllib.parse
from collections import defaultdict

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
OUT = os.path.join(os.path.dirname(__file__), os.pardir, "data")
SEASON = 2026
TOP_EDGES = 22      # keep the busiest passing lanes per team
BASE = {"rim": .615, "paint": .395, "mid": .375, "corner3": .385, "atb3": .345}


def get(path):
    out = []; frm = 0
    while True:
        h = {**HDR, "Range-Unit": "items", "Range": "%d-%d" % (frm, frm + 999)}
        b = json.load(urllib.request.urlopen(urllib.request.Request(SB + "/rest/v1/" + path, headers=h), timeout=90))
        out += b
        if len(b) < 1000: break
        frm += 1000
    return out


def zone(s):
    if s.get("sv") == 3: return "corner3" if (s.get("y") or 99) <= 10 else "atb3"
    d = s.get("dist")
    if d is None or d <= 4: return "rim"
    if d <= 9: return "paint"
    return "mid"


def xpts(s):
    return BASE[zone(s)] * (3 if s.get("sv") == 3 else 2)


def main():
    print("Passing Network — %d" % SEASON, flush=True)
    teams = {t["team_id"]: t["team"] for t in
             get("team_seasons?season_year=eq.%d&select=team_id,team&team_id=not.is.null" % SEASON)}
    name_of = {}
    for r in get("bbref_seasons?season_year=eq.%d&espn_id=not.is.null&select=espn_id,player" % SEASON):
        name_of[r["espn_id"]] = r["player"]

    out = {}
    for tid, full in teams.items():
        sh = get("shots?season_year=eq.%d&team_id=eq.%d&select=espn_id,made,sv,dist,y,ast_id,ast_name" % (SEASON, tid))
        made = [s for s in sh if s.get("made")]
        assisted = [s for s in made if s.get("ast_id") and s.get("espn_id")]
        if len(assisted) < 40: continue
        # edges (assister -> shooter) and per-player creation / receiving
        edge = defaultdict(lambda: {"n": 0, "xp": 0.0})
        created = defaultdict(int); received = defaultdict(int)
        nm = {}
        for s in assisted:
            a, r = s["ast_id"], s["espn_id"]
            e = edge[(a, r)]; e["n"] += 1; e["xp"] += xpts(s)
            created[a] += 1; received[r] += 1
            nm[a] = s.get("ast_name") or name_of.get(a, "—")
            nm[r] = name_of.get(r, "—")
        # connectivity = normalized entropy of the creation distribution
        tot = sum(created.values()) or 1
        H = -sum((c / tot) * math.log(c / tot) for c in created.values() if c > 0)
        Hmax = math.log(len(created)) if len(created) > 1 else 1
        connectivity = round(100 * (H / Hmax if Hmax > 0 else 0), 0)
        # nodes: everyone who created or received, with involvement = created+received
        ids = set(created) | set(received)
        nodes = sorted(({"espn": i, "name": nm.get(i, name_of.get(i, "—")),
                         "cr": created.get(i, 0), "rc": received.get(i, 0)} for i in ids),
                       key=lambda n: -(n["cr"] + n["rc"]))[:11]
        keep = {n["espn"] for n in nodes}
        edges = sorted(({"f": a, "t": r, "n": e["n"], "xp": round(e["xp"], 1)}
                        for (a, r), e in edge.items() if a in keep and r in keep),
                       key=lambda e: -e["n"])[:TOP_EDGES]
        out[full] = {"nodes": nodes, "edges": edges, "connectivity": connectivity,
                     "assistedPct": round(100 * len(assisted) / len(made), 0),
                     "nAst": len(assisted)}

    # connectivity percentile
    vals = sorted(v["connectivity"] for v in out.values())
    n = len(vals)
    for v in out.values():
        v["connPct"] = round(100 * sum(1 for x in vals if x < v["connectivity"]) / n) if n else 50

    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, "passing_network.json"), "w"), separators=(",", ":"))
    print("  wrote %d teams" % len(out), flush=True)

    rank = sorted(out.items(), key=lambda kv: -kv[1]["connectivity"])
    print("\n  MOST connected (egalitarian ball movement):")
    for t, v in rank[:6]:
        print("    conn %3d · %2d%% assisted · %-24s top creator: %s" %
              (v["connectivity"], v["assistedPct"], t, v["nodes"][0]["name"] if v["nodes"] else "?"))
    print("\n  MOST star-dependent creation:")
    for t, v in rank[-6:]:
        topcr = max(v["nodes"], key=lambda x: x["cr"]) if v["nodes"] else None
        print("    conn %3d · %-24s hub: %s (%d assists)" %
              (v["connectivity"], t, topcr["name"] if topcr else "?", topcr["cr"] if topcr else 0))


if __name__ == "__main__":
    main()
