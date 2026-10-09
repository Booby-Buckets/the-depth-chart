#!/usr/bin/env python3
"""Reality Meter for the 2026-27 preseason scrimmages: how much did each team's side of a scrimmage
look like a REAL game? The answer sets how much its box score is allowed to count.

We have no tracking or play-by-play for most scrimmages, only the box score, so the meter reads the
box for the tell-tale signs of a practice-style game (0-100 per side, then the game = the mean):

  Format         10%  team minutes ~200 (a full 40-minute game). Running clocks / 4x10s / extra
                      periods move this off 200 (school box scores almost always total 200, so it rarely moves).
  Rotation       30%  how concentrated the minutes were: a real game's top 5 play ~70% of them and
                      ~9-10 players get 5+ min. Even minutes / 13-man rotations = experimenting.
  Availability   25%  did OUR projected rotation play (share of its projected minutes on the floor)
                      and did the projected starters start?
  Competitiveness 20% garbage time: a 30-point game is mostly bench run-outs.
  Plausibility   15%  pace (5%) inside the normal 60-80 possessions, and a result within reason of our line.

A score-only game (no box) gets competitiveness + plausibility only and is capped at 40.

Every player line then gets a WEIGHT in real-game equivalents:
    w = 1.0 (a game-like scrimmage = one real game) x reality/100 x min(1, his min / his projected mpg)
build_stat_overall_projected.py blends a player's scrimmage per-minute rates into his projected line
Bayesian-style with that weight (capped), so a game-like scrimmage moves a projection a little and a
glorified practice barely at all. Records, ratings form, box_scores and player_history stay untouched.

    python3 scripts/scrim_reality.py          # scores every scrimmage with a result, writes it back
"""
import json, math, re, urllib.request, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "scripts" / "data"
RES = DATA / "scrimmage_results_2027.json"
GAMES = DATA / "scrimmages_2027.json"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1"
KEY = re.search(r"sb_publishable_[A-Za-z0-9_-]+", (ROOT / "player.html").read_text()).group(0)
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
SCRIM_GAME = 1.0          # a perfectly game-like scrimmage counts as one real game
HCA, SIGMA = 3.0, 11.0


def get(path):
    out, off = [], 0
    while True:
        rows = json.load(urllib.request.urlopen(urllib.request.Request(f"{SB}/{path}&limit=1000&offset={off}", headers=H), timeout=120))
        out += rows
        if len(rows) < 1000: return out
        off += 1000


clip = lambda v, a=0.0, b=1.0: max(a, min(b, v))
nk = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", (s or "").lower()))


def roster_name(name, roster):
    """the roster spelling of a box-score name: exact, else same last name + first initial, else a close
    spelling (difflib >= 0.85) — unique matches only"""
    import difflib
    k = nk(name); byk = {nk(r): r for r in roster}
    if k in byk: return byk[k]
    w = (name or "").replace(".", "").split()
    if len(w) >= 2:
        c = [r for r in roster if r.replace(".", "").split() and nk(r.replace(".", "").split()[-1]) == nk(w[-1]) and r[:1].lower() == w[0][:1].lower()]
        if len(c) == 1: return c[0]
    c = [r for r in roster if difflib.SequenceMatcher(None, nk(r), k).ratio() >= 0.85]
    return c[0] if len(c) == 1 else None


def label(s):
    return "Game-like" if s >= 75 else "Mostly real" if s >= 55 else "Experimental" if s >= 35 else "Practice-like"


