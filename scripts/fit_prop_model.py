#!/usr/bin/env python3
"""
fit_prop_model.py — TDC Bet's player-prop pricing model: how likely a player is to clear a line.

A prop price needs two things: the player's expected stat line for this game (the MEAN) and how much his
games scatter around it (the SPREAD). This script fits the spread from real game logs and checks the
whole recipe out of sample, so the edge board's "our chance" is a calibrated probability, not a guess.

Recipe (mirrored in bet/bet-props.js):
  rate    = per-minute production: season-to-date, shrunk toward last season's rate (K_PRIOR minutes of prior)
  minutes = season-to-date minutes per game, shrunk toward last season's
  mean    = rate x minutes
  P(over) = rebounds / assists / threes: negative-binomial tail, variance = mean + alpha * mean^2 (+ minutes
            uncertainty), alpha by maximum likelihood. Points / P+R+A: normal with sd = k*sqrt(mean) + c*mean
            (the NB was overconfident on scoring: its skew put the median too low), k and c by Brier score.

Data: box_scores (public Supabase table) for the seasons below, cached in scripts/data/box_cache_<yr>.json
(git-ignored). Fit on the earlier season, test on the later one.

Writes scripts/data/prop_model.json:
  { built, fit_season, test_season, stats: { pts: {alpha, k_prior, min_k, calib:[[p_pred, p_obs, n]...],
    brier, brier_naive, logloss, n}, ... } }

  python3 scripts/fit_prop_model.py            # uses the cache when present
  python3 scripts/fit_prop_model.py --refresh  # re-pull box scores
"""
import json, os, sys, math, urllib.request, urllib.parse, datetime
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
SEASONS = [2025, 2026]            # fit on 2025 (2024-25), test on 2026 (2025-26)
STATS = ["pts", "reb", "ast", "tpm", "pra"]
MIN_PRIOR_GAMES = 5               # props are posted on established rotation players
MIN_MPG = 15


def get(path):
    req = urllib.request.Request(SB + "/rest/v1/" + path, headers=HDR)
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(req, timeout=90))
        except Exception as e:
            if attempt == 3:
                raise
            print("  retry", path[:80], e, flush=True)


def pull(season):
    """Every box-score line for a season, one request per team (the table is indexed by team + season)."""
    path = os.path.join(DATA, "box_cache_%d.json" % season)
    if os.path.exists(path) and "--refresh" not in sys.argv:
        return json.load(open(path))
    teams = sorted(json.load(open(os.path.join(DATA, "bet_trends_teams.json")))["teams"])
    cols = "game_id,date,team,opp,espn_id,player,min,pts,reb,ast,tpm"
    rows = []
    for i, t in enumerate(teams):
        q = "box_scores?season_year=eq.%d&team=eq.%s&select=%s&limit=5000" % (season, urllib.parse.quote(t), cols)
        rows += get(q) or []
        if (i + 1) % 50 == 0:
            print("  season %d: %d/%d teams · %d lines" % (season, i + 1, len(teams), len(rows)), flush=True)
    print("season %d: %d box lines" % (season, len(rows)), flush=True)
    json.dump(rows, open(path, "w"), separators=(",", ":"))
    return rows


# ── distributions ─────────────────────────────────────────────────────────
def nb_pmf_list(mu, var, kmax):
    """P(X=k) for k=0..kmax. Negative binomial when var > mu, Poisson otherwise."""
    mu = max(mu, 0.05)
    if var <= mu * 1.0001:
        p0 = math.exp(-mu); out = [p0]
        for k in range(1, kmax + 1):
            out.append(out[-1] * mu / k)
        return out
    r = mu * mu / (var - mu); p = r / (r + mu)          # successes r, prob p
    out = [math.exp(r * math.log(p))]
    for k in range(1, kmax + 1):
        out.append(out[-1] * (k - 1 + r) / k * (1 - p))
    return out


def Phi(z):
    return 0.5 * (1 + math.erf(z / 2 ** 0.5))


NORMAL_STATS = {"pts", "pra"}     # big scoring totals: a normal whose sd grows with the mean fits; NB doesn't


def p_over_stat(s, mu, rate, sdm, prm):
    if s in NORMAL_STATS:
        sd = prm["k"] * math.sqrt(max(mu, 0.1)) + prm["c"] * mu
        return max(1e-6, min(1 - 1e-6, 1 - Phi((prm["line"] - mu) / sd)))
    return p_over(mu, var_of(mu, prm["alpha"], rate, sdm), prm["line"])


def p_over(mu, var, line):
    """P(X > line) for a half-point line."""
    k = int(math.floor(line))
    pm = nb_pmf_list(mu, var, k)
    return max(1e-6, min(1 - 1e-6, 1 - sum(pm)))


# ── features: season-to-date + prior season, strictly before each game ───
def player_games(rows):
    by = defaultdict(list)
    for r in rows:
        if r.get("espn_id") is None or r.get("min") is None:
            continue
        v = {s: (r.get(s) or 0) for s in ["pts", "reb", "ast", "tpm"]}
        v["pra"] = v["pts"] + v["reb"] + v["ast"]
        by[r["espn_id"]].append((r["date"], r["game_id"], int(r["min"] or 0), v))
    for k in by:
        by[k].sort()
    return by


def season_rates(by):
    """Per player: total minutes and stat totals for the whole season (the prior for next season)."""
    out = {}
    for pid, gs in by.items():
        mins = sum(g[2] for g in gs)
        played = [g for g in gs if g[2] > 0]
        if mins < 100 or not played:
            continue
        out[pid] = {"min": mins, "mpg": mins / len(played), "tot": {s: sum(g[3][s] for g in gs) for s in STATS}}
    return out


