/**
 * Client mirror of server/src/skills.mjs + XP curve.
 * Data and pure helpers only — the server is authoritative.
 */

export const LEVEL_CAP = 50;
export const LOADOUT_SIZE = 4;
export const MAX_RANK = 5;

export const BRANCHES = {
  ira: {
    id: "ira",
    name: "Wrath",
    subtitle: "Melee",
    edge: "PvE edge: Wrath strikes deal +25% to elites and bosses under 30% life, +20% to enraged foes in Wrath.",
  },
  fede: {
    id: "fede",
    name: "Faith",
    subtitle: "Holy fire",
    edge: "PvE edge: Faith fire deals +20% to Gluttony filth and +25% to ward hearts; Grace or Halo eases Styx eruptions by 30%.",
  },
  ombra: {
    id: "ombra",
    name: "Shade",
    subtitle: "Wind",
    edge: "PvE edge: Snare Glyph, Tempest or Gale Bolt landing on a champion or boss mid-slam breaks the windup (once per 6 s each).",
  },
  fortezza: {
    id: "fortezza",
    name: "Fortitude",
    subtitle: "Guard",
    edge: "PvE edge: with Whirl Ward or Bastion up, telegraphed boss and champion blows deal 25% less.",
  },
} as const;

export type BranchId = keyof typeof BRANCHES;
export type SkillType = "active" | "passive";

export const TIER_LEVEL: Record<number, number> = { 1: 1, 2: 6, 3: 12, 4: 18, 5: 24 };

export const FREE_SKILLS = ["gale_bolt", "whirl_ward", "infernal_burst"] as const;
export const DEFAULT_LOADOUT: (string | null)[] = ["gale_bolt", "whirl_ward", "infernal_burst", null];

export interface SkillPrereq {
  id: string;
  rank: number;
}

export interface SkillDef {
  id: string;
  name: string;
  branch: BranchId;
  type: SkillType;
  tier: number;
  requiredLevel?: number;
  maxRank: number;
  prereqs: SkillPrereq[];
  manaCost?: number;
  cooldown?: number;
  range?: number;
  radius?: number;
  short: string;
  blurb: string;
}

export const SKILLS: Record<string, SkillDef> = {
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
    short: "Cleave",
    blurb: "A 120° frontal cleave.",
  },
  ferocia: {
    id: "ferocia",
    name: "Ferocity",
    branch: "ira",
    type: "passive",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    short: "Ferocity",
    blurb: "+6% melee damage per rank.",
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
    short: "Charge",
    blurb: "Dash in and stun the first foe.",
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
    short: "Cry",
    blurb: "Bolster yourself and weaken nearby foes.",
  },
  bloodthirst: {
    id: "bloodthirst",
    name: "Bloodthirst",
    branch: "ira",
    type: "passive",
    tier: 3,
    maxRank: 5,
    prereqs: [{ id: "ferocia", rank: 1 }],
    short: "Thirst",
    blurb: "Melee blows return a share of life.",
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
    short: "Split",
    blurb: "A line shockwave that staggers.",
  },
  infernal_burst: {
    id: "infernal_burst",
    name: "Infernal Burst",
    branch: "fede",
    type: "active",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    manaCost: 48,
    cooldown: 11,
    radius: 4.2,
    short: "Burst",
    blurb: "Fire erupts in a ring at your feet.",
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
    short: "Lance",
    blurb: "A piercing beam through every foe on the line.",
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
    short: "Grace",
    blurb: "Knit wounds on you and nearby pilgrims.",
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
    short: "Pillar",
    blurb: "A delayed column, then burning ground.",
  },
  fervore: {
    id: "fervore",
    name: "Fervor",
    branch: "fede",
    type: "passive",
    tier: 2,
    maxRank: 5,
    prereqs: [],
    short: "Fervor",
    blurb: "+7% spell damage per rank.",
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
    short: "Halo",
    blurb: "An 8s damaging aura.",
  },
  gale_bolt: {
    id: "gale_bolt",
    name: "Gale Bolt",
    branch: "ombra",
    type: "active",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    manaCost: 18,
    cooldown: 1.4,
    range: 9.5,
    short: "Gale",
    blurb: "A wind lance at the aimed foe.",
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
    range: 10,
    short: "Step",
    blurb: "Blink to the aim point with a brief iframe.",
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
    short: "Snare",
    blurb: "A trap that roots the first foe.",
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
    short: "Shade",
    blurb: "A shade ally that strikes nearby hostiles.",
  },
  silenzio: {
    id: "silenzio",
    name: "Silence",
    branch: "ombra",
    type: "passive",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    short: "Silence",
    blurb: "+8% mana regen and −3% cooldowns per rank.",
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
    short: "Storm",
    blurb: "A pulling vortex of wind.",
  },
  whirl_ward: {
    id: "whirl_ward",
    name: "Whirl Ward",
    branch: "fortezza",
    type: "active",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    manaCost: 28,
    cooldown: 8,
    short: "Ward",
    blurb: "A circling gale soaks the next blows.",
  },
  stone_skin: {
    id: "stone_skin",
    name: "Stone Skin",
    branch: "fortezza",
    type: "passive",
    tier: 1,
    maxRank: 5,
    prereqs: [],
    short: "Stone",
    blurb: "+6 armor per rank.",
  },
  vigor: {
    id: "vigor",
    name: "Vigor",
    branch: "fortezza",
    type: "passive",
    tier: 2,
    maxRank: 5,
    prereqs: [],
    short: "Vigor",
    blurb: "+5% max life per rank.",
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
    short: "Bastion",
    blurb: "Brief heavy damage reduction.",
  },
  thorns: {
    id: "thorns",
    name: "Thorns",
    branch: "fortezza",
    type: "passive",
    tier: 3,
    maxRank: 5,
    prereqs: [{ id: "stone_skin", rank: 2 }],
    short: "Thorns",
    blurb: "Reflect a share of melee damage taken.",
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
    short: "Stand",
    blurb: "A lethal blow leaves you at 1 life, once in a while.",
  },
};

