"""Dynasty facilities seed: every D-I program's arena name and real home attendance (2025-26).

For each program, up to 4 non-neutral home games from 2025-26 (league games first — they draw the real crowds) are
looked up on ESPN's game summary for the venue and the attendance. -> data/dynasty-facilities.json
{team: {"venue": "Cameron Indoor Stadium", "att": avg, "max": best crowd, "n": games read}}. Resumable.

Usage: python3 scripts/build_dynasty_facilities.py
"""
import json, re, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "scripts" / "data"
OUT = ROOT / "data" / "dynasty-facilities.json"
KEY = re.search(r"sb_publishable_[A-Za-z0-9_-]+", (ROOT / "player.html").read_text()).group(0)
API = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"
SUM = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={}"


def get(url, headers):
    for k in range(3):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30))
        except Exception: time.sleep(2 * (k + 1))
    return None


def main():
    teams = list(json.load(open(D / "conf_members_2027.json"))["teams"])
    out = json.load(open(OUT)) if OUT.exists() else {}
    todo = [t for t in teams if t not in out]
    print(len(todo), "to fetch")
    for i, t in enumerate(todo):
        q = urllib.parse.quote(t)
        games = get(API + f"games?select=id,date,conf_game&season_year=eq.2026&neutral=eq.false&home=eq.{q}&order=id&limit=60",
                    {"apikey": KEY, "Authorization": "Bearer " + KEY}) or []
        games.sort(key=lambda g: (not g["conf_game"], g["date"]))
        pick = [g for g in games if g["conf_game"]][:3] + [g for g in games if not g["conf_game"]][:1]
        att, venue = [], None
        for g in pick:
            d = get(SUM.format(g["id"]), {"User-Agent": "Mozilla/5.0"}) or {}
            gi = d.get("gameInfo", {}) or {}
            if gi.get("attendance"): att.append(int(gi["attendance"]))
            venue = venue or (gi.get("venue") or {}).get("fullName")
            time.sleep(0.12)
        if att or venue:
            out[t] = {"venue": venue, "att": round(sum(att) / len(att)) if att else None, "max": max(att) if att else None, "n": len(att)}
        if (i + 1) % 25 == 0:
            print(i + 1, t, out.get(t)); json.dump(out, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
    json.dump(out, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
    print("have", len(out), "of", len(teams), "· missing attendance:", [t for t in teams if not (out.get(t) or {}).get("att")][:20])


if __name__ == "__main__":
    import urllib.parse
    main()
