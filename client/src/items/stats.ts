/** Per-item gear bonuses — mirrors server/src/loot.mjs itemStatBonus. */

import { contentSlotToEquip, resolveBaseId, resolveEquipSlot, type EquipSlot } from "./icons";

export type ItemStats = { dmg: number; maxHp: number; armor: number };

const BASE_CONTENT_SLOT: Record<string, string> = {
  ashen_club: "weapon",
  torn_cape: "armor",
  ash_helm: "helm",
  pilgrim_boots: "boots",
  grave_gloves: "gloves",
  rusty_buckler: "offhand",
  bone_shard: "misc",
  cinder_veil: "armor",
  road_pike: "weapon",
  minos_band: "misc",
  storm_cowl: "helm",
};

/** Content slot for an item (weapon/armor/helm/…); mirrors server inferContentSlot. */
export function inferContentSlot(item: {
  slot?: string | null;
  baseId?: string | null;
  name?: string;
}): string | null {
  if (item.slot) return String(item.slot).toLowerCase();
  const base = item.baseId || resolveBaseId(item);
  if (base && BASE_CONTENT_SLOT[base]) return BASE_CONTENT_SLOT[base];
  const n = String(item.name || "").toLowerCase();
  if (n.includes("pike") || n.includes("club") || n.includes("sword") || n.includes("blade")) return "weapon";
  if (n.includes("veil")) return "armor";
  if (n.includes("cape") || n.includes("mail") || n.includes("armor")) return "armor";
  if (n.includes("cowl") || n.includes("helm") || n.includes("hood") || n.includes("crown")) return "helm";
  if (n.includes("boot") || n.includes("greave")) return "boots";
  if (n.includes("glove") || n.includes("gauntlet")) return "gloves";
  if (n.includes("buckler") || n.includes("shield")) return "offhand";
  return null;
}

/** Integer Ash paid when melting a bag item. Must match server/src/ledger.mjs vendorAsh. */
const VENDOR_ASH: Record<string, number> = {
  normal: 12,
  magic: 40,
  rare: 140,
  set: 400,
  unique: 900,
  canto_unique: 2500,
};

export function vendorAsh(item: { rarity?: string; qty?: number }): number {
  const base = VENDOR_ASH[String(item?.rarity || "normal")] ?? VENDOR_ASH.normal;
  const qty = Math.max(1, Number(item?.qty) || 1);
  return base * qty;
}

function rarityMul(rarity: string | undefined): number {
  switch (String(rarity || "normal")) {
    case "canto_unique":
      return 3;
    case "unique":
      return 2.5;
    case "set":
      return 2.2;
    case "rare":
      return 1.8;
    case "magic":
      return 1.35;
    default:
      return 1;
  }
}

/** Flat stat bonuses from a base + rarity (same rules as server itemStatBonus). */
export function itemStatBonus(item: {
  rarity?: string;
  slot?: string | null;
  baseId?: string | null;
  name?: string;
  affixes?: string[];
}): ItemStats {
  const mul = rarityMul(item.rarity);
  const slot = inferContentSlot(item) || "";
  const out: ItemStats = { dmg: 0, maxHp: 0, armor: 0 };
  if (slot === "weapon") out.dmg += Math.round(6 * mul);
  else if (slot === "offhand") out.armor += Math.round(3 * mul);
  else if (slot === "armor") {
    out.armor += Math.round(4 * mul);
    out.maxHp += Math.round(8 * mul);
  } else if (slot === "helm") out.maxHp += Math.round(10 * mul);
  else if (slot === "boots") out.armor += Math.round(2 * mul);
  else if (slot === "gloves") out.dmg += Math.round(3 * mul);
  if (Array.isArray(item.affixes) && item.affixes.length) {
    out.dmg += Math.min(4, item.affixes.length);
  }
  return out;
}

export function formatItemStats(s: ItemStats): string {
  const parts: string[] = [];
  if (s.dmg) parts.push(`+${s.dmg} dmg`);
  if (s.maxHp) parts.push(`+${s.maxHp} HP`);
  if (s.armor) parts.push(`+${s.armor} armor`);
  return parts.join(" · ");
}

/** HTML lines for detail panel (only non-zero). */
export function itemStatsHtml(s: ItemStats): string {
  const bits: string[] = [];
  if (s.dmg) bits.push(`<span class="stat-dmg">+${s.dmg} dmg</span>`);
  if (s.maxHp) bits.push(`<span class="stat-hp">+${s.maxHp} HP</span>`);
  if (s.armor) bits.push(`<span class="stat-armor">+${s.armor} armor</span>`);
  if (!bits.length) return `<span class="stat-none">No combat bonus</span>`;
  return bits.join("");
}

export function slotLabelForItem(item: {
  equipSlot?: string | null;
  slot?: string | null;
  baseId?: string | null;
  name?: string;
}): string {
  return resolveEquipSlot(item) || contentSlotToEquip(inferContentSlot(item)) || "junk";
}

export type { EquipSlot };
