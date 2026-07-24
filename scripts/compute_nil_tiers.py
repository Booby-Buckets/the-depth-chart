#!/usr/bin/env python3
"""compute_nil_tiers.py — automate teams.nil_tier (spending power) + nil_grade (Value/ROI).

Per Aidan (2026-07-23):
  nil_tier (Tier 1-9, scales every player's NIL $): PROGRAM SPENDING POWER, from
    prestige (multi-year SRS + NCAA-tournament resume) + conference + a nudge for the
    CURRENT roster's grade (a program loading up an elite roster is spending big).
  nil_grade ("NIL Eval", A-F): VALUE / ROI — how much on-court quality the spending buys.
    A big spender (high tier) with a so-so roster grades low (that's why Kansas = D).

DRY RUN by default: reads via the public anon key, prints computed vs current tiers, writes
NOTHING. Pass --write to PATCH teams (needs the service key in scripts/load_supabase.py) —
that's Aidan's to run. After writing, re-run compute_nil.py to refresh nil-data.json.

  python3 scripts/compute_nil_tiers.py            # dry run (safe, read-only)
  python3 scripts/compute_nil_tiers.py --write     # PATCH teams.nil_tier + nil_grade
"""
import re, sys, json, math, urllib.request, urllib.parse, os
from collections import defaultdict

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
ANON = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
WRITE = "--write" in sys.argv

def _key():
    # service key only needed for --write; read path uses the anon key
    try:
        here = os.path.dirname(__file__)
        return re.search(r'SB_KEY\s*=\s*"(sb_secret_[^"]+)"', open(os.path.join(here, "load_supabase.py")).read()).group(1)
    except Exception:
        return None

def fetch(path):
    out, frm = [], 0
    key = ANON
    while True:
        h = {"apikey": key, "Authorization": "Bearer " + key, "Range-Unit": "items", "Range": "%d-%d" % (frm, frm + 999)}
        req = urllib.request.Request(SB + "/rest/v1/" + path, headers=h)
        b = json.load(urllib.request.urlopen(req, timeout=90))
        out += b
        if len(b) < 1000: break
        frm += 1000
    return out

def gnum(v):
    try: return float(v)
    except Exception: return None

# ── prestige inputs ──
TOUR_PTS = {"champion": 100, "runner": 82, "final four": 70, "final 4": 70, "elite eight": 52,
            "elite 8": 52, "sweet sixteen": 36, "sweet 16": 36, "round of 32": 20, "round of 64": 10,
            "first four": 6, "did not": 0}
def tour_score(res):
    if not res: return 0
    r = str(res).lower()
    for k, v in TOUR_PTS.items():
        if k in r: return v
    return 0

CONF_TIER = {  # conference spending weight, 0-100 (keys checked as substrings, longest first)
    "sec": 100,
    "big ten": 96, "big 10": 96, "b1g": 96, "b10": 96,
    "big 12": 94, "big-12": 94, "b12": 94,
    "acc": 90,
    "big east": 84, "big-east": 84, "be": 84,
    "american": 58, "aac": 58,
    "mountain west": 52, "mwc": 52, "mw": 52,
    "west coast": 50, "wcc": 50,
    "atlantic 10": 48, "a-10": 48, "a10": 48,
}
def conf_weight(c):
    if not c: return 34
    lo = str(c).lower().strip()
    if lo in CONF_TIER: return CONF_TIER[lo]                 # exact abbrev (B10, ACC, SEC…)
    for k in sorted(CONF_TIER, key=len, reverse=True):        # then substring, longest key first
        if k in lo: return CONF_TIER[k]
    return 34  # everyone else: mid/low-major baseline

def tier_num(t):
    m = re.search(r"(\d+)", str(t or ""))
    return int(m.group(1)) if m else None

def norm01(x, lo, hi):
    if x is None: return 0.0
    return max(0.0, min(1.0, (x - lo) / (hi - lo)))

