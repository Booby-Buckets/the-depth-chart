# Re-grade Runbook — after any roster change

What to run after you edit rosters in the Google Sheet, so the site shows
**data-driven** grades (box-stat model for experienced players; your hand grade
only for freshmen/newcomers) instead of your raw sheet numbers.

Steady state is **3 steps**. They rely on the one-time setup at the bottom
already being done (it is, as of 2026-08-02).

---

## The 3 steps

### 1. Sync the sheet → Supabase
Run `syncToSupabase()` from the Apps Script editor (Extensions → Apps Script in
the roster sheet). It **UPSERTs** players on `(name, team)`, so returning players
keep the **same `players.id`** and `espn_id` — the data-grade files stay valid
and headshots don't break. It also auto-backfills `espn_id` + stats for new
players and removes players who left.

**The sync does NOT overwrite experienced players' grades.** It only writes
`tdc_grade` for **freshmen / redshirt-freshmen** (who have no last-year data, so
your sheet grade is the only signal). For everyone with experience it leaves the
DB's data grade intact — so syncing can't re-inject your sheet rankings over the
model grades. (Deeper: even the re-grade in step 2 keeps each graded player within
`BAND=2` points of your manual grade by design — see `grade_sync_current.py`. If
you want the model to move *further* off your grades, raise `BAND`/`DEADBAND`.)

Watch the log for `Departed-player cleanup ran (synced N players)`. If you see
`Cleanup SKIPPED — only N players synced`, the upserts failed (almost always the
unique index is missing — see setup) — fix that before trusting the run.

### 2. Re-grade the roster (terminal)
```bash
cd /Users/aidanlee/the-depth-chart/scripts
export SUPABASE_SERVICE_KEY=sb_secret_...   # your service_role key (same one in load_supabase.py; never commit it)
python3 grade_pull.py                 # refresh history cache (no writes)
python3 grade_finalize.py --write     # train model, re-score all player_history
python3 grade_sync_current.py --write --pure   # grade experienced players PURELY by the model (ignore your hand grades); freshmen keep their sheet grade
python3 rank_rebalance.py --write     # era rebalance — MUST run last
```

**`--pure` is the "ignore my rankings" switch.** Without it, each experienced
player's grade is clipped to within `BAND=2` of your manual grade (a light
"scouting bump" hug). With `--pure`, experienced players get the full model
(data) grade and can move as far as the stats say; **freshmen always keep your
sheet grade** either way. Use `--pure` when you want the site graded on data, not
on your rankings.

If the model is already trained (grade_model.json exists from a prior run) and you
only want to re-apply pure grades, you can skip the first two lines and just run
`grade_sync_current.py --write --pure` + `rank_rebalance.py --write` — that also
avoids retraining the model on its own prior output.
One at a time, in order. `--write` steps modify the DB (intended). The terminal
uses the normal `sb_secret_` key fine — the browser-guard problem is Apps-Script-only.
Your original hand grades are backed up in `data/manual_grades_backup.csv`.

### 3. Rebuild the id-keyed grade files  ← don't skip this
The projection's **coupled grade anchors on `tdc_grade`**, so after a re-grade the
coupled/arch/gp files are stale and the site keeps showing the OLD grades ("still
the same rankings"). Regenerate them:
```bash
cd /Users/aidanlee/the-depth-chart/scripts
python3 rebuild_grade_files.py
```
Then bump caches + commit (the script prints this reminder too):
- in `tdc-projgrade.js`, bump `?v=` on player_coupled_grades / arch_bonus / gp_shrink
- bump `tdc-projgrade.js?v=` across the `.html` pages
- `git add` the 3 JSON + `tdc-projgrade.js` + `*.html`, commit & push

### 4. Republish the rankings
Click **Republish** in **owner.html** (recomputes cached `predictive_ratings` /
team power ratings), then hard-refresh the site (⌘⇧R).

That's it. Player grades come from step 3's files; team rankings from step 4.

---

## Verify (optional)
- A returner's grade should have moved off the round sheet number (the rebalance
  alone drops current grades ~2). e.g. after a run, John Blackwell read 93, not 95.
- Headshots show for players who have an `espn_id` (returners/transfers with
  history; true freshmen won't until ESPN has them).

---

## One-time setup (already done — reference only)
- **Unique index** for the upsert: run `scripts/upsert_players_setup.sql` once.
- **Backfill functions** the sync calls via RPC: run `scripts/backfill_espn_ids.sql`
  once (creates `backfill_espn_ids()` + `backfill_player_stats()`).
- **Sync script**: `scripts/sheet_sync.gs` is the version-controlled copy — paste
  into the Apps Script editor and set your `service_role` key on line ~22 (never
  commit the real key).

## Only if player ids ever churn again (they shouldn't, with the upsert sync)
The id-keyed grade files (`arch_bonus.json`, `gp_shrink.json`,
`player_coupled_grades.json`) would orphan. Regenerate them against the current ids:
```bash
cd /Users/aidanlee/the-depth-chart/scripts
python3 build_arch_bonus.py            # -> data/arch_bonus.json
python3 build_gp_regression.py         # -> data/gp_shrink.json
# coupled grades: build the scratchpad input, then run with jsc
python3 - <<'PY'
import urllib.request, json
KEY='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'; URL='https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1'
def get(p,r): 
    h={'apikey':KEY,'Authorization':'Bearer '+KEY,'Range':r}
    return json.load(urllib.request.urlopen(urllib.request.Request(URL+p,headers=h),timeout=90))
players=get('/players?select=*&name=neq.%E2%80%94&team=not.is.null&order=id.asc','0-999')+get('/players?select=*&name=neq.%E2%80%94&team=not.is.null&order=id.asc','1000-1999')
tconf={t['name']:(t.get('conf') or '') for t in get('/teams?select=name,conf','0-999') if t.get('name')}
# NOTE: this path must match the load() line inside build_grade_couple.js
open('<SESSION_SCRATCHPAD>/allplayers.js','w').write('var ALLPLAYERS='+json.dumps(players)+';\nvar TCONF='+json.dumps(tconf)+';\n')
PY
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
  build_grade_couple.js > data/player_coupled_grades.json
```
Then bump the data `?v=` inside `tdc-projgrade.js` (coupled / arch_bonus / gp_shrink)
**and** `tdc-projgrade.js?v=` across all pages, and commit the JSON. Note:
`versatility_adj.json` and `recruit_pedigree.json` are keyed by `espn_id` (stable),
so they never need this.
