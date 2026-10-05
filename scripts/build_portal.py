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
    if f.exists():
        return {str(k): v for k, v in json.load(open(f)).items()}
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
        if len(rows) < 1000: return out
        off += 1000


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
    rows.sort(key=lambda x: (-(x["ovr"] or 0), x["name"]))
    OUT.parent.mkdir(exist_ok=True)
    json.dump({"season": 2027, "built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
               "n": len(rows), "players": rows}, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {len(rows)} transfers to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
