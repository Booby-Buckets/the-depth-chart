#!/usr/bin/env python3
"""Backtest: how much strength-of-schedule should the net-efficiency ratings carry?

adjust_team_dna.py solves  rating = raw_net + 1.0 * mean(opponent rating)  and then rescales
the spread back to the raw spread. This tests the SOS weight w in

    rating_t = mean_g(eff_margin_tg) + w * mean_g(rating_opp)

from w=0 (raw, no schedule) to w=1 (full SRS) and beyond, on games the ratings never saw:

  A) "Feb+"   — ratings from games before Feb 1, predict every final game Feb 1 onward.
  B) "March"  — ratings from games before Mar 17, predict neutral-site games Mar 17+ (≈ NCAA/NIT/CBI).

Per-game efficiency margin = point margin * 100 / possessions, possessions ≈ mean of the two teams'
season tempo (team_dna.json). Home edge removed using the training set's average home margin.
Prediction: margin = k * (r_a - r_b) * poss/100 + h * home   with k, h fit by least squares, pooled
over all seasons (2 params on ~100k games — the fit can't flatter any one w). Also reports k=1 MAE, which
is what the site effectively does (it uses net differences directly in the matchup projector).

Read-only. Caches games in scripts/data/_cache_games/ (gitignored? no — pass --cache DIR).

    python3 scripts/backtest_sos_weight.py [--cache DIR] [--seasons 2008-2026]
"""
import json, os, sys, urllib.request, statistics

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
ROOT = os.path.dirname(os.path.abspath(__file__))
DNA = os.path.join(ROOT, "data", "team_dna.json")
WS = [0.0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2]


def arg(name, default):
    a = sys.argv
    return a[a.index(name) + 1] if name in a else default


def get(url):
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60) as r:
                return json.loads(r.read().decode())
        except Exception:
            if i == 3:
                raise


def fetch_games(year, cache):
    p = os.path.join(cache, f"games_{year}.json")
    if os.path.exists(p):
        return json.load(open(p))
    out, page = [], 0
    while True:   # stable ORDER BY or pages skip/dupe rows
        rows = get(f"{SB}/rest/v1/games?select=id,date,home,away,home_score,away_score,neutral"
                   f"&season_year=eq.{year}&status=eq.STATUS_FINAL&order=id&limit=1000&offset={page*1000}")
        out += rows
        if len(rows) < 1000:
            break
        page += 1
    json.dump(out, open(p, "w"))
    return out


def solve(train, w, iters=200):
    """train: list of (a, b, eff_margin_for_a_home_removed). Returns {team: rating}."""
    mov, opps = {}, {}
    for a, b, m in train:
        mov.setdefault(a, []).append(m); opps.setdefault(a, []).append(b)
        mov.setdefault(b, []).append(-m); opps.setdefault(b, []).append(a)
    base = {t: sum(v) / len(v) for t, v in mov.items()}
    r = dict(base)
    for _ in range(iters):
        new = {t: base[t] + w * sum(r[o] for o in opps[t]) / len(opps[t]) for t in base}
        c = sum(new.values()) / len(new)
        new = {t: v - c for t, v in new.items()}
        if max(abs(new[t] - r[t]) for t in r) < 1e-6:
            r = new; break
        r = new
    return r


def season_rows(games, tempo, cut, test_ok):
    """Split a season into train tuples + test rows (x_diff_pts_scale, home, margin)."""
    tr, te = [], []
    for g in games:
        a, b, hs, as_ = g["home"], g["away"], g.get("home_score"), g.get("away_score")
        if a not in tempo or b not in tempo or hs is None or as_ is None or hs == as_ == 0:
            continue
        poss = (tempo[a] + tempo[b]) / 2
        row = (a, b, (hs - as_) * 100.0 / poss, 0 if g.get("neutral") else 1, hs - as_, poss)
        if g["date"] < cut:
            tr.append(row)
        elif test_ok(g):
            te.append(row)
    return tr, te


