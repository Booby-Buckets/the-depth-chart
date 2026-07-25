#!/usr/bin/env python3
"""
validate_projmodel.py — offline prototype of the v5 projected grade, for validation only.

grade_v5 = demonstrated grade (rate-quality anchor)
         + empirical development delta (dev_curves.json, class transition x level tier)
         + role/minutes adjustment (projected minutes vs the grade's expected minutes)
         clamped to [demonstrated - FLOOR_GAP, demonstrated + CEIL].

The role term is the reliable projection lever: a player projected far below the minutes
his grade implies (a buried transfer like Drew) drops; a correctly-slotted star holds.
Run across a real roster to confirm the distribution before wiring into live grades.
"""
import urllib.request, json, os

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
DATA = os.path.join(os.path.dirname(__file__), "data")
DEV = json.load(open(os.path.join(DATA, "dev_curves.json")))
BR = json.load(open(os.path.join(DATA, "projgrade_bridge.json")))
LV = json.load(open(os.path.join(DATA, "level_adj.json")))
SLOT_MIN = [0, 31, 30, 29, 27, 25, 19, 16, 12, 9, 7]


def level_discount(conf):
    s = LV["conf_strength"].get(conf)
    return 0.0 if s is None else LV["k"] * (LV["top"] - s)

ROLE_K = 14.0      # how hard a role loss bites
ROLE_UP = 3.0      # cap on a role-increase bonus
FLOOR_GAP = 12.0   # a proven grade can't fall more than this below its demonstrated value
CEIL = 7.0


def q(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(SB + "/rest/v1/" + path, headers=H), timeout=30))


def cls_trans(yr):
    y = (yr or "").lower()
    if y.startswith("fr"): return "so"      # a freshman BECOMES a sophomore next year
    if y.startswith("so"): return "jr"
    if y.startswith("jr"): return "sr"
    return None                              # seniors graduate — no next season


def tier(g):
    return "low" if g < 73 else ("mid" if g < 84 else "high")


MAXMIN = 34.0      # nobody plays more than this
TOTAL = 200.0      # 5 on the floor x 40 min
ROT_BAND = 16.0    # a player this far below the 5th-best contributes ~0 minutes
ROT_POWER = 2.2    # concentrates minutes on the better players


def project_minutes(quals):
    """Rotation/minutes model — NO manual depth chart. Given every player's quality prior
    (demonstrated grade / freshman OVR), derive projected minutes: quality-weighted, capped
    at 34, a 7-12 man rotation whose DEPTH emerges from how balanced the roster is."""
    n = len(quals)
    order = sorted(range(n), key=lambda i: -quals[i])
    sq = [quals[i] for i in order]
    q5 = sq[4] if n >= 5 else sq[-1]
    base = q5 - ROT_BAND
    w = [max(0.0, q - base) ** ROT_POWER for q in sq]
    for i in range(12, n): w[i] = 0.0            # hard cap: at most a 12-man rotation
    s = sum(w) or 1.0
    m = [TOTAL * x / s for x in w]
    for _ in range(8):                            # cap at MAXMIN, push overflow down the rotation
        over = sum(max(0.0, x - MAXMIN) for x in m)
        if over < 0.1: break
        m = [min(x, MAXMIN) for x in m]
        room = [(MAXMIN - x) if 0 < x < MAXMIN else 0.0 for x in m]
        rs = sum(room) or 1.0
        m = [x + over * room[i] / rs for i, x in enumerate(m)]
    out = [0.0] * n
    for i, idx in enumerate(order): out[idx] = round(m[i], 1)
    return out


def exp_min(g):
    return max(6.0, min(32.0, 8.0 + (g - 70) * 0.9))


def grade_v5(g, yr, pm):
    trans = cls_trans(yr)
    dev_bpm = (DEV.get("bpm_delta", {}).get(trans, {}) or {}).get(tier(g), 0) if trans else 0
    dev_grade = dev_bpm * BR["b"]
    em = exp_min(g)
    ratio = pm / em if em else 1
    role = -ROLE_K * (1 - ratio) if ratio < 1 else min(ROLE_UP, ROLE_K * 0.4 * (ratio - 1))
    v = g + dev_grade + role
    return int(round(max(g - FLOOR_GAP, min(g + CEIL, v))))


# conference lookup that survives the short-vs-full team-name trap (bbref "Belmont" vs
# team_seasons "Belmont Bruins")
_TC_NORM = {k.lower().strip(): v for k, v in LV["team_conf"].items()}
def conf_of(school):
    if not school: return None
    s = school.lower().strip()
    if s in _TC_NORM: return _TC_NORM[s]
    for full, c in _TC_NORM.items():
        if full.startswith(s + " ") or s.startswith(full + " "): return c
    return None


def last_conf_map():
    """name -> conference the player last produced in (2025-26 school), for the level discount."""
    m = {}
    for r in q("bbref_seasons?season_year=eq.2026&select=player,school"):
        c = conf_of(r.get("school"))
        if r.get("player") and c: m[r["player"].strip().lower()] = c
    return m


def main():
    import sys
    team = sys.argv[1] if len(sys.argv) > 1 else "Duke"
    rows = q(f"players?team=eq.{team}&select=name,tdc_grade,mpg,ppg,yr&order=tdc_grade.desc")
    rows = [r for r in rows if r.get("tdc_grade") not in (None, "")]
    lcm = last_conf_map()
    cur_conf = conf_of(team)
    # quality prior = demonstrated grade minus the level discount for where it was EARNED
    qual = []
    for r in rows:
        g = float(r["tdc_grade"])
        conf = lcm.get((r["name"] or "").strip().lower()) or cur_conf
        qual.append(g - level_discount(conf))
    mins = project_minutes(qual)                   # minutes off the level-adjusted quality
    print(f"=== {team} — level-adj quality -> minutes -> grade v5 (no manual depth chart) ===")
    print(f"{'player':22} {'yr':4} {'dem':>3} {'qual':>4} {'proj_min':>8} {'v5':>4}  Δ")
    tot = 0.0
    for r, ql, pm in sorted(zip(rows, qual, mins), key=lambda z: -z[2]):
        g = float(r["tdc_grade"])
        v = grade_v5(ql, r.get("yr"), pm); tot += pm    # grade anchored on level-adj quality
        d = v - int(g)
        flag = '  <-- deep bench' if pm < 6 else ''
        print(f"{(r['name'] or '')[:22]:22} {(r.get('yr') or '')[:4]:4} {int(g):>3} {round(ql,1):>4} {pm:>8} {v:>4}  {d:+d}{flag}")
    print(f"{'TOTAL MIN':22} {'':4} {'':>3} {'':>4} {round(tot,1):>8}")


if __name__ == "__main__":
    main()
