import { randomBytes } from "node:crypto";
import { players } from "./ledger.mjs";
import { loadBurns } from "./content.mjs";
import { dbEnabled, query, withTransaction } from "./db.mjs";

const burns = loadBurns();
const AH_TAX = burns.ah_tax?.rate ?? 0.06;

const listings = new Map();
/** Listing ids held by an in-flight buy / bid / cancel. */
const busy = new Set();

function newListingId() {
  return `ah_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function listingFromRow(row, item) {
  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    item,
    priceAsh: Number(row.price_ash),
    highestBidAsh: Number(row.highest_bid_ash) || 0,
    highestBidderId: row.highest_bidder_id,
    bids: Array.isArray(row.bids) ? row.bids : row.bids || [],
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

function itemFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    rarity: row.rarity,
    itemPool: row.item_pool,
    seed: row.seed != null ? Number(row.seed) : null,
    affixes: Array.isArray(row.affixes) ? row.affixes : row.affixes || [],
    soulbound: Boolean(row.soulbound),
    qty: Number(row.qty) || 1,
    baseId: row.base_id || null,
    slot: row.slot || null,
  };
}

/** Fields the client is allowed to see. No internal bookkeeping. */
function toPublicListing(l) {
  return {
    id: l.id,
    sellerId: l.sellerId,
    sellerName: l.sellerName,
    item: l.item,
    priceAsh: l.priceAsh,
    highestBidAsh: l.highestBidAsh,
    highestBidderId: l.highestBidderId,
    createdAt: l.createdAt,
    bids: Array.isArray(l.bids) ? l.bids.slice() : [],
  };
}

async function addAsh(client, playerId, delta) {
  const res = await client.query(
    `UPDATE players SET ash = ash + $2, updated_at = NOW() WHERE id = $1`,
    [playerId, delta]
  );
  if (!res.rowCount) throw new Error("player_missing");
}

async function moveListedItem(client, itemId, ownerId) {
  const res = await client.query(
    `UPDATE inventory_items
     SET owner_id = $2, location = 'inventory', equipped_slot = NULL, updated_at = NOW()
     WHERE id = $1`,
    [itemId, ownerId]
  );
  if (!res.rowCount) throw new Error("item_missing");
}

async function markListing(client, listingId, status) {
  const res = await client.query(
    `UPDATE ah_listings SET status = $2, updated_at = NOW()
     WHERE id = $1 AND status = 'active'`,
    [listingId, status]
  );
  if (!res.rowCount) throw new Error("listing_not_active");
}

/**
 * Ash moves are kept as per-player deltas: written to Postgres as `ash = ash + d`
 * inside the trade transaction and applied to memory only after COMMIT, so a
 * balance that changes while we await (melt, emit claim) is never overwritten.
 */
function addDelta(deltas, playerId, amount) {
  if (!playerId || !amount) return;
  deltas.set(playerId, (deltas.get(playerId) || 0) + amount);
}

async function persistDeltas(client, deltas) {
  for (const [id, d] of deltas) if (d) await addAsh(client, id, d);
}

function applyDeltas(deltas) {
  for (const [id, d] of deltas) {
    const p = players.get(id);
    if (p && d) p.ash += d;
  }
}

/** Escrowed high bid goes back to its bidder (who may also be the buyer/seller). */
function refundEscrow(deltas, listing) {
  const bid = Number(listing.highestBidAsh) || 0;
  if (listing.highestBidderId && bid > 0) addDelta(deltas, listing.highestBidderId, bid);
}

export async function hydrateListings() {
  if (!dbEnabled()) return;
  const res = await query(
    `SELECT l.*, i.name AS i_name, i.rarity, i.item_pool, i.seed, i.affixes,
            i.soulbound, i.qty, i.id AS item_pk, i.base_id, i.slot
     FROM ah_listings l
     LEFT JOIN inventory_items i ON i.id = l.item_id
     WHERE l.status = 'active'`
  );
  listings.clear();
  let skipped = 0;
  for (const row of res.rows) {
    // Active history whose item row is already gone cannot be bought.
    if (!row.item_pk) {
      skipped += 1;
      continue;
    }
    const item = itemFromRow({
      id: row.item_pk,
      name: row.i_name,
      rarity: row.rarity,
      item_pool: row.item_pool,
      seed: row.seed,
      affixes: row.affixes,
      soulbound: row.soulbound,
      qty: row.qty,
      base_id: row.base_id,
      slot: row.slot,
    });
    const listing = listingFromRow(row, item);
    listings.set(listing.id, listing);
  }
  console.log(
    `[db] hydrated ${listings.size} AH listings${skipped ? ` (${skipped} skipped, item missing)` : ""}`
  );
}

export async function listItem(sellerId, itemId, priceAsh) {
  if (!Number.isInteger(priceAsh) || priceAsh <= 0) {
    return { ok: false, reason: "bad_price" };
  }
  const seller = players.get(sellerId);
  if (!seller) return { ok: false, reason: "no_player" };
  const idx = seller.inventory.findIndex((i) => i.id === itemId);
  if (idx < 0) return { ok: false, reason: "item_not_found" };
  const item = seller.inventory[idx];
  if (item.equipSlot) return { ok: false, reason: "equipped" };
  if (item.soulbound) return { ok: false, reason: "soulbound" };

  seller.inventory.splice(idx, 1);
  const listing = {
    id: newListingId(),
    sellerId,
    sellerName: seller.name,
    item,
    priceAsh,
    highestBidAsh: 0,
    highestBidderId: null,
    bids: [],
    createdAt: Date.now(),
  };
  listings.set(listing.id, listing);

  try {
    if (dbEnabled()) {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO inventory_items (
             id, owner_id, location, name, rarity, item_pool, seed, affixes, soulbound, qty,
             equipped_slot, base_id, slot
           ) VALUES ($1,$2,'ah',$3,$4,$5,$6,$7::jsonb,$8,$9,NULL,$10,$11)
           ON CONFLICT (id) DO UPDATE SET
             owner_id = EXCLUDED.owner_id,
             location = 'ah',
             name = EXCLUDED.name,
             rarity = EXCLUDED.rarity,
             item_pool = EXCLUDED.item_pool,
             seed = EXCLUDED.seed,
             affixes = EXCLUDED.affixes,
             soulbound = EXCLUDED.soulbound,
             qty = EXCLUDED.qty,
             equipped_slot = NULL,
             base_id = EXCLUDED.base_id,
             slot = EXCLUDED.slot,
             updated_at = NOW()`,
          [
            item.id,
            sellerId,
            item.name,
            item.rarity,
            item.itemPool ?? null,
            item.seed ?? null,
            JSON.stringify(item.affixes || []),
            Boolean(item.soulbound),
            item.qty ?? 1,
            item.baseId ?? null,
            item.slot ?? null,
          ]
        );
        await client.query(
          `INSERT INTO ah_listings (
             id, item_id, seller_id, seller_name, price_ash, bids,
             highest_bid_ash, highest_bidder_id, status, item_name
           ) VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,0,NULL,'active',$6)`,
          [listing.id, item.id, sellerId, seller.name, priceAsh, item.name ?? null]
        );
      });
    }
  } catch (err) {
    listings.delete(listing.id);
    seller.inventory.splice(idx, 0, item);
    console.error("[db] AH list persist failed", err.message);
    return { ok: false, reason: "db_error" };
  }

  return { ok: true, listing };
}

