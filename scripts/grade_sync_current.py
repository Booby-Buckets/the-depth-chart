#!/usr/bin/env python3
"""
Grade the current roster while keeping YOUR manual grades the backbone.

Per the chosen policy ("re-grade all, but hug mine tight"):
  * Players you manually graded  -> model grade CLIPPED to within BAND points
    of your grade, so your number is preserved (± a small consistency nudge).
  * No-stat freshmen             -> your manual grade exactly (no stats for the
    model to read).
  * Players you never graded      -> full model grade.

The model grade (with the CORRECT conference tier — the team where the stats
were earned) is read from each player's player_history 2026 row, matched by
name + closest stat line so transfers map to the right season.

  python3 grade_sync_current.py           # dry run
  python3 grade_sync_current.py --write
"""
import os, sys, time, re, unicodedata
import pandas as pd
import requests

def _defold(s):  # fold accents: "Dörries"->"dorries", "Amaël"->"amael" so the roster
    # spelling (usually ASCII) matches the accented history spelling
    return "".join(c for c in unicodedata.normalize("NFKD", str(s)) if not unicodedata.combining(c))

def _strip(n):  # normalize name: fold accents, drop periods in initials (B.J.->BJ), drop suffix, lowercase
    s = _defold(n).replace(".", "")
    return re.sub(r"\s+(jr|sr|ii|iii|iv|v)$", "", s.strip(), flags=re.I).strip().lower()

SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
DATA = __import__("pathlib").Path(__file__).parent / "data"
BAND = 2       # max points a graded player can move off their manual grade
DEADBAND = 3   # keep manual EXACTLY unless the model disagrees by more than this
PURE = "--pure" in sys.argv  # same-playing-field: grade current roster by the model, no hug


def num(s):
    return pd.to_numeric(s, errors="coerce")


def fetch_all(url):
    url += ("&" if "?" in url else "?") + "order=id"  # stable order — else paged rows shuffle/drop
    rows, pg, PG = [], 0, 1000
    while True:
        r = requests.get(url, headers={**H, "Range-Unit": "items",
                         "Range": f"{pg*PG}-{pg*PG+PG-1}"}, timeout=60)
        b = r.json()
        if not isinstance(b, list) or not b:
            break
        rows.extend(b)
        if len(b) < PG:
            break
        pg += 1
    return pd.DataFrame(rows)


