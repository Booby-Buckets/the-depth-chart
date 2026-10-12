#!/usr/bin/env python3
"""level_translate.py — translate a TRANSFER's Player DNA fingerprint to his new team's league (owner, Oct 12 2026:
"do the player level adjustment").

A player's box-score profile is earned against his league: moving to a stronger league, rate stats fall (assist rate,
defensive rebounding, steals, blocks, usage) while BPM / DBPM RISE (Box Plus/Minus carries a team adjustment, so a
better team lifts them). GAMMA = each stat's change per point of league strength, fit on 3,787 transfers 2008-26
(next-season stat − carry(last season) ~ mover offset + gamma·(new league − old league)).
League strength L(season, team) = that conference's mean adjusted net that season, centered on D-I.
Backtest (historical projections rebuilt with movers translated, owner formula, leave-one-season-out, 5,048
team-seasons): net MAE 3.511 -> 3.493, defense 2.869 -> 2.856, better in 14 of 19 seasons. Returners are untouched.
Used by build_projected_dna.py (2026-27) and build_historical_projection.py (the calibration's history)."""
import json, os, collections
import numpy as np

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
GAMMA = {"efg": -0.0093, "ts": -0.0234, "tpa_rate": 0.2297, "ftr": -0.0805, "tov_pct": 0.0085, "ast_pct": -0.0988, "orb_pct": -0.0091, "drb_pct": -0.0776, "stl_pct": -0.0056, "blk_pct": -0.0089, "bpm": 0.1043, "obpm": 0.0094, "dbpm": 0.0983, "usg": -0.191}
_LEAGUE = None


SAVED = os.path.join(D, "league_strength.json")   # committed: team_seasons.jsonl is local-only (gitignored, large)


def league_table(TD):
    """{(season, ESPN team key): conference mean adjusted net − D-I mean} from team_dna.json + team_seasons.jsonl,
    or the committed league_strength.json where team_seasons.jsonl isn't available (CI)."""
    global _LEAGUE
    if _LEAGUE is not None: return _LEAGUE
    if not os.path.exists(os.path.join(D, "team_seasons.jsonl")):
        _LEAGUE = {(int(y), k): v for y, d in json.load(open(SAVED)).items() for k, v in d.items()}
        return _LEAGUE
    conf = {}
    for l in open(os.path.join(D, "team_seasons.jsonl")):
        r = json.loads(l); y = r.get("season_year") or r.get("season")
        if r.get("conference") and r.get("team"): conf[(int(y), r["team"])] = r["conference"]
    out = {}
    for s, T in TD.items():
        if not s.isdigit() or "teams" not in T: continue
        acc = collections.defaultdict(list)
        for k, t in T["teams"].items():
            if t.get("adjO") is not None and t.get("adjD") is not None and conf.get((int(s), k)): acc[conf[(int(s), k)]].append(t["adjO"] - t["adjD"])
        allv = [v for vs in acc.values() for v in vs]
        if not allv: continue
        mu = float(np.mean(allv))
        for k in T["teams"]:
            c = conf.get((int(s), k))
            if c and len(acc.get(c, [])) >= 4: out[(int(s), k)] = float(np.mean(acc[c])) - mu
    _LEAGUE = out
    return out


def translate(fp, TD, season, old_key, new_key):
    """shift a carried fingerprint (dict) from old_key's league to new_key's, both as of `season`; no-op for a returner
    or when either league is unknown. Returns fp (modified in place)."""
    if not old_key or not new_key or old_key == new_key: return fp
    L = league_table(TD); lo, ln = L.get((int(season), old_key)), L.get((int(season), new_key))
    if lo is None or ln is None: return fp
    for k, g in GAMMA.items():
        if fp.get(k) is not None: fp[k] = fp[k] + g * (ln - lo)
    return fp


if __name__ == "__main__":   # python3 scripts/level_translate.py  -> refresh league_strength.json (run locally, commit)
    L = league_table(json.load(open(os.path.join(D, "team_dna.json"))))
    out = {}
    for (y, k), v in L.items(): out.setdefault(str(y), {})[k] = round(v, 3)
    json.dump(out, open(SAVED, "w"), separators=(",", ":"))
    print("wrote", SAVED, sum(len(v) for v in out.values()), "team-seasons")
