"""build_luck.py — Team Luck (owner, Nov 22 2026: "add turnovers and the volatile things that either are or are not going a
team's way"). One model, used everywhere luck shows up (rankings, team page, On/Off "Luck-adjusted").

IDEA. Every box rate a team posts = its real level + noise. How much is real is measured, not assumed: split each team's
season into odd and even games; the covariance of the two halves across teams is the variance of the REAL part (noise in
odd games doesn't repeat in even games). For a sample of n attempts the reliable share is

    R(n) = tv / (tv + c / n)          tv = true-level variance (split-half covariance), c = per-attempt noise

and the luck in a stat = (1 - R) x (observed - D-I average): the part of the gap that shouldn't be expected to last.
Each stat's luck is turned into points (3P% x threes x 3, turnover rate x possessions x points per possession, …),
both ends (the opponent's 3P% / FT% / turnovers against this team), per 100 possessions. Close games are separate:
wins minus the wins its scoring margin predicts.

  python3 scripts/build_luck.py --fit           # reliabilities from 2023-2026 (scripts/data/team_games/*.json)
  python3 scripts/build_luck.py --season 2027   # -> scripts/data/team_luck_2027.json (+ the model, luck_model.json)
  python3 scripts/build_luck.py --backtest      # does removing luck predict the rest of the season better?
"""
import argparse, json, math, os, random
from collections import defaultdict

DATA = os.path.join(os.path.dirname(__file__), "data")
TG = os.path.join(DATA, "team_games")
FIT_SEASONS = [2023, 2024, 2025, 2026]

# stat: (numerator, denominator, points per unit of rate x denominator, side)  side +1 = good when high for the team
# '#2pa' etc are derived counts. 'ppp' = the season's D-I points per possession (value of a possession).
def counts(b):
    two_m, two_a = b["fgm"] - b["tpm"], b["fga"] - b["tpa"]
    return {"tpm": b["tpm"], "tpa": b["tpa"], "twom": two_m, "twoa": two_a, "ftm": b["ftm"], "fta": b["fta"],
            "tov": b["tov"], "poss": poss(b), "orb": b["oreb"], "stl": b.get("stl", 0), "fga": b["fga"]}

def poss(b): return max(1.0, b["fga"] - b["oreb"] + b["tov"] + 0.44 * b["fta"])

# [key, label, num, den, value, sign, owner]  value: points per unit (rate x den); sign +1: higher is good for the team
STATS = [
    ["tp",   "3P%",            "tpm",  "tpa",  3.0,   +1, "o"],
    ["two",  "2P%",            "twom", "twoa", 2.0,   +1, "o"],
    ["ft",   "FT%",            "ftm",  "fta",  1.0,   +1, "o"],
    ["tov",  "Turnovers",      "tov",  "poss", "ppp", -1, "o"],
    ["orb",  "Off. rebounds",  "orb",  "orbo", "ppp", +1, "o"],
    ["otp",  "Opp 3P%",        "tpm",  "tpa",  3.0,   -1, "d"],
    ["otwo", "Opp 2P%",        "twom", "twoa", 2.0,   -1, "d"],
    ["oft",  "Opp FT%",        "ftm",  "fta",  1.0,   -1, "d"],
    ["otov", "Forced turnovers", "tov", "poss", "ppp", +1, "d"],
    ["drb",  "Def. rebounds",  "orb",  "orbo", "ppp", -1, "d"],   # the opponent's offensive rebounds against this team
]

def load(season):
    fp = os.path.join(TG, f"{season}.json")
    J = json.load(open(fp)); F = J["fields"]
    by = defaultdict(dict)
    for g in J["games"]:
        r = dict(zip(F, g)); by[r["game_id"]][r["team"]] = r
    out = defaultdict(list)   # team -> [(date, own counts, opp counts, own pts, opp pts)]
    for gid, sides in by.items():
        if len(sides) != 2: continue
        a, b = list(sides.values())
        if a["fga"] < 25 or b["fga"] < 25: continue   # partial boxes
        for me, op in ((a, b), (b, a)):
            co, cd = counts(me), counts(op)
            co["orbo"] = me["oreb"] + op["dreb"]; cd["orbo"] = op["oreb"] + me["dreb"]
            out[me["team"]].append((me["date"], gid, co, cd, me["pts"], op["pts"], op["team"]))
    for t in out: out[t].sort()
    return out

