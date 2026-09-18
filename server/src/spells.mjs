/**
 * Inferno mana spells — server-authoritative definitions.
 * Costs / CDs are the single source of truth; client mirrors for UI only.
 */

export const PLAYER_MAX_MANA = 100;
/** Mana points regenerated per second while alive. */
export const MANA_REGEN_PER_SEC = 6.5;

export const SPELLS = {
  gale_bolt: {
    id: "gale_bolt",
    name: "Gale Bolt",
    manaCost: 18,
    cooldown: 1.4,
    range: 9.5,
    baseDamage: 30,
    /** Extra random damage roll 0..N */
    damageVar: 8,
  },
  whirl_ward: {
    id: "whirl_ward",
    name: "Whirl Ward",
    manaCost: 28,
    cooldown: 8.0,
    duration: 4.5,
    armorBonus: 18,
  },
  infernal_burst: {
    id: "infernal_burst",
    name: "Infernal Burst",
    manaCost: 48,
    cooldown: 11.0,
    radius: 4.2,
    baseDamage: 42,
    damageVar: 14,
  },
};

export const SPELL_ORDER = ["gale_bolt", "whirl_ward", "infernal_burst"];

export function spellById(id) {
  return SPELLS[String(id || "")] || null;
}
