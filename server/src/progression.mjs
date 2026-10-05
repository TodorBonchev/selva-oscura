/**
 * Experience, levels, skill points, persistence.
 * grantXp is the only award path. Throws never escape to the tick loop.
 */
import { computeGearStats, debitAsh, persistAshNow, players } from "./ledger.mjs";
import { dbEnabled, query } from "./db.mjs";
import { PLAYER_MAX_MANA, MANA_REGEN_PER_SEC } from "./spells.mjs";
import { partyMatesNear, PARTY_XP_BONUS } from "./party.mjs";
import {
  DEFAULT_LOADOUT,
  FREE_SKILLS,
  defaultRanks,
  sanitizeLoadout,
  sanitizeRanks,
  spentPoints,
  unspentPoints,
  canLearn,
  skillById,
  requiredLevel,
  LOADOUT_SIZE,
} from "./skills.mjs";

export const LEVEL_CAP = 50;
export const PLAYER_MAX_HP = 130;
export const PLAYER_BASE_DMG = 22;
export const HP_PER_LEVEL = 4;
export const MANA_PER_LEVEL = 2;
export const DMG_PER_LEVEL = 0.4;
export const ARMOR_PER_LEVEL = 0.25;
export const RESPEC_ASH_PER_LEVEL = 200;
export const PARTY_XP_RANGE = 30;

/** Bump to re-run the one-time veteran grant. Stamped on the progress row. */
export const CATCHUP_VERSION = 1;
export const CATCHUP_CUTOFF_MS = Date.parse(process.env.CATCHUP_CUTOFF || "2026-10-03T02:05:00+03:00");
/** Full clear on top of the 800×tier first-clear grant: 4800 + 33200 = 38000 (~level 16). */
export const CATCHUP_XP = {
  inferno_05: 6400,
  inferno_06: 10400,
  inferno_07: 16400,
};

const HEART_ARCHETYPES = new Set(["storm_heart", "mire_heart", "hoard_heart", "rage_heart"]);

const CANTO_TIER_N = {
  inferno_05: 1,
  inferno_06: 2,
  inferno_07: 3,
  inferno_08: 4,
};

const REC_UPPER = {
  inferno_05: 12,
  inferno_06: 22,
  inferno_07: 50,
  inferno_08: 50,
};

const FIRST_CLEAR_XP = 800;
const XP_FODDER = 6;
const XP_ELITE = 20;
const XP_MINI = 60;
const XP_BOSS = 250;

/** @type {Map<string, object>} */
const mem = new Map();
/** @type {Map<string, Promise<void>>} */
const tails = new Map();
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const xpTimers = new Map();
const dirty = new Set();
/** playerId -> Set of canto ids cleared before CATCHUP_CUTOFF_MS. Filled in DB hydrate only. */
const preLaunchClears = new Map();
let catchupReady = false;

