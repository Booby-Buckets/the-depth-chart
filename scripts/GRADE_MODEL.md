# Overall-Grade Algorithm

Re-ranks every player from box-score stats, trained on the manual `tdc_grade`
values you assigned to the current roster. Replaces hand-graded overalls with a
single reproducible algorithm applied uniformly to all seasons (2011-12 → 2025-26).

## How it works

1. **Training labels** — the 653 current players (`players` table) that have a
   numeric `tdc_grade` *and* real stats. (All are power-conference; see caveat.)
2. **Features** — box-score only, so the same model can score the ~75k
   `player_history` rows that lack advanced stats: ppg/rpg/apg/stl/blk, shooting
   splits, derived TS% & eFG%, mpg, rebounding split, ast/to, height, position.
3. **Era-relative** — every stat is z-scored **within its own season** vs that
   year's qualified D1 population, so "a 90 in 2012" means as dominant vs 2012
   peers as a 90 in 2026. This is what lets a model trained on 2026 transfer to
   2012 without being out-of-distribution.
4. **Conference tier** — counting production is translated toward a tier-1
   equivalent via `TIER_TRANSLATION` (from `tdc-engine.js`), because the labeled
   set is ~all tier 1-2 so tier can't be a *learned* feature. A Big Sky star is
   discounted relative to an SEC star.
5. **Model** — RidgeCV (linear, interpretable). 5-fold CV: MAE ~3.2 grade pts,
   corr 0.77. Residuals are players you bumped for recruiting/transfer/defense the
   box score can't see — intentionally re-graded on production.
6. **Calibration** — linear stretch so the scale matches your 58-97 range
   (ceiling ~96).

## Files

| file | purpose |
|------|---------|
| `grade_pull.py` | cache all `player_history` → `data/history_all.pkl` |
| `grade_labels_pull.py` | cache manual grades → `data/players_labeled.pkl` |
| `grade_features.py` | feature engineering (within-season z-scores) |
| `grade_conf.py` | team-name → conference tier resolver |
| `grade_train.py` | cross-validation report (Ridge vs GBM) |
| `grade_score.py` | top-players-per-era sanity check |
| `grade_finalize.py` | train + persist model + score/write all history |
| `grade_current.py` | re-grade the current `players` roster |
| `data/grade_model.json` | persisted coefs + calibration + pop stats + tiers |
| `data/manual_grades_backup.csv` | **backup of your 986 original manual grades** |

## Re-run after loading a new season

Scripts read the Supabase service key from the environment:

```bash
export SUPABASE_SERVICE_KEY=sb_secret_...   # never commit this
python3 grade_pull.py               # refresh history cache
python3 grade_finalize.py --write   # re-score + write all player_history
python3 grade_sync_current.py --write  # copy correct grades onto current roster
```

**Current-roster policy (`grade_sync_current.py`) — your grades are the backbone:**

- **Players you graded** keep their manual grade EXACTLY, unless the stat model
  (recentered to your grade mean) disagrees by more than `DEADBAND` (3) points —
  then the grade is nudged toward consistency by at most `BAND` (2). So ~55% of
  graded players are untouched and only stat-outliers move ≤2.
- **No-stat freshmen** keep their manual grade (no stats for the model to read).
- **Players you never graded** (historical + a few current additions) get the
  full model grade.

The model grade per current player is read from their `player_history` 2026 row,
which uses the CORRECT conference tier (the team where the stats were earned) —
fixing the transfer bug where e.g. Ryan Prather's Robert Morris (tier 5) stats
were graded as Iowa State (tier 1) → 91. With the hug policy he lands at his
manual 84. Tune `BAND` / `DEADBAND` at the top of the script.

`grade_current.py` is deprecated (tiers transfers by their new team).

## Caveat — low-major extrapolation

Your labels are entirely power-conference, so low-major grades are an *inference*
(via the tier translation), not learned from your grades. The translation is
your own `TIER_TRANSLATION`. To improve it, grade a sample of low-major players
and add them to the training set. Original manual grades are preserved in
`data/manual_grades_backup.csv`; no-stat freshmen kept their manual grade since
the production model has no input for them.
