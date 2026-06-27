-- Stable ESPN player id on player_history + players (populated from box_scores)
-- so players are identified by id, not name.
alter table player_history add column if not exists espn_id bigint;
alter table players        add column if not exists espn_id bigint;
create index if not exists ph_espn_idx      on player_history(espn_id);
create index if not exists players_espn_idx on players(espn_id);