def profiles(teams):
    """each team's season rates on offense ('o') and allowed ('d'), for the opponent adjustment"""
    P = {}
    for t, gs in teams.items():
        P[t] = {}
        for side in ("o", "d"):
            s = defaultdict(float)
            for g in gs:
                for k, v in (g[2] if side == "o" else g[3]).items(): s[k] += v
            P[t][side] = s
    return P

def opp_of(gs_entry): return gs_entry[6] if len(gs_entry) > 6 else None

def expected(gs, st, lg, P, own):
    """the stat's expected rate in these games given who they played: D-I average moved by how the opponent usually
    does on the other end (their defence for our offence stats, their offence for our defence stats), leaving this game out"""
    side = st[6]; num, den = st[2], st[3]; e = 0.0; n = 0.0
    for g in gs:
        c = g[2] if side == "o" else g[3]; d = c[den]
        if d <= 0: continue
        op = g[6]; Q = P.get(op)
        adj = 0.0
        if Q:
            other = Q["d" if side == "o" else "o"]   # opponent's allowed (vs our offence) or its own offence (vs our defence)
            on, od = other[num] - c[num], other[den] - d   # leave this game out
            if od > 0: adj = (on / od - lg[st[0]]) * min(1.0, od / (od + 400))   # shrink thin opponent samples
        e += (lg[st[0]] + adj) * d; n += d
    return e / n if n else lg[st[0]]

def tot(games, side, keys):
    s = defaultdict(float)
    for g in games:
        c = g[2] if side == "o" else g[3]
        for k in keys: s[k] += c[k]
    return s

def league(teams):
    s = defaultdict(float); pts = 0
    for gs in teams.values():
        for g in gs:
            for k, v in g[2].items(): s[k] += v
            pts += g[4]
    lg = {st[0]: s[st[2]] / s[st[3]] for st in STATS}
    lg["ppp"] = pts / s["poss"]
    return lg

def rate(s, st): return s[st[2]] / s[st[3]] if s[st[3]] > 0 else None

def fit(seasons, min_g=20, adj=True):
    """true-level variance (split-half covariance) and per-attempt noise c for each stat, pooled over seasons.
    adj: on the opponent-adjusted rate (observed minus what these opponents usually give up / shoot), so the true part
    is the team's own level, not its schedule."""
    M = {}
    for st in STATS:
        k = st[0]; covs = []; cs = []
        for y in seasons:
            T = load(y); lg = league(T); PR = profiles(T) if adj else None
            xs, ys, full = [], [], []
            for t, gs in T.items():
                if len(gs) < min_g: continue
                odd, even = gs[0::2], gs[1::2]
                def dev(G):
                    s_ = tot(G, st[6], [st[2], st[3]]); r = rate(s_, st)
                    if r is None: return None, 0
                    return r - (expected(G, st, lg, PR, None) if PR else lg[k]), s_[st[3]]
                (a, _), (b, _), (f, nf) = dev(odd), dev(even), dev(gs)
                if a is None or b is None: continue
                xs.append(a); ys.append(b); full.append((f, nf))
            n = len(xs); mx, my = sum(xs) / n, sum(ys) / n
            cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (n - 1)
            mf = sum(f for f, _ in full) / n
            vf = sum((f - mf) ** 2 for f, _ in full) / (n - 1)
            inv = sum(1 / d for _, d in full) / n          # mean 1/attempts over the full season
            covs.append(max(cov, 0.0)); cs.append(max(vf - max(cov, 0.0), 1e-9) / inv)
        tv, c = sum(covs) / len(covs), sum(cs) / len(cs)
        M[k] = {"label": st[1], "tv": tv, "c": c}
    return M

def team_luck(gs, st_model, lg, PR=None):
    """per-stat luck (points, + = lucky) and the totals for one team's games"""
    out = {}; P = 0.0
    so_all = tot(gs, "o", ["poss"]); possn = so_all["poss"]
    for st in STATS:
        k, side = st[0], st[6]
        s = tot(gs, side, [st[2], st[3]]); n = s[st[3]]; r = rate(s, st)
        if r is None: out[k] = 0.0; continue
        m = st_model[k]; R = m["tv"] / (m["tv"] + m["c"] / n) if n > 0 else 0.0
        val = lg["ppp"] if st[4] == "ppp" else st[4]
        mult = m.get("m", 1.0)   # calibrated: how much of the modelled luck really disappears (fit_multipliers)
        ex = expected(gs, st, lg, PR, None) if PR else lg[k]
        pts = mult * (1 - R) * (r - ex) * n * val * st[5]
        out[k] = pts; P += pts
    pf = sum(g[4] for g in gs); pa = sum(g[5] for g in gs)
    return out, P, possn, pf, pa

