import Phaser from "phaser";
import { worldToScreen, TILE_W, TILE_H } from "../util/iso";
import { assetUrl } from "../items/icons";


/** Doré Slice-1 kit under public/assets/dore/ */
export const DORE_PATH = "assets/dore";

export const DORE_KEYS = {
  hub_ground: "dore_hub_ground",
  lust_ground: "dore_lust_ground",
  player: "dore_player",
  /** 8-dir idle / walk-A plates (west dirs = flipX of E/NE/SE). */
  player_n: "dore_player_n",
  player_ne: "dore_player_ne",
  player_e: "dore_player_e",
  player_se: "dore_player_se",
  player_s: "dore_player_s",
  player_e_walkb: "dore_player_e_walkb",
  player_s_walkb: "dore_player_s_walkb",
  /** Legacy 2-dir walk frames (fallback only). */
  player_walk_a: "dore_player_walk_a",
  player_walk_b: "dore_player_walk_b",
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
  player_n: "player_n.png",
  player_ne: "player_ne.png",
  player_e: "player_e.png",
  player_se: "player_se.png",
  player_s: "player_s.png",
  player_e_walkb: "player_e_walkb.png",
  player_s_walkb: "player_s_walkb.png",
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
  [DORE_KEYS.player]: { h: 78 },
  [DORE_KEYS.player_n]: { h: 78 },
  [DORE_KEYS.player_ne]: { h: 78 },
  [DORE_KEYS.player_e]: { h: 78 },
  [DORE_KEYS.player_se]: { h: 78 },
  [DORE_KEYS.player_s]: { h: 78 },
  [DORE_KEYS.player_e_walkb]: { h: 78 },
  [DORE_KEYS.player_s_walkb]: { h: 78 },
  [DORE_KEYS.player_walk_a]: { h: 78 },
  [DORE_KEYS.player_walk_b]: { h: 78 },
  [DORE_KEYS.player_walk_a2]: { h: 78 },
  [DORE_KEYS.player_walk_b2]: { h: 78 },
  [DORE_KEYS.poi_guide]: { h: 74 },
  [DORE_KEYS.poi_stash]: { h: 60 },
  [DORE_KEYS.poi_ah]: { h: 68 },
  [DORE_KEYS.poi_quest]: { h: 68 },
  [DORE_KEYS.exit_portal]: { h: 110 },
  [DORE_KEYS.mob_whirl]: { h: 92 },
  [DORE_KEYS.mob_champion]: { h: 108 },
  [DORE_KEYS.boss_judge]: { h: 152 },
  [DORE_KEYS.loot_gem]: { h: 38 },
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
  [DORE_KEYS.player_n]: DORE_KEYS.player,
  [DORE_KEYS.player_ne]: DORE_KEYS.player,
  [DORE_KEYS.player_e]: DORE_KEYS.player,
  [DORE_KEYS.player_se]: DORE_KEYS.player,
  [DORE_KEYS.player_s]: DORE_KEYS.player,
  [DORE_KEYS.player_e_walkb]: DORE_KEYS.player,
  [DORE_KEYS.player_s_walkb]: DORE_KEYS.player,
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

/* ————————————————————————————————————————————————————————————————————————
 *  8-direction player facing
 * ———————————————————————————————————————————————————————————————————————— */

export type Facing8 = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/** atan2(screenDy, screenDx) buckets: 0=E … clockwise to NE. */
const FACING8_ORDER: Facing8[] = ["e", "se", "s", "sw", "w", "nw", "n", "ne"];

/**
 * Map each facing to a real texture base (N/NE/E/SE/S) + whether to flipX.
 * West / NW / SW are mirrors of E / NE / SE — never flip one sprite for all dirs.
 */
const FACING_TEX: Record<Facing8, { base: "n" | "ne" | "e" | "se" | "s"; flipX: boolean }> = {
  n: { base: "n", flipX: false },
  ne: { base: "ne", flipX: false },
  e: { base: "e", flipX: false },
  se: { base: "se", flipX: false },
  s: { base: "s", flipX: false },
  sw: { base: "se", flipX: true },
  w: { base: "e", flipX: true },
  nw: { base: "ne", flipX: true },
};

const PLAYER_DIR_KEY: Record<"n" | "ne" | "e" | "se" | "s", string> = {
  n: DORE_KEYS.player_n,
  ne: DORE_KEYS.player_ne,
  e: DORE_KEYS.player_e,
  se: DORE_KEYS.player_se,
  s: DORE_KEYS.player_s,
};

const PLAYER_WALKB_KEY: Partial<Record<"n" | "ne" | "e" | "se" | "s", string>> = {
  e: DORE_KEYS.player_e_walkb,
  s: DORE_KEYS.player_s_walkb,
};

/**
 * World velocity → 8-way facing via screen-space atan2 (iso: sx∝x−y, sy∝x+y).
 * Returns null when speed is below `minSp` so callers keep last facing / aim.
 */
export function facing8FromWorldVel(vx: number, vy: number, minSp = 0.12): Facing8 | null {
  const sx = vx - vy;
  const sy = vx + vy;
  if (Math.hypot(sx, sy) < minSp) return null;
  const ang = Math.atan2(sy, sx);
  const sector = Math.round(ang / (Math.PI / 4));
  const idx = ((sector % 8) + 8) % 8;
  return FACING8_ORDER[idx];
}

export function facing8FromAim(aimX: number, aimY: number): Facing8 {
  return facing8FromWorldVel(aimX, aimY, 0.001) ?? "s";
}

export function facing8FlipX(dir: Facing8): boolean {
  return FACING_TEX[dir].flipX;
}

/** True when the figure faces screen-left (west half) — for attack swipe / punch. */
export function facing8IsLeft(dir: Facing8): boolean {
  return dir === "w" || dir === "nw" || dir === "sw";
}

/**
 * Texture key + flipX for a facing. `walkB` picks the stride-B plate when one
 * exists for that base dir; otherwise reuses the idle/A plate (bob still animates).
 */
export function playerFacingVisual(
  dir: Facing8,
  walkB: boolean,
  hasTex: (key: string) => boolean
): { key: string; flipX: boolean } {
  const { base, flipX } = FACING_TEX[dir];
  let key = PLAYER_DIR_KEY[base];
  if (walkB) {
    const wb = PLAYER_WALKB_KEY[base];
    if (wb && hasTex(wb)) key = wb;
  }
  if (!hasTex(key)) {
    // Fall back to south / legacy idle so a missing dir never blanks the player.
    if (hasTex(DORE_KEYS.player_s)) key = DORE_KEYS.player_s;
    else if (hasTex(DORE_KEYS.player)) key = DORE_KEYS.player;
  }
  return { key, flipX };
}


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

const FOE_TEX_KEYS = [DORE_KEYS.mob_whirl, DORE_KEYS.mob_champion, DORE_KEYS.boss_judge];

/**
 * Lift luminance + stamp a gold/crimson edge rim on Lust foe plates so dark
 * etchings stay obvious on red-black ground (mobile especially).
 * Idempotent: skips keys already enhanced.
 */
export function enhanceLustFoeTextures(scene: Phaser.Scene): void {
  for (const key of FOE_TEX_KEYS) {
    if (!hasTexture(scene, key)) continue;
    if (scene.textures.exists(key + "__lust_boost")) continue;
    const srcImg = scene.textures.get(key).getSourceImage() as
      | HTMLImageElement
      | HTMLCanvasElement;
    const w = (srcImg as HTMLImageElement).width || (srcImg as any).width;
    const h = (srcImg as HTMLImageElement).height || (srcImg as any).height;
    if (!w || !h) continue;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(srcImg as CanvasImageSource, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    // Pass 1: lift midtones (keep alpha)
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a < 12) continue;
      // gamma-ish lift + warm bias so crimson etch reads warm-gold
      d[i] = Math.min(255, Math.round(d[i] * 1.55 + 36));
      d[i + 1] = Math.min(255, Math.round(d[i + 1] * 1.4 + 22));
      d[i + 2] = Math.min(255, Math.round(d[i + 2] * 1.25 + 14));
    }
    // Pass 2: gold/crimson rim on alpha edges
    const copy = new Uint8ClampedArray(d);
    const rimR = 232, rimG = 200, rimB = 106; // gold
    const rimR2 = 220, rimG2 = 72, rimB2 = 48; // crimson
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        const a = copy[i + 3];
        if (a >= 40) continue;
        // near an opaque texel?
        let near = false;
        for (let oy = -1; oy <= 1 && !near; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            if (copy[((y + oy) * w + (x + ox)) * 4 + 3] >= 80) {
              near = true;
              break;
            }
          }
        }
        if (!near) continue;
        const mix = key === DORE_KEYS.mob_whirl ? 0.55 : 0.4;
        d[i] = Math.round(rimR * (1 - mix) + rimR2 * mix);
        d[i + 1] = Math.round(rimG * (1 - mix) + rimG2 * mix);
        d[i + 2] = Math.round(rimB * (1 - mix) + rimB2 * mix);
        d[i + 3] = Math.max(a, 210);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    // Replace texture in place
    scene.textures.remove(key);
    scene.textures.addCanvas(key, canvas);
    // Marker so we do not double-boost on scene restarts that keep the texture cache
    const mark = document.createElement("canvas");
    mark.width = 1;
    mark.height = 1;
    scene.textures.addCanvas(key + "__lust_boost", mark);
  }
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
  kind: "ember" | "mist" | "ash" | "dust";
};

