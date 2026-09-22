import { loadDropTable, loadPool, loadAffixPools } from "./content.mjs";
import { mulberry32, pickWeighted, randInt, newSeed } from "./rng.mjs";

const affixes = loadAffixPools();

const BASE_FALLBACK = [
  { name: "Bone Shard", slot: "misc", baseId: "bone_shard" },
  { name: "Ashen Club", slot: "weapon", baseId: "ashen_club" },
  { name: "Torn Cape", slot: "armor", baseId: "torn_cape" },
  { name: "Rusty Buckler", slot: "offhand", baseId: "rusty_buckler" },
  { name: "Pilgrim Boots", slot: "boots", baseId: "pilgrim_boots" },
  { name: "Ash Helm", slot: "helm", baseId: "ash_helm" },
  { name: "Grave Gloves", slot: "gloves", baseId: "grave_gloves" },
];

/** Content slot → paper-doll equip slot. */
export function contentSlotToEquip(slot) {
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

const BASE_CONTENT_SLOT = {
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
  ashen_signet: "misc",
  wisp_filament: "misc",
};

/**
 * Content slot for an item, tolerating pre-migration rows with no `slot`:
 * falls back to baseId, then to name keywords (mirrors client resolveBaseId).
 */
export function inferContentSlot(item) {
  if (!item) return null;
  if (item.slot) return String(item.slot).toLowerCase();
  if (item.baseId && BASE_CONTENT_SLOT[item.baseId]) return BASE_CONTENT_SLOT[item.baseId];
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

function slugBase(name) {
  return String(name || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

function poolItems(poolId) {
  const pool = loadPool(poolId);
  if (pool?.items?.length) return pool.items;
  return BASE_FALLBACK;
}

function nameFor(rarity, baseName, rng) {
  if (rarity === "normal") return baseName;
  if (rarity === "magic") {
    const pre = affixes.magic_prefixes[randInt(rng, 0, affixes.magic_prefixes.length - 1)];
    const suf = affixes.magic_suffixes[randInt(rng, 0, affixes.magic_suffixes.length - 1)];
    return `${pre} ${baseName} ${suf}`;
  }
  if (rarity === "rare") {
    const a = affixes.rare_affixes[randInt(rng, 0, affixes.rare_affixes.length - 1)];
    return `${baseName} [${a}]`;
  }
  if (rarity === "set") {
    const set = affixes.set_names[randInt(rng, 0, affixes.set_names.length - 1)];
    return `${set}: ${baseName}`;
  }
  if (rarity === "unique") {
    return affixes.unique_names[randInt(rng, 0, affixes.unique_names.length - 1)];
  }
  if (rarity === "canto_unique") {
    return affixes.canto_unique_names[randInt(rng, 0, affixes.canto_unique_names.length - 1)];
  }
  return baseName;
}

function rollAffixes(rarity, rng) {
  if (rarity === "magic") {
    return [affixes.magic_prefixes[randInt(rng, 0, affixes.magic_prefixes.length - 1)]];
  }
  if (rarity === "rare") {
    const n = randInt(rng, 2, 4);
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(affixes.rare_affixes[randInt(rng, 0, affixes.rare_affixes.length - 1)]);
    }
    return out;
  }
  if (rarity === "set" || rarity === "unique" || rarity === "canto_unique") {
    return ["fixed_legendary"];
  }
  return [];
}

/** Flat stat bonuses from a base + rarity. */
export function itemStatBonus(item) {
  const rarityMul =
    item.rarity === "canto_unique"
      ? 3
      : item.rarity === "unique"
        ? 2.5
        : item.rarity === "set"
          ? 2.2
          : item.rarity === "rare"
            ? 1.8
            : item.rarity === "magic"
              ? 1.35
              : 1;
  const slot = inferContentSlot(item) || "";
  const out = { dmg: 0, maxHp: 0, armor: 0 };
  if (slot === "weapon") out.dmg += Math.round(6 * rarityMul);
  else if (slot === "offhand") out.armor += Math.round(3 * rarityMul);
  else if (slot === "armor") {
    out.armor += Math.round(4 * rarityMul);
    out.maxHp += Math.round(8 * rarityMul);
  } else if (slot === "helm") out.maxHp += Math.round(10 * rarityMul);
  else if (slot === "boots") out.armor += Math.round(2 * rarityMul);
  else if (slot === "gloves") out.dmg += Math.round(3 * rarityMul);
  // affix fluff: +1 dmg per rare affix-ish
  if (Array.isArray(item.affixes) && item.affixes.length) {
    out.dmg += Math.min(4, item.affixes.length);
  }
  return out;
}

let itemSeq = 0;

function makeItem(rarity, itemPool, soulbound, seed) {
  const rng = mulberry32(seed);
  const bases = poolItems(
    itemPool.includes("affix") ||
      itemPool.includes("set") ||
      itemPool.includes("unique") ||
      itemPool.includes("season")
      ? "inferno_bases_t1"
      : itemPool
  );
  const base = bases[randInt(rng, 0, bases.length - 1)];
  itemSeq += 1;
  const slot = base.slot || "misc";
  const baseId = base.baseId || slugBase(base.name);
  return {
    id: `item_${Date.now().toString(36)}_${itemSeq}`,
    name: nameFor(rarity, base.name, rng),
    rarity,
    itemPool,
    seed,
    affixes: rollAffixes(rarity, rng),
    soulbound: Boolean(soulbound),
    qty: 1,
    baseId,
    slot,
    equipSlot: null,
  };
}

function rollOnce(table, rng, { champion = false, boss = false } = {}) {
  const items = [];
  const rolls = table.rolls + (champion ? table.champion_bonus_rolls || 0 : 0);
  for (let i = 0; i < rolls; i++) {
    const noDrop = table.no_drop_weight || 0;
    const weighted = [
      { weight: noDrop, _nodrop: true },
      ...table.entries.map((e) => ({ ...e, _nodrop: false })),
    ];
    const pick = pickWeighted(rng, weighted);
    if (pick._nodrop) continue;
    items.push(makeItem(pick.rarity, pick.item_pool, pick.soulbound, newSeed()));
  }
  if (boss && Array.isArray(table.boss_guaranteed)) {
    for (const g of table.boss_guaranteed) {
      items.push(makeItem(g.rarity, g.item_pool, g.soulbound, newSeed()));
    }
  }
  return items;
}


/** Fixed normal starter gear for empty bags (Slice 1 equip path). */
export function makeStarterKitItems() {
  const mk = (name, baseId, slot) => {
    itemSeq += 1;
    return {
      id: `item_${Date.now().toString(36)}_${itemSeq}`,
      name,
      rarity: "normal",
      itemPool: "inferno_bases_t1",
      seed: newSeed(),
      affixes: [],
      soulbound: true,
      qty: 1,
      baseId,
      slot,
      equipSlot: null,
    };
  };
  return [mk("Ashen Club", "ashen_club", "weapon"), mk("Torn Cape", "torn_cape", "armor")];
}

export function rollDrops(dropTableId, opts = {}) {
  const table = loadDropTable(dropTableId);
  const rng = mulberry32(newSeed());
  return rollOnce(table, rng, opts);
}
