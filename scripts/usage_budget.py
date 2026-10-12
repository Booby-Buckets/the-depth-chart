#!/usr/bin/env python3
"""usage_budget.py — role-aware team projection (owner, Oct 12 2026: "let's do the fuller fix").

A team has 100% of its possessions to share. Each projected rotation player brings his expected usage (carried,
league-translated); on a stacked roster they can't all keep it, on a thin one someone takes more. The rotation's
minutes-weighted usage is scaled to the D-I norm (20%), and each player's efficiency moves with his budget-forced
usage change by the tradeoff measured from roster composition (6,639 team-seasons, 33k player-seasons — usage changes
forced by teammates, not a player's own improvement, which would bias it):
    actual usage follows the budget (beta 0.92); per +1 point of forced usage:
    TS% −0.28, eFG% −0.33, TOV% +0.09, AST% +0.51; OBPM ~0 (it already prices role).
Used by build_projected_dna.py (2026-27) and build_historical_projection.py (the calibration's history)."""
USG_NORM = 20.0
NEWCOMER_USG = 18.0          # a fingerprint with no usage (rare): a typical newcomer's share
MIN_MPG = 8.0                # the rotation the budget is shared across
TRADE = {"ts": -0.2793, "efg": -0.3338, "tov_pct": 0.086, "obpm": -0.0111, "ast_pct": 0.5065}


def apply(R):
    """R: list of fingerprint dicts with 'mpg' (and 'usg'). Rescales usage to the team budget and moves efficiency
    with each player's forced usage change, in place. Returns the team's scale factor (1 = no change)."""
    rot = [p for p in R if (p.get("mpg") or 0) >= MIN_MPG]
    tm = sum(p["mpg"] for p in rot)
    if len(rot) < 5 or tm <= 0: return 1.0
    mu = sum(p["mpg"] * (p.get("usg") if p.get("usg") is not None else NEWCOMER_USG) for p in rot) / tm
    lam = USG_NORM / mu if mu > 0 else 1.0
    for p in rot:
        u = p.get("usg") if p.get("usg") is not None else NEWCOMER_USG
        du = u * (lam - 1.0)
        p["usg"] = u + du
        for k, b in TRADE.items():
            if p.get(k) is not None: p[k] = p[k] + b * du
    return lam
