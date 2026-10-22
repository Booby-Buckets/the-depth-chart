#!/usr/bin/env python3
"""build_assist_web.py — who passes to whom: every assisted basket of a season, from ESPN play-by-play.

Per team:
  pairs     passer -> shooter: assists, points, and the shot it set up (rim / putback / mid / three)
  combos    distinct passer -> shooter pairs (and pairs with 3+ assists), and "effective combos" — the exponential
            of the entropy of the pair mix, i.e. how many equally-used pairs the passing behaves like
  shot combos  distinct passer -> shooter -> shot-type combinations used twice or more
  core      how much of the passing runs through one player (top-1 share), two players (top-2 share), the single
            busiest pair, and how many passers it takes to reach half the assists (1 = a one-man core)
Per player: assists, the teammates he feeds (distinct + effective), what shots he sets up, points created, and
how often his own baskets are assisted.

    python3 scripts/build_assist_web.py 2026         # play-by-play cached in scripts/data/espn_pbp_cache
Writes scripts/data/assist_web/<season>.json (+ index.json).
"""
import json, math, os, re, sys, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_fingerprint as F

OUT = os.path.join(F.D, "assist_web")
MIN_GAMES = 200
ZONES = ("rim", "put", "mid", "three")

def ent(counts):
    n = sum(counts)
    return math.exp(-sum(c / n * math.log(c / n) for c in counts if c)) if n else 0.0

def main():
    y = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    t0 = time.time()
    ts = F.sb(f"team_seasons?season_year=eq.{y}&select=team,team_id,conference&order=team_id.asc")
    d1 = {str(t["team_id"]): t for t in ts if t.get("conference")}
    games = [g for g in F.sb(f"games?season_year=eq.{y}&status=eq.STATUS_FINAL&select=id,home_id,away_id&order=id.asc")
             if str(g["home_id"]) in d1 or str(g["away_id"]) in d1]
    with ThreadPoolExecutor(8) as ex: S = list(ex.map(lambda g: F.summary(g["id"]), games))
    S = [s for s in S if s and s.get("plays")]
    if len(S) < MIN_GAMES:
        print(f"{y}: {len(S)} games with play-by-play — fewer than {MIN_GAMES}, not built yet", file=sys.stderr); return
    PAIR = defaultdict(lambda: defaultdict(lambda: [0, 0, {z: 0 for z in ZONES}]))   # team -> (passer, shooter) -> [ast, pts, zones]
    PL = defaultdict(lambda: defaultdict(float)); NM = {}; TM = {}; GP = defaultdict(set)
    for s in S:
        x = F.parse(s)
        if not x: continue
        teams, mins, names, plays = x
        gid = (s.get("header") or {}).get("id")
        for t in teams:
            for pid in mins[t]: TM[pid] = t; NM[pid] = names.get(pid); GP[pid].add(gid)
        for p in plays:
            tid = str((p.get("team") or {}).get("id") or ""); tl = (p.get("text") or "").lower()
            is_ft = "free throw" in tl or "FreeThrow" in p["type"]["text"]
            pa = F.shot_value(p, tl, is_ft)
            if not pa or tid not in d1 or not p.get("scoringPlay"): continue
            parts = [str(a["athlete"]["id"]) for a in p.get("participants") or [] if a.get("athlete")]
            if not parts: continue
            sh = parts[0]; z = F.zone(p, pa)
            PL[sh]["fgm"] += 1; PL[sh]["pts"] += pa
            if len(parts) > 1 and "assist" in tl:
                ps = parts[1]
                c = PAIR[tid][(ps, sh)]; c[0] += 1; c[1] += pa; c[2][z] += 1
                PL[ps]["ast"] += 1; PL[ps]["created"] += pa; PL[ps]["az_" + z] += 1
                PL[sh]["astd"] += 1
    teams_out, players_out = {}, {}
    for tid, pairs in PAIR.items():
        full = d1[tid]["team"]
        tot = sum(c[0] for c in pairs.values())
        if tot < 50: continue
        by_p = defaultdict(int)
        for (ps, sh), c in pairs.items(): by_p[ps] += c[0]
        ranked = sorted(by_p.values(), reverse=True)
        core50, acc = 0, 0
        for v in ranked:
            core50 += 1; acc += v
            if acc >= tot / 2: break
        pc = [c[0] for c in pairs.values()]
        triples = sum(1 for c in pairs.values() for z in ZONES if c[2][z] >= 2)
        ids = set(p for k in pairs for p in k)
        fgm = sum(PL[p]["fgm"] for p in ids if TM.get(p) == tid)
        teams_out[full] = {
            "id": tid, "ast": tot, "fgm": round(fgm), "assisted_rate": round(tot / fgm, 3) if fgm else None,
            "combos": len(pairs), "combos3": sum(1 for v in pc if v >= 3), "eff_combos": round(ent(pc), 1), "shot_combos": triples,
            "top1": round(ranked[0] / tot, 3), "top2": round(sum(ranked[:2]) / tot, 3), "top_pair": round(max(pc) / tot, 3), "core50": core50,
            "passers": len(by_p),
            "players": {p: NM.get(p) for p in ids},
            "pairs": sorted([[ps, sh, c[0], c[1], [c[2][z] for z in ZONES]] for (ps, sh), c in pairs.items()], key=lambda r: -r[2]),
        }
        for (ps, sh), c in pairs.items():
            if TM.get(ps) == tid:
                o = players_out.setdefault(ps, {"n": NM.get(ps), "t": full, "g": len(GP[ps]), "tg": defaultdict(int)})
                o["tg"][sh] += c[0]
    for pid, o in players_out.items():
        P = PL[pid]; tg = o.pop("tg")
        o.update({"ast": int(P["ast"]), "created": int(P["created"]), "targets": len(tg), "eff_targets": round(ent(list(tg.values())), 1),
                  "zones": [int(P["az_" + z]) for z in ZONES], "fgm": int(P["fgm"]), "astd": int(P["astd"]),
                  "top_target": NM.get(max(tg, key=tg.get)) if tg else None, "top_share": round(max(tg.values()) / max(1, sum(tg.values())), 3) if tg else None})
    os.makedirs(OUT, exist_ok=True)
    doc = {"season": y, "built": time.strftime("%Y-%m-%d"), "games": len(S), "zones": list(ZONES), "teams": teams_out,
           "players": {k: v for k, v in players_out.items() if v["ast"] >= 15}}
    json.dump(doc, open(os.path.join(OUT, f"{y}.json"), "w"), separators=(",", ":"))
    yrs = sorted((int(f[:4]) for f in os.listdir(OUT) if re.fullmatch(r"\d{4}\.json", f)), reverse=True)
    json.dump({"seasons": yrs}, open(os.path.join(OUT, "index.json"), "w"))
    print(f"assist web {y}: {len(S)} games, {len(teams_out)} teams, {len(doc['players'])} passers, {time.time() - t0:.0f}s", file=sys.stderr)

if __name__ == "__main__":
    main()