export const SKILL_IDS = Object.keys(SKILLS);

export function skillById(id: string): SkillDef | null {
  return SKILLS[String(id || "")] || null;
}

export function requiredLevel(def: SkillDef): number {
  if (def.requiredLevel != null) return def.requiredLevel;
  return TIER_LEVEL[def.tier] || 1;
}

export function defaultRanks(): Record<string, number> {
  return { gale_bolt: 1, whirl_ward: 1, infernal_burst: 1 };
}

export function spentPoints(ranks: Record<string, number> | undefined): number {
  let n = 0;
  const r = ranks || {};
  for (const [id, raw] of Object.entries(r)) {
    const def = SKILLS[id];
    if (!def) continue;
    const rank = Math.max(0, Math.min(def.maxRank, Math.floor(Number(raw) || 0)));
    if ((FREE_SKILLS as readonly string[]).includes(id)) n += Math.max(0, rank - 1);
    else n += rank;
  }
  return n;
}

export function unspentPoints(level: number, ranks: Record<string, number> | undefined): number {
  const avail = Math.max(0, (Math.floor(Number(level) || 1) || 1) - 1);
  return Math.max(0, avail - spentPoints(ranks));
}

export function canLearn(
  def: SkillDef,
  progress: { level: number; ranks: Record<string, number> }
): { ok: boolean; error?: string } {
  if (!def || !progress) return { ok: false, error: "unknown" };
  const rank = Math.floor(Number(progress.ranks?.[def.id]) || 0);
  if (rank >= def.maxRank) return { ok: false, error: "max_rank" };
  if ((progress.level || 1) < requiredLevel(def)) return { ok: false, error: "level" };
  for (const p of def.prereqs || []) {
    if ((Math.floor(Number(progress.ranks?.[p.id]) || 0)) < p.rank) return { ok: false, error: "prereq" };
  }
  if (unspentPoints(progress.level, progress.ranks) < 1) return { ok: false, error: "no_points" };
  return { ok: true };
}

export function manaCostAtRank(def: SkillDef, rank: number): number {
  const r = Math.max(1, rank | 0);
  return Math.max(1, Math.round((def.manaCost || 0) * (1 + 0.05 * (r - 1))));
}

