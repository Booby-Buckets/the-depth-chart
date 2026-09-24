#!/usr/bin/env python3
"""Rebuild the missing 2025-26 season lines from our OWN box scores.

player_history is populated from ESPN team-stats pages for the teams we cover, so a
player who spent last season somewhere we do not cover — which is most of the incoming
transfer class — has no row. build_stat_overall_projected.py gates on exactly that row
(`espn_id in BOX_IDS`), so those players got no published projection at all and every
surface fell back to a guess.

box_scores is ours and game-level, and it carries the team he actually played for, which
is also the signal the projection needs to apply the transfer level discount.

    python3 scripts/fill_box_from_boxscores.py            # report coverage
    python3 scripts/fill_box_from_boxscores.py --write    # write scripts/data/season_line_fill_2026.json

Sources, best first: CBBD per-game rows (scripts/data/box_fill_YYYY.json, written by
build_box_cbbd.py diff — full D-I coverage), then our own box_scores, then the roster sheet.
Re-run this after a CBBD pull and the better data supersedes the sheet automatically.

The JSON is read by build_stat_overall_projected.py; nothing here writes to Supabase.
"""
import json, os, sys, urllib.request, urllib.parse, collections

KEY = os.environ.get("SUPABASE_ANON_KEY", "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye")
BASE = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"
CUR  = int(os.environ.get("CUR_SEASON", "2026"))
DATA = os.path.join(os.path.dirname(__file__), "data")
OUT  = os.path.join(DATA, "season_line_fill_%d.json" % CUR)
# build_box_cbbd.py `diff` writes box_fill_YYYY.json (a flat list of per-GAME rows) into the same
# directory — do not reuse that name, and do read it when it is there: CBBD covers all of D-I,
# which is exactly what our own box_scores does not.
CBBD = os.path.join(DATA, "box_fill_%d.json" % CUR)

