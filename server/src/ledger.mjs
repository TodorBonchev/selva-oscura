import { STARTING_EMIT_P, DEFAULT_EMIT_CAPS, PLAY_VAULT_STELLE, ASH_PER_STELLE } from "../vendor/constants.mjs";
import { loadEmitRates } from "./content.mjs";

const rates = loadEmitRates();
const pByEvent = rates.p_by_event || STARTING_EMIT_P;
const caps = rates.caps || DEFAULT_EMIT_CAPS;

/** In-memory Phase 1 custody. Devnet vault remains spec-only for Slice 1. */
export const vault = {
  remainingStelle: PLAY_VAULT_STELLE,
  remainingAsh: PLAY_VAULT_STELLE * ASH_PER_STELLE,
};

const players = new Map(); // id -> ledger row
const globalBossHour = { key: "", count: 0 };
const emitLog = [];

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function utcHour() {
  return new Date().toISOString().slice(0, 13);
}

export function getOrCreatePlayer(id, name) {
  let p = players.get(id);
  if (!p) {
    p = {
      id,
      name: name || `Wanderer-${id.slice(0, 4)}`,
      ash: 25_000, // starter Ash for AH testing (off-chain ledger)
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
  } else if (name) {
    p.name = name;
  }
  return p;
}

export function snapshotPlayer(p, pos) {
  return {
    id: p.id,
    name: p.name,
    x: pos.x,
    y: pos.y,
    hp: pos.hp,
    maxHp: pos.maxHp,
    cantoId: pos.cantoId,
    ash: p.ash,
    pendingAsh: p.pendingAsh,
    inventory: p.inventory,
    firstClears: [...p.firstClears],
    dailyQuestDoneUtc: p.dailyQuestDoneUtc,
    visitedInferno: p.visitedInferno,
    spokeToGuide: p.spokeToGuide,
  };
}

/**
 * Compute pending Ash grant from event type + remaining vault.
 * Server never chooses an arbitrary amount — formula matches locked brief.
 * On-chain Devnet vault is stubbed: we credit pendingAsh locally and log.
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

  // payout Stelle = R * p; then convert to integer Ash
  const payoutStelle = vault.remainingStelle * pRate;
  let payoutAsh = Math.max(1, Math.floor(payoutStelle * ASH_PER_STELLE));
  // Clamp to remaining
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
    chain: "pending_local_stub", // Devnet vault PDA not wired yet
  };
  emitLog.push(entry);

  return { ok: true, payoutAsh, remainingAsh: vault.remainingAsh, entry };
}

export function getEmitLog() {
  return emitLog.slice(-50);
}

export function creditAsh(playerId, amount) {
  const p = players.get(playerId);
  if (!p || !Number.isInteger(amount) || amount <= 0) return false;
  p.ash += amount;
  return true;
}

export function debitAsh(playerId, amount) {
  const p = players.get(playerId);
  if (!p || !Number.isInteger(amount) || amount <= 0) return false;
  if (p.ash < amount) return false;
  p.ash -= amount;
  return true;
}

export { players };
