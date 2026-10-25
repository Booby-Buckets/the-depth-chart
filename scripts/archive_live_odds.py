#!/usr/bin/env python3
"""
archive_live_odds.py — Betting Hub, Phase C: LIVE in-season odds archive.

Pulls the current NCAAB odds board (upcoming games, main markets) from the
the-odds-api v4 /odds endpoint — the CHEAP one: 1 credit per market per region
per call, not the 10× historical rate — takes a consensus (median-across-books)
line per game, and does two things:

  1. Overwrites  scripts/data/odds_live.json      — today's/upcoming board, the
     live "Best Bets" feed the site reads (model line vs the book's number).
  2. Appends to  scripts/data/odds_archive.jsonl  — one line per (game, snapshot),
     our own growing forward archive of opening→closing movement + closing lines.
     Nobody sells 5yr of this cheaply, so we OWN it by capturing it daily.

Run twice a day (a morning snapshot + a near-tip evening snapshot) so the archive
captures both the open and the close. Designed to be run from a GitHub Action with
the ODDS_API_KEY repo secret (see .github/workflows/archive-odds.yml). Off-season
the board comes back empty — the script writes an empty live file, appends nothing,
and exits 0, so it is safe to leave scheduled year-round.

Reuses the normalizer / consensus / fetch helpers from build_odds_history.py so the
team-name matching is identical to the historical backfill.

Usage:
  export ODDS_API_KEY=...           # never commit the key
  python3 scripts/archive_live_odds.py
  python3 scripts/archive_live_odds.py --markets spreads,totals,h2h --regions us
  python3 scripts/archive_live_odds.py --dry-run     # print the board, write nothing
  python3 scripts/archive_live_odds.py --regions us,us2 --events --event-budget 1500
        # + player props, team totals, first-half and alternate lines for games tipping in the next 30 h,
        #   nearest first, stopping before the run spends more than --event-budget credits
"""
import os, sys, json, urllib.parse
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_odds_history import api_get, consensus_line, norm   # shared helpers

DATA = os.path.join(HERE, "data")
LIVE = os.path.join(DATA, "odds_live.json")
FUTURES = os.path.join(DATA, "odds_futures.json")
ARCHIVE = os.path.join(DATA, "odds_archive.jsonl")

API_BASE = "https://api.the-odds-api.com/v4"
SPORT = "basketball_ncaab"
# outright futures (the Betting Lab's Futures tab). 1 credit per market per region per call.
FUTURE_SPORTS = {"title": "basketball_ncaab_championship_winner"}


def fetch_board(key, markets, regions):
    url = "%s/sports/%s/odds?apiKey=%s&regions=%s&markets=%s&oddsFormat=american" % (
        API_BASE, SPORT, urllib.parse.quote(key), regions, markets)
    body, rem, used = api_get(url)
    return (body or []), rem, used


def board_to_games(events, snap_ts):
    games = []
    for ev in events:
        line = consensus_line(ev)
        if not line.get("home") or not line.get("away"):
            continue
        games.append({
            "id": ev.get("id"),
            "commence": ev.get("commence_time"),
            "home": line["home"], "away": line["away"],
            "home_norm": norm(line["home"]), "away_norm": norm(line["away"]),
            "spread": line["spread"],       # home-relative points (negative = home favored)
            "total": line["total"],
            "ml_home": line["ml_home"], "ml_away": line["ml_away"],
            "books": book_lines(ev),        # every book's own number + price (line shopping, real EV)
            "snapshot": snap_ts,
        })
    return games


def book_lines(ev):
    """{book_key: {t: title, sp: [home point, home price, away price], to: [point, over price, under price],
    ml: [home price, away price], u: last_update}} — what each sportsbook is actually offering."""
    home = ev.get("home_team")
    out = {}
    for bk in ev.get("bookmakers", []):
        b = {"t": bk.get("title") or bk.get("key"), "u": bk.get("last_update")}
        for mk in bk.get("markets", []):
            key, oc = mk.get("key"), mk.get("outcomes", [])
            if key == "spreads":
                h = next((o for o in oc if o.get("name") == home), None); a = next((o for o in oc if o.get("name") != home), None)
                if h and a and h.get("point") is not None:
                    b["sp"] = [h["point"], h.get("price"), a.get("price")]
            elif key == "totals":
                ov = next((o for o in oc if o.get("name") == "Over"), None); un = next((o for o in oc if o.get("name") == "Under"), None)
                if ov and un and ov.get("point") is not None:
                    b["to"] = [ov["point"], ov.get("price"), un.get("price")]
            elif key == "h2h":
                h = next((o for o in oc if o.get("name") == home), None); a = next((o for o in oc if o.get("name") != home), None)
                if h and a:
                    b["ml"] = [h.get("price"), a.get("price")]
        if len(b) > 2:
            out[bk.get("key")] = b
    return out


