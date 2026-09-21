/** WebSocket protocol for Slice 1 authoritative rooms. */

export const PROTOCOL_VERSION = 1 as const;

export type ClientMessage =
  | { type: "hello"; name?: string; protocol?: number }
  | { type: "move"; x: number; y: number }
  | { type: "attack"; targetId: string }
  | { type: "interact"; targetId: string }
  | { type: "travel"; toCanto: string }
  | { type: "pickup"; lootId: string }
  | { type: "ah_list"; itemId: string; priceAsh: number }
  | { type: "ah_buy"; listingId: string }
  | { type: "ah_bid"; listingId: string; bidAsh: number }
  | { type: "ah_browse" }
  | { type: "claim_daily" }
  | { type: "equip"; itemId: string }
  | { type: "unequip"; itemId?: string; slot?: string }
  | { type: "salvage_bag" }
  | { type: "cast"; spellId: string; aimX?: number; aimY?: number }
  | { type: "ping" };

export type ServerMessage =
  | { type: "welcome"; playerId: string; protocol: number; server: string }
  | { type: "snapshot"; room: import("./types").RoomSnapshot }
  | { type: "toast"; level: "info" | "warn" | "loot" | "emit"; text: string }
  | { type: "ah_listings"; listings: import("./types").AhListing[] }
  | { type: "combat"; attackerId: string; targetId: string; damage: number; targetHp: number }
  | {
      type: "spell_fx";
      spellId: string;
      casterId: string;
      x: number;
      y: number;
      tx?: number;
      ty?: number;
      radius?: number;
      duration?: number;
    }
  | { type: "entity_removed"; id: string }
  | { type: "error"; code: string; message: string }
  | { type: "pong"; t: number };
