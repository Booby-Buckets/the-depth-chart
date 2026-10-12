#!/usr/bin/env python3
"""Transfer portal tracker data (transfers.html) — the 2026-27 portal class.

One row per transfer on a 2026-27 roster, joined from what the site already has:
  stat_overall_projected.json  → who transferred (xfer, xfer_from), new team, projected OVR + line, up/down a level
  stat_overall_history.json    → last season's OVR (2025-26)
  derived_stats_2026.json      → last season's line (ppg/rpg/apg/mpg, games, TS%, usage)
  players (Supabase, public)   → name, position, class, height
  conf_members_2027.json       → new team's 2026-27 league

Writes data/portal_2027.json. Status is "committed" for every row — these are players already on a
2026-27 roster. Live portal entries (uncommitted / withdrawn) need a feed we don't have yet; the page
reads an optional `status` per row so a later source can fill it.

    python3 scripts/build_portal.py
"""
import json, re, datetime
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "scripts" / "data"
OUT = ROOT / "data" / "portal_2027.json"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1"


def anon_key():
    m = re.search(r"sb_publishable_[A-Za-z0-9_-]+", (ROOT / "player.html").read_text())
    return m.group(0)


def fetch_players():
    k = anon_key(); h = {"apikey": k, "Authorization": "Bearer " + k}
    out, off = [], 0
    while True:   # stable ORDER BY or pages skip/duplicate rows (see supabase pagination note)
        r = requests.get(f"{SB}/players?select=espn_id,name,team,position,class_year,yr,height&order=id.asc&limit=1000&offset={off}",
                         headers=h, timeout=60)
        r.raise_for_status(); rows = r.json(); out += rows
        if len(rows) < 1000: return out
        off += 1000


def load_last_season():
    """2025-26 lines by espn_id: the local derived-stats file when present (adds TS%/usage), else player_history
    (the file isn't in the repo, so the CI rebuild reads the database)."""
    f = D / "derived_stats_2026.json"
    local = {str(k): v for k, v in json.load(open(f)).items()} if f.exists() else {}
    k = anon_key(); h = {"apikey": k, "Authorization": "Bearer " + k}
    out, off = {}, 0
    while True:
        r = requests.get(f"{SB}/player_history?select=espn_id,name,team,gp,mpg,ppg,rpg,apg&season_year=eq.2026&espn_id=not.is.null"
                         f"&order=id.asc&limit=1000&offset={off}", headers=h, timeout=60)
        r.raise_for_status(); rows = r.json()
        for x in rows:
            g = x.get("gp") or 0
            out[str(x["espn_id"])] = {"name": x.get("name"), "team": x.get("team"), "g": g, "min": (x.get("mpg") or 0) * g,
                                      "ppg": x.get("ppg"), "rpg": x.get("rpg"), "apg": x.get("apg")}
        if len(rows) < 1000:
            out.update(local)   # the local file wins where it has the player (TS%/usage); the database fills the rest
            return out
        off += 1000


def school_resolver(bio, last):
    """short school name (players.team / player_history.team) -> ESPN full name via the longest-school match
    (scripts/school_xwalk.py) plus the coach-profile alias table — Penn and Pennsylvania resolve to the same team."""
    import sys
    sys.path.insert(0, str(ROOT / "scripts"))
    from school_xwalk import prefix_pick
    from build_coach_profiles import ALIAS
    k = anon_key(); h = {"apikey": k, "Authorization": "Bearer " + k}
    fulls = sorted({r["team"] for r in requests.get(f"{SB}/team_seasons?select=team&season_year=eq.2026&limit=1000", headers=h, timeout=60).json()})
    n = lambda s: re.sub(r"[^a-z0-9 ]", "", (s or "").lower().replace("&", " and ").replace("-", " ")).strip()
    FN = {n(f): f for f in fulls}; names = list(FN)
    EXTRA = {"UConn": "UConn Huskies", "Ole Miss": "Ole Miss Rebels", "Pitt": "Pitt Panthers", "UMass": "Massachusetts Minutemen",
             "Penn": "Pennsylvania Quakers", "American University": "American University Eagles", "American": "American University Eagles",
             "FAU": "Florida Atlantic Owls", "Hawaii": "Hawai'i Rainbow Warriors", "ECU": "East Carolina Pirates",
             "Southeastern Louisiana": "SE Louisiana Lions", "Tennessee-Martin": "UT Martin Skyhawks"}
    # rival SCHOOL names for the longest-school rule — short names only (a full name in here would rule itself out)
    SCH = sorted(({n(b.get("team")) for b in bio.values() if b.get("team")} | {n(L.get("team")) for L in last.values() if L.get("team")}) - set(names))
    cache = {}
    def resolve(s):
        if not s: return None
        if s in cache: return cache[s]
        if n(s) in FN: cache[s] = FN[n(s)]; return cache[s]          # already a full name ("Syracuse Orange")
        f = EXTRA.get(s) if EXTRA.get(s) in FN.values() else (ALIAS.get(s) if ALIAS.get(s) in FN.values() else None)
        if not f:
            hit = prefix_pick(n(s), names, SCH); f = FN[hit] if hit else None
        cache[s] = f; return f
    return resolve


