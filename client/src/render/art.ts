import Phaser from "phaser";
import { worldToScreen, TILE_W, TILE_H } from "../util/iso";


/** Doré Slice-1 kit under public/assets/dore/ */
export const DORE_PATH = "assets/dore";

export const DORE_KEYS = {
  hub_ground: "dore_hub_ground",
  lust_ground: "dore_lust_ground",
  player: "dore_player",
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

/** On-screen display sizes (contain) — gens are detailed full-frame. */
export const DORE_DISPLAY: Record<string, { w: number; h: number }> = {
  [DORE_KEYS.player]: { w: 40, h: 44 },
  [DORE_KEYS.poi_guide]: { w: 42, h: 48 },
  [DORE_KEYS.poi_stash]: { w: 40, h: 36 },
  [DORE_KEYS.poi_ah]: { w: 40, h: 40 },
  [DORE_KEYS.poi_quest]: { w: 38, h: 42 },
  [DORE_KEYS.exit_portal]: { w: 52, h: 56 },
  [DORE_KEYS.mob_whirl]: { w: 34, h: 34 },
  [DORE_KEYS.mob_champion]: { w: 42, h: 42 },
  [DORE_KEYS.boss_judge]: { w: 78, h: 72 },
  [DORE_KEYS.loot_gem]: { w: 22, h: 24 },
};

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
    scene.load.image(key, `${DORE_PATH}/${file}`);
    keys.push(key);
  }
  return keys;
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
        g.lineStyle(1, hatch, 0.22);
        g.lineBetween(p.sx - 6, p.sy, p.sx + 6, p.sy);
        g.lineBetween(p.sx, p.sy - 3, p.sx, p.sy + 3);
      }
      if (((x * 3 + y) / step) % 5 === 0) {
        g.lineStyle(1, fog, 0.12);
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
        g.lineStyle(1, hatch, 0.14);
        g.lineBetween(p.sx - 5, p.sy, p.sx + 5, p.sy);
      }
      if (((x * 3 + y) / step) % 4 === 0) {
        g.lineStyle(1, fog, 0.08);
        g.lineBetween(p.sx - 3, p.sy - 2, p.sx + 3, p.sy + 2);
      }
      if (((x + y * 2) / step) % 5 === 0) {
        g.fillStyle(hatch, 0.06);
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
