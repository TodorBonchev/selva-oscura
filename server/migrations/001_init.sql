-- Selva Oscura Slice 1 — Postgres schema (idempotent)
-- Phase 1 custody: players, inventory, AH, emit caps/log, vault mirror

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  ash INTEGER NOT NULL DEFAULT 25000 CHECK (ash >= 0),
  pending_ash INTEGER NOT NULL DEFAULT 0 CHECK (pending_ash >= 0),
  daily_quest_done_utc TEXT,
  visited_inferno BOOLEAN NOT NULL DEFAULT FALSE,
  spoke_to_guide BOOLEAN NOT NULL DEFAULT FALSE,
  boss_hour_key TEXT NOT NULL DEFAULT '',
  boss_hour_count INTEGER NOT NULL DEFAULT 0,
  champion_hour_key TEXT NOT NULL DEFAULT '',
  champion_hour_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS players_name_lower_uidx ON players (LOWER(name));

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  owner_id UUID REFERENCES players(id) ON DELETE SET NULL,
  location TEXT NOT NULL DEFAULT 'inventory'
    CHECK (location IN ('inventory', 'stash', 'ah', 'ground')),
  name TEXT NOT NULL,
  rarity TEXT NOT NULL,
  item_pool TEXT,
  seed BIGINT,
  affixes JSONB NOT NULL DEFAULT '[]'::jsonb,
  soulbound BOOLEAN NOT NULL DEFAULT FALSE,
  qty INTEGER NOT NULL DEFAULT 1,
  bound_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_items_owner_loc_idx
  ON inventory_items (owner_id, location);

CREATE TABLE IF NOT EXISTS ah_listings (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  seller_id UUID NOT NULL REFERENCES players(id),
  seller_name TEXT NOT NULL,
  price_ash INTEGER NOT NULL CHECK (price_ash > 0),
  bids JSONB NOT NULL DEFAULT '[]'::jsonb,
  highest_bid_ash INTEGER NOT NULL DEFAULT 0,
  highest_bidder_id UUID REFERENCES players(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'sold', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ah_listings_status_idx ON ah_listings (status)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS first_clears (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  canto_id TEXT NOT NULL,
  cleared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, canto_id)
);

CREATE TABLE IF NOT EXISTS emit_log (
  id BIGSERIAL PRIMARY KEY,
  t TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  player_id UUID NOT NULL REFERENCES players(id),
  event_type TEXT NOT NULL,
  payout_ash INTEGER NOT NULL,
  remaining_ash BIGINT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  chain TEXT NOT NULL DEFAULT 'pending_local_stub'
);

CREATE INDEX IF NOT EXISTS emit_log_player_t_idx ON emit_log (player_id, t DESC);

CREATE TABLE IF NOT EXISTS emit_caps_global (
  key TEXT PRIMARY KEY,
  period_key TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  remaining_ash BIGINT NOT NULL,
  remaining_stelle DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
