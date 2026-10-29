-- Strip a stray season tag (" 24-25") from player names (2026-10-28): Jazz Gardner (Saint Mary's), Chris Tadjo (Santa Clara).
-- Renames in place (same players.id, so grades/espn_id/depth stay) and stamps site_added_at so the Sheet
-- sync never deletes the renamed row. ALSO fix the name cell in the Sheet, or the next sync re-adds the "24-25" row.
update players p
set name = regexp_replace(p.name, '\s+\d{2}-\d{2}$', ''), site_added_at = coalesce(p.site_added_at, now())
where p.name ~ '\s\d{2}-\d{2}$'
  and not exists (select 1 from players x where x.team = p.team and x.name = regexp_replace(p.name, '\s+\d{2}-\d{2}$', ''));

select id, name, team, espn_id from players where name in ('Jazz Gardner', 'Chris Tadjo') or name ~ '\s\d{2}-\d{2}$';