export function browse() {
  return [...listings.values()];
}

export async function buy(buyerId, listingId) {
  const listing = listings.get(listingId);
  if (!listing || busy.has(listingId)) return { ok: false, reason: "not_found" };
  if (listing.sellerId === buyerId) return { ok: false, reason: "own_listing" };
  const buyer = players.get(buyerId);
  const seller = players.get(listing.sellerId);
  if (!buyer || !seller) return { ok: false, reason: "missing_party" };
  if (!listing.item?.id) return { ok: false, reason: "not_found" };

  const price = listing.priceAsh;
  if (buyer.ash < price) return { ok: false, reason: "insufficient_ash" };

  const tax = Math.floor(price * AH_TAX);
  const sellerGets = price - tax;
  const deltas = new Map();
  addDelta(deltas, buyerId, -price);
  addDelta(deltas, listing.sellerId, sellerGets);
  refundEscrow(deltas, listing);

  busy.add(listingId);
  try {
    if (dbEnabled()) {
      await withTransaction(async (client) => {
        await persistDeltas(client, deltas);
        await moveListedItem(client, listing.item.id, buyerId);
        await markListing(client, listingId, "sold");
      });
    }
    applyDeltas(deltas);
    listing.item.equipSlot = null;
    buyer.inventory.push(listing.item);
    listings.delete(listingId);
    return {
      ok: true,
      item: listing.item,
      paidAsh: price,
      taxAsh: tax,
      sellerNetAsh: sellerGets,
      touched: [...deltas.keys()],
    };
  } catch (err) {
    console.error("[db] AH buy persist failed", err.message);
    return { ok: false, reason: "db_error" };
  } finally {
    busy.delete(listingId);
  }
}

