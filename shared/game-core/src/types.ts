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

export function ashToStelleDisplay(ash: Ash): string {
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

export type CantoId = string; // e.g. "inferno_01", "inferno_05"

export interface EmitCapPolicy {
  /** Max daily-quest emits per player per UTC day */
  dailyQuestPerPlayerPerDay: 1;
  /** First-clear once per canto per account */
  firstClearOncePerCanto: true;
  /** Boss emits gated by per-player and global hourly caps (values tuned in sim) */
  bossPerPlayerHourly: number;
  bossGlobalHourly: number;
  /** Optional: max fraction of remaining vault per UTC day (~0.0001 = 0.01%) */
  maxRemainingFractionPerUtcDay?: number;
}

export const DEFAULT_EMIT_CAPS: EmitCapPolicy = {
  dailyQuestPerPlayerPerDay: 1,
  firstClearOncePerCanto: true,
  bossPerPlayerHourly: 3,
  bossGlobalHourly: 500,
  maxRemainingFractionPerUtcDay: 0.0001,
};

/** Starting p targets from locked brief (tune via sim; on-chain via timelock). */
export const STARTING_EMIT_P: Record<EventType, number> = {
  [EventType.DailyQuest]: 1e-7,
  [EventType.ChampionPack]: 3e-7,
  [EventType.Boss]: 5e-7,
  [EventType.FirstClear]: 2e-6,
};

export const PLAY_VAULT_STELLE = 300_000_000 as const;
export const HARD_CAP_STELLE = 1_000_000_000 as const;
