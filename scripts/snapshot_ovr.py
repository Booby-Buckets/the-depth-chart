#!/usr/bin/env python3
"""snapshot_ovr.py — how each player's displayed overall has moved this season (owner, Nov 2026: show who rises and falls).

ovr_display_2027.json holds only today's number, so this keeps one value per US-Eastern day, stored only when it changes:
  scripts/data/ovr_history_2027.json
  {season, days:[date,...], espn:{espn_id:[[day index, ovr],...]}, fresh:{"team|name":[[day index, ovr],...]}}
A player's first entry is his preseason number (or the day he first appeared). Runs in rebuild-projections.yml after
build_ovr_display.py; a later run the same day replaces that day's value.

  python3 scripts/snapshot_ovr.py              # add today
  python3 scripts/snapshot_ovr.py --backfill   # rebuild from git history: the last file before opening day, then each day's last
"""
import datetime as dt, json, os, subprocess, sys
from zoneinfo import ZoneInfo

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SRC = "scripts/data/ovr_display_2027.json"; OUT = os.path.join(D, "ovr_history_2027.json")
OPENER = "2026-10-31"   # the day before the first games: the preseason baseline
ET = ZoneInfo("America/New_York")

def add(doc, day, cur):
    if not doc["days"] or doc["days"][-1] != day: doc["days"].append(day)
    i = len(doc["days"]) - 1
    for sec in ("espn", "fresh"):
        hist = doc[sec]
        for k, v in (cur.get(sec) or {}).items():
            s = hist.setdefault(k, [])
            if s and s[-1][0] == i:       # same day re-run: this value replaces it
                s.pop()
            if not s or s[-1][1] != v: s.append([i, v])

def save(doc):
    json.dump(doc, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {OUT}: {len(doc['days'])} days, {len(doc['espn'])} returners, {len(doc['fresh'])} newcomers, {os.path.getsize(OUT) // 1024} KB")

def main():
    doc = {"season": 2027, "days": [], "espn": {}, "fresh": {}}
    if "--backfill" in sys.argv:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        log = subprocess.run(["git", "log", "--reverse", "--format=%H %cI", "--", SRC], capture_output=True, text=True, cwd=root, check=True).stdout
        last = {}
        for ln in log.strip().split("\n"):
            h, when = ln.split()
            last[max(OPENER, dt.datetime.fromisoformat(when).astimezone(ET).date().isoformat())] = h   # later commits overwrite; pre-opener lands on the baseline
        for day in sorted(last):
            add(doc, day, json.loads(subprocess.run(["git", "show", f"{last[day]}:{SRC}"], capture_output=True, text=True, cwd=root, check=True).stdout))
        return save(doc)
    if os.path.exists(OUT): doc = json.load(open(OUT))
    add(doc, dt.datetime.now(ET).date().isoformat(), json.load(open(os.path.join(D, "ovr_display_2027.json"))))
    rebase(doc)
    save(doc)

# Re-base every player's PRESEASON value (day 0) on scripts/data/preseason/ovr_display_2027.json — today's model and
# data with no real games (build_ovr_display.py OVR_PRE=1). The stored opening-day number carried data holes (Aidan
# Mahaney and Daeshun Ruffin sat at the 55 walk-on floor though both started all last season) and every later model
# change, so "Since pre" read as a big riser for players whose games had nothing to do with it (owner, Nov 11 2026).
def rebase(doc):
    fp = os.path.join(D, "preseason", "ovr_display_2027.json")
    if not os.path.exists(fp): print("no preseason overall file — preseason values kept"); return
    pre = json.load(open(fp)); n = 0
    for sec in ("espn", "fresh"):
        for k, v in (pre.get(sec) or {}).items():
            s = doc[sec].get(k)
            if not s: continue
            if s[0][0] == 0:
                if s[0][1] != v: s[0][1] = v; n += 1
            else: s.insert(0, [0, v]); n += 1
            while len(s) > 1 and s[1][1] == s[0][1] and s[1][0] != len(doc["days"]) - 1: s.pop(1)   # a flat second point adds nothing
    print(f"preseason re-based for {n} players")

if __name__ == "__main__":
    main()
