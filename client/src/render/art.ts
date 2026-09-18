import Phaser from "phaser";
import { worldToScreen, TILE_W, TILE_H } from "../util/iso";
import { assetUrl } from "../items/icons";


/** Doré Slice-1 kit under public/assets/dore/ */
export const DORE_PATH = "assets/dore";

export const DORE_KEYS = {
  hub_ground: "dore_hub_ground",
  lust_ground: "dore_lust_ground",
  player: "dore_player",
  player_walk_a: "dore_player_walk_a",
  player_walk_b: "dore_player_walk_b",
  /** Passing (legs-together) frames synthesized by tools/sprite_fix.py. */
  player_walk_a2: "dore_player_walk_a2",
  player_walk_b2: "dore_player_walk_b2",
  poi_guide: "dore_poi_guide",
  poi_stash: "dore_poi_stash",
  poi_ah: "dore_poi_ah",
  poi_quest: "dore_poi_quest",
  exit_portal: "dore_exit_portal",
  mob_whirl: "dore_mob_whirl",
  mob_champion: "dore_mob_champion",
  boss_judge: "dore_boss_judge",
  loot_gem: "dore_loot_gem",
} as const;

export const DORE_FILES: Record<keyof typeof DORE_KEYS, string> = {
  hub_ground: "hub_ground.png",
  lust_ground: "lust_ground.png",
  player: "player.png",
  player_walk_a: "player_walk_a.png",
  player_walk_b: "player_walk_b.png",
  player_walk_a2: "player_walk_a2.png",
  player_walk_b2: "player_walk_b2.png",
  poi_guide: "poi_guide.png",
  poi_stash: "poi_stash.png",
  poi_ah: "poi_ah.png",
  poi_quest: "poi_quest.png",
  exit_portal: "exit_portal.png",
  mob_whirl: "mob_whirl.png",
  mob_champion: "mob_champion.png",
  boss_judge: "boss_judge.png",
  loot_gem: "loot_gem.png",
};

/**
 * On-screen display target heights (desktop, css px before camera zoom).
 * Width is derived from the real texture aspect so nothing is squished.
 * Textures are 2× nearest-upscaled; heights here are ~1.1× the old kit.
 */
export const DORE_DISPLAY: Record<string, { h: number }> = {
  [DORE_KEYS.player]: { h: 74 },
  [DORE_KEYS.player_walk_a]: { h: 74 },
  [DORE_KEYS.player_walk_b]: { h: 74 },
  [DORE_KEYS.player_walk_a2]: { h: 74 },
  [DORE_KEYS.player_walk_b2]: { h: 74 },
  [DORE_KEYS.poi_guide]: { h: 66 },
  [DORE_KEYS.poi_stash]: { h: 54 },
  [DORE_KEYS.poi_ah]: { h: 60 },
  [DORE_KEYS.poi_quest]: { h: 60 },
  [DORE_KEYS.exit_portal]: { h: 100 },
  [DORE_KEYS.mob_whirl]: { h: 60 },
  [DORE_KEYS.mob_champion]: { h: 70 },
  [DORE_KEYS.boss_judge]: { h: 112 },
  [DORE_KEYS.loot_gem]: { h: 36 },
  item_ashen_club: { h: 34 },
  item_torn_cape: { h: 34 },
  item_ash_helm: { h: 34 },
  item_pilgrim_boots: { h: 34 },
  item_grave_gloves: { h: 34 },
  item_rusty_buckler: { h: 32 },
  item_bone_shard: { h: 32 },
};

/**
 * Keys whose display size is pinned to another key's, so texture swaps never
 * change the on-screen quad (walk frames must match the idle player exactly).
 */
export const DORE_DISPLAY_AS: Record<string, string> = {
  [DORE_KEYS.player_walk_a]: DORE_KEYS.player,
  [DORE_KEYS.player_walk_b]: DORE_KEYS.player,
  [DORE_KEYS.player_walk_a2]: DORE_KEYS.player,
  [DORE_KEYS.player_walk_b2]: DORE_KEYS.player,
};

/**
 * Sub-rect of the texture to show (texture px). poi_guide ships as a 5-figure
 * strip — show the centre hooded figure only.
 */
export const DORE_CROP: Record<string, { x: number; y: number; w: number; h: number }> = {
  [DORE_KEYS.poi_guide]: { x: 68, y: 0, w: 40, h: 100 },
};

/**
 * Sprites whose matte is baked in as near-black: SCREEN blend drops the black
 * so no dark quad shows on the ground.
 */
export const DORE_BLEND: Record<string, number> = {
  [DORE_KEYS.poi_guide]: Phaser.BlendModes.SCREEN,
  [DORE_KEYS.poi_quest]: Phaser.BlendModes.SCREEN,
  [DORE_KEYS.poi_stash]: Phaser.BlendModes.SCREEN,
};

/** Extra scale on compact / phone UI for mobile readability (≈1.5× old). */
export const DORE_COMPACT_SCALE = 1.7;

/** Native pixel size of the visible part of a Doré texture (crop-aware). */
export function doreFrameSize(scene: Phaser.Scene, texKey: string): { w: number; h: number } {
  const crop = DORE_CROP[texKey];
  if (crop) return { w: crop.w, h: crop.h };
  const tex = scene.textures.get(texKey);
  const src = tex?.source?.[0];
  if (src && src.width > 0 && src.height > 0) return { w: src.width, h: src.height };
  return { w: 48, h: 48 };
}

