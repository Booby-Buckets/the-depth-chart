#!/usr/bin/env python3
"""Sequentially re-scrape FULL shot data for the given seasons, one season at a time.

Why: the historical seasons in the `shots` table were only ever partially scraped
(games throttled to empty were still marked "done"). scrape_shots.py is now
throttle-safe (a failed fetch is NOT checkpointed, so it retries), but a season
that was already marked done needs its games cleared from the checkpoint first so
they actually re-fetch. This orchestrator does that clear-then-scrape for each
season in turn — never two at once (they share scripts/data/shots_done.json).

Resumable: a small state file records which seasons were already cleared, so a
restart resumes mid-season from the checkpoint instead of wiping good progress.

Usage: python3 scripts/backfill_seasons.py 2025 2024 2023 2022 [--delay 1.0]
"""
import sys, os, json, subprocess, urllib.request, time

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "data")
DONE = os.path.join(D, "shots_done.json")
STATE = os.path.join(D, "backfill_state.json")
KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'
SB = 'https://izlqhnxowdhtdofkwrho.supabase.co'
HDR = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY}


def game_ids(y):
    ids = []; frm = 0
    while True:
        q = 'games?select=id&home_score=not.is.null&order=id&season_year=eq.%d' % y
        req = urllib.request.Request(SB + '/rest/v1/' + q,
                                     headers={**HDR, 'Range-Unit': 'items', 'Range': '%d-%d' % (frm, frm + 999)})
        b = []
        for a in range(5):
            try:
                b = json.load(urllib.request.urlopen(req, timeout=60)); break
            except Exception:
                time.sleep(3 * (a + 1))
        ids += [g['id'] for g in b]
        if len(b) < 1000:
            break
        frm += 1000
    return ids


def load(p, default):
    try:
        return json.load(open(p))
    except Exception:
        return default


def main():
    args = sys.argv[1:]
    delay = "1.0"
    if "--delay" in args:
        delay = args[args.index("--delay") + 1]
    years = [int(a) for a in args if a.isdigit() and len(a) == 4]
    if not years:
        print("usage: backfill_seasons.py 2025 2024 2023 2022 [--delay 1.0]"); return

    cleared = set(load(STATE, {}).get("cleared", []))
    print("backfill plan: %s  (delay %ss)" % (years, delay), flush=True)

    for y in years:
        if y not in cleared:
            done = set(load(DONE, []))
            g = set(game_ids(y))
            n = len(done & g); done -= g
            json.dump(list(done), open(DONE, "w"))
            cleared.add(y)
            json.dump({"cleared": sorted(cleared)}, open(STATE, "w"))
            print("[%d] cleared %d of %d games from checkpoint" % (y, n, len(g)), flush=True)
        else:
            print("[%d] already cleared on an earlier run; resuming from checkpoint" % y, flush=True)

        print("[%d] scraping (this season)..." % y, flush=True)
        r = subprocess.run([sys.executable, "-u", os.path.join(HERE, "scrape_shots.py"),
                            "--season", str(y), "--delay", delay])
        print("[%d] scrape exited with code %d" % (y, r.returncode), flush=True)

    print("ALL SEASONS DONE: %s" % years, flush=True)


if __name__ == "__main__":
    main()
