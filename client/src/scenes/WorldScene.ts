import Phaser from "phaser";
import { GameSocket } from "../net/GameSocket";
import { worldToScreen, screenToWorld } from "../util/iso";
import {
  showToast,
  updateStats,
  renderInventory,
  renderAh,
  getSelectedItemId,
  togglePanel,
  setPanelOpen,
  wireHud,
  isCompactUi,
  noteSpellCast,
  flashManaDeny,
} from "../ui/hud";
import { SPELLS, type SpellId } from "../spells";
import { VirtualJoystick } from "../ui/virtualJoystick";
import {
  SmoothStore,
  MOVE_SEND_MS,
  CAM_LERP_MOBILE,
  CAM_LERP_DESKTOP,
  reconcileLocal,
  expAlpha,
  type Vec2,
} from "../render/smoothing";
import {
  ensureArtTextures,
  drawGround,
  drawHatchOverlay,
  drawPoi,
  drawExit,
  drawMob,
  drawBoss,
  drawLoot,
  drawPlayer,
  spawnParticles,
  tickParticles,
  drawParticles,
  preloadDoreKit,
  preloadItemIcons,
  enhanceLustFoeTextures,
  hasTexture,
  entityDoreKey,
  lootTextureKey,
  DORE_KEYS,
  DORE_CROP,
  DORE_BLEND,
  RARITY_COLOR,
  doreDisplaySize,
  drawEntityPad,
  drawHubDecor,
  drawExitSpotlight,
  drawFoeHpBar,
  drawFoeGlow,
  drawLootGlow,
  spawnHitBurst,
  spawnKillBurst,
  ensureVignetteTexture,
  drawKillRing,
  spawnLootSparkle,
  spawnGaleTrail,
  spawnWardRing,
  spawnInfernalBloom,
  drawGaleBoltArc,
  drawWardRingGfx,
  drawInfernalShock,
  buildGroundTiles,
  destroyGroundTiles,
  facing8FromWorldVel,
  facing8IsLeft,
  playerFacingVisual,
  type Facing8,
  type GroundTiles,
  type Particle,
} from "../render/art";

type RoomSnap = any;

const DESKTOP_HIT_RADIUS = 28;
const MOBILE_HIT_RADIUS = 48;
/** Loot gets a fatter tap target — it is small and the thing players want most. */
const LOOT_HIT_BONUS = 1.6;
const INTERACT_RANGE = 5.0;
const EXIT_HINT_RANGE = 7;
const EXIT_TRAVEL_RANGE = 6.0;
const ATTACK_RANGE = 5.5;
/** Client auto-loot: send pickup once loot is within this many world units. */
const AUTO_PICKUP_RANGE = 4.0;
/** Loot visually drifts toward the player inside this radius (render only). */
const MAGNET_RANGE = 5.5;
const AUTO_PICKUP_RETRY_MS = 900;
const MOBILE_ZOOM = 0.65;
const MOBILE_ZOOM_TABLET = 0.72;
const DESKTOP_ZOOM = 1;
const ATTACK_HOLD_MS = 720;
/**
 * Walk cycle: contact → passing frames at ~8 Hz (one step = 2 frames). Bob,
 * bounce and lean are deliberately big so the stride reads at 74 px on a phone.
 */
const WALK_FRAME_MS = 120;
const WALK_BOB_PX = 7;
const WALK_BOUNCE = 0.07;
/** Forward lean (deg) while striding, plus a per-step sway of the same size. */
const WALK_LEAN_DEG = 3;
/** Idle breathe: vertical drift (px) + a tiny scaleY swell so standing isn't frozen. */
const IDLE_BOB_PX = 1.6;
const IDLE_SWELL = 0.018;
/** Local predicted move speed (world units / sec) — matches server feel. */
const PREDICT_SPEED = 8.0;
const MOVE_ACCEL = 28;
const MOVE_FRICTION = 18;
const TAP_ARRIVE = 0.35;
const ATTACK_WINDUP_MS = 140;
const ATTACK_RECOVERY_MS = 380;
const ATTACK_SWIPE_MS = 340;
/** Kill ring / ghost-fade duration (ms). */
const KILL_FX_MS = 420;

type HitFx = {
  start: number;
  until: number;
  ox: number;
  oy: number;
  tint: number | null;
  punch: number;
};

export class WorldScene extends Phaser.Scene {
  socket!: GameSocket;
  room: RoomSnap | null = null;
  graphics!: Phaser.GameObjects.Graphics;
  groundGraphics!: Phaser.GameObjects.Graphics;
  labelGroup!: Phaser.GameObjects.Group;
  labels = new Map<string, Phaser.GameObjects.Text>();
  groundCantoId: string | null = null;
  keys: Record<string, Phaser.Input.Keyboard.Key> | null = null;
  moveTarget: { x: number; y: number } | null = null;
  lastMoveSend = 0;
  lastSnapAt = 0;
  joystick: VirtualJoystick | null = null;
  attackHoldTimer: number | null = null;
  /** Camera follow rate (per second); applied as a dt-based exponential approach. */
  camFollowRate = CAM_LERP_DESKTOP;
  /** Last frame dt (sec) so camera follow is frame-rate independent. */
  lastDtSec = 1 / 60;

  /** Authoritative last-known local position from server. */
  serverYou: Vec2 = { x: 0, y: 0 };
  /** Render / predicted local position. */
  renderYou: Vec2 = { x: 0, y: 0 };
  /** True while joystick/WASD/tap is driving prediction. */
  predicting = false;
  remoteSmooth = new SmoothStore();
  particles: Particle[] = [];
  particleAcc = 0;
  lastCantoId: string | null = null;
  needsFullRedraw = true;
  animT = 0;
  /** Doré texture keys that failed to load — procedural fallback. */
  doreFailed = new Set<string>();
  doreLoadAttempted = false;
  groundTiles: GroundTiles | null = null;
  entitySprites = new Map<string, Phaser.GameObjects.Image>();
  shadowSprites = new Map<string, Phaser.GameObjects.Image>();
  /** Base (un-punched) scale per sprite so combat punch never accumulates. */
  spriteBase = new Map<string, { sx: number; sy: number; w: number; h: number }>();
  /** Brief combat punch / flash keyed by entity sprite id. */
  hitFx = new Map<string, HitFx>();
  hubTipShown = false;
  nearExitToastAt = 0;
  seenLootIds = new Set<string>();
  /** lootId -> last auto-pickup send time (ms) so we don't spam the server. */
  autoPickupSent = new Map<string, number>();
  lastAutoPickupScan = 0;
  lastCompact: boolean | null = null;
  /** Damped local velocity (world units / sec). */
  velX = 0;
  velY = 0;
  /** 8-way facing from velocity / aim (west dirs use flipX of E/NE/SE). */
  facing8: Facing8 = "s";
  /** 0 = idle texture; 1/2 = walk A/B. */
  walkFrame = 0;
  walkAnimAcc = 0;
  movingVisual = false;
  attackBusyUntil = 0;
  swipeFx: { until: number; dir: number; start: number } | null = null;
  lastYouSnapshot: any = null;
  /** Expanding kill rings (screen px) drawn in redraw(). */
  killFx: { sx: number; sy: number; start: number; boss: boolean }[] = [];
  /** In-flight gale bolt arcs (world → screen in redraw). */
  galeBolts: { x0: number; y0: number; x1: number; y1: number; start: number; dur: number }[] = [];
  /** Active whirl ward rings keyed by caster id. */
  wardRings = new Map<string, { until: number; x: number; y: number }>();
  /** Infernal burst shockwaves. */
  infernalShocks: { x: number; y: number; start: number; dur: number; radius: number }[] = [];
  /** Aim vector from last move / facing for spells. */
  aimX = 1;
  aimY = 0;
  /** Camera-following soft vignette so the arena edges fall into dark. */
  vignette: Phaser.GameObjects.Image | null = null;
  /** Remote player last render pos + moving timestamp so they stride too. */
  remotePrev = new Map<string, { x: number; y: number; movedAt: number; facing: Facing8 }>();

  constructor() {
    super("world");
  }

  init(data: { socket: GameSocket }) {
    this.socket = data.socket;
  }

