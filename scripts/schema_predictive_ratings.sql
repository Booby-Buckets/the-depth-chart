-- Shared cache for the 2026-27 projected team ratings (tdc-ratings.js).
-- WITHOUT this table the ratings engine silently falls back to recomputing in
-- every visitor's browser (readDb 404 -> compute), so nothing is shared: the
-- freshman-projection rebuild only ever reaches the owner's own localStorage.
-- Creating it makes the projected rankings a real single source of truth (so
-- freshman projections are canonical for everyone) AND stops every page load
-- from recomputing from scratch. Run once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS predictive_ratings (
  season      int PRIMARY KEY,
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE predictive_ratings ENABLE ROW LEVEL SECURITY;

-- Everyone reads the published ratings.
CREATE POLICY "predictive_ratings_read" ON predictive_ratings
  FOR SELECT USING (true);

-- The ratings engine writes its computed cache with the publishable (anon) key
-- (tdc-ratings.js writeDb + rebuild), so allow insert/update. The data is
-- deterministic from public roster grades, so this is a self-healing cache.
CREATE POLICY "predictive_ratings_insert" ON predictive_ratings
  FOR INSERT WITH CHECK (true);
CREATE POLICY "predictive_ratings_update" ON predictive_ratings
  FOR UPDATE USING (true) WITH CHECK (true);
