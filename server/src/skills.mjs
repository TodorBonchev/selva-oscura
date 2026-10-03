/**
 * Skill tree — server authority. 24 skills, 4 branches.
 * spells.mjs keeps the rank-1 numbers for gale_bolt / whirl_ward / infernal_burst;
 * this module ranks them and owns every new skill. Combat helpers are called from
 * room.mjs; they must not throw into the tick loop.
 */
import { SPELLS, PLAYER_MAX_MANA } from "./spells.mjs";
import { wrapDelta } from "./wrap.mjs";
import {
  pvpAreOpponents,
  pvpCanHit,
  pvpHit,
  pvpIsDown,
} from "./pvp.mjs";
import {
  getProgress,
  playerCombatStats,
  rankOf,
} from "./progression.mjs";

export const BRANCHES = {
  ira: { id: "ira", name: "Wrath", subtitle: "Melee" },
  fede: { id: "fede", name: "Faith", subtitle: "Holy fire" },
  ombra: { id: "ombra", name: "Shade", subtitle: "Wind" },
  fortezza: { id: "fortezza", name: "Fortitude", subtitle: "Guard" },
};

/** Character level required to put a point in a skill of this tier. Ult overrides. */
export const TIER_LEVEL = { 1: 1, 2: 6, 3: 12, 4: 18, 5: 24 };

export const FREE_SKILLS = ["gale_bolt", "whirl_ward", "infernal_burst"];
export const DEFAULT_LOADOUT = ["gale_bolt", "whirl_ward", "infernal_burst", null];
export const LOADOUT_SIZE = 4;
export const MAX_RANK = 5;

const RANK_DMG = 0.13;
const RANK_MANA = 0.05;
const RANK_CD = -0.03;

/**
 * @typedef {object} SkillDef
 * @property {string} id
 * @property {string} name
 * @property {string} branch
 * @property {"active"|"passive"} type
 * @property {number} tier
 * @property {number} [requiredLevel]
 * @property {number} maxRank
 * @property {{id:string, rank:number}[]} prereqs
 * @property {number} [manaCost]
 * @property {number} [cooldown]
 * @property {number} [range]
 * @property {number} [radius]
 * @property {object} [pvp]
 */

export const SKILLS = {
  furious_cleave: {
    id: "furious_cleave",
    name: "Furious Cleave",
    branch: "ira",
    type: "active",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    manaCost: 10,
    cooldown: 4,
    radius: 4,
    arcDeg: 120,
    weaponMult: 1.5,
    rankDmg: 0.15,
    pvp: { capKind: "furious_cleave" },
  },
  ferocia: {
    id: "ferocia",
    name: "Ferocity",
    branch: "ira",
    type: "passive",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    meleeDmgPerRank: 0.06,
  },
  wrath_charge: {
    id: "wrath_charge",
    name: "Wrath Charge",
    branch: "ira",
    type: "active",
    tier: 2,
    maxRank: 5,
    prereqs: [{ id: "furious_cleave", rank: 1 }],
    manaCost: 16,
    cooldown: 7,
    range: 9,
    weaponMult: 1.8,
    stun: 0.6,
    pvp: { capKind: "wrath_charge", stun: 0, slow: 0.55, slowDur: 0.25 },
  },
  war_cry: {
    id: "war_cry",
    name: "War Cry",
    branch: "ira",
    type: "active",
    tier: 3,
    maxRank: 5,
    prereqs: [{ id: "ferocia", rank: 2 }],
    manaCost: 22,
    cooldown: 16,
    radius: 6,
    selfDmg: 0.2,
    selfDmgPerRank: 0.04,
    duration: 6,
    weaken: 0.15,
    weakenDur: 4,
  },
  bloodthirst: {
    id: "bloodthirst",
    name: "Bloodthirst",
    branch: "ira",
    type: "passive",
    tier: 3,
    maxRank: 5,
    prereqs: [{ id: "ferocia", rank: 1 }],
    lifestealPerRank: 0.03,
    pvp: { lifestealScale: 0.5 },
  },
  earthsplitter: {
    id: "earthsplitter",
    name: "Earthsplitter",
    branch: "ira",
    type: "active",
    tier: 5,
    requiredLevel: 24,
    maxRank: 5,
    prereqs: [{ id: "wrath_charge", rank: 3 }],
    manaCost: 34,
    cooldown: 14,
    length: 12,
    width: 3,
    weaponMult: 2.6,
    rankDmg: 0.15,
    stagger: 0.45,
    pvp: { capKind: "earthsplitter" },
  },
  infernal_burst: {
    id: "infernal_burst",
    name: "Infernal Burst",
    branch: "fede",
    type: "active",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    manaCost: SPELLS.infernal_burst.manaCost,
    cooldown: SPELLS.infernal_burst.cooldown,
    radius: SPELLS.infernal_burst.radius,
    baseDamage: SPELLS.infernal_burst.baseDamage,
    damageVar: SPELLS.infernal_burst.damageVar,
    pvp: { capKind: "infernal_burst" },
  },
  lance_of_light: {
    id: "lance_of_light",
    name: "Lance of Light",
    branch: "fede",
    type: "active",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    manaCost: 16,
    cooldown: 3,
    range: 12,
    width: 1.35,
    baseDamage: 28,
    damageVar: 8,
    gear: 0.6,
    pvp: { capKind: "lance_of_light" },
  },
  grace: {
    id: "grace",
    name: "Grace",
    branch: "fede",
    type: "active",
    tier: 2,
    maxRank: 5,
    prereqs: [{ id: "lance_of_light", rank: 1 }],
    manaCost: 30,
    cooldown: 18,
    radius: 6,
    healPct: 0.18,
    healPctPerRank: 0.04,
    hotPct: 0.02,
    hotDur: 4,
  },
  pillar_of_flame: {
    id: "pillar_of_flame",
    name: "Pillar of Flame",
    branch: "fede",
    type: "active",
    tier: 3,
    maxRank: 5,
    prereqs: [{ id: "infernal_burst", rank: 2 }],
    manaCost: 28,
    cooldown: 9,
    range: 11,
    radius: 2.6,
    telegraph: 0.6,
    baseDamage: 58,
    damageVar: 12,
    gear: 0.85,
    burnDur: 3,
    burnTick: 0.5,
    burnDmg: 14,
    pvp: { capKind: "pillar_of_flame", burnKind: "pillar_burn" },
  },
  fervore: {
    id: "fervore",
    name: "Fervor",
    branch: "fede",
    type: "passive",
    tier: 2,
    maxRank: 5,
    prereqs: [],
    spellDmgPerRank: 0.07,
  },
  halo: {
    id: "halo",
    name: "Halo",
    branch: "fede",
    type: "active",
    tier: 5,
    requiredLevel: 30,
    maxRank: 5,
    prereqs: [{ id: "pillar_of_flame", rank: 3 }],
    manaCost: 45,
    cooldown: 30,
    radius: 4.5,
    duration: 8,
    tick: 0.5,
    baseDamage: 16,
    gear: 0.28,
    pvp: { capKind: "halo" },
  },
  gale_bolt: {
    id: "gale_bolt",
    name: "Gale Bolt",
    branch: "ombra",
    type: "active",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    manaCost: SPELLS.gale_bolt.manaCost,
    cooldown: SPELLS.gale_bolt.cooldown,
    range: SPELLS.gale_bolt.range,
    baseDamage: SPELLS.gale_bolt.baseDamage,
    damageVar: SPELLS.gale_bolt.damageVar,
    pvp: { capKind: "gale_bolt" },
  },
  shadow_step: {
    id: "shadow_step",
    name: "Shadow Step",
    branch: "ombra",
    type: "active",
    tier: 2,
    maxRank: 5,
    prereqs: [{ id: "gale_bolt", rank: 1 }],
    manaCost: 14,
    cooldown: 8,
    cooldownPerRank: -0.5,
    range: 10,
    iframes: 0.4,
  },
  snare_glyph: {
    id: "snare_glyph",
    name: "Snare Glyph",
    branch: "ombra",
    type: "active",
    tier: 2,
    maxRank: 5,
    prereqs: [],
    manaCost: 14,
    cooldown: 6,
    range: 8,
    radius: 1.8,
    root: 1.5,
    duration: 20,
    maxActive: 2,
    baseDamage: 22,
    gear: 0.4,
    pvp: { capKind: "snare_glyph", root: 0.6 },
  },
  summon_shade: {
    id: "summon_shade",
    name: "Summon Shade",
    branch: "ombra",
    type: "active",
    tier: 3,
    maxRank: 5,
    prereqs: [{ id: "snare_glyph", rank: 1 }],
    manaCost: 30,
    cooldown: 20,
    duration: 12,
    durationPerRank: 2,
    tick: 0.9,
    aggro: 7,
    baseDamage: 14,
    gear: 0.32,
    pvp: { capKind: "summon_shade" },
  },
  silenzio: {
    id: "silenzio",
    name: "Silence",
    branch: "ombra",
    type: "passive",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    manaRegenPerRank: 0.08,
    cdrPerRank: 0.03,
  },
  tempest: {
    id: "tempest",
    name: "Tempest",
    branch: "ombra",
    type: "active",
    tier: 5,
    requiredLevel: 30,
    maxRank: 5,
    prereqs: [{ id: "summon_shade", rank: 2 }],
    manaCost: 44,
    cooldown: 26,
    range: 10,
    radius: 4,
    duration: 4,
    tick: 0.4,
    baseDamage: 18,
    gear: 0.32,
    pvp: { capKind: "tempest" },
  },
  whirl_ward: {
    id: "whirl_ward",
    name: "Whirl Ward",
    branch: "fortezza",
    type: "active",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    manaCost: SPELLS.whirl_ward.manaCost,
    cooldown: SPELLS.whirl_ward.cooldown,
    duration: SPELLS.whirl_ward.duration,
    armorBonus: SPELLS.whirl_ward.armorBonus,
  },
  stone_skin: {
    id: "stone_skin",
    name: "Stone Skin",
    branch: "fortezza",
    type: "passive",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    armorPerRank: 6,
  },
  vigor: {
    id: "vigor",
    name: "Vigor",
    branch: "fortezza",
    type: "passive",
    tier: 2,
    maxRank: 5,
    prereqs: [],
    hpPctPerRank: 0.05,
  },
  bastion: {
    id: "bastion",
    name: "Bastion",
    branch: "fortezza",
    type: "active",
    tier: 3,
    maxRank: 5,
    prereqs: [{ id: "whirl_ward", rank: 2 }],
    manaCost: 20,
    cooldown: 20,
    duration: 2.5,
    dr: 0.55,
    drPerRank: 0.03,
    pvp: { drCap: 0.4 },
  },
  thorns: {
    id: "thorns",
    name: "Thorns",
    branch: "fortezza",
    type: "passive",
    tier: 3,
    maxRank: 5,
    prereqs: [{ id: "stone_skin", rank: 2 }],
    reflectPerRank: 0.08,
    pvp: { reflectScale: 0.5 },
  },
  last_stand: {
    id: "last_stand",
    name: "Last Stand",
    branch: "fortezza",
    type: "passive",
    tier: 4,
    requiredLevel: 18,
    maxRank: 5,
    prereqs: [{ id: "vigor", rank: 3 }],
    cooldown: 120,
    cooldownPerRank: -10,
    invuln: 1,
    pvp: { oncePerLife: true },
  },
};

