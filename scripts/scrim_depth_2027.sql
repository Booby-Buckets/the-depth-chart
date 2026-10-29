-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Charlotte: 1.21 reality, known 0.41, weight 0.35; starters Keyshuan Tillery, Dorian Finister, Arden Conyers, Tyler McKinley, Peyton Marshall -> Keyshuan Tillery, Dorian Finister, Arden Conyers, Tyler McKinley, Peyton Marshall
update players p set depth_order = v.d, depth_set_at = now() from (values (80757, 1), (72777, 2), (68199, 3), (68200, 4), (72780, 5), (68202, 6), (68201, 7), (68204, 8), (68205, 9), (72784, 10), (72786, 11), (72787, 12), (94669, 13), (94670, 14)) v(id, d)
 where p.id = v.id and p.team = 'Charlotte';
-- Dayton: 1.87 reality, known 0.58, weight 0.40; starters Zaide Lowery, Travis Perry, Grant Randall, Ameal L'etang, Aidan Derkack -> Zaide Lowery, Travis Perry, Grant Randall, Ameal L'etang, Aidan Derkack
update players p set depth_order = v.d, depth_set_at = now() from (values (53014, 1), (53013, 2), (53015, 3), (53016, 4), (53006, 5), (53019, 6), (53018, 7), (53020, 8), (53017, 9), (53021, 10), (53010, 11), (53007, 12), (53008, 13), (53009, 14), (94694, 15), (94695, 16), (94696, 17)) v(id, d)
 where p.id = v.id and p.team = 'Dayton';
-- San Diego State: 1.34 reality, known 0.50, weight 0.35; starters David Tirresani, Elize Harrington, Luka Skoric, Tae Simmons, Jeremiah Cherry -> David Tirresani, Elize Harrington, Tae Simmons, Luka Skoric, Jeremiah Cherry
update players p set depth_order = v.d, depth_set_at = now() from (values (59174, 1), (52878, 2), (52880, 3), (52876, 4), (52881, 5), (59181, 6), (52879, 7), (52883, 8), (52882, 9), (52884, 10), (52877, 11), (59177, 12), (94796, 13), (94797, 14), (94798, 15), (94799, 16), (94800, 17)) v(id, d)
 where p.id = v.id and p.team = 'San Diego State';
-- Washington: 0.69 reality, known 0.64, weight 0.19; starters Ryan Beasley, Wesley Yates, Parker Friedrichsen, LeJuan Watts, Lathan Sommerville -> Ryan Beasley, Wesley Yates, Parker Friedrichsen, LeJuan Watts, Lathan Sommerville
update players p set depth_order = v.d, depth_set_at = now() from (values (50179, 1), (50180, 2), (50181, 3), (50182, 4), (50183, 5), (71736, 6), (50184, 7), (50185, 8), (50186, 9), (50188, 10), (50187, 11), (50189, 12), (50190, 13), (50191, 14), (94842, 15), (94843, 16)) v(id, d)
 where p.id = v.id and p.team = 'Washington';
-- Washington State: 0.59 reality, known 0.34, weight 0.23; starters Sebastian Aikins, RJ Jones, Jaylen Harrell, Ronnie Harrison, Tyler Kropp -> Sebastian Aikins, RJ Jones, Jaylen Harrell, Ronnie Harrison, Tyler Kropp
update players p set depth_order = v.d, depth_set_at = now() from (values (52955, 1), (52956, 2), (52957, 3), (52958, 4), (52959, 5), (52960, 6), (52961, 7), (52963, 8), (52962, 9), (52952, 10), (52954, 11), (94845, 12), (52953, 13), (94844, 14), (94846, 15), (94847, 16)) v(id, d)
 where p.id = v.id and p.team = 'Washington State';
commit;
