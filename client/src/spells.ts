/** Client mirror of server/src/spells.mjs — UI costs/CDs only; server is authoritative. */

export const PLAYER_MAX_MANA = 100;

export type SpellId = "gale_bolt" | "whirl_ward" | "infernal_burst";

export interface SpellDef {
  id: SpellId;
  name: string;
  manaCost: number;
  cooldown: number;
  hotkey: string;
  icon: string;
  short: string;
  /** One-line hover blurb (D4 skill-bar tip). */
  blurb: string;
}

export const SPELLS: Record<SpellId, SpellDef> = {
  gale_bolt: {
    id: "gale_bolt",
    name: "Gale Bolt",
    manaCost: 18,
    cooldown: 1.4,
    hotkey: "1",
    icon: "assets/spells/spell_gale_bolt.png",
    short: "Gale",
    blurb: "A wind lance at the aimed foe.",
  },
  whirl_ward: {
    id: "whirl_ward",
    name: "Whirl Ward",
    manaCost: 28,
    cooldown: 8.0,
    hotkey: "2",
    icon: "assets/spells/spell_whirl_ward.png",
    short: "Ward",
    blurb: "A circling gale soaks the next blows.",
  },
  infernal_burst: {
    id: "infernal_burst",
    name: "Infernal Burst",
    manaCost: 48,
    cooldown: 11.0,
    hotkey: "3",
    icon: "assets/spells/spell_infernal_burst.png",
    short: "Burst",
    blurb: "Fire erupts in a ring at your feet.",
  },
};

export const SPELL_HOTBAR: SpellId[] = ["gale_bolt", "whirl_ward", "infernal_burst"];

/** Mirror of server gale_bolt.range — aim preview / out-of-range hint. */
export const GALE_RANGE = 9.5;
/** Mirror of server infernal_burst.radius. */
export const BURST_RADIUS = 4.2;
