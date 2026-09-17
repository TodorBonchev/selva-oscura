import { loadDropTable, loadPool, loadAffixPools } from "./content.mjs";
import { mulberry32, pickWeighted, randInt, newSeed } from "./rng.mjs";

const affixes = loadAffixPools();

const BASE_FALLBACK = [
  { name: "Bone Shard", slot: "misc" },
  { name: "Ashen Club", slot: "weapon" },
  { name: "Torn Cape", slot: "armor" },
];

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

let itemSeq = 0;

function makeItem(rarity, itemPool, soulbound, seed) {
  const rng = mulberry32(seed);
  const bases = poolItems(itemPool.includes("affix") || itemPool.includes("set") || itemPool.includes("unique") || itemPool.includes("season")
    ? "inferno_bases_t1"
    : itemPool);
  const base = bases[randInt(rng, 0, bases.length - 1)];
  itemSeq += 1;
  return {
    id: `item_${Date.now().toString(36)}_${itemSeq}`,
    name: nameFor(rarity, base.name, rng),
    rarity,
    itemPool,
    seed,
    affixes: rollAffixes(rarity, rng),
    soulbound: Boolean(soulbound),
    qty: 1,
  };
}

function rollOnce(table, rng, { champion = false, boss = false } = {}) {
  const items = [];
  const rolls = table.rolls + (champion ? (table.champion_bonus_rolls || 0) : 0);
  for (let i = 0; i < rolls; i++) {
    const noDrop = table.no_drop_weight || 0;
    const weighted = [
      { weight: noDrop, _nodrop: true },
      ...table.entries.map((e) => ({ ...e, _nodrop: false })),
    ];
    const pick = pickWeighted(rng, weighted);
    if (pick._nodrop) continue;
    items.push(
      makeItem(pick.rarity, pick.item_pool, pick.soulbound, newSeed())
    );
  }
  if (boss && Array.isArray(table.boss_guaranteed)) {
    for (const g of table.boss_guaranteed) {
      items.push(makeItem(g.rarity, g.item_pool, g.soulbound, newSeed()));
    }
  }
  return items;
}

export function rollDrops(dropTableId, opts = {}) {
  const table = loadDropTable(dropTableId);
  const rng = mulberry32(newSeed());
  return rollOnce(table, rng, opts);
}
