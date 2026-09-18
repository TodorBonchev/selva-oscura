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
  },
  whirl_ward: {
    id: "whirl_ward",
    name: "Whirl Ward",
    manaCost: 28,
    cooldown: 8.0,
    hotkey: "2",
    icon: "assets/spells/spell_whirl_ward.png",
    short: "Ward",
  },
  infernal_burst: {
    id: "infernal_burst",
    name: "Infernal Burst",
    manaCost: 48,
    cooldown: 11.0,
    hotkey: "3",
    icon: "assets/spells/spell_infernal_burst.png",
    short: "Burst",
  },
};

export const SPELL_HOTBAR: SpellId[] = ["gale_bolt", "whirl_ward", "infernal_burst"];
