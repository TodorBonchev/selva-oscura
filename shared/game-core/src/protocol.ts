/** WebSocket protocol for Slice 1 authoritative rooms. */

export const PROTOCOL_VERSION = 1 as const;

export type ClientMessage =
  | { type: "hello"; name?: string; protocol?: number }
  | { type: "move"; x: number; y: number }
  | { type: "attack"; targetId: string }
  | { type: "interact"; targetId: string }
  | { type: "travel"; toCanto: string; bypassGates?: boolean }
  | { type: "pickup"; lootId: string }
  | { type: "ah_list"; itemId: string; priceAsh: number }
  | { type: "ah_buy"; listingId: string }
  | { type: "ah_bid"; listingId: string; bidAsh: number }
  | { type: "ah_browse" }
  | { type: "claim_daily" }
  | { type: "equip"; itemId: string }
  | { type: "unequip"; itemId?: string; slot?: string }
  | { type: "salvage_bag" }
  | { type: "stash_put"; itemId: string }
  | { type: "stash_take"; itemId: string }
  | { type: "sip" }
  | { type: "dash"; x?: number; y?: number }
  | { type: "cast"; spellId: string; aimX?: number; aimY?: number }
  | { type: "ping" }
  | { type: "duel_challenge"; targetId: string }
  | { type: "duel_respond"; fromId: string; accept: boolean }
  | { type: "duel_cancel" }
  | { type: "pvp_queue"; join: boolean }
  | { type: "pvp_leaderboard" };

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
  /** Sent after interacting with the Dark Wood stash: client opens the bag in stash mode. */
  | { type: "stash_open" }
  | { type: "error"; code: string; message: string }
  | { type: "pong"; t: number }
  | {
      type: "pvp_windup";
      id: string;
      targetId: string;
      x: number;
      y: number;
      fx: number;
      fy: number;
      heavy: boolean;
      ms: number;
    }
  | {
      type: "pvp_down";
      killerId: string | null;
      killerName: string;
      recap: { name: string; how: string; dmg: number; count: number }[];
      total: number;
      respawnIn: number;
    }
  | {
      type: "pvp_kill";
      killerId: string;
      killerName: string;
      victimId: string;
      victimName: string;
      how: string;
      streak: number;
      announce?: string;
      firstBlood?: boolean;
      shutdown?: boolean;
    }
  | {
      type: "pvp_round";
      phase: "end";
      n: number;
      winners: { id: string; name: string; kills: number }[];
      board: { id: string; name: string; kills: number; streak: number }[];
    }
  | {
      type: "duel_invite";
      fromId: string;
      fromName: string;
      rating: number;
      title: string | null;
      expiresIn: number;
    }
  | { type: "duel_pending"; toId: string; toName: string; expiresIn: number }
  | { type: "duel_declined"; byName: string; reason: string }
  | {
      type: "duel_state";
      duel: {
        id: string;
        a: string;
        b: string;
        aName: string;
        bName: string;
        cx: number;
        cy: number;
        r: number;
        phase: "countdown" | "fight" | "over";
        startsAt: number;
        endsAt: number;
        ranked: boolean;
        winnerId?: string;
        reason?: string;
        ratingDelta?: Record<string, number>;
      };
    }
  | { type: "pvp_queue"; queued: boolean; size: number }
  | {
      type: "pvp_leaderboard";
      top: {
        rank: number;
        name: string;
        rating: number;
        wins: number;
        losses: number;
        kills: number;
        title: string | null;
      }[];
      you: {
        rank: number;
        name: string;
        rating: number;
        wins: number;
        losses: number;
        kills: number;
        title: string | null;
      } | null;
    };
