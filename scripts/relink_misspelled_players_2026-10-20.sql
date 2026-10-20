-- ============================================================================
--  Re-link 28 rostered players whose name on the roster sheet doesn't match our history (2026-10-20).
-- ----------------------------------------------------------------------------
--  Owner: "two Xavier starters are incorrectly linked … fix that on every team". A player whose sheet name
--  is misspelled ("Jovan Miliecevic") or a nickname variant ("Michael" vs "Mike" Nwoko) never gets an
--  espn_id, so his page shows no history and the projection treats him as a blank newcomer (Xavier's
--  starting PF and C projected 9.8 / 8.6 ppg at a generic 44.6 FG%). backfill_espn_ids() only links exact
--  names. Each match below = the same player in player_history: name within a typo / nickname of the
--  sheet's AND his history school = this school or the prior school the sheet lists. Namesakes rejected
--  (Illinois' Ethan Brown != UIC's Ethyn Brown, North Alabama's EJ King != North Dakota's Eli King,
--  Northern Iowa's Cade != Chase Courbat).
--
--  Run the whole file once in the Supabase SQL editor. Keyed on id AND espn_id still null, so it's a no-op
--  for anything already fixed and safe to re-run. espn_id isn't in the sheet sync's payload, so it sticks.
--
--  NOTE: Kash Polk, Easton Hupp, Ben Johnson and Trap Johnson are listed as "Fr." on the sheet but played
--  D-I last season (transfers). backfill_espn_ids() step 0 clears an espn_id on a TRUE freshman at the next
--  sync, so change their class on the sheet (So. or whatever is right) or their link will be undone.
--  Also fix the sheet spellings when convenient (the display name comes from the sheet).
-- ============================================================================

update players set espn_id = 5144139 where id = 50599 and espn_id is null;  -- Alabama: "London Jeminson" = London Jemison (Alabama 2025-26, 6.2 ppg)
update players set espn_id = 5108148 where id = 78282 and espn_id is null;  -- Bethune-Cookman: "Daniel Perez-Rouzan" = Daniel Rouzan (Bethune-Cookman 2025-26, 11.8 ppg)
update players set espn_id = 5239778 where id = 79038 and espn_id is null;  -- Central Arkansas: "Owen Dehrmann" = Owen Derhmann (Central Arkansas 2025-26, 0.3 ppg)
update players set espn_id = 5313905 where id = 52917 and espn_id is null;  -- Colorado State: "Jojo Mclver" = Jojo McIver (Colorado State 2025-26, 2.7 ppg)
update players set espn_id = 5239762 where id = 79132 and espn_id is null;  -- Denver: "Jordan Rodgers" = Jordan Rogers (NJIT 2025-26, 5.8 ppg)
update players set espn_id = 5180962 where id = 76340 and espn_id is null;  -- Gardner-Webb: "Mikhali Pocknett" = Mikhail Pocknett (Buffalo 2025-26, 3.9 ppg)
update players set espn_id = 5314516 where id = 53033 and espn_id is null;  -- George Mason: "Emmett Adiar" = Emmett Adair (Loyola (MD) 2025-26, 14.6 ppg)
update players set espn_id = 5144131 where id = 76724 and espn_id is null;  -- Jacksonville State: "Kash Polk" = Kash Polk (Arizona State 2025-26, 0 ppg)  [sheet says Fr.]
update players set espn_id = 4894236 where id = 50120 and espn_id is null;  -- Ohio State: "Josh Ojanwuna" = Josh Ojianwuna (Baylor 2024-25, 7.4 ppg)
update players set espn_id = 5314718 where id = 79161 and espn_id is null;  -- Portland: "Dante Censorri-Hercules" = Dante Censori-Hercules (Portland 2025-26, 3.2 ppg)
update players set espn_id = 5236333 where id = 65183 and espn_id is null;  -- Saint Joseph's: "Austin Willford" = Austin Williford (Saint Joseph's 2025-26, 7.8 ppg)
update players set espn_id = 5329573 where id = 77354 and espn_id is null;  -- Saint Peter's: "Robert Wilmote" = Rob Wilmote (Saint Peter's 2025-26, 2 ppg)
update players set espn_id = 5242610 where id = 76839 and espn_id is null;  -- Sam Houston: "Cheikh Sadibou Ndiaye" = Cheikh Ndiaye (Sam Houston 2025-26, 0 ppg)
update players set espn_id = 5185563 where id = 79186 and espn_id is null;  -- San Diego: "Adrian Mclntyre" = Adrian McIntyre (San Diego 2025-26, 9.8 ppg)
update players set espn_id = 5215425 where id = 79145 and espn_id is null;  -- Santa Clara: "Sasha Gavalyugov" = Sash Gavalyugov (Santa Clara 2025-26, 9 ppg)
update players set espn_id = 5312188 where id = 53194 and espn_id is null;  -- South Florida: "Andrej Shoshkij" = Andrej Shoshkikj (Stony Brook 2025-26, 10.7 ppg)
update players set espn_id = 5241617 where id = 53131 and espn_id is null;  -- St. Bonaventure: "Ryan Kelambay" = Ryan Kalambay (Detroit Mercy 2025-26, 4.1 ppg)
update players set espn_id = 5312302 where id = 50489 and espn_id is null;  -- St. John's: "Fotis Konstantindis" = Fotis Konstantinidis (St. John's (NY) 2025-26, 0.4 ppg)
update players set espn_id = 5313452 where id = 78628 and espn_id is null;  -- Stephen F. Austin: "Easton Hupp" = Easton Hupp (Charleston Southern 2025-26, 2.8 ppg)  [sheet says Fr.]
update players set espn_id = 5105675 where id = 77956 and espn_id is null;  -- Stonehill: "Will Batchelder" = William Batchelder (Stonehill 2025-26, 10.3 ppg)
update players set espn_id = 5176728 where id = 52947 and espn_id is null;  -- Texas State: "Kaden Grumbs" = Kaden Gumbs (Texas State 2024-25, 11.0 ppg)
update players set espn_id = 5241292 where id = 78475 and espn_id is null;  -- VMI: "Trap Johnson" = Trap Johnson (UC San Diego 2025-26, 2.6 ppg)  [sheet says Fr.]
update players set espn_id = 5240272 where id = 76261 and espn_id is null;  -- Weber State: "Augustine Ewke" = Augustine Ekwe (New Mexico State 2025-26, 2.7 ppg)
update players set espn_id = 4897010 where id = 77520 and espn_id is null;  -- Western Michigan: "Ben Johnson" = Ben Johnson (Vermont 2025-26, 5.4 ppg)  [sheet says Fr.]
update players set espn_id = 5242593 where id = 76689 and espn_id is null;  -- William & Mary: "Colin Lamine Ndaw" = Colin Ndaw (William & Mary 2025-26, 2 ppg)
update players set espn_id = 5313752 where id = 94618 and espn_id is null;  -- Wyoming: "Nasir (Naz) Meyer" = Nasir Meyer (Wyoming 2025-26, 12.9 ppg)
update players set espn_id = 5101673 where id = 50567 and espn_id is null;  -- Xavier: "Jovan Miliecevic" = Jovan Milicevic (Xavier 2025-26, 12.4 ppg)
update players set espn_id = 4895795 where id = 50568 and espn_id is null;  -- Xavier: "Michael Nwoko" = Mike Nwoko (Louisiana State 2025-26, 13.4 ppg)

-- check: should list all 28 with their espn_id set
select id, name, team, espn_id from players where id in (50120,50489,50567,50568,50599,52917,52947,53033,53131,53194,65183,76261,76689,76724,76839,77354,77520,77956,78282,78475,78628,79038,79132,79145,79161,79186,94618,76340) order by team;
