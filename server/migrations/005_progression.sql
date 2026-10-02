-- Character levels, skill ranks, and loadout. No foreign key: a progress
-- row may land before the players row (async persist). Idempotent.

CREATE TABLE IF NOT EXISTS player_progress (
  player_id UUID PRIMARY KEY,
  level INTEGER NOT NULL DEFAULT 1,
  xp BIGINT NOT NULL DEFAULT 0,
  ranks JSONB NOT NULL DEFAULT '{}'::jsonb,
  loadout JSONB NOT NULL DEFAULT '[]'::jsonb,
  backfilled BOOLEAN NOT NULL DEFAULT FALSE,
  respecs INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
