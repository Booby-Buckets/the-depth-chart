#!/usr/bin/env python3
"""build_fingerprint_splits.py — "How he plays when…": the Skill Fingerprint (build_fingerprint.py) cut by situation.

Four splits, each two sides, every side a full 15-skill fingerprint in points per 100 possessions:
  close   close and late (2nd half / OT, last 5:00, within 5) vs the rest — needs who is on the floor, so only games
          whose play-by-play logs substitutions (nearly all of 2025-26, ~a quarter of 2024-25); possessions and
          team defense come from the five on the floor
  opp     vs top-50 teams (our own schedule-adjusted net rating, team_dna.json) vs the rest
  pace    faster vs slower than his own team usually plays (game possessions vs the team's median)
  venue   home vs road (neutral sites left out)
The game-level splits use exactly the main model (credits per game, possessions and team defense by minutes).
Every side is pulled toward the player's whole season by SHRINK possessions (a 60-possession clutch sample alone
says little), and each split carries the league's typical change, so the page can say whether a player moves MORE
than players usually do in that situation.

    python3 scripts/build_fingerprint_splits.py 2026      # after build_fingerprint.py for the same season
Writes scripts/data/fingerprint/splits_<season>.json.
"""
import json, os, sys, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_fingerprint as F

SHRINK = 150.0
SPLITS = [("close", "Close and late", "Rest of the game"), ("opp", "vs top-50 teams", "vs the rest"),
          ("pace", "Faster games", "Slower games"), ("venue", "Home", "Road")]
KEYS = [k for k, _, _ in F.SKILLS]
OFF = F.OFF

