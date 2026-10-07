-- player_history season lines that carried ANOTHER player's numbers (found Oct 7 2026). Run in the Supabase SQL editor.
-- Amari Evans' 2025-26 row held teammate JP Estrella's line (10.0 ppg / 5.4 rpg / 18.3 mpg); ESPN and his own box
-- scores say 4.1 / 3.2 / 14.4 over 35 games. Each row below is reset to the per-game average of the player's own box scores.
-- A full audit of 2024-25 and 2025-26 (10,148 rows vs box scores) found only these where the box scores are clearly complete.
begin;
update player_history set gp = 35, mpg = 14.4, ppg = 4.1, rpg = 3.2, apg = 0.8, oreb = 0.9, dreb = 2.3, stl = 1.0, blk = 0.2, tovs = 0.6, fgm = 1.5, fga = 3.7, fg_pct = 41.9, tpm = 0.3, tpa = 1.4, tp_pct = 22.0, ftm = 0.7, fta = 1.1, ft_pct = 57.5 where id = 13146;   -- Amari Evans 2025-26 (was 10 ppg, 18.3 mpg, 33 gp)
update player_history set gp = 29, mpg = 9.3, ppg = 2.0, rpg = 2.3, apg = 0.2, oreb = 0.9, dreb = 1.5, stl = 0.2, blk = 1.0, tovs = 0.2, fgm = 0.8, fga = 1.6, fg_pct = 46.8, tpm = 0.3, tpa = 0.7, tp_pct = 42.9, ftm = 0.2, fta = 0.3, ft_pct = 55.6 where id = 22122;   -- Pape N'Diaye 2025-26 (was 2 ppg, 26 mpg, 1 gp)
update player_history set gp = 26, mpg = 12.3, ppg = 3.2, rpg = 2.5, apg = 0.5, oreb = 0.8, dreb = 1.7, stl = 0.2, blk = 0.3, tovs = 0.2, fgm = 1.1, fga = 2.5, fg_pct = 43.9, tpm = 0.5, tpa = 1.3, tp_pct = 36.4, ftm = 0.5, fta = 0.7, ft_pct = 66.7 where id = 24189;   -- Tyler Hendricks 2024-25 (was 1.6 ppg, 9 mpg, 22 gp)
commit;
