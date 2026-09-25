import {
  STARTING_EMIT_P,
  DEFAULT_EMIT_CAPS,
  PLAY_VAULT_STELLE,
  ASH_PER_STELLE,
} from "../vendor/constants.mjs";
import { loadEmitRates } from "./content.mjs";
import { dbEnabled, query, withTransaction } from "./db.mjs";
import { contentSlotToEquip, inferContentSlot, itemStatBonus } from "./loot.mjs";

const rates = loadEmitRates();
const pByEvent = rates.p_by_event || STARTING_EMIT_P;
const caps = rates.caps || DEFAULT_EMIT_CAPS;

/** In-memory hot cache. Hydrated from Postgres when DATABASE_URL is set. */
export const vault = {
  remainingStelle: PLAY_VAULT_STELLE,
  remainingAsh: PLAY_VAULT_STELLE * ASH_PER_STELLE,
};

const players = new Map(); // id -> ledger row
const playersByName = new Map(); // lower(name) -> id
const globalBossHour = { key: "", count: 0 };
const emitLog = [];

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function utcHour() {
  return new Date().toISOString().slice(0, 13);
}

function indexName(p) {
  if (p?.name) playersByName.set(String(p.name).toLowerCase(), p.id);
}

function rowToPlayer(row, inventory = [], firstClears = []) {
  return {
    id: row.id,
    name: row.display_name || row.name,
    ash: Number(row.ash),
    pendingAsh: Number(row.pending_ash),
    inventory,
    stash: [],
    firstClears: new Set(firstClears),
    dailyQuestDoneUtc: row.daily_quest_done_utc,
    visitedInferno: Boolean(row.visited_inferno),
    spokeToGuide: Boolean(row.spoke_to_guide),
    bossHourKey: row.boss_hour_key || "",
    bossHourCount: Number(row.boss_hour_count) || 0,
    championHourKey: row.champion_hour_key || "",
    championHourCount: Number(row.champion_hour_count) || 0,
  };
}

function itemFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    rarity: row.rarity,
    itemPool: row.item_pool,
    seed: row.seed != null ? Number(row.seed) : null,
    affixes: Array.isArray(row.affixes) ? row.affixes : row.affixes || [],
    soulbound: Boolean(row.soulbound),
    qty: Number(row.qty) || 1,
    baseId: row.base_id || null,
    slot: row.slot || null,
    equipSlot: row.equipped_slot || null,
  };
}

