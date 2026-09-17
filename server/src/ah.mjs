import { players, debitAsh, creditAsh } from "./ledger.mjs";
import { loadBurns } from "./content.mjs";

const burns = loadBurns();
const AH_TAX = burns.ah_tax?.rate ?? 0.06;

let listingSeq = 0;
const listings = new Map();

export function listItem(sellerId, itemId, priceAsh) {
  if (!Number.isInteger(priceAsh) || priceAsh <= 0) {
    return { ok: false, reason: "bad_price" };
  }
  const seller = players.get(sellerId);
  if (!seller) return { ok: false, reason: "no_player" };
  const idx = seller.inventory.findIndex((i) => i.id === itemId);
  if (idx < 0) return { ok: false, reason: "item_not_found" };
  const item = seller.inventory[idx];
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
    createdAt: Date.now(),
  };
  listings.set(listing.id, listing);
  return { ok: true, listing };
}

export function browse() {
  return [...listings.values()];
}

export function buy(buyerId, listingId) {
  const listing = listings.get(listingId);
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.sellerId === buyerId) return { ok: false, reason: "own_listing" };
  const buyer = players.get(buyerId);
  const seller = players.get(listing.sellerId);
  if (!buyer || !seller) return { ok: false, reason: "missing_party" };

  const price = listing.priceAsh;
  if (!debitAsh(buyerId, price)) return { ok: false, reason: "insufficient_ash" };

  const tax = Math.floor(price * AH_TAX);
  const sellerGets = price - tax;
  // half burn / half treasury — both leave play for Slice 1 stub
  creditAsh(listing.sellerId, sellerGets);

  buyer.inventory.push(listing.item);
  listings.delete(listingId);

  // Refund previous high bidder if any
  if (listing.highestBidderId && listing.highestBidAsh > 0) {
    creditAsh(listing.highestBidderId, listing.highestBidAsh);
  }

  return {
    ok: true,
    item: listing.item,
    paidAsh: price,
    taxAsh: tax,
    sellerNetAsh: sellerGets,
  };
}

export function bid(bidderId, listingId, bidAsh) {
  if (!Number.isInteger(bidAsh) || bidAsh <= 0) {
    return { ok: false, reason: "bad_bid" };
  }
  const listing = listings.get(listingId);
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.sellerId === bidderId) return { ok: false, reason: "own_listing" };
  if (bidAsh < listing.priceAsh) return { ok: false, reason: "below_ask" };
  if (bidAsh <= listing.highestBidAsh) return { ok: false, reason: "bid_too_low" };

  if (!debitAsh(bidderId, bidAsh)) return { ok: false, reason: "insufficient_ash" };

  if (listing.highestBidderId && listing.highestBidAsh > 0) {
    creditAsh(listing.highestBidderId, listing.highestBidAsh);
  }
  listing.highestBidAsh = bidAsh;
  listing.highestBidderId = bidderId;
  return { ok: true, listing };
}

export function getListings() {
  return browse();
}