export const SKILL_IDS = Object.keys(SKILLS);

export function skillById(id) {
  return SKILLS[String(id || "")] || null;
}

export function requiredLevel(def) {
  if (!def) return 99;
  if (def.requiredLevel != null) return def.requiredLevel;
  return TIER_LEVEL[def.tier] || 1;
}

export function defaultRanks() {
  return { gale_bolt: 1, whirl_ward: 1, infernal_burst: 1 };
}

export function spentPoints(ranks) {
  let n = 0;
  const r = ranks && typeof ranks === "object" ? ranks : {};
  for (const [id, raw] of Object.entries(r)) {
    const def = SKILLS[id];
    if (!def) continue;
    const rank = Math.max(0, Math.min(def.maxRank, Math.floor(Number(raw) || 0)));
    if (FREE_SKILLS.includes(id)) n += Math.max(0, rank - 1);
    else n += rank;
  }
  return n;
}

export function unspentPoints(level, ranks) {
  const avail = Math.max(0, (Math.floor(Number(level) || 1) || 1) - 1);
  return Math.max(0, avail - spentPoints(ranks));
}

export function canLearn(def, progress) {
  if (!def || !progress) return { ok: false, error: "unknown" };
  const rank = Math.floor(Number(progress.ranks?.[def.id]) || 0);
  if (rank >= def.maxRank) return { ok: false, error: "max_rank" };
  if ((progress.level || 1) < requiredLevel(def)) return { ok: false, error: "level" };
  for (const p of def.prereqs || []) {
    if ((Math.floor(Number(progress.ranks?.[p.id]) || 0)) < p.rank) {
      return { ok: false, error: "prereq" };
    }
  }
  if (unspentPoints(progress.level, progress.ranks) < 1) return { ok: false, error: "no_points" };
  return { ok: true };
}

export function sanitizeRanks(ranks, level) {
  const out = defaultRanks();
  const src = ranks && typeof ranks === "object" && !Array.isArray(ranks) ? ranks : {};
  for (const [id, raw] of Object.entries(src)) {
    const def = SKILLS[id];
    if (!def) continue;
    const n = Math.max(0, Math.min(def.maxRank, Math.floor(Number(raw) || 0)));
    if (n > 0) out[id] = n;
  }
  for (const id of FREE_SKILLS) if (!(out[id] > 0)) out[id] = 1;
  const cap = Math.max(0, (Math.floor(Number(level) || 1) || 1) - 1);
  if (spentPoints(out) > cap) return defaultRanks();
  return out;
}

