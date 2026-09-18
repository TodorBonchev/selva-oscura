/**
 * Shared game-core types — Selva Oscura / STELLE
 * Ash is always integer. Do not reopen token math.
 */

/** Integer subunit: 1 STELLE = 1_000 Ash. Never a second token. */
export type Ash = number & { readonly __brand: "Ash" };

export const ASH_PER_STELLE = 1000 as const;

export function steleToAsh(stelle: number): Ash {
  return Math.trunc(stelle * ASH_PER_STELLE) as Ash;
}

export function ashToStelleDisplay(ash: number): string {
  const whole = Math.trunc(ash / ASH_PER_STELLE);
  const frac = Math.abs(ash % ASH_PER_STELLE);
  return `${whole}.${String(frac).padStart(3, "0")}`;
}

export function asAsh(n: number): Ash {
  if (!Number.isInteger(n)) {
    throw new Error("Ash must be an integer");
  }
  return n as Ash;
}

/** Vault-eligible events only — never trash kills. */
export enum EventType {
  DailyQuest = 0,
  ChampionPack = 1,
  Boss = 2,
  FirstClear = 3,
}

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  [EventType.DailyQuest]: "DailyQuest",
  [EventType.ChampionPack]: "ChampionPack",
  [EventType.Boss]: "Boss",
  [EventType.FirstClear]: "FirstClear",
};

export type EventTypeName = "DailyQuest" | "ChampionPack" | "Boss" | "FirstClear";

/** D2-style rarity ladder + seasonal canto unique. */
export enum ItemRarity {
  Normal = "normal",
  Magic = "magic",
  Rare = "rare",
  Set = "set",
  Unique = "unique",
  CantoUnique = "canto_unique",
}

export enum Canticle {
  Inferno = "inferno",
  Purgatorio = "purgatorio",
  Paradiso = "paradiso",
}

export type CantoId = string;

export interface EmitCapPolicy {
  dailyQuestPerPlayerPerDay: 1;
  firstClearOncePerCanto: true;
  bossPerPlayerHourly: number;
  bossGlobalHourly: number;
  maxRemainingFractionPerUtcDay?: number;
}

export const DEFAULT_EMIT_CAPS: EmitCapPolicy = {
  dailyQuestPerPlayerPerDay: 1,
  firstClearOncePerCanto: true,
  bossPerPlayerHourly: 3,
  bossGlobalHourly: 500,
  maxRemainingFractionPerUtcDay: 0.0001,
};

export const STARTING_EMIT_P: Record<EventType, number> = {
  [EventType.DailyQuest]: 1e-7,
  [EventType.ChampionPack]: 3e-7,
  [EventType.Boss]: 5e-7,
  [EventType.FirstClear]: 2e-6,
};

export const PLAY_VAULT_STELLE = 300_000_000 as const;
export const HARD_CAP_STELLE = 1_000_000_000 as const;

export type ItemRarityName =
  | "normal"
  | "magic"
  | "rare"
  | "set"
  | "unique"
  | "canto_unique";

export interface Vec2 {
  x: number;
  y: number;
}

export type EquipSlot =
  | "Head"
  | "Chest"
  | "Hands"
  | "Feet"
  | "MainHand"
  | "OffHand";

export interface GameItem {
  id: string;
  name: string;
  rarity: ItemRarityName;
  itemPool: string;
  seed: number;
  affixes: string[];
  soulbound: boolean;
  qty: number;
  baseId?: string | null;
  slot?: string | null;
  equipSlot?: EquipSlot | null;
}

export interface GearStats {
  dmg: number;
  maxHp: number;
  armor: number;
}

export interface AhListing {
  id: string;
  sellerId: string;
  sellerName: string;
  item: GameItem;
  priceAsh: number;
  highestBidAsh: number;
  highestBidderId: string | null;
  createdAt: number;
}

export interface EntitySnapshot {
  id: string;
  kind: "mob" | "boss" | "player" | "poi" | "exit" | "loot";
  name: string;
  x: number;
  y: number;
  hp?: number;
  maxHp?: number;
  packId?: string;
  champion?: boolean;
  elite?: boolean;
  poiKind?: string;
  label?: string;
  toCanto?: string;
  item?: GameItem;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  cantoId: CantoId;
  ash: number;
  pendingAsh: number;
  inventory: GameItem[];
  equipped?: Partial<Record<EquipSlot, GameItem>>;
  gearStats?: GearStats;
  firstClears: string[];
  dailyQuestDoneUtc: string | null;
  visitedInferno: boolean;
  spokeToGuide: boolean;
}

export interface RoomSnapshot {
  cantoId: CantoId;
  title: string;
  role: string;
  bounds: { width: number; height: number };
  entities: EntitySnapshot[];
  players: PlayerSnapshot[];
  you: PlayerSnapshot;
}