def injured_out():
    """(team, name) pairs the owner's injury report has out for the season (same rule as the projection build)"""
    k = anon_key(); h = {"apikey": k, "Authorization": "Bearer " + k}
    try:
        b = (requests.get(f"{SB}/profiles?id=eq.c5784cf4-dd77-4429-b0e6-578a0c1c5c8f&select=freshman_projections", headers=h, timeout=60).json() or [{}])[0].get("freshman_projections") or {}
    except Exception:
        b = {}
    out = set()
    for key, v in b.items():
        if key.startswith("tdc_inj:") and isinstance(v, dict) and v.get("part") and (v.get("timeline") in ("multi", "season") or v.get("play") is False):
            _, t, nm = key.split(":", 2); out.add((t.strip().lower(), nm.strip().lower()))
    return out


def r1(v):
    try: return round(float(v), 1)
    except (TypeError, ValueError): return None


def main():
    proj = json.load(open(D / "stat_overall_projected.json"))["players"]
    hist = json.load(open(D / "stat_overall_history.json"))
    last_ovr = {str(k): v for k, v in (hist.get("2026") or {}).items()}
    last = load_last_season()
    members = json.load(open(D / "conf_members_2027.json"))["teams"]
    bio = {str(p["espn_id"]): p for p in fetch_players() if p.get("espn_id")}

    rows = []
    for espn, v in proj.items():
        if not v.get("xfer"): continue
        b, L = bio.get(espn, {}), last.get(espn, {})
        name = b.get("name") or L.get("name")
        if not name: continue
        rows.append({
            "espn": espn, "name": name, "pos": b.get("position") or "", "cls": b.get("class_year") or b.get("yr") or "",
            "ht": b.get("height") or "", "from": v.get("xfer_from") or L.get("team") or "", "to": v.get("team") or "",
            "toConf": members.get(v.get("team") or "", ""), "status": "committed",
            "ovr": v.get("ovr"), "lastOvr": last_ovr.get(espn), "up": 1 if v.get("xfer_up") else 0,
            "proj": {"ppg": r1(v.get("ppg")), "rpg": r1(v.get("rpg")), "apg": r1(v.get("apg")), "mpg": r1(v.get("mpg"))},
            "last": {"ppg": r1(L.get("ppg")), "rpg": r1(L.get("rpg")), "apg": r1(L.get("apg")),
                     "mpg": r1((L.get("min") or 0) / L["g"]) if L.get("g") else None, "g": L.get("g"),
                     "ts": r1((L.get("ts_pct") or 0) * 100) if L.get("ts_pct") else None, "usg": r1(L.get("usg_pct"))},
        })
    # transfers with too thin a college record for the returner model (under DEMO_MIN minutes) are projected as
    # newcomers in fresh_fit.json — still real transfers: last season's school differs from this one
    fresh = json.load(open(D / "fresh_fit.json"))
    full_of = {}
    for x in rows:
        sb = bio.get(x["espn"], {}).get("team")
        if sb and x["to"]: full_of.setdefault(sb, x["to"])
    have = {x["espn"] for x in rows}
    resolve, INJ = school_resolver(bio, last), injured_out()
    for espn, b in bio.items():
        L = last.get(espn)
        if espn in have or not L or not b.get("team"): continue
        lt, nt = str(L.get("team") or "").strip(), str(b["team"]).strip()
        to = full_of.get(nt, nt)
        if not lt or lt.lower() in (nt.lower(), to.lower()) or lt.lower().startswith(nt.lower() + " "): continue   # same school (Penn = Pennsylvania Quakers)
        f = (fresh.get(nt) or {}).get(b.get("name"))
        if not f:
            # NOT PROJECTED but still a transfer (Oct 2026): out for the season on the owner's injury report
            # (the projection drops them before minutes — Donnie Freeman, Mikey Lewis) or too little college time
            # to project (Quentin McCoy). Listed with a status and no projected line; the schools must resolve to
            # DIFFERENT full names (longest-school match) so a spelling change is never read as a move.
            a_, b_ = resolve(lt), resolve(nt)
            if not a_ or not b_ or a_ == b_: continue
            st = "Out for the season" if (nt.lower(), b.get("name", "").strip().lower()) in INJ else "No projection"
            rows.append({
                "espn": espn, "name": b.get("name"), "pos": b.get("position") or "", "cls": b.get("class_year") or b.get("yr") or "",
                "ht": b.get("height") or "", "from": a_, "to": b_, "toConf": members.get(b_, ""), "status": st,
                "ovr": None, "lastOvr": last_ovr.get(espn), "up": 0,
                "proj": {"ppg": None, "rpg": None, "apg": None, "mpg": None},
                "last": {"ppg": r1(L.get("ppg")), "rpg": r1(L.get("rpg")), "apg": r1(L.get("apg")),
                         "mpg": r1((L.get("min") or 0) / L["g"]) if L.get("g") else None, "g": L.get("g"), "ts": None, "usg": None},
            })
            continue
        rows.append({
            "espn": espn, "name": b.get("name"), "pos": b.get("position") or "", "cls": b.get("class_year") or b.get("yr") or "",
            "ht": b.get("height") or "", "from": lt, "to": to, "toConf": members.get(to, ""), "status": "committed",
            "ovr": f.get("ovr"), "lastOvr": last_ovr.get(espn), "up": 0,
            "proj": {"ppg": r1(f.get("ppg")), "rpg": None, "apg": None, "mpg": r1(f.get("mpg"))},
            "last": {"ppg": r1(L.get("ppg")), "rpg": r1(L.get("rpg")), "apg": r1(L.get("apg")),
                     "mpg": r1((L.get("min") or 0) / L["g"]) if L.get("g") else None, "g": L.get("g"), "ts": None, "usg": None},
        })
    rows.sort(key=lambda x: (-(x["ovr"] or 0), x["name"]))
    OUT.parent.mkdir(exist_ok=True)
    json.dump({"season": 2027, "built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
               "n": len(rows), "players": rows}, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {len(rows)} transfers to {OUT.relative_to(ROOT)}")
    write_nil_origin(rows, members)


def write_nil_origin(rows, members):
    """data/nil_origin.json — each transfer's ORIGIN school + league, so tdc-nil.js prices his NIL off where
    he earned it (his old conference premium / program / floor), not the school he's going to."""
    nd = json.load(open(ROOT / "nil-data.json"))["teams"]
    short_of_espn = {str(r["espn_id"]): k for k, t in nd.items() for r in t.get("players", []) if r.get("espn_id") is not None}
    full2short = {}
    for x in rows:   # a transfer's new school (full name) sits under its short nil-data key
        k = short_of_espn.get(x["espn"])
        if k and x["to"]: full2short.setdefault(x["to"], k)
    def short(full):
        if full in full2short: return full2short[full]
        best = max((k for k in nd if full.startswith(k + " ")), key=len, default=None)   # "Saint Mary's Gaels" -> "Saint Mary's"
        return best or full
    out = {x["espn"]: {"t": short(x["from"]), "c": members.get(x["from"], "")} for x in rows if x["from"]}
    json.dump({"season": 2027, "n": len(out), "origin": out}, open(ROOT / "data" / "nil_origin.json", "w"), separators=(",", ":"))
    print(f"wrote {len(out)} transfer origins to data/nil_origin.json")


if __name__ == "__main__":
    main()
