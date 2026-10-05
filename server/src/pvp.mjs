/**
 * Consensual PvP — arena free-for-all, Dark Wood duels, ranked 1v1.
 * Player→player damage is impossible unless pvpCanHit says so.
 * Throws are logged; none of this may kill the room tick.
 */
import crypto from "node:crypto";
import { challengesOnArenaKill, challengesOnDuelWin, challengesOnRoundWin } from "./challenges.mjs";
import { players } from "./ledger.mjs";
import { dbEnabled, query } from "./db.mjs";
import { PLAYER_MAX_MANA } from "./spells.mjs";
import { wrapDelta } from "./wrap.mjs";
import {
  applyPlayerStats,
  getLevel,
  grantXp,
  playerCombatStats,
  pvpXpAllowed,
} from "./progression.mjs";
import {
  applyLifesteal,
  bastionDr,
  meleeDmgMult,
  resetLastStandLife,
  thornsPct,
  tryLastStand,
  warCryMult,
  weakenMult,
} from "./skills.mjs";

/** Melee / spell scale. Tuned so equal starter melee TTK sits in 4–7s and a
 * best-in-slot attacker needs ≥2.5s of light swings to down a starter. */
export const PVP_SCALE = 0.42;
export const PVP_ARMOR_K = 60;
const CAP_MELEE = 0.16;
const CAP_HEAVY = 0.22;
const DMG_FLOOR = 2;

/** Keep in step with room.mjs (the PvE swing). */
const PLAYER_BASE_DMG = 22;
const PLAYER_MAX_HP = 130;
const FINISHER_MULT = 1.3;
const PLAYER_ATK_CD = 0.42;
const COMBO_CHAIN_MS = 900;
const ATTACK_RANGE = 3.5;
const WIND_LIGHT_MS = 120;
const WIND_HEAVY_MS = 300;

const RESPAWN_MS = 3000;
const INVULN_MS = 2500;
const DUEL_DOWN_MS = 1500;
const DUEL_COUNTDOWN_MS = 3000;
const DUEL_FIGHT_MS = 90_000;
const DUEL_RING_R = 9;
const DUEL_RING_SLACK = 0.5;
const DUEL_OUT_MS = 1500;
const CHALLENGE_RANGE = 8;
const CHALLENGE_CD_MS = 4000;
const DECLINE_LOCK_MS = 30_000;
const INVITE_MS = 15_000;
const AFK_ARENA_MS = 90_000;
const AFK_DUEL_MS = 25_000;
const FARM_WINDOW_MS = 120_000;
const FARM_CAP = 3;
const RATING_FLOOR = 100;
const RATING_START = 1200;
const K_RANKED = 32;
const K_HUB = 20;
const PAIR_WINDOW_MS = 24 * 60 * 60 * 1000;
const RANKED_RING = { x: 48, y: 26, r: 9 };

const CAP_BY_KIND = {
  melee: CAP_MELEE,
  finisher: CAP_HEAVY,
  gale_bolt: CAP_HEAVY,
  infernal_burst: CAP_HEAVY,
  dash: CAP_HEAVY,
  furious_cleave: CAP_MELEE,
  wrath_charge: CAP_HEAVY,
  earthsplitter: 0.12,
  lance_of_light: CAP_HEAVY,
  pillar_of_flame: CAP_HEAVY,
  pillar_burn: 0.05,
  halo: 0.05,
  tempest: 0.06,
  snare_glyph: CAP_MELEE,
  summon_shade: 0.12,
  thorns: 0.08,
};

/** @type {Map<string, object>} */
const mem = new Map();
/** @type {Map<string, Promise<void>>} */
const tails = new Map();
/** challenger|target → lockout epoch ms */
const declineLock = new Map();
/** killer|victim → { times:number[], told:boolean } */
const farm = new Map();
/** sortedPair → epoch ms[] of rated matches */
const pairHist = new Map();

