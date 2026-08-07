# For Tomorrow — questions, suggestions & changes

Compiled at the end of the `/loop` run (2026-08-06). The quick, safe, client-side items
from `TODO.md` are done and pushed. What's left below is everything that needs **your call**,
a **DB/pipeline action I can't take from here**, or a **model retune I can't verify without Node**.
Each item has the *root cause I found* + a *recommended fix* so tomorrow's session moves fast.

---

## 1. NEEDS YOUR DECISION

*(Color system — DONE: you picked the blue scale; unified across rankings, player DB, and stats
table. See "Already done" below. Nothing else is currently blocked on a decision.)*

---

## 2. NEEDS A DB BACKFILL (owner/Supabase write — I can't run it from here)

### B. Players show "—" for stats / WA / class  (e.g. Cameron Boozer, Bruce Thornton)
- **Root cause (confirmed in code):** the stats table builds each row from `TDCOwnedSeasons._shape(pa, ph)`.
  Per-game stats **and class/year** come from the `player_history` row (`ph.ppg/rpg/apg`, `ph.yr`);
  WA/TI/rates come from the `player_advanced` row (`pa`). A row that is "—" *everywhere* (incl. PTS)
  means **there is no `player_history` row for that player-season** — not a display bug.
- **What's needed:** backfill `player_history` (and `player_advanced` for WA/rates) for the missing
  player-seasons. Likely incoming-freshman / late-added rows that never got an `espn_id`-keyed history row.
- **Question:** want me to write a diagnostic that lists exactly which listed player-seasons are missing
  a `player_history`/`player_advanced` row, so you can target the backfill? (I can build the query;
  running the insert is your call.)

### C. 2008-09 UNC roster missing (rated our #1 team all-time)
- **Root cause:** the season is in `team_seasons` (SRS/record) but there are **no roster/player rows**
  (`player_history` / `box_scores`) for 2008-09 UNC, so `team.html` shows "No roster data."
- **What's needed:** a scrape + insert of that roster's per-player season line. `player_history` only
  goes back to 2012 today, so pre-2012 backfill is the general gap (relevant to any historic all-time team).
- **Question:** source preference — Sports-Reference scrape, or our own `box_scores` if that season's
  games exist there? (Note: `box_scores` may also be thin pre-2012.) This is the same pre-2012 data
  ceiling noted in the SR-migration memory.

---

## 3. NEEDS A PIPELINE CHANGE + RE-RUN (background job you control)

### D. On/off lineup ratings have no opponent/talent adjustment
- **Root cause:** the reconstructed lineup NET/ORtg/DRtg (`onoff.html` + `tdc-lineups.js`, from
  `lineups.json`) are **raw, unadjusted for opponent SRS/Net** — a big swing on a bad team is overstated.
- **Also a real data smell:** some per-stint values are non-physical (ORtg 321.4 / DRtg 206.0). That's not
  just "needs adjusting" — it points at a **possession-count bug in `build_pbp_analytics`** (tiny-possession
  stints producing absurd per-100). A display-layer clamp would mask, not fix, this.
- **Recommended fix (two parts):** (1) in the pipeline, drop/threshold sub-N-possession stints and cap
  per-100 to a believable band; (2) add an opponent/talent adjuster mirroring `adjust_team_dna` (shrink
  each lineup's net toward the team's `adjNet` by opponent strength). Then re-run + republish.
- **Question:** OK to change `build_pbp_analytics` and trigger the pbp re-run? (This is the heavy job you
  declined mid-session — confirming before I touch it.)

---

## 4. MODEL RETUNE — I CAN'T VERIFY WITHOUT NODE (recommend doing it live with you)

### E. Projections inflated (Logan Duncomb 18.3/8.9 at Winthrop → projected 21.0/10.3 at Notre Dame)
- **Root cause (traced in `tdc-proj.js`):** projected volume = `pm.fga × fgaGrow × newMpg × vacMult × volTaxEff`
  (line ~1095), and PPG = `max(ppg_comp, ppg_floor)`. For a **mid-major star transferring UP**, three
  multipliers stack the wrong way:
  1. `fgaGrow` — class/year growth bump (So→Jr) is applied **on top of** a competition jump.
  2. `vacMult` > 1 — he inherits Notre Dame's shot vacancy.
  3. `volTaxEff` barely bites for bigs: `_volForgive = 0.50` for bigs, so even a hard transfer-up
     `volTrans` gets **half-forgiven** (net cut ~10–12%).
  Result: the transfer-UP tax is smaller than the growth+vacancy boost → projection *rises* when it
  should fall.
