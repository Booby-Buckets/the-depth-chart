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
    # MEAC / SWAC / low-D1 that commonly slip through and rank too high
    "Maryland Eastern Shore": "MEAC", "Maryland-Eastern Shore": "MEAC",
    "Norfolk State": "MEAC", "Howard": "MEAC", "Morgan State": "MEAC",
    "Delaware State": "MEAC", "Coppin State": "MEAC", "Bethune-Cookman": "SWAC",
    "Grambling": "SWAC", "Grambling State": "SWAC", "Prairie View": "SWAC",
    "Prairie View A&M": "SWAC", "Alcorn State": "SWAC", "Le Moyne": "NEC",
    "Mississippi Valley St": "SWAC", "Chicago State": "NEC",
    "Central Connecticut": "NEC", "Central Connecticut State": "NEC",
    "St. Francis (PA)": "NEC", "Sacred Heart": "NEC", "Wagner": "NEC",
    "LIU": "NEC", "Long Island": "NEC", "Stonehill": "NEC", "Mercyhurst": "NEC",
    "UT Rio Grande Valley": "WAC", "Utah Tech": "WAC", "Tarleton State": "WAC",
    "Utah Valley": "WAC", "Abilene Christian": "WAC", "Stephen F. Austin": "WAC",
    "Lamar": "Southland", "McNeese": "Southland", "McNeese State": "Southland",
    "Nicholls": "Southland", "Nicholls State": "Southland", "New Orleans": "Southland",
    "Incarnate Word": "Southland", "Houston Baptist": "Southland",
    "Omaha": "Summit", "Denver": "Summit", "St. Thomas (MN)": "Summit",
    "Oral Roberts": "Summit", "Western Illinois": "OVC", "Lindenwood": "OVC",
    "Southern Indiana": "OVC", "Little Rock": "OVC", "Morehead State": "OVC",
    "Eastern Illinois": "OVC", "Tennessee-Martin": "OVC",
    "Idaho": "Big Sky", "Idaho State": "Big Sky", "Portland State": "Big Sky",
    "Weber State": "Big Sky", "Montana": "Big Sky", "Montana State": "Big Sky",
    "Eastern Washington": "Big Sky", "Southern Utah": "WAC",
    "UNC Asheville": "Big South", "Gardner-Webb": "Big South", "Longwood": "Big South",
    "Radford": "Big South", "High Point": "Big South", "Winthrop": "Big South",
    "Presbyterian": "Big South", "USC Upstate": "Big South",
    "VMI": "SoCon", "The Citadel": "SoCon", "Mercer": "SoCon", "Wofford": "SoCon",
    "Samford": "SoCon", "Furman": "SoCon", "Chattanooga": "SoCon", "ETSU": "SoCon",
    "Western Carolina": "SoCon",
}
TIERS.setdefault("Summit", 6)
TIERS.setdefault("Southland", 6)
SCHOOL_CONF.update(EXTRA)

# longest school names first for greedy prefix matching
_KEYS = sorted(SCHOOL_CONF.keys(), key=len, reverse=True)
def _norm(s):
    # ESPN drops the "&" (and "."), so "Texas A&M-Corpus Christi" arrives as
    # "Texas AM-Corpus Christi". Normalize both sides so the full school name
    # matches instead of greedily prefix-matching a power school ("Texas").
    return re.sub(r"\s+", " ", re.sub(r"[&.]", "", str(s).lower())).strip()

_KEYS_LO = [(_norm(k), k) for k in _KEYS]
_KEYS_MAP = dict(_KEYS_LO)

DEFAULT_TIER = 6  # unknown school -> low major (unmapped schools are ~all low-D1)


def _conf(team: str):
    if not team:
        return None
    t = team.strip()
    if t in SCHOOL_CONF:
        return SCHOOL_CONF[t]
    lo = _norm(t)
    if lo in _KEYS_MAP:
        return SCHOOL_CONF[_KEYS_MAP[lo]]
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


# translation of lower-tier production -> tier-1 equivalent. Steeper at the low
# end so dominant low-major box scores don't read like power-conference stars.
TIER_TO_T1 = {1: 1.00, 2: 0.88, 3: 0.76, 4: 0.62, 5: 0.52, 6: 0.43, 7: 0.35}


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