def luck_box(o, d, lg, model):
    """luck points for any own box o / opponent box d (keys pts fga fgm tpa tpm fta ftm orb drb tov). Returns
    (offence luck, defence luck): + = lucky. Luck-adjusted = own pts - off, opponent pts + def. Used by build_wowy.py."""
    def C(b, other):
        return {"tpm": b["tpm"], "tpa": b["tpa"], "twom": b["fgm"] - b["tpm"], "twoa": b["fga"] - b["tpa"], "ftm": b["ftm"],
                "fta": b["fta"], "tov": b["tov"], "poss": max(1e-9, b["fga"] - b["orb"] + b["tov"] + 0.44 * b["fta"]),
                "orb": b["orb"], "orbo": b["orb"] + other["drb"]}
    co, cd = C(o, d), C(d, o); off = de = 0.0
    for st in STATS:
        k, side = st[0], st[6]; c = co if side == "o" else cd; n = c[st[3]]
        if n <= 0: continue
        m = model[k]; R = m["tv"] / (m["tv"] + m["c"] / n)
        val = lg["ppp"] if st[4] == "ppp" else st[4]
        pts = m.get("m", 1.0) * (1 - R) * (c[st[2]] / n - lg[k]) * n * val * st[5]
        if side == "o": off += pts
        else: de += pts
    return off, de

def close_luck(gs, exp=11.5):
    """wins minus Pythagorean wins (KenPom's exponent for college)"""
    w = sum(1 for g in gs if g[4] > g[5]); pf = sum(g[4] for g in gs); pa = sum(g[5] for g in gs)
    if pf <= 0 or pa <= 0: return 0.0, w
    pyth = pf ** exp / (pf ** exp + pa ** exp)
    return w - pyth * len(gs), w

def gnet(g): return 100 * g[4] / g[2]["poss"] - 100 * g[5] / g[3]["poss"]

def quality(T, it=8):
    """schedule-adjusted net per 100 (a simple SRS on each game's net), for a fair 'what happened next' target"""
    q = {t: 0.0 for t in T}
    for _ in range(it):
        q = {t: sum(gnet(g) + q.get(g[6], 0.0) for g in gs) / len(gs) for t, gs in T.items()}
        mu = sum(q.values()) / len(q); q = {t: v - mu for t, v in q.items()}
    return q

def splits(gs, rnd):
    """early season -> the rest (6, 10, 15 games) and two random halves: luck has to hold up both ways"""
    for cut in (6, 10, 15):
        if len(gs) >= cut + 8: yield gs[:cut], gs[cut:]
    for _ in range(2):
        ix = list(range(len(gs))); rnd.shuffle(ix); h = len(gs) // 2
        yield [gs[i] for i in sorted(ix[:h])], [gs[i] for i in sorted(ix[h:])]

def fit_multipliers(model, train=(2023, 2024, 2025)):
    """Calibration (Nov 22 2026). Regress (schedule-adjusted net in the later/other games - the same in the sample)
    on each stat's modelled luck in the sample. The coefficient is how much of that stat's luck really went away.
    Tested on 2025-26 (not in the fit): early season -> rest .913 -> .925, random halves .930 -> .938. Opponent-adjusted
    expectations (profiles) beat plain D-I averages on the early-season test, where cupcake schedules fake 'luck'."""
    import numpy as np
    K = [st[0] for st in STATS]; X = []; Y = []
    base = {k: dict(model[k], m=1.0) for k in K}
    for y in train:
        T = load(y); lg = league(T); PR = profiles(T); Q = quality(T); rnd = random.Random(y)
        for t, gs in T.items():
            if len(gs) < 20: continue
            for A, B in splits(gs, rnd):
                c, _, pa, _, _ = team_luck(A, base, lg, PR)
                aA = sum(gnet(g) + Q.get(g[6], 0.0) for g in A) / len(A); aB = sum(gnet(g) + Q.get(g[6], 0.0) for g in B) / len(B)
                X.append([100 * c[k] / pa for k in K]); Y.append(aB - aA)
    X = np.c_[np.ones(len(X)), np.array(X)]; b = np.linalg.lstsq(X, np.array(Y), rcond=None)[0]
    for k, v in zip(K, -b[1:]): model[k]["m"] = round(float(min(1.25, max(0.0, v))), 2)
    return model

