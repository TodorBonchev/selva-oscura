-- Equip slots + item base metadata (idempotent-ish via IF NOT EXISTS)

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS equipped_slot TEXT NULL;

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS base_id TEXT NULL;

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS slot TEXT NULL;

-- Drop old location check and recreate with 'equipped'
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_location_check;
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_location_check
  CHECK (location IN ('inventory', 'stash', 'ah', 'ground', 'equipped'));

ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_equipped_slot_check;
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_equipped_slot_check
  CHECK (
    equipped_slot IS NULL OR equipped_slot IN (
      'Head', 'Chest', 'Hands', 'Feet', 'MainHand', 'OffHand'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_owner_equip_uidx
  ON inventory_items (owner_id, equipped_slot)
  WHERE equipped_slot IS NOT NULL AND owner_id IS NOT NULL;