def main():
    R = json.load(open(RES)); G = {g["id"]: g for g in json.load(open(GAMES))["games"]}
    pr = json.load(urllib.request.urlopen(urllib.request.Request(f"{SB}/predictive_ratings?season=eq.2027&select=data&limit=1", headers=H), timeout=60))
    T = {t["full"]: t for t in pr[0]["data"]["teams"]} if pr else {}
    SOP = json.load(open(DATA / "stat_overall_projected.json"))["players"]
    FRESH = json.load(open(DATA / "fresh_fit.json"))

    def proj_roster(full):
        """[(name, projected mpg)] for this team's projected rotation"""
        t = T.get(full); short = t and t["team"]
        if not short: return []
        out = []
        for p in get(f"players?select=name,espn_id,depth_order&team=eq.{urllib.parse.quote(short)}&order=depth_order.asc"):
            s = SOP.get(str(p["espn_id"])) if p.get("espn_id") else None
            f = (FRESH.get(short) or {}).get(p["name"])
            m = (s or {}).get("mpg") or (f or {}).get("mpg") or 0
            out.append((p["name"], float(m)))
        return out

    def side(box, full, margin):
        if (box or {}).get("partial"): return None   # a recap with a few lines + totals: score-only for the meter
        ps = [p for p in (box or {}).get("players") or [] if (p.get("min") or 0) > 0]
        if not ps: return None
        tm = sum(p["min"] for p in ps)
        fmt = clip(1 - abs(tm / 200 - 1) / 0.25)
        mins = sorted((p["min"] for p in ps), reverse=True)
        top5 = sum(mins[:5]) / tm if tm else 0
        n5 = sum(1 for m in mins if m >= 5)
        rot = math.exp(-((top5 - 0.70) / 0.10) ** 2 / 2) * clip(1 - max(0, n5 - 11) * 0.12)
        pj = proj_roster(full); rot7 = sorted(pj, key=lambda x: -x[1])[:7]; st5 = {nk(n) for n, _ in rot7[:5]}
        played = {nk(p["name"]) for p in ps}
        last = {nk(p["name"].split()[-1]) for p in ps}
        here = lambda n: nk(n) in played or nk(n.split()[-1]) in last
        avail = None
        if rot7 and sum(m for _, m in rot7) > 0:
            present = sum(m for n, m in rot7 if here(n)) / sum(m for _, m in rot7)
            gs = [nk(p["name"]) for p in ps if p.get("gs")]
            overlap = sum(1 for n in gs if n in st5) / 5 if gs else present
            avail = 0.7 * present + 0.3 * overlap
        poss = sum((p.get("fga") or 0) - (p.get("oreb") or 0) + (p.get("tov") or 0) + 0.44 * (p.get("fta") or 0) for p in ps)
        pace = poss * 200 / tm if tm else None
        pace_s = 1.0 if pace is None or 60 <= pace <= 80 else clip(1 - (min(abs(pace - 60), abs(pace - 80))) / 15)
        comp = clip(1 - max(0, abs(margin) - 12) / 28)
        parts = {"format": fmt, "rotation": rot, "availability": avail if avail is not None else 0.6, "competitive": comp, "pace": pace_s}
        return parts, {"min": tm, "top5": round(top5, 3), "n5": n5, "pace": round(pace, 1) if pace else None,
                       "missing": [n for n, m in rot7 if m >= 10 and not here(n)],
                       # everyone on our roster who sat: a DNP in a game-like scrimmage is (light) role evidence
                       "dnp": [n for n, m in pj if not here(n)] if len(ps) >= 8 else []}

    for gid, r in R["results"].items():
        g = G.get(gid)
        if not g or r.get("hs") is None: continue
        margin = r["hs"] - r["as"]
        th, ta = T.get(g["home"]), T.get(g["away"])
        # the line WITHOUT any scrimmage adjustment already in the ratings (else it would feed on itself)
        base = lambda t: t["rating"] - (t.get("scrimAdj") or 0)
        pred = (base(th) - base(ta) + (0 if g.get("neutral") else HCA)) if th and ta else None
        plaus = math.exp(-(((margin - pred) / SIGMA) ** 2) / 2) if pred is not None else 0.6
        box = r.get("box") or {}
        out = {"pred": round(pred, 1) if pred is not None else None}
        scores = []
        for s, full, m in (("home", g["home"], margin), ("away", g["away"], -margin)):
            got = side(box.get(s), full, m)
            if not got:
                comp = clip(1 - max(0, abs(m) - 12) / 28)
                sc = round(min(40, 100 * (0.5 * comp + 0.5 * plaus)))
                out[s] = {"score": sc, "label": label(sc), "boxless": True}
                scores.append(sc); continue
            parts, info = got
            sc = 100 * (0.10 * parts["format"] + 0.30 * parts["rotation"] + 0.25 * parts["availability"]
                        + 0.20 * parts["competitive"] + 0.05 * parts["pace"] + 0.10 * plaus)
            sc = round(sc)
            out[s] = {"score": sc, "label": label(sc), "parts": {k: round(v * 100) for k, v in dict(parts, plausible=plaus).items()}, **info}
            scores.append(sc)
            # per-player weight in real-game equivalents
            ros = proj_roster(full); pj = {nk(n): m for n, m in ros}
            for p in box[s]["players"]:
                # rn = his name as OUR roster spells it (box scores misspell: "Ojianwuna" vs "Ojanwuna"), so the
                # projection build and the trends builder key him correctly
                rn = roster_name(p["name"], [n for n, _ in ros])
                if rn: p["rn"] = rn
                else: p.pop("rn", None)
                pm = pj.get(nk(rn or p["name"])) or 20.0
                p["w"] = round(SCRIM_GAME * sc / 100 * clip((p.get("min") or 0) / max(pm, 10)), 3)
        out["score"] = round(sum(scores) / len(scores)) if scores else None
        out["label"] = label(out["score"]) if out["score"] is not None else None
        r["reality"] = out
        print(f"{gid}: {out['score']} {out['label']}  home {out['home']['score']} / away {out['away']['score']}  pred {out['pred']} actual {margin:+d}")
    json.dump(R, open(RES, "w"), indent=1)


if __name__ == "__main__":
    main()