  preload() {
    this.doreLoadAttempted = true;
    preloadDoreKit(this);
    preloadItemIcons(this);
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      if (file?.key && String(file.key).startsWith("dore_")) {
        this.doreFailed.add(file.key);
        console.warn("[Doré] failed to load", file.key, file.url);
      }
    });
  }

  create() {
    this.cameras.main.setBackgroundColor("#0b0f0c");
    ensureArtTextures(this);
    // Mark any missing Doré textures as failed (e.g. 404 still registered oddly)
    for (const key of Object.values(DORE_KEYS)) {
      if (!hasTexture(this, key)) this.doreFailed.add(key);
    }
    // Brighten + rim Lust foe plates so dark etchings read on red ground
    enhanceLustFoeTextures(this);
    this.groundGraphics = this.add.graphics();
    this.graphics = this.add.graphics();
    this.labelGroup = this.add.group();
    this.joystick = new VirtualJoystick();
    // ?debug exposes the scene for console poking / headless smoke tests
    if (new URLSearchParams(location.search).has("debug")) (window as any).__scene = this;
    this.applyViewportZoom();
    {
      const vk = ensureVignetteTexture(this);
      if (hasTexture(this, vk)) {
        this.vignette = this.add.image(0, 0, vk).setDepth(8900).setAlpha(0.84);
        this.layoutVignette();
      }
    }

    const kb = this.input.keyboard;
    if (kb) {
      this.keys = {
        W: kb.addKey("W"),
        A: kb.addKey("A"),
        S: kb.addKey("S"),
        D: kb.addKey("D"),
        E: kb.addKey("E"),
        I: kb.addKey("I"),
        H: kb.addKey("H"),
        ONE: kb.addKey("ONE"),
        TWO: kb.addKey("TWO"),
        THREE: kb.addKey("THREE"),
      };
      this.keys.I.on("down", () => togglePanel("inventory"));
      this.keys.H.on("down", () => {
        togglePanel("ah");
        this.socket.ahBrowse();
      });
      this.keys.ONE.on("down", () => this.castSpell("gale_bolt"));
      this.keys.TWO.on("down", () => this.castSpell("whirl_ward"));
      this.keys.THREE.on("down", () => this.castSpell("infernal_burst"));
    }

    this.input.addPointer(2);
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.room) return;
      const target = pointer.event?.target as HTMLElement | null;
      if (
        target?.closest?.(
          "#action-bar, #panels, #hud button, #virtual-joystick, .vj-base, .vj-knob, #modal-backdrop"
        )
      ) {
        return;
      }
      if (this.joystick?.isVisible()) {
        const ev = pointer.event as MouseEvent | TouchEvent | PointerEvent | undefined;
        let cx = pointer.x;
        let cy = pointer.y;
        if (ev && "clientX" in ev && typeof (ev as MouseEvent).clientX === "number") {
          cx = (ev as MouseEvent).clientX;
          cy = (ev as MouseEvent).clientY;
        } else if (ev && "changedTouches" in ev && ev.changedTouches[0]) {
          cx = ev.changedTouches[0].clientX;
          cy = ev.changedTouches[0].clientY;
        }
        if (this.joystick.containsClientPoint(cx, cy)) return;
      }
      const sx = pointer.worldX;
      const sy = pointer.worldY;
      const hit = this.pickEntity(sx, sy);
      if (hit) {
        if (hit.kind === "mob" || hit.kind === "boss") {
          this.sendAttack(hit.id);
          return;
        }
        if (hit.kind === "loot") {
          this.socket.pickup(hit.id);
          return;
        }
        if (hit.kind === "poi" || hit.kind === "exit") {
          this.doInteract(hit);
          return;
        }
      }
      if (this.joystick?.isActive()) {
        return;
      }
      const w = screenToWorld(sx, sy);
      this.moveTarget = { x: w.x, y: w.y };
      this.socket.move(w.x, w.y);
      this.lastMoveSend = Date.now();
    });

    this.scale.on("resize", () => {
      this.joystick?.syncVisibility();
      this.applyViewportZoom();
      this.centerOnYou(true);
      this.layoutVignette();
    });

    this.socket.on((msg) => this.onNet(msg));
    // The first snapshot often lands while textures are still loading — replay it.
    if (this.socket.lastSnapshot) this.onNet(this.socket.lastSnapshot);

    wireHud({
      listSelected: (price) => {
        const id = getSelectedItemId();
        if (!id || !Number.isInteger(price) || price <= 0) {
          showToast("Select an item and enter integer Ash price", "warn");
          return;
        }
        this.socket.ahList(id, price);
      },
      refreshAh: () => this.socket.ahBrowse(),
      toggleInventory: () => togglePanel("inventory"),
      toggleAh: () => {
        togglePanel("ah");
        this.socket.ahBrowse();
      },
      interactNearest: () => this.interactNearest(),
      attackNearest: () => this.attackNearest(),
      onAttackHoldStart: () => this.startAttackHold(),
      onAttackHoldEnd: () => this.stopAttackHold(),
      equipSelected: () => {
        const id = getSelectedItemId();
        if (!id) {
          showToast("Select an item to equip", "warn");
          return;
        }
        this.socket.equip(String(id));
      },
      unequipSelected: () => {
        const id = getSelectedItemId();
        if (!id) {
          showToast("Select equipped gear to unequip", "warn");
          return;
        }
        this.socket.unequip({ itemId: String(id) });
      },
      castSpell: (spellId) => this.castSpell(spellId),
    });
  }

  castSpell(spellId: SpellId) {
    if (!this.room) return;
    const def = SPELLS[spellId];
    if (!def) return;
    const mana = Number(this.room.you?.mana) || 0;
    if (mana < def.manaCost) {
      flashManaDeny(spellId);
      showToast(`Not enough mana for ${def.name} (${def.manaCost})`, "warn");
      return;
    }
    // Prefer aim toward nearest foe when casting gale
    let ax = this.aimX;
    let ay = this.aimY;
    if (spellId === "gale_bolt") {
      const you = this.youPos();
      let best: any = null;
      let bestD = 9.5;
      for (const e of this.room.entities) {
        if (e.kind !== "mob" && e.kind !== "boss") continue;
        const pos = this.entityRenderPos(e);
        const d = Math.hypot(pos.x - you.x, pos.y - you.y);
        if (d < bestD) {
          bestD = d;
          best = { pos };
        }
      }
      if (best) {
        ax = best.pos.x - you.x;
        ay = best.pos.y - you.y;
        const f = facing8FromWorldVel(ax, ay, 0.01);
        if (f) this.facing8 = f;
      }
    }
    const len = Math.hypot(ax, ay) || 1;
    this.aimX = ax / len;
    this.aimY = ay / len;
    this.socket.cast(spellId, { x: this.aimX, y: this.aimY });
    noteSpellCast(spellId, def.cooldown);
    // Optimistic cast flourish on self
    if (spellId === "whirl_ward") {
      this.punch("you", { dur: 280, punch: 0.1, tint: 0xffe8a0, ox: 0, oy: -4 });
    } else if (spellId === "infernal_burst") {
      this.punch("you", { dur: 320, punch: 0.18, tint: 0xff6644, ox: 0, oy: -6 });
    } else {
      this.punch("you", { dur: 180, punch: 0.12, tint: 0xffd078, ox: facing8IsLeft(this.facing8) ? -6 : 6, oy: -4 });
    }
  }

  startAttackHold() {
    this.attackNearest({ silent: true });
    this.stopAttackHold();
    this.attackHoldTimer = window.setInterval(() => {
      this.attackNearest({ silent: true });
    }, ATTACK_HOLD_MS);
  }

  stopAttackHold() {
    if (this.attackHoldTimer != null) {
      window.clearInterval(this.attackHoldTimer);
      this.attackHoldTimer = null;
    }
  }

  applyViewportZoom() {
    let zoom = DESKTOP_ZOOM;
    if (isCompactUi()) {
      zoom = window.innerWidth < 420 ? MOBILE_ZOOM : MOBILE_ZOOM_TABLET;
    }
    this.cameras.main.setZoom(zoom);
    this.camFollowRate = isCompactUi() ? CAM_LERP_MOBILE : CAM_LERP_DESKTOP;
  }

  hitRadius(): number {
    return isCompactUi() ? MOBILE_HIT_RADIUS : DESKTOP_HIT_RADIUS;
  }

  doInteract(hit: any) {
    this.socket.interact(hit.id);
    if (hit.kind === "exit" && hit.toCanto) {
      this.time.delayedCall(50, () => this.socket.travel(hit.toCanto));
    }
    if (hit.poiKind === "portal" && hit.toCanto) {
      this.time.delayedCall(50, () => this.socket.travel(hit.toCanto));
    }
    if (hit.poiKind === "ah") {
      setPanelOpen("ah", true);
      this.socket.ahBrowse();
    }
  }

  /** Prefer render position for local range checks. */
  youPos(): Vec2 {
    return this.renderYou;
  }

  interactNearest() {
    if (!this.room) return;
    const you = this.youPos();
    let best: any = null;
    let bestD = INTERACT_RANGE;

    // Prefer exits/portals in a slightly larger travel radius
    for (const e of this.room.entities) {
      if (e.kind !== "exit" && !(e.kind === "poi" && e.poiKind === "portal")) continue;
      const pos = this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      if (d < EXIT_TRAVEL_RANGE && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) {
      bestD = INTERACT_RANGE;
      for (const e of this.room.entities) {
        if (e.kind !== "poi" && e.kind !== "exit" && e.kind !== "loot") continue;
        const pos = this.entityRenderPos(e);
        const d = Math.hypot(pos.x - you.x, pos.y - you.y);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
    }
    if (!best) {
      showToast("Nothing nearby to interact with", "warn");
      return;
    }
    if (best.kind === "loot") this.socket.pickup(best.id);
    else this.doInteract(best);
  }

  attackNearest(opts?: { silent?: boolean }) {
    if (!this.room) return;
    const you = this.youPos();
    let best: any = null;
    let bestD = ATTACK_RANGE;
    for (const e of this.room.entities) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      const pos = this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) {
      if (!opts?.silent) showToast("No foe in range", "warn");
      return;
    }
    this.sendAttack(best.id);
  }

  /** Send attack with brief wind-up, swipe arc, and recovery (less spammy). */
  sendAttack(targetId: string) {
    const now = Date.now();
    if (now < this.attackBusyUntil) return;
    this.attackBusyUntil = now + ATTACK_WINDUP_MS + ATTACK_RECOVERY_MS;
    this.swipeFx = {
      start: this.animT,
      until: this.animT + ATTACK_SWIPE_MS,
      dir: facing8IsLeft(this.facing8) ? -1 : 1,
    };
    this.punch("you", { dur: ATTACK_WINDUP_MS + 40, punch: 0.2, tint: 0xffe8a0, ox: facing8IsLeft(this.facing8) ? -8 : 8, oy: -5 });
    this.time.delayedCall(ATTACK_WINDUP_MS, () => {
      this.socket.attack(targetId);
      this.punch("you", { dur: 140, punch: 0.12, tint: null, ox: facing8IsLeft(this.facing8) ? -6 : 6, oy: -2 });
    });
  }

  refreshInventoryUi() {
    const you = this.lastYouSnapshot;
    if (!you) return;
    renderInventory(you.inventory || [], () => {}, {
      equipped: you.equipped || {},
      gearStats: you.gearStats || {},
      onEquipSlotClick: (slot) => {
        const worn = you.equipped?.[slot];
        if (worn) this.socket.unequip({ slot });
      },
    });
  }

  punch(
    sid: string,
    o: { dur: number; punch: number; tint: number | null; ox: number; oy: number }
  ) {
    this.hitFx.set(sid, {
      start: this.animT,
      until: this.animT + o.dur,
      ox: o.ox,
      oy: o.oy,
      tint: o.tint,
      punch: o.punch,
    });
  }

  entityRenderPos(e: { id: string; x: number; y: number }): Vec2 {
    return this.remoteSmooth.pos(e.id, { x: e.x, y: e.y });
  }

  onNet(msg: any) {
    switch (msg.type) {
      case "snapshot": {
        const prevCanto = this.lastCantoId;
        this.room = msg.room;
        this.lastSnapAt = Date.now();
        updateStats(msg.room.you, msg.room.title);
        this.lastYouSnapshot = msg.room.you;
        this.refreshInventoryUi();

        const sx = msg.room.you.x as number;
        const sy = msg.room.you.y as number;
        const cantoChanged = prevCanto != null && prevCanto !== msg.room.cantoId;
        const first = this.lastCantoId == null;
        this.lastCantoId = msg.room.cantoId;

        this.serverYou = { x: sx, y: sy };
        if (first || cantoChanged) {
          this.renderYou = { x: sx, y: sy };
          this.remoteSmooth.clear();
          this.particles = [];
          this.moveTarget = null;
          this.groundCantoId = null;
          this.autoPickupSent.clear();
          this.pruneSprites(new Set());
          this.killFx = [];
          this.galeBolts = [];
          this.wardRings.clear();
          this.infernalShocks = [];
          this.remotePrev.clear();
          this.centerOnYou(true);
          if (cantoChanged) this.cameras.main.fadeIn(420, 0, 0, 0);
        }

        // Seed / refresh remote targets from snapshot (smoothed in update)
        const targets = new Map<string, Vec2>();
        for (const e of msg.room.entities) {
          targets.set(e.id, { x: e.x, y: e.y });
        }
        for (const pl of msg.room.players) {
          if (pl.id === msg.room.you.id) continue;
          targets.set(`pl:${pl.id}`, { x: pl.x, y: pl.y });
        }
        // Instant-set missing ids so first frame isn't at 0,0
        for (const [id, t] of targets) {
          if (!this.remoteSmooth.get(id)) this.remoteSmooth.set(id, t);
        }

        this.needsFullRedraw = true;

        // First-time Dark Wood tip
        const isHub =
          msg.room.role === "hub" || msg.room.cantoId === "inferno_01";
        if (isHub && !this.hubTipShown) {
          this.hubTipShown = true;
          showToast("No foes here — take the portal Toward Lust.", "info");
        }

        // Loot sparkle when new drops appear
        const lootIds = new Set<string>();
        for (const e of msg.room.entities) {
          if (e.kind !== "loot") continue;
          lootIds.add(e.id);
          if (!this.seenLootIds.has(e.id)) {
            spawnLootSparkle(this.particles, e.x, e.y);
          }
        }
        this.seenLootIds = lootIds;
        for (const id of [...this.autoPickupSent.keys()]) {
          if (!lootIds.has(id)) this.autoPickupSent.delete(id);
        }

        break;
      }
      case "toast":
        showToast(msg.text, msg.level);
        break;
      case "ah_listings":
        renderAh(
          msg.listings,
          (id) => this.socket.ahBuy(id),
          (id) => {
            const L = msg.listings.find((x: any) => x.id === id);
            const bid = Math.max((L?.highestBidAsh || 0) + 100, L?.priceAsh || 0);
            this.socket.ahBid(id, bid);
          }
        );
        setPanelOpen("ah", true);
        break;
      case "error":
        showToast(msg.message, "warn");
        break;
      case "combat": {
        const tid = String(msg.targetId ?? "");
        const youId = this.room?.you?.id != null ? String(this.room.you.id) : "";
        const sockId = this.socket.playerId != null ? String(this.socket.playerId) : "";
        const hitSelf = Boolean(tid) && (tid === youId || tid === sockId);
        if (hitSelf) {
          // We got hit: crimson flash + short shake + recoil on our sprite
          this.punch("you", { dur: 200, punch: -0.06, tint: 0xff7a6a, ox: (Math.random() - 0.5) * 8, oy: 2 });
          this.cameras.main.shake(110, isCompactUi() ? 0.006 : 0.004);
          this.cameras.main.flash(80, 140, 20, 20, false);
          // HUD-locked crimson float (scrollFactor 0) — pass2 missed world-space floats
          this.showPlayerDamageNumber(msg.damage);
          if (msg.targetHp != null && msg.targetHp <= 0) {
            this.cameras.main.shake(260, 0.012);
          }
          break;
        }
        const ent = this.room?.entities?.find((e: any) => String(e.id) === tid);
        if (ent) {
          const sid = `${ent.kind}:${ent.id}`;
          // Hit flash (white) + big punch + knockback away from us + tiny screen kick
          const away = Math.sign(ent.x + ent.y - (this.renderYou.x + this.renderYou.y)) || 1;
          this.punch(sid, {
            dur: 220,
            punch: ent.kind === "boss" ? 0.14 : 0.32,
            tint: 0xffffff,
            ox: away * (6 + Math.random() * 8) * (facing8IsLeft(this.facing8) ? -1 : 1),
            oy: -6 - Math.random() * 6,
          });
          spawnHitBurst(this.particles, ent.x, ent.y);
          this.cameras.main.shake(70, isCompactUi() ? 0.0035 : 0.0025);
          this.showDamageNumber(ent, msg.damage);
        }
        break;
      }
      case "spell_fx": {
        this.onSpellFx(msg);
        break;
      }
      case "entity_removed": {
        const rid = msg.id as string;
        const ent = this.room?.entities?.find((e: any) => e.id === rid);
        if (ent && (ent.kind === "mob" || ent.kind === "boss")) {
          const boss = ent.kind === "boss";
          const pos = this.entityRenderPos(ent);
          const p = worldToScreen(pos.x, pos.y);
          spawnKillBurst(this.particles, pos.x, pos.y, boss);
          this.killFx.push({ sx: p.sx, sy: p.sy, start: this.animT, boss });
          this.ghostFadeSprite(`${ent.kind}:${ent.id}`, boss);
          this.cameras.main.shake(boss ? 340 : 160, boss ? 0.014 : 0.007);
          if (boss) this.cameras.main.flash(260, 201, 162, 39, false);
          else this.cameras.main.flash(60, 120, 60, 30, false);
        }
        break;
      }
    }
  }

  /**
   * On death, leave a crimson afterimage that lifts, stretches and fades so the
   * foe doesn't just blink out of existence.
   */
  ghostFadeSprite(sid: string, boss: boolean) {
    const src = this.entitySprites.get(sid);
    if (!src || !src.visible) return;
    const ghost = this.add.image(src.x, src.y, src.texture.key);
    ghost.setOrigin(src.originX, src.originY);
    ghost.setScale(src.scaleX, src.scaleY);
    ghost.setFlipX(src.flipX);
    ghost.setDepth(src.depth + 0.5);
    ghost.setTint(0xff6a4a);
    ghost.setAlpha(0.9);
    ghost.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: ghost,
      alpha: 0,
      y: ghost.y - (boss ? 34 : 22),
      scaleX: ghost.scaleX * 1.25,
      scaleY: ghost.scaleY * 1.45,
      duration: KILL_FX_MS,
      ease: "Cubic.easeOut",
      onComplete: () => ghost.destroy(),
    });
  }

  /** Keep the vignette glued to the camera view at any zoom / resize. */
  layoutVignette() {
    if (!this.vignette) return;
    const cam = this.cameras.main;
    const z = Math.max(0.05, cam.zoom);
    this.vignette.setDisplaySize((cam.width / z) * 1.02, (cam.height / z) * 1.02);
    this.vignette.setPosition(cam.scrollX + cam.width * 0.5, cam.scrollY + cam.height * 0.5);
  }

  /** Crimson float above local player — camera-locked so flash/shake cannot hide it. */
  showPlayerDamageNumber(dmg: number) {
    if (dmg == null) return;
    const cam = this.cameras.main;
    const world = worldToScreen(this.renderYou.x, this.renderYou.y);
    const sx = world.sx - cam.scrollX + (Math.random() - 0.5) * 14;
    const sy = world.sy - cam.scrollY - 72;
    const compact = isCompactUi();
    const t = this.add
      .text(sx, sy, String(dmg), {
        fontFamily: "Georgia, serif",
        fontSize: compact ? "34px" : "24px",
        fontStyle: "bold",
        color: "#ff6b5a",
        stroke: "#1a0a06",
        strokeThickness: 6,
        shadow: { offsetX: 0, offsetY: 2, color: "#000", blur: 6, fill: true },
      })
      .setOrigin(0.5)
      .setDepth(12000)
      .setScrollFactor(0)
      .setScale(1.5);
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: "Back.easeOut" });
    this.tweens.add({
      targets: t,
      y: sy - 54,
      alpha: 0,
      duration: 900,
      delay: 120,
      ease: "Cubic.easeOut",
      onComplete: () => t.destroy(),
    });
  }

  /** Floating damage number (gold by default, rises + fades) — cheap Text tween. */
  showDamageNumber(
    ent: { x: number; y: number; kind: string },
    dmg: number,
    o?: { color?: string; screen?: { sx: number; sy: number } }
  ) {
    if (dmg == null) return;
    let p = o?.screen;
    if (!p) {
      const pos = this.entityRenderPos(ent as any);
      p = worldToScreen(pos.x, pos.y);
    }
    const compact = isCompactUi();
    const drift = (Math.random() - 0.5) * 22;
    const t = this.add
      .text(p.sx + drift, p.sy - (ent.kind === "boss" ? 96 : 62), String(dmg), {
        fontFamily: "Georgia, serif",
        fontSize: compact ? "30px" : "20px",
        fontStyle: "bold",
        color: o?.color || "#ffd966",
        stroke: "#1a0a06",
        strokeThickness: 6,
        shadow: { offsetX: 0, offsetY: 2, color: "#000", blur: 6, fill: true },
      })
      .setOrigin(0.5)
      .setDepth(9500)
      .setScale(1.6);
    this.tweens.add({ targets: t, scale: 1, duration: 150, ease: "Back.easeOut" });
    this.tweens.add({
      targets: t,
      x: t.x + drift * 0.8,
      y: t.y - (compact ? 44 : 34),
      alpha: 0,
      duration: 820,
      delay: 140,
      ease: "Cubic.easeOut",
      onComplete: () => t.destroy(),
    });
  }

  pickEntity(sx: number, sy: number): any | null {
    if (!this.room) return null;
    let best: any = null;
    let bestScore = Infinity;
    const base = this.hitRadius();
    const consider = (e: any, wx: number, wy: number) => {
      const p = worldToScreen(wx, wy);
      const cy = p.sy - (e.kind === "boss" ? 20 : e.kind === "poi" ? 14 : 8);
      const radius = e.kind === "loot" ? base * LOOT_HIT_BONUS : e.kind === "boss" ? base * 1.4 : base;
      const d = Phaser.Math.Distance.Between(sx, sy, p.sx, cy);
      if (d < radius) {
        // Normalise so a loot near the edge of its bigger circle still loses
        // to a mob under the finger, but wins over empty ground.
        const score = d / radius;
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
      }
    };
    for (const e of this.room.entities) {
      const pos = this.entityRenderPos(e);
      consider(e, pos.x, pos.y);
    }
    return best;
  }

  /** Snap only on spawn / canto change / resize; otherwise soft dt-based follow. */
  centerOnYou(snap = false) {
    if (!this.room) return;
    const p = worldToScreen(this.renderYou.x, this.renderYou.y);
    const cam = this.cameras.main;
    if (snap) {
      cam.centerOn(p.sx, p.sy);
      return;
    }
    const a = expAlpha(this.camFollowRate, this.lastDtSec);
    const curX = cam.scrollX + cam.width * 0.5;
    const curY = cam.scrollY + cam.height * 0.5;
    const nx = curX + (p.sx - curX) * a;
    const ny = curY + (p.sy - curY) * a;
    cam.centerOn(nx, ny);
  }

  doreOk(key: string | null | undefined): key is string {
    return !!key && !this.doreFailed.has(key) && hasTexture(this, key);
  }

  /** Tile the hub/lust Doré ground plate across the room; procedural fallback. */
  refreshGround() {
    if (!this.room) return;
    const isHub =
      this.room.role === "hub" || this.room.cantoId === "inferno_01";
    const groundKey = isHub ? DORE_KEYS.hub_ground : DORE_KEYS.lust_ground;
    this.groundGraphics.clear();
    this.groundGraphics.setDepth(1);

    destroyGroundTiles(this.groundTiles);
    this.groundTiles = null;

    if (this.doreOk(groundKey)) {
      const b = this.room.bounds;
      this.groundTiles = buildGroundTiles(this, groundKey, b, isHub);
      // Soft hatch overlay + border so sprites read on top of busy etching
      drawHatchOverlay(this.groundGraphics, b, isHub);
      if (isHub) {
        drawHubDecor(this.groundGraphics, b, this.animT);
      }
    } else {
      drawGround(this.groundGraphics, this.room.bounds, isHub);
      if (isHub) drawHubDecor(this.groundGraphics, this.room.bounds, this.animT);
    }

    this.groundCantoId = this.room.cantoId;
    const bg = isHub ? "#0b0f0c" : "#0a0606";
    this.cameras.main.setBackgroundColor(bg);
  }


  /**
   * 8-dir walk pose: alternate idle/A ↔ walk-B (when present) at WALK_FRAME_MS,
   * with bob, bounce, lean. West dirs flipX the E/NE/SE plates.
   */
  private walkVisual(t: number, facing: Facing8, compact: boolean) {
    const frame = Math.floor(t / WALK_FRAME_MS) % 2;
    const vis = playerFacingVisual(facing, frame === 1, (k) => this.doreOk(k));
    const phase = -Math.cos((t * Math.PI) / WALK_FRAME_MS); // -1 → 1 → -1 per step
    const step = Math.sin((t * Math.PI) / (WALK_FRAME_MS * 2)); // ±1 alternating steps
    const mul = compact ? 1.3 : 1;
    const bob = -(phase * 0.5 + 0.5) * WALK_BOB_PX * mul;
    const scale = 1 + WALK_BOUNCE * phase;
    const squash = -phase * 0.035;
    const leanDir = facing8IsLeft(facing) ? -1 : 1;
    const rot = Phaser.Math.DegToRad(leanDir * (WALK_LEAN_DEG + step * WALK_LEAN_DEG * 0.8));
    return { key: vis.key, flipX: vis.flipX, bob, scale, squash, rot };
  }

  /** Idle breathe vs walk cycle for the local (predicted) player. */
  private localPlayerVisual(): {
    key: string;
    flipX: boolean;
    bob: number;
    scale: number;
    squash: number;
    rot: number;
  } {
    const sp = Math.hypot(this.velX, this.velY);
    const moving = this.movingVisual || sp > 0.4;
    const compact = isCompactUi();
    if (moving) {
      return this.walkVisual(this.animT, this.facing8, compact);
    }
    const breathe = Math.sin(this.animT * 0.0035);
    const idle = playerFacingVisual(this.facing8, false, (k) => this.doreOk(k));
    return {
      key: idle.key,
      flipX: idle.flipX,
      bob: breathe * IDLE_BOB_PX * (compact ? 1.3 : 1),
      scale: 1,
      squash: breathe * IDLE_SWELL,
      rot: 0,
    };
  }

  placeSprite(
    id: string,
    texKey: string,
    sx: number,
    sy: number,
    depth: number,
    opts?: { tint?: number; bob?: number; flipX?: boolean; scale?: number; squash?: number; rot?: number }
  ): boolean {
    if (!this.doreOk(texKey)) {
      this.hideSprite(id);
      return false;
    }
    const compact = isCompactUi();
    let img = this.entitySprites.get(id);
    let base = this.spriteBase.get(id);
    if (!img) {
      img = this.add.image(sx, sy, texKey);
      img.setOrigin(0.5, 0.92);
      this.applySpriteTexture(id, img, texKey, compact);
      base = this.spriteBase.get(id);
      // Ensure no debug / bounds stroke leftover from textures
      img.clearTint();
      img.setAlpha(1);
      this.entitySprites.set(id, img);
    } else if (img.texture.key !== texKey || !base || this.lastCompact !== compact) {
      this.applySpriteTexture(id, img, texKey, compact);
      base = this.spriteBase.get(id);
    }
    if (!base) return false;

    const bob = opts?.bob ?? 0;
    const fx = this.hitFx.get(id);
    let ox = 0;
    let oy = 0;
    let scaleMul = opts?.scale ?? 1;
    let fxActive = false;
    if (fx) {
      if (this.animT > fx.until) this.hitFx.delete(id);
      else {
        fxActive = true;
        const prog = (this.animT - fx.start) / Math.max(1, fx.until - fx.start);
        const env = Math.sin(Math.min(1, prog) * Math.PI); // 0 → 1 → 0
        ox = fx.ox * env;
        oy = fx.oy * env;
        scaleMul *= 1 + fx.punch * env;
        if (fx.tint != null) img.setTint(fx.tint);
      }
    }
    const sq = opts?.squash ?? 0;
    img.setScale(base.sx * scaleMul * (1 - sq), base.sy * scaleMul * (1 + sq));
    img.setRotation(opts?.rot ?? 0);
    if (opts?.flipX != null) img.setFlipX(opts.flipX);
    img.setPosition(sx + ox, sy - 4 + bob + oy);
    img.setDepth(depth);
    img.setVisible(true);
    if (!fxActive) {
      if (opts?.tint != null) img.setTint(opts.tint);
      else img.clearTint();
    }

    // Soft drop shadow under sprite (slightly larger / darker for pop)
    let sh = this.shadowSprites.get(id);
    if (!sh) {
      if (hasTexture(this, "tex_shadow")) {
        sh = this.add.image(sx, sy + 3, "tex_shadow");
        sh.setAlpha(0.58);
        this.shadowSprites.set(id, sh);
      }
    }
    if (sh) {
      sh.setPosition(sx, sy + 3);
      sh.setDisplaySize(Math.max(28, base.w * 0.62), compact ? 18 : 14);
      sh.setDepth(depth - 0.1);
      sh.setVisible(true);
      sh.setAlpha(0.58);
    }
    return true;
  }

  /** Set texture, crop, blend and record the base scale for punch math. */
  private applySpriteTexture(
    id: string,
    img: Phaser.GameObjects.Image,
    texKey: string,
    compact: boolean
  ) {
    if (img.texture.key !== texKey) img.setTexture(texKey);
    const crop = DORE_CROP[texKey];
    if (crop) img.setCrop(crop.x, crop.y, crop.w, crop.h);
    else if (img.isCropped) img.setCrop();
    img.setBlendMode(DORE_BLEND[texKey] ?? Phaser.BlendModes.NORMAL);
    const sz = doreDisplaySize(this, texKey, compact);
    const frameW = crop ? crop.w : img.width;
    const frameH = crop ? crop.h : img.height;
    const sx = sz.w / Math.max(1, frameW);
    const sy = sz.h / Math.max(1, frameH);
    img.setScale(sx, sy);
    if (crop) {
      // Crop keeps the full-frame origin; shift so the visible frame is centred on the feet.
      const fullW = img.width;
      const fullH = img.height;
      img.setOrigin((crop.x + crop.w / 2) / fullW, (crop.y + crop.h * 0.92) / fullH);
    } else {
      img.setOrigin(0.5, 0.92);
    }
    this.spriteBase.set(id, { sx, sy, w: sz.w, h: sz.h });
  }

  hideSprite(id: string) {
    const img = this.entitySprites.get(id);
    if (img) img.setVisible(false);
    const sh = this.shadowSprites.get(id);
    if (sh) sh.setVisible(false);
  }

  pruneSprites(seen: Set<string>) {
    for (const [id, img] of this.entitySprites) {
      if (!seen.has(id)) {
        img.destroy();
        this.entitySprites.delete(id);
        this.spriteBase.delete(id);
      }
    }
    for (const [id, sh] of this.shadowSprites) {
      if (!seen.has(id)) {
        sh.destroy();
        this.shadowSprites.delete(id);
      }
    }
  }

  /** Render-only magnet: loot within MAGNET_RANGE drifts toward the player. */
  lootRenderPos(e: any): Vec2 {
    const pos = this.entityRenderPos(e);
    const you = this.renderYou;
    const dx = you.x - pos.x;
    const dy = you.y - pos.y;
    const d = Math.hypot(dx, dy);
    if (d >= MAGNET_RANGE || d < 0.01) return pos;
    const pull = (1 - d / MAGNET_RANGE) * 0.45; // up to 45% of the way
    return { x: pos.x + dx * pull, y: pos.y + dy * pull };
  }

  onSpellFx(msg: any) {
    const spellId = String(msg.spellId || "");
    if (spellId === "mana_deny") {
      flashManaDeny();
      return;
    }
    const x = Number(msg.x) || 0;
    const y = Number(msg.y) || 0;
    const casterId = String(msg.casterId || "");

    if (spellId === "gale_bolt") {
      const tx = msg.tx != null ? Number(msg.tx) : x + this.aimX * 6;
      const ty = msg.ty != null ? Number(msg.ty) : y + this.aimY * 6;
      spawnGaleTrail(this.particles, x, y, tx, ty);
      this.galeBolts.push({
        x0: x,
        y0: y,
        x1: tx,
        y1: ty,
        start: this.animT,
        dur: 280,
      });
      this.cameras.main.shake(55, isCompactUi() ? 0.0025 : 0.0018);
      return;
    }

    if (spellId === "whirl_ward") {
      const durMs = (Number(msg.duration) || 4.5) * 1000;
      spawnWardRing(this.particles, x, y);
      this.wardRings.set(casterId || "local", {
        until: this.animT + durMs,
        x,
        y,
      });
      if (casterId === this.room?.you?.id || casterId === this.socket.playerId) {
        this.wardRings.set("you", { until: this.animT + durMs, x, y });
      }
      return;
    }

    if (spellId === "infernal_burst") {
      const radius = Number(msg.radius) || 4.2;
      spawnInfernalBloom(this.particles, x, y, radius);
      this.infernalShocks.push({
        x,
        y,
        start: this.animT,
        dur: 520,
        radius,
      });
      this.cameras.main.shake(220, isCompactUi() ? 0.012 : 0.009);
      this.cameras.main.flash(120, 180, 40, 20, false);
      const cam = this.cameras.main;
      const z0 = cam.zoom;
      cam.setZoom(z0 * 1.06);
      this.tweens.add({
        targets: cam,
        zoom: z0,
        duration: 280,
        ease: "Cubic.easeOut",
      });
      return;
    }
  }


  redraw() {
    if (!this.room) return;
    const g = this.graphics;
    g.clear();
    g.setDepth(8000);

    const isHub =
      this.room.role === "hub" || this.room.cantoId === "inferno_01";
    const compact = isCompactUi();
    const labelSize = compact ? "12px" : "11px";
    const seenLabels = new Set<string>();
    const seenSprites = new Set<string>();

    if (this.groundCantoId !== this.room.cantoId) {
      this.refreshGround();
    }
    drawParticles(g, this.particles);
    for (let i = this.killFx.length - 1; i >= 0; i--) {
      const k = this.killFx[i];
      const prog = (this.animT - k.start) / KILL_FX_MS;
      if (prog >= 1) {
        this.killFx.splice(i, 1);
        continue;
      }
      drawKillRing(g, k.sx, k.sy, prog, k.boss);
    }

    // Gale bolt arcs
    for (let i = this.galeBolts.length - 1; i >= 0; i--) {
      const b = this.galeBolts[i];
      const prog = (this.animT - b.start) / b.dur;
      if (prog >= 1) {
        this.galeBolts.splice(i, 1);
        continue;
      }
      const a0 = worldToScreen(b.x0, b.y0);
      const a1 = worldToScreen(b.x1, b.y1);
      drawGaleBoltArc(g, a0.sx, a0.sy - 18, a1.sx, a1.sy - 18, Math.min(1, prog * 1.35));
    }

    // Infernal shockwaves
    for (let i = this.infernalShocks.length - 1; i >= 0; i--) {
      const s = this.infernalShocks[i];
      const prog = (this.animT - s.start) / s.dur;
      if (prog >= 1) {
        this.infernalShocks.splice(i, 1);
        continue;
      }
      const p = worldToScreen(s.x, s.y);
      drawInfernalShock(g, p.sx, p.sy, prog, s.radius);
    }

    // Whirl ward rings (follow local player if keyed "you")
    for (const [id, w] of [...this.wardRings.entries()]) {
      if (this.animT > w.until) {
        this.wardRings.delete(id);
        continue;
      }
      let wx = w.x;
      let wy = w.y;
      if (id === "you") {
        wx = this.renderYou.x;
        wy = this.renderYou.y;
      }
      const fade = Math.min(1, (w.until - this.animT) / 600);
      const p = worldToScreen(wx, wy);
      drawWardRingGfx(g, p.sx, p.sy, this.animT, 0.55 + fade * 0.45);
    }

    // Live hub decor pulse (lightweight vignette trees already stamped on ground)
    if (isHub) {
      // Soft center darkening under playable clearing each frame for sprite pop
      const b = this.room.bounds;
      const c = worldToScreen(b.width * 0.5, b.height * 0.55);
      g.fillStyle(0x000000, 0.08);
      g.fillEllipse(c.sx, c.sy, 180, 80);
    }

    const ents = [...this.room.entities].sort((a, b) => {
      const pa = this.entityRenderPos(a);
      const pb = this.entityRenderPos(b);
      return pa.x + pa.y - (pb.x + pb.y);
    });

    for (const e of ents) {
      const pos = e.kind === "loot" ? this.lootRenderPos(e) : this.entityRenderPos(e);
      const p = worldToScreen(pos.x, pos.y);
      const depth = 100 + pos.x + pos.y;
      const tex = entityDoreKey(e);
      const sid = `${e.kind}:${e.id}`;

      if (e.kind === "poi") {
        drawEntityPad(g, p.sx, p.sy, compact ? 1.5 : 1.1);
        if (this.placeSprite(sid, tex!, p.sx, p.sy, depth)) {
          seenSprites.add(sid);
        } else {
          drawPoi(g, p.sx, p.sy, e.poiKind, compact);
        }
        this.addLabel(`poi:${e.id}`, p.sx, p.sy - (compact ? 40 : 30), e.label || e.name, labelSize, seenLabels);
      } else if (e.kind === "exit") {
        drawEntityPad(g, p.sx, p.sy, compact ? 1.9 : 1.4);
        drawExitSpotlight(g, p.sx, p.sy, this.animT, compact);
        if (this.placeSprite(sid, DORE_KEYS.exit_portal, p.sx, p.sy, depth)) {
          seenSprites.add(sid);
        } else {
          drawExit(g, p.sx, p.sy);
        }
        const exitLabel =
          e.toCanto === "inferno_05"
            ? "Toward Lust →"
            : e.label || "Exit";
        this.addLabel(
          `exit:${e.id}`,
          p.sx,
          p.sy - (compact ? 84 : 62),
          exitLabel,
          compact ? "16px" : "13px",
          seenLabels
        );
        // Gold-ish label for Lust exit
        const lab = this.labels.get(`exit:${e.id}`);
        if (lab && e.toCanto === "inferno_05") lab.setColor("#e8c86a");
      } else if (e.kind === "mob") {
        drawEntityPad(g, p.sx, p.sy, e.champion ? (compact ? 1.85 : 1.45) : compact ? 1.55 : 1.2);
        drawFoeGlow(g, p.sx, p.sy, this.animT, { compact, champion: Boolean(e.champion) });
        let topY = p.sy - (e.champion ? 40 : 32);
        const foeScale = compact ? 1.12 : 1.06;
        if (this.placeSprite(sid, tex!, p.sx, p.sy, depth, { scale: foeScale })) {
          seenSprites.add(sid);
          const b = this.spriteBase.get(sid);
          if (b) topY = p.sy - 4 - b.h * foeScale * 0.92 - (compact ? 12 : 8);
        } else {
          drawMob(g, p.sx, p.sy, Boolean(e.champion));
        }
        drawFoeHpBar(g, p.sx, topY, e.hp, e.maxHp, e.champion ? 40 : 30, { compact });
      } else if (e.kind === "boss") {
        drawEntityPad(g, p.sx, p.sy, compact ? 2.7 : 2.1);
        drawFoeGlow(g, p.sx, p.sy, this.animT, { compact, boss: true });
        let topY = p.sy - 68;
        const bossScale = compact ? 1.1 : 1.05;
        if (this.placeSprite(sid, DORE_KEYS.boss_judge, p.sx, p.sy, depth, { scale: bossScale })) {
          seenSprites.add(sid);
          const b = this.spriteBase.get(sid);
          if (b) topY = p.sy - 4 - b.h * bossScale * 0.92 - (compact ? 16 : 10);
        } else {
          drawBoss(g, p.sx, p.sy);
        }
        this.addLabel(`boss:${e.id}`, p.sx, topY - (compact ? 16 : 12), e.name, compact ? "15px" : "12px", seenLabels);
        const bl = this.labels.get(`boss:${e.id}`);
        if (bl) bl.setColor("#e8c86a");
        drawFoeHpBar(g, p.sx, topY, e.hp, e.maxHp, 64, { compact, boss: true });
      } else if (e.kind === "loot") {
        const rarity = e.item?.rarity || "normal";
        const tint = RARITY_COLOR[rarity] || 0xffffff;
        const strong = rarity !== "normal" && rarity !== "magic";
        drawLootGlow(g, p.sx, p.sy, tint, this.animT, compact, strong);
        const bob = Math.sin(this.animT * 0.004 + p.sx * 0.01) * (compact ? 3 : 2);
        const lootKey = lootTextureKey(e.item);
        const placedLoot =
          this.placeSprite(sid, lootKey, p.sx, p.sy, depth, {
            tint: rarity === "normal" ? undefined : tint,
            bob,
          }) ||
          this.placeSprite(sid, DORE_KEYS.loot_gem, p.sx, p.sy, depth, {
            tint: rarity === "normal" ? 0xe8dcc0 : tint,
            bob,
          });
        if (placedLoot) {
          seenSprites.add(sid);
        } else {
          drawLoot(g, p.sx, p.sy, e.item?.rarity, compact, this.animT);
        }
        if (strong) {
          this.addLabel(`loot:${e.id}`, p.sx, p.sy - (compact ? 46 : 34), e.item?.name || "", compact ? "12px" : "10px", seenLabels);
          const ll = this.labels.get(`loot:${e.id}`);
          if (ll) ll.setColor("#" + tint.toString(16).padStart(6, "0"));
        }
      }
    }

    // Other players (smoothed) then local (predicted)
    const others = this.room.players.filter((pl: any) => pl.id !== this.room!.you.id);
    for (const pl of others) {
      const pos = this.remoteSmooth.pos(`pl:${pl.id}`, { x: pl.x, y: pl.y });
      const p = worldToScreen(pos.x, pos.y);
      const depth = 100 + pos.x + pos.y;
      const sid = `pl:${pl.id}`;
      let topY = p.sy - 42;
      // Stride when the smoothed position is actually changing.
      const prev = this.remotePrev.get(sid);
      const now = this.animT;
      let movedAt = prev?.movedAt ?? -Infinity;
      let facing: Facing8 = prev?.facing ?? "s";
      if (prev) {
        const ddx = pos.x - prev.x;
        const ddy = pos.y - prev.y;
        if (Math.hypot(ddx, ddy) > 0.015) {
          movedAt = now;
          const f = facing8FromWorldVel(ddx, ddy, 0.005);
          if (f) facing = f;
        } else {
          facing = prev.facing;
        }
      }
      this.remotePrev.set(sid, { x: pos.x, y: pos.y, movedAt, facing });
      const walking = now - movedAt < 140;
      const rv = walking
        ? this.walkVisual(now, facing, compact)
        : (() => {
            const idle = playerFacingVisual(facing, false, (k) => this.doreOk(k));
            return {
              key: idle.key,
              flipX: idle.flipX,
              bob: Math.sin(now * 0.0035 + p.sx) * IDLE_BOB_PX,
              scale: 1,
              squash: 0,
              rot: 0,
            };
          })();
      if (
        this.placeSprite(sid, rv.key, p.sx, p.sy, depth, {
          tint: 0x9ab0a0,
          bob: rv.bob,
          scale: rv.scale,
          squash: rv.squash,
          rot: rv.rot,
          flipX: rv.flipX,
        })
      ) {
        seenSprites.add(sid);
        const b = this.spriteBase.get(sid);
        if (b) topY = p.sy - 4 - b.h * 0.92 - (compact ? 10 : 6);
      } else {
        drawPlayer(g, p.sx, p.sy, false);
      }
      this.addLabel(`pl:${pl.id}`, p.sx, topY - (compact ? 14 : 10), pl.name, labelSize, seenLabels);
      drawFoeHpBar(g, p.sx, topY, pl.hp, pl.maxHp, 28, { compact, ally: true });
    }

    {
      const p = worldToScreen(this.renderYou.x, this.renderYou.y);
      // Small depth bias so a swarming pack on the same row never buries us.
      const depth = 100 + this.renderYou.x + this.renderYou.y + 1.2;
      const sid = "you";
      drawEntityPad(g, p.sx, p.sy, compact ? 1.6 : 1.2);
      let topY = p.sy - 42;
      const vis = this.localPlayerVisual();
      if (
        this.placeSprite(sid, vis.key, p.sx, p.sy, depth, {
          flipX: vis.flipX,
          bob: vis.bob,
          scale: vis.scale,
          squash: vis.squash,
          rot: vis.rot,
        })
      ) {
        seenSprites.add(sid);
        const b = this.spriteBase.get(sid);
        if (b) topY = p.sy - 4 - b.h * 0.92 - (compact ? 10 : 6);
      } else {
        drawPlayer(g, p.sx, p.sy, true);
      }
      // Attack swipe arc feedback
      if (this.swipeFx && this.animT <= this.swipeFx.until) {
        const prog = (this.animT - this.swipeFx.start) / Math.max(1, this.swipeFx.until - this.swipeFx.start);
        const ang = (this.swipeFx.dir > 0 ? -0.9 : Math.PI + 0.9) + prog * this.swipeFx.dir * 1.6;
        const reach = compact ? 84 : 52;
        const fade = 1 - prog * prog;
        const cy = p.sy - (compact ? 44 : 28);
        const d = this.swipeFx.dir;
        // Crescent sweeps across the front of the figure: wide soft glow, gold
        // blade, white-hot core; the trailing edge stretches as it fades.
        const trail = 0.9 + prog * 0.9;
        g.lineStyle(compact ? 22 : 14, 0xc9a227, 0.2 * fade);
        g.beginPath();
        g.arc(p.sx, cy, reach, ang - d * trail, ang + d * 0.35, d < 0);
        g.strokePath();
        g.lineStyle(compact ? 9 : 6, 0xffe08a, 0.95 * fade);
        g.beginPath();
        g.arc(p.sx, cy, reach, ang - d * trail, ang + d * 0.3, d < 0);
        g.strokePath();
        g.lineStyle(compact ? 3 : 2, 0xffffff, 0.85 * fade);
        g.beginPath();
        g.arc(p.sx, cy, reach * 0.9, ang - d * trail * 0.6, ang + d * 0.2, d < 0);
        g.strokePath();
        // Leading spark
        const tipX = p.sx + Math.cos(ang + d * 0.3) * reach;
        const tipY = cy + Math.sin(ang + d * 0.3) * reach;
        g.fillStyle(0xfff6d0, 0.9 * fade);
        g.fillCircle(tipX, tipY, compact ? 6 : 4);
      } else if (this.swipeFx && this.animT > this.swipeFx.until) {
        this.swipeFx = null;
      }
      // No "You" nameplate: the ally-styled HP bar over the head already marks us.
      const you = this.room.you;
      drawFoeHpBar(g, p.sx, topY, you.hp, you.maxHp, 30, { compact, ally: true });
    }

    this.lastCompact = compact;
    this.pruneLabels(seenLabels);
    this.pruneSprites(seenSprites);
  }

  addLabel(
    key: string,
    x: number,
    y: number,
    text: string,
    fontSize = "11px",
    seen?: Set<string>
  ) {
    seen?.add(key);
    let t = this.labels.get(key);
    if (!t) {
      t = this.add
        .text(x, y, text, {
          fontFamily: "Georgia, serif",
          fontSize,
          color: "#c8bfa2",
          stroke: "#0b0f0c",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setAlpha(0.82)
        .setDepth(9000);
      this.labels.set(key, t);
      this.labelGroup.add(t);
    } else {
      t.setPosition(x, y);
      if (t.text !== text) t.setText(text);
      if (t.style.fontSize !== fontSize) t.setFontSize(fontSize);
    }
  }

  pruneLabels(seen: Set<string>) {
    for (const [key, t] of this.labels) {
      if (!seen.has(key)) {
        t.destroy();
        this.labels.delete(key);
      }
    }
  }

  private clampToBounds(x: number, y: number): Vec2 {
    if (!this.room) return { x, y };
    const b = this.room.bounds;
    return {
      x: Math.max(1, Math.min(b.width - 1, x)),
      y: Math.max(1, Math.min(b.height - 1, y)),
    };
  }

  private sendMoveThrottled(x: number, y: number) {
    const now = Date.now();
    if (now - this.lastMoveSend < MOVE_SEND_MS) return;
    this.lastMoveSend = now;
    this.socket.move(x, y);
  }

  /**
   * Accelerate toward intent (iso axes), integrate velocity, throttle server move.
   */
  private applyContinuousMove(dx: number, dy: number, dtSec: number) {
    if (!this.room) return;
    const len = Math.hypot(dx, dy);
    if (len > 0.001) {
      const nx = dx / len;
      const ny = dy / len;
      this.velX += nx * MOVE_ACCEL * dtSec;
      this.velY += ny * MOVE_ACCEL * dtSec;
      // Cap speed (scale by stick magnitude when provided via length>1 clamp)
      const mag = Math.min(1, len);
      const maxSp = PREDICT_SPEED * Math.max(0.35, mag);
      const sp = Math.hypot(this.velX, this.velY);
      if (sp > maxSp) {
        this.velX = (this.velX / sp) * maxSp;
        this.velY = (this.velY / sp) * maxSp;
      }
      const f = facing8FromWorldVel(nx, ny, 0.15);
      if (f) this.facing8 = f;
      if (mag > 0.2) {
        this.aimX = nx;
        this.aimY = ny;
      }
      this.moveTarget = null;
    }
    this.integrateVelocity(dtSec, true);
  }

  private advanceTapMove(dtSec: number) {
    if (!this.moveTarget || !this.room) return;
    const dx = this.moveTarget.x - this.renderYou.x;
    const dy = this.moveTarget.y - this.renderYou.y;
    const d = Math.hypot(dx, dy);
    if (d < TAP_ARRIVE) {
      this.moveTarget = null;
      this.velX = 0;
      this.velY = 0;
      this.predicting = false;
      return;
    }
    // Accelerate toward target rather than teleport-step
    this.velX += (dx / d) * MOVE_ACCEL * dtSec;
    this.velY += (dy / d) * MOVE_ACCEL * dtSec;
    const sp = Math.hypot(this.velX, this.velY);
    if (sp > PREDICT_SPEED) {
      this.velX = (this.velX / sp) * PREDICT_SPEED;
      this.velY = (this.velY / sp) * PREDICT_SPEED;
    }
    {
      const f = facing8FromWorldVel(dx, dy, 0.01);
      if (f) this.facing8 = f;
    }
    this.aimX = dx / d;
    this.aimY = dy / d;
    this.integrateVelocity(dtSec, true);
    this.sendMoveThrottled(this.moveTarget.x, this.moveTarget.y);
  }

  private integrateVelocity(dtSec: number, driven: boolean) {
    if (!driven) {
      // Friction / deceleration when no input
      const sp = Math.hypot(this.velX, this.velY);
      if (sp < 0.05) {
        this.velX = 0;
        this.velY = 0;
      } else {
        const cut = Math.max(0, sp - MOVE_FRICTION * dtSec);
        this.velX = (this.velX / sp) * cut;
        this.velY = (this.velY / sp) * cut;
      }
    }
    if (this.velX === 0 && this.velY === 0) {
      if (!driven) { this.predicting = false; this.movingVisual = false; }
      return;
    }
    const nx = this.renderYou.x + this.velX * dtSec;
    const ny = this.renderYou.y + this.velY * dtSec;
    this.renderYou = this.clampToBounds(nx, ny);
    this.predicting = true;
    this.movingVisual = true;
    this.sendMoveThrottled(this.renderYou.x, this.renderYou.y);
  }

  /** Auto-loot: request pickup for loot near the player (server range-checks). */
  private autoPickupScan() {
    if (!this.room) return;
    const now = Date.now();
    if (now - this.lastAutoPickupScan < 220) return;
    this.lastAutoPickupScan = now;
    const you = this.serverYou; // authoritative pos — avoids "Too far" from prediction lead
    for (const e of this.room.entities) {
      if (e.kind !== "loot") continue;
      const d = Math.hypot(e.x - you.x, e.y - you.y);
      if (d > AUTO_PICKUP_RANGE) continue;
      const last = this.autoPickupSent.get(e.id) || 0;
      if (now - last < AUTO_PICKUP_RETRY_MS) continue;
      this.autoPickupSent.set(e.id, now);
      this.socket.pickup(e.id);
    }
  }

  update(_t: number, dtMs: number) {
    if (!this.room) return;
    const dtSec = Math.min(0.05, dtMs / 1000);
    this.lastDtSec = dtSec;
    this.animT += dtMs;
    const keys = this.keys;

    let dx = 0;
    let dy = 0;
    this.predicting = false;
    this.movingVisual = false;

    const stick = this.joystick?.getVector();
    if (stick && (stick.x !== 0 || stick.y !== 0)) {
      dx += stick.y + stick.x;
      dy += stick.y - stick.x;
    }

    if (keys) {
      if (keys.W.isDown) {
        dx -= 1;
        dy -= 1;
      }
      if (keys.S.isDown) {
        dx += 1;
        dy += 1;
      }
      if (keys.A.isDown) {
        dx -= 1;
        dy += 1;
      }
      if (keys.D.isDown) {
        dx += 1;
        dy -= 1;
      }
      if (Phaser.Input.Keyboard.JustDown(keys.E)) {
        this.interactNearest();
      }
    }

    if (dx !== 0 || dy !== 0) {
      this.applyContinuousMove(dx, dy, dtSec);
    } else if (this.moveTarget) {
      this.advanceTapMove(dtSec);
    } else {
      this.integrateVelocity(dtSec, false);
    }

    // Reconcile local render toward last server snapshot
    this.renderYou = reconcileLocal(
      this.renderYou,
      this.serverYou,
      dtSec,
      this.predicting,
      { x: this.velX, y: this.velY }
    );

    // Interpolate remotes / mobs toward latest snapshot coords
    const targets = new Map<string, Vec2>();
    for (const e of this.room.entities) {
      targets.set(e.id, { x: e.x, y: e.y });
    }
    for (const pl of this.room.players) {
      if (pl.id === this.room.you.id) continue;
      targets.set(`pl:${pl.id}`, { x: pl.x, y: pl.y });
    }
    this.remoteSmooth.tick(targets, dtSec);

    // Particles (sparse)
    const isHub = this.room.role === "hub";
    this.particleAcc += dtSec;
    if (this.particleAcc > 0.22) {
      this.particleAcc = 0;
      spawnParticles(this.particles, isHub, this.room.bounds, isHub ? 3 : 5);
    }
    tickParticles(this.particles, dtSec);

    this.autoPickupScan();

    // Lust exit proximity hint + reliable travel nudge
    if (this.room) {
      const isHub =
        this.room.role === "hub" || this.room.cantoId === "inferno_01";
      if (isHub) {
        let nearExit: any = null;
        let nearD = EXIT_HINT_RANGE;
        for (const e of this.room.entities) {
          if (e.kind !== "exit" && !(e.kind === "poi" && e.poiKind === "portal"))
            continue;
          const pos = this.entityRenderPos(e);
          const d = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
          if (d < nearD) {
            nearD = d;
            nearExit = e;
          }
        }
        if (nearExit && nearD < EXIT_HINT_RANGE) {
          const now = Date.now();
          if (now - this.nearExitToastAt > 8000) {
            this.nearExitToastAt = now;
            showToast("Portal near — press Interact to enter Lust", "info");
          }
        }
      }
    }

    this.redraw();
    this.centerOnYou(false);
    this.layoutVignette();
  }
}
