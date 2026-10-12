"""dna_carry.py — what a player's Player DNA is EXPECTED to be next season.

The roster -> team DNA model (build_projected_dna.py, build_historical_projection.py) was fed each player's
raw last-season fingerprint, so a one-year outlier counted in full: NC State 2026-27 projected the #1 offense in
D-I (ORtg 120.9) off Paul McNeil's 3.6% turnover rate and Ven-Allen Lubin's 67% eFG (Oct 2026). Year to year
only part of a player's gap from his position's norm repeats — eFG ~40%, turnovers ~60%, BPM ~80% (pairs of
consecutive seasons, both 12+ mpg). carry() regresses every fingerprint stat by its measured carry-over,
within the player's position group (G/W/B), so bigs aren't pulled toward guards' shooting.

No level-of-competition term: once regressed, a step-up transfer's efficiency barely moves (eFG −0.01, TOV%
+0.04 per conference-strength point), and his BPM even RISES (the players who move up are the improving ones —
selection), while the player grades and team ratings already carry the level jump.

    from dna_carry import carry          # carry(fp, grp) -> new dict
"""
import json, pathlib
import numpy as np

_D = pathlib.Path(__file__).parent / "data"
STATS = ["efg", "ts", "tpa_rate", "ftr", "tov_pct", "ast_pct", "orb_pct", "drb_pct", "stl_pct", "blk_pct", "bpm", "obpm", "dbpm", "usg"]
MIN_MPG = 12.0
_FIT = None
# player_dna.json is gitignored (50 MB); CI rebuilds it with ONLY the current season, so there are no consecutive
# seasons to fit from and every stat came back unfitted: carry() silently did nothing, the projection fell back to
# raw one-year fingerprints and the calibration guard refused to write (Oct 11-12 2026 rebuilds all failed).
# A local fit (all seasons) is saved here and used whenever the live fit can't be made.
FIT_FILE = _D / "dna_carry_fit.json"


def _fit():
    """{grp: {stat: (slope, intercept)}} from same-school returners in consecutive seasons"""
    global _FIT
    if _FIT is not None: return _FIT
    PD = json.load(open(_D / "player_dna.json"))
    ss = sorted(s for s in PD if s.isdigit())
    xs = {g: {k: [] for k in STATS} for g in "GWB"}; ys = {g: {k: [] for k in STATS} for g in "GWB"}
    for a_s, b_s in zip(ss, ss[1:]):
        A = PD[a_s]["players"]; B = PD[b_s]["players"]
        for e, a in A.items():
            b = B.get(e)
            if not b or (a.get("mpg") or 0) < MIN_MPG or (b.get("mpg") or 0) < MIN_MPG: continue
            if a.get("school") != b.get("school"): continue         # returners: no level/role change mixed in
            g = a.get("grp") if a.get("grp") in ("G", "W", "B") else None
            if not g: continue
            for k in STATS:
                if a.get(k) is not None and b.get(k) is not None:
                    xs[g][k].append(a[k]); ys[g][k].append(b[k])
    _FIT = {}
    for g in "GWB":
        _FIT[g] = {}
        for k in STATS:
            if len(xs[g][k]) >= 200:
                sl, ic = np.polyfit(xs[g][k], ys[g][k], 1)
                _FIT[g][k] = (float(min(1.0, max(0.0, sl))), float(ic))
    if not all(_FIT[g] for g in "GWB"):
        if not FIT_FILE.exists():
            raise SystemExit("dna_carry: can't fit (player_dna.json has under 2 seasons) and no saved fit in " + FIT_FILE.name)
        _FIT = {g: {k: tuple(v) for k, v in d.items()} for g, d in json.load(open(FIT_FILE))["fit"].items()}
    return _FIT


def carry(fp, grp=None):
    """the expected next-season fingerprint; stats without a fit (or grp unknown) are left as they are"""
    F = _fit(); g = grp if grp in ("G", "W", "B") else (fp.get("grp") if fp.get("grp") in ("G", "W", "B") else "W")
    out = dict(fp)
    for k, (sl, ic) in F.get(g, {}).items():
        v = fp.get(k)
        if v is not None: out[k] = sl * float(v) + ic
    return out


if __name__ == "__main__":
    import sys
    F = _fit()
    for g, d in F.items():
        print(g, {k: round(v[0], 2) for k, v in d.items()})
    if "--write" in sys.argv:   # run locally (all seasons) after a player_dna rebuild; commit the file
        json.dump({"note": "per position group, next season = slope * this season + intercept (same-school returners, 12+ mpg both seasons)",
                   "fit": F}, open(FIT_FILE, "w"), indent=1)
        print("wrote", FIT_FILE.name)
