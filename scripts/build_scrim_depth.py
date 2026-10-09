#!/usr/bin/env python3
"""Scrimmage depth charts: re-order each team's 2026-27 depth chart from who actually started and played in
its preseason scrimmages (owner, Oct 2026: "those will be the true depth charts for those games unless there
are injuries" — not the final word, but the best early look at the coach's real rotation).

For every team with a scored scrimmage box (scrim_reality.py):

  1. Each scrimmage is turned into a role ladder: starters first, then by minutes. The k-th rung is worth the
     k-th biggest projected minute load on that roster, so a 40-point blowout's flattened minutes don't read
     as a demotion — only the ORDER the coach used counts.
  2. That scrimmage role is blended with the current projection, the blend weight growing with how game-like
     the scrimmages were (Reality Meter) and how little we know about the roster:
         a = R / (R + PRIOR),  R = sum of reality/100,  PRIOR = 0.1 + 1.2 x known   (capped at A_CAP)
     known = share of the projected minutes held by players who played for THIS team last season
     (a transfer with D-I data counts half). A Belmont-type roster rebuilt from the portal listens harder.
  3. Starters = the five best by (1-a)·[projected starter] + a·[share of scrimmages started], ties by the
     blended minutes; the bench is ordered by the blended minutes.

Injuries: a projected STARTER who did not play is treated as no evidence (rest / injury far more often than
a benching) and flagged for review; a bench player who sat counts as 0 minutes at half weight. Players with
an owner injury flag (players.is_injured) keep their slot. Teams whose depth chart the owner set by hand
AFTER their latest scrimmage are left alone.

Writes scripts/data/scrim_depth_2027.json (the report) and scripts/scrim_depth_2027.sql — the owner runs the
SQL in the Supabase editor (it stamps depth_set_at, so the sheet sync keeps the new order), then the
rebuild-projections job re-projects minutes and lines from the new charts.

    python3 scripts/build_scrim_depth.py          # report + SQL
"""
import json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import scrim_reality as sr

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "scripts" / "data"
A_CAP = 0.85
MIN_REALITY = 50          # an "Experimental"/"Practice-like" scrimmage says little about the real rotation
nk = sr.nk


