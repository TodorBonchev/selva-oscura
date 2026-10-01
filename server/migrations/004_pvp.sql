-- Consensual PvP ratings and records. No foreign key: player rows are
-- persisted asynchronously and a stats row may land first. Idempotent.

CREATE TABLE IF NOT EXISTS pvp_stats (
  player_id UUID PRIMARY KEY,
  rating INTEGER NOT NULL DEFAULT 1200,
  peak_rating INTEGER NOT NULL DEFAULT 1200,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  rounds_won INTEGER NOT NULL DEFAULT 0,
  title TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pvp_stats_rating_idx ON pvp_stats (rating DESC);
