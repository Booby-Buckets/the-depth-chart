#!/usr/bin/env python3
"""Dynasty snapshot (Phase 2, Oct 2026): one frozen season of players + teams for the game-sim engine
(js/dynasty/engine). Writes data/dynasty-snapshot.json and js/dynasty/engine/targets.json.

PLAYERS — every 2026-27 projected player: returners/transfers from stat_overall_projected.json, freshmen and
no-box newcomers from fresh_fit.json (both are the RECONCILED lines every page shows). Bio (position, height,
class) from the public Supabase `players` table, matched by espn_id, else by (team, name).

SEVEN PILLARS — the dynasty's persistent player representation (what development / recruiting will move
later). Each is a minutes-weighted z-composite of the player's per-40 projected line, put on a 1-99 scale
(50 = average D-I rotation player, 15 points = 1 SD):
  SCO scoring        pts/40, possessions used/40
  SHT shooting       3P% (shrunk to 30 att), FT% (shrunk), 3PA/40
  FIN finishing      2P% (shrunk), FTA/FGA
  PLY playmaking     ast/40
  SEC ball security  turnovers per possession used (lower = better)
  REB rebounding     oreb/40, dreb/40
  DEF defense        stl/40, blk/40, DWA/40 (returners only)
PILLAR MAP — the engine never reads the raw line: ratings.js rebuilds sim attributes (usage, shot mix, make
rates, assist / turnover / rebound / steal / block rates) from the pillars + height through least-squares
fits stored here (minutes-weighted, mpg >= 8), so a pillar that grows in a dynasty moves the attributes the
same way real players' lines move together.

TARGETS — real 2025-26 D-I averages (team_dna 2026 = D-I-vs-D-I four factors / tempo / ORtg; team_seasons
2026 = per-game counting stats); 3PA rate derived from eFG, FG% and 3P%.

TEAMS — conference (conf_members_2027.json), projected tempo / ORtg / DRtg (team_pace_eff.json — the
projection chain's DNA), projected box (team_projected_box.json) and the 2027 predictive rating; plus
`level`: the team's conference strength (mean projected net of its league), which the engine uses to undo
the schedule baked into a player's rates (a low-major's 40% from three came against low-major defenses).

    python3 scripts/build_dynasty_snapshot.py
"""
import json, re, math, statistics as S, urllib.request
from collections import defaultdict
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "scripts" / "data"
OUT = ROOT / "data" / "dynasty-snapshot.json"
TGT = ROOT / "js" / "dynasty" / "engine" / "targets.json"
KEY = re.search(r"sb_publishable_[A-Za-z0-9_-]+", (ROOT / "player.html").read_text()).group(0)
API = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"


def sb(q):
    out, off = [], 0
    while True:
        r = json.load(urllib.request.urlopen(urllib.request.Request(
            API + q + f"&limit=1000&offset={off}", headers={"apikey": KEY, "Authorization": "Bearer " + KEY}), timeout=60))
        out += r
        if len(r) < 1000: return out
        off += 1000


def inches(h):
    m = re.match(r"\s*(\d)\s*[-'’ ]\s*(\d{1,2})", str(h or ""))
    return int(m.group(1)) * 12 + int(m.group(2)) if m else None


def nm(s): return re.sub(r"[^a-z]", "", (s or "").lower().replace(" jr", "").replace(" iii", "").replace(" ii", ""))