/** Display size (css px) of the visible frame for this device class. */
export function doreDisplaySize(
  scene: Phaser.Scene,
  texKey: string,
  compact: boolean
): { w: number; h: number } {
  const refKey = DORE_DISPLAY_AS[texKey] ?? texKey;
  const base = DORE_DISPLAY[refKey] || { h: 48 };
  const frame = doreFrameSize(scene, scene.textures.exists(refKey) ? refKey : texKey);
  const h = compact ? base.h * DORE_COMPACT_SCALE : base.h;
  const w = h * (frame.w / frame.h);
  return { w: Math.round(w), h: Math.round(h) };
}

export function poiDoreKey(poiKind: string | undefined): string {
  switch (poiKind) {
    case "stash":
      return DORE_KEYS.poi_stash;
    case "ah":
      return DORE_KEYS.poi_ah;
    case "quest":
      return DORE_KEYS.poi_quest;
    case "portal":
      return DORE_KEYS.exit_portal;
    case "guide":
    default:
      return DORE_KEYS.poi_guide;
  }
}

export function entityDoreKey(e: {
  kind: string;
  poiKind?: string;
  champion?: boolean;
}): string | null {
  switch (e.kind) {
    case "poi":
      return poiDoreKey(e.poiKind);
    case "exit":
      return DORE_KEYS.exit_portal;
    case "mob":
      return e.champion ? DORE_KEYS.mob_champion : DORE_KEYS.mob_whirl;
    case "boss":
      return DORE_KEYS.boss_judge;
    case "loot":
      return DORE_KEYS.loot_gem;
    case "player":
      return DORE_KEYS.player;
    default:
      return null;
  }
}

export function hasTexture(scene: Phaser.Scene, key: string): boolean {
  if (!scene.textures.exists(key)) return false;
  const tex = scene.textures.get(key);
  return !!tex && tex.key !== "__MISSING" && tex.source?.[0]?.width > 0;
}

/** Queue Doré kit images; returns keys that were requested. */
export function preloadDoreKit(scene: Phaser.Scene): string[] {
  const keys: string[] = [];
  for (const id of Object.keys(DORE_KEYS) as (keyof typeof DORE_KEYS)[]) {
    const key = DORE_KEYS[id];
    const file = DORE_FILES[id];
    scene.load.image(key, assetUrl(`${DORE_PATH}/${file}`));
    keys.push(key);
  }
  return keys;
}

/** Slice-1 item icons under public/assets/items/ */
export const ITEM_ICON_KEYS: Record<string, string> = {
  ashen_club: "item_ashen_club",
  torn_cape: "item_torn_cape",
  ash_helm: "item_ash_helm",
  pilgrim_boots: "item_pilgrim_boots",
  grave_gloves: "item_grave_gloves",
  rusty_buckler: "item_rusty_buckler",
  bone_shard: "item_bone_shard",
};

const ITEM_ICON_FILES: Record<string, string> = {
  ashen_club: "item_sword.png",
  torn_cape: "item_chest.png",
  ash_helm: "item_helm.png",
  pilgrim_boots: "item_boots.png",
  grave_gloves: "item_gloves.png",
  rusty_buckler: "item_gem.png",
  bone_shard: "item_gem.png",
};

export function preloadItemIcons(scene: Phaser.Scene): string[] {
  const keys: string[] = [];
  for (const [base, key] of Object.entries(ITEM_ICON_KEYS)) {
    const file = ITEM_ICON_FILES[base];
    if (!file) continue;
    scene.load.image(key, assetUrl(`assets/items/${file}`));
    keys.push(key);
  }
  return keys;
}

export function lootTextureKey(item: { baseId?: string | null; name?: string } | undefined): string {
  const n = String(item?.baseId || item?.name || "").toLowerCase();
  if (n.includes("club") || n.includes("sword") || n.includes("ashen_club")) return ITEM_ICON_KEYS.ashen_club;
  if (n.includes("cape") || n.includes("torn_cape") || n.includes("armor")) return ITEM_ICON_KEYS.torn_cape;
  if (n.includes("helm") || n.includes("ash_helm")) return ITEM_ICON_KEYS.ash_helm;
  if (n.includes("boot") || n.includes("pilgrim")) return ITEM_ICON_KEYS.pilgrim_boots;
  if (n.includes("glove") || n.includes("grave")) return ITEM_ICON_KEYS.grave_gloves;
  if (n.includes("buckler") || n.includes("shield")) return ITEM_ICON_KEYS.rusty_buckler;
  if (ITEM_ICON_KEYS[item?.baseId || ""]) return ITEM_ICON_KEYS[item!.baseId!];
  return ITEM_ICON_KEYS.bone_shard;
}



export const RARITY_COLOR: Record<string, number> = {
  normal: 0xb8b0a0,
  magic: 0x4a7fd4,
  rare: 0xd4b84a,
  set: 0x33cc88,
  unique: 0xcc8800,
  canto_unique: 0xee66cc,
};

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  kind: "ember" | "mist" | "ash";
};