export async function bid(bidderId, listingId, bidAsh) {
  if (!Number.isInteger(bidAsh) || bidAsh <= 0) {
    return { ok: false, reason: "bad_bid" };
  }
  const listing = listings.get(listingId);
  if (!listing || busy.has(listingId)) return { ok: false, reason: "not_found" };
  if (listing.sellerId === bidderId) return { ok: false, reason: "own_listing" };
  if (bidAsh < listing.priceAsh) return { ok: false, reason: "below_ask" };
  if (bidAsh <= listing.highestBidAsh) return { ok: false, reason: "bid_too_low" };

  const bidder = players.get(bidderId);
  if (!bidder || bidder.ash < bidAsh) return { ok: false, reason: "insufficient_ash" };

  const deltas = new Map();
  refundEscrow(deltas, listing);
  addDelta(deltas, bidderId, -bidAsh);
  const bids = [
    ...(Array.isArray(listing.bids) ? listing.bids : []),
    { bidderId, bidAsh, t: Date.now() },
  ];

  busy.add(listingId);
  try {
    if (dbEnabled()) {
      await withTransaction(async (client) => {
        await persistDeltas(client, deltas);
        const upd = await client.query(
          `UPDATE ah_listings SET
             highest_bid_ash = $2,
             highest_bidder_id = $3,
             bids = $4::jsonb,
             updated_at = NOW()
           WHERE id = $1 AND status = 'active'`,
          [listingId, bidAsh, bidderId, JSON.stringify(bids)]
        );
        if (!upd.rowCount) throw new Error("listing_not_active");
      });
    }
    applyDeltas(deltas);
    listing.highestBidAsh = bidAsh;
    listing.highestBidderId = bidderId;
    listing.bids = bids;
    return { ok: true, listing, touched: [...deltas.keys()] };
  } catch (err) {
    console.error("[db] AH bid persist failed", err.message);
    return { ok: false, reason: "db_error" };
  } finally {
    busy.delete(listingId);
  }
}

/**
 * Seller pulls an active lot. Escrow returns to the high bidder.
 * The item comes back to the seller's bag. DB commits before memory moves.
 */
export async function cancelListing(sellerId, listingId) {
  const listing = listings.get(listingId);
  if (!listing || busy.has(listingId)) return { ok: false, reason: "not_found" };
  if (listing.sellerId !== sellerId) return { ok: false, reason: "not_owner" };
  const seller = players.get(sellerId);
  if (!seller) return { ok: false, reason: "no_player" };
  if (!listing.item?.id) return { ok: false, reason: "not_found" };

  const deltas = new Map();
  refundEscrow(deltas, listing);

  busy.add(listingId);
  try {
    if (dbEnabled()) {
      await withTransaction(async (client) => {
        await persistDeltas(client, deltas);
        await moveListedItem(client, listing.item.id, sellerId);
        await markListing(client, listingId, "cancelled");
      });
    }
    applyDeltas(deltas);
    listing.item.equipSlot = null;
    seller.inventory.push(listing.item);
    listings.delete(listingId);
    return { ok: true, listing, item: listing.item, touched: [...deltas.keys()] };
  } catch (err) {
    console.error("[db] AH cancel persist failed", err.message);
    return { ok: false, reason: "db_error" };
  } finally {
    busy.delete(listingId);
  }
}

export function getListings() {
  return browse().map(toPublicListing);
}
