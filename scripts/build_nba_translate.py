#!/usr/bin/env python3
"""
"What translates" — college → NBA analysis (Phase 2 of the college-to-NBA work).

Reads the bridge (build_nba_bridge.py) and answers:
  1. draft_gap    Which college stats predict NBA value BEYOND draft slot? For each stat:
                  how much the draft rewards it (rank corr with pick) vs how much it predicts
                  value over the pick's expectation (rank corr with residual). Positive gap =
                  the draft under-rates it. Overall + by size group (guard / wing / big).
  2. translation  How each stat carries over: college final season → NBA first 4 seasons
                  (minute-weighted). r, slope, retention. Plus "best college predictor of NBA
                  3P%": college 3P% vs FT% vs career 3P% vs a blend.
  3. archetype    Hit rates + value over slot by the player's final-college-season style role.
  4. class        Same by college seasons played (one-and-done … 5th year).
  5. programs     Value over slot by school and conference (min sample), power vs mid-major.

Population for 1/3/4/5: drafted college players with a complete 4-season NBA window
(final college season ≤ 2022), INCLUDING picks who never played (scrape_nba.py draft phase).
Outcome = nba_par_w4: TI points above replacement over the first 4 NBA seasons (owned).
Expected-by-pick = decreasing isotonic fit of outcome on pick. Residual = actual − expected.

Robustness — three outcomes, because each one is biased differently:
  value    TI points above replacement. Our weights: credits rebounds, no credit for spacing.
  minutes  NBA minutes. What coaches chose — not impact (bad teams play rookies).
  on/off   In-game on/off plus-minus × minutes (team margin with him on vs off the floor,
           from box +/- and final scores). Weight-free, noisy. The tiebreaker.
A finding is "robust" only if all three agree (same sign, 90% CI excludes 0).
  career   Window check: a 4-season window flatters older draftees (closer to peak), so
           drafts from final seasons ≤2016 are re-tested on whole-career value + minutes.
  (On/off runs slightly BACKWARDS vs pick — garbage-time bench +/- — so it is reported,
  not trusted on its own.)

Output: ../nba_translate.json (site data file) + a readable report on stdout.
"""
import json, math, sys
from pathlib import Path
import numpy as np
import pandas as pd
import requests
from scipy.stats import spearmanr, pearsonr
from sklearn.isotonic import IsotonicRegression

HERE = Path(__file__).parent
DATA = HERE / "data"
OUT = HERE.parent / "nba_translate.json"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
ANON = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": ANON, "Authorization": f"Bearer {ANON}"}
RNG = np.random.default_rng(7)
POWER = {"ACC", "Atlantic Coast Conference", "Big Ten Conference", "Big 12 Conference",
         "Southeastern Conference", "Pac-12 Conference", "Big East Conference"}

# college stats tested in the draft-gap analysis: column -> plain label
STATS = {
    "c_ti40": "TDC Impact per 40", "c_pts40": "Points per 40", "c_reb40": "Rebounds per 40",
    "c_ast40": "Assists per 40", "c_ts_pct": "True shooting %", "c_tp_pct": "3P%",
    "c_ft_pct": "FT%", "tpa_rate": "3PA rate (3PA/FGA)", "fta_rate": "FT rate (FTA/FGA)",
    "c_usg_pct": "Usage %", "c_ast_pct": "Assist %", "c_tov_pct": "Turnover %",
    "ast_tov": "Assist / turnover", "c_orb_pct": "Off. rebound %", "c_drb_pct": "Def. rebound %",
    "c_stl_pct": "Steal %", "c_blk_pct": "Block %", "stocks": "Steal % + Block %",
    "height_in": "Height", "college_seasons": "College seasons (age proxy)",
    "c_ti40_jump": "TI/40 jump vs prior season", "team_srs": "Team strength (power rating)",
    "c_min": "Final-season minutes",
}
# college -> NBA translation pairs (bridge col, nba window col, label)
PAIRS = [("c_ts_pct", "n_ts", "True shooting %"), ("c_tp_pct", "n_tp", "3P%"),
         ("c_ft_pct", "n_ft", "FT%"), ("c_usg_pct", "n_usg", "Usage %"),
         ("c_ast_pct", "n_ast_pct", "Assist %"), ("c_tov_pct", "n_tov_pct", "Turnover %"),
         ("c_orb_pct", "n_orb_pct", "Off. rebound %"), ("c_drb_pct", "n_drb_pct", "Def. rebound %"),
         ("c_stl_pct", "n_stl_pct", "Steal %"), ("c_blk_pct", "n_blk_pct", "Block %"),
         ("tpa_rate", "n_tpa_rate", "3PA rate"), ("fta_rate", "n_fta_rate", "FT rate"),
         ("c_ti40", "n_ti40", "TDC Impact per 40")]


