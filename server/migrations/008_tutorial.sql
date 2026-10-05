-- First-run onboarding stamp (additive). Existing rows default to 2 = "done", so only
-- pilgrims whose progression row is created after this migration see the tutorial.
-- 0 = not started, 1 = starter XP granted, 2 = finished or skipped.
ALTER TABLE player_progress ADD COLUMN IF NOT EXISTS tutorial_v INTEGER NOT NULL DEFAULT 2;