export function sanitizeLoadout(slots, ranks) {
  const r = ranks || {};
  const seen = new Set();
  const out = [];
  const list = Array.isArray(slots) ? slots.slice(0, LOADOUT_SIZE) : [];
  for (const raw of list) {
    if (raw == null || raw === "") {
      out.push(null);
      continue;
    }
    if (typeof raw !== "string" || raw.length > 40) {
      out.push(null);
      continue;
    }
    const def = SKILLS[raw];
    if (!def || def.type !== "active" || !(r[raw] >= 1) || seen.has(raw)) {
      out.push(null);
      continue;
    }
    seen.add(raw);
    out.push(raw);
  }
  while (out.length < LOADOUT_SIZE) out.push(null);
  if (!out.some(Boolean)) return DEFAULT_LOADOUT.slice();
  return out;
}

export function inLoadout(progress, skillId) {
  const slots = progress?.loadout;
  if (!Array.isArray(slots)) return FREE_SKILLS.includes(skillId);
  return slots.includes(skillId);
}

export function cdMultiplier(playerId) {
  const sil = rankOf(playerId, "silenzio");
  return Math.max(0.7, 1 - 0.03 * sil);
}

export function manaCostFor(def, rank) {
  const r = Math.max(1, rank | 0);
  return Math.max(1, Math.round((def.manaCost || 0) * (1 + RANK_MANA * (r - 1))));
}

export function cooldownFor(def, rank, playerId) {
  const r = Math.max(1, rank | 0);
  let cd = def.cooldown || 0;
  if (def.cooldownPerRank) cd = Math.max(0.4, cd + def.cooldownPerRank * (r - 1));
  else cd = Math.max(0.4, cd * (1 + RANK_CD * (r - 1)));
  return +(cd * cdMultiplier(playerId)).toFixed(3);
}

/** Rank-1 existing spells stay bit-identical; higher ranks scale dmg/radius/armor. */
export function runtimeExisting(id, rank, playerId) {
  const base = SPELLS[id];
  if (!base) return null;
  const r = Math.max(1, rank | 0);
  const dmgScale = 1 + RANK_DMG * (r - 1);
  const sizeScale = 1 + 0.08 * (r - 1);
  const out = {
    id: base.id,
    name: base.name,
    manaCost: manaCostFor({ manaCost: base.manaCost }, r),
    cooldown: cooldownFor({ cooldown: base.cooldown }, r, playerId),
  };
  if (base.range != null) out.range = +(base.range * sizeScale).toFixed(2);
  if (base.radius != null) out.radius = +(base.radius * sizeScale).toFixed(2);
  if (base.baseDamage != null) out.baseDamage = Math.round(base.baseDamage * dmgScale);
  if (base.damageVar != null) out.damageVar = base.damageVar;
  if (base.duration != null) out.duration = +(base.duration * sizeScale).toFixed(2);
  if (base.armorBonus != null) out.armorBonus = Math.round(base.armorBonus * dmgScale);
  return out;
}

export function meleeDmgMult(playerId, pvp) {
  const fer = rankOf(playerId, "ferocia") * 0.06;
  const scale = pvp ? 0.5 : 1;
  return 1 + fer * scale;
}

export function spellDmgMult(playerId, pvp) {
  const fer = rankOf(playerId, "fervore") * 0.07;
  const scale = pvp ? 0.5 : 1;
  return 1 + fer * scale;
}

export function lifestealPct(playerId, pvp) {
  const r = rankOf(playerId, "bloodthirst");
  if (r <= 0) return 0;
  return r * 0.03 * (pvp ? 0.5 : 1);
}

export function thornsPct(playerId, pvp) {
  const r = rankOf(playerId, "thorns");
  if (r <= 0) return 0;
  return r * 0.08 * (pvp ? 0.5 : 1);
}

export function warCryMult(sess) {
  if (!sess || !(sess.warCryUntil > Date.now())) return 1;
  return sess.warCryMult || 1;
}

export function weakenMult(sess) {
  if (!sess || !(sess.weakenUntil > Date.now())) return 1;
  return sess.weakenMult || 1;
}

export function bastionDr(sess, pvp) {
  if (!sess || !(sess.bastionUntil > Date.now())) return 0;
  let dr = sess.bastionDr || 0;
  if (pvp) dr = Math.min(dr, 0.4);
  return dr;
}

export function bastionActive(sess) {
  return !!(sess && sess.bastionUntil > Date.now());
}

export function lastStandCooldown(playerId) {
  const def = SKILLS.last_stand;
  const r = Math.max(1, rankOf(playerId, "last_stand"));
  return Math.max(30, def.cooldown + def.cooldownPerRank * (r - 1));
}

/**
 * Lethal blow interceptor. Returns true if the blow was converted to 1 HP + iframes.
 * PvP: once per life (sess.lastStandUsedLife). PvE: wall-clock cooldown.
 */
export function tryLastStand(sess, pvp) {
  if (!sess || rankOf(sess.playerId, "last_stand") < 1) return false;
  const now = Date.now();
  if (pvp) {
    if (sess.lastStandUsedLife) return false;
    sess.lastStandUsedLife = true;
  } else {
    if ((sess.lastStandReadyAt || 0) > now) return false;
    sess.lastStandReadyAt = now + lastStandCooldown(sess.playerId) * 1000;
  }
  sess.hp = 1;
  sess.iframes = Math.max(sess.iframes || 0, 1);
  if (pvp) sess.pvpInvulnUntil = Math.max(sess.pvpInvulnUntil || 0, now + 1000);
  return true;
}