def sb_all(table, select, order, **flt):
    out, step = [], 1000
    while True:
        r = requests.get(f"{SB}/rest/v1/{table}", headers={**H, "Range": f"{len(out)}-{len(out)+step-1}"},
                         params={"select": select, "order": order, **flt}, timeout=90)
        r.raise_for_status(); b = r.json(); out += b
        if len(b) < step: return out


def jl(p):
    out = []
    for l in Path(p).read_text().splitlines():
        try: out.append(json.loads(l))
        except Exception: pass
    return out


def rnd(x, n=3):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), n)


def boot_spear(x, y, n=600):
    """Spearman r + 90% bootstrap CI."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    m = ~(np.isnan(x) | np.isnan(y)); x, y = x[m], y[m]
    if len(x) < 25: return None
    r = spearmanr(x, y).statistic
    bs = []
    for _ in range(n):
        i = RNG.integers(0, len(x), len(x))
        bs.append(spearmanr(x[i], y[i]).statistic)
    lo, hi = np.nanpercentile(bs, [5, 95])
    return {"r": rnd(r), "lo": rnd(lo), "hi": rnd(hi), "n": int(len(x))}


def size_group(row):
    h = row["height_in"]
    if pd.notna(h):
        return "Guard" if h <= 76 else ("Wing" if h <= 80 else "Big")
    p = str(row.get("pos") or "")
    return {"G": "Guard", "F": "Wing", "C": "Big"}.get(p[:1]) if p else None


def load():
    B = pd.read_csv(DATA / "nba_bridge.csv", dtype={"espn_id": str, "nba_espn_id": str})
    B["first_season_censored"] = B["first_season_censored"].astype(str) == "True"
    B["window_complete"] = B["window_complete"].astype(str) == "True"

    # college shot volume (player_history is per-game; 2012+) for 3PA/FT rates + shooting samples
    ids = set(B.loc[B["nba_espn_id"].notna() | B["draft_pick"].notna(), "espn_id"])
    hist = sb_all("player_history", "espn_id,season_year,gp,fga,tpa,tpm,fta,ftm", "id.asc")
    ph = pd.DataFrame([h for h in hist if h.get("espn_id")])
    ph["espn_id"] = ph["espn_id"].astype(str)
    for k in ("gp", "fga", "tpa", "tpm", "fta", "ftm"):
        ph[k] = pd.to_numeric(ph[k], errors="coerce")
    for k in ("fga", "tpa", "tpm", "fta", "ftm"):
        ph[k + "_t"] = ph[k] * ph["gp"]
    fin = B[["espn_id", "final_season"]].merge(ph, left_on=["espn_id", "final_season"],
                                                right_on=["espn_id", "season_year"], how="left")
    fin = fin.groupby("espn_id")[["fga_t", "tpa_t", "fta_t"]].sum(min_count=1)
    car = ph[ph["espn_id"].isin(ids)].groupby("espn_id")[["tpm_t", "tpa_t", "ftm_t", "fta_t"]].sum(min_count=1)
    car.columns = ["car_tpm", "car_tpa", "car_ftm", "car_fta"]
    B = B.merge(fin, left_on="espn_id", right_index=True, how="left") \
         .merge(car, left_on="espn_id", right_index=True, how="left")
    B["tpa_rate"] = B["tpa_t"] / B["fga_t"].where(B["fga_t"] > 0)
    B["fta_rate"] = B["fta_t"] / B["fga_t"].where(B["fga_t"] > 0)
    B["car_tp_pct"] = B["car_tpm"] / B["car_tpa"].where(B["car_tpa"] >= 40)
    B["ast_tov"] = B["c_ast_pct"] / B["c_tov_pct"].where(B["c_tov_pct"] > 0)
    B["stocks"] = B["c_stl_pct"] + B["c_blk_pct"]
    B["c_ti40_jump"] = B["c_ti40"] - B["c_ti40_prev"]
    B.loc[B["first_season_censored"], "college_seasons"] = np.nan   # may have played pre-2010
    # height: college listing, else draft-record height (every pick has one)
    dr = {(str(d.get("college_athlete_id"))): d for d in jl(DATA / "nba_draft.jsonl") if d.get("college_athlete_id")}
    B["height_in"] = B["height_in"].fillna(B["espn_id"].map(lambda e: (dr.get(e) or {}).get("height_in")))
    B["group"] = B.apply(size_group, axis=1)
    B["power"] = B["conference"].isin(POWER)
    return B


def nba_window(B):
    """Minute-weighted NBA rates + shooting over each player's 4-season window."""
    ps = json.load(open(DATA / "nba_player_seasons.json"))
    tot = {(r["espn_id"], r["season"]): r["stats"] for r in jl(DATA / "nba_seasons.jsonl")
           if r.get("season_type") == "regular" and r.get("stats")}
    rows = []
    for _, b in B[B["nba_espn_id"].notna()].iterrows():
        nid, F = b["nba_espn_id"], int(b["final_season"])
        acc = {k: 0.0 for k in ("min", "ts", "usg", "ast", "tov", "orb", "drb", "stl", "blk", "ti40")}
        sh = {k: 0.0 for k in ("tpm", "tpa", "ftm", "fta", "fga")}
        for y in range(F + 1, F + 5):
            a = ps.get(f"{nid}|{y}")
            if a and a["min"] >= 100:
                m = a["min"]; acc["min"] += m
                for k, c in (("ts", "ts_pct"), ("usg", "usg_pct"), ("ast", "ast_pct"), ("tov", "tov_pct"),
                             ("orb", "orb_pct"), ("drb", "drb_pct"), ("stl", "stl_pct"), ("blk", "blk_pct"),
                             ("ti40", "ti40")):
                    acc[k] += (a.get(c) or 0) * m
            t = tot.get((nid, y))
            if t:   # ESPN season totals: complete even where box scores are blank (CHI/NO 2013-18)
                sh["tpm"] += t.get("threePointFieldGoalsMade") or 0; sh["tpa"] += t.get("threePointFieldGoalsAttempted") or 0
                sh["ftm"] += t.get("freeThrowsMade") or 0; sh["fta"] += t.get("freeThrowsAttempted") or 0
                sh["fga"] += t.get("fieldGoalsAttempted") or 0
        if acc["min"] < 1000: continue
        m = acc["min"]
        rows.append({"espn_id": b["espn_id"], "n_min": m,
                     "n_ts": acc["ts"] / m, "n_usg": acc["usg"] / m, "n_ast_pct": acc["ast"] / m,
                     "n_tov_pct": acc["tov"] / m, "n_orb_pct": acc["orb"] / m, "n_drb_pct": acc["drb"] / m,
                     "n_stl_pct": acc["stl"] / m, "n_blk_pct": acc["blk"] / m, "n_ti40": acc["ti40"] / m,
                     "n_tp": sh["tpm"] / sh["tpa"] if sh["tpa"] >= 100 else np.nan,
                     "n_ft": sh["ftm"] / sh["fta"] if sh["fta"] >= 100 else np.nan,
                     "n_tpa_rate": sh["tpa"] / sh["fga"] if sh["fga"] >= 200 else np.nan,
                     "n_fta_rate": sh["fta"] / sh["fga"] if sh["fga"] >= 200 else np.nan})
    return pd.DataFrame(rows)