/** Runtime textures (tiny) registered once on the scene. */
export function ensureArtTextures(scene: Phaser.Scene) {
  if (scene.textures.exists("tex_shadow")) return;

  // Soft elliptical shadow (layered falloff)
  const sh = scene.make.graphics({ x: 0, y: 0 });
  sh.fillStyle(0x000000, 0.18);
  sh.fillEllipse(24, 12, 44, 20);
  sh.fillStyle(0x000000, 0.28);
  sh.fillEllipse(24, 12, 34, 14);
  sh.fillStyle(0x000000, 0.4);
  sh.fillEllipse(24, 12, 22, 9);
  sh.generateTexture("tex_shadow", 48, 24);
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
  // Hub: coarser, fainter ticks so the Doré plate reads without visual noise.
  const step = isHub ? 10 : 6;
  const hatchA = isHub ? 0.035 : 0.08;
  const fogA = isHub ? 0.025 : 0.05;
  const triA = isHub ? 0.015 : 0.035;
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  for (let x = 0; x <= bounds.width; x += step) {
    for (let y = 0; y <= bounds.height; y += step) {
      const p = worldToScreen(x, y);
      if (((x + y) / step) % 3 === 0) {
        g.lineStyle(1, hatch, hatchA);
        g.lineBetween(p.sx - 4, p.sy, p.sx + 4, p.sy);
      }
      if (((x * 3 + y) / step) % 5 === 0) {
        g.lineStyle(1, fog, fogA);
        g.lineBetween(p.sx - 3, p.sy - 2, p.sx + 3, p.sy + 2);
      }
      if (!isHub && ((x + y * 2) / step) % 5 === 0) {
        g.fillStyle(hatch, triA);
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
  const body = champion ? 0xe84838 : 0xb05040;
  g.fillStyle(body, 1);
  g.fillCircle(sx, cy, r);
  g.fillStyle(0x3a1810, 0.55);
  g.fillEllipse(sx - 2, cy - 2, r * 0.7, r * 0.5);
  // Gale streaks
  g.lineStyle(2, champion ? 0xffaa66 : 0xff8866, 0.9);
  g.lineBetween(sx - r - 4, cy - 2, sx - r + 2, cy + 4);
  g.lineBetween(sx + r + 4, cy - 3, sx + r - 2, cy + 3);
  g.lineStyle(2, champion ? 0xffd27a : 0xe8b84a, 0.95);
  g.strokeCircle(sx, cy, r + 2);
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
    if (particles.length > 72) break;
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
    } else if (p.kind === "dust") {
      p.vx *= 1 - 1.8 * dtSec;
      p.vy += 0.6 * dtSec;
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
    } else if (p.kind === "dust") {
      g.fillStyle(p.color, 0.18 + a * 0.35);
      g.fillEllipse(scr.sx, scr.sy + 2, p.size * 2.4, p.size * 1.1);
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
  g.fillStyle(0x000000, 0.55);
  g.fillEllipse(sx, sy + 3, 34 * scale, 15 * scale);
  g.fillStyle(0x050308, 0.32);
  g.fillEllipse(sx, sy + 3, 52 * scale, 24 * scale);
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
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.22, size / 2, size / 2, size * 0.78);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.45, "rgba(0,0,0,0.22)");
  grad.addColorStop(0.72, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0.92)");
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
  const r = (boss ? 36 : 18) + t * (boss ? 110 : 54);
  const a = (1 - t) * (1 - t);
  g.lineStyle(boss ? 8 : 4, 0xffd27a, 0.95 * a);
  g.strokeEllipse(sx, sy - 6, r * 2, r);
  g.lineStyle(boss ? 3.5 : 2, 0xff6644, 0.55 * a);
  g.strokeEllipse(sx, sy - 6, r * 1.75, r * 0.88);
  g.lineStyle(1.5, 0xffffff, 0.7 * a);
  g.strokeEllipse(sx, sy - 6, r * 1.45, r * 0.72);
  if (boss && t < 0.55) {
    g.lineStyle(2, 0xc9a227, 0.45 * a);
    g.strokeEllipse(sx, sy - 6, r * 2.35, r * 1.15);
  }
  if (t < 0.4) {
    g.fillStyle(0xfff0c0, (boss ? 0.78 : 0.62) * (1 - t / 0.4));
    g.fillEllipse(sx, sy - 14, (boss ? 88 : 42) * (1 + t), (boss ? 64 : 30) * (1 + t));
  }
}

export function spawnHitBurst(particles: Particle[], wx: number, wy: number) {
  for (let i = 0; i < 12; i++) {
    if (particles.length > 90) break;
    const ang = (Math.PI * 2 * i) / 12 + Math.random() * 0.35;
    particles.push({
      x: wx,
      y: wy,
      vx: Math.cos(ang) * (1.8 + Math.random() * 1.4),
      vy: Math.sin(ang) * (1.8 + Math.random() * 1.4) - 0.3,
      life: 0.4 + Math.random() * 0.3,
      maxLife: 0.7,
      size: 1.8 + Math.random() * 2.4,
      color: Math.random() > 0.4 ? 0xffcc66 : 0xff6644,
      kind: "ember",
    });
  }
}

/** Soft ground puffs under a walking foot. */
export function spawnFootstepDust(particles: Particle[], wx: number, wy: number) {
  for (let i = 0; i < 4; i++) {
    if (particles.length > 100) break;
    particles.push({
      x: wx + (Math.random() - 0.5) * 0.35,
      y: wy + (Math.random() - 0.5) * 0.25,
      vx: (Math.random() - 0.5) * 0.9,
      vy: -0.15 - Math.random() * 0.35,
      life: 0.28 + Math.random() * 0.22,
      maxLife: 0.5,
      size: 2.2 + Math.random() * 2.5,
      color: Math.random() > 0.5 ? 0x8a7a58 : 0x6a5a40,
      kind: "dust",
    });
  }
}

/** Extra ash flecks when a foe dissolves on death. */
export function spawnDissolveAsh(particles: Particle[], wx: number, wy: number, boss = false) {
  const n = boss ? 48 : 14;
  for (let i = 0; i < n; i++) {
    if (particles.length > 180) break;
    particles.push({
      x: wx + (Math.random() - 0.5) * (boss ? 1.4 : 0.8),
      y: wy + (Math.random() - 0.5) * (boss ? 1.1 : 0.6),
      vx: (Math.random() - 0.5) * (boss ? 2.4 : 1.6),
      vy: -0.8 - Math.random() * (boss ? 2.8 : 1.8),
      life: 0.55 + Math.random() * (boss ? 0.75 : 0.45),
      maxLife: boss ? 1.45 : 1.0,
      size: 1.4 + Math.random() * (boss ? 4.2 : 2.2),
      color: i % 3 === 0 ? 0xff6644 : i % 3 === 1 ? 0xc9a227 : 0xd9cfae,
      kind: i % 3 === 0 ? "ash" : "ember",
    });
  }
}

/** Pulsing gold outline under the nearest interactable (POI / exit / loot). */
export function drawInteractPulse(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  tMs: number,
  compact: boolean,
  kind: "poi" | "exit" | "loot" | string
) {
  const pulse = 0.5 + 0.5 * Math.sin(tMs * 0.008);
  const base = kind === "exit" ? (compact ? 38 : 28) : kind === "loot" ? (compact ? 22 : 16) : compact ? 30 : 22;
  const rw = base + pulse * (compact ? 6 : 4);
  const rh = rw * 0.42;
  const gold = kind === "loot" ? 0xffe08a : 0xc9a227;
  g.lineStyle(compact ? 3.5 : 2.5, gold, 0.35 + pulse * 0.45);
  g.strokeEllipse(sx, sy + 4, rw * 2, rh * 2);
  g.lineStyle(1.25, 0xfff6d0, 0.25 + pulse * 0.35);
  g.strokeEllipse(sx, sy + 4, rw * 1.55, rh * 1.55);
  if (pulse > 0.7) {
    g.fillStyle(gold, 0.08 + (pulse - 0.7) * 0.2);
    g.fillEllipse(sx, sy + 4, rw * 1.2, rh * 1.2);
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

  // Softer plate tint so etching reads without harsh checker seams.
  // Lust: slightly darker / cooler so crimson-gold foe rims pop at a glance.
  // Hub: quieter plate so busy Doré etching doesn't roar over sprites/UI.
  const tint = isHub ? 0x8a9a88 : 0x7a5854;
  const alpha = isHub ? 0.68 : 0.82;
  const root = scene.add.container(0, 0);
  root.setDepth(0);
  root.setMask(mask);
  // Solid iso diamond under the stamp so no seam / transparent texel ever
  // shows the camera background as a black void between tiles.
  const under = scene.make.graphics({ x: 0, y: 0 }, false);
  under.fillStyle(isHub ? 0x12180f : 0x1c0a08, 1);
  under.beginPath();
  under.moveTo(corners[0].sx, corners[0].sy);
  for (let i = 1; i < corners.length; i++) under.lineTo(corners[i].sx, corners[i].sy);
  under.closePath();
  under.fillPath();
  root.add(under);
  const images: Phaser.GameObjects.Image[] = [];
  // Overlap tiles ~2.5% so mirror seams blur instead of flashing a hairline.
  const stepX = tw * 0.975;
  const stepY = th * 0.975;
  const cols = Math.ceil((maxX - minX) / stepX) + 1;
  const rows = Math.ceil((maxY - minY) / stepY) + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = minX + c * stepX;
      const y = minY + r * stepY;
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
  const barW = opts.compact ? w * 1.45 : w * 1.1;
  const barH = opts.boss ? (opts.compact ? 12 : 9) : opts.compact ? 10 : 7;
  const left = x - barW / 2;
  // Shadow + bone frame (thicker so bars read on dark Lust ground)
  g.fillStyle(0x000000, 0.75);
  g.fillRect(left - 3, y - 3, barW + 6, barH + 6);
  g.fillStyle(0x1a1610, 1);
  g.fillRect(left, y, barW, barH);
  // Fill: brighter crimson for foes, bone-green for allies
  const fill = opts.ally
    ? ratio > 0.35
      ? 0xb8d898
      : 0xff5544
    : ratio > 0.3
      ? 0xe83828
      : 0xff6a3a;
  g.fillStyle(fill, 1);
  g.fillRect(left, y, Math.max(0, barW * ratio), barH);
  // Gloss line
  g.fillStyle(0xffffff, 0.22);
  g.fillRect(left, y, Math.max(0, barW * ratio), Math.max(1, barH * 0.4));
  // Gold ticks at quarters
  g.lineStyle(1, 0xe8c86a, 0.7);
  for (let i = 1; i < 4; i++) {
    const tx = Math.round(left + (barW * i) / 4) + 0.5;
    g.lineBetween(tx, y, tx, y + barH);
  }
  // Bone outline + gold finials
  g.lineStyle(1.5, 0xf0e6c8, 0.95);
  g.strokeRect(left, y, barW, barH);
  g.fillStyle(0xe8c86a, 1);
  g.fillRect(left - 3, y - 1, 3, barH + 2);
  g.fillRect(left + barW, y - 1, 3, barH + 2);
}

/* ————————————————————————————————————————————————————————————————————————
 *  Loot glow / pulse
 * ———————————————————————————————————————————————————————————————————————— */

/** Rarity → pulse intensity (common soft → unique stronger). */
export function lootRarityPulse(rarity: string | undefined): number {
  switch (String(rarity || "normal")) {
    case "magic":
      return 0.55;
    case "rare":
      return 0.85;
    case "set":
      return 1.05;
    case "unique":
      return 1.25;
    case "canto_unique":
      return 1.45;
    default:
      return 0.32; // normal / common — soft
  }
}

export function drawLootGlow(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  color: number,
  t: number,
  compact: boolean,
  /** 0..~1.5 pulse intensity; bool still accepted (true≈rare). */
  intensity: number | boolean = 0.5
) {
  const inv =
    typeof intensity === "boolean" ? (intensity ? 1.0 : 0.35) : Math.max(0.15, Number(intensity) || 0.35);
  const pulse = 0.5 + 0.5 * Math.sin(t * (0.004 + inv * 0.004) + sx * 0.02);
  const s = (compact ? 1.5 : 1) * (0.85 + inv * 0.35);
  const aMul = 0.55 + inv * 0.55;
  g.fillStyle(color, (0.06 + pulse * 0.10) * aMul);
  g.fillEllipse(sx, sy + 2, 40 * s * (0.9 + pulse * 0.15 * inv), 18 * s * (0.9 + pulse * 0.15 * inv));
  g.fillStyle(color, (0.10 + pulse * 0.16) * aMul);
  g.fillEllipse(sx, sy + 2, 22 * s, 10 * s);
  g.lineStyle(1 + inv * 0.75, color, (0.22 + pulse * 0.35) * aMul);
  g.strokeEllipse(sx, sy + 2, 30 * s * (0.95 + pulse * 0.1), 13 * s * (0.95 + pulse * 0.1));
  // Vertical light shaft — taller/brighter on higher tiers
  g.fillStyle(color, (0.03 + pulse * 0.06) * aMul);
  const shaftH = 28 + inv * 14;
  g.fillTriangle(sx - 5 * s, sy + 1, sx + 5 * s, sy + 1, sx, sy - shaftH * s);
}

/**
 * Lust foe underfoot + body rim: darken the busy red ground, then paint a
 * gold/crimson halo so whirl / champion / boss read at a glance on mobile.
 */
export function drawFoeGlow(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  t: number,
  opts: { compact: boolean; champion?: boolean; boss?: boolean }
) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.004 + sx * 0.03);
  const s = (opts.compact ? 1.65 : 1.15) * (opts.boss ? 2.2 : opts.champion ? 1.45 : 1);
  const ember = opts.boss ? 0xff4a2a : opts.champion ? 0xff8a40 : 0xe05030;
  const gold = opts.boss ? 0xffd27a : opts.champion ? 0xf0c060 : 0xe8b84a;
  // Desaturated dark well under feet (sprites pop without killing ground read)
  g.fillStyle(0x040102, 0.62);
  g.fillEllipse(sx, sy + 4, 58 * s, 26 * s);
  g.fillStyle(0x120608, 0.35);
  g.fillEllipse(sx, sy + 4, 40 * s, 18 * s);
  // Warm light pool
  g.fillStyle(ember, 0.18 + pulse * 0.16);
  g.fillEllipse(sx, sy + 3, 48 * s, 20 * s);
  g.fillStyle(gold, 0.14 + pulse * 0.12);
  g.fillEllipse(sx, sy + 2, 26 * s, 11 * s);
  // Crimson then gold underfoot rings
  g.lineStyle(opts.compact ? 3 : 2.25, ember, 0.55 + pulse * 0.35);
  g.strokeEllipse(sx, sy + 3, 42 * s, 17 * s);
  g.lineStyle(opts.compact ? 2.25 : 1.75, gold, 0.7 + pulse * 0.25);
  g.strokeEllipse(sx, sy + 3, 34 * s, 13 * s);
  // Body-height gold/crimson rim so the silhouette reads even if the etch is dark
  const bodyY = sy - (opts.boss ? 42 : opts.champion ? 30 : 24) * (opts.compact ? 1.15 : 1);
  const bw = (opts.boss ? 46 : opts.champion ? 34 : 26) * s * 0.55;
  const bh = (opts.boss ? 70 : opts.champion ? 52 : 40) * (opts.compact ? 1.1 : 1) * 0.55;
  g.lineStyle(opts.compact ? 2.5 : 2, gold, 0.55 + pulse * 0.3);
  g.strokeEllipse(sx, bodyY, bw * 2, bh * 2);
  g.lineStyle(opts.compact ? 1.75 : 1.25, ember, 0.4 + pulse * 0.25);
  g.strokeEllipse(sx, bodyY, bw * 1.7, bh * 1.7);
}