/** Runtime textures (tiny) registered once on the scene. */
export function ensureArtTextures(scene: Phaser.Scene) {
  if (scene.textures.exists("tex_shadow")) return;

  // Soft elliptical shadow
  const sh = scene.make.graphics({ x: 0, y: 0 });
  sh.fillStyle(0x000000, 0.35);
  sh.fillEllipse(16, 8, 28, 12);
  sh.generateTexture("tex_shadow", 32, 16);
  sh.destroy();

  // Bone/gold player token (etched disk)
  const pl = scene.make.graphics({ x: 0, y: 0 });
  pl.fillStyle(0x1a1810, 1);
  pl.fillCircle(16, 16, 14);
  pl.fillStyle(0xd7e0d4, 1);
  pl.fillCircle(16, 16, 11);
  pl.lineStyle(2, 0xc9a227, 1);
  pl.strokeCircle(16, 16, 13);
  pl.lineStyle(1, 0x8a7a40, 0.7);
  pl.strokeCircle(16, 16, 8);
  pl.fillStyle(0xc9a227, 0.9);
  pl.fillCircle(16, 12, 2);
  pl.generateTexture("tex_player", 32, 32);
  pl.destroy();

  // Remote player (muted bone)
  const rp = scene.make.graphics({ x: 0, y: 0 });
  rp.fillStyle(0x0e1510, 1);
  rp.fillCircle(14, 14, 12);
  rp.fillStyle(0x7a9a88, 1);
  rp.fillCircle(14, 14, 10);
  rp.lineStyle(1, 0x4a6a58, 0.8);
  rp.strokeCircle(14, 14, 11);
  rp.generateTexture("tex_player_other", 28, 28);
  rp.destroy();
}

export function drawSoftShadow(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  scale = 1
) {
  g.fillStyle(0x000000, 0.28);
  g.fillEllipse(sx, sy + 2, 18 * scale, 8 * scale);
}

/** Isometric ground with hatch — hub bone/fog vs Lust red-black. */
export function drawGround(
  g: Phaser.GameObjects.Graphics,
  bounds: { width: number; height: number },
  isHub: boolean
) {
  const groundA = isHub ? 0x152018 : 0x140c0c;
  const groundB = isHub ? 0x1a2820 : 0x1c1010;
  const hatch = isHub ? 0x2a3a2e : 0x3a1818;
  const edge = isHub ? 0x3a4a3e : 0x4a2020;
  const fog = isHub ? 0x6a7a68 : 0x5a2820;

  const step = 3;
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  for (let x = 0; x <= bounds.width; x += step) {
    for (let y = 0; y <= bounds.height; y += step) {
      const p = worldToScreen(x, y);
      const checker = ((x / step) + (y / step)) % 2 === 0;
      const col = checker ? groundA : groundB;
      g.fillStyle(col, 1);
      // Diamond tile (iso)
      g.fillTriangle(
        p.sx,
        p.sy - hh,
        p.sx + hw,
        p.sy,
        p.sx,
        p.sy + hh
      );
      g.fillTriangle(
        p.sx,
        p.sy - hh,
        p.sx,
        p.sy + hh,
        p.sx - hw,
        p.sy
      );
      // Sparse hatch ticks (Doré-ish engraving)
      if (((x + y) / step) % 3 === 0) {
        g.lineStyle(1, hatch, 0.12);
        g.lineBetween(p.sx - 6, p.sy, p.sx + 6, p.sy);
        g.lineBetween(p.sx, p.sy - 3, p.sx, p.sy + 3);
      }
      if (((x * 3 + y) / step) % 5 === 0) {
        g.lineStyle(1, fog, 0.07);
        g.lineBetween(p.sx - 4, p.sy - 2, p.sx + 4, p.sy + 2);
      }
    }
  }

  // Soft border ring
  const corners = [
    worldToScreen(0, 0),
    worldToScreen(bounds.width, 0),
    worldToScreen(bounds.width, bounds.height),
    worldToScreen(0, bounds.height),
  ];
  g.lineStyle(2, edge, 0.45);
  g.beginPath();
  g.moveTo(corners[0].sx, corners[0].sy);
  for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].sx, corners[i].sy);
  g.closePath();
  g.strokePath();
}


/** Light hatch overlay only (Doré ground stamp underneath). */
export function drawHatchOverlay(
  g: Phaser.GameObjects.Graphics,
  bounds: { width: number; height: number },
  isHub: boolean
) {
  const hatch = isHub ? 0x2a3a2e : 0x3a1818;
  const fog = isHub ? 0x6a7a68 : 0x5a2820;
  const edge = isHub ? 0x3a4a3e : 0x4a2020;
  const step = 6;
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  for (let x = 0; x <= bounds.width; x += step) {
    for (let y = 0; y <= bounds.height; y += step) {
      const p = worldToScreen(x, y);
      if (((x + y) / step) % 2 === 0) {
        g.lineStyle(1, hatch, 0.08);
        g.lineBetween(p.sx - 5, p.sy, p.sx + 5, p.sy);
      }
      if (((x * 3 + y) / step) % 4 === 0) {
        g.lineStyle(1, fog, 0.05);
        g.lineBetween(p.sx - 3, p.sy - 2, p.sx + 3, p.sy + 2);
      }
      if (((x + y * 2) / step) % 5 === 0) {
        g.fillStyle(hatch, 0.035);
        g.fillTriangle(
          p.sx,
          p.sy - hh * 0.35,
          p.sx + hw * 0.35,
          p.sy,
          p.sx,
          p.sy + hh * 0.35
        );
        g.fillTriangle(
          p.sx,
          p.sy - hh * 0.35,
          p.sx,
          p.sy + hh * 0.35,
          p.sx - hw * 0.35,
          p.sy
        );
      }
    }
  }
  const corners = [
    worldToScreen(0, 0),
    worldToScreen(bounds.width, 0),
    worldToScreen(bounds.width, bounds.height),
    worldToScreen(0, bounds.height),
  ];
  g.lineStyle(2, edge, 0.4);
  g.beginPath();
  g.moveTo(corners[0].sx, corners[0].sy);
  for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].sx, corners[i].sy);
  g.closePath();
  g.strokePath();
}

