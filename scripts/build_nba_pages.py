#!/usr/bin/env python3
"""
NBA player-page data: one static JSON per NBA player (nba.html reads it) + an index.

Every number is computed by us from the scraped box scores with the SAME formulas as the
college pages (derived_stats via build_nba_bridge.nba_seasons) — TS%, USG%, AST/REB/STL/BLK%,
TI/40, points above replacement — so a college line and an NBA line read the same way.

  nba/index.json        {players: [[nba_id, name, college_id|null, first, last, pos, team,
                         college_team|null, career_par, draft_pick]],
                         by_college: {college_id: nba_id}, teams: {abbr: name}}
  nba/p/<nba_id>.json   bio, draft, seasons (regular + postseason, per-team splits for
                        trade years, league percentiles), career, College→NBA translation,
                        similar NBA players
  nba/g/<nba_id>.json   game logs (~70% of the bytes — fetched only when the tab opens)

Inputs: scrape_nba.py outputs, build_nba_bridge.py (nba_bridge.csv), build_nba_translate.py
(../nba_translate.json), data/player_advanced.csv (college lines).

  python3 build_nba_pages.py
"""
import csv, json, math, shutil, sys
from collections import defaultdict
from pathlib import Path
import numpy as np
import build_nba_bridge as br

HERE = Path(__file__).parent
DATA = HERE / "data"
ROOT = HERE.parent
OUT = ROOT / "nba"
PCT_MIN = 500                 # season minutes to enter the league-percentile pool
COMP_MIN = 1500               # career minutes to be a similar-player candidate
GL_COLS = ["d", "st", "tm", "opp", "h", "res", "sc", "gs", "min", "pts", "fgm", "fga", "tpm", "tpa",
           "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf", "pm"]
# percentile stats: key -> (higher is better?)
PCT = {"ppg": 1, "rpg": 1, "apg": 1, "spg": 1, "bpg": 1, "ts_pct": 1, "efg_pct": 1, "tp_pct": 1,
       "ft_pct": 1, "tpa_rate": 1, "fta_rate": 1, "usg_pct": 1, "ast_pct": 1, "tov_pct": -1,
       "orb_pct": 1, "drb_pct": 1, "stl_pct": 1, "blk_pct": 1, "ti40": 1, "onoff48": 1}
COMP_FEATS = ["usg_pct", "ast_pct", "tov_pct", "orb_pct", "drb_pct", "stl_pct", "blk_pct",
              "tpa_rate", "fta_rate", "ts_pct", "height_in"]


def r1(x, n=1):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def div(a, b):
    return a / b if b else None


def season_row(a, onoff):
    """Owned advanced dict (+tot) -> the page's season row."""
    t, g = a["tot"], a["tot"]["g"] or 0
    pg = lambda k: r1(t[k] / g) if g else None
    return {
        "g": g, "gs": a.get("gs"), "min": t["min"], "mpg": pg("min"), "teams": a.get("teams"),
        "ppg": pg("pts"), "rpg": pg("reb"), "orpg": pg("oreb"), "drpg": pg("dreb"), "apg": pg("ast"),
        "spg": pg("stl"), "bpg": pg("blk"), "tpg": pg("tov"), "pfpg": pg("pf"),
        "fgm": pg("fgm"), "fga": pg("fga"), "tpm": pg("tpm"), "tpa": pg("tpa"), "ftm": pg("ftm"), "fta": pg("fta"),
        "fg_pct": r1(div(t["fgm"], t["fga"]), 3), "tp_pct": r1(div(t["tpm"], t["tpa"]), 3),
        "ft_pct": r1(div(t["ftm"], t["fta"]), 3), "ts_pct": a.get("ts_pct"), "efg_pct": a.get("efg_pct"),
        "tpa_rate": r1(div(t["tpa"], t["fga"]), 3), "fta_rate": r1(div(t["fta"], t["fga"]), 3),
        "usg_pct": a.get("usg_pct"), "ast_pct": a.get("ast_pct"), "tov_pct": a.get("tov_pct"),
        "orb_pct": a.get("orb_pct"), "drb_pct": a.get("drb_pct"), "trb_pct": a.get("trb_pct"),
        "stl_pct": a.get("stl_pct"), "blk_pct": a.get("blk_pct"),
        "ti40": a.get("ti40"), "ti100": a.get("ti100"), "par": a.get("par"),
        "pm": onoff.get("pm"), "onoff48": onoff.get("onoff48"), "star": bool(a.get("star_season")),
        "tot": t,
    }