export function spawnKillBurst(particles: Particle[], wx: number, wy: number, boss = false) {
  const n = boss ? 56 : 24;
  for (let i = 0; i < n; i++) {
    if (particles.length > 200) break;
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const sp = 2.8 + Math.random() * (boss ? 5.2 : 3.0);
    particles.push({
      x: wx,
      y: wy,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 0.8,
      life: 0.55 + Math.random() * (boss ? 0.7 : 0.45),
      maxLife: boss ? 1.35 : 1.0,
      size: 2.2 + Math.random() * (boss ? 5.0 : 2.8),
      color: i % 3 === 0 ? 0xc9a227 : i % 3 === 1 ? 0xff5533 : 0xd9cfae,
      kind: i % 4 === 0 ? "ash" : "ember",
    });
  }
  spawnDissolveAsh(particles, wx, wy, boss);
}

/* ————————————————————————————————————————————————————————————————————————
 *  Inferno spell VFX helpers (Doré crimson-gold)
 * ———————————————————————————————————————————————————————————————————————— */

/** Crimson-gold trail embers along a gale bolt path (world units). */
export function spawnGaleTrail(
  particles: Particle[],
  x0: number,
  y0: number,
  x1: number,
  y1: number
) {
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    if (particles.length > 140) break;
    const t = i / steps;
    const wx = x0 + (x1 - x0) * t;
    const wy = y0 + (y1 - y0) * t;
    particles.push({
      x: wx + (Math.random() - 0.5) * 0.25,
      y: wy + (Math.random() - 0.5) * 0.25,
      vx: (Math.random() - 0.5) * 0.8,
      vy: -0.4 - Math.random() * 0.8,
      life: 0.35 + Math.random() * 0.35,
      maxLife: 0.7,
      size: 1.4 + Math.random() * 2.2,
      color: i % 2 === 0 ? 0xff6644 : 0xffd078,
      kind: "ember",
    });
  }
  // Impact bloom
  for (let i = 0; i < 12; i++) {
    if (particles.length > 140) break;
    const ang = (Math.PI * 2 * i) / 12;
    particles.push({
      x: x1,
      y: y1,
      vx: Math.cos(ang) * (2 + Math.random()),
      vy: Math.sin(ang) * (2 + Math.random()),
      life: 0.4 + Math.random() * 0.3,
      maxLife: 0.7,
      size: 2 + Math.random() * 2.5,
      color: Math.random() > 0.5 ? 0xc9a227 : 0xff5533,
      kind: "ember",
    });
  }
}

