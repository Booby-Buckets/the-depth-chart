#!/usr/bin/env python3
"""Resolve a (possibly mascot-suffixed) team name -> conference tier 1..7."""
import json, re
from pathlib import Path

_d = json.loads((Path(__file__).parent / "data" / "conf_map.json").read_text())
TIERS = dict(_d["tiers"])
SCHOOL_CONF = dict(_d["school_conf"])

# tiers for the conferences present in SCHOOL_CONF but missing from CONF_TIERS
TIERS.update({"Big South": 6, "Horizon": 5, "Ivy": 5, "Patriot": 6,
              "SoCon": 5, "WAC": 4})

# Low/mid-majors whose names share a prefix with a power school — add them
# explicitly so longest-prefix matching doesn't tag them as power.
EXTRA = {
    "Alabama A&M": "SWAC", "Alabama State": "SWAC", "Arkansas State": "Sun Belt",
    "Arkansas-Pine Bluff": "SWAC", "Texas Southern": "SWAC", "Texas State": "Sun Belt",
    "Texas A&M-Corpus Christi": "Southland", "Texas-Arlington": "WAC",
    "Florida A&M": "SWAC", "Florida Atlantic": "AAC", "Florida Gulf Coast": "ASUN",
    "Florida International": "CUSA", "Georgia State": "Sun Belt",
    "Georgia Southern": "Sun Belt", "Miami (OH)": "MAC", "Indiana State": "MVC",
    "Mississippi Valley State": "SWAC", "Jackson State": "SWAC",
    "Northwestern State": "Southland", "Kansas City": "Summit",
    "Tennessee State": "OVC", "Tennessee Tech": "OVC", "Tennessee-Martin": "OVC",
    "Southern Illinois": "MVC", "Southern Miss": "Sun Belt", "Southern": "SWAC",
    "Cal State Northridge": "Big West", "Cal State Fullerton": "Big West",
    "Cal State Bakersfield": "Big West", "Sacramento State": "Big Sky",
    "South Carolina State": "MEAC", "South Carolina Upstate": "Big South",
    "South Dakota": "Summit", "South Dakota State": "Summit",
    "South Alabama": "Sun Belt", "North Carolina A&T": "CAA",
    "North Carolina Central": "MEAC", "North Dakota": "Summit",
    "North Dakota State": "Summit", "North Florida": "ASUN", "North Texas": "AAC",
    "Northern Arizona": "Big Sky", "Northern Colorado": "Big Sky",
    "Northern Iowa": "MVC", "Northern Kentucky": "Horizon", "Northern Illinois": "MAC",
    "Washington State": "WCC", "Oregon State": "WCC", "Boston University": "Patriot",
    "Charleston Southern": "Big South", "Coastal Carolina": "Sun Belt",
    "Loyola Marymount": "WCC", "Loyola Chicago": "A10", "Loyola Maryland": "Patriot",
    "California Baptist": "WAC", "Houston Christian": "Southland",
    "Houston Baptist": "Southland", "Cal Baptist": "WAC",
}
TIERS.setdefault("Summit", 6)
TIERS.setdefault("Southland", 6)
SCHOOL_CONF.update(EXTRA)

# longest school names first for greedy prefix matching
_KEYS = sorted(SCHOOL_CONF.keys(), key=len, reverse=True)
_KEYS_LO = [(k.lower(), k) for k in _KEYS]

DEFAULT_TIER = 5  # unknown school -> mid/low major


def _conf(team: str):
    if not team:
        return None
    t = team.strip()
    if t in SCHOOL_CONF:
        return SCHOOL_CONF[t]
    lo = t.lower()
    if lo in dict(_KEYS_LO):
        return SCHOOL_CONF[dict(_KEYS_LO)[lo]]
    # mascot-suffixed: longest known school that is a prefix followed by space
    for klo, k in _KEYS_LO:
        if lo == klo or lo.startswith(klo + " "):
            return SCHOOL_CONF[k]
    return None


def tier(team: str) -> int:
    c = _conf(team)
    if c is None:
        return DEFAULT_TIER
    return TIERS.get(c, DEFAULT_TIER)


# translation of lower-tier production -> tier-1 equivalent (from tdc-engine)
TIER_TO_T1 = {1: 1.00, 2: 0.90, 3: 0.78, 4: 0.66, 5: 0.58, 6: 0.50, 7: 0.42}


if __name__ == "__main__":
    import pandas as pd
    df = pd.read_pickle(Path(__file__).parent / "data" / "history_all.pkl")
    teams = sorted(df.team.dropna().unique())
    by_tier = {}
    for t in teams:
        by_tier.setdefault(tier(t), []).append(t)
    for tr in sorted(by_tier):
        print(f"\n=== TIER {tr} ({len(by_tier[tr])} teams) ===")
        print(", ".join(by_tier[tr][:60]))
