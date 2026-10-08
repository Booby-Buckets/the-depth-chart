# Dynasty engine — calibration log

Run: `node tools/calibrate.js --seasons N [--set KEY=v,...] [--resid] [--json out.json]` from `js/dynasty/`.
It sims the real 2026-27 D-I-vs-D-I schedule (4,964 games among the 350 snapshot teams) N times and prints:

- **League**: sim averages next to real 2025-26 targets (`engine/targets.json`) with tolerances. Pace and ORtg use
  the box-score possession estimate (FGA − ORB + TOV + 0.475·FTA), the same estimate the targets use.
- **Teams vs the projection chain**: sim **opponent-adjusted** ORtg / DRtg / net (KenPom-style iteration over the
  schedule) next to `team_pace_eff.json` projected ORtg / DRtg, for the 298 teams with real projected DNA. The 66
  teams on the rating-derived fallback are excluded from that comparison; they're still in the sim and in the
  power-rating line. `buildTeamProjections` itself needs the browser (`window`, career history), so the precomputed
  projection-chain outputs stand in for it.
- **Players**: sim ppg and minutes vs projected lines (mpg ≥ 15).
- **Favourites**: sim win % by projected spread bucket, with the average spread vs the sim's average margin.
- **Biggest gaps** (`--resid`).

Speed: about 0.2 ms per bare game. A calibration season (4,964 games plus bookkeeping) takes about 1.4 s, so
`--seasons 100` takes about 2 min and `--seasons 500` about 12 min. The 500-season run in round 8 took 75 min only
because other runs were sharing the machine. Use 10–30 seasons to tune and 100+ to confirm.

## Model in one paragraph

Players are seven 1–99 pillars, built from each player's 2026-27 projected line (`scripts/build_dynasty_snapshot.py`).
`ratings.js` turns pillars and height into sim attributes through least-squares maps stored in the snapshot.
For each possession, `possession.js` does the following:
1. Picks an actor by usage^1.6.
2. Rolls a turnover. Steals are credited by steal rate.
3. Picks the shot type from the actor's 3PA rate and rolls a shooting foul (from FTA/FGA).
4. Rolls the make. The logit is shifted by home court, conference strength, game state and the defense's
   `def100 + sysDef`.
5. Rolls blocks, assists and and-ones.
6. On a miss, decides the rebound from summed on-floor rates. An offensive rebound starts a new play in the same
   possession.

`game.js` plays tempo-scaled possessions, re-picks five every 150 s by minutes still owed (≥1 guard, ≥1 big,
≤3 of either), and handles foul-outs and overtime.

Defense comes from three places:
- **def100**: a fit of projected team DRtg on minutes-weighted talent (an OVR rebuilt from pillars) and the DEF
  pillar.
- **sysDef**: the part of a team's projected DRtg that its players don't explain, capped at ±8. This is
  scheme/coaching, and becomes the coach's rating in a dynasty.
- **Conference strength (`level`)**: corrects for the schedule baked into each player's rates.

## Rounds

| # | Change | Result |
|---|---|---|
| 1 | First pass, all multipliers 1.0 | 3/11 league targets. ORtg +5.8, FTr +6, 3P% +2.4, 3PA rate +3.4, HCA 1.8, margin SD 13.5. Net vs projection r 0.52 (raw, unadjusted). 62 newcomers had points-only lines (zero shots, rebounds, etc.), which gave junk pillars for 5 rosters. |
| 2 | Fill points-only lines from league shapes. P3 ×0.935, P2 ×0.99, R3 ×0.915, FTR ×0.85, TOV ×0.93, BLK 0.2, HCA 0.10 | 9/11. Projected lines run hot vs real 2025-26 (eFG, 3P%). DRtg r 0.29: the DEF pillar alone doesn't carry team defense. |
| 3 | `def100` from a 2-term defense map (talent + DEF pillar). A free 7-pillar fit was collinear nonsense (scoring = defense). | Net r 0.63. Found the NaN hang (`DEF_PTS_K` missing) and added an OT cap guard. |
| 4 | Box-score possession estimate in the report. POSS_SCALE 0.975 (tempos are estimates, ~2.5% above real trips). TEAM_REB 7.5%. Lead management LEAD_K. | 11/11 league targets. Margin SD 11.4. |
| 5 | Compare **opponent-adjusted** sim efficiency (the projections are adjusted). Exclude the 66 rating-fallback teams from the comparison and the defense fit. | Net r 0.81→0.86. Exposed conference-level overshoot: Big 12 too good, Big Sky too bad. |
| 6 | LEVEL_OFF_K 0.12→0.037, LEVEL_DEF_K →0.043, set by regressing the residual on level | Level residual ≈ 0. Net r 0.81, slope 0.96. |
| 7 | `sysDef` (scheme defense, ±8 cap). DEF_PTS_K 0.07→0.03 (slope had gone to 2.4). | **Net r 0.93, slope 0.98, RMSE 3.2. DRtg r 0.95.** |
| 8 | Lead management only on the part of a lead beyond 10 points (LEAD_FREE). Unbiased within-matchup SD (the 6-season estimate was 9% low). LEAD_K 0.2, HCA_K 0.12. | See final run below. |