/** Soft luminous ring particles around the caster (whirl ward). */
export function spawnWardRing(particles: Particle[], wx: number, wy: number) {
  for (let i = 0; i < 18; i++) {
    if (particles.length > 140) break;
    const ang = (Math.PI * 2 * i) / 18 + Math.random() * 0.15;
    const r = 1.1 + Math.random() * 0.35;
    particles.push({
      x: wx + Math.cos(ang) * r,
      y: wy + Math.sin(ang) * r * 0.55,
      vx: Math.cos(ang) * 0.35,
      vy: Math.sin(ang) * 0.2 - 0.15,
      life: 0.7 + Math.random() * 0.5,
      maxLife: 1.2,
      size: 1.6 + Math.random() * 2,
      color: i % 3 === 0 ? 0xffe8a0 : i % 3 === 1 ? 0xc9a227 : 0xd9cfae,
      kind: "mist",
    });
  }
}

/** Infernal burst bloom — dense ember/ash ring. */
export function spawnInfernalBloom(
  particles: Particle[],
  wx: number,
  wy: number,
  radius = 4
) {
  const n = 36;
  for (let i = 0; i < n; i++) {
    if (particles.length > 160) break;
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.2;
    const sp = 2.2 + Math.random() * 3.5;
    particles.push({
      x: wx,
      y: wy,
      vx: Math.cos(ang) * sp * (radius / 4),
      vy: Math.sin(ang) * sp * (radius / 4) - 0.5,
      life: 0.55 + Math.random() * 0.45,
      maxLife: 1.0,
      size: 2.2 + Math.random() * 3.2,
      color: i % 4 === 0 ? 0xc9a227 : i % 4 === 1 ? 0xff4422 : i % 4 === 2 ? 0xff8844 : 0xd9cfae,
      kind: i % 5 === 0 ? "ash" : "ember",
    });
  }
  for (let i = 0; i < 10; i++) {
    if (particles.length > 160) break;
    particles.push({
      x: wx + (Math.random() - 0.5) * 0.4,
      y: wy + (Math.random() - 0.5) * 0.4,
      vx: (Math.random() - 0.5) * 1.2,
      vy: -1.5 - Math.random() * 2,
      life: 0.7 + Math.random() * 0.4,
      maxLife: 1.1,
      size: 3 + Math.random() * 3,
      color: 0xffe08a,
      kind: "ember",
    });
  }
}

