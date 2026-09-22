/** Doré-style item icons + equip slot mapping for Slice 1 drops. */

export const EQUIP_SLOTS = [
  "Head",
  "Chest",
  "Hands",
  "Feet",
  "MainHand",
  "OffHand",
] as const;

export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const ITEM_ICON_FILES: Record<string, string> = {
  ashen_club: "item_sword.png",
  torn_cape: "item_chest.png",
  ash_helm: "item_helm.png",
  pilgrim_boots: "item_boots.png",
  grave_gloves: "item_gloves.png",
  rusty_buckler: "item_gem.png",
  bone_shard: "item_gem.png",
  cinder_veil: "item_chest.png",
  road_pike: "item_sword.png",
  minos_band: "item_gem.png",
  storm_cowl: "item_helm.png",
  ashen_signet: "item_gem.png",
  wisp_filament: "item_gem.png",
  heart_shard: "item_gem.png",
  pyre_coal: "item_gem.png",
  writ_quill: "item_gem.png",
  // generic by equip slot
  MainHand: "item_sword.png",
  OffHand: "item_gem.png",
  Chest: "item_chest.png",
  Head: "item_helm.png",
  Feet: "item_boots.png",
  Hands: "item_gloves.png",
  misc: "item_gem.png",
};

/** Content drop slot → paper-doll equip slot (null = not wearable). */
export function contentSlotToEquip(slot: string | undefined | null): EquipSlot | null {
  switch (String(slot || "").toLowerCase()) {
    case "weapon":
      return "MainHand";
    case "armor":
    case "chest":
      return "Chest";
    case "helm":
    case "head":
      return "Head";
    case "boots":
    case "feet":
      return "Feet";
    case "gloves":
    case "hands":
      return "Hands";
    case "offhand":
    case "shield":
      return "OffHand";
    default:
      return null;
  }
}

export function resolveBaseId(it: {
  baseId?: string | null;
  name?: string;
  slot?: string | null;
}): string {
  if (it.baseId) return it.baseId;
  const n = String(it.name || "").toLowerCase();
  if (n.includes("pike") || n.includes("club") || n.includes("sword") || n.includes("blade")) return n.includes("pike") ? "road_pike" : "ashen_club";
  if (n.includes("veil") || n.includes("cinder")) return "cinder_veil";
  if (n.includes("cape") || n.includes("mail") || n.includes("armor")) return "torn_cape";
  if (n.includes("cowl")) return "storm_cowl";
  if (n.includes("helm") || n.includes("hood") || n.includes("crown")) return "ash_helm";
  if (n.includes("boot") || n.includes("greave")) return "pilgrim_boots";
  if (n.includes("glove") || n.includes("gauntlet")) return "grave_gloves";
  if (n.includes("buckler") || n.includes("shield")) return "rusty_buckler";
  if (n.includes("shard") || n.includes("gem") || n.includes("bone")) return "bone_shard";
  return "bone_shard";
}

export function resolveEquipSlot(it: {
  equipSlot?: string | null;
  slot?: string | null;
  name?: string;
  baseId?: string | null;
}): EquipSlot | null {
  if (it.equipSlot && (EQUIP_SLOTS as readonly string[]).includes(it.equipSlot)) {
    return it.equipSlot as EquipSlot;
  }
  const fromContent = contentSlotToEquip(it.slot);
  if (fromContent) return fromContent;
  const base = resolveBaseId(it);
  return contentSlotToEquip(
    base === "ashen_club"
      ? "weapon"
      : base === "torn_cape"
        ? "armor"
        : base === "ash_helm"
          ? "helm"
          : base === "pilgrim_boots"
            ? "boots"
            : base === "grave_gloves"
              ? "gloves"
              : base === "rusty_buckler"
                ? "offhand"
                : "misc"
  );
}

/** Append the build version so the immutable CDN cache never serves an old plate. */
export function assetUrl(path: string): string {
  const v = typeof __ASSET_VER__ !== "undefined" ? __ASSET_VER__ : "dev";
  return `${path}?v=${v}`;
}

/* ── Procedural bone-gold silhouettes (Doré etching vibe) ─────────────── */

type IconKind = "hood" | "chest" | "gloves" | "boots" | "sword" | "buckler" | "gem";

const ICON_KIND_BY_BASE: Record<string, IconKind> = {
  ashen_club: "sword",
  road_pike: "sword",
  torn_cape: "chest",
  cinder_veil: "chest",
  ash_helm: "hood",
  storm_cowl: "hood",
  pilgrim_boots: "boots",
  grave_gloves: "gloves",
  rusty_buckler: "buckler",
  bone_shard: "gem",
  minos_band: "gem",
  ashen_signet: "gem",
  wisp_filament: "gem",
  heart_shard: "gem",
  pyre_coal: "gem",
  writ_quill: "gem",
  MainHand: "sword",
  OffHand: "buckler",
  Chest: "chest",
  Head: "hood",
  Feet: "boots",
  Hands: "gloves",
  misc: "gem",
};

const canvasIconCache = new Map<string, string>();

function hatch(ctx: CanvasRenderingContext2D, w: number, h: number, step = 5) {
  ctx.save();
  ctx.strokeStyle = "rgba(40,28,14,0.22)";
  ctx.lineWidth = 1;
  for (let x = -h; x < w + h; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + h, h);
    ctx.stroke();
  }
  ctx.restore();
}