def onoff_by_player(B):
    """College espn_id -> in-game on/off net points over the 4-season window.

    Per game he played: on = his +/-, off = team margin − his +/-, off minutes = 48 − his min
    (OT ignored). Window rate diff × his minutes / 48 = net points vs his own team's other
    lineups. Games with blank box (CHI/NO 2013-18) carry no +/- and drop out.
    """
    G = {g["game_id"]: g for g in jl(DATA / "nba_games.jsonl") if not g.get("missing")}
    acc = {}
    for r in jl(DATA / "nba_box.jsonl"):
        if r.get("season_type") != "regular" or r.get("dnp") or not r.get("min") or r.get("pm") is None:
            continue
        g = G.get(r["game_id"])
        if not g or g.get("home_score") is None: continue
        marg = (g["home_score"] - g["away_score"]) * (1 if r["home"] else -1)
        a = acc.setdefault((r["espn_id"], r["season"]), [0, 0, 0, 0])   # on_pm, on_min, off_pm, off_min
        a[0] += r["pm"]; a[1] += r["min"]; a[2] += marg - r["pm"]; a[3] += max(0, 48 - r["min"])
    out = {}
    for _, b in B[B["nba_espn_id"].notna()].iterrows():
        F, tot = int(b["final_season"]), [0, 0, 0, 0]
        for y in range(F + 1, F + 5):
            a = acc.get((b["nba_espn_id"], y))
            if a: tot = [t + x for t, x in zip(tot, a)]
        if tot[1] >= 100 and tot[3] >= 100:
            out[b["espn_id"]] = (tot[0] / tot[1] - tot[2] / tot[3]) * tot[1]   # net pts (per-min diff × min)
    return out