/** Draw a gale bolt bolt/trail arc in screen space. */
export function drawGaleBoltArc(
  g: Phaser.GameObjects.Graphics,
  sx0: number,
  sy0: number,
  sx1: number,
  sy1: number,
  prog: number
) {
  const mid = Math.min(1, Math.max(0, prog));
  const mx = sx0 + (sx1 - sx0) * mid;
  const my = sy0 + (sy1 - sy0) * mid;
  g.lineStyle(5, 0xff5533, 0.25);
  g.lineBetween(sx0, sy0, mx, my);
  g.lineStyle(2.5, 0xffd078, 0.85);
  g.lineBetween(sx0, sy0, mx, my);
  g.fillStyle(0xffe8a0, 0.95);
  g.fillCircle(mx, my, 4 + Math.sin(mid * Math.PI) * 3);
  g.lineStyle(1.5, 0xc9a227, 0.7);
  g.strokeCircle(mx, my, 7);
}

/** Luminous ward ring under/around the player (screen space). */
export function drawWardRingGfx(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  t: number,
  alpha = 0.85
) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.012);
  const rx = 28 + pulse * 4;
  const ry = 12 + pulse * 2;
  g.lineStyle(3, 0xc9a227, 0.35 * alpha);
  g.strokeEllipse(sx, sy + 6, rx + 6, ry + 3);
  g.lineStyle(2, 0xffe8a0, 0.75 * alpha);
  g.strokeEllipse(sx, sy + 6, rx, ry);
  g.fillStyle(0xc9a227, 0.08 * alpha);
  g.fillEllipse(sx, sy + 6, rx - 4, ry - 2);
  // Orbiting sparks
  for (let i = 0; i < 5; i++) {
    const a = t * 0.006 + (i / 5) * Math.PI * 2;
    const px = sx + Math.cos(a) * rx;
    const py = sy + 6 + Math.sin(a) * ry;
    g.fillStyle(i % 2 ? 0xffe8a0 : 0xff6644, 0.9 * alpha);
    g.fillCircle(px, py, 2.2);
  }
}