| 9 | **March benchmark** (dynasty, `/tmp/seeds.mjs`-style: R64 seed win rates, champion seeds, Final Four seed vs real history). Round 8 constants: 1v16 91.7% (real 98.8), 3v14 76.7 (85.3), 1 seeds won 20% of titles (~50-63%), Final Four avg seed 4.9 (3.5). Calibrating to the projection had inherited its compressed spread (7.9 vs 9.8 real). LEVEL_OFF_K 0.037→0.06, LEVEL_DEF_K 0.043→0.07, DEF_PTS_K 0.03→0.035, new TALENT_K 0.07 (logit per 5 pts of team roster-overall edge). | 11/11 league targets; net sd 11.1 (true talent, opp-adjusted); 1v16 97.5, 2v15 95.0, 4v13 81.9, 8v9 46.9; Final Four avg seed 4.0. Still loose at the very top (1 seeds ~20-35% of titles): the snapshot's best teams are bunched (projection top ~+21/100 vs real favourites ~+30). Net vs projection slope now ~1.3 by design (projection is compressed). |

## Final run (100 seasons, constants as committed)

```
LEAGUE           sim     target   diff   ok
pace              70.04    69.23 +0.81    yes
ortg             107.66   107.71 -0.05    
ppg               75.40    75.63 -0.23    yes
efg               51.90    51.27 +0.63    yes
tov_pct           15.90    15.80 +0.10    yes
orb_pct           27.85    28.32 -0.47    yes
ftr               34.48    35.02 -0.54    yes
three_rate        36.25    36.40 -0.15    yes
fg_pct            45.66    45.09 +0.57    
tp_pct            34.39    33.93 +0.46    yes
ft_pct            73.15    72.32 +0.83    yes
apg               13.99    14.02 -0.03    
spg                6.49     6.72 -0.23    
bpg                3.60     3.38 +0.22    
topg              10.75    10.95 -0.20    
orpg               8.73     9.14 -0.41    
rpg               31.34    31.97 -0.63    
hca_pts            2.85     3.00 -0.15    yes
game_margin_sd    11.22    11.00 +0.22    yes
also: actual possessions/team 67.59 (pace above = box-score estimate)  2P% 52.1  ast/FGM 0.52  PF/g 14.4

11/11 league targets within tolerance

TEAMS vs projection chain — 298 teams with projected DNA, sim opponent-adjusted (team_pace_eff ORtg/DRtg, team_projected_box ppg)
  net : r 0.932  slope 0.94  sd sim 8.0 vs proj 7.9 (real 2025-26 net sd 9.78)  rmse 2.9
  ORtg: r 0.911  slope 0.77  mean sim 107.9 vs proj 108.1
  DRtg: r 0.963  slope 1.34  mean sim 108.0 vs proj 107.9
  ppg : r 0.850  mean sim 75.7 vs proj 76.0
  residual vs conference level: net -0.21 per 10 lvl (r -0.06) · O -0.51 · D -0.30
  vs 2027 power rating (all 350 teams): r 0.848  slope 0.61 sim net per rating point
PLAYERS (mpg>=15, n=2242): ppg r 0.968 slope 1.20 (sim 10.5 vs proj 10.3) · minutes r 0.982 (sim 25.9 vs proj 26.6)

FAVOURITES (projected spread)   games   sim fav win%   expected (N(spread, 11))   avg spread / sim margin
   0–3  pts                     1398       54.9           55.4          1.5 / 1.4
   3–6  pts                     1035       63.8           65.1          4.3 / 4.0
   6–10 pts                      705       72.9           75.5          7.6 / 6.9
  10–15 pts                      322       82.1           86.4          12.2 / 10.1
  15–+  pts                      197       90.9           94.3          17.7 / 14.1

TOP 10 by projection        proj net  sim net  sim win%
  Florida Gators                19.2     15.6     71.6
  Duke Blue Devils              19.0     15.9     71.2
  Gonzaga Bulldogs              16.7     13.8     71.1
  Arizona Wildcats              16.6     15.8     68.8
  Houston Cougars               16.2     17.5     73.3
  Illinois Fighting Illini      15.5      9.7     59.0
  Texas Tech Red Raiders        15.5     10.9     61.1
  Iowa State Cyclones           15.4     15.1     71.3
  UConn Huskies                 15.3     13.7     63.7
  Louisville Cardinals          14.6     14.0     67.4
BOTTOM 5
  Le Moyne Dolphins            -13.5    -10.5     36.5
  Alcorn State Braves          -13.6    -13.7     23.3
  Morgan State Bears           -13.9    -14.3     31.2
  Coppin State Eagles          -14.4    -12.4     31.5
  North Carolina Central Eagles   -15.9    -15.6     23.5
```

The earlier 500-season run (round 7 constants, LEAD_K 0.12 on every possession) gave net r 0.931, slope 0.99,
DRtg r 0.965, and 10/11 league targets (margin SD 12.0).

## Open questions

1. **Mismatch margins.** Big favourites finish about 80–85% of the projected spread (a 12-point favourite wins by
   ~10). Lead management isn't the cause: with no lead term the ratio is the same. Either the sim compresses
   cross-level games, or the projection's cross-conference spreads are too wide. In-sample real data can't settle
   it (end-of-season ratings fitted to the same games show margins 1.45× their spread). It needs preseason
   ratings vs results.
2. **Talent spread.** Sim team quality (adjusted net SD ~8) matches the projection (7.9). A realized season adds
   about 3 points of noise (≈8.5), versus 9.8 in real seasons. Preseason projections are compressed, so a dynasty
   whose talent comes from these ratings will run a little tighter than real seasons. Revisit when development and
   recruiting create new spread.
3. **Rating-fallback teams** (66) have no projected DNA, so they get no `sysDef` and aren't in the projection
   comparison. Their rosters still sim from player pillars.
