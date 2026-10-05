-- One-time catch-up XP version stamp. Additive and idempotent.
-- A progress row may exist before this column; default 0 means "not yet granted".

ALTER TABLE player_progress ADD COLUMN IF NOT EXISTS catchup_v INTEGER NOT NULL DEFAULT 0;