export function drawPoi(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  poiKind: string | undefined,
  compact: boolean
) {
  const r = compact ? 11 : 9;
  drawSoftShadow(g, sx, sy, 0.9);
  const cy = sy - 10;

  if (poiKind === "stash") {
    // Chest silhouette
    g.fillStyle(0x4a5548, 1);
    g.fillRoundedRect(sx - r, cy - r * 0.6, r * 2, r * 1.4, 2);
    g.fillStyle(0x6a7a68, 1);
    g.fillRect(sx - r + 2, cy - r * 0.4, r * 2 - 4, r * 0.5);
    g.lineStyle(1.5, 0xc9a227, 0.85);
    g.strokeRoundedRect(sx - r, cy - r * 0.6, r * 2, r * 1.4, 2);
    g.fillStyle(0xc9a227, 1);
    g.fillCircle(sx, cy + 2, 2);
  } else if (poiKind === "ah") {
    // Scales / AH diamond
    g.fillStyle(0x2a2410, 1);
    g.fillCircle(sx, cy, r);
    g.fillStyle(0xc9a227, 1);
    g.fillTriangle(sx, cy - r + 2, sx + r - 2, cy + 2, sx - r + 2, cy + 2);
    g.lineStyle(1.5, 0xe8d48a, 0.9);
    g.strokeCircle(sx, cy, r);
    g.lineStyle(1, 0x8a7030, 0.7);
    g.lineBetween(sx, cy - 4, sx, cy + 6);
  } else if (poiKind === "quest") {
    // Writ / scroll
    g.fillStyle(0x2a3040, 1);
    g.fillRoundedRect(sx - r * 0.7, cy - r, r * 1.4, r * 2, 2);
    g.fillStyle(0x4a7fd4, 1);
    g.fillRoundedRect(sx - r * 0.55, cy - r * 0.85, r * 1.1, r * 1.7, 1);
    g.lineStyle(1, 0xc9a227, 0.8);
    g.lineBetween(sx - 4, cy - 4, sx + 4, cy - 4);
    g.lineBetween(sx - 4, cy, sx + 3, cy);
    g.lineBetween(sx - 4, cy + 4, sx + 2, cy + 4);
  } else if (poiKind === "portal") {
    // Portal ring
    g.fillStyle(0x1a2030, 0.9);
    g.fillCircle(sx, cy, r + 2);
    g.lineStyle(2, 0x88aaff, 0.95);
    g.strokeCircle(sx, cy, r);
    g.lineStyle(1, 0xc9a227, 0.6);
    g.strokeCircle(sx, cy, r - 4);
    g.fillStyle(0x4466aa, 0.5);
    g.fillCircle(sx, cy, r - 5);
  } else {
    // Guide / NPC — hooded figure
    g.fillStyle(0x2a3228, 1);
    g.fillCircle(sx, cy + 2, r * 0.85);
    g.fillStyle(0xd7e0d4, 1);
    g.fillCircle(sx, cy - 4, r * 0.55);
    g.fillStyle(0x1a2018, 1);
    g.fillTriangle(sx - r * 0.7, cy - 2, sx + r * 0.7, cy - 2, sx, cy - r - 2);
    g.lineStyle(1, 0xc9a227, 0.7);
    g.strokeCircle(sx, cy, r);
  }
}

export function drawExit(g: Phaser.GameObjects.Graphics, sx: number, sy: number) {
  drawSoftShadow(g, sx, sy, 1.1);
  const cy = sy - 8;
  // Archway / gate
  g.fillStyle(0x1a2840, 0.95);
  g.fillTriangle(sx, cy - 18, sx + 14, cy + 4, sx - 14, cy + 4);
  g.fillStyle(0x88aaff, 0.35);
  g.fillTriangle(sx, cy - 12, sx + 8, cy + 2, sx - 8, cy + 2);
  g.lineStyle(2, 0xaaccff, 0.95);
  g.strokeTriangle(sx, cy - 18, sx + 14, cy + 4, sx - 14, cy + 4);
  g.lineStyle(1, 0xc9a227, 0.7);
  g.lineBetween(sx - 6, cy + 2, sx + 6, cy + 2);
}

export function drawMob(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  champion: boolean
) {
  const scale = champion ? 1.25 : 1;
  drawSoftShadow(g, sx, sy, scale);
  const cy = sy - 6 * scale;
  const r = (champion ? 10 : 7) * scale;
  // Whirl shade — jagged / wind silhouette
  const body = champion ? 0xcc3333 : 0x6a3030;
  g.fillStyle(body, 1);
  g.fillCircle(sx, cy, r);
  g.fillStyle(0x2a1010, 0.7);
  g.fillEllipse(sx - 2, cy - 2, r * 0.7, r * 0.5);
  // Gale streaks
  g.lineStyle(1.5, champion ? 0xff8866 : 0xaa6666, 0.7);
  g.lineBetween(sx - r - 4, cy - 2, sx - r + 2, cy + 4);
  g.lineBetween(sx + r + 4, cy - 3, sx + r - 2, cy + 3);
  if (champion) {
    g.lineStyle(1.5, 0xffcc66, 0.85);
    g.strokeCircle(sx, cy, r + 2);
  }
}

