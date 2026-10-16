#!/usr/bin/env python3
"""Daily snapshot of the 2026-27 power rankings, so the homepage can show who is rising and falling.

Reads the published rankings (Supabase predictive_ratings, season 2027 — what the index table shows) and writes
scripts/data/rank_history_2027.json:  { "season": 2027, "days": { "YYYY-MM-DD": { full team name: [rank, rating] } } }
One entry per US-Eastern calendar day (a later run the same day overwrites it), the last 150 days kept.
Runs at the end of rebuild-projections.yml, after the headless publish; safe to run by hand.

    python3 scripts/snapshot_ranks.py
"""
import datetime, json, pathlib, re, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "data" / "rank_history_2027.json"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1"


def main():
    key = re.search(r"sb_publishable_[A-Za-z0-9_-]+", (ROOT / "player.html").read_text()).group(0)
    req = urllib.request.Request(f"{SB}/predictive_ratings?select=data&season=eq.2027", headers={"apikey": key, "Authorization": "Bearer " + key})
    rows = json.load(urllib.request.urlopen(req, timeout=60))
    teams = (rows[0].get("data") or {}).get("teams") if rows else None
    if not teams or len(teams) < 300:
        raise SystemExit(f"rankings look incomplete ({len(teams or [])} teams) — snapshot skipped")
    snap = {t["full"]: [int(t["rank"]), round(float(t["rating"]), 2)] for t in teams if t.get("full") and t.get("rank") is not None}
    et = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=4)   # US Eastern (EDT) calendar day
    day = et.strftime("%Y-%m-%d")
    doc = json.load(open(OUT)) if OUT.exists() else {"season": 2027, "days": {}}
    doc["days"][day] = snap
    for d in sorted(doc["days"])[:-150]:
        del doc["days"][d]
    doc["note"] = "Daily snapshot of the published 2026-27 power rankings (rank, rating) by full team name; index.html shows rank movement vs ~a week ago."
    OUT.write_text(json.dumps(doc, separators=(",", ":"), sort_keys=True))
    print(f"rank snapshot {day}: {len(snap)} teams ({len(doc['days'])} days kept)")


if __name__ == "__main__":
    main()
