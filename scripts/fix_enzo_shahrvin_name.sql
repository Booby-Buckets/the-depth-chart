-- Purdue: "Enzo Sharhrvin" is a typo for Enzo Shahrvin (his school roster and every box score spell it Shahrvin).
-- Run once in the Supabase SQL editor (needs owner / service-role access; the public key can't write players).
--
-- ALSO fix the spelling in the Google Sheet. The sheet sync upserts on (name, team): if the sheet still says
-- "Sharhrvin", the next sync re-adds him under the old spelling (a NEW players.id) and its cleanup deletes this
-- renamed row. Rename here first, then fix the sheet, and the sync keeps updating this same row (id 70066).

begin;

-- 1. the roster row (keeps id 70066, depth_order and grades)
update players
   set name = 'Enzo Shahrvin'
 where id = 70066 and team = 'Purdue' and name = 'Enzo Sharhrvin';

-- 2. owner data stored under his name: the freshman editor's projection ("tdc_fr:Purdue:<name>") and any other
--    owner-blob key that carries the old spelling (injury report, etc.)
update profiles
   set freshman_projections = (
         select jsonb_object_agg(replace(k, 'Enzo Sharhrvin', 'Enzo Shahrvin'), v)
           from jsonb_each(freshman_projections) as e(k, v))
 where freshman_projections::text like '%Enzo Sharhrvin%';

commit;

-- check: one row, new spelling
select id, name, team, depth_order, class_year from players where team = 'Purdue' and name ilike 'enzo%';
