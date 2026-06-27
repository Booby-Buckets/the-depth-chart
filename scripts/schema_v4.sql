-- Complete team stats per team-season (aggregated from box scores). Run once.
alter table team_seasons add column if not exists rpg    numeric;
alter table team_seasons add column if not exists apg    numeric;
alter table team_seasons add column if not exists spg    numeric;
alter table team_seasons add column if not exists bpg    numeric;
alter table team_seasons add column if not exists topg   numeric;
alter table team_seasons add column if not exists orpg   numeric;
alter table team_seasons add column if not exists drpg   numeric;
alter table team_seasons add column if not exists fg_pct numeric;
alter table team_seasons add column if not exists tp_pct numeric;
alter table team_seasons add column if not exists ft_pct numeric;