export function drawBoss(g: Phaser.GameObjects.Graphics, sx: number, sy: number) {
  drawSoftShadow(g, sx, sy, 1.8);
  const cy = sy - 14;
  const r = 16;
  g.fillStyle(0x4a1010, 1);
  g.fillCircle(sx, cy, r);
  g.fillStyle(0xaa2222, 1);
  g.fillCircle(sx, cy, r - 3);
  // Horns-ish
  g.fillStyle(0xc9a227, 1);
  g.fillTriangle(sx - 10, cy - r + 4, sx - 16, cy - r - 10, sx - 4, cy - r + 2);
  g.fillTriangle(sx + 10, cy - r + 4, sx + 16, cy - r - 10, sx + 4, cy - r + 2);
  g.lineStyle(2.5, 0xffcc00, 1);
  g.strokeCircle(sx, cy, r);
  g.lineStyle(1, 0x8a2020, 0.8);
  g.strokeCircle(sx, cy, r - 5);
  // Eyes
  g.fillStyle(0xffcc66, 1);
  g.fillCircle(sx - 5, cy - 2, 2);
  g.fillCircle(sx + 5, cy - 2, 2);
}

export function drawLoot(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  rarity: string | undefined,
  compact: boolean,
  t: number
) {
  const col = RARITY_COLOR[rarity || "normal"] || 0xffffff;
  drawSoftShadow(g, sx, sy, 0.55);
  const bob = Math.sin(t * 0.004 + sx * 0.01) * 2;
  const cy = sy - 10 + bob;
  const s = compact ? 7 : 6;
  // Gem diamond
  g.fillStyle(col, 1);
  g.fillTriangle(sx, cy - s, sx + s, cy, sx, cy + s);
  g.fillTriangle(sx, cy - s, sx, cy + s, sx - s, cy);
  g.lineStyle(1, 0xffffff, 0.45);
  g.strokeTriangle(sx, cy - s, sx + s, cy, sx, cy + s);
  g.lineStyle(1, 0x000000, 0.35);
  g.strokeTriangle(sx, cy - s, sx, cy + s, sx - s, cy);
}

export function drawPlayer(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  isYou: boolean
) {
  drawSoftShadow(g, sx, sy, isYou ? 1.05 : 0.9);
  const cy = sy - 9;
  if (isYou) {
    g.fillStyle(0x1a1810, 1);
    g.fillCircle(sx, cy, 11);
    g.fillStyle(0xe8f0e4, 1);
    g.fillCircle(sx, cy, 9);
    g.lineStyle(2.5, 0xc9a227, 1);
    g.strokeCircle(sx, cy, 12);
    g.lineStyle(1, 0x8a7a40, 0.6);
    g.strokeCircle(sx, cy, 6);
    // Gold accent pin
    g.fillStyle(0xc9a227, 1);
    g.fillCircle(sx, cy - 4, 2);
  } else {
    g.fillStyle(0x0e1510, 1);
    g.fillCircle(sx, cy, 10);
    g.fillStyle(0x7a9a88, 1);
    g.fillCircle(sx, cy, 8);
    g.lineStyle(1.5, 0x4a6a58, 0.85);
    g.strokeCircle(sx, cy, 10);
  }
}

export function spawnParticles(
  particles: Particle[],
  isHub: boolean,
  bounds: { width: number; height: number },
  count: number
) {
  for (let i = 0; i < count; i++) {
    if (particles.length > 48) break;
    const x = Math.random() * bounds.width;
    const y = Math.random() * bounds.height;
    if (isHub) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.3 - 0.15,
        life: 2 + Math.random() * 3,
        maxLife: 4,
        size: 1.5 + Math.random() * 2.5,
        color: 0xa8b8a0,
        kind: "mist",
      });
    } else {
      const ember = Math.random() > 0.35;
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 1.2 + 0.4,
        vy: -0.4 - Math.random() * 0.8,
        life: 1.2 + Math.random() * 2,
        maxLife: 3,
        size: ember ? 1.2 + Math.random() * 1.8 : 1 + Math.random(),
        color: ember ? 0xff6622 : 0x886644,
        kind: ember ? "ember" : "ash",
      });
    }
  }
}