function paintIcon(kind: IconKind): string {
  const hit = canvasIconCache.get(kind);
  if (hit) return hit;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  // parchment plate
  const bg = ctx.createRadialGradient(32, 28, 4, 32, 32, 34);
  bg.addColorStop(0, "#f0e2c4");
  bg.addColorStop(0.55, "#c9a86a");
  bg.addColorStop(1, "#6a4a28");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(2, 2, 60, 60, 8);
  ctx.fill();
  hatch(ctx, 64, 64, 6);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#2a1c10";
  ctx.fillStyle = "#e8c86a";
  ctx.lineWidth = 2.2;

  if (kind === "hood") {
    ctx.beginPath();
    ctx.moveTo(18, 42);
    ctx.quadraticCurveTo(14, 22, 32, 14);
    ctx.quadraticCurveTo(50, 22, 46, 42);
    ctx.quadraticCurveTo(32, 48, 18, 42);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#3a2a1c";
    ctx.beginPath();
    ctx.ellipse(32, 38, 10, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "chest") {
    // cape + plate
    ctx.fillStyle = "#5a4434";
    ctx.beginPath();
    ctx.moveTo(20, 16);
    ctx.lineTo(44, 16);
    ctx.lineTo(50, 52);
    ctx.lineTo(14, 52);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e8c86a";
    ctx.beginPath();
    ctx.moveTo(24, 20);
    ctx.lineTo(40, 20);
    ctx.lineTo(42, 40);
    ctx.lineTo(22, 40);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === "gloves") {
    ctx.fillStyle = "#5a4030";
    ctx.beginPath();
    ctx.roundRect(20, 18, 24, 30, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#c49a52";
    ctx.fillRect(22, 28, 20, 8);
    ctx.beginPath();
    ctx.ellipse(44, 36, 6, 10, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (kind === "boots") {
    ctx.fillStyle = "#2a2018";
    ctx.beginPath();
    ctx.moveTo(22, 18);
    ctx.lineTo(38, 18);
    ctx.lineTo(40, 40);
    ctx.lineTo(50, 46);
    ctx.lineTo(50, 52);
    ctx.lineTo(18, 52);
    ctx.lineTo(18, 40);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#e8c86a";
    ctx.beginPath();
    ctx.moveTo(20, 36);
    ctx.lineTo(42, 36);
    ctx.stroke();
  } else if (kind === "sword") {
    ctx.fillStyle = "#d8d0b8";
    ctx.fillRect(29, 10, 6, 34);
    ctx.strokeRect(29, 10, 6, 34);
    ctx.fillStyle = "#e8c86a";
    ctx.fillRect(18, 42, 28, 5);
    ctx.strokeRect(18, 42, 28, 5);
    ctx.fillRect(30, 46, 4, 10);
    ctx.beginPath();
    ctx.arc(32, 56, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (kind === "buckler") {
    ctx.fillStyle = "#a89878";
    ctx.beginPath();
    ctx.arc(32, 32, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e8c86a";
    ctx.beginPath();
    ctx.arc(32, 32, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(32, 32, 14, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // gem / shard
    ctx.fillStyle = "#e8c86a";
    ctx.beginPath();
    ctx.moveTo(32, 12);
    ctx.lineTo(48, 32);
    ctx.lineTo(32, 52);
    ctx.lineTo(16, 32);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff3c0";
    ctx.beginPath();
    ctx.moveTo(32, 18);
    ctx.lineTo(40, 32);
    ctx.lineTo(32, 34);
    ctx.closePath();
    ctx.fill();
  }

  // etched rim
  ctx.strokeStyle = "rgba(42,28,16,0.65)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(4, 4, 56, 56, 6);
  ctx.stroke();

  const url = c.toDataURL("image/png");
  canvasIconCache.set(kind, url);
  return url;
}

function iconKindFor(it: {
  baseId?: string | null;
  name?: string;
  slot?: string | null;
  equipSlot?: string | null;
}): IconKind {
  const base = resolveBaseId(it);
  if (ICON_KIND_BY_BASE[base]) return ICON_KIND_BY_BASE[base];
  const slot = resolveEquipSlot(it);
  if (slot && ICON_KIND_BY_BASE[slot]) return ICON_KIND_BY_BASE[slot];
  return "gem";
}

export function itemIconUrl(it: {
  baseId?: string | null;
  name?: string;
  slot?: string | null;
  equipSlot?: string | null;
}): string {
  // Prefer procedural bone-gold silhouettes when canvas is available.
  if (typeof document !== "undefined") {
    try {
      return paintIcon(iconKindFor(it));
    } catch {
      /* fall through to PNG assets */
    }
  }
  const base = resolveBaseId(it);
  const file =
    ITEM_ICON_FILES[base] ||
    ITEM_ICON_FILES[resolveEquipSlot(it) || ""] ||
    ITEM_ICON_FILES.misc;
  return assetUrl(`assets/items/${file}`);
}

export function itemIconKey(it: {
  baseId?: string | null;
  name?: string;
  slot?: string | null;
}): string {
  return `item_${resolveBaseId(it)}`;
}

export const SLOT_LABELS: Record<EquipSlot, string> = {
  Head: "Head",
  Chest: "Chest",
  Hands: "Hands",
  Feet: "Feet",
  MainHand: "Main",
  OffHand: "Off",
};