/** Expanding infernal burst shockwave (screen space). */
export function drawInfernalShock(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  prog: number,
  radiusWorld: number
) {
  const p = Math.min(1, Math.max(0, prog));
  const scale = 18 * radiusWorld; // rough world→screen
  const r = scale * (0.25 + p * 0.9);
  const a = (1 - p) * 0.9;
  g.lineStyle(4, 0xff4422, 0.35 * a);
  g.strokeEllipse(sx, sy, r * 1.1, r * 0.48);
  g.lineStyle(2.5, 0xc9a227, 0.7 * a);
  g.strokeEllipse(sx, sy, r, r * 0.42);
  g.fillStyle(0xff6644, 0.12 * a);
  g.fillEllipse(sx, sy, r * 0.7, r * 0.3);
  g.fillStyle(0xffe8a0, 0.55 * a);
  g.fillCircle(sx, sy - 4, 6 * (1 - p * 0.5));
}


/* ————————————————————————————————————————————————————————————————————————
 *  Cast telegraphs (aim / charge / ground circle) — drawn before resolve
 * ———————————————————————————————————————————————————————————————————————— */

/** Gale aim line: dashed bone-gold ray in aim direction (screen space). */
export function drawGaleAimTelegraph(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  aimSx: number,
  aimSy: number,
  charge: number
) {
  const c = Math.max(0, Math.min(1, charge));
  const ex = sx + (aimSx - sx);
  const ey = sy + (aimSy - sy);
  const segs = 8;
  for (let i = 0; i < segs; i++) {
    if (i / segs > c * 0.95 + 0.05) break;
    if (i % 2 === 1) continue;
    const t0 = i / segs;
    const t1 = Math.min(1, (i + 1) / segs);
    g.lineStyle(3.5, 0xff6644, 0.22 + c * 0.25);
    g.lineBetween(sx + (ex - sx) * t0, sy + (ey - sy) * t0, sx + (ex - sx) * t1, sy + (ey - sy) * t1);
    g.lineStyle(1.75, 0xffe08a, 0.45 + c * 0.45);
    g.lineBetween(sx + (ex - sx) * t0, sy + (ey - sy) * t0, sx + (ex - sx) * t1, sy + (ey - sy) * t1);
  }
  g.fillStyle(0xffe8a0, 0.55 + c * 0.4);
  g.fillCircle(sx + (ex - sx) * c, sy + (ey - sy) * c, 3.5 + c * 2.5);
  g.lineStyle(1.25, 0xc9a227, 0.7);
  g.strokeCircle(sx, sy - 4, 6 + c * 2);
}

