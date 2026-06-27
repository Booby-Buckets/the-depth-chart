-- Link BBRef seasons to the existing ESPN player identity + carry grades over.
alter table bbref_seasons add column if not exists espn_id   bigint;
alter table bbref_seasons add column if not exists tdc_grade numeric;
create index if not exists bbref_espn_idx on bbref_seasons(espn_id);
