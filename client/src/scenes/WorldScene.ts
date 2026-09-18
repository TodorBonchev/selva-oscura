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
  noteWardBuff,
  noteAttackCd,
  pulseInvBag,
  noteComboHit,
  isComboMilestone,
  isComboInfernoFringe,
  isComboEclipse,
  isComboVoidCorona,
  isComboAbyss,
  isComboRiftShear,
  isComboRiftShearMax,
  isComboHorizonFold,
  resetCombo,
  playDeathRevive,
  flashWardSoak,
  flashSlamSting,
  flashSlamSafeRim,
  pulseVoidCorona,
  pulseAbyssChroma,
  pulseRiftShear,
  pulseHorizonFold,
  flashSpellCancel,
  hapticInteractReady,
  hapticStickyRetarget,
  hapticPortalComplete,
} from "../ui/hud";
import { SPELLS, GALE_RANGE, BURST_RADIUS, type SpellId } from "../spells";
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
  drawChampionCrownPip,
  drawJudgeSlamImpact,
  drawJudgeSlamSafeRim,
  drawLootGlow,
  drawLootTowerSpine,
  lootRarityPulse,
  spawnHitBurst,
  spawnKillBurst,
  spawnEclipseEmberDrift,
  drawPlayerFootprintGhost,
  drawCorpseXMarker,
  spawnFootstepDust,
  spawnTelegraphFootstepDust,
  drawLootMagnetRarityFlash,
  spawnDissolveAsh,
  drawInteractPulse,
  ensureVignetteTexture,
  drawKillRing,
  spawnLootSparkle,
  spawnGaleTrail,
  spawnWardRing,
  spawnInfernalBloom,
  drawGaleBoltArc,
  drawWardRingGfx,
  drawInfernalShock,
  drawGaleAimTelegraph,
  drawWardChargeTelegraph,
  drawBurstGroundTelegraph,
  drawBossTelegraph,
  bossTelegraphPipY,
  drawGaleRangePreview,
  drawOutOfRangeFoeMark,
  drawPortalChargeRing,
  drawPortalEnterTip,
  drawStickyTargetReticle,
  drawStickyGoldTrail,
  drawJudgeCountdownShatter,
  drawRespawnBeacon,
  drawDeathAshTrail,
  drawMagnetSpark,
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
const INTERACT_RANGE = 5.2;
/** Pulse outline + Interact toast when within this distance of a POI/exit/loot. */
const INTERACT_HIGHLIGHT_RANGE = 5.0;
const EXIT_HINT_RANGE = 7;
const EXIT_TRAVEL_RANGE = 6.2;
/** Prefer last-hit foe for this long after we land a hit (Gale sticky aim). */
const GALE_STICKY_MS = 1600;
/** Remotes dim if no snapshot for this long, or while globally reconnecting. */
const REMOTE_STALE_MS = 2200;
const ATTACK_RANGE = 5.5;
/** Client auto-loot: send pickup once loot is within this many world units. */
const AUTO_PICKUP_RANGE = 4.0;
/** Loot visually drifts toward the player inside this radius (render only). */
const MAGNET_RANGE = 5.5;
/** Soft entrance beacon after death revive (ms). */
const RESPAWN_BEACON_MS = 2200;
/** Soft ash trail from corpse → entrance after death (ms). */
const DEATH_ASH_TRAIL_MS = 1600;
/** Rarity-tick pop duration when loot first enters magnet range (ms). */
const MAGNET_TICK_POP_MS = 420;
/** Stagger between multi-pile magnet flashes in the same frame (ms). */
const MAGNET_FLASH_STAGGER_MS = 70;
/** Rift-shear foe pad desync duration (ms). */
const RIFT_SHEAR_MS = 520;
const RIFT_SHEAR_MAX_MS = 720;
/** Horizon-fold letterbox + depth flicker duration (ms). */
const HORIZON_FOLD_MS = 580;
/** Sticky release gold trail travel (ms). */
const STICKY_GOLD_TRAIL_MS = 320;
/** Judge countdown disc shatter into dust (ms). */
const JUDGE_DISC_SHATTER_MS = 480;
/** Soft spine ripple after staggered magnet flash lands (ms). */
const MAGNET_SPINE_RIPPLE_MS = 420;
/** Sticky chip: hold this long before cycling threats one-by-one (ms). */
const STICKY_HOLD_MS = 280;
/** Sticky chip: interval between successive threat cycles while held (ms). */
const STICKY_CYCLE_MS = 380;
/** Judge windup: cadence for safe/danger footstep dust under player (ms). */
const JUDGE_TELE_DUST_MS = 160;
/** Loot piles within this world distance share a tile and get staggered. */
const LOOT_STACK_RANGE = 0.85;
/** Travel time for auto-pickup magnet spark (ms). */
const MAGNET_SPARK_MS = 380;
/** Screen-edge margin (fraction of view) for sticky HP pip. */
const STICKY_EDGE_FRAC = 0.14;
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
const ATTACK_WINDUP_MS = 160;
const ATTACK_RECOVERY_MS = 400;
const ATTACK_SWIPE_MS = 400;
/** Kill ring / ghost-fade duration (ms). */
const KILL_FX_MS = 520;
/** Heavier Judge dissolve / ghost linger (ms). */
const BOSS_KILL_FX_MS = 820;
/** Spell cast windup — telegraph rings/line before the cast resolves. */
const SPELL_TELEGRAPH_MS: Record<string, number> = {
  gale_bolt: 180,
  whirl_ward: 260,
  infernal_burst: 300,
};
/** Full overworld labels when within this world distance; icon/dot when farther. */
const LABEL_NEAR_RANGE = 7.5;
const LABEL_FAR_RANGE = 16;
/** Brief combat freeze on solid hits (ms wall-clock). */
const HIT_STOP_MS = 58;
const HIT_STOP_KILL_MS = 90;
/** Spell hold: past this → full telegraph / Gale aim mode; shorter tap still casts on release. */
const SPELL_HOLD_CONFIRM_MS = 200;
/** Finger/mouse must leave button center by this many CSS px to count as Gale-aimed. */
const GALE_DRAG_AIM_PX = 26;
/** Foes between GALE_RANGE and GALE_RANGE+this get an out-of-range mark while aiming. */
const GALE_OUTSIDE_SLACK = 2.8;
/** Hold Interact this long to travel through a portal (cancel if released early). */
const PORTAL_HOLD_MS = 420;
/** Merge identical floating damage into N×count within this window (ms). */
const DMG_STACK_WINDOW_MS = 480;
/** Damage ≥ this gets crit-style flash (scale punch + white flash). */
const CRIT_DMG_FLASH = 36;
/** Soft vignette punch alpha during canto travel. */
const TRAVEL_VIGNETTE_PEAK = 0.98;
/** Max pooled floating damage texts. */
const DMG_POOL_MAX = 28;
/** Compass arrows fully hidden inside this world distance. */
const COMPASS_HIDE_RANGE = 8.2;
/** Compass arrows start fading toward hide range from this distance. */
const COMPASS_FADE_START = 14.5;
/** Distance text fades out earlier than the chevron when approaching hide range. */
const COMPASS_DIST_FADE_START = 12.0;
/** World distance under which foes count as overlapping (HP / silhouette nudge). */
const FOE_STACK_RANGE = 1.35;
/** Judge slam impact flash linger (ms). */
const JUDGE_SLAM_FX_MS = 520;
/** World units outside slam radius that still count as “just safe”. */
const JUDGE_SLAM_SAFE_BAND = 1.15;
const JUDGE_SLAM_SAFE_FX_MS = 560;
/** Soft vignette punch at combo ×25+ (ms window). */
const COMBO_VIGNETTE_MS = 480;
const COMBO_VIGNETTE_PEAK = 0.96;
/** Gale hold must last at least this long before cancel/confirm toasts. */
const GALE_HOLD_TOAST_MS = 90;
/** Ignore duplicate death FX within this window (combat + slain toast). */
const DEATH_FX_LOCK_MS = 1600;

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
  /** Inventory item ids from last snapshot — detect new loot for Inv bag glow. */
  seenInvItemIds = new Set<string>();
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
  /** Nearest interactable for pulse outline + toast (poi/exit/loot). */
  nearestInteract: { id: string; kind: string; label: string; sx: number; sy: number } | null = null;
  lastInteractHintId: string | null = null;
  lastInteractHintAt = 0;
  /** Last walk frame index used to spawn footstep dust. */
  lastDustFrame = -1;
  hitStopActive = false;
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
  /** Pending cast windup (telegraph drawn until resolve). */
  pendingCast: {
    spellId: SpellId;
    aimX: number;
    aimY: number;
    start: number;
    until: number;
  } | null = null;
  /** Active boss attack telegraphs (Judge windup). */
  bossTelegraphs: {
    id: string;
    x: number;
    y: number;
    radius: number;
    start: number;
    until: number;
  }[] = [];
  /** Judge slam resolve VFX (impact flash + ground crack). */
  bossSlamFx: {
    x: number;
    y: number;
    radius: number;
    start: number;
    until: number;
  }[] = [];
  /** Gold “just safe” rim FX when barely outside slam. */
  bossSlamSafeFx: {
    x: number;
    y: number;
    radius: number;
    start: number;
    until: number;
  }[] = [];
  /** Soft vignette punch window for combo ×25+ (animT ms). */
  comboVignetteUntil = 0;
  comboVignettePeak = 0;
  /** Camera-following soft vignette so the arena edges fall into dark. */
  vignette: Phaser.GameObjects.Image | null = null;
  /** Soft vignette alpha tween target during canto travel flash. */
  travelVignetteUntil = 0;
  travelVignettePeak = 0;
  /** Remote player last render pos + moving timestamp so they stride too. */
  remotePrev = new Map<string, { x: number; y: number; movedAt: number; facing: Facing8 }>();
  /**
   * Spell hold-to-confirm. Gale: aim line + range preview; Ward/Burst: charge telegraph.
   * Release casts; Esc / drag-off cancels; short tap still casts.
   */
  spellHold: {
    spellId: SpellId;
    fromKey: boolean;
    pointerId: number | null;
    startMs: number;
    aimX: number;
    aimY: number;
    aimed: boolean;
    btnEl: HTMLElement | null;
    onMove: ((e: PointerEvent) => void) | null;
    onUp: ((e: PointerEvent) => void) | null;
  } | null = null;
  /** Portal / exit travel charge — must hold to completion. */
  portalHold: {
    target: any;
    fromKey: boolean;
    pointerId: number | null;
    startMs: number;
    completed: boolean;
    onUp: ((e: PointerEvent) => void) | null;
  } | null = null;
  /** Active stacked damage floats keyed by target id ("you" for self). */
  dmgStacks = new Map<
    string,
    {
      text: Phaser.GameObjects.Text;
      amount: number;
      count: number;
      lastAt: number;
      isPlayer: boolean;
      baseY: number;
      baseX: number;
    }
  >();
  /** True while websocket is down — local player rendered dim / ghost. */
  netOffline = false;
  /** Last foe we damaged — Gale briefly prefers them when aiming. */
  lastHitFoe: { id: string; until: number } | null = null;
  /** Reused floating damage Text objects. */
  dmgPool: Phaser.GameObjects.Text[] = [];
  /** Epoch ms until which death etch/fade should not retrigger. */
  deathFxUntil = 0;
  /** Entrance beacon after revive — world pos + expiry (animT ms). */
  respawnBeaconUntil = 0;
  respawnBeaconPos: { x: number; y: number } | null = null;
  /** Soft ash trail corpse → entrance after death. */
  deathAshTrail: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    start: number;
    until: number;
  } | null = null;
  /** Corpse world pos captured at death (before snap to entrance). */
  deathCorpsePos: { x: number; y: number } | null = null;
  /** Loot magnet sparks traveling loot→player after auto-pickup. */
  magnetSparks: {
    x0: number; y0: number; x1: number; y1: number;
    start: number; tint: number;
  }[] = [];
  /** When each loot id first entered magnet range (animT) — drives spine tick pop. */
  magnetEnteredAt = new Map<string, number>();
  /** Same-frame magnet enter batch — stagger flash start times. */
  magnetEnterBatchAt = -1;
  magnetEnterBatchCount = 0;
  /** Rift-shear pad desync active until animT (0 = idle). */
  riftShearUntil = 0;
  riftShearEscalate = false;
  /** Horizon-fold depth-sort flicker active until animT (0 = idle). */
  horizonFoldUntil = 0;
  /** Tiny gold trail chip → newly locked Gale sticky target. */
  stickyGoldTrails: {
    x0: number; y0: number; x1: number; y1: number;
    start: number; until: number;
  }[] = [];
  /** Judge countdown disc shatter FX (screen space). */
  judgeDiscShatter: {
    sx: number; sy: number; start: number; until: number;
  }[] = [];
  /** Spine ripple start times keyed by loot tower spine key. */
  magnetSpineRippleAt = new Map<string, number>();
  /**
   * Sticky edge chip hit zone for tap/hold retarget (screen space, last frame).
   * Tap → nearest threat; hold → cycle threat arrows one-by-one.
   */
  stickyChipHit: {
    sx: number;
    sy: number;
    r: number;
    threatIds: string[];
  } | null = null;
  /** Active sticky-chip hold cycle (pointer tracking). */
  stickyHold: {
    pointerId: number;
    startMs: number;
    lastCycleMs: number;
    index: number;
    threatIds: string[];
    cycled: boolean;
    onUp: ((e: PointerEvent) => void) | null;
  } | null = null;
  /** Highlighted threat-arrow index while hold-cycling (−1 = none). */
  stickyActiveThreatIndex = -1;
  /** Last animT we puffed Judge telegraph dust under the player. */
  lastJudgeTeleDustAt = 0;

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
      this.keys.ONE.on("down", () => this.beginSpellHold("gale_bolt", { fromKey: true }));
      this.keys.ONE.on("up", () => this.releaseSpellHold(true));
      this.keys.TWO.on("down", () => this.beginSpellHold("whirl_ward", { fromKey: true }));
      this.keys.TWO.on("up", () => this.releaseSpellHold(true));
      this.keys.THREE.on("down", () => this.beginSpellHold("infernal_burst", { fromKey: true }));
      this.keys.THREE.on("up", () => this.releaseSpellHold(true));
      const esc = kb.addKey("ESC");
      esc.on("down", () => {
        this.cancelSpellHold();
        this.cancelPortalHold();
      });
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
      // Sticky chip: tap nearest / hold to cycle threat arrows
      if (this.tryStickyChipPointerDown(sx, sy, pointer.id)) return;
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
          if (hit.kind === "exit" || hit.poiKind === "portal") {
            this.beginPortalHold(hit, { fromKey: false, pointerId: pointer.id });
          } else {
            this.doInteract(hit);
          }
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
      onSpellHoldStart: (spellId, ev) =>
        this.beginSpellHold(spellId, { fromKey: false, pointer: ev }),
      onSpellHoldMove: (_spellId, ev) => this.updateSpellHoldPointer(ev),
      onSpellHoldEnd: (_spellId, ev, cast) => {
        if (!cast) this.cancelSpellHold();
        else this.releaseSpellHold(true, ev);
      },
      onInteractHoldStart: (ev) => this.beginInteractHold(ev),
      onInteractHoldEnd: (ev, completed) => this.endInteractHold(ev, completed),
    });
  }

  castSpell(spellId: SpellId, opts?: { aimX?: number; aimY?: number; preferNearest?: boolean }) {
    if (!this.room) return;
    if (this.pendingCast) return;
    const def = SPELLS[spellId];
    if (!def) return;
    const mana = Number(this.room.you?.mana) || 0;
    if (mana < def.manaCost) {
      flashManaDeny(spellId);
      showToast(`Not enough mana for ${def.name} (${def.manaCost})`, "warn");
      return;
    }
    // Prefer aim toward nearest foe when casting gale (tap / no override)
    let ax = opts?.aimX ?? this.aimX;
    let ay = opts?.aimY ?? this.aimY;
    const preferNearest = opts?.preferNearest !== false && opts?.aimX == null;
    if (spellId === "gale_bolt" && preferNearest) {
      const dir = this.pickGaleAimDir();
      ax = dir.x;
      ay = dir.y;
      const f = facing8FromWorldVel(ax, ay, 0.01);
      if (f) this.facing8 = f;
    }
    const len = Math.hypot(ax, ay) || 1;
    this.aimX = ax / len;
    this.aimY = ay / len;
    if (spellId === "gale_bolt") {
      const f = facing8FromWorldVel(this.aimX, this.aimY, 0.01);
      if (f) this.facing8 = f;
    }
    const wind = SPELL_TELEGRAPH_MS[spellId] ?? 220;
    this.pendingCast = {
      spellId,
      aimX: this.aimX,
      aimY: this.aimY,
      start: this.animT,
      until: this.animT + wind,
    };
  }

  /** Seed gale aim toward last-hit foe (sticky) else nearest foe (or facing). */
  private nearestGaleAim(): { x: number; y: number } {
    return this.pickGaleAimDir();
  }

  /** Soft sticky: briefly prefer last-hit foe if still in/near Gale range. */
  private pickGaleAimDir(): { x: number; y: number } {
    const you = this.youPos();
    const stickyId =
      this.lastHitFoe && this.animT < this.lastHitFoe.until ? this.lastHitFoe.id : null;
    let stickyDir: { x: number; y: number } | null = null;
    let stickyD = 99;
    let best: { x: number; y: number } | null = null;
    let bestD = GALE_RANGE;
    if (this.room) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob" && e.kind !== "boss") continue;
        const pos = this.entityRenderPos(e);
        const dx = pos.x - you.x;
        const dy = pos.y - you.y;
        const d = Math.hypot(dx, dy);
        if (stickyId && String(e.id) === stickyId && d < GALE_RANGE * 1.2) {
          stickyDir = { x: dx, y: dy };
          stickyD = d;
        }
        if (d < bestD) {
          bestD = d;
          best = { x: dx, y: dy };
        }
      }
    }
    // Prefer sticky unless another foe is much closer (in melee)
    const use = stickyDir && !(best && bestD < 2.2 && stickyD > bestD + 1.4) ? stickyDir : best;
    if (use) {
      const len = Math.hypot(use.x, use.y) || 1;
      return { x: use.x / len, y: use.y / len };
    }
    const len = Math.hypot(this.aimX, this.aimY) || 1;
    return { x: this.aimX / len, y: this.aimY / len };
  }

  beginSpellHold(spellId: SpellId, o: { fromKey: boolean; pointer?: PointerEvent }) {
    if (!this.room || this.pendingCast) return;
    if (this.spellHold) this.cancelSpellHold();
    const seed = spellId === "gale_bolt" ? this.nearestGaleAim() : { x: this.aimX, y: this.aimY };
    const len = Math.hypot(seed.x, seed.y) || 1;
    const btn = document.getElementById(`btn-spell-${spellId}`);
    this.spellHold = {
      spellId,
      fromKey: o.fromKey,
      pointerId: o.pointer?.pointerId ?? null,
      startMs: performance.now(),
      aimX: seed.x / len,
      aimY: seed.y / len,
      aimed: false,
      btnEl: btn,
      onMove: null,
      onUp: null,
    };
    btn?.classList.add("aiming");
    if (!o.fromKey && o.pointer) {
      const onMove = (e: PointerEvent) => this.updateSpellHoldPointer(e);
      const onUp = (e: PointerEvent) => {
        if (this.spellHold?.pointerId != null && e.pointerId !== this.spellHold.pointerId) return;
        this.releaseSpellHold(true, e);
      };
      this.spellHold.onMove = onMove;
      this.spellHold.onUp = onUp;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }
  }

  updateSpellHoldPointer(ev: PointerEvent) {
    const g = this.spellHold;
    if (!g || g.fromKey) return;
    if (g.pointerId != null && ev.pointerId !== g.pointerId) return;
    // Drag-off cancel: left the button without locking Gale aim / without hold confirm
    if (g.btnEl) {
      const r = g.btnEl.getBoundingClientRect();
      const pad = 10;
      const inside =
        ev.clientX >= r.left - pad &&
        ev.clientX <= r.right + pad &&
        ev.clientY >= r.top - pad &&
        ev.clientY <= r.bottom + pad;
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const drag = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      if (g.spellId === "gale_bolt") {
        if (!g.aimed && !inside && drag < GALE_DRAG_AIM_PX) {
          this.cancelSpellHold();
          return;
        }
        if (drag >= GALE_DRAG_AIM_PX) g.aimed = true;
      } else if (!inside) {
        // Ward / Burst: leaving the button cancels
        this.cancelSpellHold();
        return;
      }
    }
    if (g.spellId === "gale_bolt") this.setGaleAimFromClient(ev.clientX, ev.clientY);
  }

  /** Aim gale from screen client coords → world direction from player. */
  private setGaleAimFromClient(clientX: number, clientY: number) {
    if (!this.spellHold || this.spellHold.spellId !== "gale_bolt") return;
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const px = ((clientX - rect.left) / rect.width) * this.scale.width;
    const py = ((clientY - rect.top) / rect.height) * this.scale.height;
    const worldPt = this.cameras.main.getWorldPoint(px, py);
    const w = screenToWorld(worldPt.x, worldPt.y);
    const you = this.youPos();
    let ax = w.x - you.x;
    let ay = w.y - you.y;
    const len = Math.hypot(ax, ay);
    if (len < 0.15) return;
    this.spellHold.aimX = ax / len;
    this.spellHold.aimY = ay / len;
    this.spellHold.aimed = true;
    const f = facing8FromWorldVel(this.spellHold.aimX, this.spellHold.aimY, 0.01);
    if (f) this.facing8 = f;
  }

  /** While key-hold aiming Gale, track mouse over the canvas. */
  private tickSpellKeyAim() {
    const g = this.spellHold;
    if (!g || !g.fromKey) return;
    if (g.spellId !== "gale_bolt") return;
    const ptr = this.input.activePointer;
    if (!ptr) return;
    const heldLong = performance.now() - g.startMs >= SPELL_HOLD_CONFIRM_MS;
    if (!heldLong) return;
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + (ptr.x / this.scale.width) * rect.width;
    const clientY = rect.top + (ptr.y / this.scale.height) * rect.height;
    this.setGaleAimFromClient(clientX, clientY);
  }

  releaseSpellHold(cast: boolean, ev?: PointerEvent) {
    const g = this.spellHold;
    if (!g) return;
    if (ev && g.pointerId != null && ev.pointerId !== g.pointerId) return;
    const heldMs = performance.now() - g.startMs;
    const spellId = g.spellId;
    const aimX = g.aimX;
    const aimY = g.aimY;
    const aimed = g.aimed || heldMs >= SPELL_HOLD_CONFIRM_MS;
    const btnId = `btn-spell-${spellId}`;
    this.clearSpellHoldListeners();
    this.spellHold = null;
    document.getElementById(btnId)?.classList.remove("aiming");
    if (!cast) return;
    if (spellId === "gale_bolt" && heldMs >= GALE_HOLD_TOAST_MS && heldMs < SPELL_HOLD_CONFIRM_MS) {
      showToast("Gale loosed", "info");
    }
    if (spellId === "gale_bolt") {
      if (aimed) this.castSpell("gale_bolt", { aimX, aimY, preferNearest: false });
      else this.castSpell("gale_bolt", { preferNearest: true });
    } else {
      this.castSpell(spellId);
    }
  }

  cancelSpellHold() {
    if (!this.spellHold) return;
    const heldMs = performance.now() - this.spellHold.startMs;
    const spellId = this.spellHold.spellId;
    const btnId = `btn-spell-${spellId}`;
    this.clearSpellHoldListeners();
    this.spellHold = null;
    document.getElementById(btnId)?.classList.remove("aiming", "pressed");
    // Esc / drag-off: brief red-rim flash then restore idle chrome
    flashSpellCancel(spellId);
    if (spellId === "gale_bolt" && heldMs >= GALE_HOLD_TOAST_MS) {
      showToast("Gale cancelled", "info");
    }
  }

  private clearSpellHoldListeners() {
    const g = this.spellHold;
    if (!g) return;
    if (g.onMove) window.removeEventListener("pointermove", g.onMove);
    if (g.onUp) {
      window.removeEventListener("pointerup", g.onUp);
      window.removeEventListener("pointercancel", g.onUp);
    }
  }

  /** True when nearest interactable is a portal / exit that needs hold-to-travel. */
  private nearestIsPortalTravel(): any | null {
    if (!this.room) return null;
    const you = this.youPos();
    let best: any = null;
    let bestD = EXIT_TRAVEL_RANGE;
    for (const e of this.room.entities) {
      if (e.kind !== "exit" && !(e.kind === "poi" && e.poiKind === "portal")) continue;
      const pos = this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  beginInteractHold(ev?: PointerEvent) {
    const portal = this.nearestIsPortalTravel();
    if (portal) {
      this.beginPortalHold(portal, { fromKey: false, pointer: ev });
      return;
    }
    // Non-portal: fire immediately on press (no charge ring)
    document.getElementById("btn-interact")?.classList.remove("charging");
    this.interactNearest();
  }

  endInteractHold(_ev: PointerEvent, completed: boolean) {
    const ph = this.portalHold;
    if (!ph || ph.fromKey) {
      document.getElementById("btn-interact")?.classList.remove("charging");
      return;
    }
    if (!completed || !ph.completed) {
      this.cancelPortalHold();
      return;
    }
    // Charge already finished in tickPortalHold — just clear CSS
    document.getElementById("btn-interact")?.classList.remove("charging");
  }

  beginPortalHold(
    target: any,
    o: { fromKey: boolean; pointer?: PointerEvent; pointerId?: number }
  ) {
    if (!target) return;
    if (this.portalHold) this.cancelPortalHold();
    this.portalHold = {
      target,
      fromKey: o.fromKey,
      pointerId: o.pointer?.pointerId ?? o.pointerId ?? null,
      startMs: performance.now(),
      completed: false,
      onUp: null,
    };
    document.getElementById("btn-interact")?.classList.add("charging");
    // Cancel if finger/mouse released before charge completes (Interact btn + world tap)
    if (!o.fromKey) {
      const onUp = (e: PointerEvent) => {
        const ph = this.portalHold;
        if (!ph || ph.fromKey) return;
        if (ph.pointerId != null && e.pointerId !== ph.pointerId) return;
        if (!ph.completed) this.cancelPortalHold();
      };
      this.portalHold.onUp = onUp;
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }
  }

  cancelPortalHold() {
    if (!this.portalHold) return;
    const onUp = this.portalHold.onUp;
    if (onUp) {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }
    this.portalHold = null;
    document.getElementById("btn-interact")?.classList.remove("charging");
  }

  /** Advance portal charge; travel when full. */
  private tickPortalHold() {
    const ph = this.portalHold;
    if (!ph || ph.completed) return;
    // Key hold: cancel if E released early
    if (ph.fromKey && this.keys && !this.keys.E.isDown) {
      this.cancelPortalHold();
      return;
    }
    const held = performance.now() - ph.startMs;
    if (held < PORTAL_HOLD_MS) return;
    ph.completed = true;
    hapticPortalComplete();
    const dest =
      ph.target.toCanto === "inferno_05"
        ? "Lust"
        : ph.target.label || ph.target.name || "portal";
    showToast(`Entering ${dest}…`, "emit");
    const target = ph.target;
    // Clear hold (and pointer listeners) before travel
    this.cancelPortalHold();
    this.doInteract(target);
  }

  /** Fire the pending cast once the telegraph windup completes. */
  private resolvePendingCast() {
    const pc = this.pendingCast;
    if (!pc || !this.room) return;
    if (this.animT < pc.until) return;
    this.pendingCast = null;
    const spellId = pc.spellId;
    const def = SPELLS[spellId];
    if (!def) return;
    this.aimX = pc.aimX;
    this.aimY = pc.aimY;
    this.socket.cast(spellId, { x: this.aimX, y: this.aimY });
    noteSpellCast(spellId, def.cooldown);
    // Optimistic cast flash matching spell color
    if (spellId === "whirl_ward") {
      this.punch("you", { dur: 300, punch: 0.12, tint: 0xffe8a0, ox: 0, oy: -5 });
      this.cameras.main.flash(70, 232, 200, 106, false);
    } else if (spellId === "infernal_burst") {
      this.punch("you", { dur: 360, punch: 0.22, tint: 0xff5533, ox: 0, oy: -8 });
      this.cameras.main.flash(90, 255, 80, 40, false);
      this.cameraPunch(0.05, 260);
    } else {
      // Gale — ember-gold bolt flash
      this.punch("you", {
        dur: 200,
        punch: 0.14,
        tint: 0xffd078,
        ox: facing8IsLeft(this.facing8) ? -7 : 7,
        oy: -5,
      });
      this.cameras.main.flash(55, 255, 180, 90, false);
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
      this.beginTravelFade();
      this.time.delayedCall(50, () => this.socket.travel(hit.toCanto));
    }
    if (hit.poiKind === "portal" && hit.toCanto) {
      this.beginTravelFade();
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
        const pos = e.kind === "loot" ? this.lootRenderPos(e) : this.entityRenderPos(e);
        const d = Math.hypot(pos.x - you.x, pos.y - you.y);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
    }
    if (!best) {
      showToast("Nothing nearby — walk closer to a portal, NPC, or loot", "warn");
      return;
    }
    if (best.kind === "loot") {
      const name = best.item?.name || "loot";
      showToast(`Picking up ${name}`, "loot");
      this.socket.pickup(best.id);
    } else if (best.kind === "exit" || best.poiKind === "portal") {
      const dest =
        best.toCanto === "inferno_05"
          ? "Lust"
          : best.label || best.name || "portal";
      showToast(`Entering ${dest}…`, "emit");
      this.doInteract(best);
    } else if (best.poiKind === "ah") {
      showToast("Opening Auction House", "info");
      this.doInteract(best);
    } else {
      showToast(`Interact: ${best.label || best.name || "object"}`, "info");
      this.doInteract(best);
    }
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
      if (!opts?.silent) {
        showToast("No foe in range", "warn");
        resetCombo();
      }
      return;
    }
    this.sendAttack(best.id);
  }

  /** Send attack with brief wind-up, swipe arc, and recovery (less spammy). */
  sendAttack(targetId: string) {
    const now = Date.now();
    if (now < this.attackBusyUntil) return;
    const busyMs = ATTACK_WINDUP_MS + ATTACK_RECOVERY_MS;
    this.attackBusyUntil = now + busyMs;
    noteAttackCd(busyMs / 1000);
    this.swipeFx = {
      start: this.animT,
      until: this.animT + ATTACK_SWIPE_MS,
      dir: facing8IsLeft(this.facing8) ? -1 : 1,
    };
    // Wind-up lean + gold tint, then strike punch
    this.punch("you", {
      dur: ATTACK_WINDUP_MS + 50,
      punch: 0.26,
      tint: 0xffe8a0,
      ox: facing8IsLeft(this.facing8) ? -10 : 10,
      oy: -6,
    });
    this.time.delayedCall(ATTACK_WINDUP_MS, () => {
      this.socket.attack(targetId);
      this.punch("you", {
        dur: 160,
        punch: 0.16,
        tint: 0xfff6d0,
        ox: facing8IsLeft(this.facing8) ? -8 : 8,
        oy: -3,
      });
    });
  }

  /** Brief wall-clock freeze so hits read as weighted. */
  triggerHitStop(ms = HIT_STOP_MS) {
    if (this.hitStopActive) return;
    this.hitStopActive = true;
    this.time.timeScale = 0.12;
    this.tweens.timeScale = 0.12;
    window.setTimeout(() => {
      this.time.timeScale = 1;
      this.tweens.timeScale = 1;
      this.hitStopActive = false;
    }, ms);
  }

  /** Quick zoom punch (Burst / heavy hit) — restores to current zoom. */
  cameraPunch(amount = 0.035, dur = 160) {
    const cam = this.cameras.main;
    const z0 = cam.zoom;
    cam.setZoom(z0 * (1 + amount));
    this.tweens.add({
      targets: cam,
      zoom: z0,
      duration: dur,
      ease: "Cubic.easeOut",
    });
  }

  /** Soft zoom breathe in→out (combo ×200 abyss) — gentler than a punch. */
  cameraBreathe(amount = 0.045, dur = 520) {
    const cam = this.cameras.main;
    const z0 = cam.zoom;
    this.tweens.add({
      targets: cam,
      zoom: z0 * (1 + amount),
      duration: Math.max(80, dur * 0.38),
      ease: "Sine.easeInOut",
      yoyo: true,
      onComplete: () => {
        cam.setZoom(z0);
      },
    });
  }

  /** Rift-shear foe pad desync amplitude in px (0 when idle). */
  private riftShearPadDesync(): number {
    if (this.animT >= this.riftShearUntil) return 0;
    const dur = this.riftShearEscalate ? RIFT_SHEAR_MAX_MS : RIFT_SHEAR_MS;
    const left = this.riftShearUntil - this.animT;
    const life = Math.max(0, Math.min(1, left / Math.max(1, dur)));
    const wobble = 0.55 + 0.45 * Math.sin(this.animT * 0.09);
    const amp = (this.riftShearEscalate ? 5.5 : 3.6) * life * wobble;
    return amp;
  }

  /** Horizon-fold depth-sort flicker offset (0 when idle). */
  private horizonFoldDepthFlicker(seed: number): number {
    if (this.animT >= this.horizonFoldUntil) return 0;
    const left = this.horizonFoldUntil - this.animT;
    const life = Math.max(0, Math.min(1, left / HORIZON_FOLD_MS));
    // Rapid sign-flip so overlapping sprites briefly swap draw order
    const flip = Math.sin(this.animT * 0.22 + seed * 2.7) > 0 ? 1 : -1;
    const jitter = Math.sin(this.animT * 0.41 + seed) * 0.55;
    return (1.8 + jitter) * flip * life * life;
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
        this.noteNewInventoryLoot(msg.room.you);

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
          this.lastHitFoe = null;
          this.seenInvItemIds.clear();
          resetCombo();
          this.centerOnYou(true);
          if (cantoChanged) this.playTravelTransition();
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
      case "net":
        if (msg.state === "disconnected") {
          this.netOffline = true;
          showToast("Connection lost — reconnecting…", "warn");
        } else if (msg.state === "reconnected") {
          this.netOffline = false;
          showToast("Reconnected", "info");
        }
        break;
      case "toast": {
        const text = String(msg.text || "");
        showToast(text, msg.level);
        if (isComboMissToast(text)) resetCombo();
        if (/slain/i.test(text)) this.triggerDeathRevive();
        break;
      }
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
          this.punch("you", { dur: 220, punch: -0.08, tint: 0xff7a6a, ox: (Math.random() - 0.5) * 10, oy: 3 });
          this.cameras.main.shake(120, isCompactUi() ? 0.007 : 0.005);
          this.cameras.main.flash(90, 160, 24, 24, false);
          this.triggerHitStop(HIT_STOP_MS);
          this.cameraPunch(0.028, 140);
          this.showPlayerDamageNumber(msg.damage);
          const soaked = Number(msg.soaked) || 0;
          if (soaked > 0 && msg.wardActive) {
            flashWardSoak();
            this.showWardSoakCrumb(soaked);
          }
          if (msg.targetHp != null && msg.targetHp <= 0) {
            this.cameras.main.shake(280, 0.014);
            this.triggerDeathRevive();
            resetCombo();
          }
          break;
        }
        const ent = this.room?.entities?.find((e: any) => String(e.id) === tid);
        const attacker = String(msg.attackerId ?? "");
        const weHit =
          Boolean(attacker) && (attacker === youId || attacker === sockId);
        if (weHit && ent && (ent.kind === "mob" || ent.kind === "boss")) {
          this.lastHitFoe = { id: String(ent.id), until: this.animT + GALE_STICKY_MS };
          const streak = noteComboHit();
          if (isComboMilestone(streak)) {
            // Short camera punch at ×5 / ×10 — no toast spam
            this.cameraPunch(streak >= 10 ? 0.055 : 0.04, streak >= 10 ? 220 : 170);
            this.cameras.main.shake(streak >= 10 ? 90 : 60, isCompactUi() ? 0.004 : 0.0028);
          }
          if (streak === 25 || (streak > 25 && streak % 25 === 0 && streak % 50 !== 0)) {
            // Soft vignette punch at ×25+ — no toast
            this.punchComboVignette();
            this.cameraPunch(0.06, 240);
            this.cameras.main.shake(100, isCompactUi() ? 0.0045 : 0.003);
          }
          if (streak === 50 || (streak > 50 && streak % 50 === 0 && streak % 75 !== 0)) {
            // Inferno pip milestone — stronger vignette, still no toast
            this.punchComboVignette();
            this.cameraPunch(0.075, 280);
            this.cameras.main.shake(120, isCompactUi() ? 0.0055 : 0.0038);
          }
          if (isComboInfernoFringe(streak) && (streak === 75 || streak % 75 === 0) && streak < 100) {
            // ×75+ inferno fringe / heat haze — still no toast
            this.punchComboVignette();
            this.cameraPunch(0.09, 320);
            this.cameras.main.shake(140, isCompactUi() ? 0.0065 : 0.0045);
          }
          if (isComboEclipse(streak) && (streak === 100 || streak % 100 === 0) && streak < 150) {
            // ×100 eclipse pip + brief world ember drift — still no toast
            this.punchComboVignette();
            this.cameraPunch(0.11, 360);
            this.cameras.main.shake(160, isCompactUi() ? 0.0075 : 0.005);
            spawnEclipseEmberDrift(
              this.particles,
              this.renderYou.x,
              this.renderYou.y,
              isCompactUi()
            );
          }
          if (isComboVoidCorona(streak) && (streak === 150 || streak % 150 === 0) && streak < 200) {
            // ×150 void corona — brief screen desat pulse, no toast
            this.punchComboVignette();
            this.cameraPunch(0.13, 400);
            this.cameras.main.shake(180, isCompactUi() ? 0.0085 : 0.0055);
            pulseVoidCorona();
            spawnEclipseEmberDrift(
              this.particles,
              this.renderYou.x,
              this.renderYou.y,
              isCompactUi()
            );
          }
          if (isComboAbyss(streak) && (streak === 200 || (streak > 200 && streak % 200 === 0))) {
            // ×200 abyss — brief chroma fringe + camera breathe, no toast
            this.punchComboVignette();
            this.cameraBreathe(0.055, 560);
            this.cameras.main.shake(120, isCompactUi() ? 0.0055 : 0.0038);
            pulseAbyssChroma();
            spawnEclipseEmberDrift(
              this.particles,
              this.renderYou.x,
              this.renderYou.y,
              isCompactUi()
            );
          }
          if (isComboRiftShear(streak) && (streak === 250 || (streak > 250 && streak % 250 === 0 && !isComboRiftShearMax(streak)))) {
            // ×250 rift shear — brief screen tear + foe pad desync, no toast
            this.punchComboVignette();
            this.cameraPunch(0.08, 280);
            this.cameras.main.shake(160, isCompactUi() ? 0.007 : 0.0048);
            pulseRiftShear(false);
            this.riftShearUntil = this.animT + RIFT_SHEAR_MS;
            this.riftShearEscalate = false;
            spawnEclipseEmberDrift(
              this.particles,
              this.renderYou.x,
              this.renderYou.y,
              isCompactUi()
            );
          }
          if (isComboRiftShearMax(streak) && (streak === 300 || streak % 300 === 0)) {
            // ×300 rift shear escalate — stronger tear / desync, still no toast
            this.punchComboVignette();
            this.cameraPunch(0.1, 340);
            this.cameras.main.shake(200, isCompactUi() ? 0.0085 : 0.006);
            pulseRiftShear(true);
            this.riftShearUntil = this.animT + RIFT_SHEAR_MAX_MS;
            this.riftShearEscalate = true;
            spawnEclipseEmberDrift(
              this.particles,
              this.renderYou.x,
              this.renderYou.y,
              isCompactUi()
            );
          }
          if (isComboHorizonFold(streak) && (streak === 350 || (streak > 350 && streak % 350 === 0))) {
            // ×350 horizon fold — brief letterbox + depth-sort flicker, no toast
            this.punchComboVignette();
            this.cameraPunch(0.09, 300);
            this.cameras.main.shake(170, isCompactUi() ? 0.0075 : 0.0052);
            pulseHorizonFold();
            this.horizonFoldUntil = this.animT + HORIZON_FOLD_MS;
            spawnEclipseEmberDrift(
              this.particles,
              this.renderYou.x,
              this.renderYou.y,
              isCompactUi()
            );
          }
        }
        if (ent) {
          const sid = `${ent.kind}:${ent.id}`;
          // Foe flinch: crimson-white tint + punch + knockback + hit-stop
          const away = Math.sign(ent.x + ent.y - (this.renderYou.x + this.renderYou.y)) || 1;
          this.punch(sid, {
            dur: 260,
            punch: ent.kind === "boss" ? 0.18 : 0.38,
            tint: 0xffccaa,
            ox: away * (8 + Math.random() * 10) * (facing8IsLeft(this.facing8) ? -1 : 1),
            oy: -8 - Math.random() * 7,
          });
          spawnHitBurst(this.particles, ent.x, ent.y);
          this.cameras.main.shake(85, isCompactUi() ? 0.0045 : 0.0032);
          this.triggerHitStop(ent.kind === "boss" ? HIT_STOP_KILL_MS : HIT_STOP_MS);
          this.cameraPunch(ent.kind === "boss" ? 0.04 : 0.03, 150);
          this.showDamageNumber(ent, msg.damage);
        }
        break;
      }
      case "spell_fx": {
        this.onSpellFx(msg);
        break;
      }
      case "boss_telegraph": {
        const id = String(msg.id || msg.attackerId || "");
        const x = Number(msg.x) || 0;
        const y = Number(msg.y) || 0;
        const radius = Number(msg.radius) || 2.6;
        const durMs = (Number(msg.duration) || 1.4) * 1000;
        this.bossTelegraphs = this.bossTelegraphs.filter((t) => t.id !== id);
        this.bossTelegraphs.push({
          id,
          x,
          y,
          radius,
          start: this.animT,
          until: this.animT + durMs,
        });
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
          spawnDissolveAsh(this.particles, pos.x, pos.y, boss);
          if (boss) spawnDissolveAsh(this.particles, pos.x, pos.y, true);
          this.killFx.push({ sx: p.sx, sy: p.sy, start: this.animT, boss });
          this.ghostFadeSprite(`${ent.kind}:${ent.id}`, boss);
          this.triggerHitStop(HIT_STOP_KILL_MS);
          this.cameraPunch(boss ? 0.09 : 0.04, boss ? 420 : 200);
          this.cameras.main.shake(boss ? 480 : 180, boss ? 0.022 : 0.008);
          if (boss) this.cameras.main.flash(360, 201, 162, 39, false);
          else this.cameras.main.flash(80, 140, 70, 35, false);
          this.bossTelegraphs = this.bossTelegraphs.filter((t) => t.id !== String(ent.id));
          if (this.lastHitFoe && this.lastHitFoe.id === String(ent.id)) this.lastHitFoe = null;
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
    ghost.setAlpha(0.95);
    ghost.setBlendMode(Phaser.BlendModes.ADD);
    // Crimson lift + stretch, then a second bone ash twin that drifts apart
    const fadeMs = boss ? BOSS_KILL_FX_MS : KILL_FX_MS;
    this.tweens.add({
      targets: ghost,
      alpha: 0,
      y: ghost.y - (boss ? 58 : 28),
      scaleX: ghost.scaleX * (boss ? 1.55 : 1.35),
      scaleY: ghost.scaleY * (boss ? 1.85 : 1.6),
      duration: fadeMs,
      ease: "Cubic.easeOut",
      onComplete: () => ghost.destroy(),
    });
    const ash = this.add.image(src.x, src.y, src.texture.key);
    ash.setOrigin(src.originX, src.originY);
    ash.setScale(src.scaleX * 0.95, src.scaleY * 0.95);
    ash.setFlipX(src.flipX);
    ash.setDepth(src.depth + 0.4);
    ash.setTint(0xd9cfae);
    ash.setAlpha(boss ? 0.85 : 0.7);
    this.tweens.add({
      targets: ash,
      alpha: 0,
      y: ash.y - (boss ? 28 : 12),
      x: ash.x + (Math.random() - 0.5) * (boss ? 28 : 18),
      scaleX: ash.scaleX * (boss ? 0.55 : 0.7),
      scaleY: ash.scaleY * (boss ? 1.35 : 1.15),
      duration: fadeMs + (boss ? 160 : 80),
      ease: "Quad.easeIn",
      onComplete: () => ash.destroy(),
    });
    if (boss) {
      // Third gold afterimage for Judge — heavier dissolve beat
      const gold = this.add.image(src.x, src.y, src.texture.key);
      gold.setOrigin(src.originX, src.originY);
      gold.setScale(src.scaleX * 1.05, src.scaleY * 1.05);
      gold.setFlipX(src.flipX);
      gold.setDepth(src.depth + 0.55);
      gold.setTint(0xc9a227);
      gold.setAlpha(0.75);
      gold.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: gold,
        alpha: 0,
        y: gold.y - 72,
        scaleX: gold.scaleX * 1.7,
        scaleY: gold.scaleY * 2.1,
        duration: fadeMs + 120,
        ease: "Cubic.easeOut",
        onComplete: () => gold.destroy(),
      });
    }
  }

  /** Keep the vignette glued to the camera view at any zoom / resize. */
  layoutVignette() {
    if (!this.vignette) return;
    const cam = this.cameras.main;
    const z = Math.max(0.05, cam.zoom);
    this.vignette.setDisplaySize((cam.width / z) * 1.02, (cam.height / z) * 1.02);
    this.vignette.setPosition(cam.scrollX + cam.width * 0.5, cam.scrollY + cam.height * 0.5);
    // Soft travel / combo flash: briefly deepen vignette while animT is inside the window
    const base = 0.84;
    let alpha = base;
    if (this.travelVignetteUntil > this.animT && this.travelVignettePeak > 0) {
      const left = this.travelVignetteUntil - this.animT;
      const pulse = Math.min(1, left / 400);
      alpha = base + (this.travelVignettePeak - base) * pulse * 0.5;
    }
    if (this.comboVignetteUntil > this.animT && this.comboVignettePeak > 0) {
      const left = this.comboVignetteUntil - this.animT;
      const pulse = Math.min(1, left / (COMBO_VIGNETTE_MS * 0.55));
      const comboA = base + (this.comboVignettePeak - base) * pulse * 0.55;
      alpha = Math.max(alpha, comboA);
    }
    if (alpha !== base || this.travelVignetteUntil > this.animT || this.comboVignetteUntil > this.animT) {
      this.vignette.setAlpha(alpha);
    }
  }

  /** Soft vignette punch at combo ×25+ (no toast). */
  punchComboVignette() {
    this.comboVignetteUntil = this.animT + COMBO_VIGNETTE_MS;
    this.comboVignettePeak = COMBO_VIGNETTE_PEAK;
    if (!this.vignette) return;
    const base = 0.84;
    this.tweens.add({
      targets: this.vignette,
      alpha: Math.min(1, Math.max(base, COMBO_VIGNETTE_PEAK)),
      duration: 110,
      yoyo: true,
      hold: 70,
      ease: "Sine.easeInOut",
      onComplete: () => {
        if (this.vignette && this.comboVignetteUntil <= this.animT) {
          this.vignette.setAlpha(base);
        }
      },
    });
  }

  /** Soft room fade + vignette punch when changing cantos. */
  playTravelTransition() {
    this.cameras.main.fadeIn(520, 6, 4, 10);
    this.travelVignetteUntil = this.animT + 700;
    this.travelVignettePeak = TRAVEL_VIGNETTE_PEAK;
    if (this.vignette) {
      const base = Number(this.vignette.alpha) || 0.84;
      this.tweens.add({
        targets: this.vignette,
        alpha: Math.min(1, Math.max(base, TRAVEL_VIGNETTE_PEAK)),
        duration: 140,
        yoyo: true,
        hold: 90,
        ease: "Sine.easeInOut",
        onComplete: () => {
          if (this.vignette) this.vignette.setAlpha(base);
        },
      });
    }
  }

  /** Brief fade-out when stepping into a portal (before the next snapshot). */
  beginTravelFade() {
    this.cameras.main.fadeOut(160, 4, 2, 6);
    this.travelVignetteUntil = this.animT + 400;
    this.travelVignettePeak = TRAVEL_VIGNETTE_PEAK;
  }

  /** Acquire a pooled floating damage Text (or create one). */
  private acquireDmgText(): Phaser.GameObjects.Text {
    const t = this.dmgPool.pop();
    if (t) {
      t.setActive(true).setVisible(true).setAlpha(1).setScale(1);
      return t;
    }
    return this.add
      .text(0, 0, "", {
        fontFamily: "Georgia, serif",
        fontSize: "24px",
        fontStyle: "bold",
        color: "#ffe08a",
        stroke: "#1a0a06",
        strokeThickness: 7,
        shadow: { offsetX: 0, offsetY: 3, color: "#000", blur: 8, fill: true },
      })
      .setOrigin(0.5)
      .setDepth(9500);
  }

  private releaseDmgText(t: Phaser.GameObjects.Text) {
    this.tweens.killTweensOf(t);
    t.setVisible(false).setActive(false).setAlpha(1).setScale(1);
    if (this.dmgPool.length < DMG_POOL_MAX) this.dmgPool.push(t);
    else t.destroy();
  }

  /** Crimson float above local player — camera-locked so flash/shake cannot hide it. */
  showPlayerDamageNumber(dmg: number) {
    if (dmg == null) return;
    this.pushStackedDamage("you", dmg, true);
  }

  /** Tiny gold "−X" crumb when Ward soaks damage (not a full damage float). */
  showWardSoakCrumb(soaked: number) {
    const n = Math.max(1, Math.round(Number(soaked) || 0));
    const compact = isCompactUi();
    const t = this.acquireDmgText();
    const cam = this.cameras.main;
    const world = worldToScreen(this.renderYou.x, this.renderYou.y);
    const sx = world.sx - cam.scrollX + (Math.random() - 0.5) * 10;
    const sy = world.sy - cam.scrollY - (compact ? 96 : 88);
    t.setText(`−${n}`)
      .setPosition(sx, sy)
      .setDepth(12050)
      .setScrollFactor(0)
      .setColor("#ffe8a0")
      .setStroke("#3a2a08", 4)
      .setFontSize(compact ? "18px" : "15px")
      .setScale(1.15)
      .setAlpha(1);
    this.tweens.add({
      targets: t,
      scale: 0.95,
      duration: 120,
      ease: "Back.easeOut",
    });
    this.tweens.add({
      targets: t,
      y: sy - (compact ? 36 : 28),
      alpha: 0,
      duration: 720,
      delay: 80,
      ease: "Cubic.easeOut",
      onComplete: () => this.releaseDmgText(t),
    });
  }

  /** Floating damage number (gold by default) — pooled Text + crit flash; stacks multi-hits. */
  showDamageNumber(
    ent: { x: number; y: number; kind: string; id?: string | number },
    dmg: number,
    o?: { color?: string; screen?: { sx: number; sy: number } }
  ) {
    if (dmg == null) return;
    const key = ent.id != null ? String(ent.id) : `anon:${ent.x},${ent.y}`;
    this.pushStackedDamage(key, dmg, false, ent, o);
  }

  /**
   * Merge rapid identical hits into e.g. 36×3. Different amounts start a fresh float.
   */
  private pushStackedDamage(
    key: string,
    dmg: number,
    isPlayer: boolean,
    ent?: { x: number; y: number; kind: string },
    o?: { color?: string; screen?: { sx: number; sy: number } }
  ) {
    const now = performance.now();
    const existing = this.dmgStacks.get(key);
    if (
      existing &&
      now - existing.lastAt < DMG_STACK_WINDOW_MS &&
      existing.amount === dmg &&
      existing.isPlayer === isPlayer
    ) {
      existing.count += 1;
      existing.lastAt = now;
      existing.text.setText(`${existing.amount}×${existing.count}`);
      // Punch the stack again (keep anchored to baseY so stacks don't drift)
      this.tweens.killTweensOf(existing.text);
      existing.text.setAlpha(1).setPosition(existing.baseX, existing.baseY);
      const crit = existing.amount * existing.count >= CRIT_DMG_FLASH || existing.amount >= CRIT_DMG_FLASH;
      existing.text.setScale(crit ? 1.55 : 1.35);
      this.tweens.add({
        targets: existing.text,
        scale: crit ? 1.15 : 1,
        duration: 140,
        ease: "Back.easeOut",
      });
      this.tweens.add({
        targets: existing.text,
        y: existing.baseY - (crit ? 56 : 48),
        alpha: 0,
        duration: crit ? 1000 : 880,
        delay: 160,
        ease: "Cubic.easeOut",
        onComplete: () => {
          this.dmgStacks.delete(key);
          this.releaseDmgText(existing.text);
        },
      });
      return;
    }
    if (existing) {
      this.tweens.killTweensOf(existing.text);
      this.dmgStacks.delete(key);
      this.releaseDmgText(existing.text);
    }

    const compact = isCompactUi();
    const crit = dmg >= CRIT_DMG_FLASH;
    const t = this.acquireDmgText();
    if (isPlayer) {
      const cam = this.cameras.main;
      const world = worldToScreen(this.renderYou.x, this.renderYou.y);
      const sx = world.sx - cam.scrollX + (Math.random() - 0.5) * 16;
      const sy = world.sy - cam.scrollY - 78;
      t.setText(String(dmg))
        .setPosition(sx, sy)
        .setDepth(12000)
        .setScrollFactor(0)
        .setColor(crit ? "#fff6e8" : "#ff7a68")
        .setStroke(crit ? "#4a1808" : "#2a0806", 7)
        .setFontSize(compact ? (crit ? "44px" : "38px") : crit ? "34px" : "28px")
        .setScale(crit ? 2.15 : 1.7);
      if (crit) this.cameras.main.flash(55, 255, 230, 180, false);
      this.tweens.add({
        targets: t,
        scale: crit ? 1.15 : 1,
        duration: crit ? 180 : 150,
        ease: "Back.easeOut",
      });
      this.tweens.add({
        targets: t,
        y: sy - (crit ? 72 : 60),
        alpha: 0,
        duration: crit ? 1100 : 980,
        delay: 130,
        ease: "Cubic.easeOut",
        onComplete: () => {
          this.dmgStacks.delete(key);
          this.releaseDmgText(t);
        },
      });
    } else {
      const e = ent!;
      let p = o?.screen;
      if (!p) {
        const pos = this.entityRenderPos(e as any);
        p = worldToScreen(pos.x, pos.y);
      }
      const drift = (Math.random() - 0.5) * 26;
      t.setText(String(dmg))
        .setPosition(p.sx + drift, p.sy - (e.kind === "boss" ? 102 : 68))
        .setDepth(9500)
        .setScrollFactor(1)
        .setColor(crit ? "#fff8e0" : o?.color || "#ffe08a")
        .setStroke(crit ? "#5a2a08" : "#1a0a06", crit ? 8 : 7)
        .setFontSize(compact ? (crit ? "40px" : "34px") : crit ? "30px" : "24px")
        .setScale(crit ? 2.2 : 1.75);
      if (crit) {
        this.cameras.main.flash(48, 255, 240, 200, false);
        this.cameraPunch(0.035, 120);
      }
      this.tweens.add({
        targets: t,
        scale: crit ? 1.2 : 1,
        duration: crit ? 180 : 160,
        ease: "Back.easeOut",
      });
      this.tweens.add({
        targets: t,
        x: t.x + drift * 0.85,
        y: t.y - (compact ? (crit ? 64 : 52) : crit ? 52 : 40),
        alpha: 0,
        duration: crit ? 1050 : 900,
        delay: 150,
        ease: "Cubic.easeOut",
        onComplete: () => {
          this.dmgStacks.delete(key);
          this.releaseDmgText(t);
        },
      });
    }
    this.dmgStacks.set(key, {
      text: t,
      amount: dmg,
      count: 1,
      lastAt: now,
      isPlayer,
      baseX: t.x,
      baseY: t.y,
    });
  }

  /**
   * Sticky edge chip pointerdown — tap nearest on quick release;
   * hold cycles threat arrows one-by-one.
   */
  private tryStickyChipPointerDown(sx: number, sy: number, pointerId: number): boolean {
    const chip = this.stickyChipHit;
    if (!chip || !chip.threatIds.length || !this.room) return false;
    const d = Phaser.Math.Distance.Between(sx, sy, chip.sx, chip.sy);
    if (d > chip.r) return false;
    this.cancelStickyHold();
    const threatIds = chip.threatIds.slice();
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      this.finishStickyHold();
    };
    this.stickyHold = {
      pointerId,
      startMs: performance.now(),
      lastCycleMs: 0,
      index: -1,
      threatIds,
      cycled: false,
      onUp,
    };
    this.stickyActiveThreatIndex = -1;
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return true;
  }

  /** Apply sticky Gale target to a threat id + soft sticky haptic. */
  private applyStickyThreat(id: string) {
    const prevId = this.lastHitFoe?.id;
    this.lastHitFoe = { id, until: this.animT + GALE_STICKY_MS };
    hapticStickyRetarget();
    // Tiny gold trail from sticky chip → newly locked Gale target
    if (prevId !== id && this.room) {
      const chip = this.stickyChipHit;
      const ent = this.room.entities.find(
        (e: any) => String(e.id) === id && (e.kind === "mob" || e.kind === "boss")
      );
      if (chip && ent) {
        const pos = this.entityRenderPos(ent);
        const tp = worldToScreen(pos.x, pos.y);
        this.stickyGoldTrails.push({
          x0: chip.sx,
          y0: chip.sy,
          x1: tp.sx,
          y1: tp.sy - (isCompactUi() ? 18 : 14),
          start: this.animT,
          until: this.animT + STICKY_GOLD_TRAIL_MS,
        });
        if (this.stickyGoldTrails.length > 4) this.stickyGoldTrails.shift();
      }
    }
  }

  /** Nearest threat-arrow foe from a list (world distance). */
  private nearestStickyThreatId(threatIds: string[]): string | null {
    if (!this.room || !threatIds.length) return null;
    const you = this.renderYou;
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const id of threatIds) {
      const ent = this.room.entities.find(
        (e: any) => String(e.id) === id && (e.kind === "mob" || e.kind === "boss")
      );
      if (!ent) continue;
      const pos = this.entityRenderPos(ent);
      const dist = Math.hypot(pos.x - you.x, pos.y - you.y);
      if (dist < bestD) {
        bestD = dist;
        bestId = id;
      }
    }
    return bestId;
  }

  /** Advance sticky hold cycle to the next threat arrow. */
  private cycleStickyThreat() {
    const h = this.stickyHold;
    if (!h || !h.threatIds.length) return;
    h.index = (h.index + 1) % h.threatIds.length;
    h.lastCycleMs = performance.now();
    h.cycled = true;
    this.stickyActiveThreatIndex = h.index;
    const id = h.threatIds[h.index];
    if (id) this.applyStickyThreat(id);
  }

  /** Tick sticky hold: after STICKY_HOLD_MS, cycle one-by-one while held. */
  private tickStickyHold() {
    const h = this.stickyHold;
    if (!h) return;
    // Refresh threat list from live chip when possible
    if (this.stickyChipHit?.threatIds?.length) {
      h.threatIds = this.stickyChipHit.threatIds.slice();
    }
    if (!h.threatIds.length) return;
    const now = performance.now();
    const held = now - h.startMs;
    if (!h.cycled) {
      if (held >= STICKY_HOLD_MS) this.cycleStickyThreat();
      return;
    }
    if (now - h.lastCycleMs >= STICKY_CYCLE_MS) this.cycleStickyThreat();
  }

  /** Pointer released on sticky chip — tap = nearest; hold already cycled. */
  private finishStickyHold() {
    const h = this.stickyHold;
    if (!h) return;
    const cycled = h.cycled;
    const threatIds = h.threatIds;
    this.cancelStickyHold(false);
    if (!cycled) {
      const best = this.nearestStickyThreatId(threatIds);
      if (best) this.applyStickyThreat(best);
    }
    // Clear highlight shortly after release
    window.setTimeout(() => {
      if (!this.stickyHold) this.stickyActiveThreatIndex = -1;
    }, 420);
  }

  private cancelStickyHold(clearHighlight = true) {
    const h = this.stickyHold;
    if (!h) return;
    if (h.onUp) {
      window.removeEventListener("pointerup", h.onUp);
      window.removeEventListener("pointercancel", h.onUp);
    }
    this.stickyHold = null;
    if (clearHighlight) this.stickyActiveThreatIndex = -1;
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
    opts?: {
      tint?: number;
      bob?: number;
      flipX?: boolean;
      scale?: number;
      squash?: number;
      rot?: number;
      alpha?: number;
    }
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
    img.setAlpha(opts?.alpha ?? 1);
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
      this.cameras.main.shake(60, isCompactUi() ? 0.003 : 0.002);
      this.cameraPunch(0.022, 120);
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
        noteWardBuff(durMs / 1000);
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
        dur: 560,
        radius,
      });
      this.cameras.main.shake(240, isCompactUi() ? 0.014 : 0.01);
      this.cameras.main.flash(140, 200, 45, 22, false);
      this.triggerHitStop(HIT_STOP_MS);
      this.cameraPunch(0.07, 300);
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
      const prog = (this.animT - k.start) / (k.boss ? BOSS_KILL_FX_MS : KILL_FX_MS);
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

    // Spell hold telegraphs (Gale aim+range / Ward charge / Burst ground)
    if (this.spellHold) {
      const sh = this.spellHold;
      const held = performance.now() - sh.startMs;
      const charge = Math.min(1, held / Math.max(1, SPELL_HOLD_CONFIRM_MS));
      const you = worldToScreen(this.renderYou.x, this.renderYou.y);
      if (sh.spellId === "gale_bolt") {
        const reach = GALE_RANGE;
        const tip = worldToScreen(
          this.renderYou.x + sh.aimX * reach,
          this.renderYou.y + sh.aimY * reach
        );
        let outsideHint = false;
        if (this.room) {
          for (const e of this.room.entities) {
            if (e.kind !== "mob" && e.kind !== "boss") continue;
            const pos = this.entityRenderPos(e);
            const d = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
            if (d > GALE_RANGE && d <= GALE_RANGE + GALE_OUTSIDE_SLACK) {
              outsideHint = true;
              const fp = worldToScreen(pos.x, pos.y);
              drawOutOfRangeFoeMark(g, fp.sx, fp.sy, this.animT);
            }
          }
        }
        const locked = sh.aimed || held >= SPELL_HOLD_CONFIRM_MS;
        const alpha = locked ? Math.max(0.45, charge) : 0.22 + charge * 0.25;
        drawGaleRangePreview(
          g,
          you.sx,
          you.sy,
          tip.sx,
          tip.sy - 10,
          GALE_RANGE,
          alpha,
          { outsideHint }
        );
        drawGaleAimTelegraph(g, you.sx, you.sy - 10, tip.sx, tip.sy - 10, alpha);
      } else if (sh.spellId === "whirl_ward") {
        drawWardChargeTelegraph(g, you.sx, you.sy, Math.max(0.2, charge), this.animT);
      } else if (sh.spellId === "infernal_burst") {
        drawBurstGroundTelegraph(g, you.sx, you.sy, Math.max(0.2, charge), BURST_RADIUS);
      }
    }

    // Portal travel charge ring
    if (this.portalHold && !this.portalHold.completed) {
      const ph = this.portalHold;
      const charge = Math.min(1, (performance.now() - ph.startMs) / PORTAL_HOLD_MS);
      const pos = this.entityRenderPos(ph.target);
      const pp = worldToScreen(pos.x, pos.y);
      drawPortalChargeRing(g, pp.sx, pp.sy, charge, this.animT, compact);
    }

    // Spell cast telegraphs (aim line / ward charge / burst ground circle)
    if (this.pendingCast) {
      const pc = this.pendingCast;
      const charge = Math.min(1, (this.animT - pc.start) / Math.max(1, pc.until - pc.start));
      const you = worldToScreen(this.renderYou.x, this.renderYou.y);
      if (pc.spellId === "gale_bolt") {
        const reach = GALE_RANGE;
        const tip = worldToScreen(
          this.renderYou.x + pc.aimX * reach,
          this.renderYou.y + pc.aimY * reach
        );
        drawGaleRangePreview(g, you.sx, you.sy, tip.sx, tip.sy - 10, GALE_RANGE, charge);
        drawGaleAimTelegraph(g, you.sx, you.sy - 10, tip.sx, tip.sy - 10, charge);
      } else if (pc.spellId === "whirl_ward") {
        drawWardChargeTelegraph(g, you.sx, you.sy, charge, this.animT);
      } else if (pc.spellId === "infernal_burst") {
        drawBurstGroundTelegraph(g, you.sx, you.sy, charge, BURST_RADIUS);
      }
    }

    // Boss (Judge) attack telegraphs
    for (let i = this.bossTelegraphs.length - 1; i >= 0; i--) {
      const t = this.bossTelegraphs[i];
      if (this.animT >= t.until) {
        // Slam resolve: impact flash + ground crack at the telegraph footprint
        this.bossSlamFx.push({
          x: t.x,
          y: t.y,
          radius: t.radius,
          start: this.animT,
          until: this.animT + JUDGE_SLAM_FX_MS,
        });
        // Countdown disc cracks / shatters into dust on slam
        {
          const compactSlam = isCompactUi();
          const pp = worldToScreen(t.x, t.y);
          this.judgeDiscShatter.push({
            sx: pp.sx,
            sy: bossTelegraphPipY(pp.sy, compactSlam),
            start: this.animT,
            until: this.animT + JUDGE_DISC_SHATTER_MS,
          });
          if (this.judgeDiscShatter.length > 3) this.judgeDiscShatter.shift();
        }
        this.cameras.main.flash(70, 255, 180, 120, false);
        this.cameras.main.shake(140, isCompactUi() ? 0.008 : 0.0055);
        // Crimson sting if inside; gold “just safe” rim if barely outside
        {
          const dx = this.renderYou.x - t.x;
          const dy = this.renderYou.y - t.y;
          const dist = Math.hypot(dx, dy);
          const hitR = t.radius + 0.35;
          if (dist <= hitR) {
            flashSlamSting();
          } else if (dist <= hitR + JUDGE_SLAM_SAFE_BAND) {
            flashSlamSafeRim();
            this.bossSlamSafeFx.push({
              x: t.x,
              y: t.y,
              radius: t.radius,
              start: this.animT,
              until: this.animT + JUDGE_SLAM_SAFE_FX_MS,
            });
          }
        }
        this.bossTelegraphs.splice(i, 1);
        continue;
      }
      const charge = Math.min(1, (this.animT - t.start) / Math.max(1, t.until - t.start));
      const p = worldToScreen(t.x, t.y);
      drawBossTelegraph(g, p.sx, p.sy, charge, t.radius, this.animT, compact, JUDGE_SLAM_SAFE_BAND);
      // Player footprint ghost + zone-colored footstep dust during windup
      {
        const dx = this.renderYou.x - t.x;
        const dy = this.renderYou.y - t.y;
        const dist = Math.hypot(dx, dy);
        const hitR = t.radius + 0.35;
        const safeOuter = hitR + JUDGE_SLAM_SAFE_BAND;
        if (dist <= safeOuter) {
          const zone = dist <= hitR ? "danger" : "safe";
          const youP = worldToScreen(this.renderYou.x, this.renderYou.y);
          drawPlayerFootprintGhost(
            g,
            youP.sx,
            youP.sy,
            zone,
            this.animT,
            compact
          );
          // Gold (safe-band) vs crimson (danger) dust puffs under feet
          if (this.animT - this.lastJudgeTeleDustAt >= JUDGE_TELE_DUST_MS) {
            this.lastJudgeTeleDustAt = this.animT;
            spawnTelegraphFootstepDust(
              this.particles,
              this.renderYou.x,
              this.renderYou.y,
              zone
            );
          }
        }
      }
      const left = Math.max(0, (t.until - this.animT) / 1000);
      const num = left >= 1 ? String(Math.ceil(left)) : left.toFixed(1);
      const pipY = bossTelegraphPipY(p.sy, compact);
      this.addLabel(`boss-cd:${t.id}`, p.sx, pipY, num, compact ? "15px" : "13px", seenLabels);
      const lab = this.labels.get(`boss-cd:${t.id}`);
      if (lab) {
        lab.setColor("#1a1408");
        lab.setAlpha(0.98);
        lab.setStroke("#ffe8a0", compact ? 3 : 2);
        lab.setDepth(9500);
        // Soft heartbeat scale pulse on countdown digits
        const hb = 0.5 + 0.5 * Math.sin(this.animT * 0.011);
        const beat = 1 + hb * hb * 0.14; // soft double-bump feel
        lab.setScale(beat);
      }
    }

    // Judge slam resolve VFX
    for (let i = this.bossSlamFx.length - 1; i >= 0; i--) {
      const s = this.bossSlamFx[i];
      if (this.animT >= s.until) {
        this.bossSlamFx.splice(i, 1);
        continue;
      }
      const life = 1 - (this.animT - s.start) / Math.max(1, s.until - s.start);
      const p = worldToScreen(s.x, s.y);
      drawJudgeSlamImpact(g, p.sx, p.sy, life, s.radius, compact);
    }

    // Countdown disc shatter → dust on slam
    for (let i = this.judgeDiscShatter.length - 1; i >= 0; i--) {
      const s = this.judgeDiscShatter[i];
      if (this.animT >= s.until) {
        this.judgeDiscShatter.splice(i, 1);
        continue;
      }
      const life = 1 - (this.animT - s.start) / Math.max(1, s.until - s.start);
      drawJudgeCountdownShatter(g, s.sx, s.sy, life, compact);
    }

    // Sticky release gold trail chip → Gale target
    for (let i = this.stickyGoldTrails.length - 1; i >= 0; i--) {
      const s = this.stickyGoldTrails[i];
      if (this.animT >= s.until) {
        this.stickyGoldTrails.splice(i, 1);
        continue;
      }
      const life = 1 - (this.animT - s.start) / Math.max(1, s.until - s.start);
      drawStickyGoldTrail(g, s.x0, s.y0, s.x1, s.y1, life, compact);
    }

    // Gold “just safe” rim when barely outside slam at resolve
    for (let i = this.bossSlamSafeFx.length - 1; i >= 0; i--) {
      const s = this.bossSlamSafeFx[i];
      if (this.animT >= s.until) {
        this.bossSlamSafeFx.splice(i, 1);
        continue;
      }
      const life = 1 - (this.animT - s.start) / Math.max(1, s.until - s.start);
      const p = worldToScreen(s.x, s.y);
      drawJudgeSlamSafeRim(g, p.sx, p.sy, life, s.radius, compact);
    }

    // Live hub decor pulse (lightweight vignette trees already stamped on ground)
    if (isHub) {
      // Soft center darkening under playable clearing each frame for sprite pop
      const b = this.room.bounds;
      const c = worldToScreen(b.width * 0.5, b.height * 0.55);
      g.fillStyle(0x000000, 0.08);
      g.fillEllipse(c.sx, c.sy, 180, 80);
    }

    // Respawn entrance beacon — pulse where you woke
    if (this.respawnBeaconPos && this.animT < this.respawnBeaconUntil) {
      const life = (this.respawnBeaconUntil - this.animT) / RESPAWN_BEACON_MS;
      const bp = worldToScreen(this.respawnBeaconPos.x, this.respawnBeaconPos.y);
      drawRespawnBeacon(g, bp.sx, bp.sy, this.animT, life, compact);
    } else if (this.respawnBeaconPos && this.animT >= this.respawnBeaconUntil) {
      this.respawnBeaconPos = null;
    }

    // Soft ash trail from death corpse → entrance beacon
    if (this.deathAshTrail) {
      const tr = this.deathAshTrail;
      if (this.animT >= tr.until) {
        this.deathAshTrail = null;
      } else {
        const life = 1 - (this.animT - tr.start) / Math.max(1, tr.until - tr.start);
        const a = worldToScreen(tr.x0, tr.y0);
        const b = worldToScreen(tr.x1, tr.y1);
        drawDeathAshTrail(g, a.sx, a.sy - 8, b.sx, b.sy - 4, this.animT, life, compact);
        // Brief corpse X that fades as the Wake crumb clears
        drawCorpseXMarker(g, a.sx, a.sy - 10, life, compact);
      }
    }

    // Loot magnet sparks traveling along auto-pickup lines
    for (let i = this.magnetSparks.length - 1; i >= 0; i--) {
      const s = this.magnetSparks[i];
      const t01 = (this.animT - s.start) / MAGNET_SPARK_MS;
      if (t01 >= 1) {
        this.magnetSparks.splice(i, 1);
        continue;
      }
      const a = worldToScreen(s.x0, s.y0);
      const b = worldToScreen(s.x1, s.y1);
      drawMagnetSpark(g, a.sx, a.sy - 4, b.sx, b.sy - 10, t01, s.tint, compact);
    }

    // Nearest-interact pulse outline (drawn under entities)
    if (this.nearestInteract) {
      drawInteractPulse(
        g,
        this.nearestInteract.sx,
        this.nearestInteract.sy,
        this.animT,
        compact,
        this.nearestInteract.kind
      );
    }

    const ents = [...this.room.entities].sort((a, b) => {
      const pa = this.entityRenderPos(a);
      const pb = this.entityRenderPos(b);
      return pa.x + pa.y - (pb.x + pb.y);
    });

    // Overlapping foes: lateral HP nudge + stronger silhouette when packed
    const foeStackInfo = new Map<string, { count: number; slot: number; lateral: number }>();
    {
      const foes = ents.filter((e) => e.kind === "mob" || e.kind === "boss");
      const assigned = new Set<string>();
      for (const seed of foes) {
        const sid = String(seed.id);
        if (assigned.has(sid)) continue;
        const spos = this.entityRenderPos(seed);
        const cluster: { e: any; pos: { x: number; y: number } }[] = [];
        for (const o of foes) {
          const oid = String(o.id);
          if (assigned.has(oid)) continue;
          const opos = this.entityRenderPos(o);
          if (Math.hypot(opos.x - spos.x, opos.y - spos.y) <= FOE_STACK_RANGE) {
            cluster.push({ e: o, pos: opos });
          }
        }
        cluster.sort((a, b) => a.pos.x + a.pos.y - (b.pos.x + b.pos.y));
        const n = cluster.length;
        cluster.forEach((c, i) => {
          const id = String(c.e.id);
          assigned.add(id);
          const lateral =
            n <= 1 ? 0 : (i - (n - 1) / 2) * (compact ? 14 : 11);
          foeStackInfo.set(id, { count: n, slot: i, lateral });
        });
      }
    }

    // Stacked loot piles: stagger when many drops share a tile
    const lootStackInfo = new Map<
      string,
      {
        count: number;
        slot: number;
        ox: number;
        oy: number;
        tower?: boolean;
        topColor?: number;
        topPulse?: number;
      }
    >();
    {
      const drops = ents.filter((e) => e.kind === "loot");
      const assigned = new Set<string>();
      for (const seed of drops) {
        const sid = String(seed.id);
        if (assigned.has(sid)) continue;
        const spos = this.entityRenderPos(seed);
        const cluster: { e: any; pos: { x: number; y: number }; rarity: string }[] = [];
        for (const o of drops) {
          const oid = String(o.id);
          if (assigned.has(oid)) continue;
          const opos = this.entityRenderPos(o);
          if (Math.hypot(opos.x - spos.x, opos.y - spos.y) <= LOOT_STACK_RANGE) {
            cluster.push({ e: o, pos: opos, rarity: String(o.item?.rarity || "normal") });
          }
        }
        // Higher rarity drifts slightly outward / on top of the pile
        const rank: Record<string, number> = {
          normal: 0,
          magic: 1,
          rare: 2,
          set: 3,
          unique: 4,
          canto_unique: 5,
        };
        cluster.sort(
          (a, b) =>
            (rank[a.rarity] ?? 0) - (rank[b.rarity] ?? 0) ||
            a.pos.x + a.pos.y - (b.pos.x + b.pos.y)
        );
        const n = cluster.length;
        const maxRank = cluster.reduce(
          (m, c) => Math.max(m, rank[c.rarity] ?? 0),
          0
        );
        // Unique / canto piles: taller vertical rarity tower (less lateral sprawl)
        const tower = maxRank >= 4;
        const topRarity = cluster[cluster.length - 1]?.rarity || "normal";
        cluster.forEach((c, i) => {
          const id = String(c.e.id);
          assigned.add(id);
          if (n <= 1) {
            lootStackInfo.set(id, { count: 1, slot: 0, ox: 0, oy: 0 });
            return;
          }
          if (tower) {
            const stepY = compact ? 15 : 12;
            const ox = ((i % 2) - 0.5) * (compact ? 5 : 4) * (i > 0 ? 1 : 0);
            const oy = -i * stepY - (rank[c.rarity] ?? 0) * 1.2;
            lootStackInfo.set(id, {
              count: n,
              slot: i,
              ox,
              oy,
              tower: true,
              topColor: RARITY_COLOR[topRarity] || 0xc9a227,
              topPulse: lootRarityPulse(topRarity),
            });
            return;
          }
          const step = compact ? 11 : 9;
          const ox = (i - (n - 1) / 2) * step;
          const oy = -((i % 3) - 1) * (compact ? 5 : 4) - i * 0.6;
          lootStackInfo.set(id, { count: n, slot: i, ox, oy });
        });
      }
    }

    // Edge-of-screen foes for sticky multi-threat arrows
    this.stickyChipHit = null;
    const camEdge = this.cameras.main;
    const edgeFoes: {
      id: string;
      sx: number;
      sy: number;
      wx: number;
      wy: number;
      shortName: string;
    }[] = [];
    for (const fe of ents) {
      if (fe.kind !== "mob" && fe.kind !== "boss") continue;
      const fpos = this.entityRenderPos(fe);
      const fp = worldToScreen(fpos.x, fpos.y);
      const near =
        fp.sx < camEdge.worldView.x + camEdge.worldView.width * STICKY_EDGE_FRAC ||
        fp.sx > camEdge.worldView.x + camEdge.worldView.width * (1 - STICKY_EDGE_FRAC) ||
        fp.sy < camEdge.worldView.y + camEdge.worldView.height * STICKY_EDGE_FRAC ||
        fp.sy > camEdge.worldView.y + camEdge.worldView.height * (1 - STICKY_EDGE_FRAC);
      if (near) {
        const shortName =
          fe.kind === "boss"
            ? String(fe.name || "Judge").slice(0, 8)
            : fe.champion
              ? "Champ"
              : String(fe.name || fe.label || "Foe").split(" ")[0].slice(0, 8);
        edgeFoes.push({
          id: String(fe.id),
          sx: fp.sx,
          sy: fp.sy,
          wx: fpos.x,
          wy: fpos.y,
          shortName,
        });
      }
    }

    // Spine drawn once per loot tower (track anchors already painted)
    const towerSpineDrawn = new Set<string>();

    for (const e of ents) {
      const pos = e.kind === "loot" ? this.lootRenderPos(e) : this.entityRenderPos(e);
      const p = worldToScreen(pos.x, pos.y);
      const depth = 100 + pos.x + pos.y;
      const tex = entityDoreKey(e);
      const sid = `${e.kind}:${e.id}`;

      if (e.kind === "poi") {
        drawEntityPad(g, p.sx, p.sy, compact ? 1.5 : 1.1);
        if (e.poiKind === "portal") {
          const poiDist = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
          if (poiDist <= EXIT_TRAVEL_RANGE) {
            drawPortalEnterTip(g, p.sx, p.sy, this.animT, compact, true);
          }
        }
        if (this.placeSprite(sid, tex!, p.sx, p.sy, depth)) {
          seenSprites.add(sid);
        } else {
          drawPoi(g, p.sx, p.sy, e.poiKind, compact);
        }
        {
          const poiDist = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
          this.addDistanceLabel(
            `poi:${e.id}`,
            p.sx,
            p.sy - (compact ? 40 : 30),
            e.label || e.name || "POI",
            labelSize,
            poiDist,
            seenLabels,
            { icon: "◆", farAlpha: 0.45 }
          );
          if (e.poiKind === "portal" && poiDist <= EXIT_TRAVEL_RANGE) {
            const dest = this.portalDestName(e);
            this.addDistanceLabel(
              `poi-hold:${e.id}`,
              p.sx,
              p.sy - (compact ? 56 : 44),
              `hold to enter ${dest}`,
              compact ? "11px" : "10px",
              poiDist,
              seenLabels,
              {
                nearRange: EXIT_TRAVEL_RANGE,
                farRange: EXIT_TRAVEL_RANGE,
                nearColor: "#e8c86a",
                nearAlpha: 0.9,
              }
            );
          }
        }
      } else if (e.kind === "exit") {
        drawEntityPad(g, p.sx, p.sy, compact ? 1.9 : 1.4);
        drawExitSpotlight(g, p.sx, p.sy, this.animT, compact);
        {
          const exitDist0 = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
          if (exitDist0 <= EXIT_TRAVEL_RANGE) {
            drawPortalEnterTip(g, p.sx, p.sy, this.animT, compact, true);
          }
        }
        if (this.placeSprite(sid, DORE_KEYS.exit_portal, p.sx, p.sy, depth)) {
          seenSprites.add(sid);
        } else {
          drawExit(g, p.sx, p.sy);
        }
        const exitLabel =
          e.toCanto === "inferno_05"
            ? "Toward Lust →"
            : e.label || "Exit";
        const exitDist = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
        this.addDistanceLabel(
          `exit:${e.id}`,
          p.sx,
          p.sy - (compact ? 84 : 62),
          exitLabel,
          compact ? "16px" : "13px",
          exitDist,
          seenLabels,
          {
            icon: "◎",
            farAlpha: 0.5,
            nearColor: e.toCanto === "inferno_05" ? "#e8c86a" : undefined,
            nearAlpha: 0.78,
          }
        );
        if (exitDist <= EXIT_TRAVEL_RANGE) {
          const dest = this.portalDestName(e);
          this.addDistanceLabel(
            `exit-hold:${e.id}`,
            p.sx,
            p.sy - (compact ? 102 : 78),
            `hold to enter ${dest}`,
            compact ? "11px" : "10px",
            exitDist,
            seenLabels,
            {
              nearRange: EXIT_TRAVEL_RANGE,
              farRange: EXIT_TRAVEL_RANGE,
              nearColor: "#e8c86a",
              nearAlpha: 0.9,
            }
          );
        }
      } else if (e.kind === "mob") {
        const stack = foeStackInfo.get(String(e.id));
        const stacked = Boolean(stack && stack.count > 1);
        const lat = stack ? stack.lateral : 0;
        const drawSx = p.sx + lat;
        const hpSx = p.sx + lat * 1.35;
        // Depth-sort nudge: laterals also bump depth so sprites layer cleanly
        const stackDepth =
          depth +
          (stack ? stack.slot * 0.02 : 0) +
          this.horizonFoldDepthFlicker(Number(e.id?.length ? e.id.charCodeAt(0) : 0) + (stack?.slot || 0));
        if (
          this.lastHitFoe &&
          this.lastHitFoe.id === String(e.id) &&
          this.animT < this.lastHitFoe.until
        ) {
          const cam = this.cameras.main;
          const nearEdge =
            drawSx < cam.worldView.x + cam.worldView.width * STICKY_EDGE_FRAC ||
            drawSx > cam.worldView.x + cam.worldView.width * (1 - STICKY_EDGE_FRAC) ||
            p.sy < cam.worldView.y + cam.worldView.height * STICKY_EDGE_FRAC ||
            p.sy > cam.worldView.y + cam.worldView.height * (1 - STICKY_EDGE_FRAC);
          const foeDist = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
          const short =
            e.champion ? "Champ" : String(e.name || e.label || "Foe").split(" ")[0].slice(0, 8);
          const threatFoes =
            nearEdge && edgeFoes.length > 1
              ? edgeFoes.filter((f) => f.id !== String(e.id)).slice(0, 3)
              : [];
          const threatArrows = threatFoes.length
            ? threatFoes.map((f) => ({
                dx: f.sx - drawSx,
                dy: f.sy - p.sy,
                shortName: f.shortName,
              }))
            : undefined;
          const activeTi =
            threatFoes.length && this.stickyActiveThreatIndex >= 0
              ? this.stickyActiveThreatIndex % Math.min(3, threatFoes.length)
              : -1;
          drawStickyTargetReticle(g, drawSx, p.sy, this.animT, compact, {
            hp: Number(e.hp),
            maxHp: Number(e.maxHp),
            nearEdge,
            champion: Boolean(e.champion),
            dist: foeDist,
            shortName: short,
            threatArrows,
            activeThreatIndex: threatFoes.length ? this.stickyActiveThreatIndex : undefined,
          });
          if (nearEdge) {
            this.stickyChipHit = {
              sx: drawSx,
              sy: p.sy - (compact ? 18 : 14),
              r: compact ? 42 : 34,
              threatIds: threatFoes.map((f) => f.id),
            };
            this.addLabel(
              `sticky-crumb:${e.id}`,
              drawSx,
              p.sy + (compact ? 22 : 18),
              `${short} · ${Math.max(1, Math.round(foeDist))}u`,
              compact ? "10px" : "9px",
              seenLabels
            );
            const crumb = this.labels.get(`sticky-crumb:${e.id}`);
            if (crumb) {
              crumb.setColor("#e8c86a");
              crumb.setAlpha(0.88);
              crumb.setStroke("#0a0806", 3);
              crumb.setDepth(9600);
            }
            // Short name crumb on the *active* threat arrow while hold-cycling
            if (activeTi >= 0 && threatFoes[activeTi]) {
              const tf = threatFoes[activeTi];
              const nm = (tf.shortName || "Foe").slice(0, 6);
              const ax = drawSx + (tf.sx - drawSx) * 0.35;
              const ay = p.sy - (compact ? 28 : 22) + (tf.sy - p.sy) * 0.15;
              this.addLabel(
                `sticky-threat-name:${tf.id}`,
                ax,
                ay,
                nm,
                compact ? "9px" : "8px",
                seenLabels
              );
              const tn = this.labels.get(`sticky-threat-name:${tf.id}`);
              if (tn) {
                tn.setColor("#ffe8a0");
                tn.setAlpha(0.95);
                tn.setStroke("#0a0806", 3);
                tn.setDepth(9650);
              }
            }
          }
        }
        const champ = Boolean(e.champion);
        drawEntityPad(g, drawSx, p.sy, champ ? (compact ? 2.05 : 1.65) : compact ? 1.55 : 1.2, this.riftShearPadDesync());
        drawFoeGlow(g, drawSx, p.sy, this.animT, {
          compact,
          champion: champ,
          stacked,
        });
        let topY = p.sy - (champ ? 48 : 32);
        const foeScale = (compact ? 1.12 : 1.06) * (champ ? 1.18 : 1);
        if (this.placeSprite(sid, tex!, drawSx, p.sy, stackDepth, { scale: foeScale })) {
          seenSprites.add(sid);
          const b = this.spriteBase.get(sid);
          if (b) topY = p.sy - 4 - b.h * foeScale * 0.92 - (compact ? 12 : 8);
        } else {
          drawMob(g, drawSx, p.sy, champ);
        }
        if (champ) {
          drawChampionCrownPip(g, hpSx, topY - (compact ? 2 : 0), this.animT, compact);
          topY -= compact ? 14 : 11;
        }
        drawFoeHpBar(g, hpSx, topY, e.hp, e.maxHp, champ ? 44 : 30, { compact });
      } else if (e.kind === "boss") {
        if (
          this.lastHitFoe &&
          this.lastHitFoe.id === String(e.id) &&
          this.animT < this.lastHitFoe.until
        ) {
          const cam = this.cameras.main;
          const nearEdge =
            p.sx < cam.worldView.x + cam.worldView.width * STICKY_EDGE_FRAC ||
            p.sx > cam.worldView.x + cam.worldView.width * (1 - STICKY_EDGE_FRAC) ||
            p.sy < cam.worldView.y + cam.worldView.height * STICKY_EDGE_FRAC ||
            p.sy > cam.worldView.y + cam.worldView.height * (1 - STICKY_EDGE_FRAC);
          const bossDist = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
          const threatFoes =
            nearEdge && edgeFoes.length > 1
              ? edgeFoes.filter((f) => f.id !== String(e.id)).slice(0, 3)
              : [];
          const threatArrows = threatFoes.length
            ? threatFoes.map((f) => ({
                dx: f.sx - p.sx,
                dy: f.sy - p.sy,
                shortName: f.shortName,
              }))
            : undefined;
          const activeTi =
            threatFoes.length && this.stickyActiveThreatIndex >= 0
              ? this.stickyActiveThreatIndex % Math.min(3, threatFoes.length)
              : -1;
          drawStickyTargetReticle(g, p.sx, p.sy, this.animT, compact, {
            hp: Number(e.hp),
            maxHp: Number(e.maxHp),
            nearEdge,
            dist: bossDist,
            shortName: String(e.name || "Judge").slice(0, 8),
            threatArrows,
            activeThreatIndex: threatFoes.length ? this.stickyActiveThreatIndex : undefined,
          });
          if (nearEdge) {
            this.stickyChipHit = {
              sx: p.sx,
              sy: p.sy - (compact ? 18 : 14),
              r: compact ? 46 : 38,
              threatIds: threatFoes.map((f) => f.id),
            };
            this.addLabel(
              `sticky-crumb:${e.id}`,
              p.sx,
              p.sy + (compact ? 26 : 22),
              `${String(e.name || "Judge").slice(0, 8)} · ${Math.max(1, Math.round(bossDist))}u`,
              compact ? "10px" : "9px",
              seenLabels
            );
            const crumb = this.labels.get(`sticky-crumb:${e.id}`);
            if (crumb) {
              crumb.setColor("#e8c86a");
              crumb.setAlpha(0.9);
              crumb.setStroke("#0a0806", 3);
              crumb.setDepth(9600);
            }
            if (activeTi >= 0 && threatFoes[activeTi]) {
              const tf = threatFoes[activeTi];
              const nm = (tf.shortName || "Foe").slice(0, 6);
              const ax = p.sx + (tf.sx - p.sx) * 0.35;
              const ay = p.sy - (compact ? 28 : 22) + (tf.sy - p.sy) * 0.15;
              this.addLabel(
                `sticky-threat-name:${tf.id}`,
                ax,
                ay,
                nm,
                compact ? "9px" : "8px",
                seenLabels
              );
              const tn = this.labels.get(`sticky-threat-name:${tf.id}`);
              if (tn) {
                tn.setColor("#ffe8a0");
                tn.setAlpha(0.95);
                tn.setStroke("#0a0806", 3);
                tn.setDepth(9650);
              }
            }
          }
        }
        drawEntityPad(g, p.sx, p.sy, compact ? 2.7 : 2.1, this.riftShearPadDesync());
        drawFoeGlow(g, p.sx, p.sy, this.animT, { compact, boss: true });
        let topY = p.sy - 68;
        const bossScale = compact ? 1.1 : 1.05;
        const bossDepth = depth + this.horizonFoldDepthFlicker(17);
        if (this.placeSprite(sid, DORE_KEYS.boss_judge, p.sx, p.sy, bossDepth, { scale: bossScale })) {
          seenSprites.add(sid);
          const b = this.spriteBase.get(sid);
          if (b) topY = p.sy - 4 - b.h * bossScale * 0.92 - (compact ? 16 : 10);
        } else {
          drawBoss(g, p.sx, p.sy);
        }
        this.addDistanceLabel(
          `boss:${e.id}`,
          p.sx,
          topY - (compact ? 16 : 12),
          e.name || "Judge",
          compact ? "15px" : "12px",
          Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y),
          seenLabels,
          { icon: "†", farAlpha: 0.55, nearColor: "#e8c86a", nearAlpha: 0.8, nearRange: 12 }
        );
        drawFoeHpBar(g, p.sx, topY, e.hp, e.maxHp, 64, { compact, boss: true });
      } else if (e.kind === "loot") {
        const rarity = e.item?.rarity || "normal";
        const tint = RARITY_COLOR[rarity] || 0xffffff;
        const pulse = lootRarityPulse(rarity);
        const strong = pulse >= 0.85;
        const lstack = lootStackInfo.get(String(e.id));
        const lsx = p.sx + (lstack?.ox || 0);
        const lsy = p.sy + (lstack?.oy || 0);
        const ldepth = depth + (lstack ? lstack.slot * 0.015 : 0);
        const lootDistEarly = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
        const lootIdEarly = String(e.id);
        if (lootDistEarly < MAGNET_RANGE && lootDistEarly > 0.15) {
          if (!this.magnetEnteredAt.has(lootIdEarly)) {
            // Stagger flash when multiple piles enter range same frame
            if (Math.abs(this.animT - this.magnetEnterBatchAt) > 2) {
              this.magnetEnterBatchAt = this.animT;
              this.magnetEnterBatchCount = 0;
            } else {
              this.magnetEnterBatchCount += 1;
            }
            const stagger = this.magnetEnterBatchCount * MAGNET_FLASH_STAGGER_MS;
            this.magnetEnteredAt.set(lootIdEarly, this.animT + stagger);
          }
          // Soft spine ripple when staggered flash lands (age crosses 0)
          {
            const entered = this.magnetEnteredAt.get(lootIdEarly);
            if (
              entered != null &&
              this.animT >= entered &&
              this.animT - entered < 32 &&
              lstack?.tower &&
              lstack.count > 1
            ) {
              const spineKey = `${Math.round(p.sx)}:${Math.round(p.sy)}:${lstack.count}`;
              if (!this.magnetSpineRippleAt.has(spineKey)) {
                this.magnetSpineRippleAt.set(spineKey, this.animT);
              }
            }
          }
        } else {
          this.magnetEnteredAt.delete(lootIdEarly);
          if (lstack?.tower && lstack.count > 1) {
            this.magnetSpineRippleAt.delete(
              `${Math.round(p.sx)}:${Math.round(p.sy)}:${lstack.count}`
            );
          }
        }
        // Visual rarity flash by tier on magnet / pickup start (no audio chime)
        {
          const entered = this.magnetEnteredAt.get(lootIdEarly);
          if (entered != null) {
            const age = this.animT - entered;
            if (age >= 0 && age < MAGNET_TICK_POP_MS) {
              const magnetPop = 1 - age / MAGNET_TICK_POP_MS;
              drawLootMagnetRarityFlash(
                g,
                lsx,
                lsy,
                tint,
                magnetPop,
                compact,
                pulse
              );
            }
          }
        }
        // Soft rarity-colored stack glow spine for vertical towers
        if (lstack?.tower && lstack.count > 1 && lstack.slot === 0) {
          const spineKey = `${Math.round(p.sx)}:${Math.round(p.sy)}:${lstack.count}`;
          if (!towerSpineDrawn.has(spineKey)) {
            towerSpineDrawn.add(spineKey);
            const entered = this.magnetEnteredAt.get(lootIdEarly);
            let magnetPop = 0;
            if (entered != null) {
              const age = this.animT - entered;
              if (age >= 0 && age < MAGNET_TICK_POP_MS) {
                magnetPop = 1 - age / MAGNET_TICK_POP_MS;
              }
            }
            let spineRipple = 0;
            const ripAt = this.magnetSpineRippleAt.get(spineKey);
            if (ripAt != null) {
              const rage = this.animT - ripAt;
              if (rage >= 0 && rage < MAGNET_SPINE_RIPPLE_MS) {
                spineRipple = 1 - rage / MAGNET_SPINE_RIPPLE_MS;
              } else if (rage >= MAGNET_SPINE_RIPPLE_MS) {
                this.magnetSpineRippleAt.delete(spineKey);
              }
            }
            drawLootTowerSpine(
              g,
              p.sx,
              p.sy,
              lstack.topColor || tint,
              this.animT,
              compact,
              lstack.count,
              lstack.topPulse ?? pulse,
              magnetPop,
              spineRipple
            );
          }
        }
        drawLootGlow(g, lsx, lsy, tint, this.animT, compact, pulse);
        const bob = Math.sin(this.animT * 0.004 + lsx * 0.01) * (compact ? 3 : 2);
        const lootKey = lootTextureKey(e.item);
        const placedLoot =
          this.placeSprite(sid, lootKey, lsx, lsy, ldepth, {
            tint: rarity === "normal" ? undefined : tint,
            bob,
          }) ||
          this.placeSprite(sid, DORE_KEYS.loot_gem, lsx, lsy, ldepth, {
            tint: rarity === "normal" ? 0xe8dcc0 : tint,
            bob,
          });
        if (placedLoot) {
          seenSprites.add(sid);
        } else {
          drawLoot(g, lsx, lsy, e.item?.rarity, compact, this.animT);
        }
        // Rarity dots always visible when far; full name only in magnet/near range
        {
          const lootDist = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
          const hex = "#" + tint.toString(16).padStart(6, "0");
          // Magnet pull line toward the player while in pickup/magnet range
          if (lootDist < MAGNET_RANGE && lootDist > 0.15) {
            const youP = worldToScreen(this.renderYou.x, this.renderYou.y);
            const pull = 1 - lootDist / MAGNET_RANGE;
            const a = 0.18 + pull * 0.55;
            g.lineStyle(compact ? 2.2 : 1.6, tint, a * 0.55);
            g.lineBetween(lsx, lsy - 4, youP.sx, youP.sy - 10);
            g.lineStyle(compact ? 1.2 : 0.9, 0xffe8a0, a);
            g.lineBetween(lsx, lsy - 4, youP.sx, youP.sy - 10);
            // Soft tip near the player feet
            g.fillStyle(0xffe8a0, a * 0.7);
            g.fillCircle(youP.sx, youP.sy - 10, compact ? 2.4 : 1.8);
          }
          this.addDistanceLabel(
            `loot:${e.id}`,
            lsx,
            lsy - (compact ? 46 : 34),
            e.item?.name || "Loot",
            compact ? "12px" : "10px",
            lootDist,
            seenLabels,
            {
              icon: strong ? "✦" : "●",
              farAlpha: strong ? 0.85 : 0.7,
              nearAlpha: 0.92,
              nearColor: hex,
              farColor: hex,
              nearRange: MAGNET_RANGE,
              farRange: 999, // always-on rarity dots at any distance
            }
          );
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
      const remoteStale =
        this.netOffline || (this.lastSnapAt > 0 && Date.now() - this.lastSnapAt > REMOTE_STALE_MS);
      if (
        this.placeSprite(sid, rv.key, p.sx, p.sy, depth, {
          tint: remoteStale ? 0x667788 : 0x9ab0a0,
          bob: rv.bob,
          scale: rv.scale,
          squash: rv.squash,
          rot: rv.rot,
          flipX: rv.flipX,
          alpha: remoteStale ? 0.38 : 1,
        })
      ) {
        seenSprites.add(sid);
        const b = this.spriteBase.get(sid);
        if (b) topY = p.sy - 4 - b.h * 0.92 - (compact ? 10 : 6);
      } else {
        drawPlayer(g, p.sx, p.sy, false);
      }
      {
        const nm = remoteStale ? `${pl.name} ·` : pl.name;
        this.addLabel(`pl:${pl.id}`, p.sx, topY - (compact ? 14 : 10), nm, labelSize, seenLabels);
        const lab = this.labels.get(`pl:${pl.id}`);
        if (lab) {
          lab.setAlpha(remoteStale ? 0.38 : 0.62);
          lab.setColor(remoteStale ? "#6a7888" : "#b0a88c");
        }
      }
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
          alpha: this.netOffline ? 0.42 : 1,
          tint: this.netOffline ? 0x8899aa : undefined,
        })
      ) {
        seenSprites.add(sid);
        const b = this.spriteBase.get(sid);
        if (b) topY = p.sy - 4 - b.h * 0.92 - (compact ? 10 : 6);
      } else {
        drawPlayer(g, p.sx, p.sy, true);
      }
      // Attack swipe arc — longer wind, brighter blade, trailing sparks
      if (this.swipeFx && this.animT <= this.swipeFx.until) {
        const prog = (this.animT - this.swipeFx.start) / Math.max(1, this.swipeFx.until - this.swipeFx.start);
        const ang = (this.swipeFx.dir > 0 ? -1.05 : Math.PI + 1.05) + prog * this.swipeFx.dir * 1.85;
        const reach = compact ? 96 : 60;
        const fade = 1 - prog * prog;
        const cy = p.sy - (compact ? 46 : 30);
        const d = this.swipeFx.dir;
        const trail = 1.05 + prog * 1.05;
        g.lineStyle(compact ? 28 : 18, 0xc9a227, 0.22 * fade);
        g.beginPath();
        g.arc(p.sx, cy, reach, ang - d * trail, ang + d * 0.4, d < 0);
        g.strokePath();
        g.lineStyle(compact ? 12 : 8, 0xffe08a, 0.98 * fade);
        g.beginPath();
        g.arc(p.sx, cy, reach, ang - d * trail, ang + d * 0.32, d < 0);
        g.strokePath();
        g.lineStyle(compact ? 4 : 2.5, 0xffffff, 0.9 * fade);
        g.beginPath();
        g.arc(p.sx, cy, reach * 0.88, ang - d * trail * 0.65, ang + d * 0.22, d < 0);
        g.strokePath();
        // Leading spark + small trail sparks
        const tipX = p.sx + Math.cos(ang + d * 0.32) * reach;
        const tipY = cy + Math.sin(ang + d * 0.32) * reach;
        g.fillStyle(0xfff6d0, 0.95 * fade);
        g.fillCircle(tipX, tipY, compact ? 8 : 5);
        g.fillStyle(0xff6644, 0.55 * fade);
        g.fillCircle(tipX - d * 6, tipY + 2, compact ? 4 : 2.5);
        for (let s = 1; s <= 3; s++) {
          const ta = ang - d * trail * (0.25 * s);
          const sx = p.sx + Math.cos(ta) * reach * (0.92 - s * 0.04);
          const sy = cy + Math.sin(ta) * reach * (0.92 - s * 0.04);
          g.fillStyle(0xffe08a, (0.55 - s * 0.12) * fade);
          g.fillCircle(sx, sy, (compact ? 4 : 2.5) - s * 0.5);
        }
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
          color: "#b0a88c",
          stroke: "#0b0f0c",
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setAlpha(0.62)
        .setDepth(9000);
      this.labels.set(key, t);
      this.labelGroup.add(t);
    } else {
      t.setPosition(x, y);
      if (t.text !== text) t.setText(text);
      if (t.style.fontSize !== fontSize) t.setFontSize(fontSize);
      t.setAlpha(0.62);
      t.setScale(1);
    }
  }

  /**
   * Overworld label declutter: full text when near the player, icon/dot when far,
   * nothing beyond LABEL_FAR_RANGE.
   */
  addDistanceLabel(
    key: string,
    x: number,
    y: number,
    fullText: string,
    fontSize: string,
    dist: number,
    seen: Set<string> | undefined,
    opts?: {
      icon?: string;
      farAlpha?: number;
      nearAlpha?: number;
      nearColor?: string;
      farColor?: string;
      nearRange?: number;
      farRange?: number;
    }
  ) {
    const nearR = opts?.nearRange ?? LABEL_NEAR_RANGE;
    const farR = opts?.farRange ?? LABEL_FAR_RANGE;
    if (dist > farR) return;
    const near = dist <= nearR;
    const text = near ? fullText : opts?.icon || "•";
    const size = near ? fontSize : opts?.icon === "✦" || opts?.icon === "●" ? "14px" : "10px";
    this.addLabel(key, x, y, text, size, seen);
    const lab = this.labels.get(key);
    if (!lab) return;
    lab.setAlpha(near ? (opts?.nearAlpha ?? 0.72) : (opts?.farAlpha ?? 0.42));
    if (near && opts?.nearColor) lab.setColor(opts.nearColor);
    else if (!near) lab.setColor(opts?.farColor || "#9a9078");
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

  /** Track nearest POI/exit/loot for pulse outline + Interact button hint. */
  private scanNearestInteract() {
    if (!this.room) {
      this.nearestInteract = null;
      return;
    }
    const you = this.youPos();
    let best: any = null;
    let bestD = INTERACT_HIGHLIGHT_RANGE;
    let bestPos = { x: 0, y: 0 };
    for (const e of this.room.entities) {
      if (e.kind !== "poi" && e.kind !== "exit" && e.kind !== "loot") continue;
      const pos = e.kind === "loot" ? this.lootRenderPos(e) : this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      if (d < bestD) {
        bestD = d;
        best = e;
        bestPos = pos;
      }
    }
    const interactBtn = document.getElementById("btn-interact");
    if (!best) {
      this.nearestInteract = null;
      this.lastInteractHintId = null;
      interactBtn?.classList.remove("interact-ready");
      interactBtn?.classList.add("interact-idle");
      this.resetInteractButtonLabel();
      return;
    }
    const scr = worldToScreen(bestPos.x, bestPos.y);
    const ctx = this.interactContextLabel(best);
    this.nearestInteract = {
      id: String(best.id),
      kind: best.kind,
      label: ctx.full,
      sx: scr.sx,
      sy: scr.sy,
    };
    interactBtn?.classList.remove("interact-idle");
    interactBtn?.classList.add("interact-ready");
    this.setInteractButtonLabel(ctx.full, ctx.short);
    // Toast only for loot / portals — POIs get pulse + Interact-button glow only
    // (avoids spam walking past Oak / AH / Darkwood in the hub).
    if (this.lastInteractHintId !== this.nearestInteract.id) {
      this.lastInteractHintId = this.nearestInteract.id;
      this.lastInteractHintAt = Date.now();
      hapticInteractReady();
      if (best.kind === "exit" && best.toCanto === "inferno_05") return;
      if (best.kind === "poi" && best.poiKind !== "portal") return;
      showToast(`${ctx.full} — ready`, "info");
    }
  }


  /** Glow Inv bag when new items appear (rarity of the newest). */
  noteNewInventoryLoot(you: any) {
    const items: any[] = you?.inventory || [];
    const ids = new Set<string>(items.map((it: any) => String(it.id)));
    if (this.seenInvItemIds.size === 0) {
      this.seenInvItemIds = ids;
      return;
    }
    let bestRarity = "normal";
    let found = false;
    const rank: Record<string, number> = {
      normal: 0,
      magic: 1,
      rare: 2,
      set: 3,
      unique: 4,
      canto_unique: 5,
    };
    for (const it of items) {
      const id = String(it.id);
      if (!this.seenInvItemIds.has(id)) {
        found = true;
        const r = String(it.rarity || "normal");
        if ((rank[r] ?? 0) >= (rank[bestRarity] ?? 0)) bestRarity = r;
      }
    }
    this.seenInvItemIds = ids;
    if (found) pulseInvBag(bestRarity);
  }

  /** Short destination name for portal hold tips. */
  portalDestName(e: any): string {
    if (!e) return "portal";
    if (e.toCanto === "inferno_05") return "Lust";
    if (e.toCanto === "inferno_01") return "Dark Wood";
    const label = String(e.label || e.name || "");
    const toward = label.match(/Toward\s+([^→]+)/i);
    if (toward) return toward[1].replace(/[→\s]+$/g, "").trim();
    const ret = label.match(/Return to\s+(.+)/i);
    if (ret) return ret[1].replace(/[→\s]+$/g, "").trim();
    const cleaned = label.replace(/[→]/g, "").trim();
    return cleaned || "portal";
  }

  /** Contextual Interact button copy: Enter Lust / Pick up / Open AH / … */
  private interactContextLabel(best: any): { full: string; short: string } {
    if (best.kind === "loot") {
      return { full: "Pick up", short: "Pick" };
    }
    if (best.kind === "exit" || best.poiKind === "portal") {
      if (best.toCanto === "inferno_05") return { full: "Enter Lust", short: "Lust" };
      const dest = best.label || best.name || "portal";
      return { full: `Enter ${dest}`, short: "Enter" };
    }
    if (best.poiKind === "ah") return { full: "Open AH", short: "AH" };
    if (best.poiKind === "stash") return { full: "Open Stash", short: "Stash" };
    if (best.poiKind === "quest") return { full: "Talk", short: "Talk" };
    if (best.poiKind === "guide") {
      const n = best.label || best.name || "Guide";
      return { full: n.length > 12 ? "Talk" : `Talk ${n}`, short: "Talk" };
    }
    const n = best.label || best.name || "Interact";
    return { full: n, short: "Use" };
  }

  private setInteractButtonLabel(full: string, short: string) {
    const btn = document.getElementById("btn-interact");
    const lab = btn?.querySelector<HTMLElement>(".action-label");
    if (!lab) return;
    if (lab.textContent !== full) lab.textContent = full;
    lab.setAttribute("data-short", short);
  }

  private resetInteractButtonLabel() {
    this.setInteractButtonLabel("Interact", "Use");
  }

  /** Puff dust under feet when the walk frame advances. */
  private maybeFootstepDust() {
    if (!this.movingVisual) {
      this.lastDustFrame = -1;
      return;
    }
    const frame = Math.floor(this.animT / WALK_FRAME_MS) % 2;
    if (frame === this.lastDustFrame) return;
    this.lastDustFrame = frame;
    spawnFootstepDust(this.particles, this.renderYou.x, this.renderYou.y);
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
      // Spark travels loot → player along the magnet line
      const tint = RARITY_COLOR[e.item?.rarity || "normal"] || 0xffe8a0;
      this.magnetSparks.push({
        x0: e.x,
        y0: e.y,
        x1: you.x,
        y1: you.y,
        start: this.animT,
        tint,
      });
      if (this.magnetSparks.length > 12) this.magnetSparks.shift();
      this.socket.pickup(e.id);
    }
  }

  /** Etch flash + camera fade, then soft respawn fade-in. */
  private triggerDeathRevive() {
    const now = Date.now();
    if (now < this.deathFxUntil) return;
    this.deathFxUntil = now + DEATH_FX_LOCK_MS;
    this.deathCorpsePos = { x: this.renderYou.x, y: this.renderYou.y };
    this.spawnPlayerDeathGhost();
    playDeathRevive();
    const cam = this.cameras.main;
    cam.flash(160, 90, 18, 14, false);
    cam.fadeOut(140, 10, 4, 6);
    this.time.delayedCall(200, () => {
      // Snap to entrance (server already moved us) and light a wake beacon
      const corpse = this.deathCorpsePos;
      this.renderYou = { x: this.serverYou.x, y: this.serverYou.y };
      this.velX = 0;
      this.velY = 0;
      this.moveTarget = null;
      this.respawnBeaconPos = { x: this.serverYou.x, y: this.serverYou.y };
      this.respawnBeaconUntil = this.animT + RESPAWN_BEACON_MS;
      if (corpse) {
        const dx = this.serverYou.x - corpse.x;
        const dy = this.serverYou.y - corpse.y;
        if (Math.hypot(dx, dy) > 0.4) {
          this.deathAshTrail = {
            x0: corpse.x,
            y0: corpse.y,
            x1: this.serverYou.x,
            y1: this.serverYou.y,
            start: this.animT,
            until: this.animT + DEATH_ASH_TRAIL_MS,
          };
          spawnDissolveAsh(this.particles, corpse.x, corpse.y, false);
        }
      }
      this.deathCorpsePos = null;
      cam.fadeIn(560, 10, 4, 6);
    });
  }

  /**
   * Leave a bone/crimson afterimage at the death site while the respawn veil
   * plays — the body doesn't just teleport to the entrance.
   */
  private spawnPlayerDeathGhost() {
    const src = this.entitySprites.get("you");
    const fallback = worldToScreen(this.renderYou.x, this.renderYou.y);
    const sx = src?.x ?? fallback.sx;
    const sy = src?.y ?? fallback.sy;
    const fadeMs = 720;
    const key = src?.texture?.key;
    if (src && key && this.textures.exists(key)) {
      const ghost = this.add.image(sx, sy, key);
      ghost.setOrigin(src.originX, src.originY);
      ghost.setScale(src.scaleX, src.scaleY);
      ghost.setFlipX(src.flipX);
      ghost.setDepth((src.depth || 200) + 0.6);
      ghost.setTint(0xff6a4a);
      ghost.setAlpha(0.92);
      ghost.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: ghost,
        alpha: 0,
        y: sy - 36,
        scaleX: ghost.scaleX * 1.25,
        scaleY: ghost.scaleY * 1.55,
        duration: fadeMs,
        ease: "Cubic.easeOut",
        onComplete: () => ghost.destroy(),
      });
      const ash = this.add.image(sx, sy, key);
      ash.setOrigin(src.originX, src.originY);
      ash.setScale(src.scaleX * 0.96, src.scaleY * 0.96);
      ash.setFlipX(src.flipX);
      ash.setDepth((src.depth || 200) + 0.5);
      ash.setTint(0xd9cfae);
      ash.setAlpha(0.75);
      this.tweens.add({
        targets: ash,
        alpha: 0,
        y: sy - 14,
        x: sx + (Math.random() - 0.5) * 16,
        scaleX: ash.scaleX * 0.7,
        scaleY: ash.scaleY * 1.2,
        duration: fadeMs + 80,
        ease: "Quad.easeIn",
        onComplete: () => ash.destroy(),
      });
      return;
    }
    // Fallback: soft ellipse ghost if sprite missing
    const g = this.add.graphics();
    g.setDepth(250);
    g.fillStyle(0xff6a4a, 0.55);
    g.fillEllipse(sx, sy - 18, 28, 48);
    this.tweens.add({
      targets: g,
      alpha: 0,
      y: g.y - 28,
      duration: fadeMs,
      ease: "Cubic.easeOut",
      onComplete: () => g.destroy(),
    });
  }

  /** Edge arrows toward Lust / Dark Wood portals when the player is far from them. */
  private layoutCantoCompass() {
    const layer = document.getElementById("canto-compass");
    if (!layer || !this.room) {
      if (layer) layer.innerHTML = "";
      return;
    }
    if (document.body.classList.contains("has-modal")) {
      layer.innerHTML = "";
      return;
    }
    const cam = this.cameras.main;
    const view = cam.worldView;
    const vw = cam.width;
    const vh = cam.height;
    const compact = isCompactUi();
    const pad = {
      l: compact ? 14 : 16,
      r: compact ? 14 : 16,
      t: compact ? 70 : 62,
      b: compact ? 102 : 86,
    };
    const you = this.renderYou;
    const wanted: { dest: "lust" | "wood"; x: number; y: number; d: number }[] = [];
    for (const e of this.room.entities) {
      if (e.kind !== "exit" && !(e.kind === "poi" && e.poiKind === "portal")) continue;
      const dest =
        e.toCanto === "inferno_05" ? "lust" : e.toCanto === "inferno_01" ? "wood" : null;
      if (!dest) continue;
      const pos = this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      if (d < COMPASS_HIDE_RANGE) continue;
      wanted.push({ dest, x: pos.x, y: pos.y, d });
    }
    // Death ash trail: briefly pulse compass and steer a Wake pip toward the beacon
    const ashTrail =
      this.deathAshTrail && this.animT < this.deathAshTrail.until ? this.deathAshTrail : null;
    layer.classList.toggle("compass-ash-active", Boolean(ashTrail));
    if (ashTrail) {
      wanted.push({
        dest: "wood",
        x: ashTrail.x1,
        y: ashTrail.y1,
        d: Math.max(
          Math.hypot(ashTrail.x1 - you.x, ashTrail.y1 - you.y),
          COMPASS_HIDE_RANGE + 0.5
        ),
      });
    }
    if (!wanted.length) {
      layer.classList.remove("compass-ash-active");
      if (layer.childElementCount) layer.innerHTML = "";
      return;
    }
    const existing = Array.from(layer.querySelectorAll<HTMLElement>(".compass-arrow"));
    const fadeSpan = Math.max(0.01, COMPASS_FADE_START - COMPASS_HIDE_RANGE);
    wanted.forEach((w, i) => {
      const pnt = worldToScreen(w.x, w.y);
      const sx = ((pnt.sx - view.x) / Math.max(1e-3, view.width)) * vw;
      const sy = ((pnt.sy - view.y) / Math.max(1e-3, view.height)) * vh;
      const cx = vw * 0.5;
      const cy = vh * 0.46;
      let dx = sx - cx;
      let dy = sy - cy;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) dx = 1;
      const tX = dx > 0 ? (vw - pad.r - cx) / dx : dx < 0 ? (pad.l - cx) / dx : 1e9;
      const tY = dy > 0 ? (vh - pad.b - cy) / dy : dy < 0 ? (pad.t - cy) / dy : 1e9;
      const tHit = Math.min(tX, tY);
      let ex = cx + dx * tHit;
      let ey = cy + dy * tHit;
      // Keep clear of the left-stick pocket on phones
      if (compact && ex < 88 && ey > vh - 170) ey = vh - 170;
      // Ash Wake pip: if beacon is on-screen, sit on it (not edge-clamped)
      const isAshTarget = Boolean(ashTrail) && i === wanted.length - 1;
      if (isAshTarget) {
        const onScreen =
          sx >= pad.l && sx <= vw - pad.r && sy >= pad.t && sy <= vh - pad.b;
        if (onScreen || Math.hypot(ashTrail!.x1 - you.x, ashTrail!.y1 - you.y) < 2.5) {
          ex = Math.max(pad.l, Math.min(vw - pad.r, sx));
          ey = Math.max(pad.t, Math.min(vh - pad.b, sy));
        }
      }
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      const label = w.dest === "lust" ? "Lust" : "Wood";
      // Fade (not pop) as the player approaches the portal.
      // Distance text fades earlier than the chevron/label so the arrow lingers alone.
      const alpha =
        w.d >= COMPASS_FADE_START
          ? 1
          : Math.max(0, Math.min(1, (w.d - COMPASS_HIDE_RANGE) / fadeSpan));
      const distFadeSpan = Math.max(0.01, COMPASS_DIST_FADE_START - COMPASS_HIDE_RANGE);
      const distAlpha =
        w.d >= COMPASS_DIST_FADE_START
          ? 1
          : Math.max(0, Math.min(1, (w.d - COMPASS_HIDE_RANGE) / distFadeSpan));
      let el = existing[i];
      if (!el) {
        el = document.createElement("div");
        el.className = "compass-arrow";
        el.innerHTML =
          `<span class="compass-chevron" aria-hidden="true"></span>` +
          `<span class="compass-label"></span>` +
          `<span class="compass-dist"></span>`;
        layer.appendChild(el);
      }
      if (el.getAttribute("data-dest") !== w.dest) el.setAttribute("data-dest", w.dest);
      const lab = el.querySelector(".compass-label");
      if (lab && lab.textContent !== label) lab.textContent = label;
      const distEl = el.querySelector<HTMLElement>(".compass-dist");
      const distTxt = `${Math.max(1, Math.round(w.d))}u`;
      if (distEl && distEl.textContent !== distTxt) distEl.textContent = distTxt;
      if (distEl) distEl.style.opacity = (distAlpha * 0.85).toFixed(3);
      el.style.left = `${ex.toFixed(1)}px`;
      el.style.top = `${ey.toFixed(1)}px`;
      el.style.setProperty("--ang", `${ang.toFixed(1)}deg`);
      el.style.opacity = alpha.toFixed(3);
      // Ash-trail: pulse the Wake pip (last injected target)
      const isAsh = isAshTarget;
      el.classList.toggle("compass-ash-pulse", isAsh || Boolean(ashTrail));
      if (isAsh) {
        if (lab) lab.textContent = "Wake";
        el.setAttribute("data-dest", "beacon");
        // Sync mini-compass pulse with corpse X fade (same life01)
        const life =
          1 -
          (this.animT - ashTrail!.start) /
            Math.max(1, ashTrail!.until - ashTrail!.start);
        const fade = Math.max(0, Math.min(1, life * life));
        el.style.setProperty("--corpse-fade", fade.toFixed(3));
        el.style.opacity = Math.max(alpha, 0.55 + fade * 0.4).toFixed(3);
        // Brief corpse → wake distance crumb on the compass
        const toWake = Math.hypot(ashTrail!.x1 - you.x, ashTrail!.y1 - you.y);
        const corpseSpan = Math.hypot(ashTrail!.x1 - ashTrail!.x0, ashTrail!.y1 - ashTrail!.y0);
        const crumbU = Math.max(1, Math.round(toWake > 0.4 ? toWake : corpseSpan));
        if (distEl) {
          distEl.textContent = `${crumbU}u`;
          distEl.classList.add("compass-corpse-crumb");
          distEl.title = "corpse → wake";
          distEl.style.opacity = (0.55 + fade * 0.45).toFixed(3);
        }
        el.classList.add("compass-corpse-wake");
        el.classList.toggle("compass-corpse-fade", fade < 0.85);
        // Faint corpse→wake line on the mini compass itself
        let wakeLine = el.querySelector<HTMLElement>(".compass-wake-line");
        if (!wakeLine) {
          wakeLine = document.createElement("span");
          wakeLine.className = "compass-wake-line";
          wakeLine.setAttribute("aria-hidden", "true");
          el.appendChild(wakeLine);
        }
        // Line stretches with fade; angle follows compass chevron
        wakeLine.style.opacity = (0.25 + fade * 0.55).toFixed(3);
        wakeLine.style.setProperty("--wake-len", `${(10 + fade * 14).toFixed(1)}px`);
        // Corpse X glyph fades into the wake-line tip as life drains
        let corpseX = el.querySelector<HTMLElement>(".compass-corpse-x");
        if (!corpseX) {
          corpseX = document.createElement("span");
          corpseX.className = "compass-corpse-x";
          corpseX.textContent = "✕";
          corpseX.setAttribute("aria-hidden", "true");
          el.appendChild(corpseX);
        }
        // Progress 0→1 along wake: starts at center, settles on tip as fade drops
        const tipT = 1 - fade;
        corpseX.style.setProperty("--corpse-x-t", tipT.toFixed(3));
        corpseX.style.opacity = (0.15 + fade * 0.85).toFixed(3);
      } else {
        el.classList.remove("compass-corpse-wake", "compass-corpse-fade");
        el.style.removeProperty("--corpse-fade");
        const d0 = el.querySelector(".compass-dist");
        if (d0) {
          d0.classList.remove("compass-corpse-crumb");
          (d0 as HTMLElement).removeAttribute("title");
        }
        el.querySelector(".compass-wake-line")?.remove();
        el.querySelector(".compass-corpse-x")?.remove();
        if (!ashTrail) el.classList.remove("compass-ash-pulse");
      }
    });
    for (let i = wanted.length; i < existing.length; i++) existing[i].remove();
  }

  update(_t: number, dtMs: number) {
    if (!this.room) return;
    const dtSec = Math.min(0.05, dtMs / 1000);
    this.lastDtSec = dtSec;
    this.animT += dtMs;
    this.tickStickyHold();
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
        const portal = this.nearestIsPortalTravel();
        if (portal) this.beginPortalHold(portal, { fromKey: true });
        else this.interactNearest();
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
    this.scanNearestInteract();
    this.maybeFootstepDust();
    this.resolvePendingCast();

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
            showToast("Portal near — hold Interact to enter Lust", "info");
          }
        }
      }
    }

    this.tickSpellKeyAim();
    this.tickPortalHold();
    this.redraw();
    this.centerOnYou(false);
    this.layoutVignette();
    this.layoutCantoCompass();
  }
}

function isComboMissToast(text: string): boolean {
  return (
    /out of range/i.test(text) ||
    /nothing to strike/i.test(text) ||
    /no foe in range/i.test(text) ||
    /lashes empty air/i.test(text)
  );
}