def main():
    teams = fetch("teams?select=name,conference,nil_tier,nil_grade")
    ts = fetch("team_seasons?select=team,season_year,srs,ncaa_result&season_year=gte.2016&srs=not.is.null")
    players = fetch("players?select=team,tdc_grade,mpg&tdc_grade=not.is.null")

    # roster strength per team (short name): rotation-weighted mean of top grades
    by_team = defaultdict(list)
    for p in players:
        g = gnum(p.get("tdc_grade"))
        if g is not None and p.get("team"): by_team[p["team"]].append(g)
    def roster_score(short):
        gs = sorted(by_team.get(short, []), reverse=True)[:9]
        if not gs: return None
        w = [5, 4, 3, 2, 2, 1, 1, 1, 1][:len(gs)]
        return sum(g * wt for g, wt in zip(gs, w)) / sum(w)

    # prestige per full team name: recency-weighted SRS + tournament resume (last ~6 seasons)
    seasons = defaultdict(list)
    for r in ts:
        seasons[r["team"]].append((int(r["season_year"]), gnum(r["srs"]), tour_score(r.get("ncaa_result"))))
    prestige_full = {}
    for full, rows in seasons.items():
        rows = sorted(rows, key=lambda x: -x[0])[:10]   # program stature over ~10 seasons, recency-decayed
        wsum = tw = tour = 0
        for i, (yr, srs, tp) in enumerate(rows):
            w = 0.85 ** i                       # recency decay
            if srs is not None: wsum += w * srs; tw += w
            tour += w * tp
        avg_srs = (wsum / tw) if tw else None
        tour_avg = (tour / sum(0.85 ** i for i in range(len(rows)))) if rows else 0
        prestige_full[full] = {"srs": avg_srs, "tour": tour_avg}

    # crosswalk short team name -> best full name (prefix; disambiguate by highest SRS —
    # "Alabama" -> Crimson Tide (+25), not Alabama State (-8))
    def match_full(short):
        lo = short.lower()
        cands = [f for f in prestige_full if f.lower() == lo or f.lower().startswith(lo + " ")]
        if not cands: cands = [f for f in prestige_full if f.lower().startswith(lo)]
        if not cands: return None
        return max(cands, key=lambda f: (prestige_full[f]["srs"] if prestige_full[f]["srs"] is not None else -99))

    rows = []
    for t in teams:
        short = t["name"]
        rs = roster_score(short)
        if rs is None:            # only score teams with a roster (the 79 that carry tiers)
            continue
        full = match_full(short)
        pr = prestige_full.get(full, {}) if full else {}
        srs = pr.get("srs"); tour = pr.get("tour", 0)
        # component scores 0-100
        srs_sc = norm01(srs, -6, 26) * 100 if srs is not None else 30
        tour_sc = min(100, tour * 1.15)
        prestige = 0.62 * srs_sc + 0.38 * tour_sc
        conf_sc = conf_weight(t.get("conference"))
        roster_sc = norm01(rs, 66, 88) * 100
        # spending power: prestige, conference, and the current roster (Aidan: also weight roster)
        spend = 0.40 * prestige + 0.30 * conf_sc + 0.30 * roster_sc
        rows.append({"name": short, "conf": t.get("conference"), "cur_tier": tier_num(t.get("nil_tier")),
                     "cur_grade": t.get("nil_grade"), "spend": spend, "prestige": prestige,
                     "conf_sc": conf_sc, "roster_sc": roster_sc, "roster_g": rs})

    # map spending score -> Tier 1-9 by rank quantiles (Tier 1 = top spenders). Keep the
    # existing shape roughly (few Tier-1s, fat middle) but data-driven.
    rows.sort(key=lambda r: -r["spend"])
    n = len(rows)
    # cumulative share cutoffs per tier — capped at T7 to match the existing manual scheme
    cuts = [0.05, 0.15, 0.28, 0.46, 0.66, 0.85, 1.01]  # Tier 1..7
    for i, r in enumerate(rows):
        q = i / n
        raw = next(t for t, c in enumerate(cuts, 1) if q < c)
        # anchor 30% toward the manual tier so programs with known collectives (Louisville,
        # Kansas…) don't drift far from where Aidan hand-set them
        if r["cur_tier"]:
            r["tier"] = max(1, min(7, round(0.70 * raw + 0.30 * r["cur_tier"])))
        else:
            r["tier"] = raw

    # ROI / Value grade: roster quality vs what the spending tier "buys". Expected roster
    # score rises with spending; actual minus expected -> letter.
    exp_by_tier = {}
    for r in rows:
        exp_by_tier.setdefault(r["tier"], []).append(r["roster_g"])
    exp_by_tier = {k: (sum(v) / len(v)) for k, v in exp_by_tier.items()}
    def roi_grade(r):
        exp = exp_by_tier.get(r["tier"], r["roster_g"])
        d = r["roster_g"] - exp                   # + = punches above its spend
        return ("A+" if d >= 3.2 else "A" if d >= 2.2 else "A-" if d >= 1.4 else "B+" if d >= 0.7 else
                "B" if d >= 0.1 else "B-" if d >= -0.5 else "C+" if d >= -1.2 else "C" if d >= -2.0 else
                "C-" if d >= -2.8 else "D" if d >= -3.8 else "F")
    for r in rows: r["grade"] = roi_grade(r)

    # ── report ──
    print("NIL tier automation — DRY RUN (no writes)\n" if not WRITE else "NIL tier automation — WRITING\n")
    print("%-26s %-10s %-8s %-8s %-7s %s" % ("TEAM", "CONF", "cur→new", "grade", "spend", "prestige/conf/roster"))
    changed = 0
    for r in sorted(rows, key=lambda r: (r["tier"], -r["spend"])):
        arrow = "T%s→T%d" % (r["cur_tier"] or "-", r["tier"])
        if r["cur_tier"] != r["tier"]: changed += 1
        print("%-26s %-10s %-8s %-4s(%s) %5.1f   %2.0f/%2.0f/%2.0f" % (
            r["name"][:26], str(r["conf"])[:10], arrow, r["grade"], str(r["cur_grade"] or "-"),
            r["spend"], r["prestige"], r["conf_sc"], r["roster_sc"]))
    print("\n%d teams, %d tier changes vs current manual." % (len(rows), changed))
    from collections import Counter
    print("new tier distribution:", dict(sorted(Counter(r["tier"] for r in rows).items())))

    if not WRITE:
        print("\n(dry run — nothing written. Re-run with --write once the tiers look right,")
        print(" then run compute_nil.py to refresh nil-data.json.)")
        return
    key = _key()
    if not key:
        print("\nNo service key found (scripts/load_supabase.py). Cannot --write."); return
    for r in rows:
        payload = json.dumps({"nil_tier": "Tier %d" % r["tier"], "nil_grade": r["grade"]}).encode()
        req = urllib.request.Request(
            SB + "/rest/v1/teams?name=eq." + urllib.parse.quote(r["name"]),
            data=payload, method="PATCH",
            headers={"apikey": key, "Authorization": "Bearer " + key,
                     "Content-Type": "application/json", "Prefer": "return=minimal"})
        try:
            urllib.request.urlopen(req, timeout=60)
        except Exception as e:
            print("  PATCH failed for %s: %s" % (r["name"], e))
    print("\nWrote %d teams. Now run: python3 scripts/compute_nil.py" % len(rows))

if __name__ == "__main__":
    main()