def main():
    print("NBA seasons (owned formulas)…", flush=True)
    REG = br.nba_seasons("regular", quiet=True)
    POST = br.nba_seasons("postseason", quiet=True)
    bio = {p["espn_id"]: p for p in br.read_jsonl(DATA / "nba_players.jsonl") if not p.get("missing")}
    games = {g["game_id"]: g for g in br.read_jsonl(DATA / "nba_games.jsonl") if not g.get("missing")}
    tnames, tid = {}, {}
    for t in sorted(br.read_jsonl(DATA / "nba_team_seasons.jsonl"), key=lambda t: t["season"]):
        if t.get("team"):
            tnames[t["team"]] = t.get("team_name") or t["team"]                   # latest name wins
            tid[(t["season"], t["team_id"])] = t["team"]
    draft = {d["college_athlete_id"]: d for d in br.read_jsonl(DATA / "nba_draft.jsonl") if d.get("college_athlete_id")}

    # ---- box pass: game logs, per-team splits, +/- and in-game on/off ----
    print("Box scores…", flush=True)
    gl = defaultdict(lambda: defaultdict(list))            # nba_id -> season -> rows
    split = defaultdict(lambda: defaultdict(int))          # (id, season, type, team) -> totals
    oo = defaultdict(lambda: [0, 0, 0, 0])                 # (id, season, type) -> on_pm, on_min, off_pm, off_min
    for r in br.read_jsonl(DATA / "nba_box.jsonl"):
        st = r.get("season_type")
        if st not in ("regular", "postseason", "playin") or not r.get("espn_id"): continue
        g = games.get(r["game_id"])
        if not g or g.get("home_score") is None: continue
        if r["team"] not in tnames: continue                # All-Star sides
        mine = g["home_score"] if r["home"] else g["away_score"]
        theirs = g["away_score"] if r["home"] else g["home_score"]
        played = not r.get("dnp") and bool(r.get("min"))
        if played:
            gl[r["espn_id"]][r["season"]].append([
                r["date"], {"regular": "R", "postseason": "P", "playin": "I"}[st], r["team"], r["opp"],
                1 if r["home"] else 0, "W" if mine > theirs else "L", f"{mine}-{theirs}", 1 if r.get("starter") else 0,
                *[r.get(k) for k in ("min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb",
                                     "reb", "ast", "stl", "blk", "tov", "pf", "pm")]])
            if st != "playin":
                key = (r["espn_id"], r["season"], st, r["team"])
                s = split[key]; s["g"] += 1
                for k, c in (("min", "min"), ("pts", "pts"), ("reb", "reb"), ("ast", "ast"), ("fgm", "fgm"),
                             ("fga", "fga"), ("tpm", "fg3m"), ("tpa", "fg3a"), ("ftm", "ftm"), ("fta", "fta"),
                             ("stl", "stl"), ("blk", "blk"), ("tov", "tov")):
                    s[k] += r.get(c) or 0
                if r.get("pm") is not None:
                    a = oo[(r["espn_id"], r["season"], st)]
                    a[0] += r["pm"]; a[1] += r["min"]; a[2] += (mine - theirs) - r["pm"]; a[3] += max(0, 48 - r["min"])

    def onoff(eid, y, st):
        a = oo.get((eid, y, st))
        if not a or a[1] < 50: return {}
        out = {"pm": a[0]}
        if a[3] >= 50: out["onoff48"] = r1((a[0] / a[1] - a[2] / a[3]) * 48)
        return out

    # ---- season rows + league percentiles (regular season) ----
    rows = defaultdict(dict)                               # nba_id -> {(y, type): row}
    for src, st in ((REG, "regular"), (POST, "postseason")):
        for (eid, y), a in src.items():
            rows[eid][(y, st)] = season_row(a, onoff(eid, y, st))
    by_season = defaultdict(list)
    for eid, d in rows.items():
        for (y, st), s in d.items():
            if st == "regular" and s["min"] >= PCT_MIN: by_season[y].append(s)
    for y, pool in by_season.items():
        for k, sign in PCT.items():
            vals = np.array(sorted(v[k] for v in pool if v.get(k) is not None
                                   and not (k == "tp_pct" and v["tot"]["tpa"] < 82)
                                   and not (k == "ft_pct" and v["tot"]["fta"] < 50)), float)
            if not len(vals): continue
            for eid, d in rows.items():
                s = d.get((y, "regular"))
                if not s or s["min"] < PCT_MIN or s.get(k) is None: continue
                if k == "tp_pct" and s["tot"]["tpa"] < 82: continue
                if k == "ft_pct" and s["tot"]["fta"] < 50: continue
                p = np.searchsorted(vals, s[k], side="right") / len(vals)
                s.setdefault("pct", {})[k] = int(round(100 * (p if sign > 0 else 1 - p + 1 / len(vals))))

    # ---- career profiles + similar players (style, not quality) ----
    prof = {}
    for eid, d in rows.items():
        reg = [s for (y, st), s in d.items() if st == "regular"]
        m = sum(s["min"] for s in reg)
        if m < COMP_MIN: continue
        v = {k: sum((s.get(k) or 0) * s["min"] for s in reg) / m for k in COMP_FEATS if k != "height_in"}
        v["height_in"] = (bio.get(eid) or {}).get("height_in")
        if v["height_in"]: prof[eid] = v
    ids = list(prof)
    X = np.array([[prof[e][k] for k in COMP_FEATS] for e in ids], float)
    Z = (X - X.mean(0)) / X.std(0)
    # role first: size and the boards/blocks that come with it outweigh scoring style
    for k, w in (("height_in", 2.0), ("orb_pct", 1.4), ("drb_pct", 1.3), ("blk_pct", 1.2), ("ast_pct", 1.2)):
        Z[:, COMP_FEATS.index(k)] *= w
    comps = {}
    for i, e in enumerate(ids):
        dd = np.sqrt(((Z - Z[i]) ** 2).sum(1)); dd[i] = 1e9
        comps[e] = [(ids[j], r1(float(100 / (1 + dd[j])), 0)) for j in np.argsort(dd)[:6]]

    # ---- college side: bridge + college lines + translation ----
    bridge = {r["nba_espn_id"]: r for r in csv.DictReader(open(DATA / "nba_bridge.csv")) if r.get("nba_espn_id")}
    colrows = defaultdict(list)
    need = {b["espn_id"] for b in bridge.values()}
    for r in csv.DictReader(open(DATA / "player_advanced.csv")):
        if r["espn_id"] in need: colrows[r["espn_id"]].append(r)
    tr = json.load(open(ROOT / "nba_translate.json"))
    curve = tr["pick_curve"]

    def expected_for_pick(p):
        pts = [(c["pick"], c["expected_par"]) for c in curve]
        for (a, va), (b, vb) in zip(pts, pts[1:]):
            if a <= p <= b: return va + (vb - va) * (p - a) / (b - a)
        return pts[-1][1]

    def num(x):
        try: return float(x)
        except (TypeError, ValueError): return None

    def college_block(eid):
        b = bridge.get(eid)
        if not b: return None
        cid, F = b["espn_id"], int(b["final_season"])
        cs = sorted(colrows.get(cid, []), key=lambda r: int(r["season_year"]))
        line = lambda r: {k: num(r[k]) for k in ("g", "min", "ppg", "rpg", "apg", "ts_pct", "efg_pct", "tp_pct",
                                                  "ft_pct", "usg_pct", "ast_pct", "tov_pct", "orb_pct", "drb_pct",
                                                  "stl_pct", "blk_pct", "ti40")} | {"season": int(r["season_year"]), "team": r["team"]}
        # NBA first-4 window, minute-weighted, for the translation check
        win = [s for (y, st), s in rows[eid].items() if st == "regular" and F < y <= F + 4 and s["min"] >= 100]
        wm = sum(s["min"] for s in win)
        wt = {k: sum(s["tot"][k] for s in win) for k in ("tpm", "tpa", "ftm", "fta", "fga")}
        nwin = {}
        if wm:
            for k in ("ts_pct", "usg_pct", "ast_pct", "tov_pct", "orb_pct", "drb_pct", "stl_pct", "blk_pct", "ti40"):
                nwin[k] = sum((s.get(k) or 0) * s["min"] for s in win) / wm
            nwin["tp_pct"] = div(wt["tpm"], wt["tpa"]) if wt["tpa"] >= 100 else None
            nwin["ft_pct"] = div(wt["ftm"], wt["fta"]) if wt["fta"] >= 100 else None
        trans = []
        fin = line(cs[-1]) if cs else {}
        for t in tr["translation"]:
            ck, nk = t["college"].replace("c_", ""), t["nba"]
            nk = {"n_ts": "ts_pct", "n_tp": "tp_pct", "n_ft": "ft_pct", "n_usg": "usg_pct", "n_ast_pct": "ast_pct",
                  "n_tov_pct": "tov_pct", "n_orb_pct": "orb_pct", "n_drb_pct": "drb_pct", "n_stl_pct": "stl_pct",
                  "n_blk_pct": "blk_pct", "n_ti40": "ti40"}.get(nk)
            cv = fin.get(ck)
            if nk is None or cv is None: continue
            trans.append({"stat": t["stat"], "key": nk, "college": r1(cv, 3), "r": t["r"],
                          "expected": r1(t["intercept"] + t["slope"] * cv, 3),
                          "actual": r1(nwin.get(nk), 3) if wm >= 1000 else None})
        pick = num(b["draft_pick"])
        par_w4 = num(b["nba_par_w4"]) or 0
        return {"college_id": cid, "final_season": F, "final_team": b["final_team"], "conference": b["conference"],
                "seasons": [line(r) for r in cs], "archetype": b["archetype"] or None,
                "tier_w4": b["tier_w4_name"], "tier_career": b["tier_career_name"],
                "window_complete": b["window_complete"] == "True", "nba_min_w4": num(b["nba_min_w4"]),
                "par_w4": par_w4, "expected_par_for_pick": r1(expected_for_pick(pick), 0) if pick else None,
                "translation": trans}

    # ---- write ----
    if OUT.exists(): shutil.rmtree(OUT)
    (OUT / "p").mkdir(parents=True); (OUT / "g").mkdir()
    index, by_college, total = [], {}, 0
    for eid in sorted(rows, key=lambda e: (bio.get(e) or {}).get("name") or ""):
        b = bio.get(eid, {})
        d = rows[eid]
        seasons = []
        for (y, st), s in sorted(d.items()):
            sp = [{"team": tm, **{k: (r1(v / ss["g"]) if k not in ("g",) else v) for k, v in ss.items()}}
                  for (e2, y2, st2, tm), ss in split.items() if e2 == eid and y2 == y and st2 == st] \
                if len(s.get("teams") or []) > 1 else []
            seasons.append({"season": y, "type": st, **{k: v for k, v in s.items() if k != "tot"},
                            "tot": s["tot"], "splits": sp})
        reg = [s for s in seasons if s["type"] == "regular"]
        ct = {k: sum(s["tot"][k] for s in reg) for k in br.TOT_KEYS}
        cm = ct["min"] or 1
        career = {"seasons": len(reg), "g": ct["g"], "min": ct["min"],
                  **{k: r1(ct[t] / ct["g"]) if ct["g"] else None for k, t in
                     (("mpg", "min"), ("ppg", "pts"), ("rpg", "reb"), ("apg", "ast"), ("spg", "stl"), ("bpg", "blk"), ("tpg", "tov"))},
                  "fg_pct": r1(div(ct["fgm"], ct["fga"]), 3), "tp_pct": r1(div(ct["tpm"], ct["tpa"]), 3),
                  "ft_pct": r1(div(ct["ftm"], ct["fta"]), 3),
                  "ts_pct": r1(div(ct["pts"], 2 * (ct["fga"] + 0.44 * ct["fta"])), 3),
                  "par": r1(sum(s["par"] or 0 for s in reg)), "star_seasons": sum(1 for s in reg if s["star"]),
                  **{k: r1(sum((s.get(k) or 0) * s["min"] for s in reg) / cm, 1) for k in
                     ("usg_pct", "ast_pct", "tov_pct", "trb_pct", "stl_pct", "blk_pct", "ti40")}}
        cb = college_block(eid)
        cid = cb["college_id"] if cb else None
        if cid: by_college[cid] = eid
        dr = draft.get(cid or b.get("college_athlete_id") or "") or {}
        last = max(seasons, key=lambda s: (s["season"], s["type"] == "regular")) if seasons else {}
        rec = {
            "id": eid, "name": b.get("name"), "first": b.get("first_name"), "last": b.get("last_name"),
            "pos": b.get("pos"), "height_in": b.get("height_in"), "weight": b.get("weight"), "dob": b.get("dob"),
            "hand": b.get("hand"), "birthplace": b.get("birthplace"), "college": b.get("college"),
            "headshot": b.get("headshot"), "active": b.get("active"), "debut": b.get("debut_year"),
            "draft": {"year": dr.get("draft_year") or b.get("draft_year"), "round": dr.get("round") or b.get("draft_round"),
                      "pick": dr.get("overall") or (b.get("draft_pick") + (30 if b.get("draft_round") == 2 else 0) if b.get("draft_pick") else None),
                      "team": tid.get((dr.get("draft_year"), dr.get("nba_team_id"))),
                      "display": b.get("draft_display")},
            "team": (last.get("teams") or [None])[-1], "career": career, "seasons": seasons,
            "college_link": cb,
            "comps": [{"id": c, "name": (bio.get(c) or {}).get("name"), "sim": s,
                       "team": (sorted((rows[c] or {}).items())[-1][1].get("teams") or [None])[-1]} for c, s in comps.get(eid, [])],
        }
        (OUT / "g" / f"{eid}.json").write_text(json.dumps(
            {"cols": GL_COLS, "seasons": {str(y): sorted(v) for y, v in gl.get(eid, {}).items()}}, separators=(",", ":")))
        f = OUT / "p" / f"{eid}.json"
        f.write_text(json.dumps(rec, separators=(",", ":")))
        total += f.stat().st_size
        yrs = sorted({s["season"] for s in reg})
        index.append([eid, b.get("name"), cid, yrs[0] if yrs else None, yrs[-1] if yrs else None, b.get("pos"), rec["team"],
                      cb["final_team"] if cb else None, career["par"], rec["draft"]["pick"]])
    (OUT / "index.json").write_text(json.dumps({"players": index, "by_college": by_college, "teams": tnames},
                                               separators=(",", ":")))
    print(f"wrote {len(index)} players → nba/p/*.json ({total/1e6:.1f} MB), index {(OUT/'index.json').stat().st_size//1024} KB; "
          f"{len(by_college)} linked to a college page")


if __name__ == "__main__":
    sys.exit(main())
