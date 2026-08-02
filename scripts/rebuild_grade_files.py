#!/usr/bin/env python3
"""
Regenerate the id-keyed grade files AFTER a re-grade.

Run this every time you re-grade (grade_sync_current --write). The projection's
coupled grade anchors on players.tdc_grade, so if it isn't rebuilt the site keeps
showing the OLD grades even though the DB changed ("still the same rankings").

Reads the DB (anon key, read-only) and writes:
  - scripts/data/player_coupled_grades.json  (via build_grade_couple.js + jsc)
  - scripts/data/arch_bonus.json             (build_arch_bonus.py)
  - scripts/data/gp_shrink.json              (build_gp_regression.py)

Then bump the ?v of those three inside tdc-projgrade.js AND tdc-projgrade.js's own
?v across pages, and commit — this script prints the exact reminder at the end.

Usage:  cd scripts && python3 rebuild_grade_files.py
"""
import json, subprocess, sys, urllib.request, os

KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"   # read-only, fine to commit
URL = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"
ALLPLAYERS = "/tmp/tdc_allplayers.js"   # must match the load() path in build_grade_couple.js


def _get(path, rng):
    h = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Range": rng}
    return json.load(urllib.request.urlopen(urllib.request.Request(URL + path, headers=h), timeout=90))


def main():
    print("1/3  fetching current roster + team confs …")
    players = []
    for off in (0, 1000, 2000):
        chunk = _get("/players?select=*&name=neq.%E2%80%94&team=not.is.null&order=id.asc",
                     f"{off}-{off + 999}")
        players += chunk
        if len(chunk) < 1000:
            break
    teams = _get("/teams?select=name,conf", "0-999")
    tconf = {t["name"]: (t.get("conf") or "") for t in teams if t.get("name")}
    with open(ALLPLAYERS, "w") as f:
        f.write("var ALLPLAYERS=" + json.dumps(players) + ";\n")
        f.write("var TCONF=" + json.dumps(tconf) + ";\n")
    print(f"     {len(players)} players, {len(tconf)} teams -> {ALLPLAYERS}")

    print("2/3  coupled grades (jsc build_grade_couple.js) …")
    out = os.path.join(HERE, "data", "player_coupled_grades.json")
    with open(out, "w") as fo:
        r = subprocess.run([JSC, os.path.join(HERE, "build_grade_couple.js")], stdout=fo)
    if r.returncode != 0:
        print("     ERROR running jsc — is JavaScriptCore available?"); sys.exit(1)
    meta = json.load(open(out)).get("_meta", {})
    print(f"     coupled: {meta.get('movers')} movers ({meta.get('up')} up / {meta.get('down')} down)")

    print("3/3  arch_bonus + gp_shrink …")
    subprocess.run([sys.executable, os.path.join(HERE, "build_arch_bonus.py")], check=True)
    subprocess.run([sys.executable, os.path.join(HERE, "build_gp_regression.py")], check=True)

    print("\nDONE. Now, in the repo root:")
    print("  • bump the ?v of player_coupled_grades / arch_bonus / gp_shrink inside tdc-projgrade.js")
    print("  • bump tdc-projgrade.js?v across the .html pages")
    print("  • git add the 3 JSON + tdc-projgrade.js + *.html, commit & push")
    print("  • republish predictive_ratings (owner.html), then hard-refresh")


if __name__ == "__main__":
    main()