/** Ward charge ring: grows under caster while windup fills. */
export function drawWardChargeTelegraph(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  charge: number,
  tMs: number
) {
  const c = Math.max(0, Math.min(1, charge));
  const pulse = 0.5 + 0.5 * Math.sin(tMs * 0.02);
  const rx = 10 + c * 22 + pulse * 2;
  const ry = 4 + c * 9 + pulse;
  g.lineStyle(2.5, 0xc9a227, 0.25 + c * 0.45);
  g.strokeEllipse(sx, sy + 6, rx + 4, ry + 2);
  g.lineStyle(2, 0xffe8a0, 0.4 + c * 0.5);
  g.strokeEllipse(sx, sy + 6, rx, ry);
  g.fillStyle(0xc9a227, 0.06 + c * 0.1);
  g.fillEllipse(sx, sy + 6, rx * 0.85, ry * 0.85);
  // Sweep arc showing charge
  const sweep = c * Math.PI * 2;
  const steps = Math.max(2, Math.floor(12 * c));
  for (let i = 0; i < steps; i++) {
    const a0 = -Math.PI / 2 + (sweep * i) / steps;
    const a1 = -Math.PI / 2 + (sweep * (i + 1)) / steps;
    g.lineStyle(2.5, 0xffe8a0, 0.85);
    g.lineBetween(
      sx + Math.cos(a0) * rx,
      sy + 6 + Math.sin(a0) * ry,
      sx + Math.cos(a1) * rx,
      sy + 6 + Math.sin(a1) * ry
    );
  }
}

/** Infernal burst ground circle: fills radius while charging. */
export function drawBurstGroundTelegraph(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  charge: number,
  radiusWorld: number
) {
  const c = Math.max(0, Math.min(1, charge));
  const scale = 18 * radiusWorld;
  const r = scale * (0.35 + c * 0.65);
  g.fillStyle(0xff4422, 0.06 + c * 0.1);
  g.fillEllipse(sx, sy, r * 1.05, r * 0.45);
  g.lineStyle(3, 0xff5533, 0.3 + c * 0.4);
  g.strokeEllipse(sx, sy, r, r * 0.42);
  g.lineStyle(2, 0xc9a227, 0.45 + c * 0.4);
  g.strokeEllipse(sx, sy, r * 0.88, r * 0.37);
  g.lineStyle(1.25, 0xffe8a0, 0.55);
  g.strokeEllipse(sx, sy, r * c * 0.7, r * c * 0.3);
}

/** Boss (Judge) attack telegraph — expanding crimson danger ellipse. */
export function drawBossTelegraph(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  charge: number,
  radiusWorld: number,
  tMs: number,
  /** Compact (phone) pip size. */
  compact = false
) {
  const c = Math.max(0, Math.min(1, charge));
  const pulse = 0.5 + 0.5 * Math.sin(tMs * 0.025);
  const scale = 16 * radiusWorld;
  const r = scale * (0.55 + c * 0.55);
  g.fillStyle(0xff2200, 0.08 + c * 0.14 + pulse * 0.04);
  g.fillEllipse(sx, sy + 4, r * 1.1, r * 0.48);
  g.lineStyle(3.5, 0xff4422, 0.45 + c * 0.4);
  g.strokeEllipse(sx, sy + 4, r, r * 0.42);
  g.lineStyle(2, 0xffd078, 0.35 + c * 0.45 + pulse * 0.15);
  g.strokeEllipse(sx, sy + 4, r * 0.82, r * 0.34);
  // Inner countdown ring
  const ir = r * (0.35 + (1 - c) * 0.45);
  g.lineStyle(2.5, 0xffe8a0, 0.55 + c * 0.35);
  g.strokeEllipse(sx, sy + 4, ir, ir * 0.42);

  // Ward-pip style countdown disc + remaining arc (number is Phaser Text)
  const pipR = compact ? 13 : 11;
  const pipY = sy - (compact ? 28 : 24);
  g.fillStyle(0x1a0808, 0.9);
  g.fillCircle(sx, pipY, pipR + 2);
  g.fillStyle(0xc9a227, 0.94);
  g.fillCircle(sx, pipY, pipR);
  g.lineStyle(1.4, 0xffe8a0, 0.95);
  g.strokeCircle(sx, pipY, pipR);
  const remain = 1 - c;
  const segs = 20;
  const ringR = pipR + 4;
  const drawn = Math.max(1, Math.ceil(segs * remain));
  for (let i = 0; i < drawn; i++) {
    const a0 = -Math.PI / 2 + (i / segs) * Math.PI * 2;
    const a1 = -Math.PI / 2 + ((i + 1) / segs) * Math.PI * 2;
    g.lineStyle(2.4, i === 0 ? 0xfff6d0 : 0xffe08a, 0.95);
    g.lineBetween(
      sx + Math.cos(a0) * ringR,
      pipY + Math.sin(a0) * ringR,
      sx + Math.cos(a1) * ringR,
      pipY + Math.sin(a1) * ringR
    );
  }
}

/** Screen Y offset of the Judge countdown pip so the number sits in the disc. */
export function bossTelegraphPipY(sy: number, compact: boolean): number {
  return sy - (compact ? 28 : 24);
}


/** Gale max-range iso ellipse + soft aim cone (screen space). */
export function drawGaleRangePreview(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  aimSx: number,
  aimSy: number,
  rangeWorld: number,
  charge: number,
  opts?: { outsideHint?: boolean }
) {
  const c = Math.max(0, Math.min(1, charge));
  const scale = 18 * rangeWorld;
  const rx = scale;
  const ry = scale * 0.42;
  // Soft filled range disc
  g.fillStyle(0xff8844, 0.03 + c * 0.05);
  g.fillEllipse(sx, sy + 4, rx, ry);
  // Dashed outer ring
  const segs = 28;
  for (let i = 0; i < segs; i++) {
    if (i % 2 === 1) continue;
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 0.85) / segs) * Math.PI * 2;
    g.lineStyle(1.75, 0xffe08a, 0.22 + c * 0.35);
    g.lineBetween(
      sx + Math.cos(a0) * rx * 0.5,
      sy + 4 + Math.sin(a0) * ry * 0.5,
      sx + Math.cos(a1) * rx * 0.5,
      sy + 4 + Math.sin(a1) * ry * 0.5
    );
  }
  // Aim cone wedge toward tip
  const dx = aimSx - sx;
  const dy = aimSy - sy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const tipX = sx + ux * (rx * 0.48);
  const tipY = sy + 4 + uy * (ry * 0.48);
  const half = 14 + c * 10;
  g.fillStyle(0xff6644, 0.06 + c * 0.1);
  g.fillTriangle(sx, sy + 2, tipX + px * half, tipY + py * half * 0.45, tipX - px * half, tipY - py * half * 0.45);
  g.lineStyle(1.5, 0xffe08a, 0.35 + c * 0.35);
  g.lineBetween(sx, sy + 2, tipX, tipY);
  if (opts?.outsideHint) {
    // Slightly larger dashed ring for "just outside" band
    const ox = rx * 1.18;
    const oy = ry * 1.18;
    g.lineStyle(1.25, 0xff5533, 0.18 + c * 0.2);
    g.strokeEllipse(sx, sy + 4, ox, oy);
  }
}