def main():
    y = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    t0 = time.time()
    fp = os.path.join(F.OUT, f"{y}.json")
    if not os.path.exists(fp): print(f"no fingerprint for {y} yet — splits skipped", file=sys.stderr); return
    base = json.load(open(fp))
    B, L = base["B"], base["league"]
    ts = F.sb(f"team_seasons?season_year=eq.{y}&select=team,team_id,conference&order=team_id.asc")
    d1 = {str(t["team_id"]): t for t in ts if t.get("conference")}
    dna = (json.load(open(os.path.join(F.D, "team_dna.json"))).get(str(y)) or {}).get("teams") or {}
    games = [g for g in F.sb(f"games?season_year=eq.{y}&status=eq.STATUS_FINAL&select=id&order=id.asc")]
    with ThreadPoolExecutor(8) as ex: S = list(ex.map(lambda g: F.summary(g["id"]), games))
    S = [s for s in S if s and s.get("plays")]
    full = {tid: t["team"] for tid, t in d1.items()}
    rate = lambda t, k: (dna.get(full[t]) or {}).get("adj" + k[0]) if (dna.get(full[t]) or {}).get("adj" + k[0]) is not None else (dna.get(full[t]) or {}).get(k + "Rtg")
    adjO = {tid: rate(tid, "O") for tid in d1 if rate(tid, "O") is not None}
    adjD = {tid: rate(tid, "D") for tid in d1 if rate(tid, "D") is not None}
    lgO = sum(adjO.values()) / max(1, len(adjO)); lgD = sum(adjD.values()) / max(1, len(adjD))
    netOf = lambda t: (dna[full[t]].get("adjNet") if dna[full[t]].get("adjNet") is not None else dna[full[t]].get("net", -99))
    net = sorted(((netOf(t), t) for t in d1 if full[t] in dna), reverse=True)
    top50 = {t for _, t in net[:50]}

    G = []
    for s in S:
        x = F.parse(s)
        if not x: continue
        teams, mins, names, plays = x
        comp = s["header"]["competitions"][0]
        ha = {str(c["id"]): c.get("homeAway") for c in comp["competitors"]}
        G.append((teams, mins, names, plays, ha, bool(comp.get("neutralSite"))))
    # each team's median game possessions (for faster / slower than it usually plays)
    pace = defaultdict(list); POSS = {}
    for gi, (teams, mins, names, plays, ha, neu) in enumerate(G):
        rows, cnt = F.tally(plays, teams, L)
        p = sum(cnt[t]["fga"] - cnt[t]["oreb"] + cnt[t]["tov"] + 0.44 * cnt[t]["fta"] for t in teams) / 2.0
        POSS[gi] = p
        for t in teams: pace[t].append(p)
    med = {t: sorted(v)[len(v) // 2] for t, v in pace.items()}

    # V[split][side][pid][skill] = points ; P[split][side][pid] = possessions
    V = {k: [defaultdict(lambda: defaultdict(float)) for _ in range(2)] for k, _, _ in SPLITS}
    P = {k: [defaultdict(float) for _ in range(2)] for k, _, _ in SPLITS}
    tracked = 0
    for gi, (teams, mins, names, plays, ha, neu) in enumerate(G):
        other = {teams[0]: teams[1], teams[1]: teams[0]}
        rows, cnt = F.tally(plays, teams, L)
        for t in teams:
            if t not in d1: continue
            o = other[t]
            B_off = B + ((adjD.get(o, lgD) - lgD) / 100.0 if o in d1 else 0.0)
            B_def = B + ((adjO.get(o, lgO) - lgO) / 100.0 if o in d1 else 0.0)
            sides = {"opp": 0 if o in top50 else 1,
                     "pace": 0 if POSS[gi] > med.get(t, POSS[gi]) else 1,
                     "venue": None if neu else (0 if ha.get(t) == "home" else 1)}
            c = cnt[t]; poss = c["fga"] - c["oreb"] + c["tov"] + 0.44 * c["fta"]
            tm = sum(mins[t].values()) or 200.0
            g = defaultdict(lambda: defaultdict(float))
            for (ot, pid, sk, a, b, isd) in rows:
                if ot == t and not isd and pid and sk[0] != "_": g[pid][sk] += a + b * B_off
            tot = sum(-(a + b * B_def) for (ot, pid, sk, a, b, isd) in rows if ot == o and not isd)
            carved = 0.0
            for (ot, pid, sk, a, b, isd) in rows:
                if ot == o and isd and pid in mins[t]:
                    v = a + b * B_def; g[pid][sk] += v; carved += v
            for pid, m in mins[t].items(): g[pid]["team"] += (tot - carved) * m / tm
            for sp, sd in sides.items():
                if sd is None: continue
                for pid, m in mins[t].items():
                    P[sp][sd][pid] += poss * m / (tm / 5.0)
                    for k, v in g[pid].items(): V[sp][sd][pid][k] += v
        # close and late: only games that log substitutions (who is on the floor)
        st = names.get("_starters") or {}
        if sum(p["type"]["text"] == "Substitution" for p in plays) < 20 or any(len(st.get(t, [])) != 5 for t in teams): continue
        tracked += 1
        rows, cnt, ctx = F.tally(plays, teams, L, lineup=st)
        for t in teams:
            if t not in d1: continue
            o = other[t]; ti, oi = teams.index(t), teams.index(o)
            B_off = B + ((adjD.get(o, lgD) - lgD) / 100.0 if o in d1 else 0.0)
            B_def = B + ((adjO.get(o, lgO) - lgO) / 100.0 if o in d1 else 0.0)
            for (ot, pid, sk, a, b, isd), cx in zip(rows, ctx):
                sd = 0 if cx[2] else 1
                if ot == t and not isd:                     # t's offense: credits + possessions for the five on
                    for q in cx[ti]: P["close"][sd][q] += -b * 0.5      # half a possession's weight on each end
                    if pid and sk[0] != "_": V["close"][sd][pid][sk] += a + b * B_off
                elif ot == o and not isd:                   # t's defense: the five on share the stop / the score
                    v = -(a + b * B_def); fl = cx[ti]
                    for q in fl:
                        P["close"][sd][q] += -b * 0.5; V["close"][sd][q]["team"] += v / max(1, len(fl))
                elif ot == o and isd and pid:               # carve-outs come out of the five's share
                    v = a + b * B_def; fl = cx[ti]
                    V["close"][sd][pid][sk] += v
                    for q in fl: V["close"][sd][q]["team"] -= v / max(1, len(fl))
    print(f"{y}: {len(G)} games, {tracked} with substitutions (close-and-late split)", file=sys.stderr)

    players = {}
    allp = base["players"]
    lg = {k: [[0.0] * (len(KEYS) + 1) for _ in range(2)] for k, _, _ in SPLITS}   # possession-weighted league rates
    for pid, r in allp.items():
        if not r.get("q"): continue
        out = {}
        for sp, _, _ in SPLITS:
            pair = []
            for sd in range(2):
                ps = P[sp][sd].get(pid, 0.0)
                vv = [round(100.0 * (V[sp][sd][pid].get(k, 0.0) + SHRINK * r["v"][i] / 100.0) / (ps + SHRINK), 2) for i, k in enumerate(KEYS)]
                o = round(sum(v for k, v in zip(KEYS, vv) if k in OFF), 2); d = round(sum(vv) - o, 2)
                pair.append([round(ps)] + [o, d, round(o + d, 2)] + vv)
                if ps > 0:
                    w = lg[sp][sd]; w[0] += ps
                    for i in range(len(KEYS)): w[i + 1] += ps * 100.0 * V[sp][sd][pid].get(KEYS[i], 0.0) / max(ps, 1e-9)
            out[sp] = pair
        players[pid] = out
    league = {}
    for sp, _, _ in SPLITS:
        sides = []
        for sd in range(2):
            w = lg[sp][sd]; vv = [round(w[i + 1] / max(1, w[0]), 2) for i in range(len(KEYS))]
            o = round(sum(v for k, v in zip(KEYS, vv) if k in OFF), 2); d = round(sum(vv) - o, 2)
            sides.append([o, d, round(o + d, 2)] + vv)
        league[sp] = sides
    doc = {"season": y, "built": time.strftime("%Y-%m-%d"), "shrink": SHRINK, "tracked_games": tracked, "games": len(G),
           "splits": [{"k": k, "a": a, "b": b} for k, a, b in SPLITS], "skills": KEYS,
           "cols": "poss, off, def, total, then the 15 skills (points per 100)", "league": league, "players": players}
    json.dump(doc, open(os.path.join(F.OUT, f"splits_{y}.json"), "w"), separators=(",", ":"))
    F.write_index()
    print(f"splits {y}: {len(players)} players, {time.time() - t0:.0f}s", file=sys.stderr)

if __name__ == "__main__":
    main()
