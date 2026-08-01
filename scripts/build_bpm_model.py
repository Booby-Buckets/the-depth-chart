#!/usr/bin/env python3
"""build_bpm_model.py — OWNED Box Plus/Minus estimate, from our own box stats.

Why this exists
---------------
The predictive projection (tdc-ratings.js) values each returning player by a
Box Plus/Minus number. During the Sports-Reference removal that input was
temporarily replaced by a one-line `ti40 -> BPM` map, but ti40 correlates only
~0.36 with BPM and the linear map COMPRESSED the star tier toward average
(a ti40 of ~18 became BPM ~3 when those players are really 9-11). That
compression was uneven — star-driven rosters cratered, balanced ones barely
moved — and it scrambled the projected rankings.

The fix: reproduce BPM the honest way — a regression of bbref BPM onto OUR OWN
box-derived advanced rates (the same move that reproduced DWS at r=0.96). We
train on the historical seasons ONCE, offline, and deploy static coefficients.
At runtime the site reads only owned data (player_advanced) — no bbref read —
so the migration stays intact. This is model-training on already-captured data,
not a live Sports-Reference dependency.

De-attenuation
--------------
Least-squares regresses predictions toward the mean when r<1, so the stars come
out compressed (top-decile actual ~7.7 BPM, raw prediction ~4.7). The projection's
BPM->SRS calibration (CAL_A/CAL_B) was fit on REAL BPM's spread, so we must feed
a number with that spread. We rescale the predicted spread back to the actual
BPM spread: est = mu + (pred - mu) * (SD_actual / SD_pred). Principled, not
cosmetic — without it every roster rating is systematically squashed.

Output: prints JS-ready constants to paste into tdc-ratings.js (BPM_B0 / BPM_COEF
/ BPM_MU / BPM_K), plus validation (holdout r, top-decile scale, field-wide team
fidelity vs the bbref-based "known-good" ratings).

Usage: python3 build_bpm_model.py
"""
import os, sys, math, importlib.util
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ag", os.path.join(HERE, "archetype_grades.py"))
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)

# features — every one is a player_advanced column the projection already can fetch.
# The team-quality term (his 2026 team's owned Power Rating, team_seasons.srs) is the
# KEY addition: it is the same "team adjustment" real BPM uses, and it lifts the fit
# from r~0.79 (box-only, which left star-driven teams 25+ spots off) to r~0.95. It is
# appended as the LAST column, after FEATS, so BPM_SRS is beta[-1] on deploy.
FEATS = ['ts_pct', 'efg_pct', 'tp_pct', 'ft_pct', 'pts40', 'reb40', 'ast40',
         'usg_pct', 'ast_pct', 'tov_pct', 'orb_pct', 'drb_pct', 'stl_pct', 'blk_pct', 'ti40']
TRAIN_YEARS = [2019, 2021, 2022, 2023, 2024, 2025, 2026]
MIN_MIN = 150   # train on real samples


def load(years):
    """Return (feature-matrix-with-intercept + srs column, bpm-vector, season-vector).
    Column layout: [1.0, *FEATS, srs] — srs (owned Power Rating) joined by exact team name."""
    F, Y, S = [], [], []
    for yr in years:
        pa = ag.get("player_advanced?season_year=eq.%d&min=gt.%d" % (yr, MIN_MIN),
                    ",".join(['espn_id', 'team'] + FEATS))
        ts = ag.get("team_seasons?season_year=eq.%d&select=team,srs" % yr, "")
        srs = {t['team']: (float(t['srs']) if t.get('srs') is not None else None) for t in ts}
        bb = ag.get("bbref_seasons?season_year=eq.%d&espn_id=not.is.null" % yr, "espn_id,advanced")
        bpm = {}
        for b in bb:
            adv = b.get('advanced') or {}
            v = adv.get('bpm')
            if v not in (None, ''):
                try: bpm[str(b['espn_id'])] = float(v)
                except (TypeError, ValueError): pass
        m = 0
        for r in pa:
            eid = str(r.get('espn_id'))
            if eid not in bpm:
                continue
            s = srs.get(r.get('team'))
            if s is None:
                continue
            try: feat = [float(r[f]) for f in FEATS]
            except (TypeError, ValueError, KeyError): continue
            F.append([1.0] + feat + [s]); Y.append(bpm[eid]); S.append(yr); m += 1
        print("  %d: pa=%d bbrefBPM=%d matched=%d" % (yr, len(pa), len(bpm), m))
    return np.array(F), np.array(Y), np.array(S)


def fit(X, Y, ridge=1.0):
    """Ridge-stabilized least squares (features are collinear; ridge keeps
    coefficients sane without hurting the holdout fit). Intercept unpenalized."""
    n, p = X.shape
    R = ridge * np.eye(p); R[0, 0] = 0.0
    beta = np.linalg.solve(X.T @ X + R, X.T @ Y)
    return beta


def stats(pred, y):
    r = np.corrcoef(pred, y)[0, 1]
    rmse = math.sqrt(((pred - y) ** 2).mean())
    return r, rmse