function safe(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[pvp] ${label}`, err?.message || err);
    return undefined;
  }
}

export function roundSeconds() {
  if (process.env.NODE_ENV !== "production" && process.env.SELVA_PVP_ROUND_SEC) {
    const n = Number(process.env.SELVA_PVP_ROUND_SEC);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 180;
}

function blankStats() {
  return {
    rating: RATING_START,
    peak: RATING_START,
    wins: 0,
    losses: 0,
    draws: 0,
    kills: 0,
    deaths: 0,
    bestStreak: 0,
    roundsWon: 0,
    title: null,
    streak: 0,
    roundKills: 0,
    name: null,
  };
}

function ensureStats(id) {
  let s = mem.get(id);
  if (!s) {
    s = blankStats();
    mem.set(id, s);
  }
  const n = players.get(id)?.name;
  if (n) s.name = n;
  return s;
}

function nameOf(id) {
  return players.get(id)?.name || mem.get(id)?.name || "Wanderer";
}

export function computeTitle(s) {
  if (!s) return null;
  if ((s.peak || 0) >= 1500) return "Giant";
  if ((s.roundsWon || 0) >= 3) return "Champion";
  if ((s.bestStreak || 0) >= 5) return "Fury";
  if ((s.wins || 0) >= 5) return "Duelist";
  if ((s.wins || 0) + (s.losses || 0) + (s.draws || 0) + (s.kills || 0) + (s.deaths || 0) > 0) {
    return "Wounded";
  }
  return null;
}

function refreshTitle(s) {
  s.title = computeTitle(s);
  return s.title;
}

/**
 * Gear-aware hit. `raw` is the PvE-equivalent roll (base + attacker gear + swing).
 * Armor uses diminishing returns; a cap stops one-shots; nothing lands under 2.
 */
export function pvpDamage(raw, ctx = {}) {
  const scaled = Math.max(0, Number(raw) || 0) * PVP_SCALE;
  const armor = Math.max(0, Number(ctx.targetGear?.armor) || 0);
  let taken = scaled * (PVP_ARMOR_K / (PVP_ARMOR_K + armor));
  const la = Number(ctx.levelAtk);
  const ld = Number(ctx.levelDef);
  if (Number.isFinite(la) && Number.isFinite(ld)) {
    taken *= Math.max(0.88, Math.min(1.12, 1 + 0.01 * (la - ld)));
  }
  const maxHp = Math.max(1, Number(ctx.targetMaxHp) || 1);
  const pct = CAP_BY_KIND[ctx.kind] ?? CAP_MELEE;
  taken = Math.min(taken, maxHp * pct);
  return Math.max(DMG_FLOOR, Math.round(taken));
}

function pvpState(room) {
  if (!room._pvp) {
    room._pvp = { duels: [], pending: [], queue: new Map() };
  }
  return room._pvp;
}

function wrapping(room) {
  return room?.canto?.geo?.wrap !== false;
}

function delta(room, a, b) {
  const dx = (b?.x || 0) - (a?.x || 0);
  const dy = (b?.y || 0) - (a?.y || 0);
  if (!wrapping(room)) return { x: dx, y: dy };
  const w = room.canto.geo.bounds.width;
  const h = room.canto.geo.bounds.height;
  return { x: wrapDelta(dx, w), y: wrapDelta(dy, h) };
}

function roomDist(room, a, b) {
  const d = delta(room, a, b);
  return Math.hypot(d.x, d.y);
}

function clampPos(room, x, y) {
  const b = room.canto.geo.bounds;
  if (!wrapping(room)) {
    return {
      x: Math.max(1, Math.min(Math.max(1, b.width - 1), x)),
      y: Math.max(1, Math.min(Math.max(1, b.height - 1), y)),
    };
  }
  const wx = ((x % b.width) + b.width) % b.width;
  const wy = ((y % b.height) + b.height) % b.height;
  return { x: wx, y: wy };
}

export function pvpIsDown(sess) {
  return !!(sess && sess.pvpDown);
}

export function pvpTouch(sess) {
  if (sess) sess.pvpLastInput = Date.now();
}

export function pvpBreakInvuln(sess) {
  if (sess) sess.pvpInvulnUntil = 0;
}

export function pvpOnJoin(room, sess) {
  safe("join", () => {
    if (!sess) return;
    if (!sess.pvpLastInput) sess.pvpLastInput = Date.now();
    ensureStats(sess.playerId);
    if (room?.canto?.role === "arena") ensureRound(room);
  });
}

function tooSoon(sess, key) {
  if (!sess) return true;
  const now = Date.now();
  return ((sess._pvpRl && sess._pvpRl[key]) || 0) > now;
}

function markRate(sess, key, ms) {
  if (!sess) return;
  if (!sess._pvpRl) sess._pvpRl = {};
  sess._pvpRl[key] = Date.now() + ms;
}

function duelOf(room, playerId) {
  const list = room?._pvp?.duels;
  if (!list || !playerId) return null;
  for (const d of list) {
    if (d._ended) continue;
    if (d.phase !== "countdown" && d.phase !== "fight") continue;
    if (d.a === playerId || d.b === playerId) return d;
  }
  return null;
}

function invulnerable(sess) {
  if (!sess) return true;
  if ((sess.iframes || 0) > 0) return true;
  if ((sess.pvpInvulnUntil || 0) > Date.now()) return true;
  return false;
}

/**
 * "ok" | "invuln" | "no". Invuln is a hit that would have landed but for iframes
 * or the respawn window — callers emit a dodge beat.
 */
function pvpGate(room, attacker, target) {
  if (!room || !attacker || !target) return "no";
  if (attacker.spectating || target.spectating) return "no";
  if (attacker === target || attacker.playerId === target.playerId) return "no";
  if (pvpIsDown(attacker) || pvpIsDown(target)) return "no";
  if (!(attacker.hp > 0) || !(target.hp > 0)) return "no";
  const duel = duelOf(room, attacker.playerId);
  if (duel && duel.phase === "fight" && (duel.a === target.playerId || duel.b === target.playerId)) {
    return invulnerable(target) ? "invuln" : "ok";
  }
  if (
    room.canto?.role === "arena" &&
    !duelOf(room, attacker.playerId) &&
    !duelOf(room, target.playerId)
  ) {
    // Short fight lock between FFA rounds while the round card is up.
    if ((room._pvp?.round?.startsAt || 0) > Date.now()) return "no";
    return invulnerable(target) ? "invuln" : "ok";
  }
  return "no";
}

export function pvpCanHit(room, attacker, target) {
  return pvpGate(room, attacker, target) === "ok";
}

/** True when A and B are currently legal PvP opponents (ignores iframes). */
export function pvpAreOpponents(room, a, b) {
  if (!room || !a || !b || a === b) return false;
  const duel = duelOf(room, a.playerId);
  if (duel && (duel.a === b.playerId || duel.b === b.playerId)) return duel.phase === "fight";
  if (room.canto?.role === "arena" && !duelOf(room, a.playerId) && !duelOf(room, b.playerId)) return true;
  return false;
}

export function pvpDuelBusy(room, playerId) {
  const d = duelOf(room, playerId);
  return !!(d && (d.phase === "countdown" || d.phase === "fight"));
}

function gearOf(id, armorBuff) {
  const st = playerCombatStats(id);
  return {
    dmg: st.gear?.dmg || 0,
    maxHp: st.gear?.maxHp || 0,
    armor: st.armor + (armorBuff || 0),
  };
}

function noteRecap(target, attacker, how, dmg) {
  const now = Date.now();
  if (!target._pvpHits) target._pvpHits = [];
  target._pvpHits.push({
    attackerId: attacker.playerId,
    attackerName: nameOf(attacker.playerId),
    how,
    dmg,
    t: now,
  });
  target._pvpHits = target._pvpHits.filter((h) => now - h.t <= 10_000);
}

function buildRecap(target) {
  const now = Date.now();
  const recent = (target._pvpHits || []).filter((h) => now - h.t <= 10_000);
  const map = new Map();
  for (const h of recent) {
    const k = `${h.attackerId}|${h.how}`;
    const cur = map.get(k) || { name: h.attackerName, how: h.how, dmg: 0, count: 0 };
    cur.dmg += h.dmg;
    cur.count += 1;
    map.set(k, cur);
  }
  const rows = [...map.values()].sort((a, b) => b.dmg - a.dmg || b.count - a.count);
  const total = rows.reduce((s, r) => s + r.dmg, 0);
  return { rows, total };
}

function sendHit(room, attacker, target, taken, soaked, kind) {
  room.broadcast({
    type: "combat",
    attackerId: attacker.playerId,
    targetId: target.playerId,
    targetIsPlayer: true,
    damage: taken,
    soaked,
    how: kind,
    targetHp: target.hp,
  });
  room.markDirty();
}

function applyPvpDamage(room, attacker, target, raw, kind) {
  const gate = pvpGate(room, attacker, target);
  if (gate === "invuln") {
    if (typeof room.dodgeBeat === "function") {
      room.dodgeBeat(target, { id: attacker.playerId }, { how: kind });
    }
    return 0;
  }
  if (gate !== "ok") return 0;
  let incoming = Math.max(0, Number(raw) || 0);
  if (kind !== "thorns") {
    incoming *= warCryMult(attacker);
    incoming *= weakenMult(attacker);
  }
  const ag = gearOf(attacker.playerId, 0);
  const tg = gearOf(target.playerId, target.armorBuff || 0);
  let taken = pvpDamage(incoming, {
    attackerGear: ag,
    targetGear: tg,
    targetMaxHp: target.maxHp,
    kind,
    levelAtk: getLevel(attacker.playerId),
    levelDef: getLevel(target.playerId),
  });
  const dr = bastionDr(target, true);
  if (dr > 0) taken = Math.max(1, Math.round(taken * (1 - dr)));
  const soaked = Math.max(0, Math.round(incoming) - taken);
  const lethal = target.hp - taken <= 0;
  if (lethal && tryLastStand(target, true)) {
    try {
      room.broadcast({
        type: "spell_fx",
        spellId: "last_stand",
        casterId: target.playerId,
        x: target.x,
        y: target.y,
        duration: 1,
      });
    } catch {
      /* closing */
    }
    sendHit(room, attacker, target, taken, soaked, kind);
    noteRecap(target, attacker, kind, taken);
    applyLifesteal(attacker, taken, true, room);
    return taken;
  }
  target.hp = Math.max(0, target.hp - taken);
  sendHit(room, attacker, target, taken, soaked, kind);
  noteRecap(target, attacker, kind, taken);
  applyLifesteal(attacker, taken, true, room);
  if (
    kind !== "thorns" &&
    (kind === "melee" ||
      kind === "finisher" ||
      kind === "furious_cleave" ||
      kind === "wrath_charge" ||
      kind === "earthsplitter")
  ) {
    const pct = thornsPct(target.playerId, true);
    if (pct > 0 && taken > 0 && attacker.hp > 1) {
      const refl = Math.max(1, Math.round(taken * pct));
      const leave = Math.max(1, attacker.hp - refl);
      const dealt = attacker.hp - leave;
      attacker.hp = leave;
      sendHit(room, target, attacker, dealt, 0, "thorns");
      noteRecap(attacker, target, "thorns", dealt);
    }
  }
  if (target.hp <= 0) downPlayer(room, target, attacker, kind);
  return taken;
}

export function pvpHit(room, attacker, target, raw, kind) {
  return safe("hit", () => applyPvpDamage(room, attacker, target, raw, kind)) || 0;
}

function downPlayer(room, victim, killer, how) {
  if (!victim || victim.pvpDown) return;
  victim.hp = 0;
  const duel = duelOf(room, victim.playerId);
  const respawnIn = duel ? DUEL_DOWN_MS : RESPAWN_MS;
  victim.pvpDown = {
    until: Date.now() + respawnIn,
    by: killer?.playerId || null,
    kx: killer?.x,
    ky: killer?.y,
  };
  const vStats = ensureStats(victim.playerId);
  const prevStreak = vStats.streak || 0;
  vStats.streak = 0;
  const recap = buildRecap(victim);
  try {
    room.send(victim.ws, {
      type: "pvp_down",
      killerId: killer?.playerId || null,
      killerName: killer ? nameOf(killer.playerId) : "",
      recap: recap.rows,
      total: recap.total,
      respawnIn,
    });
  } catch (err) {
    console.error("[pvp] down send", err.message);
  }
  room.markDirty();
  try {
    if (typeof room.cleanupPlayerSkills === "function") room.cleanupPlayerSkills(victim.playerId);
  } catch (err) {
    console.error("[pvp] skill cleanup", err.message);
  }
  if (duel && killer && (duel.a === victim.playerId || duel.b === victim.playerId)) {
    const winnerId = duel.a === victim.playerId ? duel.b : duel.a;
    endDuel(room, duel, { winnerId, reason: "down" });
    return;
  }
  onArenaKill(room, victim, killer, how, prevStreak);
  const victimId = victim.playerId;
  const killerId = killer?.playerId || null;
  room.schedule(RESPAWN_MS / 1000, () => {
    safe("respawn", () => arenaRespawn(room, victimId, killerId));
  });
}

function farmKey(killerId, victimId) {
  return `${killerId}|${victimId}`;
}

function creditAllowed(room, killer, victim) {
  const now = Date.now();
  const key = farmKey(killer.playerId, victim.playerId);
  const b = farm.get(key) || { times: [], told: false };
  b.times = b.times.filter((t) => now - t < FARM_WINDOW_MS);
  if (b.times.length >= FARM_CAP) {
    if (!b.told) {
      b.told = true;
      try {
        room.toast(killer.ws, "info", "No glory in the same shade twice.");
      } catch {
        /* closing */
      }
    }
    farm.set(key, b);
    return false;
  }
  b.times.push(now);
  b.told = false;
  farm.set(key, b);
  return true;
}

function streakAnnounce(streak, firstBlood, shutdown) {
  if (firstBlood) return "First Blood!";
  if (streak === 2) return "Double Kill!";
  if (streak === 3) return "Fury!";
  if (streak === 5) return "Pape Satàn aleppe!";
  if (streak === 8) return "Giant!";
  if (shutdown) return "Shut down!";
  return undefined;
}

function onArenaKill(room, victim, killer, how, prevStreak) {
  if (!killer || room.canto?.role !== "arena") return;
  const credited = creditAllowed(room, killer, victim);
  if (!credited) return;
  const round = ensureRound(room);
  const k = ensureStats(killer.playerId);
  const v = ensureStats(victim.playerId);
  k.kills += 1;
  k.streak = (k.streak || 0) + 1;
  k.roundKills = (k.roundKills || 0) + 1;
  if (k.streak > (k.bestStreak || 0)) k.bestStreak = k.streak;
  v.deaths += 1;
  // (a kill on a pilgrim sharing your connection or device never counts toward the daily)
  if (!linkedPair(room, killer.playerId, victim.playerId)) challengesOnArenaKill(room, killer.playerId, k.streak);
  refreshTitle(k);
  refreshTitle(v);
  const firstBlood = round && !round.firstBlood;
  if (round && firstBlood) round.firstBlood = true;
  const shutdown = prevStreak >= 3;
  const announce = streakAnnounce(k.streak, firstBlood, shutdown);
  const msg = {
    type: "pvp_kill",
    killerId: killer.playerId,
    killerName: nameOf(killer.playerId),
    victimId: victim.playerId,
    victimName: nameOf(victim.playerId),
    how,
    streak: k.streak,
  };
  if (announce) msg.announce = announce;
  if (firstBlood) msg.firstBlood = true;
  if (shutdown) msg.shutdown = true;
  room.broadcast(msg);
  persistPvp(killer.playerId);
  persistPvp(victim.playerId);
  if (pvpXpAllowed(killer.playerId, victim.playerId)) {
    grantXp(room, killer.playerId, 25, "pvp_arena", { skipPenalty: true });
  }
}

function spawnsOf(room) {
  const list = room?.canto?.geo?.pvp_spawns;
  return Array.isArray(list) ? list : [];
}

function pickSpawn(room, from) {
  const list = spawnsOf(room);
  if (!list.length) {
    const sp = room.canto.geo.spawn;
    return { x: sp.x, y: sp.y };
  }
  const fx = Number.isFinite(from?.x) ? from.x : room.canto.geo.spawn.x;
  const fy = Number.isFinite(from?.y) ? from.y : room.canto.geo.spawn.y;
  let bestD = -1;
  const scored = list.map((p, i) => {
    const d = Math.hypot(p.x - fx, p.y - fy);
    if (d > bestD) bestD = d;
    return { p, d, i };
  });
  const far = scored.filter((s) => s.d >= bestD - 0.01);
  return far[Math.floor(Math.random() * far.length)].p;
}

function arenaRespawn(room, victimId, killerId) {
  const s = room.sessions.get(victimId);
  if (!s || !s.pvpDown) return;
  if (room.canto?.role !== "arena") return;
  if (duelOf(room, victimId)) return;
  const from = {
    x: s.pvpDown.kx,
    y: s.pvpDown.ky,
  };
  if (!Number.isFinite(from.x)) {
    const killer = killerId && room.sessions.get(killerId);
    from.x = killer?.x ?? s.x;
    from.y = killer?.y ?? s.y;
  }
  const sp = pickSpawn(room, from);
  const pos = clampPos(room, sp.x, sp.y);
  s.x = pos.x;
  s.y = pos.y;
  s.hp = s.maxHp;
  s.mana = s.maxMana;
  s.pvpDown = null;
  s.status = null;
  s.pvpInvulnUntil = Date.now() + INVULN_MS;
  resetLastStandLife(s);
  room.markDirty();
  try {
    room.pushAllSnapshots();
  } catch {
    /* snapshot is best-effort */
  }
}

function prepareFighter(sess) {
  applyPlayerStats(sess, { refill: true });
  sess.maxMana = sess.maxMana || PLAYER_MAX_MANA;
  sess.mana = sess.maxMana;
  sess.pvpDown = null;
  sess.status = null;
  sess.iframes = 0;
  sess.pvpInvulnUntil = 0;
  resetLastStandLife(sess);
}

function publicDuel(d) {
  const o = {
    id: d.id,
    a: d.a,
    b: d.b,
    aName: d.aName,
    bName: d.bName,
    cx: Math.round(d.cx * 100) / 100,
    cy: Math.round(d.cy * 100) / 100,
    r: d.r,
    phase: d.phase,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    ranked: !!d.ranked,
  };
  if (d.winnerId) o.winnerId = d.winnerId;
  if (d.reason) o.reason = d.reason;
  if (d.ratingDelta) o.ratingDelta = d.ratingDelta;
  return o;
}

function broadcastDuel(room, duel) {
  room.broadcast({ type: "duel_state", duel: publicDuel(duel) });
  room.markDirty();
}

function expectedScore(ra, rb) {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Multiplier from PRIOR rated meetings in 24h, then records this one. */
function takePairMult(a, b) {
  const key = pairKey(a, b);
  const now = Date.now();
  const prev = (pairHist.get(key) || []).filter((t) => now - t < PAIR_WINDOW_MS);
  const table = [1, 0.5, 0.25, 0];
  const mult = table[Math.min(prev.length, table.length - 1)];
  prev.push(now);
  pairHist.set(key, prev);
  return mult;
}

/**
 * Soft anti-alt. The server hashes each socket's IP and the client's device id
 * (index.mjs ws._link). Rated duels between linked pilgrims earn diminishing rating:
 * same device ×0.25 → ×0.1 → 0, same IP only (households, campus, carrier NAT)
 * ×0.5 → ×0.25 → 0, within 24 h. Never a ban; unlinked fights are untouched.
 */
const LINK_TABLE = { dev: [0.25, 0.1, 0], ip: [0.5, 0.25, 0] };
const linkHist = new Map();

export function linkedPair(room, a, b) {
  const la = room?.sessions?.get(a)?.ws?._link;
  const lb = room?.sessions?.get(b)?.ws?._link;
  if (!la || !lb) return null;
  if (la.dev && la.dev === lb.dev) return "dev";
  if (la.ip && la.ip === lb.ip) return "ip";
  return null;
}

function takeLinkMult(a, b, kind) {
  const key = pairKey(a, b);
  const now = Date.now();
  const prev = (linkHist.get(key) || []).filter((t) => now - t < PAIR_WINDOW_MS);
  const table = LINK_TABLE[kind] || LINK_TABLE.ip;
  const mult = table[Math.min(prev.length, table.length - 1)];
  prev.push(now);
  linkHist.set(key, prev);
  return mult;
}

/** Arena spectator mode: unseen, cannot strike or be struck, out of rounds and queue. */
export function pvpSpectate(room, sess, on) {
  safe("spectate", () => {
    if (!room || !sess) return;
    if (tooSoon(sess, "spec")) return;
    markRate(sess, "spec", 600);
    if (room.canto?.role !== "arena") {
      sess.spectating = false;
      return;
    }
    if (on) {
      if (sess.spectating) return;
      if (duelOf(room, sess.playerId)) {
        room.toast(sess.ws, "warn", "Finish your duel first.");
        return;
      }
      if (pvpIsDown(sess)) return;
      pvpState(room).queue.delete(sess.playerId);
      sess.spectating = true;
      room.toast(sess.ws, "info", "Spectating: you are unseen and cannot strike or be struck.");
    } else {
      if (!sess.spectating) return;
      sess.spectating = false;
      sess.pvpInvulnUntil = Date.now() + INVULN_MS;
      sess.pvpLastInput = Date.now();
      room.toast(sess.ws, "info", "You step back into the pit.");
    }
    room.markDirty?.();
    room.pushSnapshot?.(sess.playerId);
  });
}

function applyRating(room, duel, winnerId, reason) {
  const a = ensureStats(duel.a);
  const b = ensureStats(duel.b);
  let mult = takePairMult(duel.a, duel.b);
  const link = linkedPair(room, duel.a, duel.b);
  if (link) {
    const lm = takeLinkMult(duel.a, duel.b, link);
    if (lm < mult) {
      mult = lm;
      duel.linked = link;
      const line =
        lm > 0
          ? "Rating change reduced: these pilgrims share a connection or device."
          : "Rating unchanged: these pilgrims share a connection or device.";
      for (const id of [duel.a, duel.b]) {
        const sx = room.sessions.get(id);
        if (sx) {
          try {
            room.toast(sx.ws, "info", line);
          } catch {
            /* gone */
          }
        }
      }
    }
  }
  const K = duel.ranked ? K_RANKED : K_HUB;
  let scoreA;
  let scoreB;
  if (reason === "draw" || !winnerId) {
    scoreA = 0.5;
    scoreB = 0.5;
    a.draws += 1;
    b.draws += 1;
  } else if (winnerId === duel.a) {
    scoreA = 1;
    scoreB = 0;
    a.wins += 1;
    b.losses += 1;
  } else {
    scoreA = 0;
    scoreB = 1;
    b.wins += 1;
    a.losses += 1;
  }
  let dA = 0;
  let dB = 0;
  // (a rival met too often today stops counting toward the daily too)
  if (winnerId && reason !== "draw" && mult > 0) challengesOnDuelWin(room, winnerId);
  if (mult <= 0) {
    duel.pairZeroed = true;
    const line = "Rating unchanged: you have met this rival too often today.";
    for (const id of [duel.a, duel.b]) {
      const s = room.sessions.get(id);
      if (s) {
        try {
          room.toast(s.ws, "info", line);
        } catch {
          /* gone */
        }
      }
    }
  } else {
    dA = Math.round(K * mult * (scoreA - expectedScore(a.rating, b.rating)));
    dB = Math.round(K * mult * (scoreB - expectedScore(b.rating, a.rating)));
    a.rating = Math.max(RATING_FLOOR, a.rating + dA);
    b.rating = Math.max(RATING_FLOOR, b.rating + dB);
    a.peak = Math.max(a.peak || 0, a.rating);
    b.peak = Math.max(b.peak || 0, b.rating);
  }
  refreshTitle(a);
  refreshTitle(b);
  persistPvp(duel.a);
  persistPvp(duel.b);
  return { [duel.a]: dA, [duel.b]: dB };
}

function endDuel(room, duel, { winnerId = null, reason }) {
  if (!duel || duel._ended) return;
  duel._ended = true;
  duel.phase = "over";
  duel.winnerId = winnerId || undefined;
  duel.reason = reason;
  duel.endsAt = Date.now();
  try {
    duel.ratingDelta = applyRating(room, duel, winnerId, reason);
  } catch (err) {
    console.error("[pvp] rating", err.message);
    duel.ratingDelta = { [duel.a]: 0, [duel.b]: 0 };
  }
  if (winnerId && !duel.pairZeroed) {
    const loserId = winnerId === duel.a ? duel.b : duel.a;
    const winXp = duel.ranked ? 60 : 40;
    const loseXp = duel.ranked ? 15 : 10;
    if (pvpXpAllowed(winnerId, loserId)) grantXp(room, winnerId, winXp, duel.ranked ? "pvp_ranked" : "pvp_duel", { skipPenalty: true });
    grantXp(room, loserId, loseXp, duel.ranked ? "pvp_ranked" : "pvp_duel", { skipPenalty: true });
  }
  broadcastDuel(room, duel);
  const loserId = !winnerId ? null : winnerId === duel.a ? duel.b : duel.a;
  if (reason !== "draw" && loserId) {
    const loser = room.sessions.get(loserId);
    if (loser && !loser.pvpDown) {
      loser.hp = 0;
      loser.pvpDown = { until: Date.now() + DUEL_DOWN_MS, by: winnerId, kx: loser.x, ky: loser.y };
    }
  }
  room.schedule(reason === "draw" ? 0 : DUEL_DOWN_MS / 1000, () => {
    safe("restore", () => restoreDuelists(room, duel));
  });
}

function restoreDuelists(room, duel) {
  const st = room._pvp;
  const newer = (st?.duels || []).some(
    (d) =>
      d !== duel &&
      !d._ended &&
      (d.a === duel.a || d.b === duel.a || d.a === duel.b || d.b === duel.b)
  );
  if (st?.duels) st.duels = st.duels.filter((d) => d !== duel);
  if (newer) return;
  const still = [duel.a, duel.b].map((id) => room.sessions.get(id)).filter(Boolean);
  let spots = null;
  if (duel.ranked && room.canto?.role === "arena" && still.length) {
    const sp1 = pickSpawn(room, { x: 1, y: 1 });
    let sp2 = pickSpawn(room, sp1);
    if (sp2.x === sp1.x && sp2.y === sp1.y) {
      sp2 = spawnsOf(room).find((p) => p.x !== sp1.x || p.y !== sp1.y) || sp1;
    }
    spots = { [duel.a]: sp1, [duel.b]: sp2 };
  }
  for (const s of still) {
    prepareFighter(s);
    s.iframes = Math.max(s.iframes || 0, 1);
    if (spots && spots[s.playerId]) {
      const p = clampPos(room, spots[s.playerId].x, spots[s.playerId].y);
      s.x = p.x;
      s.y = p.y;
    }
  }
  room.markDirty();
  try {
    room.pushAllSnapshots();
  } catch {
    /* best-effort */
  }
}

function startDuel(room, a, b, opts) {
  const ranked = !!opts.ranked;
  let cx;
  let cy;
  let r;
  if (ranked) {
    cx = opts.cx;
    cy = opts.cy;
    r = opts.r;
  } else {
    const mid = delta(room, a, b);
    const p = clampPos(room, a.x + mid.x / 2, a.y + mid.y / 2);
    cx = p.x;
    cy = p.y;
    r = DUEL_RING_R;
  }
  prepareFighter(a);
  prepareFighter(b);
  if (ranked) {
    const pa = clampPos(room, cx - 6, cy);
    const pb = clampPos(room, cx + 6, cy);
    a.x = pa.x;
    a.y = pa.y;
    b.x = pb.x;
    b.y = pb.y;
    a._lastFaceX = 1;
    a._lastFaceY = 0;
    b._lastFaceX = -1;
    b._lastFaceY = 0;
  }
  const now = Date.now();
  const duel = {
    id: crypto.randomUUID(),
    a: a.playerId,
    b: b.playerId,
    aName: nameOf(a.playerId),
    bName: nameOf(b.playerId),
    cx,
    cy,
    r,
    phase: "countdown",
    startsAt: now + DUEL_COUNTDOWN_MS,
    endsAt: now + DUEL_COUNTDOWN_MS + DUEL_FIGHT_MS,
    ranked,
    outSince: {},
    inputAt: {},
  };
  const st = pvpState(room);
  st.queue.delete(a.playerId);
  st.queue.delete(b.playerId);
  st.duels.push(duel);
  broadcastDuel(room, duel);
  try {
    room.pushAllSnapshots();
  } catch {
    /* best-effort */
  }
  return duel;
}

function meleeRaw(attacker, heavy) {
  const st = playerCombatStats(attacker.playerId);
  let raw = st.weaponDmg + Math.floor(Math.random() * 6);
  if (heavy) raw = Math.round(raw * FINISHER_MULT);
  raw *= meleeDmgMult(attacker.playerId, true);
  return Math.round(raw);
}

export function pvpMelee(room, attacker, target, combo) {
  safe("melee", () => {
    if (!attacker || !target) return;
    if (pvpGate(room, attacker, target) === "no" && !invulnerable(target)) {
      // Not a legal PvP pair (and not merely dodging): do not spend the swing.
      if (pvpGate(room, attacker, target) === "no") return;
    }
    const gateNow = pvpGate(room, attacker, target);
    if (gateNow === "no") return;
    const d0 = roomDist(room, attacker, target);
    if (d0 > ATTACK_RANGE) {
      const now = Date.now();
      if (!attacker._oorToastAt || now - attacker._oorToastAt > 2400) {
        attacker._oorToastAt = now;
        room.toast(attacker.ws, "info", "Too far.");
      }
      return;
    }
    const now = Date.now();
    attacker.atkCd = PLAYER_ATK_CD;
    attacker.atkReadyAt = Math.max(now, attacker.atkReadyAt || 0) + PLAYER_ATK_CD * 1000;
    const chain = now - (attacker.lastBlowAt || 0) < COMBO_CHAIN_MS ? (attacker.chain || 0) + 1 : 0;
    const heavy = Number(combo) === 2 && chain >= 2;
    attacker.chain = heavy ? -1 : chain;
    attacker.lastBlowAt = now;
    const dlt = delta(room, attacker, target);
    const len = Math.hypot(dlt.x, dlt.y);
    let fx = attacker._lastFaceX || 1;
    let fy = attacker._lastFaceY || 0;
    if (len > 0.05) {
      fx = dlt.x / len;
      fy = dlt.y / len;
      attacker._lastFaceX = fx;
      attacker._lastFaceY = fy;
    }
    const ms = heavy ? WIND_HEAVY_MS : WIND_LIGHT_MS;
    room.broadcast({
      type: "pvp_windup",
      id: attacker.playerId,
      targetId: target.playerId,
      x: Math.round(attacker.x * 100) / 100,
      y: Math.round(attacker.y * 100) / 100,
      fx: Math.round(fx * 1000) / 1000,
      fy: Math.round(fy * 1000) / 1000,
      heavy: !!heavy,
      ms,
    });
    const attackerId = attacker.playerId;
    const targetId = target.playerId;
    room.schedule(ms / 1000, () => {
      safe("melee-land", () => {
        const a = room.sessions.get(attackerId);
        const t = room.sessions.get(targetId);
        if (!a || !t || pvpIsDown(a)) return;
        const dlt2 = delta(room, a, t);
        const dist2 = Math.hypot(dlt2.x, dlt2.y);
        if (dist2 > ATTACK_RANGE + 0.4) return;
        if (dist2 >= 0.2) {
          const dot = (dlt2.x / dist2) * fx + (dlt2.y / dist2) * fy;
          if (dot < 0.2) return;
        }
        const kind = heavy ? "finisher" : "melee";
        applyPvpDamage(room, a, t, meleeRaw(a, heavy), kind);
      });
    });
  });
}

export function pvpAimTarget(room, from, aimX, aimY, maxRange, coneCos = 0.35) {
  if (!from) return null;
  const hasAim = Number.isFinite(aimX) && Number.isFinite(aimY) && (aimX !== 0 || aimY !== 0);
  let ax = 0;
  let ay = 0;
  if (hasAim) {
    const len = Math.hypot(aimX, aimY) || 1;
    ax = aimX / len;
    ay = aimY / len;
  }
  let best = null;
  let bestScore = Infinity;
  for (const t of room.sessions.values()) {
    if (pvpGate(room, from, t) === "no") continue;
    const dlt = delta(room, from, t);
    const d = Math.hypot(dlt.x, dlt.y);
    if (d > maxRange) continue;
    if (!hasAim || d < 0.05) {
      if (d < bestScore) {
        bestScore = d;
        best = t;
      }
      continue;
    }
    const dot = (dlt.x / d) * ax + (dlt.y / d) * ay;
    if (dot < coneCos) continue;
    const score = d - dot * 2;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

export function pvpLandBolt(room, attackerId, targetId, raw, impact) {
  safe("bolt", () => {
    const a = room.sessions.get(attackerId);
    const t = room.sessions.get(targetId);
    if (!a || !t) return;
    if (impact && Math.hypot(t.x - impact.x, t.y - impact.y) > 1.8) return;
    applyPvpDamage(room, a, t, raw, "gale_bolt");
  });
}

export function pvpBurst(room, attacker, raw, radius) {
  safe("burst", () => {
    if (!attacker) return;
    for (const t of [...room.sessions.values()]) {
      if (t === attacker) continue;
      if (roomDist(room, attacker, t) > radius) continue;
      const jitter = raw + Math.floor(Math.random() * 5);
      applyPvpDamage(room, attacker, t, jitter, "infernal_burst");
    }
  });
}

export function pvpDashCut(room, attacker, x0, y0, x1, y1) {
  safe("dash", () => {
    if (!attacker) return;
    const segX = x1 - x0;
    const segY = y1 - y0;
    const segL2 = segX * segX + segY * segY || 1;
    for (const t of [...room.sessions.values()]) {
      if (t === attacker) continue;
      const u = Math.max(0, Math.min(1, ((t.x - x0) * segX + (t.y - y0) * segY) / segL2));
      const px = x0 + segX * u;
      const py = y0 + segY * u;
      if (Math.hypot(t.x - px, t.y - py) > 1.6) continue;
      applyPvpDamage(room, attacker, t, 18, "dash");
    }
  });
}

function ensureRound(room) {
  if (room?.canto?.role !== "arena") return null;
  const st = pvpState(room);
  if (!st.round) {
    st.round = {
      n: 1,
      endsAt: Date.now() + roundSeconds() * 1000,
      firstBlood: false,
      live: true,
    };
  }
  return st.round;
}

function boardRows(room) {
  const rows = [];
  for (const [id, sess] of room.sessions) {
    if (sess?.spectating) continue;
    const s = ensureStats(id);
    rows.push({
      id,
      name: nameOf(id),
      kills: s.roundKills || 0,
      streak: s.streak || 0,
      lv: getLevel(id),
    });
  }
  rows.sort((a, b) => b.kills - a.kills || b.streak - a.streak || a.name.localeCompare(b.name));
  return rows;
}

/** Breather between FFA rounds: no arena damage while the round card shows. */
function intermissionMs() {
  if (process.env.NODE_ENV !== "production" && process.env.SELVA_PVP_INTERMISSION_SEC != null) {
    const n = Number(process.env.SELVA_PVP_INTERMISSION_SEC);
    if (Number.isFinite(n) && n >= 0) return n * 1000;
  }
  return 8000;
}

function finishRound(room) {
  const st = pvpState(room);
  const round = st.round;
  if (!round) return;
  const rows = boardRows(room);
  const board = rows.slice(0, 8);
  const top = rows.length ? rows[0].kills : 0;
  const winners =
    top > 0 ? rows.filter((r) => r.kills === top).map((r) => ({ id: r.id, name: r.name, kills: r.kills })) : [];
  for (const w of winners) {
    const s = ensureStats(w.id);
    s.roundsWon += 1;
    refreshTitle(s);
    persistPvp(w.id);
    challengesOnRoundWin(room, w.id);
  }
  try {
    room.broadcast({ type: "pvp_round", phase: "end", n: round.n, winners, board });
  } catch (err) {
    console.error("[pvp] round", err.message);
  }
  for (const s of mem.values()) s.roundKills = 0;
  const startsAt = Date.now() + intermissionMs();
  st.round = {
    n: round.n + 1,
    startsAt,
    endsAt: startsAt + roundSeconds() * 1000,
    firstBlood: false,
    live: true,
  };
  room.markDirty();
}

function tickDuels(room) {
  const st = room._pvp;
  if (!st) return;
  const now = Date.now();
  if (st.pending?.length) {
    const keep = [];
    for (const p of st.pending) {
      if (p.expiresAt > now) {
        keep.push(p);
        continue;
      }
      const ch = room.sessions.get(p.fromId);
      if (ch) {
        try {
          room.send(ch.ws, { type: "duel_declined", byName: p.toName, reason: "expired" });
        } catch {
          /* gone */
        }
      }
    }
    st.pending = keep;
  }
  for (const d of [...(st.duels || [])]) {
    if (d._ended || d.phase === "over") continue;
    if (d.phase === "countdown" && now >= d.startsAt) {
      d.phase = "fight";
      d.endsAt = now + DUEL_FIGHT_MS;
      d.inputAt[d.a] = now;
      d.inputAt[d.b] = now;
      const sa = room.sessions.get(d.a);
      const sb = room.sessions.get(d.b);
      if (sa) sa.pvpLastInput = now;
      if (sb) sb.pvpLastInput = now;
      broadcastDuel(room, d);
    }
    if (d.phase !== "countdown" && d.phase !== "fight") continue;
    for (const id of [d.a, d.b]) {
      const s = room.sessions.get(id);
      if (!s || pvpIsDown(s)) continue;
      const dlt = delta(room, s, { x: d.cx, y: d.cy });
      const distC = Math.hypot(dlt.x, dlt.y);
      if (distC > d.r + DUEL_RING_SLACK) {
        if (!d.outSince[id]) {
          d.outSince[id] = now;
          // (the client paints "Back into the ring!" with the grace left from duel_state)
        } else if (now - d.outSince[id] >= DUEL_OUT_MS) {
          const winner = id === d.a ? d.b : d.a;
          endDuel(room, d, { winnerId: winner, reason: "ring" });
          break;
        }
      } else {
        d.outSince[id] = 0;
      }
    }
    if (d._ended || d.phase !== "fight") continue;
    if (now >= d.endsAt) {
      const sa = room.sessions.get(d.a);
      const sb = room.sessions.get(d.b);
      const fa = sa && sa.maxHp > 0 ? sa.hp / sa.maxHp : 0;
      const fb = sb && sb.maxHp > 0 ? sb.hp / sb.maxHp : 0;
      if (!sa && !sb) {
        endDuel(room, d, { winnerId: null, reason: "draw" });
      } else if (!sa) {
        endDuel(room, d, { winnerId: d.b, reason: "timeout" });
      } else if (!sb) {
        endDuel(room, d, { winnerId: d.a, reason: "timeout" });
      } else if (Math.abs(fa - fb) < 1e-6) {
        endDuel(room, d, { winnerId: null, reason: "draw" });
      } else {
        endDuel(room, d, { winnerId: fa > fb ? d.a : d.b, reason: "timeout" });
      }
      continue;
    }
    for (const id of [d.a, d.b]) {
      const s = room.sessions.get(id);
      if (!s || pvpIsDown(s)) continue;
      const last = Math.max(d.inputAt?.[id] || 0, s.pvpLastInput || 0);
      if (now - last >= AFK_DUEL_MS) {
        const winner = id === d.a ? d.b : d.a;
        endDuel(room, d, { winnerId: winner, reason: "afk" });
        break;
      }
    }
  }
}

function tryPair(room) {
  const st = pvpState(room);
  const now = Date.now();
  for (const id of [...st.queue.keys()]) {
    const s = room.sessions.get(id);
    if (!s || pvpIsDown(s) || !(s.hp > 0) || duelOf(room, id)) st.queue.delete(id);
  }
  const ids = [...st.queue.keys()];
  if (ids.length < 2) return;
  let best = null;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = ids[i];
      const B = ids[j];
      const gap = Math.abs(ensureStats(A).rating - ensureStats(B).rating);
      const waited = now - Math.min(st.queue.get(A).since, st.queue.get(B).since);
      const window = 80 + Math.floor(waited / 3000) * 100;
      if (gap > window) continue;
      if (!best || gap < best.gap) best = { A, B, gap };
    }
  }
  if (!best) return;
  const a = room.sessions.get(best.A);
  const b = room.sessions.get(best.B);
  if (!a || !b) return;
  st.queue.delete(best.A);
  st.queue.delete(best.B);
  startDuel(room, a, b, { ranked: true, cx: RANKED_RING.x, cy: RANKED_RING.y, r: RANKED_RING.r });
  const size = st.queue.size;
  for (const s of [a, b]) {
    try {
      room.send(s.ws, { type: "pvp_queue", queued: false, size });
    } catch {
      /* gone */
    }
  }
}

function tickArena(room) {
  if (room.canto?.role !== "arena") return;
  const round = ensureRound(room);
  const now = Date.now();
  if (round) {
    if (now >= round.endsAt) {
      if (round.live) finishRound(room);
      else {
        round.endsAt = now + roundSeconds() * 1000;
        round.live = true;
      }
    } else {
      round.live = true;
    }
  }
  const afk = [];
  for (const [id, s] of room.sessions) {
    if (pvpIsDown(s)) continue;
    if (duelOf(room, id)) continue;
    if (s.spectating) continue;
    const last = s.pvpLastInput || 0;
    if (last && now - last >= AFK_ARENA_MS) afk.push(id);
  }
  for (const id of afk) sendHome(room, id);
  tryPair(room);
}

function sendHome(room, playerId) {
  const s = room.sessions.get(playerId);
  if (!s || !room.world) return;
  try {
    room.toast(s.ws, "warn", "You stood too long in the well. The Dark Wood takes you back.");
  } catch {
    /* closing */
  }
  try {
    room.world.travel(playerId, "inferno_01", s.ws, nameOf(playerId), { bypassGates: true });
  } catch (err) {
    console.error("[pvp] afk travel", err.message);
  }
}

export function pvpTick(room, _dt) {
  if (!room || room.sessions.size === 0) return;
  safe("tick", () => {
    tickDuels(room);
    tickArena(room);
  });
}

export function pvpOnRoomLeave(room, playerId, reason) {
  safe("leave", () => {
    if (!room || !playerId) return;
    const st = room._pvp;
    if (!st) return;
    st.queue?.delete(playerId);
    if (st.pending?.length) {
      const gone = st.pending.filter((p) => p.fromId === playerId || p.toId === playerId);
      st.pending = st.pending.filter((p) => p.fromId !== playerId && p.toId !== playerId);
      for (const p of gone) {
        const otherId = p.fromId === playerId ? p.toId : p.fromId;
        const other = room.sessions.get(otherId);
        if (!other) continue;
        try {
          room.send(other.ws, { type: "duel_declined", byName: nameOf(playerId), reason: "left" });
        } catch {
          /* gone */
        }
      }
    }
    const d = duelOf(room, playerId);
    if (d) {
      const winner = d.a === playerId ? d.b : d.a;
      const why = reason === "forfeit" ? "forfeit" : "disconnect";
      endDuel(room, d, { winnerId: winner, reason: why });
    }
    if (room.sessions.size <= 1 && st.round) st.round.live = false;
  });
}

function decline(room, challengerId, byName, reason) {
  const ch = room.sessions.get(challengerId);
  if (!ch) return;
  try {
    room.send(ch.ws, { type: "duel_declined", byName: byName || "", reason });
  } catch {
    /* gone */
  }
}

export function handleDuelChallenge(room, sess, targetId) {
  safe("challenge", () => {
    if (!room || !sess) return;
    if (room.cantoId !== "inferno_01" || room.canto?.role !== "hub") {
      decline(room, sess.playerId, "", "hub_only");
      return;
    }
    const lockKey = `${sess.playerId}|${targetId}`;
    if ((declineLock.get(lockKey) || 0) > Date.now()) {
      decline(room, sess.playerId, nameOf(targetId), "declined_recently");
      return;
    }
    if (tooSoon(sess, "chal")) {
      if (!sess._pvpRateTold || Date.now() > sess._pvpRateTold) {
        sess._pvpRateTold = Date.now() + CHALLENGE_CD_MS;
        try {
          room.toast(sess.ws, "info", "Wait a moment.");
        } catch {
          /* gone */
        }
      }
      decline(room, sess.playerId, "", "rate");
      return;
    }
    markRate(sess, "chal", CHALLENGE_CD_MS);
    const target = room.sessions.get(String(targetId || ""));
    if (!target || target === sess || pvpIsDown(target) || pvpIsDown(sess) || !(target.hp > 0) || !(sess.hp > 0)) {
      decline(room, sess.playerId, target ? nameOf(target.playerId) : "", "unavailable");
      return;
    }
    if (roomDist(room, sess, target) > CHALLENGE_RANGE) {
      decline(room, sess.playerId, nameOf(target.playerId), "too_far");
      return;
    }
    const st = pvpState(room);
    const queued = (id) => {
      for (const r of room.world?.rooms?.values?.() || []) {
        if (r._pvp?.queue?.has(id)) return true;
      }
      return false;
    };
    if (
      duelOf(room, sess.playerId) ||
      duelOf(room, target.playerId) ||
      queued(sess.playerId) ||
      queued(target.playerId) ||
      st.pending.some((p) => p.fromId === sess.playerId || p.toId === sess.playerId || p.fromId === target.playerId || p.toId === target.playerId)
    ) {
      decline(room, sess.playerId, nameOf(target.playerId), "busy");
      return;
    }
    const fromStats = ensureStats(sess.playerId);
    const pending = {
      fromId: sess.playerId,
      toId: target.playerId,
      fromName: nameOf(sess.playerId),
      toName: nameOf(target.playerId),
      expiresAt: Date.now() + INVITE_MS,
      rating: fromStats.rating,
      title: fromStats.title,
    };
    st.pending.push(pending);
    try {
      room.send(target.ws, {
        type: "duel_invite",
        fromId: pending.fromId,
        fromName: pending.fromName,
        rating: pending.rating,
        title: pending.title,
        expiresIn: INVITE_MS / 1000,
      });
      room.send(sess.ws, {
        type: "duel_pending",
        toId: pending.toId,
        toName: pending.toName,
        expiresIn: INVITE_MS / 1000,
      });
    } catch (err) {
      console.error("[pvp] invite", err.message);
    }
  });
}

export function handleDuelRespond(room, sess, fromId, accept) {
  safe("respond", () => {
    if (!room || !sess) return;
    if (tooSoon(sess, "respond")) return;
    markRate(sess, "respond", 300);
    const st = pvpState(room);
    const idx = st.pending.findIndex((p) => p.toId === sess.playerId && p.fromId === fromId);
    if (idx < 0) return;
    const p = st.pending[idx];
    st.pending.splice(idx, 1);
    const challenger = room.sessions.get(fromId);
    if (Date.now() > p.expiresAt) {
      if (challenger) decline(room, fromId, nameOf(sess.playerId), "expired");
      return;
    }
    if (!accept) {
      declineLock.set(`${fromId}|${sess.playerId}`, Date.now() + DECLINE_LOCK_MS);
      if (challenger) decline(room, fromId, nameOf(sess.playerId), "declined");
      return;
    }
    if (!challenger || pvpIsDown(challenger) || pvpIsDown(sess) || !(challenger.hp > 0) || !(sess.hp > 0)) {
      if (challenger) decline(room, fromId, nameOf(sess.playerId), "unavailable");
      return;
    }
    if (room.cantoId !== "inferno_01") {
      decline(room, fromId, nameOf(sess.playerId), "hub_only");
      return;
    }
    if (roomDist(room, challenger, sess) > CHALLENGE_RANGE) {
      decline(room, fromId, nameOf(sess.playerId), "too_far");
      return;
    }
    if (duelOf(room, challenger.playerId) || duelOf(room, sess.playerId)) {
      decline(room, fromId, nameOf(sess.playerId), "busy");
      return;
    }
    startDuel(room, challenger, sess, { ranked: false });
  });
}

export function handleDuelCancel(room, sess) {
  safe("cancel", () => {
    if (!room || !sess) return;
    if (tooSoon(sess, "cancel")) return;
    markRate(sess, "cancel", 400);
    const st = pvpState(room);
    const mine = (st.pending || []).filter((p) => p.fromId === sess.playerId);
    st.pending = (st.pending || []).filter((p) => p.fromId !== sess.playerId);
    for (const p of mine) {
      const t = room.sessions.get(p.toId);
      if (!t) continue;
      try {
        room.send(t.ws, { type: "duel_declined", byName: nameOf(sess.playerId), reason: "withdrawn" });
      } catch {
        /* gone */
      }
    }
    const d = duelOf(room, sess.playerId);
    if (d) {
      const winner = d.a === sess.playerId ? d.b : d.a;
      endDuel(room, d, { winnerId: winner, reason: "forfeit" });
    }
  });
}

export function handlePvpQueue(room, sess, join) {
  safe("queue", () => {
    if (!room || !sess) return;
    if (tooSoon(sess, "queue")) return;
    markRate(sess, "queue", 400);
    if (room.canto?.role !== "arena") {
      room.send(sess.ws, { type: "pvp_queue", queued: false, size: 0 });
      return;
    }
    const st = pvpState(room);
    if (join) {
      if (sess.spectating || duelOf(room, sess.playerId) || pvpIsDown(sess) || !(sess.hp > 0)) {
        room.send(sess.ws, { type: "pvp_queue", queued: false, size: st.queue.size });
        return;
      }
      if (!st.queue.has(sess.playerId)) st.queue.set(sess.playerId, { since: Date.now() });
    } else {
      st.queue.delete(sess.playerId);
    }
    room.send(sess.ws, {
      type: "pvp_queue",
      queued: st.queue.has(sess.playerId),
      size: st.queue.size,
    });
    tryPair(room);
  });
}

function eligibleRows() {
  const rows = [];
  for (const [id, s] of mem) {
    if ((s.wins || 0) + (s.losses || 0) + (s.draws || 0) < 1 && (s.kills || 0) < 1) continue;
    rows.push([id, s]);
  }
  rows.sort((a, b) => b[1].rating - a[1].rating || b[1].wins - a[1].wins || nameOf(a[0]).localeCompare(nameOf(b[0])));
  return rows;
}

function rowView(id, s, rank) {
  return {
    rank,
    name: nameOf(id),
    rating: s.rating,
    wins: s.wins,
    losses: s.losses,
    kills: s.kills,
    title: s.title || null,
    lv: getLevel(id),
  };
}

export function leaderboardPayload(playerId) {
  const rows = eligibleRows();
  const top = rows.slice(0, 20).map(([id, s], i) => rowView(id, s, i + 1));
  let you = null;
  if (playerId) {
    const idx = rows.findIndex(([id]) => id === playerId);
    if (idx >= 0) you = rowView(playerId, rows[idx][1], idx + 1);
  }
  return { top, you };
}

export function handleLeaderboard(room, sess) {
  safe("leaderboard", () => {
    if (!room || !sess) return;
    if (tooSoon(sess, "lb")) return;
    markRate(sess, "lb", 2000);
    const payload = leaderboardPayload(sess.playerId);
    room.send(sess.ws, { type: "pvp_leaderboard", top: payload.top, you: payload.you });
  });
}

export function pvpRemote(room, sess) {
  if (!sess) return null;
  const s = mem.get(sess.playerId);
  const rating = s?.rating ?? RATING_START;
  const title = s?.title || null;
  const downed = pvpIsDown(sess);
  const invuln = (sess.pvpInvulnUntil || 0) > Date.now() || (sess.iframes || 0) >= 0.9;
  const duel = duelOf(room, sess.playerId);
  const ranked = !!(duel && duel.ranked);
  const pvp = {};
  if (rating !== RATING_START) pvp.rating = rating;
  if (title) pvp.title = title;
  if (downed) pvp.downed = true;
  if (invuln) pvp.invuln = true;
  if (ranked) pvp.ranked = true;
  return Object.keys(pvp).length ? pvp : null;
}

export function pvpYou(room, sess) {
  if (!sess) return null;
  const s = ensureStats(sess.playerId);
  const st = room?._pvp;
  const queued = !!(room?.canto?.role === "arena" && st?.queue?.has(sess.playerId));
  const out = {
    rating: s.rating,
    peak: s.peak,
    wins: s.wins,
    losses: s.losses,
    draws: s.draws,
    kills: s.kills,
    deaths: s.deaths,
    bestStreak: s.bestStreak,
    roundsWon: s.roundsWon,
    streak: s.streak || 0,
    roundKills: s.roundKills || 0,
  };
  if (s.title) out.title = s.title;
  if (queued) out.queued = true;
  if (sess.spectating) out.spec = true;
  // The client keeps the recap / kill cam up and blocks input while downed
  if (pvpIsDown(sess)) out.downed = true;
  if ((sess.pvpInvulnUntil || 0) > Date.now()) out.invuln = true;
  return out;
}

export function pvpRoomFields(room) {
  const extra = {};
  const duels = (room?._pvp?.duels || [])
    .filter((d) => !d._ended && (d.phase === "countdown" || d.phase === "fight"))
    .map(publicDuel);
  if (duels.length) extra.duels = duels;
  if (room?.canto?.role === "arena") {
    const round = ensureRound(room);
    extra.arena = {
      round: {
        n: round.n,
        endsAt: round.endsAt,
        ...(round.startsAt > Date.now() ? { startsAt: round.startsAt } : {}),
      },
      board: boardRows(room).slice(0, 8),
    };
  }
  return extra;
}

async function writeOne(playerId) {
  if (!dbEnabled()) return;
  const s = mem.get(playerId);
  if (!s) return;
  await query(
    `INSERT INTO pvp_stats (
       player_id, rating, peak_rating, wins, losses, draws, kills, deaths,
       best_streak, rounds_won, title, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
     ON CONFLICT (player_id) DO UPDATE SET
       rating = EXCLUDED.rating,
       peak_rating = EXCLUDED.peak_rating,
       wins = EXCLUDED.wins,
       losses = EXCLUDED.losses,
       draws = EXCLUDED.draws,
       kills = EXCLUDED.kills,
       deaths = EXCLUDED.deaths,
       best_streak = EXCLUDED.best_streak,
       rounds_won = EXCLUDED.rounds_won,
       title = EXCLUDED.title,
       updated_at = NOW()`,
    [
      playerId,
      s.rating | 0,
      s.peak | 0,
      s.wins | 0,
      s.losses | 0,
      s.draws | 0,
      s.kills | 0,
      s.deaths | 0,
      s.bestStreak | 0,
      s.roundsWon | 0,
      s.title,
    ]
  );
}

export function persistPvp(playerId) {
  if (!playerId || !dbEnabled()) return;
  const prev = tails.get(playerId) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => writeOne(playerId))
    .catch((err) => console.error("[pvp] persist failed", err.message));
  tails.set(playerId, next);
}

export async function flushPvp() {
  const pending = [...tails.values()];
  if (!pending.length) return;
  await Promise.all(pending);
}

export async function hydratePvp() {
  if (!dbEnabled()) return;
  try {
    const r = await query(
      `SELECT player_id, rating, peak_rating, wins, losses, draws, kills, deaths,
              best_streak, rounds_won, title
       FROM pvp_stats`
    );
    for (const row of r.rows) {
      const id = String(row.player_id);
      mem.set(id, {
        rating: Number(row.rating) || RATING_START,
        peak: Number(row.peak_rating) || RATING_START,
        wins: Number(row.wins) || 0,
        losses: Number(row.losses) || 0,
        draws: Number(row.draws) || 0,
        kills: Number(row.kills) || 0,
        deaths: Number(row.deaths) || 0,
        bestStreak: Number(row.best_streak) || 0,
        roundsWon: Number(row.rounds_won) || 0,
        title: row.title || null,
        streak: 0,
        roundKills: 0,
        name: players.get(id)?.name || null,
      });
    }
    console.log(`[pvp] hydrated ${r.rowCount} rows`);
  } catch (err) {
    console.error("[pvp] hydrate failed", err.message);
  }
}