export function cooldownAtRank(def: SkillDef, rank: number, silenzioRank = 0): number {
  const r = Math.max(1, rank | 0);
  let cd = def.cooldown || 0;
  if (def.id === "shadow_step") cd = Math.max(0.4, 8 - 0.5 * (r - 1));
  else cd = Math.max(0.4, cd * (1 - 0.03 * (r - 1)));
  return +(cd * Math.max(0.7, 1 - 0.03 * silenzioRank)).toFixed(3);
}

export function xpToNext(level: number): number {
  const L = Math.floor(Number(level) || 1);
  if (!(L >= 1) || L >= LEVEL_CAP) return 0;
  return Math.round(60 * Math.pow(L, 1.65) + 40 * L);
}

export function totalXpForLevel(level: number): number {
  const L = Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(level) || 1)));
  let t = 0;
  for (let i = 1; i < L; i++) t += xpToNext(i);
  return t;
}

export function skillsByBranch(branch: BranchId): SkillDef[] {
  return Object.values(SKILLS)
    .filter((s) => s.branch === branch)
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

/** Display name and a short tag (hotbar / node). */
export function skillLabel(def: SkillDef): { title: string; sub: string } {
  return { title: def.name, sub: def.short };
}

export function respecAsh(level: number): number {
  return 200 * Math.max(1, Math.floor(Number(level) || 1));
}

/** Ground point skills. Gale aims too, but the server reads only its direction. */
export function isGroundSkill(id: string): boolean {
  return id === "pillar_of_flame" || id === "snare_glyph" || id === "tempest" || id === "shadow_step";
}

export function aimRange(def: SkillDef): number {
  if (def.range) return def.range;
  if (def.id === "earthsplitter") return 12;
  if (def.id === "lance_of_light") return 12;
  return def.radius || 6;
}

export function aimRadius(def: SkillDef): number {
  if (def.id === "shadow_step") return 0.55;
  if (def.id === "earthsplitter") return 1.5;
  if (def.id === "lance_of_light") return 0.7;
  return def.radius || 0.8;
}

const RANK_DMG = 0.13;

function pct(base: number, per: number, rank: number): number {
  return Math.round(base * (1 + per * (rank - 1)) * 100);
}

function n(base: number, per: number, rank: number): number {
  return Math.round(base * (1 + per * (rank - 1)));
}

/** One line of numbers at this rank (rank is at least 1). */
export function effectAtRank(id: string, rank: number): string {
  const r = Math.max(1, Math.min(MAX_RANK, rank | 0));
  switch (id) {
    case "furious_cleave":
      return `120° arc, 4 m — ${Math.round(150 * (1 + 0.15 * (r - 1)))}% weapon damage`;
    case "ferocia":
      return `+${6 * r}% melee damage`;
    case "wrath_charge":
      return `Dash 9 m, ${Math.round(180 * (1 + RANK_DMG * (r - 1)))}% weapon, stun 0.6 s`;
    case "war_cry":
      return `You +${pct(0.2, 0.04, r) / 100 * 100 | 0}% damage for 6 s; foes −15% for 4 s (6 m)`;
    case "bloodthirst":
      return `${3 * r}% of melee damage returns as life`;
    case "earthsplitter":
      return `Line 12×3 m, ${Math.round(260 * (1 + 0.15 * (r - 1)))}% weapon, stagger`;
    case "infernal_burst":
      return `${n(42, RANK_DMG, r)} fire in a ${(4.2 * (1 + 0.08 * (r - 1))).toFixed(1)} m ring`;
    case "lance_of_light":
      return `Piercing line 12 m — ${n(28, RANK_DMG, r)}–${n(28, RANK_DMG, r) + 8} + 60% weapon`;
    case "grace":
      return `Heal ${pct(0.18, 0.04, r)}% life now, then 2%/s for 4 s (allies within 6 m)`;
    case "pillar_of_flame":
      return `0.6 s mark, then a ${(2.6).toFixed(1)} m column (${n(58, RANK_DMG, r)}) and 3 s burning ground`;
    case "fervore":
      return `+${7 * r}% spell damage`;
    case "halo":
      return `8 s aura, 4.5 m, ${n(16, RANK_DMG, r)} every 0.5 s`;
    case "gale_bolt":
      return `${n(30, RANK_DMG, r)}–${n(30, RANK_DMG, r) + 8} wind, ${(9.5 * (1 + 0.08 * (r - 1))).toFixed(1)} m`;
    case "shadow_step":
      return `Blink 10 m, 0.4 s untouchable, cooldown ${(Math.max(0.4, 8 - 0.5 * (r - 1))).toFixed(1)} s`;
    case "snare_glyph":
      return `Trap 1.8 m, root 1.5 s, ${n(22, RANK_DMG, r)} on trigger (2 traps, 20 s)`;
    case "summon_shade":
      return `Shade ally ${12 + 2 * (r - 1)} s, strikes every 0.9 s (${n(14, RANK_DMG, r)})`;
    case "silenzio":
      return `+${8 * r}% mana regen, −${3 * r}% cooldowns`;
    case "tempest":
      return `Vortex 4 s, 4 m, pull and ${n(18, RANK_DMG, r)} every 0.4 s`;
    case "whirl_ward":
      return `+${n(18, RANK_DMG, r)} armor for ${(4.5 * (1 + 0.08 * (r - 1))).toFixed(1)} s`;
    case "stone_skin":
      return `+${6 * r} armor`;
    case "vigor":
      return `+${5 * r}% maximum life`;
    case "bastion":
      return `${Math.round((0.55 + 0.03 * (r - 1)) * 100)}% less damage for 2.5 s, no knockback`;
    case "thorns":
      return `Reflect ${8 * r}% of melee damage taken`;
    case "last_stand":
      return `Lethal blow leaves 1 life and 1 s untouchable (every ${Math.max(30, 120 - 10 * (r - 1))} s)`;
    default:
      return "";
  }
}

export function pvpNote(id: string): string {
  switch (id) {
    case "furious_cleave":
      return "PvP: damage capped at 16% of life.";
    case "ferocia":
    case "fervore":
    case "bloodthirst":
    case "thorns":
      return "PvP: the bonus is halved.";
    case "wrath_charge":
      return "PvP: no stun — a brief slow. Damage capped at 22%.";
    case "earthsplitter":
      return "PvP: damage capped at 12% of life.";
    case "lance_of_light":
    case "pillar_of_flame":
      return "PvP: damage capped at 22% of life.";
    case "halo":
      return "PvP: each tick capped at 5% of life.";
    case "tempest":
      return "PvP: each tick capped at 6% of life.";
    case "summon_shade":
      return "PvP: each strike capped at 12% of life.";
    case "snare_glyph":
      return "PvP: root lasts 0.6 s. Damage capped at 16%.";
    case "bastion":
      return "PvP: reduction capped at 40%.";
    case "last_stand":
      return "PvP: once per life.";
    case "grace":
      return "Does not heal an opponent.";
    case "shadow_step":
      return "PvP: the blink still grants a short untouchable beat.";
    default:
      return "";
  }
}

export type SkillSfx = "melee" | "fire" | "wind" | "holy" | "shadow" | "buff";

export function skillSfxKind(id: string): SkillSfx {
  switch (id) {
    case "furious_cleave":
    case "wrath_charge":
    case "war_cry":
    case "earthsplitter":
    case "thorns":
      return "melee";
    case "infernal_burst":
    case "pillar_of_flame":
      return "fire";
    case "gale_bolt":
    case "tempest":
      return "wind";
    case "shadow_step":
    case "snare_glyph":
    case "summon_shade":
      return "shadow";
    case "whirl_ward":
    case "bastion":
      return "buff";
    default:
      return "holy";
  }
}

/** Cast pose family. Melee swings and the blink reuse attack / dash. */
export function skillAnim(id: string): "gale" | "ward" | "burst" | "swing" | "dash" {
  switch (id) {
    case "whirl_ward":
    case "bastion":
    case "grace":
    case "halo":
    case "war_cry":
    case "summon_shade":
      return "ward";
    case "infernal_burst":
    case "pillar_of_flame":
    case "furious_cleave":
      return "burst";
    case "earthsplitter":
    case "wrath_charge":
      return "swing";
    case "shadow_step":
      return "dash";
    default:
      return "gale";
  }
}