# ── event-level markets: player props, team totals, alternate + first-half lines ─────────────
# Pulled one event at a time (/events/{id}/odds); cost = markets returned x regions, so a credit budget
# caps each run and the nearest tips go first.
PROP_MARKETS = {"player_points": "pts", "player_rebounds": "reb", "player_assists": "ast", "player_threes": "tpm",
                "player_points_rebounds_assists": "pra"}
GAME_MARKETS = ["team_totals", "spreads_h1", "totals_h1", "alternate_spreads", "alternate_totals"]


def fetch_event(key, eid, markets, regions):
    url = "%s/sports/%s/events/%s/odds?apiKey=%s&regions=%s&markets=%s&oddsFormat=american" % (
        API_BASE, SPORT, eid, urllib.parse.quote(key), regions, ",".join(markets))
    return api_get(url)


def event_markets(ev):
    """Compact per-book event markets.
    props: [{p: player, m: pts|reb|ast|tpm|pra, b: {book: [line, over price, under price]}}]
    tt:    {book: {home: [line, over, under], away: [...]}}          team totals
    h1:    {book: {sp: [home point, home price, away price], to: [point, over, under]}}
    alt:   {book: {sp: [[home point, home price, away price]...], to: [[point, over, under]...]}}"""
    home = ev.get("home_team")
    props, tt, h1, alt = {}, {}, {}, {}
    for bk in ev.get("bookmakers", []):
        bkey = bk.get("key")
        for mk in bk.get("markets", []):
            key, oc = mk.get("key"), mk.get("outcomes", [])
            if key in PROP_MARKETS:
                lines = {}
                for o in oc:
                    pl, pt = o.get("description"), o.get("point")
                    if not pl or pt is None:
                        continue
                    d = lines.setdefault((pl, pt), [pt, None, None])
                    d[1 if o.get("name") == "Over" else 2] = o.get("price")
                # one main line per player per book: the one closest to even money
                best = {}
                for (pl, pt), v in lines.items():
                    if v[1] is None or v[2] is None:
                        continue
                    juice = abs(abs(v[1]) - abs(v[2]))
                    if pl not in best or juice < best[pl][1]:
                        best[pl] = (v, juice)
                for pl, (v, _) in best.items():
                    props.setdefault((pl, PROP_MARKETS[key]), {})[bkey] = v
            elif key == "team_totals":
                d = tt.setdefault(bkey, {})
                for o in oc:
                    side = "home" if o.get("description") == home else "away"
                    v = d.setdefault(side, [o.get("point"), None, None])
                    v[1 if o.get("name") == "Over" else 2] = o.get("price")
            elif key in ("spreads_h1", "totals_h1"):
                d = h1.setdefault(bkey, {})
                if key == "spreads_h1":
                    h = next((o for o in oc if o.get("name") == home), None); a = next((o for o in oc if o.get("name") != home), None)
                    if h and a: d["sp"] = [h.get("point"), h.get("price"), a.get("price")]
                else:
                    ov = next((o for o in oc if o.get("name") == "Over"), None); un = next((o for o in oc if o.get("name") == "Under"), None)
                    if ov and un: d["to"] = [ov.get("point"), ov.get("price"), un.get("price")]
            elif key in ("alternate_spreads", "alternate_totals"):
                d = alt.setdefault(bkey, {})
                if key == "alternate_spreads":
                    pts = {}
                    for o in oc:
                        hp = o.get("point") if o.get("name") == home else (-o["point"] if o.get("point") is not None else None)
                        if hp is None: continue
                        v = pts.setdefault(hp, [hp, None, None]); v[1 if o.get("name") == home else 2] = o.get("price")
                    d["sp"] = sorted([v for v in pts.values() if v[1] is not None and v[2] is not None])
                else:
                    pts = {}
                    for o in oc:
                        if o.get("point") is None: continue
                        v = pts.setdefault(o["point"], [o["point"], None, None]); v[1 if o.get("name") == "Over" else 2] = o.get("price")
                    d["to"] = sorted([v for v in pts.values() if v[1] is not None and v[2] is not None])
    return {"props": [{"p": pl, "m": m, "b": b} for (pl, m), b in props.items()], "tt": tt, "h1": h1, "alt": alt}