export function tickParticles(particles: Particle[], dtSec: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    if (p.kind === "mist") {
      p.vx += (Math.random() - 0.5) * 0.2 * dtSec;
    }
    p.life -= dtSec;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

export function drawParticles(g: Phaser.GameObjects.Graphics, particles: Particle[]) {
  for (const p of particles) {
    const scr = worldToScreen(p.x, p.y);
    const a = Math.max(0, p.life / p.maxLife);
    if (p.kind === "mist") {
      g.fillStyle(p.color, 0.08 + a * 0.12);
      g.fillCircle(scr.sx, scr.sy - 20, p.size * 3);
    } else if (p.kind === "ember") {
      g.fillStyle(p.color, 0.35 + a * 0.55);
      g.fillCircle(scr.sx, scr.sy - 8, p.size);
      g.fillStyle(0xffcc66, 0.25 * a);
      g.fillCircle(scr.sx, scr.sy - 8, p.size * 0.45);
    } else {
      g.fillStyle(p.color, 0.2 + a * 0.35);
      g.fillCircle(scr.sx, scr.sy - 6, p.size);
    }
  }
}


/** Dark soft pad under entities so Doré sprites pop off busy hatch. */
export function drawEntityPad(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  scale = 1
) {
  g.fillStyle(0x000000, 0.4);
  g.fillEllipse(sx, sy + 3, 30 * scale, 13 * scale);
  g.fillStyle(0x0a100c, 0.22);
  g.fillEllipse(sx, sy + 3, 44 * scale, 20 * scale);
}

/** Hub framing: tree silhouettes + soft vignette so the clearing reads as a place. */
export function drawHubDecor(
  g: Phaser.GameObjects.Graphics,
  bounds: { width: number; height: number },
  t: number
) {
  const bw = bounds.width;
  const bh = bounds.height;
  const ring = [
    worldToScreen(2, 2),
    worldToScreen(bw - 2, 2),
    worldToScreen(bw - 2, bh - 2),
    worldToScreen(2, bh - 2),
  ];
  g.lineStyle(18, 0x050805, 0.35);
  g.beginPath();
  g.moveTo(ring[0].sx, ring[0].sy);
  for (let i = 1; i < ring.length; i++) g.lineTo(ring[i].sx, ring[i].sy);
  g.closePath();
  g.strokePath();
  g.lineStyle(40, 0x030503, 0.18);
  g.beginPath();
  g.moveTo(ring[0].sx, ring[0].sy);
  for (let i = 1; i < ring.length; i++) g.lineTo(ring[i].sx, ring[i].sy);
  g.closePath();
  g.strokePath();

  const trees: Array<[number, number, number]> = [
    [10, 18, 1.1],
    [22, 8, 0.9],
    [40, 6, 1.2],
    [70, 10, 1.0],
    [100, 16, 1.15],
    [118, 30, 0.95],
    [120, 55, 1.1],
    [112, 90, 1.0],
    [90, 118, 1.2],
    [50, 122, 0.9],
    [18, 110, 1.05],
    [6, 70, 1.15],
    [8, 45, 0.85],
    [30, 100, 0.8],
    [105, 70, 0.9],
  ];
  for (const [tx, ty, sc] of trees) {
    if (tx >= bw - 2 || ty >= bh - 2) continue;
    const p = worldToScreen(tx, ty);
    const sway = Math.sin(t * 0.0012 + tx * 0.2) * 1.5;
    drawTreeSilhouette(g, p.sx + sway, p.sy, sc);
  }

  const center = worldToScreen(bw * 0.5, bh * 0.55);
  g.fillStyle(0x0c1410, 0.28);
  g.fillEllipse(center.sx, center.sy, 160, 70);
  g.fillStyle(0x101a14, 0.18);
  g.fillEllipse(center.sx, center.sy, 100, 42);
}

function drawTreeSilhouette(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  scale: number
) {
  const h = 38 * scale;
  const w = 16 * scale;
  g.fillStyle(0x060a08, 0.72);
  g.fillRect(sx - 2 * scale, sy - h * 0.35, 4 * scale, h * 0.45);
  g.fillStyle(0x0a120e, 0.78);
  g.fillTriangle(sx, sy - h, sx + w, sy - h * 0.35, sx - w, sy - h * 0.35);
  g.fillStyle(0x0e1812, 0.65);
  g.fillTriangle(
    sx,
    sy - h * 0.85,
    sx + w * 0.85,
    sy - h * 0.2,
    sx - w * 0.85,
    sy - h * 0.2
  );
  g.lineStyle(1, 0x2a3a2e, 0.25);
  g.lineBetween(sx - w * 0.5, sy - h * 0.5, sx + w * 0.4, sy - h * 0.55);
}

/** Pulsing gold/red ring under Lust exit portal. */
export function drawExitSpotlight(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  t: number,
  compact: boolean
) {
  const pulse = 0.55 + 0.45 * Math.sin(t * 0.005);
  const r0 = (compact ? 46 : 36) * (0.92 + pulse * 0.12);
  g.fillStyle(0x4a1018, 0.22 + pulse * 0.12);
  g.fillEllipse(sx, sy + 6, r0 * 2.2, r0 * 0.9);
  g.lineStyle(3.5, 0xc9a227, 0.35 + pulse * 0.45);
  g.strokeEllipse(sx, sy + 6, r0 * 2.1, r0 * 0.85);
  g.lineStyle(2, 0xaa3333, 0.4 + pulse * 0.35);
  g.strokeEllipse(sx, sy + 6, r0 * 1.55, r0 * 0.62);
  g.lineStyle(1.5, 0xffcc66, 0.25 + pulse * 0.35);
  g.strokeEllipse(sx, sy + 6, r0 * 1.1, r0 * 0.42);
  const ay = sy - (compact ? 62 : 52) - Math.sin(t * 0.006) * 3;
  g.fillStyle(0xc9a227, 0.75 + pulse * 0.2);
  g.fillTriangle(sx, ay - 8, sx + 8, ay + 4, sx - 8, ay + 4);
  g.fillStyle(0xaa3333, 0.7);
  g.fillTriangle(sx, ay - 2, sx + 5, ay + 6, sx - 5, ay + 6);
}

/** Camera-sized radial vignette texture (drawn once, reused). */
export function ensureVignetteTexture(scene: Phaser.Scene, key = "tex_vignette"): string {
  if (scene.textures.exists(key)) return key;
  const size = 256;
  const canvasTex = scene.textures.createCanvas(key, size, size);
  const ctx = canvasTex?.getContext();
  if (!ctx || !canvasTex) return key;
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.72);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.35)");
  grad.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  canvasTex.refresh();
  return key;
}

