-- Freshman projection preferences (owner-only) stored on the user's profile.
-- Run once in the Supabase SQL editor.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS freshman_projections jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The app PATCHes this column with the logged-in user's access token, so RLS must
-- allow a user to update their own profile row. If you don't already have such a
-- policy, create it:
--
-- ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "profiles_update_own" ON profiles
--   FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