- **Recommended fix:** for transfers moving up in competition tier, (a) **don't** stack `fgaGrow` on top
  of the tier jump, (b) reduce `_volForgive` for high-usage bigs, and (c) make `volTrans` scale with the
  **size** of the tier jump (Winthrop→ND is large). 
- **Why not done in the loop:** this engine **leads the site-wide rankings**, and there's **no Node here**
  to spot-check that a change makes Duncomb sane *without* wrecking hundreds of other lines. This needs a
  live session where we can rebuild and eyeball 10–15 transfer/returner cases.
- **Question:** want me to make this the first thing tomorrow, with a before/after table of ~15 spot-check
  players so we can see the effect before it goes live?

---

## 5. HARD REWORK — DONE

### F. Expanded team report scrolls off-left (index rankings) ✅
- Fixed: `wireStickyScroll` now sizes each open `.tr-drop` to the viewport and counter-translates it by
  `scrollLeft` (re-pinned on scroll / expand / resize). Verified at 768px — the report tracks the scroll
  and stays fully visible.

---

## Already done (for reference)
- ✅ Deepen dark grey · ✅ Uniform rankings dropdowns · ✅ Contender Quadrant now year-aware
  (+ killed broken Volume-vs-Efficiency chart) · ✅ Team-color projected stats (player page) ·
  ✅ Logos on Team History + Player DB · ✅ Postseason achievement badges on team-seasons ·
  ✅ Expanded report pinned on horizontal scroll · ✅ Blue color scale unified site-wide.

## Backlog (low priority)
- Personnel Book pass 4 (roles.html) — dedicated shot-profile chart + full consistency distribution.
  Largely redundant now.

---

# Grade-system overhaul (from the JoJo Tugler review) — scoped, not yet shipped

Tugler (Houston C, 8.4 ppg) showing as the #1 projected player (92) exposed that there are
**three different grade numbers per player that don't agree**, plus a data-linkage bug:

1. **espn_id nickname gap (data — needs a DB write you run).** Tugler's `players` row has
   `espn_id=NULL` because the roster says "JoJo Tugler" but his stats are under "Joseph Tugler".
   With no espn_id, his history (2024/2025), Wins Added, and the statistical projection can't
   attach — so he floats on the **sheet grade (89)**, shows only one season, and blank WA.
   `scripts/espn_backfill.sql` has 6 VERIFIED-safe links (incl. Tugler → 5060700). RLS blocks
   the anon key, so run it in the Supabase SQL editor. The broader nickname set needs per-player
   review (last-name matching is unsafe — Tyran Stokes ≠ Kamau Stokes). **Durable fix = nickname
   normalization in the roster-sync Apps Script** so espn_id is assigned on every sync (else a
   resync re-nulls it). See [[roster-sync]].

2. **Three grade paths must be unified.** (a) demonstrated `stat_overall.json` (Tugler 88),
   (b) statistical projected `stat_overall_projected.json` (Tugler absent — no espn_id),
   (c) **`gradeSolo` in tdc-projgrade.js — the RANKING grade** (Tugler 92, from bumping the sheet
   89). The rankings/top-players strip use (c). Unify so one scale drives player line, grade, and
   rankings. See [[projection-two-paths]].

3. **Centers over-valued (model).** In `build_stat_overall.py` L113: `wa=(owa*usg_mult + dwa)*sos`
   — DWA enters at FULL weight while offense is usage-scaled, and DWA is team-defense-heavy (Oliver
   DWS), so rim protectors on elite defenses over-grade. Tried `DWA_W=0.62` (added constant + L113):
   effect was MILD (Tugler 88→87; Reed/Peat dropped out of top 20). Reverted — shipping the
   demonstrated change alone widens the 3-path disagreement; must be done together with the projected
   rebuild + gradeSolo. Real center fix probably needs regressing DWA toward an individual signal,
   not just a global weight.

4. **Projected scale compressed.** demonstrated 2025-26: max 99, **137 players ≥90**. projected
   2026-27 (`stat_overall_projected.json`): max **91, only 5 ≥90**. Returning stars get crushed
   (a 97 returner → ~88). Align the projected probit scale to the demonstrated distribution.

5. **Tiny-sample %s.** 100% 3P% on ~0 attempts is carried forward with no regression (worse for
   unlinked players who skip the regressed projection). Regress percentages to positional mean below
   a min-attempts threshold; show N/A rather than 100%.

**Recommended order for a focused session:** (1) espn_id (you run the SQL) → then re-run both build
scripts so newly-linked players populate → (2) unify the scale + gradeSolo, (3) DWA rebalance,
(4) tiny-sample %s. Validate the whole top-30 (position balance) before committing, and bump
`stat_overall*.json?v=` + `tdc-projgrade.js?v=` across the ~25 loader pages.