/** Expanding kill ring + flash so a death is a beat, not a vanish. */
export function drawKillRing(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  prog: number,
  boss: boolean
) {
  const t = Math.max(0, Math.min(1, prog));
  const r = (boss ? 26 : 16) + t * (boss ? 70 : 44);
  const a = (1 - t) * (1 - t);
  g.lineStyle(boss ? 5 : 3, 0xffd27a, 0.9 * a);
  g.strokeEllipse(sx, sy - 6, r * 2, r);
  g.lineStyle(1.5, 0xffffff, 0.6 * a);
  g.strokeEllipse(sx, sy - 6, r * 1.5, r * 0.75);
  if (t < 0.35) {
    g.fillStyle(0xfff0c0, 0.55 * (1 - t / 0.35));
    g.fillEllipse(sx, sy - 14, (boss ? 60 : 36) * (1 + t), (boss ? 44 : 26) * (1 + t));
  }
}

export function spawnHitBurst(particles: Particle[], wx: number, wy: number) {
  for (let i = 0; i < 8; i++) {
    if (particles.length > 64) break;
    const ang = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
    particles.push({
      x: wx,
      y: wy,
      vx: Math.cos(ang) * (1.5 + Math.random()),
      vy: Math.sin(ang) * (1.5 + Math.random()),
      life: 0.35 + Math.random() * 0.25,
      maxLife: 0.6,
      size: 1.5 + Math.random() * 2,
      color: Math.random() > 0.4 ? 0xffcc66 : 0xff6644,
      kind: "ember",
    });
  }
}

export function spawnLootSparkle(particles: Particle[], wx: number, wy: number) {
  for (let i = 0; i < 10; i++) {
    if (particles.length > 64) break;
    particles.push({
      x: wx + (Math.random() - 0.5) * 0.6,
      y: wy + (Math.random() - 0.5) * 0.6,
      vx: (Math.random() - 0.5) * 1.2,
      vy: -0.8 - Math.random() * 1.2,
      life: 0.5 + Math.random() * 0.4,
      maxLife: 0.9,
      size: 1.2 + Math.random() * 2,
      color: 0xffe08a,
      kind: "ember",
    });
  }
}

/* ————————————————————————————————————————————————————————————————————————
 *  Tiled Doré ground
 * ———————————————————————————————————————————————————————————————————————— */

export type GroundTiles = {
  /** One container holds every tile so the diamond clip is a single stencil pass. */
  root: Phaser.GameObjects.Container;
  images: Phaser.GameObjects.Image[];
  maskGfx: Phaser.GameObjects.Graphics;
  mask: Phaser.Display.Masks.GeometryMask;
};

/** Tile scale applied to the 1280×720 ground plate (1 = texel-per-css-px at desktop zoom). */
export const GROUND_TILE_SCALE = 1;

/**
 * Stamp the 1280×720 ground plate across the iso room diamond as a grid of
 * mirror-tiled images (flipX/flipY alternate so seams vanish), clipped to the
 * diamond with one geometry mask on the parent container. Same texture → one
 * batch; texels stay ~1:1 so mobile sees crisp etching instead of a stretch.
 */
export function buildGroundTiles(
  scene: Phaser.Scene,
  texKey: string,
  bounds: { width: number; height: number },
  isHub: boolean
): GroundTiles {
  const src = scene.textures.get(texKey).source[0];
  const tw = Math.max(64, src.width * GROUND_TILE_SCALE);
  const th = Math.max(64, src.height * GROUND_TILE_SCALE);

  const corners = [
    worldToScreen(0, 0),
    worldToScreen(bounds.width, 0),
    worldToScreen(bounds.width, bounds.height),
    worldToScreen(0, bounds.height),
  ];
  const pad = 40;
  const minX = Math.min(...corners.map((c) => c.sx)) - pad;
  const maxX = Math.max(...corners.map((c) => c.sx)) + pad;
  const minY = Math.min(...corners.map((c) => c.sy)) - pad;
  const maxY = Math.max(...corners.map((c) => c.sy)) + pad;

  // Diamond clip (slightly inflated so the border stroke sits on texture)
  const maskGfx = scene.make.graphics({ x: 0, y: 0 }, false);
  maskGfx.fillStyle(0xffffff, 1);
  maskGfx.beginPath();
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const inflate = 1.02;
  maskGfx.moveTo(cx + (corners[0].sx - cx) * inflate, cy + (corners[0].sy - cy) * inflate);
  for (let i = 1; i < corners.length; i++) {
    maskGfx.lineTo(cx + (corners[i].sx - cx) * inflate, cy + (corners[i].sy - cy) * inflate);
  }
  maskGfx.closePath();
  maskGfx.fillPath();
  const mask = maskGfx.createGeometryMask();

  const tint = isHub ? 0xc6d0c4 : 0xb89c98;
  const alpha = isHub ? 0.95 : 0.9;
  const root = scene.add.container(0, 0);
  root.setDepth(0);
  root.setMask(mask);
  // Solid iso diamond under the stamp so no seam / transparent texel ever
  // shows the camera background as a black void between tiles.
  const under = scene.make.graphics({ x: 0, y: 0 }, false);
  under.fillStyle(isHub ? 0x11160f : 0x1a0806, 1);
  under.beginPath();
  under.moveTo(corners[0].sx, corners[0].sy);
  for (let i = 1; i < corners.length; i++) under.lineTo(corners[i].sx, corners[i].sy);
  under.closePath();
  under.fillPath();
  root.add(under);
  const images: Phaser.GameObjects.Image[] = [];
  const cols = Math.ceil((maxX - minX) / tw) + 1;
  const rows = Math.ceil((maxY - minY) / th) + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = minX + c * tw;
      const y = minY + r * th;
      if (x > maxX || y > maxY) continue;
      const img = scene.make.image({ x, y, key: texKey }, false);
      img.setOrigin(0, 0);
      img.setDisplaySize(tw, th);
      img.setFlip(c % 2 === 1, r % 2 === 1);
      img.setTint(tint);
      img.setAlpha(alpha);
      root.add(img);
      images.push(img);
    }
  }
  return { root, images, maskGfx, mask };
}