def net(G):
    p = tot(G, "o", ["poss"])["poss"]; q = tot(G, "d", ["poss"])["poss"]
    return 100 * sum(g[4] for g in G) / p - 100 * sum(g[5] for g in G) / q

def backtest(model, seasons=(2026,)):
    import numpy as np
    for y in seasons:
        T = load(y); lg = league(T); PR = profiles(T); Q = quality(T); rnd = random.Random(99)
        for lab, cut in (("first 6 games -> rest", 6), ("first 10 -> rest", 10), ("random halves", None)):
            a, b, l = [], [], []
            for t, gs in T.items():
                if len(gs) < 20: continue
                if cut: A, B = gs[:cut], gs[cut:]
                else:
                    ix = list(range(len(gs))); rnd.shuffle(ix); h = len(gs) // 2
                    A, B = [gs[i] for i in sorted(ix[:h])], [gs[i] for i in sorted(ix[h:])]
                _, P, pa, _, _ = team_luck(A, model, lg, PR)
                a.append(sum(gnet(g) + Q.get(g[6], 0.0) for g in A) / len(A)); b.append(sum(gnet(g) + Q.get(g[6], 0.0) for g in B) / len(B)); l.append(100 * P / pa)
            a, b, l = map(np.array, (a, b, l))
            print(f"{y} {lab:22} adjusted net -> later r={np.corrcoef(a, b)[0, 1]:.3f} · minus luck r={np.corrcoef(a - l, b)[0, 1]:.3f}")

def build(season, model):
    T = load(season); lg = league(T); teams = {}; PR = profiles(T)
    for t, gs in T.items():
        comp, P, possn, pf, pa = team_luck(gs, model, lg, PR)
        cl, w = close_luck(gs)
        g = len(gs)
        # points of luck a game -> wins: a point of margin is worth ~0.033 wins a game in college (Pythag slope at .500)
        teams[t] = {"g": g, "w": w, "l": g - w, "per100": round(100 * P / possn, 1), "pg": round(P / g, 1),
                    "close": round(cl, 1), "wins": round(0.033 * P + cl, 1),
                    "comp": {k: round(P and 100 * v / possn, 1) for k, v in comp.items()}}
    out = {"season": season, "built": __import__("time").strftime("%Y-%m-%d"), "league": {k: round(v, 4) for k, v in lg.items()},
           "labels": {st[0]: st[1] for st in STATS}, "teams": teams}
    json.dump(out, open(os.path.join(DATA, f"team_luck_{season}.json"), "w"), separators=(",", ":"))
    print(f"wrote team_luck_{season}.json: {len(teams)} teams")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--fit", action="store_true"); ap.add_argument("--season", type=int)
    ap.add_argument("--backtest", action="store_true"); a = ap.parse_args()
    mp = os.path.join(DATA, "luck_model.json")
    if a.fit:
        M = fit_multipliers(fit(FIT_SEASONS, adj=True))
        json.dump({"fit_seasons": FIT_SEASONS, "stats": M}, open(mp, "w"), indent=1)
    if a.fit or a.season:   # league rates for every season on file + the stat table (pages and build_wowy read this)
        J = json.load(open(mp)); J["leagues"] = J.get("leagues", {})
        for f in sorted(os.listdir(TG)):
            y = int(f.split(".")[0]); J["leagues"][str(y)] = {k: round(v, 5) for k, v in league(load(y)).items()}
        J["table"] = [[st[0], st[1], st[2], st[3], st[4], st[5], st[6]] for st in STATS]
        json.dump(J, open(mp, "w"), indent=1)
    if a.fit:
        for k, m in M.items():
            n30 = {"tp": 600, "two": 1000, "ft": 550, "tov": 2100, "orb": 1100, "otp": 600, "otwo": 1000, "oft": 550, "otov": 2100, "drb": 1100}[k]
            print(f"{m['label']:18} luck share kept {m['m']:.2f}  true sd {math.sqrt(m['tv']):.4f}  noise sd/attempt {math.sqrt(m['c']):.3f}  reliable over a season (~{n30}) {m['tv']/(m['tv']+m['c']/n30):.2f}")
    model = json.load(open(mp))["stats"] if os.path.exists(mp) else None
    if a.backtest: backtest(model)
    if a.season: build(a.season, model)