/** Dim mark on a foe just outside Gale range. */
export function drawOutOfRangeFoeMark(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  tMs: number
) {
  const pulse = 0.5 + 0.5 * Math.sin(tMs * 0.012);
  g.lineStyle(2, 0xff6644, 0.35 + pulse * 0.35);
  g.strokeCircle(sx, sy - 28, 10 + pulse * 2);
  g.lineStyle(1.25, 0xffe08a, 0.4);
  // Small "X" ticks
  g.lineBetween(sx - 5, sy - 33, sx + 5, sy - 23);
  g.lineBetween(sx + 5, sy - 33, sx - 5, sy - 23);
}

/** Portal / travel hold charge ring under Interact target. */
export function drawPortalChargeRing(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  charge: number,
  tMs: number
) {
  const c = Math.max(0, Math.min(1, charge));
  const pulse = 0.5 + 0.5 * Math.sin(tMs * 0.018);
  const rx = 18 + c * 16;
  const ry = 8 + c * 7;
  g.fillStyle(0xc9a227, 0.05 + c * 0.12);
  g.fillEllipse(sx, sy + 8, rx, ry);
  g.lineStyle(2.5, 0x6a8cff, 0.3 + c * 0.45);
  g.strokeEllipse(sx, sy + 8, rx + 2, ry + 1);
  g.lineStyle(2, 0xffe8a0, 0.45 + c * 0.5);
  g.strokeEllipse(sx, sy + 8, rx, ry);
  // Sweep
  const sweep = c * Math.PI * 2;
  const steps = Math.max(2, Math.floor(16 * c));
  for (let i = 0; i < steps; i++) {
    const a0 = -Math.PI / 2 + (sweep * i) / steps;
    const a1 = -Math.PI / 2 + (sweep * (i + 1)) / steps;
    g.lineStyle(3, 0xa8c0ff, 0.9);
    g.lineBetween(
      sx + Math.cos(a0) * rx,
      sy + 8 + Math.sin(a0) * ry,
      sx + Math.cos(a1) * rx,
      sy + 8 + Math.sin(a1) * ry
    );
  }
  g.fillStyle(0xffe8a0, 0.5 + pulse * 0.3);
  g.fillCircle(sx, sy - 4 - c * 8, 3 + c * 2);
}

/** Compact "hold to enter" tip above a near portal pulse (screen space). */
export function drawPortalEnterTip(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  tMs: number,
  compact: boolean,
  /** Wider tip when naming a destination (e.g. Lust). */
  wide = false
) {
  const pulse = 0.5 + 0.5 * Math.sin(tMs * 0.01);
  const y = sy - (compact ? 52 : 40) - pulse * 2;
  const w = wide ? (compact ? 64 : 72) : compact ? 52 : 58;
  const h = compact ? 14 : 13;
  g.fillStyle(0x0a0c0a, 0.72);
  g.fillRect(sx - w / 2, y - h / 2, w, h);
  g.lineStyle(1, 0xc9a227, 0.55 + pulse * 0.35);
  g.strokeRect(sx - w / 2, y - h / 2, w, h);
  // Tiny chevron / hold bars (reads without bitmap text)
  const barY = y;
  const ox = wide ? -4 : 0;
  g.fillStyle(0xffe8a0, 0.85 + pulse * 0.15);
  g.fillRect(sx - 14 + ox, barY - 2, 3, 4);
  g.fillRect(sx - 9 + ox, barY - 2, 3, 4);
  g.fillRect(sx - 4 + ox, barY - 2, 3, 4);
  g.fillStyle(0xc9a227, 0.9);
  g.fillTriangle(sx + 6 + ox, barY - 4, sx + 14 + ox, barY, sx + 6 + ox, barY + 4);
}

/**
 * Soft gold reticle under the last-hit / sticky Gale target (ground ellipse + ticks).
 */
export function drawStickyTargetReticle(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  tMs: number,
  compact: boolean
) {
  const pulse = 0.5 + 0.5 * Math.sin(tMs * 0.014);
  const rw = (compact ? 28 : 20) + pulse * 3;
  const rh = (compact ? 12 : 9) + pulse * 1.5;
  const cy = sy + (compact ? 6 : 4);
  g.lineStyle(2, 0xe8c86a, 0.35 + pulse * 0.4);
  g.strokeEllipse(sx, cy, rw * 2, rh * 2);
  g.lineStyle(1.5, 0xffe8a0, 0.55 + pulse * 0.35);
  g.strokeEllipse(sx, cy, rw * 1.35, rh * 1.35);
  // Cardinal ticks
  const tick = compact ? 6 : 4;
  g.lineStyle(2, 0xffe8a0, 0.75 + pulse * 0.2);
  g.lineBetween(sx, cy - rh - 2, sx, cy - rh - 2 - tick);
  g.lineBetween(sx, cy + rh + 2, sx, cy + rh + 2 + tick);
  g.lineBetween(sx - rw - 2, cy, sx - rw - 2 - tick, cy);
  g.lineBetween(sx + rw + 2, cy, sx + rw + 2 + tick, cy);
  g.fillStyle(0xc9a227, 0.35 + pulse * 0.25);
  g.fillCircle(sx, cy, compact ? 2.5 : 2);
}