def main():
    print("loading training data…")
    X, Y, S = load(TRAIN_YEARS)
    print("total rows: %d\n" % len(Y))

    # honest holdout: train <=2025, test 2026
    tr, te = S < 2026, S == 2026
    for ridge in (0.0, 1.0, 5.0):
        b = fit(X[tr], Y[tr], ridge)
        r_in, _ = stats(X[tr] @ b, Y[tr])
        r_te, rmse_te = stats(X[te] @ b, Y[te])
        print("ridge=%-4.1f  in-sample r=%.3f | 2026 holdout r=%.3f rmse=%.2f" % (ridge, r_in, r_te, rmse_te))
    RIDGE = 1.0
    print("\nusing ridge=%.1f\n" % RIDGE)

    # DEPLOY fit: all seasons, for the best coefficients
    beta = fit(X, Y, RIDGE)
    pred = X @ beta
    mu = float(Y.mean())
    k = float(Y.std() / pred.std())      # de-attenuation
    est = mu + (pred - mu) * k

    r, rmse = stats(est, Y)
    idx = np.argsort(-Y); top = idx[:len(Y) // 10]
    ti = X[:, 1 + FEATS.index('ti40')]; timap = -10.35 + 0.738 * ti
    print("full-sample fit: r=%.3f rmse=%.2f" % (r, rmse))
    print("top-decile BPM: actual %.2f | de-att model %.2f | old ti40-map %.2f (the compression we're fixing)"
          % (Y[top].mean(), est[top].mean(), timap[top].mean()))

    # ---- JS constants (srs is the LAST column, so beta[-1] is BPM_SRS) ----
    print("\n// ===== paste into tdc-ratings.js — from scripts/build_bpm_model.py =====")
    print("  const BPM_B0=%.5f, BPM_MU=%.4f, BPM_K=%.4f, BPM_SRS=%.5f;" % (beta[0], mu, k, beta[-1]))
    print("  const BPM_FEATS=[%s];" % ",".join("'%s'" % f for f in FEATS))
    print("  const BPM_COEF=[%s];" % ",".join("%.5f" % c for c in beta[1:-1]))

    # ---- field-wide team fidelity vs known-good (bbref) ----
    print("\nvalidating field-wide team ratings (owned model vs bbref known-good)…")
    srs26 = {t['team']: (float(t['srs']) if t.get('srs') is not None else 0.0)
             for t in ag.get("team_seasons?season_year=eq.2026&select=team,srs", "")}
    def obpm_of(feat, s):
        p = beta[0] + beta[-1] * s + sum(beta[i + 1] * feat[i] for i in range(len(FEATS)))
        return mu + (p - mu) * k

    feat26 = {}
    for x in ag.get("player_advanced?season_year=eq.2026&min=gt.1", "espn_id,team," + ",".join(FEATS)):
        try: feat26[str(x['espn_id'])] = ([float(x[f]) for f in FEATS], srs26.get(x.get('team'), 0.0))
        except (TypeError, ValueError, KeyError): pass
    bpm26 = {}
    for x in ag.get("bbref_seasons?season_year=eq.2026&espn_id=not.is.null", "espn_id,advanced"):
        adv = x.get('advanced') or {}; v = adv.get('bpm')
        if v not in (None, ''):
            try: bpm26[str(x['espn_id'])] = float(v)
            except (TypeError, ValueError): pass
    players = ag.get("players?name=neq.%E2%80%94&select=name,team,espn_id,yr,class_year,tdc_grade,mpg,ppg,is_injured,hometown", "")

    CLS_BUMP = {'FR': 0.5, 'SO': 0.2, 'JR': 0.1, 'SR': 0}
    def cls(yr):
        y = ((yr or '') + '').lower()
        return 'FR' if 'fr' in y else 'SO' if 'so' in y else 'JR' if 'jr' in y else 'SR'
    def minproxy(p):
        g = float(p.get('tdc_grade') or 70); has = (float(p.get('ppg') or 0) > 0)
        return max(4, float(p.get('mpg') or 8)) if has else (26 if g >= 92 else 22 if g >= 88 else 15 if g >= 82 else 10 if g >= 78 else 6)
    def projbpm(bpm, c, g):
        return 0.635 + 0.785 * bpm + CLS_BUMP[c] if bpm is not None else (g - 77) * 0.55 - 0.6

    from collections import defaultdict
    byteam = defaultdict(list)
    for p in players:
        if p.get('is_injured') or (p.get('hometown') or '').strip().lower() in ('injured', 'out'):
            continue
        byteam[p['team']].append(p)
    res = {}
    for team, roster in byteam.items():
        if len(roster) < 5:
            continue
        ebb, eor, mn = [], [], []
        for p in roster:
            eid = str(p['espn_id']) if p.get('espn_id') is not None else None
            m = minproxy(p)
            if m < 3:
                continue
            c = cls(p.get('yr') or p.get('class_year')); g = float(p.get('tdc_grade') or 70)
            mn.append(m)
            ebb.append(projbpm(bpm26.get(eid), c, g))
            eor.append(projbpm(obpm_of(*feat26[eid]) if eid in feat26 else None, c, g))
        ms = sum(mn) or 1
        res[team] = (11.75 + 2.355 * sum(ebb[i] * mn[i] / ms for i in range(len(mn))),
                     11.75 + 2.355 * sum(eor[i] * mn[i] / ms for i in range(len(mn))))
    teams = list(res)
    a = np.array([res[t][0] for t in teams]); c = np.array([res[t][1] for t in teams])
    print("field-wide roster-rating r (owned vs bbref) = %.3f over %d rostered teams" %
          (np.corrcoef(a, c)[0, 1], len(teams)))


if __name__ == "__main__":
    main()