def main(write=False):
    manual = pd.read_csv(DATA / "manual_grades_backup.csv")
    man_by_name = {}
    for _, m in manual.iterrows():
        man_by_name.setdefault(m["name"], []).append((m["team"], int(m.grade_num)))

    cur = fetch_all(f"{SB}/rest/v1/players?select=id,name,team,ppg,mpg,tdc_grade")
    # recent seasons so returnees (e.g. RJ Luis, who sat out 25-26) match their
    # most recent actual season by closest stat line, not just 25-26
    hist = fetch_all(f"{SB}/rest/v1/player_history?select=name,team,ppg,mpg,gp,"
                     f"tdc_grade&season_year=in.(2024,2025,2026)&tdc_grade=not.is.null")
    if cur.empty or hist.empty:
        sys.exit("No data returned from Supabase — SUPABASE_SERVICE_KEY is likely wrong "
                 "or a placeholder. Paste your real sb_secret_… key and re-run.")
    hist["ppg_n"] = num(hist.ppg); hist["mpg_n"] = num(hist.mpg)
    hist["_strip"] = hist.name.map(_strip)
    hist["_key"] = hist._strip.map(lambda s: (s[:1], s.split()[-1]) if s else ("", ""))
    by_name = {n: g for n, g in hist.groupby("name")}
    by_strip = {n: g for n, g in hist.groupby("_strip")}
    by_key = {n: g for n, g in hist.groupby("_key")}
    cur["ppg_n"] = num(cur.ppg); cur["mpg_n"] = num(cur.mpg)

    def manual_grade(name, team):
        c = man_by_name.get(name)
        if not c:
            return None
        for t, g in c:
            if t == team:
                return g
        return c[0][1]

    def _closest(cand, p):
        d = (cand.ppg_n - p.ppg_n).abs() + (cand.mpg_n - p.mpg_n).abs()
        if d.notna().sum() == 0:            # no comparable stat lines (all NA) →
            best = cand.iloc[0]             # fall back to the first candidate row
            return best, float("inf")       # inf dist so the fuzzy key-match (needs <5) is skipped
        i = d.idxmin()
        return cand.loc[i], float(d.loc[i])

    def model_grade(p):
        # 1) exact name, 2) suffix-stripped name, 3) last-name+initial w/ close stats
        for cand in (by_name.get(p["name"]), by_strip.get(_strip(p["name"]))):
            if cand is not None and len(cand):
                best, _ = _closest(cand, p)
                return int(best.tdc_grade)
        sp = _strip(p["name"]).split()
        if sp:
            cand = by_key.get((sp[0][:1], sp[-1]))
            if cand is not None and len(cand):
                best, dist = _closest(cand, p)
                if dist < 5:                    # only if stat line genuinely matches
                    return int(best.tdc_grade)
        return None

    # Recenter the model on the graded roster so the ±BAND hug is symmetric
    # (no uniform drift): the model under-rates hand-picked players because it
    # can't see scouting bumps, so align means before clipping.
    pairs = [(manual_grade(p["name"], p.team), model_grade(p))
             for _, p in cur.iterrows() if pd.notna(p.mpg_n)]
    pairs = [(a, b) for a, b in pairs if a is not None and b is not None]
    offset = (sum(a for a, b in pairs) - sum(b for a, b in pairs)) / max(1, len(pairs))
    print(f"model->manual recenter offset on graded roster: {offset:+.1f}")

    rows = []
    n_kept = n_hug = n_model = 0
    for _, p in cur.iterrows():
        man = manual_grade(p["name"], p.team)
        if pd.isna(p.mpg_n):                       # no-stat freshman
            if man is None:
                continue
            final, kind = man, "freshman-manual"; n_kept += 1
        else:
            mod = model_grade(p)
            if mod is None and man is None:
                continue
            if PURE and mod is not None:
                final = mod; kind = "model"; n_model += 1     # same-playing-field: pure model
            elif man is not None and mod is not None:
                diff = (mod + offset) - man                  # recentered disagreement
                adj = (1 if diff > 0 else -1) * max(0, abs(diff) - DEADBAND)
                adj = max(-BAND, min(BAND, adj))             # only outliers move, ≤BAND
                final = round(man + adj); kind = "hug"; n_hug += 1
            elif man is not None:
                final = man; kind = "graded-no-model"; n_kept += 1
            else:
                # No manual grade (e.g. incoming transfers): the model grade comes
                # straight off player_history, which runs ~+offset hotter than the
                # live roster scale. Apply the same recenter used in the hug branch
                # so transfers land on the SAME scale as everyone else (else a #1
                # option like Mark Mitchell imports at 97 vs a live board that tops
                # out ~94). Clamp to the valid 30-99 band.
                final = round(max(30, min(99, mod + offset))); kind = "ungraded-model"; n_model += 1
        cur_g = None if pd.isna(p.tdc_grade) else str(p.tdc_grade)
        rows.append({"id": int(p.id), "name": p["name"], "team": p.team,
                     "manual": man, "final": int(final), "cur": cur_g, "kind": kind})

    out = pd.DataFrame(rows)
    out["change"] = out.final.astype(str) != out.cur.fillna("")
    print(f"current players resolved: {len(out)}")
    print(f"  hug (graded+stats): {n_hug}   freshman/graded kept: {n_kept}   "
          f"ungraded model: {n_model}")
    print(f"  DB rows to update: {out.change.sum()}")
    g = out[out.kind == "hug"].copy()
    g["delta_from_manual"] = g.final - g.manual
    print(f"\n  graded players moved off manual by >0: {(g.delta_from_manual!=0).sum()} "
          f"(all within ±{BAND}); mean |move| {g.delta_from_manual.abs().mean():.2f}")
    print("  sample hugs:")
    for _, r in g[g.delta_from_manual != 0].head(8).iterrows():
        print(f"    {r['name'][:22]:22s} {str(r.team)[:13]:13s} manual {r.manual} -> {r.final}")

    if not write:
        print("\nDRY RUN — pass --write")
        return

    payload = [{"id": r.id, "name": r["name"], "tdc_grade": str(r.final)}
               for _, r in out[out.change].iterrows()]
    B = 200; ok = 0
    for j in range(0, len(payload), B):
        batch = payload[j:j + B]
        rr = requests.post(f"{SB}/rest/v1/players?on_conflict=id",
                           headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"},
                           json=batch, timeout=60)
        if rr.status_code in (200, 201, 204):
            ok += len(batch)
        else:
            print(f"  ERROR {rr.status_code}: {rr.text[:200]}"); break
        time.sleep(0.15)
    print(f"Done: {ok} grades written")


if __name__ == "__main__":
    main(write="--write" in sys.argv)