def group_table(D, key, min_n, label_map=None):
    out = []
    for k, g in D.groupby(key):
        if len(g) < min_n: continue
        out.append({"key": label_map.get(k, k) if label_map else (int(k) if isinstance(k, (np.integer, float)) and float(k).is_integer() else k),
                    "n": int(len(g)), "avg_pick": rnd(g["draft_pick"].mean(), 1),
                    "rotation_plus": rnd((g["tier_w4"] >= 2).mean()),
                    "starter_plus": rnd((g["tier_w4"] >= 3).mean()),
                    "never_played": rnd((g["nba_espn_id"].isna()).mean()),
                    "value_over_slot": rnd(g["resid"].mean(), 1),
                    "median_over_slot": rnd(g["resid"].median(), 1),
                    "minutes_over_slot": rnd(g["resid_min"].mean(), 0),
                    "top": g.nlargest(2, "resid")["name"].tolist(),
                    "beat_slot": rnd((g["resid"] > 0).mean())})
    return sorted(out, key=lambda r: -(r["value_over_slot"] or -1e9))


def main():
    B = load()
    D = B[B["window_complete"] & B["draft_pick"].notna()].copy()
    D["draft_pick"] = D["draft_pick"].astype(float)
    D["nba_par_w4"] = D["nba_par_w4"].fillna(0)
    iso = IsotonicRegression(increasing=False, out_of_bounds="clip").fit(D["draft_pick"], D["nba_par_w4"])
    D["expected"] = iso.predict(D["draft_pick"])
    D["resid"] = D["nba_par_w4"] - D["expected"]
    D["nba_min_w4"] = D["nba_min_w4"].fillna(0)
    iso_m = IsotonicRegression(increasing=False, out_of_bounds="clip").fit(D["draft_pick"], D["nba_min_w4"])
    D["resid_min"] = D["nba_min_w4"] - iso_m.predict(D["draft_pick"])
    oo = onoff_by_player(B)
    D["onoff_w4"] = D["espn_id"].map(oo).fillna(0)         # never played / tiny sample = 0
    iso_o = IsotonicRegression(increasing=False, out_of_bounds="clip").fit(D["draft_pick"], D["onoff_w4"])
    D["resid_onoff"] = D["onoff_w4"] - iso_o.predict(D["draft_pick"])
    print(f"  on/off computed for {D['espn_id'].isin(oo).sum()} drafted players; "
          f"pick→on/off rank corr {spearmanr(D['draft_pick'], D['onoff_w4']).statistic:+.2f}")
    curve = [{"pick": p, "expected_par": rnd(iso.predict([p])[0], 1)} for p in (1, 2, 3, 5, 10, 15, 20, 30, 40, 50, 60)]
    print(f"Drafted, complete window: {len(D)} players ({int(D['draft_year'].min())}-{int(D['draft_year'].max())} drafts)")
    print("  expected value by pick:", ", ".join(f"#{c['pick']} {c['expected_par']}" for c in curve))

    # 1. draft gap
    gap = []
    for col, lab in STATS.items():
        if col not in D: continue
        drafted = boot_spear(D[col], -D["draft_pick"])        # + = higher stat → picked earlier
        value = boot_spear(D[col], D["resid"])                # + = higher stat → beats slot
        mins = boot_spear(D[col], D["resid_min"])             # same, on NBA minutes over slot
        onoff = boot_spear(D[col], D["resid_onoff"])          # same, on on/off net points over slot
        if not drafted or not value: continue
        by = {}
        for grp in ("Guard", "Wing", "Big"):
            s = D[D["group"] == grp]
            v = boot_spear(s[col], s["resid"], n=300)
            if v: by[grp] = v
        sig = lambda v: v["lo"] > 0 or v["hi"] < 0
        trio = (value, mins, onoff)
        robust = all(sig(v) for v in trio) and len({v["r"] > 0 for v in trio}) == 1
        gap.append({"stat": col, "label": lab, "draft_rewards": drafted, "beats_slot": value,
                    "beats_slot_minutes": mins, "beats_slot_onoff": onoff, "robust": robust,
                    "onoff_sig": sig(onoff), "by_group": by})
    gap.sort(key=lambda g: -g["beats_slot"]["r"])
    print("\n1. WHAT THE DRAFT MISSES  (rank corr with outcome over slot; * = 90% CI excludes 0; ** = all three agree)")
    st = lambda v: f"{v['r']:+.2f}{'*' if v['lo'] > 0 or v['hi'] < 0 else ' '}"
    gap.sort(key=lambda g: -g["beats_slot_onoff"]["r"])
    for g in gap:
        v, d, m, o = g["beats_slot"], g["draft_rewards"], g["beats_slot_minutes"], g["beats_slot_onoff"]
        print(f"  {'**' if g['robust'] else '  '} {g['label']:<30} on/off {st(o)}  value {st(v)}  minutes {st(m)}"
              f"   draft rewards {d['r']:+.2f}  n={v['n']}")
        gg = g["by_group"]
        if g["robust"] and gg:
            print("       by size: " + "  ".join(f"{k} {x['r']:+.2f} (n={x['n']})" for k, x in gg.items()))

    # 1b. career-window check (final college season <= 2016: 10 NBA seasons of runway)
    C = B[B["draft_pick"].notna() & (B["final_season"] <= 2016)].copy()
    C["draft_pick"] = C["draft_pick"].astype(float)
    for oc in ("nba_par", "nba_min"):
        C[oc] = C[oc].fillna(0)
        f = IsotonicRegression(increasing=False, out_of_bounds="clip").fit(C["draft_pick"], C[oc])
        C["r_" + oc] = C[oc] - f.predict(C["draft_pick"])
    for g in gap:
        g["career_value"] = boot_spear(C[g["stat"]], C["r_nba_par"], 300)
        g["career_minutes"] = boot_spear(C[g["stat"]], C["r_nba_min"], 300)
        sg = lambda v: bool(v) and (v["lo"] > 0 or v["hi"] < 0)
        w4m, cm = g["beats_slot_minutes"], g["career_minutes"]
        # the finding that survives both windows: minutes over slot, same sign, both significant
        g["minutes_holds_career"] = sg(w4m) and sg(cm) and (w4m["r"] > 0) == (cm["r"] > 0)
    print(f"\n1b. CAREER CHECK (final season ≤2016, n={len(C)}) — minutes-over-slot findings that hold on whole careers:")
    for g in gap:
        if g["minutes_holds_career"]:
            print(f"  {g['label']:<30} 4-yr minutes {g['beats_slot_minutes']['r']:+.2f}  career minutes {g['career_minutes']['r']:+.2f}"
                  f"   (career value {g['career_value']['r']:+.2f})")
    career_class = group_table(C.assign(resid=C["r_nba_par"], resid_min=C["r_nba_min"],
                                        tier_w4=C["tier_career"],
                                        class_key=C["college_seasons"].map(lambda s: None if pd.isna(s) else
                                            {1: "1 season", 2: "2 seasons", 3: "3 seasons", 4: "4 seasons"}.get(int(s), "5+ seasons"))
                                        ).dropna(subset=["class_key"]), "class_key", 12)

    # 2. translation
    W = nba_window(B)
    T = B.merge(W, on="espn_id")
    trans = []
    for c, n, lab in PAIRS:
        s = T[[c, n]].dropna()
        if c in ("c_tp_pct",):
            s = T.loc[(T["tpa_t"] >= 40), [c, n]].dropna()
        if c in ("c_ft_pct",):
            s = T.loc[(T["fta_t"] >= 40), [c, n]].dropna()
        if len(s) < 30: continue
        r = pearsonr(s[c], s[n]).statistic
        slope, icpt = np.polyfit(s[c], s[n], 1)
        trans.append({"stat": lab, "college": c, "nba": n, "n": int(len(s)), "r": rnd(r),
                      "slope": rnd(slope), "intercept": rnd(icpt, 4),
                      "college_mean": rnd(s[c].mean(), 4), "nba_mean": rnd(s[n].mean(), 4),
                      "retention": rnd(s[n].mean() / s[c].mean()) if s[c].mean() else None})
    trans.sort(key=lambda t: -t["r"])
    print(f"\n2. HOW STATS TRANSLATE  (college final season → NBA first 4 yrs, ≥1,000 NBA min; n players)")
    for t in trans:
        print(f"  {t['stat']:<22} r {t['r']:+.2f}  college {t['college_mean']:.3f} → NBA {t['nba_mean']:.3f} "
              f"(keeps {100*t['retention']:.0f}%)  n={t['n']}")
    # best predictor of NBA 3P%
    S = T[(T["n_tp"].notna()) & (T["tpa_t"] >= 40) & (T["fta_t"] >= 40)].copy()
    tp_pred = {}
    for c, lab in (("c_tp_pct", "College 3P% (final season)"), ("car_tp_pct", "College 3P% (career)"),
                   ("c_ft_pct", "College FT% (final season)")):
        s = S[[c, "n_tp"]].dropna()
        tp_pred[c] = {"label": lab, "r": rnd(pearsonr(s[c], s["n_tp"]).statistic), "n": int(len(s))}
    s = S[["car_tp_pct", "c_ft_pct", "n_tp"]].dropna()
    X = np.c_[np.ones(len(s)), s["car_tp_pct"], s["c_ft_pct"]]
    beta = np.linalg.lstsq(X, s["n_tp"], rcond=None)[0]
    tp_pred["blend"] = {"label": "Blend: career 3P% + FT%", "r": rnd(np.corrcoef(X @ beta, s["n_tp"])[0, 1]),
                        "n": int(len(s)), "weights": {"intercept": rnd(beta[0], 4), "car_tp_pct": rnd(beta[1]), "c_ft_pct": rnd(beta[2])}}
    print("  NBA 3P% predicted by:", "; ".join(f"{v['label']} r={v['r']:.2f}" for v in tp_pred.values()))

    # 3-5. groups
    arch = group_table(D[D["final_season"] >= 2014], "archetype", 12)
    D["class_key"] = D["college_seasons"].map(lambda s: None if pd.isna(s) else
                                              {1: "1 season", 2: "2 seasons", 3: "3 seasons", 4: "4 seasons"}.get(int(s), "5+ seasons"))
    cls = group_table(D[D["class_key"].notna()], "class_key", 12)
    prog = group_table(D, "final_team", 10)
    conf = group_table(D, "conference", 10)
    pw = group_table(D, "power", 10, {True: "Power conference", False: "Everyone else"})
    for title, tab in (("3. BY ARCHETYPE (final season 2014+)", arch), ("4. BY COLLEGE SEASONS", cls),
                       ("5a. POWER vs EVERYONE ELSE", pw), ("5b. CONFERENCES (n≥10)", conf),
                       ("5c. PROGRAMS (n≥10)", prog)):
        print(f"\n{title}")
        for r in tab:
            print(f"  {str(r['key']):<34} n={r['n']:<3} pick {r['avg_pick']:>5}  rotation+ {100*r['rotation_plus']:>3.0f}%  "
                  f"starter+ {100*r['starter_plus']:>3.0f}%  value/slot {r['value_over_slot']:+6.1f} (median {r['median_over_slot']:+6.1f})  "
                  f"min/slot {r['minutes_over_slot']:+5.0f}  beat {100*r['beat_slot']:.0f}%  [{', '.join(r['top'])}]")

    # biggest steals / busts vs slot (for the page)
    cols = ["name", "final_team", "draft_year", "draft_pick", "nba_par_w4", "expected", "resid", "tier_w4_name", "archetype"]
    steals = D.nlargest(15, "resid")[cols]; busts = D.nsmallest(15, "resid")[cols]
    out = {
        "meta": {"built": pd.Timestamp.now().strftime("%Y-%m-%d"), "n_drafted": int(len(D)),
                 "drafts": [int(D["draft_year"].min()), int(D["draft_year"].max())],
                 "outcome": "TI points above replacement, first 4 NBA seasons (nba_par_w4)",
                 "window": "the 4 NBA seasons after the final college season"},
        "pick_curve": curve, "draft_gap": gap, "translation": trans, "three_point_predictors": tp_pred,
        "archetype": arch, "class": cls, "class_career": career_class, "power": pw, "conferences": conf, "programs": prog,
        "steals": json.loads(steals.round(1).to_json(orient="records")),
        "busts": json.loads(busts.round(1).to_json(orient="records")),
    }
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print(f"\nwrote {OUT.name} ({OUT.stat().st_size//1024} KB)")
    print("steals:", ", ".join(f"{r['name']} (#{int(r['draft_pick'])})" for r in out["steals"][:8]))
    print("busts:", ", ".join(f"{r['name']} (#{int(r['draft_pick'])})" for r in out["busts"][:8]))


if __name__ == "__main__":
    sys.exit(main())
