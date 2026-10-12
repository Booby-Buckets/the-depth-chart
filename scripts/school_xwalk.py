"""school_xwalk.py — match a school name ("Alabama") to the team name it prefixes ("Alabama Crimson Tide").

The old matchers took the SHORTEST team name the school prefixes, which ties or goes wrong whenever another school's
name starts with this one: "Alabama A&M Bulldogs" and "Alabama Crimson Tide" are both 20 characters, so "Alabama" could
land on Alabama A&M. The rule here: a team name belongs to the LONGEST known school that prefixes it, so "Alabama A&M
Bulldogs" is Alabama A&M's and can never be Alabama's. All inputs are already-normalised strings (each caller keeps its
own normaliser); `schools` is every school name the caller knows, so the longer rivals can be ruled out.
"""


def _pre(name, school):
    return name == school or name.startswith(school + " ")


def prefix_pick(school, names, schools, loose=False):
    """the team name in `names` that `school` prefixes, skipping names a LONGER school in `schools` also prefixes.
    loose=True also allows a bare prefix ("st johns" -> "st johns ny red storm") as a last resort."""
    rivals = [s for s in schools if len(s) > len(school) and _pre(s, school)]
    def ok(n): return not any(_pre(n, r) for r in rivals)
    cand = [n for n in names if _pre(n, school) and ok(n)]
    if not cand and loose:
        cand = [n for n in names if n.startswith(school) and ok(n)]
    return min(cand, key=lambda n: (len(n.split()), len(n), n)) if cand else None
