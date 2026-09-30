-- Sold and cancelled listings outlive the item row. Keep a display name,
-- allow item_id to become NULL, and clear the pointer when the item is deleted
-- (bag melt) instead of rejecting the delete. Idempotent within a transaction:
-- runMigrations applies this file once, inside withTransaction.

ALTER TABLE ah_listings ADD COLUMN IF NOT EXISTS item_name TEXT NULL;

UPDATE ah_listings AS l
SET item_name = i.name
FROM inventory_items AS i
WHERE l.item_id = i.id
  AND l.item_name IS NULL;

ALTER TABLE ah_listings ALTER COLUMN item_id DROP NOT NULL;

ALTER TABLE ah_listings DROP CONSTRAINT IF EXISTS ah_listings_item_id_fkey;

ALTER TABLE ah_listings
  ADD CONSTRAINT ah_listings_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE SET NULL;
