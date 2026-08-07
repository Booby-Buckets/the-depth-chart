-- 2008-09 North Carolina Tar Heels (NCAA champions, #1 all-time SRS) roster backfill.
-- Per-game stats from ESPN. Uses team='North Carolina' to match the player_history
-- convention (RJ Davis/Bacot rows), NOT team_seasons' 'North Carolina Tar Heels'.
-- Pre-2012: no espn_id/box_scores, so grades/WA won't compute (display only). Re-runnable.
DELETE FROM player_history WHERE season_year=2009 AND team='North Carolina';
INSERT INTO player_history (season_year,team,name,position,yr,height,depth_order,gp,mpg,ppg,rpg,apg,stl,blk,tovs,fg_pct,tp_pct,ft_pct) VALUES
  (2009, 'North Carolina', 'Tyler Hansbrough', 'F', 'Sr.', '6-9', 1, 34, 30.3, 20.7, 8.1, 1.0, 1.2, 0.4, 1.9, 51.4, 39.1, 84.1),
  (2009, 'North Carolina', 'Ty Lawson', 'G', 'Jr.', '6-0', 2, 35, 29.9, 16.6, 3.0, 6.6, 2.1, 0.1, 1.9, 53.2, 47.2, 79.8),
  (2009, 'North Carolina', 'Wayne Ellington', 'G', 'Jr.', '6-4', 3, 38, 30.4, 15.8, 4.9, 2.7, 0.9, 0.2, 1.6, 48.3, 41.7, 77.7),
  (2009, 'North Carolina', 'Danny Green', 'G', 'Sr.', '6-6', 4, 38, 27.4, 13.1, 4.7, 2.7, 1.8, 1.3, 1.7, 47.1, 41.8, 85.2),
  (2009, 'North Carolina', 'Deon Thompson', 'F', 'Jr.', '6-8', 5, 38, 24.8, 10.6, 5.7, 0.7, 0.9, 1.1, 1.3, 49.2, 0.0, 64.6),
  (2009, 'North Carolina', 'Ed Davis', 'F', 'Fr.', '6-10', 6, 38, 18.8, 6.7, 6.6, 0.6, 0.4, 1.7, 1.1, 51.8, 0.0, 57.3),
  (2009, 'North Carolina', 'Will Graves', 'F', 'So.', '6-6', 7, 20, 11.2, 4.0, 2.6, 0.8, 0.4, 0.1, 1.2, 43.7, 27.8, 88.9),
  (2009, 'North Carolina', 'Tyler Zeller', 'C', 'Fr.', '7-0', 8, 15, 7.8, 3.1, 2.0, 0.2, 0.2, 0.2, 0.5, 47.2, 0.0, 76.5),
  (2009, 'North Carolina', 'Bobby Frasor', 'G', 'Sr.', '6-3', 9, 38, 17.4, 2.6, 2.0, 1.4, 0.6, 0.1, 0.7, 33.3, 27.4, 46.2),
  (2009, 'North Carolina', 'Larry Drew II', 'G', 'Fr.', '6-2', 10, 38, 9.6, 1.4, 1.1, 1.9, 0.4, 0.0, 1.2, 35.1, 23.1, 41.2),
  (2009, 'North Carolina', 'Marcus Ginyard', 'G', 'Jr.', '6-5', 11, 3, 12.3, 1.3, 2.7, 1.3, 0.7, 0.0, 1.0, 25.0, 0.0, 50.0),
  (2009, 'North Carolina', 'J.B. Tanner', 'G', NULL, NULL, 12, 21, 2.1, 1.1, 0.3, 0.0, 0.0, 0.0, 0.0, 42.1, 35.7, 33.3),
  (2009, 'North Carolina', 'Patrick Moody', 'G', NULL, NULL, 13, 21, 2.1, 1.0, 0.7, 0.0, 0.1, 0.1, 0.1, 58.3, 0.0, 61.5),
  (2009, 'North Carolina', 'Mike Copeland', 'F', 'Sr.', '6-7', 14, 17, 2.5, 0.8, 0.8, 0.1, 0.0, 0.0, 0.1, 25.0, 0.0, 100.0),
  (2009, 'North Carolina', 'Justin Watts', 'G', 'Fr.', '6-4', 15, 27, 3.1, 0.7, 0.7, 0.2, 0.1, 0.1, 0.3, 24.2, 0.0, 42.9),
  (2009, 'North Carolina', 'Jack Wooten', 'G', NULL, NULL, 16, 19, 1.9, 0.5, 0.3, 0.1, 0.0, 0.0, 0.1, 36.4, 20.0, 25.0),
  (2009, 'North Carolina', 'Marc Campbell', 'G', NULL, NULL, 17, 20, 1.9, 0.2, 0.3, 0.5, 0.1, 0.0, 0.4, 33.3, 0.0, 100.0);
