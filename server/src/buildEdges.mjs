/**
 * PvE build edges — a modest, optional nudge for each skill branch.
 * Ira executes wounded elites, Fede burns filth and shrugs eruptions,
 * Ombra can snap a slam windup, Fortezza soaks a telegraphed heavy hit.
 * Never a requirement: every bonus is +20–25% or one short interrupt.
 *
 * Pure: callers pass plain entities and sessions. Nothing here throws;
 * a bad target or a missing field returns the neutral value (×1, no cancel).
 */
import { skillById } from "./skills.mjs";
import { isChampionClass } from "./mobAi.mjs";

/** Ira spells that swing. Passives and War Cry are not an execute. */
const IRA_STRIKES = new Set(["furious_cleave", "wrath_charge", "earthsplitter"]);
/** Fede spells that burn. Grace heals; it does not carry the damage edge. */
const FEDE_STRIKES = new Set(["infernal_burst", "lance_of_light", "pillar_of_flame", "halo"]);
/** Ombra control that actually lands on a foe. Shadow Step does not. */
const OMBRA_CC = new Set(["snare_glyph", "tempest", "gale_bolt"]);
/** Named in the control list, but only if the cast really applies CC. */
const OMBRA_CC_IF = new Set(["shadow_step"]);

/** Gluttony filth (inferno_06 archetypes). */
const FILTH = new Set(["mire_shade", "mud_wisp", "mire_champion", "mire_warden"]);
/** Ward hearts. */
const HEARTS = new Set(["storm_heart", "mire_heart", "hoard_heart", "rage_heart"]);

/**
 * Fire / eruption hazard telegraphs.
 * Checked against every `kind:` in server/src/cantoMech/*.mjs:
 *   styx_eruption          wrath marsh + Argenti's line (the only fire/eruption)
 *   boss_slam, champ_slam, champ_cleave, shade_swipe, wisp_dart — blows, not fire
 *   mire_grab, mire_sink, hail, fango_burst, cerbero_bite, maw_bite_* — mire
 *   minos_coil, minos_sentence, bufera_strike — wind
 *   plutus_roll, plutus_pulse, plutus_fall, cw_charge, ava_spill, ava_clash — weights
 * No boss pillar/flame kind exists beyond styx_eruption.
 */
export const FEDE_FIRE_KINDS = Object.freeze(["styx_eruption"]);

/** Boss windups Ombra may cancel. Phase patterns (coils, bites, rolls) are not these. */
const SIMPLE_SLAM = new Set(["boss_slam", "argenti_lunge", "slam"]);
/** Champion telegraphed windups (slam, and Lust's cleave, which is that champ's slam). */
const CHAMP_WINDUP = new Set(["champ_slam", "champ_cleave", "boss_slam", "argenti_lunge", "slam"]);

export const IRA_EXECUTE_HP = 0.3;
export const IRA_EXECUTE_BONUS = 0.25;
export const IRA_ENRAGE_BONUS = 0.2;
export const FEDE_FILTH_BONUS = 0.2;
export const FEDE_HEART_BONUS = 0.25;
export const FEDE_FIRE_DR = 0.3;
export const FORTEZZA_SOAK = 0.25;
export const OMBRA_CD_MS = 6000;

const NO_BREAK = Object.freeze({ cancel: false, at: 0 });

function spellBranch(spellId) {
  const def = skillById(spellId);
  return def && typeof def.branch === "string" ? def.branch : "";
}

/** Strictly under 30% life. Missing max HP is not an execute window. */
function belowExecute(ent) {
  const hp = Number(ent.hp);
  const max = Number(ent.maxHp);
  if (!(max > 0) || !Number.isFinite(hp)) return false;
  return hp * 10 < max * 3;
}

function executeTarget(ent) {
  if (!ent || typeof ent !== "object") return false;
  if (ent.kind === "boss") return true;
  if (ent.elite || ent.champion) return true;
  return isChampionClass(ent);
}

/**
 * Outgoing PvE multiplier for a player spell. 1 means no edge.
 * Ira's two clauses share one window: the higher bonus applies, never both.
 */
export function outgoingMultiplier(spellId, target, cantoId) {
  try {
    if (!target || typeof target !== "object") return 1;
    const id = String(spellId || "");
    const branch = spellBranch(id);
    if (branch === "ira" && IRA_STRIKES.has(id)) {
      let bonus = 0;
      if (executeTarget(target) && belowExecute(target)) bonus = IRA_EXECUTE_BONUS;
      if (cantoId === "inferno_08" && target.enraged) bonus = Math.max(bonus, IRA_ENRAGE_BONUS);
      return 1 + bonus;
    }
    if (branch === "fede" && FEDE_STRIKES.has(id)) {
      const arch = String(target.archetype || "");
      if (HEARTS.has(arch)) return 1 + FEDE_HEART_BONUS;
      if (FILTH.has(arch)) return 1 + FEDE_FILTH_BONUS;
    }
    return 1;
  } catch {
    return 1;
  }
}

