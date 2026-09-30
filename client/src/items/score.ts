/**
 * One comparable number per item ("gear score") so the bag can be sorted and the
 * best piece per paper-doll slot auto-equipped.
 *
 * Built only from the combat bonuses the server actually applies (itemStatBonus, which
 * mirrors server/src/loot.mjs): +dmg, +max HP, +armor. Weights normalise each stat to
 * roughly the value of +1 dmg, measured against the server's combat numbers:
 *  - dmg:   base hit is 22 → +1 dmg ≈ +4.5 % damage                     → weight 10
 *  - HP:    base max HP is 130 → +1 HP ≈ +0.8 % effective HP             → weight 2
 *  - armor: mitigation a/(a+30); at typical 5–15 armor +1 ≈ +2.5 % EHP   → weight 5
 * Unwearable items (misc / trinkets) score 0 — they only matter as Ash or AH stock.
 * Weighed (soulbound) items carry no combat penalty in this game, so they are not
 * docked; they only win ties when picking what to wear (a tradeable twin is worth more
 * on the Auction House). Any future negative stat lowers the score through the weights.
 */

import { contentSlotToEquip, type EquipSlot } from "./icons";
import { inferContentSlot, itemStatBonus } from "./stats";

export const SCORE_WEIGHTS = { dmg: 10, maxHp: 2, armor: 5 } as const;

type ScoreItem = {
  id?: string;
  name?: string;
  rarity?: string;
  slot?: string | null;
  baseId?: string | null;
  affixes?: string[];
  soulbound?: boolean;
  equipSlot?: string | null;
};

/** Paper-doll slot an item can go into — exactly the server's equip rule (content slot). */
export function wearSlotFor(item: ScoreItem): EquipSlot | null {
  return contentSlotToEquip(inferContentSlot(item));
}

export function itemScore(item: ScoreItem | null | undefined): number {
  if (!item || !wearSlotFor(item)) return 0;
  const s = itemStatBonus(item);
  return Math.round(
    s.dmg * SCORE_WEIGHTS.dmg + s.maxHp * SCORE_WEIGHTS.maxHp + s.armor * SCORE_WEIGHTS.armor
  );
}

const RARITY_RANK: Record<string, number> = {
  canto_unique: 6,
  unique: 5,
  set: 4,
  rare: 3,
  magic: 2,
  normal: 1,
};
export function rarityRank(r: string | undefined): number {
  return RARITY_RANK[String(r || "normal")] ?? 1;
}

/** Deterministic score order: score ↓, rarity ↓, weighed first, name, id. */
export function compareByScore(a: ScoreItem, b: ScoreItem): number {
  return (
    itemScore(b) - itemScore(a) ||
    rarityRank(b?.rarity) - rarityRank(a?.rarity) ||
    Number(Boolean(b?.soulbound)) - Number(Boolean(a?.soulbound)) ||
    String(a?.name || "").localeCompare(String(b?.name || "")) ||
    String(a?.id || "").localeCompare(String(b?.id || ""))
  );
}

export type EquipPlan = { slot: EquipSlot; item: any; from: any | null; gain: number };

/**
 * Best bag item per slot that strictly beats what is worn (or fills an empty slot).
 * The game has one item per slot (no rings / two-handers / level or class gates), so
 * each slot is independent. Equal scores never swap.
 */
export function planEquipBest(bag: any[], equipped: Record<string, any>): EquipPlan[] {
  const best = new Map<EquipSlot, any>();
  for (const it of bag || []) {
    if (!it || it.equipSlot) continue;
    const slot = wearSlotFor(it);
    if (!slot) continue;
    const cur = best.get(slot);
    if (!cur || compareByScore(it, cur) < 0) best.set(slot, it);
  }
  const out: EquipPlan[] = [];
  for (const [slot, it] of best) {
    const worn = equipped?.[slot] || null;
    const gain = itemScore(it) - itemScore(worn);
    if (!worn || gain > 0) out.push({ slot, item: it, from: worn, gain });
  }
  return out;
}

/** "+12" / "−5" / "±0" versus what is worn in the item's slot (null if unwearable). */
export function scoreDelta(item: any, equipped: Record<string, any>): number | null {
  const slot = wearSlotFor(item);
  if (!slot) return null;
  const worn = equipped?.[slot];
  if (worn && worn.id === item.id) return null;
  return itemScore(item) - itemScore(worn);
}

export function formatDelta(d: number): string {
  if (d > 0) return `+${d}`;
  if (d < 0) return `\u2212${Math.abs(d)}`;
  return "\u00b10";
}