export function destroyGroundTiles(t: GroundTiles | null) {
  if (!t) return;
  t.root.destroy(true);
  t.mask.destroy();
  t.maskGfx.destroy();
}

/* ————————————————————————————————————————————————————————————————————————
 *  Foe HP bar (bone frame · crimson fill · gold ticks)
 * ———————————————————————————————————————————————————————————————————————— */

export function drawFoeHpBar(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  hp: number,
  maxHp: number,
  w: number,
  opts: { compact: boolean; boss?: boolean; ally?: boolean }
) {
  if (maxHp == null || maxHp <= 0) return;
  const ratio = Math.max(0, Math.min(1, hp / maxHp));
  const barW = opts.compact ? w * 1.3 : w;
  const barH = opts.boss ? (opts.compact ? 9 : 7) : opts.compact ? 7 : 5;
  const left = x - barW / 2;
  // Shadow + bone frame
  g.fillStyle(0x000000, 0.6);
  g.fillRect(left - 2, y - 2, barW + 4, barH + 4);
  g.fillStyle(0x1a1610, 1);
  g.fillRect(left, y, barW, barH);
  // Fill: crimson for foes, bone-green for allies
  const fill = opts.ally ? (ratio > 0.35 ? 0x9fbf8a : 0xcc3333) : ratio > 0.3 ? 0xa8241f : 0xd63a2a;
  g.fillStyle(fill, 1);
  g.fillRect(left, y, Math.max(0, barW * ratio), barH);
  // Gloss line
  g.fillStyle(0xffffff, 0.12);
  g.fillRect(left, y, Math.max(0, barW * ratio), Math.max(1, barH * 0.35));
  // Gold ticks at quarters
  g.lineStyle(1, 0xc9a227, 0.5);
  for (let i = 1; i < 4; i++) {
    const tx = Math.round(left + (barW * i) / 4) + 0.5;
    g.lineBetween(tx, y, tx, y + barH);
  }
  // Bone outline + gold finials
  g.lineStyle(1, 0xd9cfae, 0.8);
  g.strokeRect(left, y, barW, barH);
  g.fillStyle(0xc9a227, 0.95);
  g.fillRect(left - 2, y - 1, 2, barH + 2);
  g.fillRect(left + barW, y - 1, 2, barH + 2);
}

/* ————————————————————————————————————————————————————————————————————————
 *  Loot glow / pulse
 * ———————————————————————————————————————————————————————————————————————— */

export function drawLootGlow(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  color: number,
  t: number,
  compact: boolean,
  strong = false
) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.006 + sx * 0.02);
  const s = (compact ? 1.5 : 1) * (strong ? 1.25 : 1);
  g.fillStyle(color, 0.10 + pulse * 0.12);
  g.fillEllipse(sx, sy + 2, 40 * s * (0.9 + pulse * 0.15), 18 * s * (0.9 + pulse * 0.15));
  g.fillStyle(color, 0.16 + pulse * 0.18);
  g.fillEllipse(sx, sy + 2, 22 * s, 10 * s);
  g.lineStyle(1, color, 0.35 + pulse * 0.4);
  g.strokeEllipse(sx, sy + 2, 30 * s * (0.95 + pulse * 0.1), 13 * s * (0.95 + pulse * 0.1));
  // Vertical light shaft
  g.fillStyle(color, 0.05 + pulse * 0.07);
  g.fillTriangle(sx - 5 * s, sy + 1, sx + 5 * s, sy + 1, sx, sy - 34 * s);
}

/** Faint ember rim under foes so smoky shades read on red-black ground. */
export function drawFoeGlow(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  t: number,
  opts: { compact: boolean; champion?: boolean; boss?: boolean }
) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.004 + sx * 0.03);
  const s = (opts.compact ? 1.5 : 1) * (opts.boss ? 2.1 : opts.champion ? 1.35 : 1);
  const col = opts.boss ? 0xd63a2a : opts.champion ? 0xff7a3a : 0xc0402a;
  g.fillStyle(col, 0.06 + pulse * 0.06);
  g.fillEllipse(sx, sy + 3, 46 * s, 20 * s);
  g.lineStyle(1.5, col, 0.18 + pulse * 0.24);
  g.strokeEllipse(sx, sy + 3, 34 * s, 14 * s);
}

export function spawnKillBurst(particles: Particle[], wx: number, wy: number, boss = false) {
  const n = boss ? 30 : 20;
  for (let i = 0; i < n; i++) {
    if (particles.length > 120) break;
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const sp = 2.6 + Math.random() * (boss ? 3.5 : 2.6);
    particles.push({
      x: wx,
      y: wy,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 0.6,
      life: 0.5 + Math.random() * 0.4,
      maxLife: 0.9,
      size: 2 + Math.random() * (boss ? 3.5 : 2.5),
      color: i % 3 === 0 ? 0xc9a227 : i % 3 === 1 ? 0xff5533 : 0xd9cfae,
      kind: i % 4 === 0 ? "ash" : "ember",
    });
  }
}