function safe(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[prog] ${label}`, err?.message || err);
    return undefined;
  }
}

export function cantoTier(cantoId) {
  return CANTO_TIER_N[cantoId] || 1;
}

export function xpToNext(level) {
  const L = Math.floor(Number(level) || 1);
  if (!(L >= 1) || L >= LEVEL_CAP) return 0;
  return Math.round(60 * Math.pow(L, 1.65) + 40 * L);
}

export function totalXpForLevel(level) {
  const L = Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(level) || 1)));
  let t = 0;
  for (let i = 1; i < L; i++) t += xpToNext(i);
  return t;
}

export function xpTable() {
  const rows = [];
  for (let L = 1; L <= LEVEL_CAP; L++) {
    rows.push({ level: L, xpToNext: xpToNext(L), totalXp: totalXpForLevel(L) });
  }
  return rows;
}

export function levelFromTotalXp(xp) {
  const total = Math.max(0, Math.floor(Number(xp) || 0));
  let remaining = total;
  let level = 1;
  while (level < LEVEL_CAP) {
    const need = xpToNext(level);
    if (remaining < need) break;
    remaining -= need;
    level += 1;
  }
  return { level, xpIntoLevel: remaining, xpToNext: xpToNext(level), total };
}

function blankProgress(id) {
  return {
    playerId: id,
    level: 1,
    xp: 0,
    ranks: defaultRanks(),
    loadout: DEFAULT_LOADOUT.slice(),
    backfilled: false,
    respecs: 0,
    catchupV: 0,
    // First-run onboarding: 0 new, 1 starter XP granted, 2 done/skipped (migration 008)
    tutorialV: 0,
  };
}

function sanitizeRow(row, id) {
  const p = blankProgress(id);
  const levelGuess = Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(row.level) || 1)));
  const xp = Math.max(0, Math.floor(Number(row.xp) || 0));
  const fromXp = levelFromTotalXp(xp);
  p.xp = xp;
  p.level = Math.min(LEVEL_CAP, Math.max(fromXp.level, 1));
  if (Math.abs(p.level - levelGuess) > 0 && fromXp.level !== levelGuess) {
    p.level = fromXp.level;
  }
  p.ranks = sanitizeRanks(row.ranks, p.level);
  p.loadout = sanitizeLoadout(row.loadout, p.ranks);
  p.backfilled = Boolean(row.backfilled);
  p.respecs = Math.max(0, Math.floor(Number(row.respecs) || 0));
  p.catchupV = Math.max(0, Math.floor(Number(row.catchup_v) || 0));
  p.tutorialV = row.tutorial_v == null ? 2 : Math.max(0, Math.floor(Number(row.tutorial_v) || 0));
  return p;
}

export function getProgress(playerId) {
  if (!playerId) return blankProgress("");
  let p = mem.get(playerId);
  if (p) return p;
  p = blankProgress(playerId);
  const led = players.get(playerId);
  if (led?.firstClears instanceof Set && led.firstClears.size) {
    backfillInto(p, led);
  }
  // Someone who already walked the Inferno is no newcomer: skip onboarding
  if (led && (led.visitedInferno || led.firstClears?.size)) p.tutorialV = 2;
  mem.set(playerId, p);
  persistProgress(playerId, true);
  return p;
}

export function rankOf(playerId, skillId) {
  const p = mem.get(playerId) || getProgress(playerId);
  return Math.max(0, Math.floor(Number(p.ranks?.[skillId]) || 0));
}

export function getLevel(playerId) {
  return getProgress(playerId).level || 1;
}

export function playerCombatStats(playerId) {
  const gear = computeGearStats(players.get(playerId) || { inventory: [] });
  const p = getProgress(playerId);
  const lv = Math.max(1, p.level || 1);
  const above = lv - 1;
  const vigor = Math.max(0, Math.floor(Number(p.ranks?.vigor) || 0));
  const stone = Math.max(0, Math.floor(Number(p.ranks?.stone_skin) || 0));
  const maxHp = Math.round((PLAYER_MAX_HP + (gear.maxHp || 0) + HP_PER_LEVEL * above) * (1 + 0.05 * vigor));
  const maxMana = PLAYER_MAX_MANA + MANA_PER_LEVEL * above;
  const armor = (gear.armor || 0) + ARMOR_PER_LEVEL * above + 6 * stone;
  const weaponDmg = PLAYER_BASE_DMG + (gear.dmg || 0) + DMG_PER_LEVEL * above;
  return { level: lv, gear, maxHp, maxMana, armor, weaponDmg };
}

export function applyPlayerStats(sess, opts = {}) {
  if (!sess) return;
  const st = playerCombatStats(sess.playerId);
  const oldHp = sess.maxHp || st.maxHp;
  const ratio = oldHp > 0 ? (sess.hp || oldHp) / oldHp : 1;
  sess.maxHp = st.maxHp;
  sess.maxMana = st.maxMana;
  if (opts.refill) {
    sess.hp = sess.maxHp;
    sess.mana = sess.maxMana;
  } else {
    if (st.maxHp > oldHp) sess.hp = Math.min(st.maxHp, (sess.hp || 0) + (st.maxHp - oldHp));
    else sess.hp = Math.max(1, Math.min(st.maxHp, Math.round(st.maxHp * ratio)));
    sess.mana = Math.max(0, Math.min(sess.maxMana, sess.mana ?? sess.maxMana));
  }
}

export function manaRegenPerSec(playerId) {
  const p = getProgress(playerId);
  const sil = Math.max(0, Math.floor(Number(p.ranks?.silenzio) || 0));
  const lv = 1 + 0.015 * Math.max(0, (p.level || 1) - 1);
  return MANA_REGEN_PER_SEC * lv * (1 + 0.08 * sil);
}

export function overLevelMult(level, cantoId) {
  const cap = REC_UPPER[cantoId];
  if (cap == null) return 1;
  const d = (level || 1) - cap;
  if (d <= 0) return 1;
  return Math.max(0.1, 1 - 0.1 * d);
}

function isPveReason(reason) {
  // "catchup" is a one-time grant and must not take the over-level PvE cut.
  return reason === "kill" || reason === "first_clear" || reason === "boss";
}

function queueXpGain(room, playerId, amount, reason, total) {
  const sess = room?.sessions?.get(playerId);
  if (!sess) return;
  if (!sess._xpGain) sess._xpGain = { amount: 0, reason, total };
  sess._xpGain.amount += amount;
  sess._xpGain.reason = sess._xpGain.reason === reason ? reason : "combat";
  sess._xpGain.total = total;
}

export function flushXpGains(room) {
  if (!room) return;
  for (const s of room.sessions.values()) {
    const g = s._xpGain;
    if (!g || !(g.amount > 0)) continue;
    s._xpGain = null;
    try {
      room.send(s.ws, { type: "xp_gain", amount: g.amount, reason: g.reason, total: g.total });
    } catch {
      /* closing */
    }
  }
}

export function progSnapshot(playerId, sess) {
  const p = getProgress(playerId);
  const into = Math.max(0, p.xp - totalXpForLevel(p.level));
  const ranks = {};
  for (const [id, r] of Object.entries(p.ranks || {})) {
    if (r > 0) ranks[id] = r;
  }
  const now = Date.now();
  const cds = {};
  if (sess?.spellReadyAt) {
    for (const [id, at] of Object.entries(sess.spellReadyAt)) {
      const ms = Math.max(0, Math.round((Number(at) || 0) - now));
      if (ms > 0) cds[id] = ms;
    }
  }
  const out = {
    level: p.level,
    xp: p.xp,
    xpToNext: xpToNext(p.level),
    xpIntoLevel: p.level >= LEVEL_CAP ? 0 : into,
    points: unspentPoints(p.level, p.ranks),
    ranks,
    loadout: Array.isArray(p.loadout) ? p.loadout.slice(0, LOADOUT_SIZE) : DEFAULT_LOADOUT.slice(),
    tut: Math.min(2, p.tutorialV | 0),
  };
  if (Object.keys(cds).length) out.cds = cds;
  return out;
}

function onLevelUp(room, playerId, from, to) {
  const sess = room?.sessions?.get(playerId);
  const name = players.get(playerId)?.name || sess?.playerId?.slice(0, 6) || "Wanderer";
  if (sess) {
    applyPlayerStats(sess, { refill: true });
    try {
      room.toast(sess.ws, "emit", `You reach level ${to}.`);
    } catch {
      /* closing */
    }
  }
  if (room) {
    try {
      room.broadcast({ type: "level_up", playerId, name, level: to });
      room.markDirty();
    } catch (err) {
      console.error("[prog] level_up", err.message);
    }
  }
  persistProgress(playerId, true);
}

/**
 * Award XP. Handles multi-level-ups. `opts.skipPenalty` for backfill.
 */
export function grantXp(room, playerId, amount, reason, opts = {}) {
  return safe("grantXp", () => {
    if (!playerId) return 0;
    let n = Math.floor(Number(amount) || 0);
    if (!(n > 0)) return 0;
    const p = getProgress(playerId);
    if (p.level >= LEVEL_CAP && !opts.allowOverflow) {
      /* still record a trickle so totals stay honest at cap */
    }
    if (!opts.skipPenalty && isPveReason(reason) && room?.cantoId) {
      n = Math.max(1, Math.round(n * overLevelMult(p.level, room.cantoId)));
    }
    if (!(n > 0)) return 0;
    const from = p.level;
    p.xp += n;
    const next = levelFromTotalXp(p.xp);
    if (next.level > p.level) {
      p.level = next.level;
      onLevelUp(room, playerId, from, p.level);
    } else {
      persistProgress(playerId, false);
    }
    if (room) queueXpGain(room, playerId, n, reason || "combat", p.xp);
    return n;
  }) || 0;
}

export function killXpValue(entity, cantoId) {
  if (!entity || entity.summoned) return 0;
  let base = XP_FODDER;
  if (entity.kind === "boss") base = XP_BOSS;
  else if (entity.packId === "ava_counterweight" || HEART_ARCHETYPES.has(entity.archetype)) base = XP_MINI;
  else if (entity.champion || entity.elite) base = XP_ELITE;
  const tier = cantoTier(cantoId);
  return Math.round(base * (1 + 0.6 * (tier - 1)));
}

export function grantKillXp(room, killerId, entity) {
  return safe("killXp", () => {
    if (!room || !entity || entity.summoned) return;
    const amount = killXpValue(entity, room.cantoId);
    if (!(amount > 0)) return;
    const recipients = new Set();
    if (killerId) recipients.add(killerId);
    if (entity.hitBy) {
      for (const id of entity.hitBy) recipients.add(id);
    }
    for (const [pid, s] of room.sessions) {
      if (!(s.hp > 0)) continue;
      const dx = s.x - entity.x;
      const dy = s.y - entity.y;
      if (Math.hypot(dx, dy) <= PARTY_XP_RANGE) recipients.add(pid);
    }
    // Parties: mates further out in the same canto still share, and a party that
    // shares a kill earns +10% per extra member present.
    for (const id of [...recipients]) {
      for (const mate of partyMatesNear(room, id, entity.x, entity.y)) recipients.add(mate);
    }
    for (const id of recipients) {
      const s = room.sessions.get(id);
      if (!s || !(s.hp > 0)) continue;
      let n = amount;
      const mates = partyMatesNear(room, id, entity.x, entity.y).filter((m) => recipients.has(m)).length;
      if (mates > 0) n = Math.round(amount * (1 + PARTY_XP_BONUS * Math.min(2, mates)));
      grantXp(room, id, n, "kill");
    }
  });
}

export const TUTORIAL_XP = 100;

/**
 * Onboarding messages. {step:"xp"}: one-time starter grant (level 2 → a skill point
 * to learn in the tutorial). {step:"done"|"skip"}: never show again. Idempotent.
 */
export function handleTutorial(room, sess, step) {
  return safe("tutorial", () => {
    if (!room || !sess?.playerId) return;
    const p = getProgress(sess.playerId);
    const v = p.tutorialV | 0;
    if (step === "xp") {
      if (v !== 0) return;
      p.tutorialV = 1;
      if (p.xp < totalXpForLevel(2)) {
        grantXp(room, sess.playerId, Math.max(TUTORIAL_XP, totalXpForLevel(2) - p.xp), "tutorial", { skipPenalty: true });
      }
      persistProgress(sess.playerId, true);
      room.pushSnapshot?.(sess.playerId);
      return;
    }
    if (step === "done" || step === "skip") {
      if (v >= 2) return;
      // Skipping before the grant still leaves the newcomer their first point
      if (v === 0 && p.xp < totalXpForLevel(2)) {
        grantXp(room, sess.playerId, Math.max(TUTORIAL_XP, totalXpForLevel(2) - p.xp), "tutorial", { skipPenalty: true });
      }
      p.tutorialV = 2;
      persistProgress(sess.playerId, true);
      room.pushSnapshot?.(sess.playerId);
    }
  });
}

export function firstClearXp(cantoId) {
  return FIRST_CLEAR_XP * cantoTier(cantoId);
}

/**
 * One-time veteran XP for canto clears that predate progression.
 * No-op in memory mode and once catchupV is stamped. Ranks are left alone.
 */
export function applyCatchup(room, sess) {
  return safe("catchup", () => {
    if (!catchupReady || !sess?.playerId) return;
    const id = sess.playerId;
    const p = getProgress(id);
    if ((p.catchupV | 0) >= CATCHUP_VERSION) return;
    let xp = 0;
    const clears = preLaunchClears.get(String(id));
    if (clears) {
      for (const c of clears) xp += CATCHUP_XP[c] || 0;
    }
    // Stamp before the grant so a retry cannot pay twice.
    p.catchupV = CATCHUP_VERSION;
    try {
      if (xp > 0) {
        const from = p.level;
        grantXp(room, id, xp, "catchup", { skipPenalty: true });
        room.toast(
          sess.ws,
          "loot",
          `Catch-up: +${xp} XP for past clears (level ${from} → ${p.level}, +${p.level - from} skill points).`
        );
      }
    } finally {
      persistProgress(id, true);
    }
  });
}

export function pvpXpAllowed(attackerId, victimId) {
  const a = getLevel(attackerId);
  const v = getLevel(victimId);
  return !(a > v + 10);
}

function tooSoon(sess, key, maxPerSec = 10) {
  if (!sess) return true;
  const now = Date.now();
  if (!sess._progRl) sess._progRl = {};
  const prev = sess._progRl[key];
  const arr = Array.isArray(prev) ? prev.filter((t) => now - t < 1000) : [];
  if (arr.length >= maxPerSec) return true;
  arr.push(now);
  sess._progRl[key] = arr;
  return false;
}

function skillResult(room, sess, ok, op, error) {
  const msg = { type: "skill_result", ok: !!ok, op };
  if (error) msg.error = error;
  try {
    room.send(sess.ws, msg);
  } catch {
    /* closing */
  }
}

export function handleSkillLearn(room, sess, skillId) {
  return safe("learn", () => {
    if (!room || !sess) return;
    if (tooSoon(sess, "learn")) {
      skillResult(room, sess, false, "learn", "rate");
      return;
    }
    if (typeof skillId !== "string" || skillId.length < 1 || skillId.length > 40) {
      skillResult(room, sess, false, "learn", "bad_id");
      room.toast(sess.ws, "warn", "Unknown skill.");
      return;
    }
    const def = skillById(skillId);
    if (!def) {
      skillResult(room, sess, false, "learn", "unknown");
      room.toast(sess.ws, "warn", "Unknown skill.");
      return;
    }
    const p = getProgress(sess.playerId);
    const gate = canLearn(def, p);
    if (!gate.ok) {
      skillResult(room, sess, false, "learn", gate.error);
      const why = {
        no_points: "No skill points remaining.",
        level: `Requires level ${def.requiredLevel || 1}.`,
        prereq: "A linked skill is not ranked high enough.",
        max_rank: `${def.name} is already at max rank.`,
      };
      if (gate.error === "level") {
        why.level = `Requires level ${requiredLevel(def)}.`;
      }
      room.toast(sess.ws, "warn", why[gate.error] || "Cannot learn that.");
      return;
    }
    p.ranks[def.id] = (Math.floor(Number(p.ranks[def.id]) || 0) || 0) + 1;
    applyPlayerStats(sess);
    persistProgress(sess.playerId, true);
    skillResult(room, sess, true, "learn");
    room.toast(sess.ws, "info", `${def.name} — rank ${p.ranks[def.id]}`);
    room.pushSnapshot(sess.playerId);
  });
}

export function handleSkillLoadout(room, sess, slots) {
  return safe("loadout", () => {
    if (!room || !sess) return;
    if (tooSoon(sess, "loadout")) {
      skillResult(room, sess, false, "loadout", "rate");
      return;
    }
    if (!Array.isArray(slots) || slots.length > LOADOUT_SIZE) {
      skillResult(room, sess, false, "loadout", "bad_slots");
      room.toast(sess.ws, "warn", "Loadout must be four slots.");
      return;
    }
    for (const s of slots) {
      if (s != null && (typeof s !== "string" || s.length > 40)) {
        skillResult(room, sess, false, "loadout", "bad_slots");
        room.toast(sess.ws, "warn", "Loadout slots must be skill ids.");
        return;
      }
    }
    const p = getProgress(sess.playerId);
    const next = sanitizeLoadout(slots, p.ranks);
    const filled = slots.map((s) => (s == null || s === "" ? null : s));
    const ids = filled.filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      skillResult(room, sess, false, "loadout", "duplicate");
      room.toast(sess.ws, "warn", "A skill may only occupy one slot.");
      return;
    }
    for (const id of ids) {
      const def = skillById(id);
      if (!def || def.type !== "active") {
        skillResult(room, sess, false, "loadout", "not_active");
        room.toast(sess.ws, "warn", "Only learned active skills can be equipped.");
        return;
      }
      if (!(p.ranks[id] >= 1)) {
        skillResult(room, sess, false, "loadout", "unlearned");
        room.toast(sess.ws, "warn", "That skill is not learned.");
        return;
      }
    }
    p.loadout = next;
    persistProgress(sess.playerId, true);
    skillResult(room, sess, true, "loadout");
    room.pushSnapshot(sess.playerId);
  });
}

export function handleSkillRespec(room, sess, pvpBusy) {
  return safe("respec", () => {
    if (!room || !sess) return;
    if (tooSoon(sess, "respec", 400)) {
      skillResult(room, sess, false, "respec", "rate");
      return;
    }
    if (pvpBusy) {
      skillResult(room, sess, false, "respec", "busy");
      room.toast(sess.ws, "warn", "You cannot respec in the middle of a fight.");
      return;
    }
    const p = getProgress(sess.playerId);
    const cost = RESPEC_ASH_PER_LEVEL * (p.level || 1);
    if (!debitAsh(sess.playerId, cost)) {
      skillResult(room, sess, false, "respec", "ash");
      room.toast(sess.ws, "warn", `Respec costs ${cost} Ash.`);
      return;
    }
    void persistAshNow(sess.playerId).catch((err) =>
      console.error("[prog] persist ash after respec", err.message)
    );
    p.ranks = defaultRanks();
    p.loadout = DEFAULT_LOADOUT.slice();
    p.respecs = (p.respecs || 0) + 1;
    applyPlayerStats(sess);
    persistProgress(sess.playerId, true);
    skillResult(room, sess, true, "respec");
    room.toast(sess.ws, "info", `Skills reset. ${cost} Ash paid.`);
    room.pushSnapshot(sess.playerId);
  });
}

export function handleDevGrantXp(room, sess, amount) {
  return safe("dev_xp", () => {
    if (process.env.NODE_ENV === "production" || process.env.SELVA_DEV_XP !== "1") return;
    if (!room || !sess) return;
    const n = Math.floor(Number(amount) || 0);
    if (!(n > 0) || n > 5_000_000) return;
    grantXp(room, sess.playerId, n, "dev", { skipPenalty: true });
    applyPlayerStats(sess);
    room.pushSnapshot(sess.playerId);
  });
}

function firstClearXpTotal(clears) {
  let n = 0;
  for (const c of clears || []) n += firstClearXp(c);
  return n;
}

function backfillInto(p, led) {
  const clears = led.firstClears instanceof Set ? [...led.firstClears] : [];
  const xp = firstClearXpTotal(clears);
  p.ranks = defaultRanks();
  p.loadout = DEFAULT_LOADOUT.slice();
  p.xp = xp;
  const lv = levelFromTotalXp(xp);
  p.level = lv.level;
  p.backfilled = true;
}

async function writeOne(playerId) {
  if (!dbEnabled()) return;
  const s = mem.get(playerId);
  if (!s) return;
  await query(
    `INSERT INTO player_progress (
       player_id, level, xp, ranks, loadout, backfilled, respecs, catchup_v, tutorial_v, updated_at
     ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9, NOW())
     ON CONFLICT (player_id) DO UPDATE SET
       level = EXCLUDED.level,
       xp = EXCLUDED.xp,
       ranks = EXCLUDED.ranks,
       loadout = EXCLUDED.loadout,
       backfilled = EXCLUDED.backfilled,
       respecs = EXCLUDED.respecs,
       catchup_v = GREATEST(player_progress.catchup_v, EXCLUDED.catchup_v),
       tutorial_v = GREATEST(player_progress.tutorial_v, EXCLUDED.tutorial_v),
       updated_at = NOW()
     -- Never let a blank/stale in-memory row (e.g. after a failed hydrate) roll back progress.
     WHERE EXCLUDED.xp >= player_progress.xp`,
    [
      playerId,
      s.level | 0,
      s.xp,
      JSON.stringify(s.ranks || {}),
      JSON.stringify(s.loadout || []),
      !!s.backfilled,
      s.respecs | 0,
      s.catchupV | 0,
      s.tutorialV | 0,
    ]
  );
}

function scheduleWrite(playerId) {
  if (!playerId || !dbEnabled()) return;
  dirty.delete(playerId);
  const prev = tails.get(playerId) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => writeOne(playerId))
    .catch((err) => console.error("[prog] persist failed", err.message));
  tails.set(playerId, next);
}

export function persistProgress(playerId, immediate) {
  if (!playerId || !dbEnabled()) return;
  dirty.add(playerId);
  if (immediate) {
    const t = xpTimers.get(playerId);
    if (t) {
      clearTimeout(t);
      xpTimers.delete(playerId);
    }
    scheduleWrite(playerId);
    return;
  }
  if (xpTimers.has(playerId)) return;
  xpTimers.set(
    playerId,
    setTimeout(() => {
      xpTimers.delete(playerId);
      scheduleWrite(playerId);
    }, 10_000)
  );
}

export async function flushProgression() {
  for (const [id, t] of xpTimers) {
    clearTimeout(t);
    xpTimers.delete(id);
    scheduleWrite(id);
  }
  for (const id of [...dirty]) scheduleWrite(id);
  const pending = [...tails.values()];
  if (!pending.length) return;
  await Promise.all(pending);
}

export async function hydrateProgression() {
  if (!dbEnabled()) {
    for (const [id, led] of players) {
      if (mem.has(id)) continue;
      const p = blankProgress(id);
      if (led?.firstClears instanceof Set && led.firstClears.size) backfillInto(p, led);
      mem.set(id, p);
    }
    return;
  }
  try {
    const r = await query(
      `SELECT player_id, level, xp, ranks, loadout, backfilled, respecs, catchup_v, tutorial_v FROM player_progress`
    );
    for (const row of r.rows) {
      const id = String(row.player_id);
      mem.set(id, sanitizeRow(row, id));
    }
    console.log(`[prog] hydrated ${r.rowCount} rows`);
  } catch (err) {
    // Without the rows we can't tell veterans from newcomers: skip the backfill
    // writes (the upsert guard also refuses to lower stored xp).
    console.error("[prog] hydrate failed — backfill skipped", err.message);
    return;
  }
  try {
    const clears = await query(
      `SELECT player_id, canto_id FROM first_clears WHERE cleared_at < to_timestamp($1/1000.0)`,
      [CATCHUP_CUTOFF_MS]
    );
    preLaunchClears.clear();
    for (const row of clears.rows) {
      const id = String(row.player_id);
      let set = preLaunchClears.get(id);
      if (!set) {
        set = new Set();
        preLaunchClears.set(id, set);
      }
      set.add(String(row.canto_id));
    }
    catchupReady = true;
    console.log(`[prog] catch-up v${CATCHUP_VERSION} ready (${preLaunchClears.size} veterans)`);
  } catch (err) {
    catchupReady = false;
    console.error("[prog] catch-up load failed", err.message);
  }
  try {
    for (const [id, led] of players) {
      if (mem.has(id)) continue;
      const p = blankProgress(id);
      if (led?.firstClears instanceof Set && led.firstClears.size) backfillInto(p, led);
      else p.backfilled = true;
      mem.set(id, p);
      persistProgress(id, true);
    }
  } catch (err) {
    console.error("[prog] backfill failed", err.message);
  }
}

export { FREE_SKILLS, spentPoints, unspentPoints };
