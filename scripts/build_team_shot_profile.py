#!/usr/bin/env python3
"""build_team_shot_profile.py — the Team Shot Profile sheet (team page Shots tab + the all-teams view on shot-quality.html).

One row of numbers per team-season on OFFENSE and the same numbers ALLOWED on DEFENSE, 2009-10 on, all from our own
ESPN play-by-play (D-I vs D-I games):

  eff     points per 100 possessions
  ftr/ft  free-throw attempts per 100 possessions · FT%
  fga/fg  field-goal attempts per 100 · FG%
  rim/rimp, mid/midp, tpa/tp   attempts per 100 and make % at the rim (layups, dunks, tips, ≤4 ft), other twos, threes
  rimS/midS/tS   share of field-goal attempts from each
  range   average shot distance on a 1-3 scale (1 = every shot at the rim, 2 = every shot a two-point jumper, 3 = all threes)
  orb/scp/ppo    offensive rebounds kept on first-chance misses (%) · second-chance points per 100 possessions ·
                 points per offensive rebound
  pto/tov        points per 100 possessions on trips that started with a turnover · turnover-start share of possessions
  tr/trp         share of possessions with a shot, trip or turnover inside 10 seconds · points per such trip
  q/m            shot quality vs D-I and shot-making (schedule-adjusted, shrunk) from build_shot_quality.py
  self/pull      share of made FGs unassisted (2011-12 on) · pull-up share of FGA (2025-26 on) — offense only

Every number is stored RAW and ADJUSTED FOR SCHEDULE ("vs an average opponent"): offense and defense solved together
over every D-I vs D-I game, the way build_shot_quality.py adjusts shot-making, so a team's 3P% allowed is judged
against the shooting of the offenses it actually faced.

Inputs: shot_quality/<y>.json, shot_aftermath/sc_<y>.json + poss_<y>.json, Supabase games.
    python3 scripts/build_team_shot_profile.py [season ...]   -> scripts/data/team_shot_profile/<y>.json + index.json
"""
import json, os, sys, glob, urllib.request, datetime

HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, "data")
SQ, SA, OUT = os.path.join(DATA, "shot_quality"), os.path.join(DATA, "shot_aftermath"), os.path.join(DATA, "team_shot_profile")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"; KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
# metric order in the file; ADJ = adjusted for schedule (rates/efficiencies an opponent moves); the rest are raw only
COLS = ["eff", "ftr", "ft", "fga", "fg", "rim", "rimp", "mid", "midp", "tpa", "tp", "rimS", "midS", "tS", "range",
        "orb", "scp", "ppo", "pto", "tov", "tr", "trp", "q", "m", "self", "pull"]
ADJ = {"eff", "ftr", "ft", "fga", "fg", "rim", "rimp", "mid", "midp", "tpa", "tp", "rimS", "midS", "tS", "range", "orb", "scp", "ppo", "pto", "tov", "tr", "trp"}
# 3 passes, not convergence: the fully solved additive model spreads teams far past reality (Purdue offense 140,
# Houston defense 81 per 100); 2-4 passes land on believable values (≈131 / ≈90)
ITERS = int(os.environ.get("SP_ITERS", 3))
DEC = {"ft": 1, "fg": 1, "rimp": 1, "midp": 1, "tp": 1, "rimS": 1, "midS": 1, "tS": 1, "range": 2, "orb": 1, "ppo": 2, "trp": 2, "tov": 1, "tr": 1, "q": 3, "m": 3, "self": 1, "pull": 1}


def get(q):
    out = []
    for off in range(0, 100000, 1000):
        for tries in range(4):
            try:
                r = json.load(urllib.request.urlopen(urllib.request.Request(SB + q + f"&limit=1000&offset={off}", headers=H), timeout=60)); break
            except Exception:
                if tries == 3: raise
        out += r
        if len(r) < 1000: return out
    return out


def pct(a, b): return 100.0 * a / b if b else None