def get(path, page=1000):
    """Paged GET. Every paginated pull needs a stable ORDER BY or rows silently drop."""
    rows, off = [], 0
    while True:
        sep = "&" if "?" in path else "?"
        url = BASE + path + f"{sep}limit={page}&offset={off}"
        req = urllib.request.Request(url, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
        with urllib.request.urlopen(req) as r:
            batch = json.load(r)
        rows += batch
        if len(batch) < page: return rows
        off += page

def chunks(xs, n):
    for i in range(0, len(xs), n): yield xs[i:i+n]

def num(v):
    try:
        f = float(v); return f
    except (TypeError, ValueError):
        return 0.0

def main():
    print("Pulling roster, existing history, box scores…", file=sys.stderr)
    SHEET = ("espn_id,name,team,is_addition,gp,mpg,ppg,apg,oreb,dreb,stl,blk,tovs,"
             "fgm,fga,tpm,tpa,ftm,fta,fg_pct,tp_pct,ft_pct")
    pl   = get(f"players?select={SHEET}&order=id.asc")
    hist = get(f"player_history?select=espn_id&season_year=eq.{CUR}&order=id.asc")
    have = {str(r["espn_id"]) for r in hist if r.get("espn_id") is not None}

    # who is on a 2026-27 roster, has an espn id, and has no season line
    want = []
    for p in pl:
        e = p.get("espn_id")
        if e is None: continue
        if str(e) in have: continue
        want.append(int(e))
    want = sorted(set(want))
    print(f"roster {len(pl)} · history rows {len(have)} · missing a season line: {len(want)}", file=sys.stderr)

    # the school he actually played for last season. box_scores carries it directly; for the
    # rest, bbref_seasons has a 2025-26 bio row (no stats, but the school) for many. It only
    # matters for players the owner has flagged as newcomers — a returner with no last team is
    # just a returner, and guessing one would hand him a transfer discount he has not earned.
    bb = {}
    for c in chunks(want, 80):
        q = ",".join(str(x) for x in c)
        for r in get(f"bbref_seasons?select=espn_id,school&season_year=eq.{CUR}&espn_id=in.({q})&order=bbref_id.asc"):
            if r.get("espn_id") is not None and r.get("school"): bb[str(int(r["espn_id"]))] = r["school"]

    rows, src_of = [], {}
    if os.path.exists(CBBD):
        cb = json.load(open(CBBD))
        wantset = set(want)
        cb = [r for r in cb if r.get("espn_id") in wantset]
        rows += cb
        for r in cb: src_of[str(int(r["espn_id"]))] = "cbbd"
        print(f"CBBD per-game rows for those players: {len(cb)}", file=sys.stderr)
    else:
        print("no CBBD pull on disk (scripts/data/box_fill_%d.json) — run build_box_cbbd.py to cover the low-majors" % CUR,
              file=sys.stderr)

    ours = []
    for c in chunks(want, 80):
        q = ",".join(str(x) for x in c)
        ours += get(f"box_scores?select=espn_id,player,team,min,pts,reb,oreb,dreb,ast,stl,blk,tov,fgm,fga,tpm,tpa,ftm,fta"
                    f"&season_year=eq.{CUR}&espn_id=in.({q})&order=game_id.asc")
    # CBBD wins where both have him — it is the complete source, and mixing two game sets for one
    # player would double-count the games they share
    have_cbbd = set(src_of)
    ours = [r for r in ours if str(int(r["espn_id"])) not in have_cbbd]
    for r in ours: src_of.setdefault(str(int(r["espn_id"])), "box_scores")
    rows += ours
    print(f"our box_scores rows added: {len(ours)}", file=sys.stderr)

    by = collections.defaultdict(list)
    for r in rows:
        if r.get("espn_id") is None: continue
        by[str(int(r["espn_id"]))].append(r)

    out = {}
    for e, gs in by.items():
        played = [g for g in gs if num(g.get("min")) > 0]
        if len(played) < 3: continue          # same 3-game floor the projection build uses
        n = float(len(played))
        S = lambda k: sum(num(g.get(k)) for g in played)
        pg = lambda k: round(S(k) / n, 1)
        fgm, fga = S("fgm"), S("fga")
        tpm, tpa = S("tpm"), S("tpa")
        ftm, fta = S("ftm"), S("fta")
        # the team he actually played for — this is what tells the projection he transferred
        team = collections.Counter(g.get("team") or "" for g in played).most_common(1)[0][0]
        out[e] = {
            "espn_id": int(e), "name": played[0].get("player"), "team": team,
            "gp": int(n), "mpg": pg("min"), "ppg": pg("pts"),
            "oreb": pg("oreb"), "dreb": pg("dreb"), "apg": pg("ast"),
            "stl": pg("stl"), "blk": pg("blk"), "tovs": pg("tov"),
            "fgm": pg("fgm"), "fga": pg("fga"), "tpm": pg("tpm"), "tpa": pg("tpa"),
            "ftm": pg("ftm"), "fta": pg("fta"),
            "fg_pct": round(fgm / fga * 100, 1) if fga else None,
            "tp_pct": round(tpm / tpa * 100, 1) if tpa else None,
            "ft_pct": round(ftm / fta * 100, 1) if fta else None,
            "min":    round(S("min"), 1),
            "src": src_of.get(e, "box_scores"),
        }

    # ── second source: the roster sheet ────────────────────────────────────────────
    # box_scores is built from the same covered-team scrape as player_history, so it does not
    # reach the low- and mid-majors most of the transfer class came from. The sheet line is the
    # owner's own, and it is already what every page shows for these players — routing it
    # through the projection model is strictly better than leaving them on a crude fallback.
    sheet = {str(int(p["espn_id"])): p for p in pl if p.get("espn_id") is not None}
    for e in map(str, want):
        if e in out: continue
        p = sheet.get(e)
        if not p: continue
        gp, mpg = num(p.get("gp")), num(p.get("mpg"))
        if gp < 3 or mpg < 3: continue                 # same floors the projection build uses
        if p.get("ppg") is None or p.get("fga") is None: continue
        r = {"espn_id": int(e), "name": p.get("name"), "team": bb.get(e), "gp": int(gp), "src": "roster_sheet"}
        for k in ("mpg","ppg","apg","oreb","dreb","stl","blk","tovs","fgm","fga","tpm","tpa",
                  "ftm","fta","fg_pct","tp_pct","ft_pct"):
            v = p.get(k); r[k] = None if v is None else num(v)
        r["min"] = round(mpg * gp, 1)
        out[e] = r

    # is_addition is the owner's own "new to this roster" flag, and the only trustworthy
    # transfer signal for a filled player — player_advanced has no row for him by definition.
    for e, r in out.items():
        p = sheet.get(e)
        r["is_addition"] = bool(p and p.get("is_addition"))
        r["last_team"] = r.get("team") if r["is_addition"] else None

    covered = set(out)
    still = [e for e in want if str(e) in by and str(e) not in covered]
    none_ = [e for e in want if str(e) not in by]
    ncb  = sum(1 for r in out.values() if r["src"] == "cbbd")
    nbox = sum(1 for r in out.values() if r["src"] == "box_scores")
    print(f"\nrebuilt from CBBD            : {ncb}", file=sys.stderr)
    print(f"rebuilt from our box scores  : {nbox}", file=sys.stderr)
    print(f"rebuilt from the roster sheet: {len(out)-ncb-nbox}", file=sys.stderr)
    print(f"total season lines recovered : {len(out)}", file=sys.stderr)
    print(f"still with nothing to project: {len(want)-len(out)}  (no 2025-26 line anywhere — true freshmen and 1-2 game cameos)", file=sys.stderr)
    print(f"  of those recovered, flagged as newcomers: {sum(1 for r in out.values() if r['is_addition'])}"
          f" · last school known for {sum(1 for r in out.values() if r['last_team'])}", file=sys.stderr)

    if "--write" in sys.argv:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        json.dump({"season": CUR, "n": len(out), "players": out}, open(OUT, "w"), indent=0)
        print(f"\nwrote {OUT}", file=sys.stderr)
    else:
        for e in sorted(out, key=lambda k: -(out[k].get("mpg") or 0))[:18]:
            r = out[e]
            t = r.get("last_team") or r.get("team") or ("newcomer, school unknown" if r["is_addition"] else "—")
            print(f"  {(r['name'] or '?')[:22]:23}{t[:26]:27} {r['gp']:>2}g {r['mpg']:>5} mpg {r['ppg']:>5} ppg  [{r['src']}]", file=sys.stderr)

main()