def coach_meta(D, ROOT):
    """{team full name: {yrs, career, age, apps, ff, titles}} from coach-2027.json + coach_seasons + coach_profiles.
    Seasons on record start in 2007, so a career that starts there is longer than we can see: the age estimate adds
    a few unseen years. A new hire's tenure is 0."""
    cur = json.load(open(ROOT / "data" / "coach-2027.json"))
    seas = defaultdict(list)
    for x in json.load(open(D / "coach_seasons.json")): seas[x["coach_slug"]].append(x)
    prof = {c["coach_slug"]: c for c in json.load(open(D / "coach_profiles.json"))}
    out = {}
    for c in cur:
        tm, slug = c.get("tm"), c.get("c")
        if not tm: continue
        ss = sorted(seas.get(slug, []), key=lambda x: -x["season_year"])
        school = ss[0]["school"] if ss else None
        yrs = 0
        if not c.get("new") and ss:
            y = 2026
            for x in ss:
                if x["season_year"] == y and x["school"] == school: yrs += 1; y -= 1
                elif x["season_year"] < y: break
        career = len({x["season_year"] for x in ss})
        first = min((x["season_year"] for x in ss), default=2027)
        t = (prof.get(slug) or {}).get("tourney") or {}
        age = 34 + career + (9 if first <= 2007 else 0)
        out[tm] = {"yrs": yrs, "career": career, "age": min(76, age), "apps": t.get("apps", 0) or 0,
                   "ff": t.get("final_fours", 0) or 0, "titles": t.get("titles", 0) or 0}
    return out