export async function hydrateFromDb() {
  if (!dbEnabled()) return;

  const vaultRes = await query("SELECT * FROM vault_state WHERE id = 1");
  if (vaultRes.rowCount === 0) {
    await query(
      `INSERT INTO vault_state (id, remaining_ash, remaining_stelle)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [vault.remainingAsh, vault.remainingStelle]
    );
  } else {
    const v = vaultRes.rows[0];
    vault.remainingAsh = Number(v.remaining_ash);
    vault.remainingStelle = Number(v.remaining_stelle);
  }

  const capRes = await query(
    "SELECT * FROM emit_caps_global WHERE key = 'boss_hour'"
  );
  if (capRes.rowCount > 0) {
    globalBossHour.key = capRes.rows[0].period_key || "";
    globalBossHour.count = Number(capRes.rows[0].count) || 0;
  }

  const playerRows = await query("SELECT * FROM players");
  const invRows = await query(
    `SELECT * FROM inventory_items WHERE location IN ('inventory', 'stash', 'equipped')`
  );
  const fcRows = await query("SELECT * FROM first_clears");
  const emitRows = await query(
    `SELECT id, EXTRACT(EPOCH FROM t) * 1000 AS t_ms, player_id, event_type,
            payout_ash, remaining_ash, meta, chain
     FROM emit_log ORDER BY id DESC LIMIT 50`
  );

  const invByOwner = new Map();
  for (const row of invRows.rows) {
    const list = invByOwner.get(row.owner_id) || { inventory: [], stash: [] };
    const item = itemFromRow(row);
    if (row.location === "stash") list.stash.push(item);
    else {
      // equipped items stay in the inventory array with equipSlot set
      list.inventory.push(item);
    }
    invByOwner.set(row.owner_id, list);
  }

  const fcByOwner = new Map();
  for (const row of fcRows.rows) {
    const set = fcByOwner.get(row.player_id) || [];
    set.push(row.canto_id);
    fcByOwner.set(row.player_id, set);
  }

  players.clear();
  playersByName.clear();
  for (const row of playerRows.rows) {
    const bags = invByOwner.get(row.id) || { inventory: [], stash: [] };
    const p = rowToPlayer(row, bags.inventory, fcByOwner.get(row.id) || []);
    p.stash = bags.stash;
    players.set(p.id, p);
    indexName(p);
  }

  emitLog.length = 0;
  for (const row of emitRows.rows.reverse()) {
    emitLog.push({
      t: Number(row.t_ms),
      playerId: row.player_id,
      eventType: row.event_type,
      payoutAsh: Number(row.payout_ash),
      remainingAsh: Number(row.remaining_ash),
      meta: row.meta || {},
      chain: row.chain,
    });
  }

  console.log(
    `[db] hydrated ${players.size} players, vault remainingAsh=${vault.remainingAsh}`
  );
}

async function persistPlayerRow(p) {
  if (!dbEnabled()) return;
  await query(
    `INSERT INTO players (
       id, name, display_name, ash, pending_ash,
       daily_quest_done_utc, visited_inferno, spoke_to_guide,
       boss_hour_key, boss_hour_count, champion_hour_key, champion_hour_count
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       display_name = EXCLUDED.display_name,
       ash = EXCLUDED.ash,
       pending_ash = EXCLUDED.pending_ash,
       daily_quest_done_utc = EXCLUDED.daily_quest_done_utc,
       visited_inferno = EXCLUDED.visited_inferno,
       spoke_to_guide = EXCLUDED.spoke_to_guide,
       boss_hour_key = EXCLUDED.boss_hour_key,
       boss_hour_count = EXCLUDED.boss_hour_count,
       champion_hour_key = EXCLUDED.champion_hour_key,
       champion_hour_count = EXCLUDED.champion_hour_count,
       updated_at = NOW()`,
    [
      p.id,
      p.name,
      p.name,
      p.ash,
      p.pendingAsh,
      p.dailyQuestDoneUtc,
      p.visitedInferno,
      p.spokeToGuide,
      p.bossHourKey,
      p.bossHourCount,
      p.championHourKey,
      p.championHourCount,
    ]
  );
}

async function persistVault() {
  if (!dbEnabled()) return;
  await query(
    `INSERT INTO vault_state (id, remaining_ash, remaining_stelle)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET
       remaining_ash = EXCLUDED.remaining_ash,
       remaining_stelle = EXCLUDED.remaining_stelle,
       updated_at = NOW()`,
    [vault.remainingAsh, vault.remainingStelle]
  );
}

async function persistGlobalBossCap() {
  if (!dbEnabled()) return;
  await query(
    `INSERT INTO emit_caps_global (key, period_key, count)
     VALUES ('boss_hour', $1, $2)
     ON CONFLICT (key) DO UPDATE SET
       period_key = EXCLUDED.period_key,
       count = EXCLUDED.count,
       updated_at = NOW()`,
    [globalBossHour.key, globalBossHour.count]
  );
}

export async function persistItem(ownerId, item, location = "inventory") {
  if (!dbEnabled()) return;
  const loc = item.equipSlot ? "equipped" : location;
  await query(
    `INSERT INTO inventory_items (
       id, owner_id, location, name, rarity, item_pool, seed, affixes, soulbound, qty,
       equipped_slot, base_id, slot
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       owner_id = EXCLUDED.owner_id,
       location = EXCLUDED.location,
       name = EXCLUDED.name,
       rarity = EXCLUDED.rarity,
       item_pool = EXCLUDED.item_pool,
       seed = EXCLUDED.seed,
       affixes = EXCLUDED.affixes,
       soulbound = EXCLUDED.soulbound,
       qty = EXCLUDED.qty,
       equipped_slot = EXCLUDED.equipped_slot,
       base_id = EXCLUDED.base_id,
       slot = EXCLUDED.slot,
       updated_at = NOW()`,
    [
      item.id,
      ownerId,
      loc,
      item.name,
      item.rarity,
      item.itemPool ?? null,
      item.seed ?? null,
      JSON.stringify(item.affixes || []),
      Boolean(item.soulbound),
      item.qty ?? 1,
      item.equipSlot ?? null,
      item.baseId ?? null,
      item.slot ?? null,
    ]
  );
}

export async function removeItemRow(itemId) {
  if (!dbEnabled()) return;
  await query("DELETE FROM inventory_items WHERE id = $1", [itemId]);
}

/**
 * Resolve player for a WS session. Reconnecting by name restores the same
 * ledger row (ash / inventory / pending / caps) when possible.
 * @returns {{ player: object, restored: boolean }}
 */
export async function resolvePlayerForSession(sessionId, name) {
  const display = (name || `Wanderer-${sessionId.slice(0, 4)}`).slice(0, 24);
  const key = display.toLowerCase();

  const existingId = playersByName.get(key);
  if (existingId) {
    const p = players.get(existingId);
    if (p) {
      p.name = display;
      indexName(p);
      await persistPlayerRow(p);
      return { player: p, restored: true };
    }
  }

  // Create new character bound to this session id
  const p = {
    id: sessionId,
    name: display,
    ash: 25_000,
    pendingAsh: 0,
    inventory: [],
    stash: [],
    firstClears: new Set(),
    dailyQuestDoneUtc: null,
    visitedInferno: false,
    spokeToGuide: false,
    bossHourKey: "",
    bossHourCount: 0,
    championHourKey: "",
    championHourCount: 0,
  };
  players.set(p.id, p);
  indexName(p);
  await persistPlayerRow(p);
  return { player: p, restored: false };
}

/** Sync helper for room code that already has a known id. */
export function getOrCreatePlayer(id, name) {
  let p = players.get(id);
  if (!p) {
    p = {
      id,
      name: name || `Wanderer-${id.slice(0, 4)}`,
      ash: 25_000,
      pendingAsh: 0,
      inventory: [],
      stash: [],
      firstClears: new Set(),
      dailyQuestDoneUtc: null,
      visitedInferno: false,
      spokeToGuide: false,
      bossHourKey: "",
      bossHourCount: 0,
      championHourKey: "",
      championHourCount: 0,
    };
    players.set(id, p);
    indexName(p);
    // Fire-and-forget create; hello path uses resolvePlayerForSession
    void persistPlayerRow(p).catch((err) =>
      console.error("[db] persist new player failed", err.message)
    );
  } else if (name) {
    const oldKey = String(p.name).toLowerCase();
    p.name = name;
    if (oldKey !== name.toLowerCase()) playersByName.delete(oldKey);
    indexName(p);
  }
  return p;
}

export const BAG_MAX = 40;
export const STASH_MAX = 60;

/**
 * Move one bag item into the Dark Wood stash (never worn gear).
 * Rolls back in memory if persistence fails.
 */
export async function stashItem(playerId, itemId) {
  const p = players.get(playerId);
  if (!p) return { ok: false, reason: "no_player" };
  const i = (p.inventory || []).findIndex((it) => String(it.id) === String(itemId));
  if (i < 0) return { ok: false, reason: "not_found" };
  const item = p.inventory[i];
  if (item.equipSlot) return { ok: false, reason: "worn" };
  if ((p.stash || []).length >= STASH_MAX) return { ok: false, reason: "stash_full" };
  p.inventory.splice(i, 1);
  p.stash = p.stash || [];
  p.stash.push(item);
  try {
    await persistItem(playerId, item, "stash");
  } catch (err) {
    p.stash.pop();
    p.inventory.splice(i, 0, item);
    throw err;
  }
  return { ok: true, item };
}

/** Move one stashed item back into the bag. */
export async function unstashItem(playerId, itemId) {
  const p = players.get(playerId);
  if (!p) return { ok: false, reason: "no_player" };
  const i = (p.stash || []).findIndex((it) => String(it.id) === String(itemId));
  if (i < 0) return { ok: false, reason: "not_found" };
  const bag = (p.inventory || []).filter((it) => !it.equipSlot).length;
  if (bag >= BAG_MAX) return { ok: false, reason: "bag_full" };
  const [item] = p.stash.splice(i, 1);
  p.inventory.push(item);
  try {
    await persistItem(playerId, item, "inventory");
  } catch (err) {
    p.inventory.pop();
    p.stash.splice(i, 0, item);
    throw err;
  }
  return { ok: true, item };
}

export function snapshotPlayer(p, pos) {
  const equipped = {};
  for (const it of p.inventory || []) {
    if (it.equipSlot) equipped[it.equipSlot] = it;
  }
  const bag = (p.inventory || []).filter((it) => !it.equipSlot);
  return {
    id: p.id,
    name: p.name,
    x: pos.x,
    y: pos.y,
    hp: pos.hp,
    maxHp: pos.maxHp,
    mana: pos.mana ?? 0,
    maxMana: pos.maxMana ?? 0,
    cantoId: pos.cantoId,
    ash: p.ash,
    pendingAsh: p.pendingAsh,
    inventory: bag,
    stash: p.stash || [],
    equipped,
    gearStats: computeGearStats(p),
    firstClears: [...p.firstClears],
    dailyQuestDoneUtc: p.dailyQuestDoneUtc,
    visitedInferno: p.visitedInferno,
    spokeToGuide: p.spokeToGuide,
  };
}

export async function persistPlayerFlags(playerId) {
  const p = players.get(playerId);
  if (!p) return;
  await persistPlayerRow(p);
}

export async function grantInventoryItem(playerId, item) {
  const p = players.get(playerId);
  if (!p) return false;
  p.inventory.push(item);
  await persistItem(playerId, item, "inventory");
  return true;
}

/**
 * Compute pending Ash grant from event type + remaining vault.
 * Server never chooses an arbitrary amount — formula matches locked brief.
 */
export function tryEmit(playerId, eventType, meta = {}) {
  const p = players.get(playerId);
  if (!p) return { ok: false, reason: "no_player" };

  if (!["DailyQuest", "ChampionPack", "Boss", "FirstClear"].includes(eventType)) {
    return { ok: false, reason: "ineligible_event" };
  }

  const hour = utcHour();
  const day = utcDay();

  if (eventType === "DailyQuest") {
    if (p.dailyQuestDoneUtc === day) {
      return { ok: false, reason: "daily_cap" };
    }
  }

  if (eventType === "FirstClear") {
    const canto = meta.cantoId;
    if (!canto) return { ok: false, reason: "missing_canto" };
    if (p.firstClears.has(canto)) return { ok: false, reason: "already_cleared" };
  }

  if (eventType === "Boss") {
    if (p.bossHourKey !== hour) {
      p.bossHourKey = hour;
      p.bossHourCount = 0;
    }
    if (p.bossHourCount >= (caps.boss_per_player_hourly ?? 3)) {
      return { ok: false, reason: "boss_player_hourly_cap" };
    }
    if (globalBossHour.key !== hour) {
      globalBossHour.key = hour;
      globalBossHour.count = 0;
    }
    if (globalBossHour.count >= (caps.boss_global_hourly ?? 500)) {
      return { ok: false, reason: "boss_global_hourly_cap" };
    }
  }

  const pRate = pByEvent[eventType];
  if (typeof pRate !== "number") return { ok: false, reason: "no_p" };

  const payoutStelle = vault.remainingStelle * pRate;
  let payoutAsh = Math.max(1, Math.floor(payoutStelle * ASH_PER_STELLE));
  payoutAsh = Math.min(payoutAsh, vault.remainingAsh);

  vault.remainingAsh -= payoutAsh;
  vault.remainingStelle = vault.remainingAsh / ASH_PER_STELLE;
  p.pendingAsh += payoutAsh;

  if (eventType === "DailyQuest") p.dailyQuestDoneUtc = day;
  if (eventType === "FirstClear") p.firstClears.add(meta.cantoId);
  if (eventType === "Boss") {
    p.bossHourCount += 1;
    globalBossHour.count += 1;
  }

  const entry = {
    t: Date.now(),
    playerId,
    eventType,
    payoutAsh,
    remainingAsh: vault.remainingAsh,
    meta,
    chain: "pending_local_stub",
  };
  emitLog.push(entry);

  void persistEmitSuccess(p, eventType, meta, entry).catch((err) =>
    console.error("[db] persist emit failed", err.message)
  );

  return { ok: true, payoutAsh, remainingAsh: vault.remainingAsh, entry };
}

async function persistEmitSuccess(p, eventType, meta, entry) {
  if (!dbEnabled()) return;
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO players (
         id, name, display_name, ash, pending_ash,
         daily_quest_done_utc, visited_inferno, spoke_to_guide,
         boss_hour_key, boss_hour_count, champion_hour_key, champion_hour_count
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         ash = EXCLUDED.ash,
         pending_ash = EXCLUDED.pending_ash,
         daily_quest_done_utc = EXCLUDED.daily_quest_done_utc,
         boss_hour_key = EXCLUDED.boss_hour_key,
         boss_hour_count = EXCLUDED.boss_hour_count,
         updated_at = NOW()`,
      [
        p.id,
        p.name,
        p.name,
        p.ash,
        p.pendingAsh,
        p.dailyQuestDoneUtc,
        p.visitedInferno,
        p.spokeToGuide,
        p.bossHourKey,
        p.bossHourCount,
        p.championHourKey,
        p.championHourCount,
      ]
    );
    await client.query(
      `INSERT INTO vault_state (id, remaining_ash, remaining_stelle)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET
         remaining_ash = EXCLUDED.remaining_ash,
         remaining_stelle = EXCLUDED.remaining_stelle,
         updated_at = NOW()`,
      [vault.remainingAsh, vault.remainingStelle]
    );
    await client.query(
      `INSERT INTO emit_caps_global (key, period_key, count)
       VALUES ('boss_hour', $1, $2)
       ON CONFLICT (key) DO UPDATE SET
         period_key = EXCLUDED.period_key,
         count = EXCLUDED.count,
         updated_at = NOW()`,
      [globalBossHour.key, globalBossHour.count]
    );
    if (eventType === "FirstClear" && meta.cantoId) {
      await client.query(
        `INSERT INTO first_clears (player_id, canto_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [p.id, meta.cantoId]
      );
    }
    await client.query(
      `INSERT INTO emit_log (player_id, event_type, payout_ash, remaining_ash, meta, chain)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        entry.playerId,
        entry.eventType,
        entry.payoutAsh,
        entry.remainingAsh,
        JSON.stringify(entry.meta || {}),
        entry.chain,
      ]
    );
  });
}

export function getEmitLog() {
  return emitLog.slice(-50);
}

/** Bag vendor prices in integer Ash. Equipped gear is never included. */
const VENDOR_ASH = {
  normal: 12,
  magic: 40,
  rare: 140,
  set: 400,
  unique: 900,
  canto_unique: 2500,
};

export function vendorAsh(item) {
  const base = VENDOR_ASH[String(item?.rarity || "normal")] ?? VENDOR_ASH.normal;
  const qty = Math.max(1, Number(item?.qty) || 1);
  return base * qty;
}

/**
 * Melt every bag item (not worn gear) into Ash and delete the rows.
 * @returns {Promise<{ ok: boolean, reason?: string, count?: number, ash?: number }>}
 */
export async function salvageBag(playerId) {
  const p = players.get(playerId);
  if (!p) return { ok: false, reason: "no_player" };
  const sold = [];
  const keep = [];
  let ash = 0;
  for (const it of p.inventory || []) {
    if (it.equipSlot) keep.push(it);
    else {
      sold.push(it);
      ash += vendorAsh(it);
    }
  }
  if (!sold.length) return { ok: false, reason: "empty" };
  const prevInv = p.inventory;
  const prevAsh = p.ash;
  p.inventory = keep;
  p.ash += ash;
  try {
    await persistPlayerRow(p);
    for (const it of sold) await removeItemRow(it.id);
  } catch (err) {
    p.inventory = prevInv;
    p.ash = prevAsh;
    throw err;
  }
  return { ok: true, count: sold.length, ash };
}

export function creditAsh(playerId, amount) {
  const p = players.get(playerId);
  if (!p || !Number.isInteger(amount) || amount <= 0) return false;
  p.ash += amount;
  void persistPlayerRow(p).catch((err) =>
    console.error("[db] persist creditAsh failed", err.message)
  );
  return true;
}

export function debitAsh(playerId, amount) {
  const p = players.get(playerId);
  if (!p || !Number.isInteger(amount) || amount <= 0) return false;
  if (p.ash < amount) return false;
  p.ash -= amount;
  void persistPlayerRow(p).catch((err) =>
    console.error("[db] persist debitAsh failed", err.message)
  );
  return true;
}

/** Awaited ash write for transactional AH paths. */
export async function persistAshNow(playerId) {
  const p = players.get(playerId);
  if (!p) return;
  await persistPlayerRow(p);
}

export { players, playersByName, persistPlayerRow, persistVault, persistGlobalBossCap };


export function computeGearStats(p) {
  const stats = { dmg: 0, maxHp: 0, armor: 0 };
  for (const it of p.inventory || []) {
    if (!it.equipSlot) continue;
    const b = itemStatBonus(it);
    stats.dmg += b.dmg;
    stats.maxHp += b.maxHp;
    stats.armor += b.armor;
  }
  return stats;
}

export async function equipItem(playerId, itemId) {
  const p = players.get(playerId);
  if (!p) return { ok: false, reason: "no_player" };
  const item = p.inventory.find((i) => String(i.id) === String(itemId));
  if (!item) return { ok: false, reason: "not_found" };
  // Older rows may lack `slot`; infer from baseId / name.
  const slot = contentSlotToEquip(inferContentSlot(item));
  if (!slot) return { ok: false, reason: "not_equippable" };
  // Unequip existing in that slot
  for (const other of p.inventory) {
    if (other.equipSlot === slot && other.id !== item.id) {
      other.equipSlot = null;
      await persistItem(playerId, other, "inventory");
    }
  }
  item.equipSlot = slot;
  await persistItem(playerId, item, "equipped");
  return { ok: true, item, slot, gearStats: computeGearStats(p) };
}

export async function unequipItem(playerId, itemId) {
  const p = players.get(playerId);
  if (!p) return { ok: false, reason: "no_player" };
  const item = p.inventory.find((i) => String(i.id) === String(itemId));
  if (!item) return { ok: false, reason: "not_found" };
  if (!item.equipSlot) return { ok: false, reason: "not_equipped" };
  item.equipSlot = null;
  await persistItem(playerId, item, "inventory");
  return { ok: true, item, gearStats: computeGearStats(p) };
}

export async function unequipSlot(playerId, slot) {
  const p = players.get(playerId);
  if (!p) return { ok: false, reason: "no_player" };
  const item = p.inventory.find((i) => i.equipSlot === slot);
  if (!item) return { ok: false, reason: "empty_slot" };
  return unequipItem(playerId, item.id);
}

