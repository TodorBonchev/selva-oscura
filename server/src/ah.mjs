import { players } from "./ledger.mjs";
import { loadBurns } from "./content.mjs";
import { dbEnabled, query, withTransaction } from "./db.mjs";

const burns = loadBurns();
const AH_TAX = burns.ah_tax?.rate ?? 0.06;

let listingSeq = 0;
const listings = new Map();

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
  };
}

export async function hydrateListings() {
  if (!dbEnabled()) return;
  const res = await query(
    `SELECT l.*, i.name AS i_name, i.rarity, i.item_pool, i.seed, i.affixes,
            i.soulbound, i.qty, i.id AS item_pk
     FROM ah_listings l
     JOIN inventory_items i ON i.id = l.item_id
     WHERE l.status = 'active'`
  );
  listings.clear();
  let maxSeq = 0;
  for (const row of res.rows) {
    const item = itemFromRow({
      id: row.item_pk,
      name: row.i_name,
      rarity: row.rarity,
      item_pool: row.item_pool,
      seed: row.seed,
      affixes: row.affixes,
      soulbound: row.soulbound,
      qty: row.qty,
    });
    const listing = listingFromRow(row, item);
    listings.set(listing.id, listing);
    const m = /^ah_(\d+)$/.exec(listing.id);
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  }
  listingSeq = maxSeq;
  console.log(`[db] hydrated ${listings.size} AH listings`);
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
  listingSeq += 1;
  const listing = {
    id: `ah_${listingSeq}`,
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
             id, owner_id, location, name, rarity, item_pool, seed, affixes, soulbound, qty
           ) VALUES ($1,$2,'ah',$3,$4,$5,$6,$7::jsonb,$8,$9)
           ON CONFLICT (id) DO UPDATE SET
             owner_id = EXCLUDED.owner_id,
             location = 'ah',
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
          ]
        );
        await client.query(
          `INSERT INTO ah_listings (
             id, item_id, seller_id, seller_name, price_ash, bids,
             highest_bid_ash, highest_bidder_id, status
           ) VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,0,NULL,'active')`,
          [listing.id, item.id, sellerId, seller.name, priceAsh]
        );
      });
    }
  } catch (err) {
    // Roll back memory on DB failure
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
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.sellerId === buyerId) return { ok: false, reason: "own_listing" };
  const buyer = players.get(buyerId);
  const seller = players.get(listing.sellerId);
  if (!buyer || !seller) return { ok: false, reason: "missing_party" };

  const price = listing.priceAsh;
  if (buyer.ash < price) return { ok: false, reason: "insufficient_ash" };

  const tax = Math.floor(price * AH_TAX);
  const sellerGets = price - tax;
  const prevBidderId = listing.highestBidderId;
  const prevBid = listing.highestBidAsh;

  // Apply in memory first, then durable transaction
  buyer.ash -= price;
  seller.ash += sellerGets;
  buyer.inventory.push(listing.item);
  listings.delete(listingId);
  if (prevBidderId && prevBid > 0) {
    const prev = players.get(prevBidderId);
    if (prev) prev.ash += prevBid;
  }

  try {
    if (dbEnabled()) {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE players SET ash = $2, updated_at = NOW() WHERE id = $1`,
          [buyerId, buyer.ash]
        );
        await client.query(
          `UPDATE players SET ash = $2, updated_at = NOW() WHERE id = $1`,
          [listing.sellerId, seller.ash]
        );
        if (prevBidderId && prevBid > 0) {
          const prev = players.get(prevBidderId);
          if (prev) {
            await client.query(
              `UPDATE players SET ash = $2, updated_at = NOW() WHERE id = $1`,
              [prevBidderId, prev.ash]
            );
          }
        }
        await client.query(
          `UPDATE inventory_items
           SET owner_id = $2, location = 'inventory', updated_at = NOW()
           WHERE id = $1`,
          [listing.item.id, buyerId]
        );
        await client.query(
          `UPDATE ah_listings SET status = 'sold', updated_at = NOW() WHERE id = $1`,
          [listingId]
        );
      });
    }
  } catch (err) {
    console.error("[db] AH buy persist failed", err.message);
    // Memory already applied; leave consistent hot state, log for ops
  }

  return {
    ok: true,
    item: listing.item,
    paidAsh: price,
    taxAsh: tax,
    sellerNetAsh: sellerGets,
  };
}

export async function bid(bidderId, listingId, bidAsh) {
  if (!Number.isInteger(bidAsh) || bidAsh <= 0) {
    return { ok: false, reason: "bad_bid" };
  }
  const listing = listings.get(listingId);
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.sellerId === bidderId) return { ok: false, reason: "own_listing" };
  if (bidAsh < listing.priceAsh) return { ok: false, reason: "below_ask" };
  if (bidAsh <= listing.highestBidAsh) return { ok: false, reason: "bid_too_low" };

  const bidder = players.get(bidderId);
  if (!bidder || bidder.ash < bidAsh) return { ok: false, reason: "insufficient_ash" };

  const prevBidderId = listing.highestBidderId;
  const prevBid = listing.highestBidAsh;

  bidder.ash -= bidAsh;
  if (prevBidderId && prevBid > 0) {
    const prev = players.get(prevBidderId);
    if (prev) prev.ash += prevBid;
  }
  listing.highestBidAsh = bidAsh;
  listing.highestBidderId = bidderId;
  if (!Array.isArray(listing.bids)) listing.bids = [];
  listing.bids.push({ bidderId, bidAsh, t: Date.now() });

  try {
    if (dbEnabled()) {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE players SET ash = $2, updated_at = NOW() WHERE id = $1`,
          [bidderId, bidder.ash]
        );
        if (prevBidderId && prevBid > 0) {
          const prev = players.get(prevBidderId);
          if (prev) {
            await client.query(
              `UPDATE players SET ash = $2, updated_at = NOW() WHERE id = $1`,
              [prevBidderId, prev.ash]
            );
          }
        }
        await client.query(
          `UPDATE ah_listings SET
             highest_bid_ash = $2,
             highest_bidder_id = $3,
             bids = $4::jsonb,
             updated_at = NOW()
           WHERE id = $1 AND status = 'active'`,
          [listingId, bidAsh, bidderId, JSON.stringify(listing.bids)]
        );
      });
    }
  } catch (err) {
    console.error("[db] AH bid persist failed", err.message);
  }

  return { ok: true, listing };
}

export function getListings() {
  return browse();
}