def examples(by, prior, k_prior, min_k):
    """(stat, mean, actual, mpg_sd_frac) for every eligible game, using only games before it."""
    ex = []
    for pid, gs in by.items():
        pr = prior.get(pid)
        cm, ct, n, mins_hist = 0, defaultdict(float), 0, []
        for (date, gid, mn, v) in gs:
            if n >= MIN_PRIOR_GAMES and mn > 0:
                mpg_sd = mpg = cm / n
                if pr:
                    mpg = (cm + pr["mpg"] * min_k) / (n + min_k)
                if mpg >= MIN_MPG:
                    sdm = (sum((m - cm / n) ** 2 for m in mins_hist) / max(1, n - 1)) ** 0.5
                    for s in STATS:
                        rate = (ct[s] + (pr["tot"][s] / pr["min"] * k_prior if pr else 0)) / (cm + (k_prior if pr else 0)) if cm + (k_prior if pr else 0) > 0 else 0
                        ex.append((s, rate * mpg, v[s], rate, sdm))
            if mn > 0:
                cm += mn; n += 1; mins_hist.append(mn)
                for s in STATS:
                    ct[s] += v[s]
    return ex


def var_of(mu, alpha, rate, sdm):
    # NB spread for a fixed minutes load + the extra spread from not knowing the minutes (rate x minutes sd)
    return mu + alpha * mu * mu + (rate * sdm) ** 2 * 0.5


def fit_alpha(ex_s):
    best = None
    for a in [x / 200 for x in range(0, 81)]:          # 0 .. 0.4
        ll = 0.0
        for (s, mu, y, rate, sdm) in ex_s[::3]:
            pm = nb_pmf_list(mu, var_of(mu, a, rate, sdm), int(y))
            ll += math.log(max(pm[int(y)], 1e-12))
        if best is None or ll > best[1]:
            best = (a, ll)
    return best[0]


def half(x):
    return math.floor(x - 0.5) + 0.5 if x >= 0.5 else 0.5


def evaluate(ex_s, prm, s):
    """Out-of-sample: lines at the nearest half-point below the mean, then -3..+3 around it."""
    bins = defaultdict(lambda: [0.0, 0, 0])
    br = ll = 0.0; n = 0
    for (_, mu, y, rate, sdm) in ex_s:
        for off in (-3, -2, -1, 0, 1, 2, 3):
            line = half(mu) + off
            if line < 0.5:
                continue
            p = p_over_stat(s, mu, rate, sdm, dict(prm, line=line)); o = 1 if y > line else 0
            br += (p - o) ** 2; ll += -math.log(p if o else 1 - p); n += 1
            b = min(19, int(p * 20)); bins[b][0] += p; bins[b][1] += o; bins[b][2] += 1
    calib = [[round(bins[b][0] / bins[b][2], 3), round(bins[b][1] / bins[b][2], 3), bins[b][2]] for b in sorted(bins) if bins[b][2] >= 30]
    return {"brier": round(br / n, 4), "logloss": round(ll / n, 4), "n": n, "calib": calib}


def fit_normal(ex_s, s):
    best = None
    for k in [0.8 + 0.1 * i for i in range(19)]:
        for c in (0.0, 0.1, 0.2, 0.3):
            ev = evaluate(ex_s[::5], {"k": k, "c": c}, s)
            if best is None or ev["brier"] < best[1]:
                best = ({"k": round(k, 2), "c": c}, ev["brier"])
    return best[0]


def main():
    a, b = SEASONS
    rows_a, rows_b = pull(a), pull(b)
    by_a, by_b = player_games(rows_a), player_games(rows_b)
    prior_b = season_rates(by_a)
    # prior strength: how many minutes of last season a player's new-season rate starts with
    out = {"built": datetime.date.today().isoformat(), "fit_season": a, "test_season": b, "min_prior_games": MIN_PRIOR_GAMES, "min_mpg": MIN_MPG, "stats": {}}
    # fit the dispersion on the FIRST half of the test season's games with a prior; evaluate on the second half
    best_k = None
    for k_prior in (150, 300, 500):
        ex = examples(by_b, prior_b, k_prior, 6)
        err = sum((mu - y) ** 2 for (s, mu, y, r, sd) in ex if s == "pts") / max(1, sum(1 for e in ex if e[0] == "pts"))
        print("k_prior %d: pts mse %.2f" % (k_prior, err), flush=True)
        if best_k is None or err < best_k[1]:
            best_k = (k_prior, err)
    k_prior = best_k[0]
    ex = examples(by_b, prior_b, k_prior, 6)
    for s in STATS:
        ex_s = [e for e in ex if e[0] == s]
        half_i = len(ex_s) // 2
        fit_part, test_part = ex_s[::2], ex_s[1::2]       # interleaved split by player-game
        prm = fit_normal(fit_part, s) if s in NORMAL_STATS else {"alpha": fit_alpha(fit_part)}
        ev = evaluate(test_part, prm, s)
        out["stats"][s] = dict(prm, dist="normal" if s in NORMAL_STATS else "nb", k_prior=k_prior, min_k=6, **ev)
        print("%s: %s · brier %.4f · logloss %.4f · n %d" % (s, prm, ev["brier"], ev["logloss"], ev["n"]), flush=True)
        print("   calibration (pred → actual):", " ".join("%.2f→%.2f" % (c[0], c[1]) for c in ev["calib"]), flush=True)
    json.dump(out, open(os.path.join(DATA, "prop_model.json"), "w"), indent=1)
    print("wrote scripts/data/prop_model.json")


if __name__ == "__main__":
    main()