def main():
    R = json.load(open(DATA / "scrimmage_results_2027.json"))["results"]
    G = {g["id"]: g for g in json.load(open(DATA / "scrimmages_2027.json"))["games"]}
    SOP = json.load(open(DATA / "stat_overall_projected.json"))["players"]
    FRESH = json.load(open(DATA / "fresh_fit.json"))
    pr = sr.get("predictive_ratings?select=data&season=eq.2027")
    SHORT = {t["full"]: t["team"] for t in pr[0]["data"]["teams"]} if pr else {}

    # every usable scrimmage side, grouped by team
    ev = {}
    for gid, r in R.items():
        g = G.get(gid); rl = r.get("reality") or {}
        if not g: continue
        for sd in ("home", "away"):
            bx = (r.get("box") or {}).get(sd) or {}; rs = rl.get(sd) or {}
            if bx.get("partial") or rs.get("boxless") or (rs.get("score") or 0) < MIN_REALITY: continue
            ps = [p for p in bx.get("players") or [] if (p.get("min") or 0) > 0]
            if len(ps) < 8: continue
            ev.setdefault(g[sd], []).append({"id": gid, "date": g["date"], "rw": rs["score"] / 100, "players": ps, "dnp": rs.get("dnp") or []})

    # the BASELINE per team (the chart + projected minutes before any scrimmage re-order), kept across runs so
    # each run re-blends ALL scrimmages from the same starting point instead of stacking on its own last result
    prev = {}
    try: prev = json.load(open(DATA / "scrim_depth_2027.json")).get("teams") or {}
    except Exception: pass
    report, sql = {}, []
    for full, games in sorted(ev.items()):
        short = SHORT.get(full)
        if not short: continue
        roster = sr.get(f"players?select=id,name,espn_id,depth_order,depth_set_at,is_injured,is_addition"
                        f"&team=eq.{re.sub(' ', '%20', short)}&order=depth_order.asc.nullslast,id.asc")
        if len(roster) < 5: continue
        last_game = max(x["date"] for x in games)
        ff = FRESH.get(short) or {}
        for p in roster:
            s = SOP.get(str(p["espn_id"])) if p.get("espn_id") else None
            p["proj"] = float((s or {}).get("mpg") or (ff.get(p["name"]) or {}).get("mpg") or 0)
            p["xfer"] = bool((s or {}).get("xfer")) if s else None   # None = no D-I data (freshman / unknown)
            p["k"] = nk(p["name"])
        cur_ids = [p["id"] for p in roster if p["depth_order"]]
        pv = prev.get(short) or {}
        base = {b["id"]: b for b in pv.get("base") or []}
        ours = cur_ids == pv.get("proposed") or (base and cur_ids == [i for i, _ in sorted(((b["id"], b["depth"]) for b in base.values() if b["depth"]), key=lambda t: t[1])])
        if base and ours:
            # the DB holds our last proposal (or the untouched baseline): blend from the saved baseline
            for p in roster:
                b = base.get(p["id"])
                if b: p["depth_order"], p["proj"] = b["depth"], b["proj"]
                else: p["depth_order"] = None          # added to the roster since: bench, by minutes
            owner_after = False
        else:
            # first look at this team, or the owner re-ordered it since: the current chart is the new baseline —
            # unless the owner set it by hand after the latest scrimmage, in which case the owner's chart stands
            owner_after = max((p["depth_set_at"] or "")[:10] for p in roster) > last_game
            base = {p["id"]: {"id": p["id"], "name": p["name"], "depth": p["depth_order"], "proj": round(p["proj"], 1)} for p in roster}
        curve = sorted((p["proj"] for p in roster), reverse=True)
        tot = sum(curve) or 1
        known = sum(p["proj"] * (1 if p["xfer"] is False and not p["is_addition"] else 0.5 if p["xfer"] is not None else 0) for p in roster) / tot
        prior = 0.1 + 1.2 * known
        Rw = sum(x["rw"] for x in games)
        a = min(A_CAP, Rw / (Rw + prior))
        cur_st = {p["k"] for p in roster if p["depth_order"] and p["depth_order"] <= 5}
        byk = {p["k"]: p for p in roster}
        # map box names onto the roster (box spellings drift)
        names = [p["name"] for p in roster]
        for p in roster: p.update(sw=0.0, sm=0.0, ss=0.0, gp=0, gs=0, dnp=0)
        unmatched = set()
        for x in games:
            ladder = sorted(x["players"], key=lambda q: (not q.get("gs"), -(q.get("min") or 0)))
            seen = set()
            for k, q in enumerate(ladder):
                rn = sr.roster_name(q["name"], names)
                p = byk.get(nk(rn)) if rn else None
                if not p: unmatched.add(q["name"]); continue
                seen.add(p["k"])
                p["sw"] += x["rw"]; p["sm"] += x["rw"] * (curve[k] if k < len(curve) else 0.0)
                p["ss"] += x["rw"] * (1.0 if q.get("gs") else 0.0); p["gp"] += 1; p["gs"] += 1 if q.get("gs") else 0
            for p in roster:
                if p["k"] in seen: continue
                p["dnp"] += 1
                if p["is_injured"] or p["k"] in cur_st: continue      # sat: injury / rest — no evidence
                p["sw"] += 0.5 * x["rw"]                              # a bench player who sat: 0 minutes, half weight
        for p in roster:
            if p["sw"] > 0:
                s_m, s_s = p["sm"] / p["sw"], p["ss"] / p["sw"]
                ww = a * min(1.0, p["sw"] / Rw)                         # sat-only evidence weighs half
                p["bm"] = (1 - ww) * p["proj"] + ww * s_m
                p["bs"] = (1 - ww) * (1.0 if p["k"] in cur_st else 0.0) + ww * s_s
            else:
                p["bm"] = p["proj"]; p["bs"] = 1.0 if p["k"] in cur_st else 0.0
            if p["is_injured"]: p["bm"] = p["proj"]; p["bs"] = 1.0 if p["k"] in cur_st else 0.0
        order_old = [p for p in roster if p["depth_order"]] + [p for p in roster if not p["depth_order"]]
        st = sorted(roster, key=lambda p: (-p["bs"], -p["bm"]))[:5]
        stk = {p["k"] for p in st}
        # keep the starters in their old relative order (the chart's PG..C reading); a new starter takes the
        # slot of the starter he replaced
        old_st = [p for p in order_old if p["k"] in cur_st]
        ins = [p for p in st if p["k"] not in cur_st]
        five = [p if p["k"] in stk else (ins.pop(0) if ins else None) for p in old_st]
        five = [p for p in five if p] + ins
        bench = sorted([p for p in roster if p["k"] not in stk], key=lambda p: (-p["bm"], p["depth_order"] or 99))
        new = five[:5] + bench
        dbd = {i: n for n, i in enumerate(cur_ids, 1)}
        moves = []
        for i, p in enumerate(new, 1):
            if dbd.get(p["id"]) != i: moves.append({"name": p["name"], "from": dbd.get(p["id"]), "to": i})
        flags = [p["name"] + " (projected starter, did not play)" for p in roster if p["dnp"] and p["k"] in cur_st]
        report[short] = {
            "full": full, "games": [x["id"] for x in games], "reality": round(Rw, 2), "known": round(known, 2), "weight": round(a, 2),
            "owner_set_after": owner_after, "applied": bool(moves) and not owner_after,
            "starters_old": [p["name"] for p in old_st], "starters_new": [p["name"] for p in new[:5]],
            "order": [{"name": p["name"], "old": p["depth_order"], "new": i, "proj_mpg": round(p["proj"], 1), "blend_mpg": round(p["bm"], 1),
                       "scrim_gp": p["gp"], "scrim_gs": p["gs"], "dnp": p["dnp"]} for i, p in enumerate(new, 1)],
            "moves": moves, "flags": flags, "unmatched": sorted(unmatched),
            "base": list(base.values()), "proposed": [p["id"] for p in new]}
        if moves and not owner_after:
            vals = ", ".join(f"({p['id']}, {i})" for i, p in enumerate(new, 1))
            sql.append(f"-- {short}: {Rw:.2f} reality, known {known:.2f}, weight {a:.2f}; starters "
                       f"{', '.join(p['name'] for p in old_st)} -> {', '.join(p['name'] for p in new[:5])}\n"
                       f"update players p set depth_order = v.d, depth_set_at = now() from (values {vals}) v(id, d)\n"
                       f" where p.id = v.id and p.team = '{short.replace(chr(39), chr(39) * 2)}';")
        tag = "skip (owner edited after)" if owner_after else ("APPLY" if moves else "no change")
        print(f"{short:<16} w={a:.2f} known={known:.2f}  {tag}")
        if moves:
            print(f"   starters: {', '.join(p['name'] for p in old_st)}  ->  {', '.join(p['name'] for p in new[:5])}")
            print("   " + "; ".join(f"{m['name']} {m['from']}->{m['to']}" for m in moves))
        for f in flags: print("   flag:", f)
        if unmatched: print("   not on roster:", ", ".join(sorted(unmatched)))

    json.dump({"teams": report}, open(DATA / "scrim_depth_2027.json", "w"), indent=1, ensure_ascii=False)
    head = ("-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the\n"
            "-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.\n"
            "-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.\n")
    (ROOT / "scripts" / "scrim_depth_2027.sql").write_text(head + "begin;\n" + "\n".join(sql) + "\ncommit;\n")
    print(f"\n{sum(1 for t in report.values() if t['applied'])} team(s) to update -> scripts/scrim_depth_2027.sql")


if __name__ == "__main__":
    main()