export function resetLastStandLife(sess) {
  if (sess) sess.lastStandUsedLife = false;
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

function distTo(room, a, b) {
  const d = delta(room, a, b);
  return Math.hypot(d.x, d.y);
}

function distToSeg(room, p, x1, y1, x2, y2) {
  const a = { x: x1, y: y1 };
  const d1 = delta(room, a, p);
  const d2 = delta(room, a, { x: x2, y: y2 });
  const l2 = d2.x * d2.x + d2.y * d2.y || 1;
  const u = Math.max(0, Math.min(1, (d1.x * d2.x + d1.y * d2.y) / l2));
  return Math.hypot(d1.x - d2.x * u, d1.y - d2.y * u);
}

function aimDir(sess, aimX, aimY) {
  if (Number.isFinite(aimX) && Number.isFinite(aimY) && Math.hypot(aimX, aimY) > 1e-6) {
    const len = Math.hypot(aimX, aimY);
    return { x: aimX / len, y: aimY / len };
  }
  const fx = sess._lastFaceX;
  const fy = sess._lastFaceY;
  if (Number.isFinite(fx) && Number.isFinite(fy) && Math.hypot(fx, fy) > 1e-6) {
    const len = Math.hypot(fx, fy);
    return { x: fx / len, y: fy / len };
  }
  return { x: 1, y: 0 };
}

function aimPoint(sess, aimX, aimY, range) {
  const dir = aimDir(sess, aimX, aimY);
  const has = Number.isFinite(aimX) && Number.isFinite(aimY) && Math.hypot(aimX, aimY) > 1e-6;
  const span = has ? Math.min(range, Math.hypot(aimX, aimY)) : range;
  return { x: sess.x + dir.x * span, y: sess.y + dir.y * span, dir };
}

function placeAt(room, x, y) {
  const b = room.canto.geo.bounds;
  if (room.canto.geo.wrap === false) {
    return {
      x: Math.max(1, Math.min(Math.max(1, b.width - 1), x)),
      y: Math.max(1, Math.min(Math.max(1, b.height - 1), y)),
    };
  }
  const wx = ((x % b.width) + b.width) % b.width;
  const wy = ((y % b.height) + b.height) % b.height;
  return { x: wx, y: wy };
}

function dashEnd(room, sess, fromX, fromY, toX, toY, dx, dy) {
  let ux = toX;
  let uy = toY;
  if (room.mech?.adjustDash) {
    try {
      const to = room.mech.adjustDash(room, sess, fromX, fromY, ux, uy, dx, dy);
      if (to && Number.isFinite(to.x) && Number.isFinite(to.y)) {
        ux = to.x;
        uy = to.y;
      }
    } catch (err) {
      console.error("[skills] adjustDash", err.message);
    }
  }
  return placeAt(room, ux, uy);
}

function fxMap(room) {
  if (!room._skillFx) room._skillFx = new Map();
  return room._skillFx;
}

let fxSeq = 1;
function addFx(room, spec) {
  const id = spec.id || `sfx_${fxSeq++}`;
  const fx = { ...spec, id };
  fxMap(room).set(id, fx);
  room.markDirty();
  return fx;
}

export function cleanupPlayerSkills(room, playerId) {
  if (!room || !playerId) return;
  const m = room._skillFx;
  if (!m) return;
  for (const [id, fx] of [...m]) {
    if (fx.owner === playerId) m.delete(id);
  }
  const sess = room.sessions.get(playerId);
  if (sess) {
    sess.haloUntil = 0;
    sess.graceHotUntil = 0;
    sess.warCryUntil = 0;
    sess.bastionUntil = 0;
  }
  room.markDirty();
}

export function skillFxSnapshot(room) {
  const m = room?._skillFx;
  if (!m || m.size === 0) return undefined;
  const out = [];
  for (const fx of m.values()) {
    out.push({
      id: fx.id,
      kind: fx.kind,
      x: Math.round(fx.x * 100) / 100,
      y: Math.round(fx.y * 100) / 100,
      r: fx.r,
      owner: fx.owner,
      ttl: Math.round((fx.ttl || 0) * 10) / 10,
    });
  }
  return out;
}

function spellDmg(playerId, base, gearFrac, rank, pvp, extraVar = 0) {
  const st = playerCombatStats(playerId);
  const r = Math.max(1, rank | 0);
  const scale = 1 + RANK_DMG * (r - 1);
  let raw = (base + (st.gear?.dmg || 0) * gearFrac) * scale * spellDmgMult(playerId, pvp);
  if (extraVar) raw += Math.floor(Math.random() * (extraVar + 1));
  return Math.max(1, Math.round(raw));
}

function weaponHit(playerId, mult, rank, pvp, rankDmg = RANK_DMG) {
  const st = playerCombatStats(playerId);
  const r = Math.max(1, rank | 0);
  const scale = 1 + rankDmg * (r - 1);
  let raw = st.weaponDmg * mult * scale * meleeDmgMult(playerId, pvp);
  if (!pvp) raw *= warCryMult(pvpSess(playerId)) * weakenMult(pvpSess(playerId));
  return Math.max(1, Math.round(raw));
}

/** Weak map of last-seen sessions so weaponHit can read war-cry without a room. */
const sessHint = new Map();
function pvpSess(playerId) {
  return sessHint.get(playerId) || null;
}

function remember(sess) {
  if (sess?.playerId) sessHint.set(sess.playerId, sess);
}

function hitMob(room, caster, ent, raw, spellId, extra = {}) {
  if (!ent || ent._dead) return 0;
  return room.damageMob(ent, raw, caster.playerId, {
    spellId,
    from: extra.from || caster,
    heavy: extra.heavy,
    kbMul: extra.kbMul,
  });
}

function hitFoe(room, caster, target, raw, kind, extra = {}) {
  if (target.playerId) {
    return pvpHit(room, caster, target, raw, kind) || 0;
  }
  return hitMob(room, caster, target, raw, kind, extra);
}

function livingMobs(room) {
  const out = [];
  for (const e of room.entities.values()) {
    if ((e.kind === "mob" || e.kind === "boss") && e.hp > 0 && !e._dead) out.push(e);
  }
  return out;
}

function stunMob(e, sec) {
  if (!e) return;
  e.stunLeft = Math.max(e.stunLeft || 0, sec);
}

function rootMob(e, sec) {
  if (!e) return;
  e.rootLeft = Math.max(e.rootLeft || 0, sec);
}

function staggerMob(e, sec) {
  if (!e) return;
  e.staggerLeft = Math.max(e.staggerLeft || 0, sec);
}

function weakenMob(e, sec, mult = 0.85) {
  if (!e) return;
  e.weakenLeft = Math.max(e.weakenLeft || 0, sec);
  e.weakenMult = mult;
}

function broadcastFx(room, payload) {
  room.broadcast({ type: "spell_fx", ...payload });
}

function spend(room, sess, def, rank) {
  const cost = manaCostFor(def, rank);
  const cd = cooldownFor(def, rank, sess.playerId);
  sess.mana = Math.max(0, sess.mana - cost);
  if (!sess.spellCd) sess.spellCd = {};
  sess.spellCd[def.id] = cd;
  if (!sess.spellReadyAt) sess.spellReadyAt = {};
  const now = Date.now();
  sess.spellReadyAt[def.id] = Math.max(now, sess.spellReadyAt[def.id] || 0) + cd * 1000;
  remember(sess);
}

function reject(room, sess, text) {
  room.toast(sess.ws, "warn", text);
}

/**
 * Validate loadout/rank/mana/cd and dispatch. Existing three spells return
 * `{ existing: true, spell }` so room.mjs can keep its gale/ward/burst paths.
 */
export function beginCast(room, sess, spellId, aimX, aimY) {
  const id = String(spellId || "");
  if (id.length > 40) {
    reject(room, sess, "Unknown spell.");
    return null;
  }
  const def = SKILLS[id];
  if (!def || def.type !== "active") {
    reject(room, sess, "Unknown spell.");
    return null;
  }
  const prog = getProgress(sess.playerId);
  const rank = Math.floor(Number(prog.ranks?.[id]) || 0);
  if (rank < 1) {
    reject(room, sess, "Unknown spell.");
    return null;
  }
  if (!inLoadout(prog, id)) {
    reject(room, sess, `${def.name} is not in your loadout.`);
    return null;
  }
  const readyAt = sess.spellReadyAt?.[id] || 0;
  if (Date.now() < readyAt - 150) {
    reject(room, sess, `${def.name} recharging…`);
    return null;
  }
  const cost = manaCostFor(def, rank);
  if (sess.mana < cost) {
    reject(room, sess, `Not enough mana for ${def.name} (${cost}).`);
    room.send(sess.ws, {
      type: "spell_fx",
      spellId: "mana_deny",
      casterId: sess.playerId,
      x: sess.x,
      y: sess.y,
    });
    return null;
  }
  if (id === "gale_bolt" || id === "whirl_ward" || id === "infernal_burst") {
    return { existing: true, spell: runtimeExisting(id, rank, sess.playerId), def, rank };
  }
  return { existing: false, def, rank, aimX, aimY };
}

export function castActive(room, sess, def, rank, aimX, aimY) {
  remember(sess);
  const dir = aimDir(sess, aimX, aimY);
  sess._lastFaceX = dir.x;
  sess._lastFaceY = dir.y;
  switch (def.id) {
    case "furious_cleave":
      return castCleave(room, sess, def, rank, dir);
    case "wrath_charge":
      return castCharge(room, sess, def, rank, dir);
    case "war_cry":
      return castWarCry(room, sess, def, rank);
    case "earthsplitter":
      return castEarthsplitter(room, sess, def, rank, dir);
    case "lance_of_light":
      return castLance(room, sess, def, rank, dir);
    case "grace":
      return castGrace(room, sess, def, rank);
    case "pillar_of_flame":
      return castPillar(room, sess, def, rank, aimX, aimY);
    case "halo":
      return castHalo(room, sess, def, rank);
    case "shadow_step":
      return castShadowStep(room, sess, def, rank, aimX, aimY);
    case "snare_glyph":
      return castGlyph(room, sess, def, rank, aimX, aimY);
    case "summon_shade":
      return castShade(room, sess, def, rank);
    case "tempest":
      return castTempest(room, sess, def, rank, aimX, aimY);
    case "bastion":
      return castBastion(room, sess, def, rank);
    default:
      reject(room, sess, "Unknown spell.");
  }
}

function castCleave(room, sess, def, rank, dir) {
  spend(room, sess, def, rank);
  const pvp = false;
  const rawPve = weaponHit(sess.playerId, def.weaponMult, rank, false, def.rankDmg);
  const rawPvp = weaponHit(sess.playerId, def.weaponMult, rank, true, def.rankDmg);
  const hits = [];
  const half = ((def.arcDeg || 120) * Math.PI) / 180 / 2;
  const cosMin = Math.cos(half);
  for (const e of livingMobs(room)) {
    const dlt = delta(room, sess, e);
    const d = Math.hypot(dlt.x, dlt.y);
    if (d > def.radius) continue;
    if (d >= 0.2) {
      const dot = (dlt.x / d) * dir.x + (dlt.y / d) * dir.y;
      if (dot < cosMin) continue;
    }
    hitMob(room, sess, e, rawPve, def.id, { heavy: true });
    hits.push(e.id);
  }
  for (const t of room.sessions.values()) {
    if (t === sess || !(t.hp > 0)) continue;
    if (!pvpCanHit(room, sess, t)) continue;
    const dlt = delta(room, sess, t);
    const d = Math.hypot(dlt.x, dlt.y);
    if (d > def.radius) continue;
    if (d >= 0.2) {
      const dot = (dlt.x / d) * dir.x + (dlt.y / d) * dir.y;
      if (dot < cosMin) continue;
    }
    pvpHit(room, sess, t, rawPvp, def.id);
    hits.push(t.playerId);
  }
  broadcastFx(room, {
    spellId: def.id,
    casterId: sess.playerId,
    x: sess.x,
    y: sess.y,
    tx: sess.x + dir.x * def.radius,
    ty: sess.y + dir.y * def.radius,
    radius: def.radius,
    hits,
  });
  room.markDirty();
  void pvp;
}

function castCharge(room, sess, def, rank, dir) {
  spend(room, sess, def, rank);
  const fromX = sess.x;
  const fromY = sess.y;
  const step = def.range;
  let ux = fromX + dir.x * step;
  let uy = fromY + dir.y * step;
  const end = dashEnd(room, sess, fromX, fromY, ux, uy, dir.x, dir.y);
  ux = end.x;
  uy = end.y;
  const segX = ux - fromX;
  const segY = uy - fromY;
  const segL2 = segX * segX + segY * segY || 1;
  let best = null;
  let bestU = 2;
  for (const e of livingMobs(room)) {
    const u = Math.max(0, Math.min(1, ((e.x - fromX) * segX + (e.y - fromY) * segY) / segL2));
    const px = fromX + segX * u;
    const py = fromY + segY * u;
    if (Math.hypot(e.x - px, e.y - py) > 1.5) continue;
    if (u < bestU) {
      bestU = u;
      best = e;
    }
  }
  let pvpT = null;
  let pvpU = 2;
  for (const t of room.sessions.values()) {
    if (t === sess || !(t.hp > 0)) continue;
    if (!pvpCanHit(room, sess, t)) continue;
    const u = Math.max(0, Math.min(1, ((t.x - fromX) * segX + (t.y - fromY) * segY) / segL2));
    const px = fromX + segX * u;
    const py = fromY + segY * u;
    if (Math.hypot(t.x - px, t.y - py) > 1.5) continue;
    if (!pvpCanHit(room, sess, t)) continue;
    if (u < pvpU) {
      pvpU = u;
      pvpT = t;
    }
  }
  const usePvp = pvpT && pvpU <= bestU;
  const rawPve = weaponHit(sess.playerId, def.weaponMult, rank, false);
  const rawPvp = weaponHit(sess.playerId, def.weaponMult, rank, true);
  if (usePvp) {
    const stop = placeAt(room, pvpT.x - dir.x * 1.1, pvpT.y - dir.y * 1.1);
    sess.x = stop.x;
    sess.y = stop.y;
    pvpHit(room, sess, pvpT, rawPvp, def.id);
    const pv = def.pvp || {};
    room.statusPlayer(pvpT, { slow: pv.slow ?? 0.55, root: false, durMs: Math.round((pv.slowDur || 0.25) * 1000) });
  } else if (best) {
    const stop = placeAt(room, best.x - dir.x * 1.1, best.y - dir.y * 1.1);
    sess.x = stop.x;
    sess.y = stop.y;
    hitMob(room, sess, best, rawPve, def.id, { heavy: true });
    stunMob(best, def.stun);
  } else {
    sess.x = ux;
    sess.y = uy;
  }
  sess.iframes = Math.max(sess.iframes || 0, 0.2);
  broadcastFx(room, {
    spellId: def.id,
    casterId: sess.playerId,
    x: fromX,
    y: fromY,
    tx: sess.x,
    ty: sess.y,
    duration: 0.18,
  });
  room.markDirty();
}

function castWarCry(room, sess, def, rank) {
  spend(room, sess, def, rank);
  const bonus = def.selfDmg + def.selfDmgPerRank * (rank - 1);
  sess.warCryUntil = Date.now() + def.duration * 1000;
  sess.warCryMult = 1 + bonus;
  const hits = [];
  for (const e of livingMobs(room)) {
    if (distTo(room, sess, e) > def.radius) continue;
    weakenMob(e, def.weakenDur, 1 - def.weaken);
    hits.push(e.id);
  }
  for (const t of room.sessions.values()) {
    if (t === sess || !(t.hp > 0)) continue;
    if (!pvpCanHit(room, sess, t)) continue;
    if (distTo(room, sess, t) > def.radius) continue;
    t.weakenUntil = Date.now() + def.weakenDur * 1000;
    t.weakenMult = 1 - def.weaken;
    hits.push(t.playerId);
  }
  broadcastFx(room, {
    spellId: def.id,
    casterId: sess.playerId,
    x: sess.x,
    y: sess.y,
    radius: def.radius,
    duration: def.duration,
    hits,
  });
  room.toast(sess.ws, "info", `War Cry — +${Math.round(bonus * 100)}% damage`);
  room.markDirty();
}

function castEarthsplitter(room, sess, def, rank, dir) {
  spend(room, sess, def, rank);
  const x2 = sess.x + dir.x * def.length;
  const y2 = sess.y + dir.y * def.length;
  const halfW = def.width / 2;
  const rawPve = weaponHit(sess.playerId, def.weaponMult, rank, false, def.rankDmg);
  const rawPvp = weaponHit(sess.playerId, def.weaponMult, rank, true, def.rankDmg);
  const hits = [];
  for (const e of livingMobs(room)) {
    if (distToSeg(room, e, sess.x, sess.y, x2, y2) > halfW) continue;
    hitMob(room, sess, e, rawPve, def.id, { heavy: true, kbMul: 1.2 });
    staggerMob(e, def.stagger);
    stunMob(e, 0.25);
    hits.push(e.id);
  }
  for (const t of room.sessions.values()) {
    if (t === sess || !(t.hp > 0)) continue;
    if (!pvpCanHit(room, sess, t)) continue;
    if (distToSeg(room, t, sess.x, sess.y, x2, y2) > halfW) continue;
    pvpHit(room, sess, t, rawPvp, def.id);
    room.statusPlayer(t, { slow: 0.5, durMs: 250 });
    hits.push(t.playerId);
  }
  broadcastFx(room, {
    spellId: def.id,
    casterId: sess.playerId,
    x: sess.x,
    y: sess.y,
    tx: x2,
    ty: y2,
    radius: halfW,
    duration: 0.35,
    hits,
  });
  room.markDirty();
}

function castLance(room, sess, def, rank, dir) {
  spend(room, sess, def, rank);
  const x2 = sess.x + dir.x * def.range;
  const y2 = sess.y + dir.y * def.range;
  const rawPve = spellDmg(sess.playerId, def.baseDamage, def.gear, rank, false, def.damageVar);
  const rawPvp = spellDmg(sess.playerId, def.baseDamage, def.gear, rank, true, def.damageVar);
  const hits = [];
  for (const e of livingMobs(room)) {
    if (distToSeg(room, e, sess.x, sess.y, x2, y2) > def.width) continue;
    const along = delta(room, sess, e);
    const fwd = along.x * dir.x + along.y * dir.y;
    if (fwd < 0 || fwd > def.range) continue;
    hitMob(room, sess, e, rawPve, def.id);
    hits.push(e.id);
  }
  for (const t of room.sessions.values()) {
    if (t === sess || !(t.hp > 0)) continue;
    if (!pvpCanHit(room, sess, t)) continue;
    if (distToSeg(room, t, sess.x, sess.y, x2, y2) > def.width) continue;
    const along = delta(room, sess, t);
    const fwd = along.x * dir.x + along.y * dir.y;
    if (fwd < 0 || fwd > def.range) continue;
    pvpHit(room, sess, t, rawPvp, def.id);
    hits.push(t.playerId);
  }
  broadcastFx(room, {
    spellId: def.id,
    casterId: sess.playerId,
    x: sess.x,
    y: sess.y,
    tx: x2,
    ty: y2,
    duration: 0.16,
    hits,
  });
  room.markDirty();
}

function healSess(sess, amount) {
  if (!sess || !(sess.hp > 0) || pvpIsDown(sess)) return 0;
  const before = sess.hp;
  sess.hp = Math.min(sess.maxHp, sess.hp + amount);
  return sess.hp - before;
}

function applyGraceHot(sess, pct, dur) {
  sess.graceHotUntil = Date.now() + dur * 1000;
  sess.graceHotPct = pct;
}

function castGrace(room, sess, def, rank) {
  spend(room, sess, def, rank);
  const pct = def.healPct + def.healPctPerRank * (rank - 1);
  const instant = Math.round(sess.maxHp * pct);
  healSess(sess, instant);
  applyGraceHot(sess, def.hotPct, def.hotDur);
  const hits = [sess.playerId];
  for (const t of room.sessions.values()) {
    if (t === sess || !(t.hp > 0) || pvpIsDown(t)) continue;
    if (pvpAreOpponents(room, sess, t)) continue;
    if (distTo(room, sess, t) > def.radius) continue;
    healSess(t, Math.round(t.maxHp * pct));
    applyGraceHot(t, def.hotPct, def.hotDur);
    hits.push(t.playerId);
  }
  broadcastFx(room, {
    spellId: def.id,
    casterId: sess.playerId,
    x: sess.x,
    y: sess.y,
    radius: def.radius,
    duration: def.hotDur,
    hits,
  });
  room.toast(sess.ws, "loot", `Grace knits ${instant} life`);
  room.markDirty();
}

function castPillar(room, sess, def, rank, aimX, aimY) {
  spend(room, sess, def, rank);
  const pt = aimPoint(sess, aimX, aimY, def.range);
  const pos = placeAt(room, pt.x, pt.y);
  const owner = sess.playerId;
  broadcastFx(room, {
    spellId: def.id,
    casterId: owner,
    x: pos.x,
    y: pos.y,
    radius: def.radius,
    duration: def.telegraph,
  });
  room.schedule(def.telegraph, () => {
    try {
      const caster = room.sessions.get(owner);
      if (!caster || !(caster.hp > 0) || pvpIsDown(caster)) return;
      const rawPve = spellDmg(owner, def.baseDamage, def.gear, rank, false, def.damageVar);
      const rawPvp = spellDmg(owner, def.baseDamage, def.gear, rank, true, def.damageVar);
      const hits = [];
      for (const e of livingMobs(room)) {
        if (distTo(room, pos, e) > def.radius) continue;
        hitMob(room, caster, e, rawPve, def.id, { from: pos, heavy: true });
        hits.push(e.id);
      }
      for (const t of room.sessions.values()) {
        if (t === caster || !(t.hp > 0)) continue;
        if (!pvpCanHit(room, caster, t)) continue;
        if (distTo(room, pos, t) > def.radius) continue;
        pvpHit(room, caster, t, rawPvp, def.id);
        hits.push(t.playerId);
      }
      broadcastFx(room, {
        spellId: def.id,
        casterId: owner,
        x: pos.x,
        y: pos.y,
        radius: def.radius,
        duration: 0.35,
        hits,
      });
      addFx(room, {
        kind: "burn",
        x: pos.x,
        y: pos.y,
        r: def.radius,
        owner,
        ttl: def.burnDur,
        tick: def.burnTick,
        acc: 0,
        rank,
        dmg: Math.round(def.burnDmg * (1 + RANK_DMG * (rank - 1))),
      });
    } catch (err) {
      console.error("[skills] pillar land", err.message);
    }
  });
  room.markDirty();
}

function castHalo(room, sess, def, rank) {
  spend(room, sess, def, rank);
  for (const fx of [...fxMap(room).values()]) {
    if (fx.kind === "halo" && fx.owner === sess.playerId) fxMap(room).delete(fx.id);
  }
  addFx(room, {
    kind: "halo",
    x: sess.x,
    y: sess.y,
    r: def.radius,
    owner: sess.playerId,
    ttl: def.duration,
    tick: def.tick,
    acc: 0,
    rank,
  });
  sess.haloUntil = Date.now() + def.duration * 1000;
  broadcastFx(room, {
    spellId: def.id,
    casterId: sess.playerId,
    x: sess.x,
    y: sess.y,
    radius: def.radius,
    duration: def.duration,
  });
  room.markDirty();
}

function castShadowStep(room, sess, def, rank, aimX, aimY) {
  spend(room, sess, def, rank);
  const fromX = sess.x;
  const fromY = sess.y;
  const pt = aimPoint(sess, aimX, aimY, def.range);
  const dir = pt.dir;
  const end = dashEnd(room, sess, fromX, fromY, pt.x, pt.y, dir.x, dir.y);
  sess.x = end.x;
  sess.y = end.y;
  sess.iframes = Math.max(sess.iframes || 0, def.iframes);
  broadcastFx(room, {
    spellId: def.id,
    casterId: sess.playerId,
    x: fromX,
    y: fromY,
    tx: sess.x,
    ty: sess.y,
    duration: 0.12,
  });
  room.markDirty();
}

function castGlyph(room, sess, def, rank, aimX, aimY) {
  spend(room, sess, def, rank);
  const pt = aimPoint(sess, aimX, aimY, def.range);
  const pos = placeAt(room, pt.x, pt.y);
  const existing = [...fxMap(room).values()].filter((f) => f.kind === "glyph" && f.owner === sess.playerId);
  existing.sort((a, b) => a.ttl - b.ttl);
  while (existing.length >= def.maxActive) {
    const old = existing.shift();
    fxMap(room).delete(old.id);
  }
  addFx(room, {
    kind: "glyph",
    x: pos.x,
    y: pos.y,
    r: def.radius,
    owner: sess.playerId,
    ttl: def.duration,
    rank,
  });
  broadcastFx(room, {
    spellId: def.id,
    casterId: sess.playerId,
    x: pos.x,
    y: pos.y,
    radius: def.radius,
    duration: def.duration,
  });
  room.markDirty();
}

function castShade(room, sess, def, rank) {
  spend(room, sess, def, rank);
  for (const fx of [...fxMap(room).values()]) {
    if (fx.kind === "shade" && fx.owner === sess.playerId) fxMap(room).delete(fx.id);
  }
  const dur = def.duration + def.durationPerRank * (rank - 1);
  const face = aimDir(sess, sess._lastFaceX, sess._lastFaceY);
  const pos = placeAt(room, sess.x - face.x * 1.4, sess.y - face.y * 1.4);
  addFx(room, {
    kind: "shade",
    x: pos.x,
    y: pos.y,
    r: 0.7,
    owner: sess.playerId,
    ttl: dur,
    tick: def.tick,
    acc: 0.3,
    rank,
    aggro: def.aggro,
  });
  broadcastFx(room, {
    spellId: def.id,
    casterId: sess.playerId,
    x: pos.x,
    y: pos.y,
    duration: dur,
  });
  room.markDirty();
}

function castTempest(room, sess, def, rank, aimX, aimY) {
  spend(room, sess, def, rank);
  const pt = aimPoint(sess, aimX, aimY, def.range);
  const pos = placeAt(room, pt.x, pt.y);
  addFx(room, {
    kind: "vortex",
    x: pos.x,
    y: pos.y,
    r: def.radius,
    owner: sess.playerId,
    ttl: def.duration,
    tick: def.tick,
    acc: 0,
    rank,
  });
  broadcastFx(room, {
    spellId: def.id,
    casterId: sess.playerId,
    x: pos.x,
    y: pos.y,
    radius: def.radius,
    duration: def.duration,
  });
  room.markDirty();
}

function castBastion(room, sess, def, rank) {
  spend(room, sess, def, rank);
  const dr = def.dr + def.drPerRank * (rank - 1);
  sess.bastionUntil = Date.now() + def.duration * 1000;
  sess.bastionDr = dr;
  broadcastFx(room, {
    spellId: def.id,
    casterId: sess.playerId,
    x: sess.x,
    y: sess.y,
    radius: 1.8,
    duration: def.duration,
  });
  room.toast(sess.ws, "info", `Bastion — ${Math.round(dr * 100)}% less harm`);
  room.markDirty();
}

function tickHalo(room, fx, dt) {
  const owner = room.sessions.get(fx.owner);
  if (!owner || !(owner.hp > 0) || pvpIsDown(owner)) {
    fx.ttl = 0;
    return;
  }
  fx.x = owner.x;
  fx.y = owner.y;
  fx.acc = (fx.acc || 0) + dt;
  if (fx.acc < fx.tick) return;
  fx.acc -= fx.tick;
  const def = SKILLS.halo;
  const rawPve = spellDmg(fx.owner, def.baseDamage, def.gear, fx.rank, false);
  const rawPvp = spellDmg(fx.owner, def.baseDamage, def.gear, fx.rank, true);
  for (const e of livingMobs(room)) {
    if (distTo(room, fx, e) > fx.r) continue;
    hitMob(room, owner, e, rawPve, "halo", { from: fx });
  }
  for (const t of room.sessions.values()) {
    if (t === owner || !(t.hp > 0)) continue;
    if (!pvpCanHit(room, owner, t)) continue;
    if (distTo(room, fx, t) > fx.r) continue;
    pvpHit(room, owner, t, rawPvp, "halo");
  }
}

function tickBurn(room, fx, dt) {
  fx.acc = (fx.acc || 0) + dt;
  if (fx.acc < (fx.tick || 0.5)) return;
  fx.acc -= fx.tick || 0.5;
  const owner = room.sessions.get(fx.owner);
  if (!owner || !(owner.hp > 0) || pvpIsDown(owner)) return;
  const rawPve = Math.round((fx.dmg || 14) * spellDmgMult(fx.owner, false));
  const rawPvp = Math.round((fx.dmg || 14) * spellDmgMult(fx.owner, true));
  for (const e of livingMobs(room)) {
    if (distTo(room, fx, e) > fx.r) continue;
    hitMob(room, owner, e, rawPve, "pillar_of_flame", { from: fx });
  }
  for (const t of room.sessions.values()) {
    if (t === owner || !(t.hp > 0)) continue;
    if (!pvpCanHit(room, owner, t)) continue;
    if (distTo(room, fx, t) > fx.r) continue;
    pvpHit(room, owner, t, rawPvp, "pillar_burn");
  }
}

function tickGlyph(room, fx) {
  const owner = room.sessions.get(fx.owner);
  if (!owner || !(owner.hp > 0) || pvpIsDown(owner)) {
    fx.ttl = 0;
    return;
  }
  const def = SKILLS.snare_glyph;
  const rawPve = spellDmg(fx.owner, def.baseDamage, def.gear, fx.rank, false);
  const rawPvp = spellDmg(fx.owner, def.baseDamage, def.gear, fx.rank, true);
  for (const e of livingMobs(room)) {
    if (distTo(room, fx, e) > fx.r) continue;
    hitMob(room, owner, e, rawPve, "snare_glyph", { from: fx });
    rootMob(e, def.root);
    stunMob(e, 0.2);
    fx.ttl = 0;
    broadcastFx(room, {
      spellId: "snare_glyph",
      casterId: fx.owner,
      x: fx.x,
      y: fx.y,
      radius: fx.r,
      duration: 0.2,
      hits: [e.id],
    });
    return;
  }
  for (const t of room.sessions.values()) {
    if (t === owner || !(t.hp > 0)) continue;
    if (!pvpCanHit(room, owner, t)) continue;
    if (distTo(room, fx, t) > fx.r) continue;
    pvpHit(room, owner, t, rawPvp, "snare_glyph");
    room.statusPlayer(t, { root: true, durMs: Math.round((def.pvp.root || 0.6) * 1000) });
    fx.ttl = 0;
    broadcastFx(room, {
      spellId: "snare_glyph",
      casterId: fx.owner,
      x: fx.x,
      y: fx.y,
      radius: fx.r,
      duration: 0.2,
      hits: [t.playerId],
    });
    return;
  }
}

function tickShade(room, fx, dt) {
  const owner = room.sessions.get(fx.owner);
  if (!owner || !(owner.hp > 0) || pvpIsDown(owner)) {
    fx.ttl = 0;
    return;
  }
  const face = aimDir(owner, owner._lastFaceX, owner._lastFaceY);
  const tx = owner.x - face.x * 1.5;
  const ty = owner.y - face.y * 1.5;
  const dlt = { x: tx - fx.x, y: ty - fx.y };
  const d = Math.hypot(dlt.x, dlt.y);
  if (d > 0.25) {
    const step = Math.min(d, 5.8 * dt);
    fx.x += (dlt.x / d) * step;
    fx.y += (dlt.y / d) * step;
    const p = placeAt(room, fx.x, fx.y);
    fx.x = p.x;
    fx.y = p.y;
  }
  fx.acc = (fx.acc || 0) + dt;
  if (fx.acc < fx.tick) return;
  fx.acc -= fx.tick;
  const def = SKILLS.summon_shade;
  const rawPve = spellDmg(fx.owner, def.baseDamage, def.gear, fx.rank, false);
  const rawPvp = spellDmg(fx.owner, def.baseDamage, def.gear, fx.rank, true);
  let best = null;
  let bestD = fx.aggro || 7;
  for (const e of livingMobs(room)) {
    const dd = distTo(room, fx, e);
    if (dd < bestD) {
      bestD = dd;
      best = e;
    }
  }
  let pvpT = null;
  let pvpD = fx.aggro || 7;
  for (const t of room.sessions.values()) {
    if (t === owner || !(t.hp > 0)) continue;
    if (!pvpCanHit(room, owner, t)) continue;
    const dd = distTo(room, fx, t);
    if (dd < pvpD) {
      pvpD = dd;
      pvpT = t;
    }
  }
  if (pvpT && pvpD <= bestD) {
    pvpHit(room, owner, pvpT, rawPvp, "summon_shade");
  } else if (best) {
    hitMob(room, owner, best, rawPve, "summon_shade", { from: fx });
  }
}

function tickVortex(room, fx, dt) {
  const owner = room.sessions.get(fx.owner);
  if (!owner || !(owner.hp > 0) || pvpIsDown(owner)) {
    fx.ttl = 0;
    return;
  }
  const pull = 3.2 * dt;
  for (const e of livingMobs(room)) {
    const d = distTo(room, fx, e);
    if (d > fx.r || d < 0.2) continue;
    const dlt = delta(room, e, fx);
    const len = Math.hypot(dlt.x, dlt.y) || 1;
    room.shoveMob(e, (dlt.x / len) * pull, (dlt.y / len) * pull);
  }
  for (const t of room.sessions.values()) {
    if (t === owner || !(t.hp > 0)) continue;
    if (!pvpCanHit(room, owner, t)) continue;
    if (bastionActive(t)) continue;
    const d = distTo(room, fx, t);
    if (d > fx.r || d < 0.2) continue;
    const dlt = delta(room, t, fx);
    const len = Math.hypot(dlt.x, dlt.y) || 1;
    room.shovePlayer(t, (dlt.x / len) * pull, (dlt.y / len) * pull, 80);
  }
  fx.acc = (fx.acc || 0) + dt;
  if (fx.acc < fx.tick) return;
  fx.acc -= fx.tick;
  const def = SKILLS.tempest;
  const rawPve = spellDmg(fx.owner, def.baseDamage, def.gear, fx.rank, false);
  const rawPvp = spellDmg(fx.owner, def.baseDamage, def.gear, fx.rank, true);
  for (const e of livingMobs(room)) {
    if (distTo(room, fx, e) > fx.r) continue;
    hitMob(room, owner, e, rawPve, "tempest", { from: fx });
  }
  for (const t of room.sessions.values()) {
    if (t === owner || !(t.hp > 0)) continue;
    if (!pvpCanHit(room, owner, t)) continue;
    if (distTo(room, fx, t) > fx.r) continue;
    pvpHit(room, owner, t, rawPvp, "tempest");
  }
}

function tickHots(room, dt) {
  const now = Date.now();
  for (const s of room.sessions.values()) {
    if (s.graceHotUntil > now && s.hp > 0 && !pvpIsDown(s)) {
      const heal = (s.maxHp || 1) * (s.graceHotPct || 0.02) * dt;
      s.hp = Math.min(s.maxHp, s.hp + heal);
    } else if (s.graceHotUntil && s.graceHotUntil <= now) {
      s.graceHotUntil = 0;
    }
  }
}

export function tickSkills(room, dt) {
  if (!room) return;
  tickHots(room, dt);
  const m = room._skillFx;
  if (!m || m.size === 0) return;
  for (const [id, fx] of [...m]) {
    try {
      fx.ttl = (fx.ttl || 0) - dt;
      if (fx.kind === "halo") tickHalo(room, fx, dt);
      else if (fx.kind === "burn") tickBurn(room, fx, dt);
      else if (fx.kind === "glyph") tickGlyph(room, fx);
      else if (fx.kind === "shade") tickShade(room, fx, dt);
      else if (fx.kind === "vortex") tickVortex(room, fx, dt);
      if (fx.ttl <= 0) m.delete(id);
    } catch (err) {
      console.error("[skills] tick", fx.kind, err.message);
      m.delete(id);
    }
  }
  if (m.size) room.markDirty();
}

export function applyLifesteal(sess, dealt, pvp) {
  const pct = lifestealPct(sess.playerId, pvp);
  if (pct <= 0 || !(dealt > 0) || !(sess.hp > 0)) return;
  sess.hp = Math.min(sess.maxHp, sess.hp + Math.round(dealt * pct));
}

export { PLAYER_MAX_MANA };
