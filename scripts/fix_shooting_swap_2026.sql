-- 2025-26 (season_year=2026) player_history load swapped MADE and ATTEMPTED for 3P and FT
-- (~85% of rows have 3PM>3PA / FTM>FTA, which is impossible; FG is fine, other seasons fine).
-- LEAST/GREATEST is idempotent: it fixes swapped rows and leaves correctly-stored rows unchanged
-- (made can never exceed attempts). Run in the Supabase SQL editor as owner.
UPDATE player_history
SET tpm = LEAST(tpm, tpa),
    tpa = GREATEST(tpm, tpa),
    ftm = LEAST(ftm, fta),
    fta = GREATEST(ftm, fta)
WHERE season_year = 2026
  AND tpa IS NOT NULL;
