/** Doré-style item icons + equip slot mapping for Slice 1 drops. */

export const EQUIP_SLOTS = [
  "Head",
  "Chest",
  "Hands",
  "Feet",
  "MainHand",
  "OffHand",
] as const;

export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const ITEM_ICON_FILES: Record<string, string> = {
  ashen_club: "item_sword.png",
  torn_cape: "item_chest.png",
  ash_helm: "item_helm.png",
  pilgrim_boots: "item_boots.png",
  grave_gloves: "item_gloves.png",
  rusty_buckler: "item_gem.png",
  bone_shard: "item_gem.png",
  cinder_veil: "item_chest.png",
  road_pike: "item_sword.png",
  minos_band: "item_gem.png",
  storm_cowl: "item_helm.png",
  ashen_signet: "item_gem.png",
  // generic by equip slot
  MainHand: "item_sword.png",
  OffHand: "item_gem.png",
  Chest: "item_chest.png",
  Head: "item_helm.png",
  Feet: "item_boots.png",
  Hands: "item_gloves.png",
  misc: "item_gem.png",
};

/** Content drop slot → paper-doll equip slot (null = not wearable). */
export function contentSlotToEquip(slot: string | undefined | null): EquipSlot | null {
  switch (String(slot || "").toLowerCase()) {
    case "weapon":
      return "MainHand";
    case "armor":
    case "chest":
      return "Chest";
    case "helm":
    case "head":
      return "Head";
    case "boots":
    case "feet":
      return "Feet";
    case "gloves":
    case "hands":
      return "Hands";
    case "offhand":
    case "shield":
      return "OffHand";
    default:
      return null;
  }
}

export function resolveBaseId(it: {
  baseId?: string | null;
  name?: string;
  slot?: string | null;
}): string {
  if (it.baseId) return it.baseId;
  const n = String(it.name || "").toLowerCase();
  if (n.includes("pike") || n.includes("club") || n.includes("sword") || n.includes("blade")) return n.includes("pike") ? "road_pike" : "ashen_club";
  if (n.includes("veil") || n.includes("cinder")) return "cinder_veil";
  if (n.includes("cape") || n.includes("mail") || n.includes("armor")) return "torn_cape";
  if (n.includes("cowl")) return "storm_cowl";
  if (n.includes("helm") || n.includes("hood") || n.includes("crown")) return "ash_helm";
  if (n.includes("boot") || n.includes("greave")) return "pilgrim_boots";
  if (n.includes("glove") || n.includes("gauntlet")) return "grave_gloves";
  if (n.includes("buckler") || n.includes("shield")) return "rusty_buckler";
  if (n.includes("shard") || n.includes("gem") || n.includes("bone")) return "bone_shard";
  return "bone_shard";
}

export function resolveEquipSlot(it: {
  equipSlot?: string | null;
  slot?: string | null;
  name?: string;
  baseId?: string | null;
}): EquipSlot | null {
  if (it.equipSlot && (EQUIP_SLOTS as readonly string[]).includes(it.equipSlot)) {
    return it.equipSlot as EquipSlot;
  }
  const fromContent = contentSlotToEquip(it.slot);
  if (fromContent) return fromContent;
  const base = resolveBaseId(it);
  return contentSlotToEquip(
    base === "ashen_club"
      ? "weapon"
      : base === "torn_cape"
        ? "armor"
        : base === "ash_helm"
          ? "helm"
          : base === "pilgrim_boots"
            ? "boots"
            : base === "grave_gloves"
              ? "gloves"
              : base === "rusty_buckler"
                ? "offhand"
                : "misc"
  );
}

/** Append the build version so the immutable CDN cache never serves an old plate. */
export function assetUrl(path: string): string {
  const v = typeof __ASSET_VER__ !== "undefined" ? __ASSET_VER__ : "dev";
  return `${path}?v=${v}`;
}

export function itemIconUrl(it: {
  baseId?: string | null;
  name?: string;
  slot?: string | null;
  equipSlot?: string | null;
}): string {
  const base = resolveBaseId(it);
  const file =
    ITEM_ICON_FILES[base] ||
    ITEM_ICON_FILES[resolveEquipSlot(it) || ""] ||
    ITEM_ICON_FILES.misc;
  return assetUrl(`assets/items/${file}`);
}

export function itemIconKey(it: {
  baseId?: string | null;
  name?: string;
  slot?: string | null;
}): string {
  return `item_${resolveBaseId(it)}`;
}

export const SLOT_LABELS: Record<EquipSlot, string> = {
  Head: "Head",
  Chest: "Chest",
  Hands: "Hands",
  Feet: "Feet",
  MainHand: "Main",
  OffHand: "Off",
};