def main():
    proj = json.load(open(D / "stat_overall_projected.json"))["players"]
    fresh = json.load(open(D / "fresh_fit.json"))
    members = json.load(open(D / "conf_members_2027.json"))["teams"]
    pace = json.load(open(D / "team_pace_eff.json"))["teams"]
    pbox = json.load(open(D / "team_projected_box.json"))
    dna = json.load(open(D / "team_dna.json"))
    coach = {c["tm"]: c["n"] for c in json.load(open(ROOT / "data" / "coach-2027.json")) if c.get("tm") and c.get("n")}
    # the real coach behind each program (Dynasty carousel, Oct 2026: legends and first-year coaches don't get fired,
    # nobody retires in his 40s): tenure at this school, head-coaching seasons since 2007, NCAA résumé, an age estimate
    cmeta = coach_meta(D, ROOT)
    # home state per program (scripts/build_team_states.py) — Dynasty recruiting: proximity / hometown pull
    st = {k: v.get("state") for k, v in json.load(open(D / "team_states.json")).items()} if (D / "team_states.json").exists() else {}
    rows = sb("players?select=id,espn_id,name,team,position,position2,height,class_year,yr,starter,depth_order,is_injured&order=id.asc")
    pr = json.load(urllib.request.urlopen(urllib.request.Request(
        API + "predictive_ratings?season=eq.2027&select=data&limit=1", headers={"apikey": KEY, "Authorization": "Bearer " + KEY}), timeout=60))
    rating = {t["full"]: t.get("rating") for t in pr[0]["data"]["teams"] if t.get("full")}

    by_espn = {str(r["espn_id"]): r for r in rows if r.get("espn_id")}
    # short sheet name -> full ESPN name, learned from players that sit in both files
    vote = defaultdict(lambda: defaultdict(int))
    for e, p in proj.items():
        r = by_espn.get(e)
        if r and r.get("team"): vote[r["team"]][p["team"]] += 1
    s2f = {s: max(v, key=v.get) for s, v in vote.items()}
    by_tn = {(r["team"], nm(r["name"])): r for r in rows if r.get("team")}

    players = []
    def add(pid, name, full, line, bio, src, ovr):
        mpg = float(line.get("mpg") or 0)
        if mpg <= 0 or not full: return
        pos = (bio or {}).get("position") or ""
        players.append({"id": pid, "name": name, "team": full, "pos": pos, "pos2": (bio or {}).get("position2") or "",
                        "ht": inches((bio or {}).get("height")), "cls": (bio or {}).get("class_year") or (bio or {}).get("yr") or "",
                        "ovr": ovr, "src": src, "injured": bool((bio or {}).get("is_injured")),
                        "line": {k: round(float(line.get(k) or 0), 2) for k in
                                 ("mpg", "ppg", "fga", "fgm", "tpa", "tpm", "fta", "ftm", "oreb", "dreb", "apg", "stl", "blk", "tovs")},
                        "dwa": line.get("dwa"), "usg": line.get("usg")})
    for e, p in proj.items():
        b = by_espn.get(e)
        add(e, (b or {}).get("name") or p.get("name") or e, p["team"], p, b, "returner", p.get("ovr"))
    for short, roster in fresh.items():
        full = s2f.get(short)
        for name, x in roster.items():
            b = by_tn.get((short, nm(name)))
            if b and b.get("espn_id") and str(b["espn_id"]) in proj: continue   # already in as a returner
            add(str(b["espn_id"]) if b and b.get("espn_id") else f"fr:{short}:{name}", name, full, x, b, "newcomer", x.get("ovr"))

    # ── points-only lines (a few fresh_fit newcomers carry just mpg + ppg: five whole rosters) get the league's
    # per-minute shape for assists / steals / turnovers, a big's or a guard's for rebounds / blocks, and the
    # league's per-point shot mix — the same fill build_team_projected_box.py uses for players it can't see ──
    full_lines = [p for p in players if p["line"]["fga"] > 0 and p["line"]["mpg"] >= 8]
    def isbig(p): return p["pos"] in ("PF", "C") or bool(p["ht"] and p["ht"] >= 80 and p["pos"] not in ("PG", "SG"))
    def shape(ps, keys, per):
        den = sum(q["line"][per] for q in ps) or 1
        return {k: sum(q["line"][k] for q in ps) / den for k in keys}
    LGM = shape(full_lines, ("apg", "stl", "tovs"), "mpg")
    BIGM = shape([q for q in full_lines if isbig(q)], ("oreb", "dreb", "blk"), "mpg")
    SMLM = shape([q for q in full_lines if not isbig(q)], ("oreb", "dreb", "blk"), "mpg")
    LGP = shape(full_lines, ("fga", "fgm", "tpa", "tpm", "fta", "ftm"), "ppg")
    nfill = 0
    for q in players:
        L = q["line"]
        if L["fga"] > 0 or L["ppg"] <= 0: continue
        for k, v in LGM.items(): L[k] = round(v * L["mpg"], 2)
        for k, v in (BIGM if isbig(q) else SMLM).items(): L[k] = round(v * L["mpg"], 2)
        for k, v in LGP.items(): L[k] = round(v * L["ppg"], 2)
        q["src"] += "+filled"; nfill += 1
    print(f"filled {nfill} points-only lines from league shapes")

    # ── per-40 features (shooting shrunk toward average on SEASON attempts: per-game line x G games) ──
    G = 30
    def f(p):
        L, m = p["line"], max(p["line"]["mpg"], 1e-6)
        per = lambda k: L[k] * 40 / m
        fg2a, fg2m = L["fga"] - L["tpa"], L["fgm"] - L["tpm"]
        poss = L["fga"] + 0.44 * L["fta"] + L["tovs"]
        return {"pts40": per("ppg"), "use40": poss * 40 / m,
                "p3": (G * L["tpm"] + 30 * 0.335) / (G * L["tpa"] + 30), "ftp": (G * L["ftm"] + 20 * 0.71) / (G * L["fta"] + 20),
                "a3_40": per("tpa"), "p2": (G * fg2m + 30 * 0.52) / (G * fg2a + 30),
                "ftr": L["fta"] / L["fga"] if L["fga"] > 0.3 else 0.33,
                "ast40": per("apg"), "tovp": L["tovs"] / poss if poss > 0.3 else 0.16,
                "or40": per("oreb"), "dr40": per("dreb"), "stl40": per("stl"), "blk40": per("blk"),
                "dwa40": (float(p["dwa"]) * 40 / (m * 30)) if p.get("dwa") is not None else None,
                "r3": L["tpa"] / L["fga"] if L["fga"] > 0.3 else 0.38}
    for p in players: p["_f"] = f(p)
    pool = [p for p in players if p["line"]["mpg"] >= 8]
    w = np.array([p["line"]["mpg"] for p in pool])
    def z(key, sign=1):
        xs = [p["_f"][key] for p in pool if p["_f"][key] is not None]
        ws = [p["line"]["mpg"] for p in pool if p["_f"][key] is not None]
        mu = float(np.average(xs, weights=ws)); sd = float(math.sqrt(np.average((np.array(xs) - mu) ** 2, weights=ws))) or 1
        return lambda p: None if p["_f"][key] is None else sign * (p["_f"][key] - mu) / sd
    Z = {k: z(k) for k in ("pts40", "use40", "p3", "ftp", "a3_40", "p2", "ftr", "ast40", "or40", "dr40", "stl40", "blk40", "dwa40")}
    Z["tovp"] = z("tovp", -1)
    COMP = {"SCO": [("pts40", .7), ("use40", .3)], "SHT": [("p3", .5), ("ftp", .25), ("a3_40", .25)],
            "FIN": [("p2", .6), ("ftr", .4)], "PLY": [("ast40", 1)], "SEC": [("tovp", 1)],
            "REB": [("or40", .4), ("dr40", .6)], "DEF": [("stl40", .35), ("blk40", .35), ("dwa40", .3)]}
    raw = {}
    for k, parts in COMP.items():
        def comp(p, parts=parts):
            got = [(Z[c](p), wt) for c, wt in parts if Z[c](p) is not None]
            return sum(v * wt for v, wt in got) / sum(wt for _, wt in got)
        vals = np.array([comp(p) for p in pool]); mu = float(np.average(vals, weights=w))
        sd = float(math.sqrt(np.average((vals - mu) ** 2, weights=w))) or 1
        raw[k] = (comp, mu, sd)
    for p in players:
        p["pillars"] = {k: int(max(1, min(99, round(50 + 15 * (c(p) - mu) / sd)))) for k, (c, mu, sd) in raw.items()}

    # ── pillar map: sim attributes = intercept + slopes x (pillar-50)/15 [+ height] ──
    MAPS = {"use40": ["SCO", "PLY"], "r3": ["SHT", "FIN"], "p3": ["SHT"], "p2": ["FIN", "ht"], "ftr": ["FIN", "ht"],
            "ftp": ["SHT"], "ast40": ["PLY"], "tovp": ["SEC", "PLY"], "or40": ["REB", "ht"], "dr40": ["REB", "ht"],
            "stl40": ["DEF"], "blk40": ["DEF", "ht"]}
    HT0 = 77.0
    fit_pool = [p for p in pool if p["ht"]]
    wf = np.array([p["line"]["mpg"] for p in fit_pool])
    pmap = {}
    for attr, xs in MAPS.items():
        X = np.array([[1.0] + [((p["ht"] - HT0) / 3.0) if x == "ht" else (p["pillars"][x] - 50) / 15.0 for x in xs] for p in fit_pool])
        y = np.array([p["_f"][attr] for p in fit_pool])
        sw = np.sqrt(wf)
        c = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)[0]
        pred = X @ c; r = float(np.corrcoef(pred, y)[0, 1])
        pmap[attr] = {"terms": ["1"] + xs, "coef": [round(float(v), 5) for v in c], "r": round(r, 3)}
    for p in players: p.pop("_f", None)

    # ── teams ──
    T = defaultdict(list)
    for p in players: T[p["team"]].append(p)
    net = {t: v["o"] - v["d"] for t, v in pace.items()}
    conf_net = defaultdict(list)
    for t, c in members.items():
        if t in net: conf_net[c].append(net[t])
    teams = []
    for full, ps in sorted(T.items()):
        mins = sum(p["line"]["mpg"] for p in ps)
        if len(ps) < 7 or mins < 150: continue
        c = members.get(full)
        mates = [net[t] for t, cc in members.items() if cc == c and t != full and t in net]
        pe = pace.get(full) or {}
        teams.append({"name": full, "conf": c, "tempo": pe.get("t"), "projO": pe.get("o"), "projD": pe.get("d"),
                      "projSrc": pe.get("src"), "coach": coach.get(full), "coachMeta": cmeta.get(full), "projBox": pbox.get(full), "rating": rating.get(full),
                      "level": round(S.mean(mates), 2) if mates else 0.0, "minutes": round(mins, 1), "state": st.get(full),
                      "players": [p["id"] for p in sorted(ps, key=lambda p: -p["line"]["mpg"])]})
    # ── overall map: projected OVR ~ pillars + height (player level, minutes-weighted). The dynasty recomputes
    # OVR from pillars with this, and the defense map below reads talent through it. ──
    PIL = ["SCO", "SHT", "FIN", "PLY", "SEC", "REB", "DEF"]
    op = [q for q in pool if q.get("ovr") is not None and q["ht"]]
    Xo = np.array([[1.0] + [(q["pillars"][k] - 50) / 15 for k in PIL] + [(q["ht"] - HT0) / 3] for q in op])
    yo = np.array([float(q["ovr"]) for q in op]); so = np.sqrt([q["line"]["mpg"] for q in op])
    co = np.linalg.lstsq(Xo * so[:, None], yo * so, rcond=None)[0]
    omap = {"terms": ["1"] + PIL + ["ht"], "coef": [round(float(v), 3) for v in co], "r": round(float(np.corrcoef(Xo @ co, yo)[0, 1]), 3)}
    print(f"  overall map r={omap['r']}", dict(zip(omap["terms"], omap["coef"])))
    ovr_of = lambda q: float(np.array([1.0] + [(q["pillars"][k] - 50) / 15 for k in PIL] + [(((q["ht"] or HT0) - HT0) / 3)]) @ co)
    om = np.array([ovr_of(q) for q in pool]); OMU = float(np.average(om, weights=w)); OSD = float(math.sqrt(np.average((om - OMU) ** 2, weights=w)))

    # ── defense map: team projected DRtg ~ league strength + minutes-weighted (overall talent z, DEF pillar z).
    # Team defense in the projection chain follows talent and league (r -0.66 / -0.54) more than steals and
    # blocks (-0.28); a free fit on all seven pillars is collinear nonsense (scoring = defense), so two terms.
    # def100 = DRtg points a player saves per 100 when his lineup is five of him (positive = better). ──
    byid = {q["id"]: q for q in players}
    X, y = [], []
    for t in teams:
        if t["projD"] is None or t.get("projSrc") != "proj": continue   # 66 teams carry a rating-derived fallback, not projected DNA
        ps = [byid[i] for i in t["players"]]; ww = np.array([q["line"]["mpg"] for q in ps]); ww = ww / ww.sum()
        X.append([1.0, t["level"] / 10, float(sum(wi * (ovr_of(q) - OMU) / OSD for wi, q in zip(ww, ps))),
                  float(sum(wi * (q["pillars"]["DEF"] - 50) / 15 for wi, q in zip(ww, ps)))])
        y.append(t["projD"])
    X, y = np.array(X), np.array(y)
    cd = np.linalg.lstsq(X, y, rcond=None)[0]
    rd = float(np.corrcoef(X @ cd, y)[0, 1])
    dmap = {"terms": ["ovr_z", "DEF"], "coef": [round(-float(v), 3) for v in cd[2:]], "ovr_mu": round(OMU, 3), "ovr_sd": round(OSD, 3),
            "level_per10": round(-float(cd[1]), 3), "r": round(rd, 3)}
    print(f"  defense map r={rd:.2f} level/10={-cd[1]:.2f}", dict(zip(dmap["terms"], dmap["coef"])))
    # ── system defense: the part of a team's projected DRtg its players' pillars + league don't explain — scheme /
    # coaching / continuity (Illinois, Texas Tech). DRtg points per 100, + = better, capped at +/-8; teams on the
    # rating fallback get 0. In a dynasty this is the coach's defensive rating. ──
    for t in teams:
        t["sysDef"] = 0.0
        if t["projD"] is None or t.get("projSrc") != "proj": continue
        ps = [byid[i] for i in t["players"]]; ww = np.array([q["line"]["mpg"] for q in ps]); ww = ww / ww.sum()
        x = np.array([1.0, t["level"] / 10, float(sum(wi * (ovr_of(q) - OMU) / OSD for wi, q in zip(ww, ps))),
                      float(sum(wi * (q["pillars"]["DEF"] - 50) / 15 for wi, q in zip(ww, ps)))])
        t["sysDef"] = round(float(max(-8.0, min(8.0, -(t["projD"] - float(x @ cd))))), 2)
    keep = {t["name"] for t in teams}
    players = [p for p in players if p["team"] in keep]
    # ── SHELLS: D-I members with no usable roster (Long Island, Wyoming, Ohio… — 13 in Oct 2026). The dynasty
    # generates a roster for each, sized to its real power rating, so every scheduled D-I game gets played. ──
    lv_conf = defaultdict(list)
    for t in teams: lv_conf[t["conf"]].append(t["level"])
    tempo_mu = round(S.mean([t["tempo"] for t in teams if t.get("tempo")]), 2)
    shells = [{"name": full, "conf": c, "rating": rating.get(full), "tempo": (pace.get(full) or {}).get("t") or tempo_mu,
               "level": round(S.mean(lv_conf[c]), 2) if lv_conf.get(c) else 0.0, "coach": coach.get(full), "coachMeta": cmeta.get(full), "state": st.get(full)}
              for full, c in sorted(members.items()) if full not in keep]
    print(f"shells (D-I, no roster): {len(shells)} — " + ", ".join(x["name"] for x in shells))

    # ── targets: real 2025-26 D-I averages ──
    d26 = list(dna["2026"]["teams"].values())
    ts = sb("team_seasons?select=team,ppg,oppg,fg_pct,tp_pct,ft_pct,apg,spg,bpg,topg,orpg,drpg,rpg&season_year=eq.2026&order=team_id.asc")
    m = lambda xs: round(float(S.mean([x for x in xs if x is not None])), 2)
    efg, fgp, tpp = m(t["oeFG"] for t in d26), m(t["fg_pct"] for t in ts), m(t["tp_pct"] for t in ts)
    r3 = 2 * (efg - fgp) / tpp            # eFG = FG% + 0.5 x 3PM/FGA  ->  3PA/FGA = 2(eFG - FG%) / 3P%
    targets = {"season": "2025-26", "source": "team_dna 2026 (D-I vs D-I) + team_seasons 2026",
               "pace": m(t["tempo"] for t in d26), "ortg": m(t["ORtg"] for t in d26),
               "ppg": m(t["ppg"] for t in ts), "efg": efg, "tov_pct": m(t["oTOV"] for t in d26),
               "orb_pct": m(t["oORB"] for t in d26), "ftr": m(t["oFTr"] for t in d26),
               "fg_pct": fgp, "tp_pct": tpp, "ft_pct": m(t["ft_pct"] for t in ts), "three_rate": round(100 * r3, 1),
               "apg": m(t["apg"] for t in ts), "spg": m(t["spg"] for t in ts), "bpg": m(t["bpg"] for t in ts),
               "topg": m(t["topg"] for t in ts), "orpg": m(t["orpg"] for t in ts), "rpg": m(t["rpg"] for t in ts),
               "net_sd": round(float(S.pstdev([t["net"] for t in d26])), 2),
               "hca_pts": 3.0, "game_margin_sd": 11.0,
               "tolerance": {"pace": 1.0, "ppg": 1.5, "efg": 0.8, "tov_pct": 0.8, "orb_pct": 1.2, "ftr": 2.0,
                             "three_rate": 1.5, "tp_pct": 0.8, "ft_pct": 1.5, "hca_pts": 0.7, "game_margin_sd": 1.0}}

    OUT.parent.mkdir(exist_ok=True)
    json.dump({"season": "2026-27", "built": "scripts/build_dynasty_snapshot.py", "pillarScale": "50 = avg D-I rotation player, 15 = 1 SD",
               "heightRef": HT0, "pillarMap": pmap, "ovrMap": omap, "defMap": dmap, "teams": teams, "players": players, "shells": shells},
              open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
    TGT.parent.mkdir(parents=True, exist_ok=True)
    json.dump(targets, open(TGT, "w"), indent=1)
    print(f"{len(teams)} teams, {len(players)} players ({sum(p['src'] == 'newcomer' for p in players)} newcomers, "
          f"{sum(1 for p in players if p['ht'])} with height) -> {OUT.relative_to(ROOT)}")
    for k, v in pmap.items(): print(f"  {k:6} r={v['r']:.2f}  {dict(zip(v['terms'], v['coef']))}")
    print("targets:", {k: v for k, v in targets.items() if not isinstance(v, (dict, str))})


if __name__ == "__main__":
    main()