def fetch_futures(key, regions):
    """Consensus outright prices per market: {market: {"teams": [{name, norm, price, books}]}}.
    price = median American odds across books. A market the API doesn't list right now (404 /
    422 off-season) is skipped, never fatal."""
    out, used_total, rem = {}, 0, None
    for mk, sport in FUTURE_SPORTS.items():
        url = "%s/sports/%s/odds?apiKey=%s&regions=%s&markets=outrights&oddsFormat=american" % (
            API_BASE, sport, urllib.parse.quote(key), regions)
        try:
            body, rem, used = api_get(url)
        except Exception as e:
            print("Futures %s: not available (%s)" % (mk, e), flush=True)
            continue
        used_total += int(used or 0)
        prices = {}
        for ev in body or []:
            for bk in ev.get("bookmakers", []):
                for m in bk.get("markets", []):
                    if m.get("key") != "outrights":
                        continue
                    for o in m.get("outcomes", []):
                        if o.get("name") and o.get("price") is not None:
                            prices.setdefault(o["name"], []).append(float(o["price"]))
        teams = []
        for name, ps in prices.items():
            ps.sort()
            mid = ps[len(ps) // 2] if len(ps) % 2 else (ps[len(ps) // 2 - 1] + ps[len(ps) // 2]) / 2
            teams.append({"name": name, "norm": norm(name), "price": int(round(mid)), "books": len(ps)})
        implied = lambda o: 100.0 / (o + 100) if o > 0 else -o / (-o + 100.0)
        teams.sort(key=lambda t: -implied(t["price"]))   # favorites first
        if teams:
            out[mk] = {"teams": teams}
    return out, used_total, rem


def write_if_changed(path, payload, stamp_key="generated"):
    """Write JSON only when the content (ignoring the timestamp) changed, so an idle board doesn't
    commit + redeploy the site twice a day."""
    try:
        with open(path) as f:
            old = json.load(f)
    except Exception:
        old = None
    strip = lambda d: {k: v for k, v in (d or {}).items() if k != stamp_key}
    if old is not None and strip(old) == strip(payload):
        print("%s unchanged — not rewritten." % os.path.relpath(path, HERE), flush=True)
        return False
    with open(path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    return True


def main():
    args = sys.argv[1:]
    markets = args[args.index("--markets") + 1] if "--markets" in args else "spreads,totals,h2h"
    regions = args[args.index("--regions") + 1] if "--regions" in args else "us"
    dry = "--dry-run" in args
    key = os.environ.get("ODDS_API_KEY", "")

    if not key and not dry:
        print("ERROR: ODDS_API_KEY not set. `export ODDS_API_KEY=...` then re-run "
              "(or use --dry-run to test plumbing without a key).", flush=True)
        return 1

    snap_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if dry and not key:
        print("[dry-run] no key set — nothing fetched. With a key, --dry-run fetches "
              "the board and prints it but writes no files.", flush=True)
        return 0

    try:
        events, rem, used = fetch_board(key, markets, regions)
    except Exception as e:
        print("Fetch failed: %s" % e, flush=True)
        return 1

    games = board_to_games(events, snap_ts)
    print("Board: %d games · %d book prices · credits used this call: %s · remaining: %s"
          % (len(games), sum(len(g["books"]) for g in games), used, rem), flush=True)

    # event markets (props etc.): nearest tips first, until the credit budget for this run is spent
    if "--events" in args and games and not dry:
        budget = int(args[args.index("--event-budget") + 1]) if "--event-budget" in args else 1500
        horizon = float(args[args.index("--event-hours") + 1]) if "--event-hours" in args else 30
        ev_regions = args[args.index("--event-regions") + 1] if "--event-regions" in args else regions
        mk = list(PROP_MARKETS) + ([] if "--props-only" in args else GAME_MARKETS)
        now = datetime.now(timezone.utc)
        soon = []
        for g in games:
            try:
                tip = datetime.fromisoformat(g["commence"].replace("Z", "+00:00"))
            except Exception:
                continue
            hrs = (tip - now).total_seconds() / 3600
            if 0 < hrs <= horizon:
                soon.append((hrs, g))
        soon.sort(key=lambda x: x[0])
        spent, pulled = 0, 0
        for hrs, g in soon:
            worst = len(mk) * len(ev_regions.split(","))
            if spent + worst > budget:
                print("Event budget reached (%d credits) — %d of %d games pulled." % (spent, pulled, len(soon)), flush=True)
                break
            try:
                body, rem, used = fetch_event(key, g["id"], mk, ev_regions)
            except Exception as e:
                print("  event %s: %s" % (g["id"], e), flush=True)
                continue
            spent += int(used or 0); pulled += 1
            g.update(event_markets(body or {}))
        print("Events: %d games · %d prop lines · %d credits · remaining %s"
              % (pulled, sum(len(g.get("props", [])) for g in games), spent, rem), flush=True)

    if dry:
        for g in games[:20]:
            print("  %s @ %s  spread(home) %s  total %s  ml %s/%s"
                  % (g["away"], g["home"], g["spread"], g["total"], g["ml_home"], g["ml_away"]), flush=True)
        print("[dry-run] wrote nothing.", flush=True)
        return 0

    os.makedirs(DATA, exist_ok=True)
    # 1) live board (overwrite) — the site's Best Bets feed
    # keep the last pull's event markets for games this run didn't refresh (props are pulled less often)
    try:
        prev = {g["id"]: g for g in json.load(open(LIVE)).get("games", [])}
    except Exception:
        prev = {}
    for g in games:
        p = prev.get(g["id"])
        if p and "props" not in g:
            for k in ("props", "tt", "h1", "alt", "ev_snapshot"):
                if k in p: g[k] = p[k]
        elif "props" in g:
            g["ev_snapshot"] = snap_ts
    if write_if_changed(LIVE, {"generated": snap_ts, "sport": "NCAAB", "markets": markets, "regions": regions,
                               "count": len(games), "games": games}):
        print("Wrote %s (%d games)." % (os.path.relpath(LIVE, HERE), len(games)), flush=True)

    # 1b) futures (title odds …) — the Lab's Futures tab compares our simulated odds to these
    if "--no-futures" not in args:
        fut, fused, frem = fetch_futures(key, regions)
        print("Futures: %s · credits used: %s · remaining: %s"
              % (", ".join("%s %d teams" % (k, len(v["teams"])) for k, v in fut.items()) or "none listed", fused, frem), flush=True)
        if fut and write_if_changed(FUTURES, {"generated": snap_ts, "sport": "NCAAB", "markets": fut}):
            print("Wrote %s." % os.path.relpath(FUTURES, HERE), flush=True)

    # 2) forward archive (append) — only when there are games to record
    if games:
        with open(ARCHIVE, "a") as f:
            for g in games:
                slim = {k: v for k, v in g.items() if k not in ("props", "tt", "h1", "alt")}
                f.write(json.dumps(slim, separators=(",", ":")) + "\n")
        print("Appended %d snapshots to %s." % (len(games), os.path.relpath(ARCHIVE, HERE)), flush=True)
        fresh = [g for g in games if g.get("ev_snapshot") == snap_ts and g.get("props")]
        if fresh:
            with open(os.path.join(DATA, "odds_props_archive.jsonl"), "a") as f:
                for g in fresh:
                    f.write(json.dumps({"id": g["id"], "snapshot": snap_ts, "commence": g["commence"], "home": g["home"], "away": g["away"],
                                        "props": g["props"], "tt": g.get("tt"), "h1": g.get("h1")}, separators=(",", ":")) + "\n")
            print("Appended props for %d games to odds_props_archive.jsonl." % len(fresh), flush=True)
    else:
        print("Empty board (off-season / no games today) — archive untouched.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
