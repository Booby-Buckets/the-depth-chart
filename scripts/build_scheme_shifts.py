#!/usr/bin/env python3
"""build_scheme_shifts.py — scheme-aware projection adjustments.

The projection engine carries a player's last line forward with tiny nudges. That's
wrong for anyone changing systems: a Baylor scorer entering Pitino's St. John's
(more havoc, faster, rim-attacking, fewer threes) should project toward ST. JOHN'S
basketball, not a copy of last year. This computes, per player who changed teams,
a set of bounded stat shifts from the DELTA between his old team's system and his
new one — using team_dna (tempo, four factors, havoc) + shot_genome_teams (shot
diet, look quality). Emits scripts/data/scheme_shifts.json = {players.id: {mult/delta
per stat, plus a human 'why'}} for the projection engine to apply.

Transfers are detected by the `hometown` field, which the roster pipeline uses to
carry the transfer-origin school (e.g. Tounde Yessoufou hometown='Baylor').
"""
import os, json, urllib.request, urllib.parse

KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
D = os.path.join(os.path.dirname(__file__), "data")


def get(path):
    rows, frm = [], 0
    while True:
        req = urllib.request.Request(SB + "/rest/v1/" + path,
                                     headers={**HDR, "Range-Unit": "items", "Range": "%d-%d" % (frm, frm + 999)})
        b = json.load(urllib.request.urlopen(req, timeout=60)); rows += b
        if len(b) < 1000:
            break
        frm += 1000
    return rows


def clamp(v, a, b):
    return max(a, min(b, v))


# ── team system profiles: team_dna + shot genome, keyed by full name ──
DNA = json.load(open(os.path.join(D, "team_dna.json")))["2026"]["teams"]
SGT = {t["team"]: t for t in json.load(open(os.path.join(D, "shot_genome_teams.json")))["teams"]}


def resolve(short):
    """short school name ('Baylor', "St. John's") -> full team_dna key."""
    s = (short or "").strip().lower()
    if not s:
        return None
    # exact-ish: full name whose school portion == short (strip mascot)
    best = None
    for full in DNA:
        fl = full.lower()
        if fl == s or fl.startswith(s + " "):
            # prefer the match whose leading words equal the short name exactly
            if best is None or len(full) < len(best):
                best = full
    return best


def system_of(full):
    d = DNA.get(full) or {}
    sg = SGT.get(full, {})
    off = sg.get("off", {})
    return {
        "tempo": d.get("tempo") or 68.0,
        "dTOV": d.get("dTOV") or 15.0,          # forced-TO% = havoc
        "oeFG": d.get("oeFG") or 50.0,
        "oORB": d.get("oORB") or 28.0,
        "oFTr": d.get("oFTr") or 32.0,
        "threeRate": off.get("threeRate") or 38.0,
        "rimRate": off.get("rimRate") or 42.0,
        "lookq": off.get("lq") or 50.0,
    }


def shifts(old, new):
    """Bounded stat multipliers/deltas from old-system -> new-system."""
    pace = clamp(new["tempo"] / old["tempo"], 0.9, 1.12)
    havoc = clamp(new["dTOV"] / old["dTOV"], 0.7, 1.5)
    three = clamp(new["threeRate"] / old["threeRate"], 0.6, 1.6)
    ftr = clamp(new["oFTr"] / old["oFTr"], 0.75, 1.3)
    orb = clamp(new["oORB"] / old["oORB"], 0.8, 1.25)
    lq_d = clamp(new["lookq"] - old["lookq"], -6, 6)
    out = {
        # counting stats ride pace; steals ALSO ride the new defense's havoc (system-driven)
        "ppg_mult": round(pace, 3),
        "rpg_mult": round(pace * (0.6 + 0.4 * orb), 3),
        "apg_mult": round(pace, 3),
        "stl_mult": round(pace * (1 + 0.7 * (havoc - 1)), 3),
        "blk_mult": round(pace, 3),
        "tpa_mult": round(pace * (0.55 + 0.45 * three), 3),   # blend shot diet toward new team
        "fta_mult": round(pace * (0.6 + 0.4 * ftr), 3),
        "fg_pct_delta": round(lq_d * 0.25 + (0.6 if three < 0.9 else 0.0), 2),  # better looks / more rim → FG%
        "tp_pct_delta": round(lq_d * 0.15, 2),
    }
    return out, {"pace": round(pace, 3), "havoc": round(havoc, 3), "threeShift": round(three, 3), "lookQd": round(lq_d, 1)}


def main():
    players = get("players?select=id,espn_id,name,team,hometown,tdc_grade,ppg,tpa,stl&tdc_grade=not.is.null&hometown=not.is.null")
    out = {}
    demo = []
    for p in players:
        origin = resolve(p.get("hometown"))
        dest = resolve(p.get("team"))
        if not origin or not dest or origin == dest:
            continue                     # not a resolvable inter-team move
        old, new = system_of(origin), system_of(dest)
        s, why = shifts(old, new)
        # skip trivial moves (near-identical systems)
        if abs(s["stl_mult"] - 1) < 0.04 and abs(s["tpa_mult"] - 1) < 0.05 and abs(s["fg_pct_delta"]) < 0.4:
            continue
        out[str(p["id"])] = {**s, "from": origin, "to": dest}
        demo.append((p["name"], origin, dest, s, why, p))

    path = os.path.join(D, "scheme_shifts.json")
    json.dump({"season": 2026, "n": len(out), "shifts": out}, open(path, "w"))
    print("wrote %s — %d players with a system change" % (path, len(out)))

    # validate on Tounde + a couple others
    for nm, o, d, s, why, p in demo:
        if nm in ("Tounde Yessoufou",) or (nm and "yessoufou" in nm.lower()):
            print("\n== %s : %s -> %s ==" % (nm, o, d))
            print("   system delta: pace x%s, havoc x%s, 3PA shift x%s, lookQ %+.1f" % (why["pace"], why["havoc"], why["threeShift"], why["lookQd"]))
            print("   last year: %s ppg, %s 3PA, %s stl" % (p["ppg"], p["tpa"], p["stl"]))
            def ap(v, m): return round((float(v or 0)) * m, 1)
            print("   scheme-shifted: %s ppg (x%s), 3PA %s (x%s), STL %s (x%s), FG%% %+.2f" % (
                ap(p["ppg"], s["ppg_mult"]), s["ppg_mult"], ap(p["tpa"], s["tpa_mult"]), s["tpa_mult"],
                ap(p["stl"], s["stl_mult"]), s["stl_mult"], s["fg_pct_delta"]))


if __name__ == "__main__":
    main()