def season(y):
    if not os.path.exists(os.path.join(SQ, f"{y}.json")): print(f"{y}: no shot_quality file yet - skipped"); return
    S = json.load(open(os.path.join(SQ, f"{y}.json")))
    scp = os.path.join(SA, f"sc_{y}.json"); SC = json.load(open(scp))["teams"] if os.path.exists(scp) else {}
    pp = os.path.join(SA, f"poss_{y}.json"); PS = json.load(open(pp))["teams"] if os.path.exists(pp) else {}
    TI = {c: i for i, c in enumerate(S["tcols"])}; G = S["groups"]; gi = {g: i for i, g in enumerate(G)}
    rows = {}
    for side in ("off", "def"):
        for r in S["teams"].get(side, []):
            tid = r[0]; poss = r[TI["poss"]]; g = r[TI["g"]]
            cnt = lambda k: g[gi[k]] if g[gi[k]] else [0, 0]
            rim = cnt("rim"); tp = [cnt("pull3")[0] + cnt("three")[0], cnt("pull3")[1] + cnt("three")[1]]
            mid = [sum(cnt(k)[0] for k in ("float", "post", "pull2", "j2")), sum(cnt(k)[1] for k in ("float", "post", "pull2", "j2"))]
            ft = cnt("ft"); fga = rim[0] + mid[0] + tp[0]; k = 100.0 / poss
            v = {"eff": r[TI["pts100"]], "ftr": ft[0] * k, "ft": pct(ft[1], ft[0]), "fga": fga * k, "fg": pct(rim[1] + mid[1] + tp[1], fga),
                 "rim": rim[0] * k, "rimp": pct(rim[1], rim[0]), "mid": mid[0] * k, "midp": pct(mid[1], mid[0]), "tpa": tp[0] * k, "tp": pct(tp[1], tp[0]),
                 "rimS": pct(rim[0], fga), "midS": pct(mid[0], fga), "tS": pct(tp[0], fga),
                 "range": (rim[0] + 2 * mid[0] + 3 * tp[0]) / fga if fga else None,
                 "q": r[TI["qA"]], "m": r[TI["mS"]], "self": pct(r[TI["self"]], 1) if (side == "off" and r[TI["self"]] is not None) else None,
                 "pull": pct(cnt("pull2")[0] + cnt("pull3")[0], fga) if (side == "off" and g[gi["pull3"]] is not None) else None}
            sc = (SC.get(tid) or {}).get(side)
            if sc and sc[0]: v.update({"orb": pct(sc[1], sc[0]), "scp": sc[2] * k, "ppo": sc[2] / sc[1] if sc[1] else None})
            st = ((PS.get(tid) or {}).get(side) or {})
            to = (st.get("st") or {}).get("to"); trn = (st.get("tm") or {}).get("tr")
            n_all = sum(a[0] for a in (st.get("st") or {}).values()) or None
            if to and n_all: v.update({"pto": to[1] * k, "tov": pct(to[0], n_all)})
            if trn and n_all: v.update({"tr": pct(trn[0], n_all), "trp": trn[1] / trn[0] if trn[0] else None})
            rows.setdefault(tid, {"id": tid, "name": r[TI["name"]], "conf": r[TI["conf"]], "poss": poss})[side] = v

    # ---- schedule adjustment, every ADJ metric: offense vs the defenses it met, defense vs the offenses it met
    games = get(f"games?season_year=eq.{y}&status=eq.STATUS_FINAL&select=id,home_id,away_id&order=id.asc")
    both = {t for t, r in rows.items() if "off" in r and "def" in r}
    opp = {}
    for gm in games:
        h, a = str(gm["home_id"]), str(gm["away_id"])
        if h in both and a in both: opp.setdefault(h, []).append(a); opp.setdefault(a, []).append(h)
    for key in ADJ:
        off = {t: rows[t]["off"].get(key) for t in both}; dfn = {t: rows[t]["def"].get(key) for t in both}
        ok = [t for t in both if off[t] is not None and dfn[t] is not None]
        if len(ok) < 50: continue
        mo, md = sum(off[t] for t in ok) / len(ok), sum(dfn[t] for t in ok) / len(ok)
        oa, da = {t: off[t] for t in ok}, {t: dfn[t] for t in ok}
        for _ in range(ITERS):
            # an opponent's tilt = how far its adjusted value sits from the league mean; subtract the average tilt faced
            oa_n = {t: off[t] - (sum(da[o] - md for o in opp.get(t, []) if o in da) / max(1, sum(1 for o in opp.get(t, []) if o in da))) for t in ok}
            da_n = {t: dfn[t] - (sum(oa[o] - mo for o in opp.get(t, []) if o in oa) / max(1, sum(1 for o in opp.get(t, []) if o in oa))) for t in ok}
            oa, da = oa_n, da_n
        for t in ok: rows[t]["offA_" + key] = oa[t]; rows[t]["defA_" + key] = da[t]

    def pack(r, side):
        v = r.get(side) or {}
        raw = [None if v.get(c) is None else round(v[c], DEC.get(c, 1)) for c in COLS]
        adj = [None if (c not in ADJ or r.get(side + "A_" + c) is None) else round(r[side + "A_" + c], DEC.get(c, 1)) for c in COLS]
        return [raw, adj]
    teams = [[r["id"], r["name"], r["conf"], r["poss"], pack(r, "off"), pack(r, "def")] for r in sorted(rows.values(), key=lambda r: r["id"]) if "off" in r and "def" in r]
    # league averages (team-weighted means of raw values) for the colour midpoints and the footer row
    lg = {}
    for side, j in (("off", 4), ("def", 5)):
        lg[side] = [None] * len(COLS)
        for i in range(len(COLS)):
            xs = [t[j][0][i] for t in teams if t[j][0][i] is not None]
            lg[side][i] = round(sum(xs) / len(xs), DEC.get(COLS[i], 1)) if xs else None
    out = {"season": y, "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "cols": COLS, "adj": sorted(ADJ),
           "tcols": ["id", "name", "conf", "poss", "off[raw,adj]", "def[raw,adj]"], "teams": teams, "league": lg, "live": S.get("live")}
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, f"{y}.json")
    try:
        old = json.load(open(p)); old["built"] = out["built"]
        if old == json.loads(json.dumps(out)): print(f"{y}: unchanged"); return
    except Exception: pass
    json.dump(out, open(p, "w"), separators=(",", ":"))
    print(f"{y}: {len(teams)} teams · {len(games)} games · sc {'yes' if SC else 'NO'} · poss {'yes' if PS else 'NO'}")


if __name__ == "__main__":
    ys = [int(a) for a in sys.argv[1:]] or sorted(int(os.path.basename(f)[:4]) for f in glob.glob(os.path.join(SQ, "[0-9][0-9][0-9][0-9].json")))
    for y in ys: season(y)
    idx = sorted((int(os.path.basename(f)[:4]) for f in glob.glob(os.path.join(OUT, "[0-9][0-9][0-9][0-9].json"))), reverse=True)
    ip = os.path.join(OUT, "index.json")
    try: had = json.load(open(ip)).get("seasons")
    except Exception: had = None
    if had != idx: json.dump({"seasons": idx}, open(ip, "w"))
