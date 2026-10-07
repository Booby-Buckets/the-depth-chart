"""Team-adjusted Defensive Wins Added (Oct 2026).

DWA is Dean Oliver's defensive win shares: a player's own stops PLUS a share of his team's defense. On an
elite defense every rotation player inherits a big slice of it, so low-usage role players there graded like
starters (Amari Evans, 4.1 ppg at Tennessee: 81 OVR, 63% of it from DWA; the top of the 3-5 ppg / 400-650
minute group was all Florida, Houston, Saint Mary's, Tennessee and UConn reserves).

  dwa_adj = dwa - TEAM_D_K * max(0, team DWA per minute - league DWA per minute) * minutes

removes TEAM_D_K of the team's above-average defense from each player's credit, pro rata to his minutes, so
what remains is how he defended relative to his teammates. A real stopper on a great defense still stands out.
ONE-SIDED: a below-average team defense is not added back — the symmetric version lifted bench players on bad
defenses by up to 14 OVR (Melvin Bell Jr., San Jose State 56 -> 70), the same distortion in reverse.
Used by build_stat_overall.py (demonstrated) and build_stat_overall_projected.py (projected) so both scales
move together.
"""
import os

TEAM_D_K = float(os.environ.get("TEAM_D_K", "0.75"))


def rates(rows):
    """rows: iterable of (season, team, minutes, dwa) -> {(season, team): per-minute, (season, None): league}"""
    tot = {}
    for s, t, m, d in rows:
        try:
            m = float(m); d = float(d)
        except (TypeError, ValueError):
            continue
        if not (m > 0) or d != d:
            continue
        for k in ((s, t), (s, None)):
            a = tot.setdefault(k, [0.0, 0.0]); a[0] += d; a[1] += m
    return {k: (v[0] / v[1] if v[1] > 0 else 0.0) for k, v in tot.items()}


def adjust(dwa, minutes, season, team, R):
    """team-adjusted DWA for one player-season (dwa unchanged when the team or league rate is unknown)"""
    try:
        d = float(dwa); m = float(minutes)
    except (TypeError, ValueError):
        return dwa
    if d != d or not (m > 0):
        return dwa
    tr, lg = R.get((season, team)), R.get((season, None))
    if tr is None or lg is None:
        return d
    return d - TEAM_D_K * max(0.0, tr - lg) * m


def adjust_frame(df, season_col="season_year", team_col="team", min_col="min", dwa_col="dwa", R=None):
    """adjust a pandas frame in place; R defaults to rates computed from the frame itself"""
    if R is None:
        R = rates(zip(df[season_col], df[team_col], df[min_col], df[dwa_col]))
    df[dwa_col] = [adjust(d, m, s, t, R) for d, m, s, t in zip(df[dwa_col], df[min_col], df[season_col], df[team_col])]
    return R
