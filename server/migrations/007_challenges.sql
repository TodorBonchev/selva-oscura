-- Daily arena challenge, weekly boss race, cosmetic unlocks and the worn title/flair.
-- Cosmetic only: nothing here touches stats, Ash or loot. No foreign keys (rows may
-- land before the async players row). Additive and idempotent.

CREATE TABLE IF NOT EXISTS challenge_progress (
  player_id UUID NOT NULL,
  period_key TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  done_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, period_key, challenge_id)
);

CREATE INDEX IF NOT EXISTS challenge_progress_period_idx ON challenge_progress (period_key);

CREATE TABLE IF NOT EXISTS weekly_race (
  week_key TEXT NOT NULL,
  player_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  boss_id TEXT NOT NULL DEFAULT '',
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (week_key, player_id)
);

CREATE INDEX IF NOT EXISTS weekly_race_week_idx ON weekly_race (week_key, finished_at);

CREATE TABLE IF NOT EXISTS player_cosmetics (
  player_id UUID NOT NULL,
  cosmetic_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, cosmetic_id)
);

CREATE TABLE IF NOT EXISTS player_flair (
  player_id UUID PRIMARY KEY,
  title TEXT NULL,
  flair TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
