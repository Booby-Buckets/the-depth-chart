-- Follow-up to fix_history_swaps_2026-10-07.sql: 12 rows had BOTH pairs swapped, but only one pair was close
-- enough to the box scores to be flagged the first time (made > attempted can't be right either way).
-- Safe to re-run: a row only flips while made > attempted.
begin;
-- 3-pointers still swapped (their free throws were already fixed)
update player_history set tpm = tpa, tpa = tpm
 where id in (15704, 18061, 18832, 19240, 21895, 23959, 24835) and tpm > tpa;   -- Day Day Thomas, Jalen Celestine, Jizzle James, Josh Reed, Nils Machowski, Trevon Brazile, Zvonimir Ivisic
-- free throws still swapped (their 3-pointers were already fixed)
update player_history set ftm = fta, fta = ftm
 where id in (13728, 19728, 20271, 22739, 23888) and ftm > fta;                  -- Billy Richmond III, Karter Knox, L.J. Cason, Roddy Gayle Jr., Tre Holloman
-- Mostapha El Moutaouakkil 2025-26: 3P attempts missing; his box scores say 1.2 of 3.3 a game
update player_history set tpm = 1.2, tpa = 3.3, tp_pct = 36.4 where id = 21579 and tpa is null;
commit;
-- check: should return 0
select count(*) from player_history
 where id in (13728, 15704, 18061, 18832, 19240, 19728, 20271, 21579, 21895, 22739, 23888, 23959, 24835)
   and (coalesce(tpm,0) > coalesce(tpa,0) + 0.05 or coalesce(ftm,0) > coalesce(fta,0) + 0.05);
