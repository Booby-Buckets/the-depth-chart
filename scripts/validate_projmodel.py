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
SLOT_MIN = [0, 31, 30, 29, 27, 25, 19, 16, 12, 9, 7]

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


def proj_min(row):
    d = row.get("depth_order")
    try: d = int(d)
    except Exception: d = None
    slot = SLOT_MIN[d] if (d and 1 <= d < len(SLOT_MIN)) else (5 if d else None)
    last = float(row.get("mpg") or 0)
    is_tr = bool((row.get("hometown") or "").strip())          # transfer signal (best-effort)
    # a returner on the SAME team keeps ~his minutes; a transfer trusts the new depth slot
    if slot is None: return last or 12
    if is_tr: return slot
    return max(slot, last * 0.85) if last else slot


def exp_min(g):
    return max(6.0, min(32.0, 8.0 + (g - 70) * 0.9))


def grade_v5(row):
    try: g = float(row.get("tdc_grade"))
    except Exception: return None
    trans = cls_trans(row.get("yr") or row.get("class_year"))
    dev_bpm = (DEV.get("bpm_delta", {}).get(trans, {}) or {}).get(tier(g), 0) if trans else 0
    dev_grade = dev_bpm * BR["b"]
    pm = proj_min(row); em = exp_min(g)
    ratio = pm / em if em else 1
    role = -ROLE_K * (1 - ratio) if ratio < 1 else min(ROLE_UP, ROLE_K * 0.4 * (ratio - 1))
    v = g + dev_grade + role
    return max(g - FLOOR_GAP, min(g + CEIL, round(v)))


def main():
    import sys
    team = sys.argv[1] if len(sys.argv) > 1 else "Duke"
    rows = q(f"players?team=eq.{team}&select=name,tdc_grade,mpg,ppg,yr,depth_order,starter,hometown&order=tdc_grade.desc")
    print(f"=== {team} — projected grade v5 (prototype) ===")
    print(f"{'player':22} {'yr':4} {'dem':>3} {'proj_min':>8} {'v5':>4}  Δ")
    for r in rows:
        v = grade_v5(r)
        if v is None: continue
        g = int(float(r["tdc_grade"])); pm = round(proj_min(r), 1)
        d = v - g
        flag = '  <-- role-blocked' if d <= -6 else ''
        print(f"{(r['name'] or '')[:22]:22} {(r.get('yr') or '')[:4]:4} {g:>3} {pm:>8} {v:>4}  {d:+d}{flag}")


if __name__ == "__main__":
    main()