/** Apply `outgoingMultiplier` and round. Neutral (and any error) keeps the hit. */
export function scaleOutgoing(damage, spellId, target, cantoId) {
  try {
    const d = Math.round(Number(damage) || 0);
    if (!(d > 0)) return 0;
    const m = outgoingMultiplier(spellId, target, cantoId);
    if (!(m > 1)) return d;
    return Math.max(1, Math.round(d * m));
  } catch {
    const n = Number(damage);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }
}

function fedeBuffActive(sess, now) {
  if (!sess || typeof sess !== "object") return false;
  const t = Number(now) || 0;
  return (Number(sess.graceHotUntil) || 0) > t || (Number(sess.haloUntil) || 0) > t;
}

/** Whirl Ward counts down in seconds (`wardUntil`); Bastion is a wall-clock stamp. */
function guardActive(sess, now) {
  if (!sess || typeof sess !== "object") return false;
  if ((Number(sess.wardUntil) || 0) > 0) return true;
  return (Number(sess.bastionUntil) || 0) > (Number(now) || 0);
}

function fireHazard(teleKind) {
  return FEDE_FIRE_KINDS.includes(String(teleKind || ""));
}

/**
 * A telegraphed boss or champion blow, or an explicit boss_slam / crush kind.
 * Contact hits (no telegraph kind) are not soaked.
 */
function heavyTelegraph(attacker, teleKind) {
  const kind = String(teleKind || "");
  if (!kind) return false;
  if (kind === "boss_slam" || kind === "argenti_lunge" || kind === "crush") return true;
  if (attacker && attacker.kind === "boss") return true;
  return isChampionClass(attacker);
}

/**
 * Post-armor damage after Fede's fire resist and Fortezza's soak.
 * The two stack only when both buffs are up and both conditions match.
 * Returns at least 1 when the incoming hit was positive.
 */
export function scaleIncoming(taken, ctx = {}) {
  try {
    const d = Math.round(Number(taken) || 0);
    if (!(d > 0)) return 0;
    const now = Number(ctx.now) || Date.now();
    let dmg = d;
    // Each edge rounds on its own so 30% then 25% is 70 then 53, not a float hair under 52.5.
    if (fedeBuffActive(ctx.sess, now) && fireHazard(ctx.teleKind)) {
      dmg = Math.max(1, Math.round(dmg * (1 - FEDE_FIRE_DR)));
    }
    if (guardActive(ctx.sess, now) && heavyTelegraph(ctx.attacker, ctx.teleKind)) {
      dmg = Math.max(1, Math.round(dmg * (1 - FORTEZZA_SOAK)));
    }
    return dmg;
  } catch {
    const n = Number(taken);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }
}

/** True when this spell is an Ombra control landing. Shadow Step only if `appliesCc`. */
export function ombraControlLands(spellId, appliesCc = false) {
  try {
    const id = String(spellId || "");
    if (spellBranch(id) !== "ombra") return false;
    if (OMBRA_CC.has(id)) return true;
    if (OMBRA_CC_IF.has(id)) return Boolean(appliesCc);
    return false;
  } catch {
    return false;
  }
}

/**
 * Whether an Ombra control should cancel this windup.
 * Does not mutate. Caller stores `at` on `entity._ombraBreakAt` when `cancel`.
 * Bosses: only a simple slam (boss_slam / slam), never a phase pattern.
 * At most once per `OMBRA_CD_MS` per entity.
 */
export function ombraBreakDecision(entity, opts = {}) {
  try {
    if (!ombraControlLands(opts.spellId, opts.appliesCc)) return NO_BREAK;
    if (!entity || typeof entity !== "object") return NO_BREAK;
    const boss = entity.kind === "boss";
    const champ = !boss && isChampionClass(entity);
    if (!boss && !champ) return NO_BREAK;
    if (!entity.teleId) return NO_BREAK;
    const teleKind = String(opts.teleKind || "");
    if (boss) {
      if (!SIMPLE_SLAM.has(teleKind)) return NO_BREAK;
    } else if (!CHAMP_WINDUP.has(teleKind)) return NO_BREAK;
    const now = Number(opts.now);
    const t = Number.isFinite(now) ? now : Date.now();
    const last = Number(entity._ombraBreakAt) || 0;
    if (last > 0 && t - last < OMBRA_CD_MS) return { cancel: false, at: last };
    return { cancel: true, at: t };
  } catch {
    return NO_BREAK;
  }
}