def fit(xs):
    """least squares margin ~ k*x + h*home (no intercept). xs: [(x, home, y)]"""
    sxx = sum(x * x for x, h, y in xs); sxh = sum(x * h for x, h, y in xs); shh = sum(h * h for x, h, y in xs)
    sxy = sum(x * y for x, h, y in xs); shy = sum(h * y for x, h, y in xs)
    det = sxx * shh - sxh * sxh
    if shh == 0:      # all-neutral test set (March): no home term
        return sxy / sxx, 0.0
    return (sxy * shh - shy * sxh) / det, (sxx * shy - sxh * sxy) / det


def main():
    cache = arg("--cache", os.path.join(ROOT, "data", "_cache_games"))
    os.makedirs(cache, exist_ok=True)
    lo, hi = map(int, arg("--seasons", "2008-2026").split("-"))
    dna = json.load(open(DNA))
    tests = {
        "Feb+": (lambda y: f"{y}-02-01", lambda g: True),
        "March": (lambda y: f"{y}-03-17", lambda g: bool(g.get("neutral"))),
    }
    # per test: w -> list of (x_scaled, home, y, season)
    pool = {t: {w: [] for w in WS} for t in tests}
    for y in range(lo, hi + 1):
        teams = (dna.get(str(y)) or {}).get("teams") or {}
        tempo = {n: float(v["tempo"]) for n, v in teams.items() if isinstance(v, dict) and v.get("tempo")}
        if not tempo:
            continue
        games = fetch_games(y, cache)
        for tname, (cutf, ok) in tests.items():
            tr, te = season_rows(games, tempo, cutf(y), ok)
            if len(tr) < 1000 or not te:
                continue
            hb = [r[2] for r in tr if r[3]]
            hca = sum(hb) / len(hb) if hb else 0.0   # avg home edge (eff units)
            train = [(a, b, m - hca * home) for a, b, m, home, _, _ in tr]
            for w in WS:
                r = solve(train, w)
                for a, b, _, home, marg, poss in te:
                    if a in r and b in r:
                        pool[tname][w].append(((r[a] - r[b]) * poss / 100, home, marg, y))
        print(f"  {y}: {len(games)} games", file=sys.stderr)

    for tname in tests:
        print(f"\n== {tname} ==   (n = {len(pool[tname][0.0])} games)")
        print("   w    MAE(fit)  RMSE   pick%   k(fit)  h    MAE(k=1)  spread(sd of rating diff)")
        for w in WS:
            xs = [(x, h, yv) for x, h, yv, _ in pool[tname][w]]
            k, h = fit(xs)
            err = [yv - (k * x + h * hh) for x, hh, yv in xs]
            mae = sum(abs(e) for e in err) / len(err)
            rmse = (sum(e * e for e in err) / len(err)) ** .5
            hc = sum(1 for x, hh, yv in xs if yv != 0 and (k * x + h * hh > 0) == (yv > 0)) / len(xs)
            mae1 = sum(abs(yv - (x + h * hh)) for x, hh, yv in xs) / len(xs)
            sd = statistics.pstdev(x for x, _, _ in xs)
            print(f"  {w:3.1f}   {mae:6.3f}  {rmse:6.3f}  {hc*100:5.1f}   {k:5.3f}  {h:4.2f}   {mae1:6.3f}    {sd:5.2f}")
        # per-season best w (stability)
        best = {}
        for y in sorted({s for *_, s in pool[tname][0.0]}):
            sc = {}
            for w in WS:
                xs = [(x, h, yv) for x, h, yv, s in pool[tname][w] if s == y]
                k, h = fit(xs)
                sc[w] = sum(abs(yv - (k * x + h * hh)) for x, hh, yv in xs) / len(xs)
            best[y] = min(sc, key=sc.get)
        print("  best w by season:", " ".join(f"{y % 100:02d}:{w:.1f}" for y, w in best.items()))


if __name__ == "__main__":
    main()
