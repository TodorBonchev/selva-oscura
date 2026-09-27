import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { GameSocket } from "../net/GameSocket";
import {
  showToast,
  updateStats,
  renderInventory,
  renderAh,
  getSelectedItemId,
  getSelectedItemSource,
  isStashMode,
  setStashMode,
  togglePanel,
  setPanelOpen,
  wireHud,
  isCompactUi,
  isLandscapeCompact,
  isPanelOpen,
  onPanelOpen,
  noteSpellCast,
  flashManaDeny,
  noteWardBuff,
  noteAttackCd,
  noteUtilityCd,
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
  flashSpellCancel,
  flashSlamSting,
  flashSlamSafeRim,
  hapticPortalComplete,
  setPortalHoldUi,
  setQuestLine,
  setTargetPlate,
  pulseVoidCorona,
  pulseAbyssChroma,
  pulseRiftShear,
  pulseHorizonFold,
  hapticCombat,
} from "../ui/hud";
import { flushStaleToasts, showCantoCard } from "../ui/toasts";
import { SPELLS, GALE_RANGE, BURST_RADIUS, type SpellId } from "../spells";
import { VirtualJoystick } from "../ui/virtualJoystick";
import {
  InterpStore,
  MOVE_SEND_MS,
  CAM_LERP_MOBILE,
  CAM_LERP_DESKTOP,
  reconcileLocal,
  expAlpha,
  type Vec2,
} from "../render/smoothing";
import { LabelDeclutter } from "./labelDeclutter";
import { CAM_BACK_PORTRAIT, CAM_HEIGHT_PORTRAIT, isPortraitCompact, camPlanarBasis, camRel, placeFollowCamera, setPlanar, tickCamLead, yawFromPlanar, UP } from "./frames";
import { loadMatKit, RARITY_HEX, type MatKit } from "./materials";
import {
  makeByKind,
  makeCerbero,
  makeCoinWisp,
  makeCounterweight,
  makeFilthCache,
  makeHoardHeart,
  makeLedgerBell,
  makeLedgerCache,
  makeLedgerShrine,
  makeLedgerStone,
  makeLedgerWarden,
  makeMireBell,
  makeMireChampion,
  makeMireShade,
  makeMireShrine,
  makeMireWarden,
  makeMudWisp,
  makeWeightChampion,
  makeWeightShade,
  modelFrontWorld,
  resolveKind,
  tintMireEnemy,
  type KindKey,
} from "./meshes";
import { applyEquippedLook, equipLookKey } from "./gearLook";
import { buildGround, type GroundRig } from "./ground";
import {
  AshField,
  makeBolt,
  makeBurst,
  makeDustPuff,
  makeHitFlash,
  makeImpactRing,
  makeLootBeam,
  makePortalHoldFx,
  makeTelegraph,
  makeWardRing,
  placeBolt,
  releaseSparkBurst,
  releaseFx,
  acquireFxRing,
  acquireFxMote,
  spawnSparks,
  spawnGoldDustSplash,
  spawnSludgeSplash,
  tickImpact,
  tickPortalHoldFx,
  tickSparks,
  type Bolt,
  type ImpactRing,
  type PortalHoldFx,
  type SparkBurst,
} from "./fx";
import { tickCounterweight, tickHoardHeart, tickHumanoid, tickHoardCrush, tickLedgerWarden, tickTripleMaw, tickWhirl } from "./anim";
import { makeComposer, type GradeOutputPass } from "./post";
import {
  FrameGovernor,
  FramePacer,
  flagsFor,
  pickInitialTier,
  type Tier,
  type TierFlags,
} from "./quality";
import { LightPool, VirtualLight, isVirtualLight } from "./lightPool";
import { applyTextureTier } from "./materials";
import { disposeNode3D, markShared, sharedGeo } from "./dispose";
import { HeroMotor, SWING_MS } from "./heroMotor";
import { humanoidCast, humanoidFlinch, humanoidSwing } from "./heroAnim";
import { disposeHero, setHeroGhost } from "./hero";
import type { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { Radar } from "../ui/radar";
import { Guidance } from "./guidance";
import { PointerInput } from "./pointerInput";
import { PickupFx } from "./pickupFx";
import { forwardGate, gateState, gateTitle, lockReason, visibleGates } from "./gates";
import { CombatView, isMobKind } from "./combatView";
import { teleWeight, type TelegraphLand, type TelegraphMsg } from "./telegraphs";
import { PlayerForces } from "./forces";
import { mechFor, type CantoMech, type MoveFeelOut } from "./cantoMech";
import { bodyRadius } from "./mobBodies";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";

type RoomSnap = any;

const INTERACT_RANGE = 5.2;
const INTERACT_HIGHLIGHT_RANGE = 5.0;
/** Soft snap: gentle pull / walk-in when just outside interact reach. */
const SOFT_SNAP_PULL_RANGE = 3.1;
/** Portals: longer soft-pull so gate lock tips fire before "Move closer". */
const SOFT_SNAP_PORTAL_PULL_RANGE = 5.8;
const SOFT_SNAP_USE_RANGE = 7.4;
const STICKY_INTERACT_MS = 480;
const EXIT_TRAVEL_RANGE = 6.2;
const GALE_STICKY_MS = 1600;
/** Must stay inside the server melee check (3.5) or swings toast "Out of range". */
const ATTACK_RANGE = 3.35;
const CHASE_RANGE = 26;
const AUTO_PICKUP_RANGE = 4.0;
const MAGNET_RANGE = 5.5;
const AUTO_PICKUP_RETRY_MS = 900;
/** Server bag cap (room.mjs handlePickup). */
const BAG_CAP = 40;
const PREDICT_SPEED = 8.0;
/** Portrait phones: ground half-width (m) the lens widens to show beside the hero, and its cap (°). */
const PORTRAIT_HALF_W = 5.8;
const PORTRAIT_FOV_MAX = 72;
/** Phones: foes farther than this (m) are not drawn (4 m hysteresis). */
const FOE_CULL_R = 58;
/** A POI hint longer than this is cut on a phone's toast (two landscape lines). */
const HINT_MAX = 110;
/** Client dash cooldown: the server's 4 s plus a margin for its tick and jitter. */
const DASH_CD_MS = 4060;
const MOVE_ACCEL = 28;
/** Coasting stop (no input): a planted stop, not a skid. */
const MOVE_FRICTION = 24;
/** Braking against the input on a reversal: plant, then push off (no moonwalk). */
const MOVE_BRAKE = 52;
/** Sideways slip decay (1/s) when steering: turns carve instead of drifting. */
const MOVE_SLIP = 9;
const TAP_ARRIVE = 0.35;
/** One swing (busy time) — heroMotor.SWING_MS, paced to the server's PLAYER_ATK_CD. */
const ATTACK_ANIM_MS = SWING_MS;
const SPELL_TELEGRAPH_MS: Record<string, number> = {
  gale_bolt: 180,
  whirl_ward: 260,
  infernal_burst: 300,
};
const SPELL_HOLD_CONFIRM_MS = 200;
const GALE_DRAG_AIM_PX = 26;
const PORTAL_HOLD_MS = 680;
const DEATH_FX_LOCK_MS = 1600;
const GALE_HOLD_TOAST_MS = 90;
const HIT_STOP_MS = 58;
/** Sun / rim offsets from the follow point, turned with the camera yaw. */
const SUN_OFF = camRel(14, 8);
const RIM_OFF = camRel(-10, -12);

/** Hold-to-attack source: the F key, the #btn-attack button, or a canvas pointer id. */
type AttackHoldSource = "key" | "button" | number;

type NodeRec = {
  id: string;
  kind: KindKey;
  group: THREE.Group;
  label: CSS2DObject;
  hpEl: HTMLElement;
  /** Label parts, looked up once at spawn (updateLabel runs per node per frame). */
  nameEl: HTMLElement;
  hpBar: HTMLElement;
  hpFill: HTMLElement;
  /** syncEntities pass that last saw this node (frame stamp instead of a per-frame Set). */
  seenAt: number;
  /** labelDeclutter state */
  dcCull?: boolean;
  dcCullShown?: boolean;
  dcFade?: boolean;
  dcNoName?: boolean;
  dcShift?: number;
};

/** Named parts tickFx/syncEntities animate — resolved once per node, not per frame. */
type NodeFx = {
  ribbon?: THREE.Object3D;
  galeDisc?: THREE.Object3D;
  galeRibbon?: THREE.Object3D;
  galeRing?: THREE.Object3D;
  portalInner?: THREE.Object3D;
  portalSparks?: THREE.Object3D;
  lootBeam?: THREE.Object3D;
  gem?: THREE.Object3D;
  judgeAura?: THREE.Object3D;
  crushBody?: THREE.Object3D;
  cwTelegraph?: THREE.Object3D;
  wardRing?: THREE.Object3D;
  stillRing?: THREE.Mesh;
  remoteRim?: VirtualLight;
};

const NODE_FX_NAMES: Record<string, keyof NodeFx> = {
  ribbon: "ribbon",
  galeDisc: "galeDisc",
  galeRibbon: "galeRibbon",
  galeRing: "galeRing",
  portalInner: "portalInner",
  portalSparks: "portalSparks",
  lootBeam: "lootBeam",
  gem: "gem",
  judgeAura: "judgeAura",
  crushBody: "crushBody",
  cwTelegraph: "cwTelegraph",
  wardRing: "wardRing",
  stillRing: "stillRing",
  avaRemoteRim: "remoteRim",
};

/** Fingerprint of everything renderInventory draws (bag, stash, worn gear, gear stats). */
function inventorySignature(you: any): string {
  const list = (items: any[] | undefined) => {
    let s = "";
    if (Array.isArray(items)) for (const it of items) s += `${it?.id}:${it?.name}:${it?.rarity},`;
    return s;
  };
  let worn = "";
  const eq = you.equipped || {};
  for (const slot in eq) worn += `${slot}=${eq[slot]?.id ?? ""};`;
  const gs = you.gearStats || {};
  return `${list(you.inventory)}|${list(you.stash)}|${worn}|${gs.dmg ?? 0},${gs.maxHp ?? 0},${gs.armor ?? 0}`;
}

/** First object per name in traversal order — same pick as getObjectByName. */
function collectNodeFx(root: THREE.Object3D): NodeFx {
  const fx: NodeFx = {};
  root.traverse((o) => {
    const key = NODE_FX_NAMES[o.name];
    if (key && !fx[key]) (fx as Record<string, THREE.Object3D>)[key] = o;
  });
  return fx;
}

export class WorldApp {
  socket: GameSocket;
  root: HTMLElement;
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  clock = new THREE.Clock();
  mats: MatKit | null = null;
  ground: GroundRig | null = null;
  trees: THREE.Object3D[] = [];
  ash: AshField | null = null;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  fill!: THREE.DirectionalLight;
  rim = new THREE.DirectionalLight(0xffe0b0, 1.7);
  /** Target-portal fill — a pooled light marker (see lightPool.ts). */
  portalLight = new VirtualLight(0xff6633, 0, 18, 2, 1.1);
  heroLight = new THREE.PointLight(0xffc878, 4.2, 12, 1.6);
  ambient = new THREE.AmbientLight(0x8a7a62, 0.48);
  clickMark: THREE.Group | null = null;
  composer: EffectComposer | null = null;
  gradePass: GradeOutputPass | null = null;
  bloom: UnrealBloomPass | null = null;
  hitLight = makeHitFlash();
  sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  /** Last requested sky colours (a canto can load before the dome exists). */
  skyColors: [number, number, number] | null = null;
  radar: Radar | null = null;
  /** Objective model + gates + compass/minimap/beacon (world/guidance.ts). */
  guidance: Guidance | null = null;
  frameN = 0;
  combatUntil = 0;
  lastChaseToast = 0;
  dashReadyAt = 0;
  lockedId: string | null = null;
  /** The hero's own foot ring (unshared material, tinted per canto). */
  selfRing: THREE.Mesh | null = null;
  /** Foe the bottom target plate shows (paintChrome): its world plate outranks the rest. */
  plateTargetId: string | null = null;
  declutter = new LabelDeclutter();
  lockRing: THREE.Mesh | null = null;
  wardMat = markShared(
    new THREE.MeshBasicMaterial({
      color: 0xff5533,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      depthWrite: false,
    })
  );
  /** Quality tier flags (quality.ts). */
  gfx: TierFlags;
  governor: FrameGovernor;
  pacer = new FramePacer();
  lightPool: LightPool;
  lastFrameAt = 0;
  /** Executed frames per wall-clock second, over ~1s windows (DEV render-info hook). */
  fps = 0;
  fpsFrames = 0;
  fpsSince = 0;
  /** syncEntities pass counter (NodeRec.seenAt). */
  syncStamp = 0;
  /** Throttled UTC day string for the radar's daily-writ check (no Date per frame). */
  utcDay = "";
  utcDayAt = 0;
  lastInvSig = "";
  prewarmPending = false;
  _packCounts = new Map<string, number>();
  fxWarm: THREE.Group | null = null;
  /** GPU counters of the last complete draw() (shadow + scene + post); DEV render-info hook. */
  frameInfo = { calls: 0, triangles: 0, points: 0, shadowPass: false };
  invDirty = true;
  lastLookKey = "";
  propAnims: THREE.Object3D[] = [];
  treeFadeTick = 0;
  /** paintChrome throttle (ms, performance.now) and last attack-button hint. */
  lastChromeAt = 0;
  lastFoeNear = false;
  /** Last sealed-gate warning (dedupes tap / Use / soft-snap). */
  lastDeny: { id: string; at: number } | null = null;
  /** scanNearestInteract throttle + the node currently wearing the prompt. */
  lastScanAt = 0;
  promptRecId = "";
  /** Canvas taps / hover / hold-to-move (pointerInput.ts). */
  pointer: PointerInput | null = null;
  _ndc = new THREE.Vector2();
  /** Reused walk-in target for soft snap (identity tells us when something else took over). */
  softSnapMove: Vec2 = { x: 0, y: 0 };
  /** Pooled fly-to-hero loot motes + the pickups we are waiting on (id → ms). */
  pickupFx: PickupFx | null = null;
  pickupFlyIds = new Map<string, number>();
  bagFullWarned = false;
  hubPortalToastShown = false;

  room: RoomSnap | null = null;
  joystick: VirtualJoystick;
  keys = new Set<string>();
  moveTarget: Vec2 | null = null;
  lastMoveSend = 0;
  serverYou: Vec2 = { x: 0, y: 0 };
  renderYou: Vec2 = { x: 0, y: 0 };
  predicting = false;
  /** Mobs + remote pilgrims: snapshot interpolation on the server clock (smoothing.ts). */
  interp = new InterpStore();
  /** Telegraphs, mob poses/flinch/death, hit flashes, combat numbers (combatView.ts). */
  combat: CombatView | null = null;
  /** Shoves / slow / root on the local pilgrim's prediction (forces.ts). */
  forces = new PlayerForces();
  /** Current canto's mechanic hooks (cantoMech/). */
  mech: CantoMech = mechFor(null);
  /** This frame's canto move feel (mech.moveFeel fills it once per frame). */
  moveFeel: MoveFeelOut = { speedMul: 1, accelMul: 1, driftX: 0, driftY: 0 };
  /** shove displacement not yet applied (forces.displacement), consumed by integrateVelocity */
  _fv: Vec2 = { x: 0, y: 0 };
  _fd: Vec2 = { x: 0, y: 0 };
  /** Canto mechanic collide() scratch (no allocation per move substep). */
  _mechP: Vec2 = { x: 0, y: 0 };
  /** Canvas CSS size (resize()), for screen-space overlays without a layout read. */
  viewW = 1;
  viewH = 1;
  /** performance.now() of the last death (no heal number for the respawn refill). */
  lastDeathAt = -1e9;
  /** Smooth directional camera shake: phase clock + the hit direction (planar). */
  shakeT = 0;
  shakeDirX = 1;
  shakeDirY = 0;
  velX = 0;
  velY = 0;
  aimX = 1;
  aimY = 0;
  animT = 0;
  lastCantoId: string | null = null;
  lastYouSnapshot: any = null;
  nodes = new Map<string, NodeRec>();
  youGroup: THREE.Group | null = null;
  camTarget = new THREE.Vector3();
  camFollow = new THREE.Vector3();
  /** Smoothed camera look-ahead along the hero's velocity (planar x, z). */
  camLead = { x: 0, z: 0 };
  camPunch = 0;
  camShake = 0;
  camFovKick = 0;
  hitFlashAmt = 0;
  netOffline = false;
  hubTipShown = false;
  glutEnterTipShown = false;
  avaEnterTipShown = false;
  lustEnterTipShown = false;
  seenFirstClears = new Set<string>();
  lustClearRevelShown = false;
  lustReturnGlutNudgeShown = false;
  glutAvaGateApproachShown = false;
  glutReturnAvaNudgeShown = false;
  seenLootIds = new Set<string>();
  seenInvItemIds = new Set<string>();
  autoPickupSent = new Map<string, number>();
  lastAutoPickupScan = 0;
  attackBusyUntil = 0;
  /** Hold-to-attack (button, F key, mouse held on a foe): swing whenever ready. */
  attackHeld = false;
  /**
   * Who is holding attack: "key" (F), "button" (#btn-attack) or a canvas pointer id
   * (mouse / finger held on a foe). One source lifting never ends another's hold —
   * a thumb on the button while a second finger taps a foe keeps swinging.
   */
  attackHolds = new Set<AttackHoldSource>();
  heroMotor: HeroMotor | null = null;
  /** Real (unclamped, un-hit-stopped) step of the current frame; null outside loop(). */
  frameRawDt: number | null = null;
  _pin: Vec2 = { x: 0, y: 0 };
  _step: Vec2 = { x: 0, y: 0 };
  lastHitFoe: { id: string; until: number } | null = null;
  deathFxUntil = 0;
  pendingCast: { spellId: SpellId; aimX: number; aimY: number; until: number } | null = null;
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
  portalHold: {
    target: any;
    fromKey: boolean;
    /** Started by arriving at a tapped gate: completes on its own, steering cancels. */
    auto: boolean;
    pointerId: number | null;
    startMs: number;
    completed: boolean;
    onUp: ((e: PointerEvent) => void) | null;
  } | null = null;
  portalHoldFx: PortalHoldFx | null = null;
  nearestInteract: { id: string; kind: string; label: string } | null = null;
  lastInteractHintId: string | null = null;
  /** Soft-snap: walk toward interactable then fire once in range. */
  softSnapTargetId: string | null = null;
  softSnapUntil = 0;
  /** Sticky interact prompt: keep last nearest briefly after leaving range. */
  stickyInteract: { id: string; kind: string; label: string; ent: any; until: number } | null = null;
  cerberoApproachShown = false;
  mireHeartDownToastShown = false;
  mireHeartSeenAlive = false;
  counterweightApproachShown = false;
  hoardHeartDownToastShown = false;
  hoardHeartSeenAlive = false;
  stormHeartDownToastShown = false;
  stormHeartSeenAlive = false;
  glutClearStashTipShown = false;
  avaClearStashTipShown = false;
  /** Post-Crush loot greed pull window (ms animT). */
  crushLootMagnetUntil = 0;
  /** Concurrent Avarice pack-death coin bursts (budget). */
  avaDeathBurstActive = 0;
  poiHintsShown = new Set<string>();
  mawPressureOn = false;
  crushPressureOn = false;
  crushEnrageShown = false;
  firstDeathTipShown = false;
  /** Faint ledger cells where Ava packs cleared (until refill). */
  emptyPackCells = new Map<string, { mesh: THREE.Mesh; x: number; z: number }>();
  lastPackAlive = new Map<string, number>();
  lastPackPos = new Map<string, { x: number; z: number }>();
  /** Shared coin-disc geometry for Ava pack-death bursts. */
  sharedCoinDiscGeo: THREE.CylinderGeometry | null = null;
  glutFogBase = 0.022;
  avaFogBase = 0.016;
  fogTargetDensity = 0.013;
  fogTargetColor = new THREE.Color(0x1c1812);
  clearTargetColor = new THREE.Color(0x1c1812);
  _clearScratch = new THREE.Color(0x1c1812);
  bolts: Bolt[] = [];
  wardUntil = 0;
  wardMesh: THREE.Mesh | null = null;
  bursts: { mesh: THREE.Mesh; start: number; dur: number; r: number }[] = [];
  teles: { mesh: THREE.Mesh; until: number; r: number }[] = [];
  sparks: SparkBurst[] = [];
  impacts: ImpactRing[] = [];
  hitStopUntil = 0;
  raycaster = new THREE.Raycaster();
  /** fadeTreeOccluders scratch (reused, not reallocated every other frame). */
  treeRayHits: THREE.Intersection[] = [];
  treeRayHidden = new Set<THREE.Object3D>();
  groundPlane = new THREE.Plane(UP, 0);
  tmp = new THREE.Vector3();
  tmp2 = new THREE.Vector3();
  running = false;

  constructor(root: HTMLElement, socket: GameSocket) {
    this.root = root;
    this.socket = socket;
    this.camera = new THREE.PerspectiveCamera(this.camFov(), 1, 0.2, isCompactUi() ? 170 : 240);
    const compact = isCompactUi();
    const pick = pickInitialTier(compact);
    this.gfx = flagsFor(pick.tier, compact);
    const dpr = window.devicePixelRatio || 1;
    this.governor = new FrameGovernor(this.gfx, Math.min(this.gfx.maxRatio, dpr), dpr, pick.pinned);
    this.renderer = new THREE.WebGLRenderer({
      // The scene renders into the composer's (non-MSAA) target, so canvas MSAA only
      // ever smoothed the final full-screen quad (~8% of a desktop frame for nothing).
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setClearColor(0x1c1812, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.enabled = this.gfx.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    // draw() resets per frame so composer passes add up; the totals of each finished
    // frame are copied to frameInfo (see __selvaRenderInfo)
    this.renderer.info.autoReset = false;
    root.appendChild(this.renderer.domElement);
    this.lightPool = new LightPool(this.scene, this.gfx.pointLights);
    this.applyGfxClasses();

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.style.position = "absolute";
    this.labelRenderer.domElement.style.inset = "0";
    this.labelRenderer.domElement.style.pointerEvents = "none";
    this.labelRenderer.domElement.className = "world-labels";
    root.appendChild(this.labelRenderer.domElement);

    document.addEventListener("visibilitychange", () => {
      document.body.classList.toggle("tab-hidden", document.hidden);
    });
    document.body.classList.toggle("tab-hidden", document.hidden);

    this.scene.fog = new THREE.FogExp2(0x1c1812, 0.009);
    this.hemi = new THREE.HemisphereLight(0xe8d4b0, 0x1a1410, 1.12);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe6c0, 1.85);
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    // Tight box around the camera focus: only the hero and nearby foes/props cast (the
    // frustum culls the rest), and 512² over 36u is ~5× sharper than 256² over 80u.
    this.sun.shadow.mapSize.set(512, 512);
    this.sun.shadow.camera.near = 4;
    this.sun.shadow.camera.far = 56;
    this.sun.shadow.camera.left = -18;
    this.sun.shadow.camera.right = 18;
    this.sun.shadow.camera.top = 18;
    this.sun.shadow.camera.bottom = -18;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(this.portalLight);
    this.scene.add(this.hitLight);

    // The old PMREM "environment" was a solid clear-colour cube (0x1c1812 — the env
    // scene had a light but no meshes), i.e. a dim constant ambient that cost two cube
    // lookups per pixel. This bump reproduces it: PI × env × ~0.75 envMapIntensity.
    this.ambient.intensity = 0.59;
    this.scene.add(this.ambient);
    this.fill = new THREE.DirectionalLight(0x88aacc, 0.55);
    // Light rig offsets are authored for the legacy camera side; camRel turns them with the camera yaw.
    const fillOff = camRel(-12, -8);
    this.fill.position.set(fillOff.x, 10, fillOff.z);
    this.scene.add(this.fill);
    this.rim.position.set(-10, 8, -12);
    this.scene.add(this.rim);
    this.scene.add(this.rim.target);

    this.joystick = new VirtualJoystick();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    // iOS often reports stale sizes on the orientationchange event itself.
    window.addEventListener("orientationchange", () => {
      this.resize();
      window.setTimeout(() => this.resize(), 200);
      window.setTimeout(() => this.resize(), 450);
    });
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", () => this.resize());
      vv.addEventListener("scroll", () => this.resize());
    }
  }

  async start() {
    this.mats = await loadMatKit(this.renderer);
    applyTextureTier(this.mats, this.gfx);
    this.youGroup = makeByKind("player", this.mats);
    this.youGroup.userData.entityId = "you";
    this.youGroup.scale.setScalar(1.42);
    {
      // Your own foot ring: its own (unshared) material and a bolder band than the
      // remotes' — on a phone the hero is ~35 px tall and must be found at a glance
      const ring = this.youGroup.getObjectByName("heroRing") as THREE.Mesh | undefined;
      if (ring) {
        const mat = (ring.material as THREE.MeshBasicMaterial).clone();
        ring.material = mat;
        ring.geometry = new THREE.RingGeometry(0.33, 0.47, 32);
        this.selfRing = ring;
      }
    }
    applyEquippedLook(this.youGroup, {});
    this.heroLight.position.set(0.08, 1.15, -0.42);
    this.heroLight.intensity = 3.4;
    this.heroLight.distance = 9;
    this.youGroup.add(this.heroLight);
    this.scene.add(this.youGroup);
    {
      const g = new THREE.Group();
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xe8c86a,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        depthWrite: false,
      });
      const outer = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.62, 28), ringMat);
      outer.rotation.x = -Math.PI / 2;
      const inner = new THREE.Mesh(
        new THREE.RingGeometry(0.12, 0.22, 20),
        new THREE.MeshBasicMaterial({
          color: 0xfff3c0,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          forceSinglePass: true,
          depthWrite: false,
        })
      );
      inner.rotation.x = -Math.PI / 2;
      inner.position.y = 0.02;
      const pip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8),
        new THREE.MeshBasicMaterial({ color: 0xe8c86a, transparent: true, opacity: 0.7, depthWrite: false })
      );
      pip.position.y = 0.28;
      g.add(outer, inner, pip);
      g.visible = false;
      this.clickMark = g;
      this.scene.add(g);
      const lock = new THREE.Mesh(
        new THREE.RingGeometry(0.72, 0.86, 28),
        new THREE.MeshBasicMaterial({
          color: 0xd63a2a,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          forceSinglePass: true,
          depthWrite: false,
        })
      );
      lock.rotation.x = -Math.PI / 2;
      lock.visible = false;
      this.lockRing = lock;
      this.scene.add(lock);
    }
    // Swing arcs, dash, death pose, blade trail and foot dust for your pilgrim
    this.heroMotor = new HeroMotor(this);
    {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const app = this;
      this.combat = new CombatView({
        scene: this.scene,
        camera: this.camera,
        root: this.root,
        interp: this.interp,
        get renderYou() {
          return app.renderYou;
        },
        nodes: this.nodes,
        standY: (x, y, lift) => this.standY(x, y, lift),
        surfaceY: (x, y) => this.surfaceY(x, y),
        cantoId: () => this.room?.cantoId,
        bounds: () => this.room?.bounds ?? null,
        rttMs: () => this.socket.rttMs,
        disposeNode: (rec) => this.disposeNode(rec as NodeRec),
        onTelegraphLand: (l) => this.onTelegraphLand(l),
      });
    }
    this.portalHoldFx = makePortalHoldFx();
    this.scene.add(this.portalHoldFx.group);
    this.pickupFx = new PickupFx(this.scene, isCompactUi());

    this.ash = new AshField(isCompactUi() ? 48 : 90, 0xe8d4b0);
    this.scene.add(this.ash.points);
    this.radar = new Radar();
    this.guidance = new Guidance(this);

    this.bindInput();
    // Inventory rebuilds are deferred while the bag is closed — catch up when it opens
    onPanelOpen((id) => {
      if (id === "inventory") this.refreshInventoryUi();
    });
    this.socket.on((msg) => this.onNet(msg));
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
      onAttackHoldStart: () => this.startAttackHold("button"),
      onAttackHoldEnd: () => this.stopAttackHold("button"),
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
      meltBag: () => this.socket.salvageBag(),
      stashSelected: () => {
        const id = getSelectedItemId();
        const src = getSelectedItemSource();
        if (!id || (src !== "bag" && src !== "stash")) {
          showToast("Select a bag or stash item", "warn");
          return;
        }
        if (src === "stash") this.socket.stashTake(String(id));
        else this.socket.stashPut(String(id));
      },
      sip: () => this.sip(),
      dash: () => this.dash(),
      castSpell: (spellId) => this.castSpell(spellId),
      onSpellHoldStart: (spellId, ev) => this.beginSpellHold(spellId, { fromKey: false, pointer: ev }),
      onSpellHoldMove: (_spellId, ev) => this.updateSpellHoldPointer(ev),
      onSpellHoldEnd: (_spellId, ev, cast) => {
        if (!cast) this.cancelSpellHold();
        else this.releaseSpellHold(true, ev);
      },
      onInteractHoldStart: (ev) => this.beginInteractHold(ev),
      onInteractHoldEnd: (ev, completed) => this.endInteractHold(ev, completed),
    });

    if (new URLSearchParams(location.search).has("debug")) {
      (window as any).__world = this;
      (window as any).__selfTestControls = () => this.selfTestControls();
    }

    {
      // Gradient dome (zenith → glowing horizon → ground haze); follows the camera.
      const skyMat = new THREE.ShaderMaterial({
        uniforms: {
          top: { value: new THREE.Color(0x0e0c09) },
          horizon: { value: new THREE.Color(0x5a4a34) },
          bottom: { value: new THREE.Color(0x1c1812) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 top;
          uniform vec3 horizon;
          uniform vec3 bottom;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 c = h > 0.0
              ? mix(horizon, top, pow(clamp(h * 1.6, 0.0, 1.0), 0.6))
              : mix(horizon, bottom, clamp(-h * 4.0, 0.0, 1.0));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      });
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(150, 24, 16), skyMat);
      // Drawn after the opaque world (depth-tested, no depth write): only the pixels the
      // floor and props leave uncovered run the sky shader, instead of the whole screen
      this.sky.renderOrder = 10;
      this.scene.add(this.sky);
      if (this.skyColors) this.setSky(...this.skyColors);
    }
    this.buildComposer();
    if (import.meta.env.DEV) this.exposeRenderInfo();
    this.running = true;
    this.clock.start();
    this.loop();
    document.getElementById("boot-veil")?.classList.add("out");
  }

  /** Render resolution: the governor's adaptive ratio (never above the tier cap or DPR). */
  pixelRatio(): number {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(dpr, this.governor ? this.governor.ratio : Math.min(1.2, dpr));
  }

  /** Tier cap for the ratio (benches pin this to compare like with like). */
  maxPixelRatio(): number {
    return this.governor.maxFor(this.gfx);
  }

  /** Apply a render ratio to the canvas, the composer targets and bloom together. */
  applyPixelRatio(pr: number) {
    this.governor.ratio = pr;
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    // Bloom runs at half the scene resolution (EffectComposer resets it to full)
    this.bloom?.setSize(Math.max(2, Math.round((w * pr) / 2)), Math.max(2, Math.round((h * pr) / 2)));
  }

  /** (Re)build the post chain for the current tier (bloom only on high). */
  buildComposer() {
    if (this.composer) {
      this.composer.dispose();
      for (const p of this.composer.passes) (p as { dispose?: () => void }).dispose?.();
      this.composer = null;
      this.gradePass = null;
      this.bloom = null;
    }
    const rig = makeComposer(this.renderer, this.scene, this.camera, { bloom: this.gfx.bloom });
    this.composer = rig.composer;
    this.gradePass = rig.grade;
    this.bloom = rig.bloom;
    this.applyPixelRatio(this.pixelRatio());
  }

  /** Scene → screen for the current tier (benches call this directly). */
  renderFrame() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Step down one quality tier (FrameGovernor asks; never steps back up). */
  setTier(tier: Tier) {
    if (tier === this.gfx.tier) return;
    const flags = flagsFor(tier, isCompactUi());
    this.gfx = flags;
    this.governor.setFlags(flags);
    this.renderer.shadowMap.enabled = flags.shadows;
    this.sun.castShadow = flags.shadows;
    this.lightPool.setCount(flags.pointLights);
    if (this.mats) applyTextureTier(this.mats, flags);
    this.buildComposer();
    this.applyGfxClasses();
    this.prewarmShaders();
    if (import.meta.env.DEV) console.info(`[gfx] tier → ${tier}`);
  }

  applyGfxClasses() {
    const b = document.body.classList;
    b.toggle("gfx-low", this.gfx.tier === "low");
    b.toggle("gfx-mid", this.gfx.tier === "mid");
    b.toggle("gfx-high", this.gfx.tier === "high");
  }

  /**
   * Compile every material in the scene for the current lights/target now, so the first
   * slam / portal hold / boss approach does not stall on a shader build mid-fight.
   */
  prewarmShaders() {
    if (!this.mats) return;
    if (!this.fxWarm) {
      // One hidden instance of each on-demand effect so its program exists before the
      // first slam / hit (compile() walks invisible objects too; hidden ones never draw)
      const g = new THREE.Group();
      g.name = "fxWarm";
      g.visible = false;
      g.add(makeImpactRing(0xffffff), makeDustPuff(), makeLootBeam(0xffffff));
      g.add(spawnSparks(0, 0, 0, 0xffffff, 0).points);
      g.add(makeBurst(this.mats));
      this.fxWarm = g;
      this.scene.add(g);
    }
    const r = this.renderer;
    const prev = r.getRenderTarget();
    // Composer tiers draw the scene into renderTarget1: compile for that program key
    if (this.composer) r.setRenderTarget(this.composer.renderTarget1);
    try {
      // compile(), not compileAsync(): both start every program build now (the driver
      // links in parallel; the first draw only waits if one is still linking), but
      // compileAsync then polls each material's program from a timer — and throws an
      // uncaught TypeError if a transient effect (impact ring, gate burst, loot beam)
      // is disposed before its program reports ready, e.g. a tier step mid-fight.
      r.compile(this.scene, this.camera);
    } catch {
      /* compile errors surface on the real draw too */
    }
    r.setRenderTarget(prev);
    this.governor.hold(2.5);
  }

  exposeRenderInfo() {
    (window as unknown as { __selvaRenderInfo?: () => unknown }).__selvaRenderInfo = () => {
      const info = this.renderer.info;
      const fi = this.frameInfo;
      const composerPR = this.composer ? (this.composer as unknown as { _pixelRatio: number })._pixelRatio : null;
      return {
        // Exactly one drawn frame; shadowPass says whether it included the (every Nth frame) shadow map
        calls: fi.calls,
        triangles: fi.triangles,
        points: fi.points,
        shadowPass: fi.shadowPass,
        programs: info.programs?.length ?? 0,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        pixelRatio: +this.renderer.getPixelRatio().toFixed(3),
        composer: Boolean(this.composer),
        composerPR,
        tier: this.gfx.tier,
        // Counted frames per second (averaging 1000/ms overstates it when intervals vary)
        fps: +(this.fps || 1000 / this.governor.ema).toFixed(1),
        frameMsEma: +this.governor.ema.toFixed(2),
        pointLights: this.lightPool.slots.length + 1,
      };
    };
  }

  camFov(): number {
    // (landscape phones: a touch tighter than before so the hero reads bigger than 31 px)
    if (isLandscapeCompact()) return 50;
    if (isCompactUi()) {
      if (isPortraitCompact()) {
        // Portrait is narrow: widen the lens until ±PORTRAIT_HALF_W m of ground show
        // beside the hero (a 54° lens showed ±4 m — packs struck from off-screen)
        const aspect = this.viewW > 1 && this.viewH > 1 ? this.viewW / this.viewH : window.innerWidth / Math.max(1, window.innerHeight);
        const dist = Math.hypot(CAM_BACK_PORTRAIT, CAM_HEIGHT_PORTRAIT);
        const v = (2 * Math.atan(PORTRAIT_HALF_W / (dist * Math.max(0.3, aspect))) * 180) / Math.PI;
        return Math.max(54, Math.min(PORTRAIT_FOV_MAX, v));
      }
      return 54;
    }
    return 52;
  }

  inCombat(): boolean {
    if (Date.now() < this.combatUntil) return true;
    if (!this.room) return false;
    const you = this.renderYou;
    for (const e of this.room.entities) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      if (Math.hypot(e.x - you.x, e.y - you.y) < 18) return true;
    }
    return false;
  }

  noteCombat() {
    this.combatUntil = Date.now() + 2800;
  }

  /** Shake the camera along planar (dirX, dirY) — the way the blow travels. */
  kickShake(amount: number, dirX = 0, dirY = 0) {
    if (amount > this.camShake) {
      this.camShake = amount;
      this.shakeT = 0;
    }
    const l = Math.hypot(dirX, dirY);
    if (l > 1e-4) {
      this.shakeDirX = dirX / l;
      this.shakeDirY = dirY / l;
    }
  }

  resize() {
    const vv = window.visualViewport;
    // Prefer the fixed #game-root box; fall back to visualViewport on compact
    // phones where browser chrome can leave clientWidth/Height stale for a beat.
    let w = this.root.clientWidth || window.innerWidth;
    let h = this.root.clientHeight || window.innerHeight;
    if ((!w || !h) && vv) {
      w = Math.round(vv.width) || w;
      h = Math.round(vv.height) || h;
    }
    this.viewW = w;
    this.viewH = h;
    this.camera.fov = this.camFov();
    this.camera.far = isCompactUi() ? 170 : 240;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.governor?.setDpr(window.devicePixelRatio || 1);
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    this.bloom?.setSize(Math.max(2, Math.round((w * pr) / 2)), Math.max(2, Math.round((h * pr) / 2)));
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    document.body.classList.toggle("hud-compact", isCompactUi());
    document.body.classList.toggle("hud-landscape", isLandscapeCompact());
  }

  bindInput() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.add(e.code);
      if (e.code === "KeyI") togglePanel("inventory");
      if (e.code === "KeyH") {
        togglePanel("ah");
        this.socket.ahBrowse();
      }
      if (e.code === "Digit1") this.beginSpellHold("gale_bolt", { fromKey: true });
      if (e.code === "Digit2") this.beginSpellHold("whirl_ward", { fromKey: true });
      if (e.code === "Digit3") this.beginSpellHold("infernal_burst", { fromKey: true });
      if (e.code === "Escape") {
        this.cancelSpellHold();
        this.cancelPortalHold();
      }
      if (e.code === "KeyQ") this.sip();
      if (e.code === "KeyF") this.startAttackHold("key");
      if (e.code === "Space") {
        e.preventDefault();
        this.dash();
      }
      if (e.code === "KeyE") {
        const portal = this.portalForUse();
        if (portal) this.beginPortalHold(portal, { fromKey: true });
        else this.interactNearest();
      }
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") {
        this.releaseSpellHold(true);
      }
      if (e.code === "KeyF") this.stopAttackHold("key");
    });
    // Focus lost with F / WASD / a mouse button down never sees the keyup: drop
    // the held keys and the attack hold, or the hero would fight (and chase) alone
    const dropHeld = () => {
      this.stopAttackHold();
      this.keys.clear();
    };
    window.addEventListener("blur", dropHeld);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) dropHeld();
    });
    // A mouse / finger held on a foe (pointerInput.tapAt) lets go of attack when it lifts
    const liftAttack = (e: PointerEvent) => {
      if (this.attackHolds.has(e.pointerId)) this.stopAttackHold(e.pointerId);
    };
    // (capture: a HUD element that stops the event's propagation can't strand the hold)
    window.addEventListener("pointerup", liftAttack, true);
    window.addEventListener("pointercancel", liftAttack, true);

    this.pointer = new PointerInput(this, this.renderer.domElement);
    this.renderer.domElement.addEventListener("pointerdown", (ev) => {
      if (!this.room) return;
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.("#action-bar, #panels, #hud button, #virtual-joystick, .vj-base, .vj-knob, #modal-backdrop")) {
        return;
      }
      if (this.joystick.isVisible() && this.joystick.containsClientPoint(ev.clientX, ev.clientY)) return;
      // Taps on loot / POIs / gates walk in; ground taps walk; foes attack
      this.pointer?.down(ev);
    });
    // A quick tap inside the floating-stick zone still counts as a world tap
    this.joystick.onTap = (x, y) => {
      if (this.room) this.pointer?.tapAt(x, y);
    };
  }

  ndcFromEvent(ev: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return this._ndc.set(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1
    );
  }

  /**
   * Tap/click on loot, a POI or a gate: walk there (no distance cap) and use it
   * on arrival — gates start the travel channel by themselves. Never stops the
   * hero without saying why.
   */
  walkToInteract(ent: any) {
    if (!this.room || !ent) return;
    const isPortal = ent.kind === "exit" || ent.poiKind === "portal";
    const you = this.youPos();
    const pos = ent.kind === "loot" ? this.lootRenderPos(ent) : this.entityRenderPos(ent);
    const d = Math.hypot(pos.x - you.x, pos.y - you.y);
    const reach = isPortal ? EXIT_TRAVEL_RANGE * 0.92 : INTERACT_RANGE * 0.92;
    if (isPortal && this.portalIsLocked(ent)) {
      // Sealed: say so, and still walk up to it if asked from afar
      this.denyLockedPortal(ent);
      this.softSnapTargetId = null;
      if (d > reach) this.setClickMove(this.clampToBounds(pos.x, pos.y));
      return;
    }
    if (d <= reach) {
      this.softSnapTargetId = null;
      this.fireInteract(ent);
      return;
    }
    if (this.portalHold) this.cancelPortalHold();
    this.softSnapTargetId = String(ent.id);
    // Walk-in budget scales with distance (a far gate is a long walk, not a 1.6 s glide)
    this.softSnapUntil = this.animT + Math.min(24000, (d / PREDICT_SPEED) * 1600 + 1500);
    this.softSnapMove.x = pos.x;
    this.softSnapMove.y = pos.y;
    this.moveTarget = this.softSnapMove;
    this.aimX = (pos.x - you.x) / (d || 1);
    this.aimY = (pos.y - you.y) / (d || 1);
  }

  /** Click-to-move: walk locally toward dest and stream predicted steps (never the far dest). */
  setClickMove(g: Vec2) {
    this.softSnapTargetId = null;
    const you = this.youPos();
    let dx = g.x - you.x;
    let dy = g.y - you.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.2) return;
    const maxD = 22;
    if (d > maxD) {
      dx = (dx / d) * maxD;
      dy = (dy / d) * maxD;
      g = this.clampToBounds(you.x + dx, you.y + dy);
    }
    this.moveTarget = g;
    this.aimX = dx / Math.hypot(dx, dy);
    this.aimY = dy / Math.hypot(dx, dy);
  }

  pickGround(ev: PointerEvent): Vec2 | null {
    return this.pickGroundClient(ev.clientX, ev.clientY);
  }

  pickGroundClient(clientX: number, clientY: number): Vec2 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = 400;
    if (this.ground?.floor) {
      const hit = this.raycaster.intersectObject(this.ground.floor, false)[0];
      this.raycaster.far = Infinity;
      if (hit) return this.clampToBounds(hit.point.x, hit.point.z);
    }
    this.raycaster.far = Infinity;
    const out = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, out)) return null;
    return this.clampToBounds(out.x, out.z);
  }

  pickEntity(ev: { clientX: number; clientY: number }): any | null {
    if (!this.room) return null;
    this.raycaster.setFromCamera(this.ndcFromEvent(ev), this.camera);
    this.raycaster.far = Infinity;
    const meshes: THREE.Object3D[] = [];
    for (const n of this.nodes.values()) meshes.push(n.group);
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (!hits.length) return null;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && obj.userData.entityId == null) obj = obj.parent;
    const id = obj?.userData.entityId as string | undefined;
    if (!id) return null;
    return this.room.entities.find((e: any) => String(e.id) === String(id)) ?? null;
  }

  youPos(): Vec2 {
    return this.renderYou;
  }

  entityRenderPos(e: { id: string; x: number; y: number }): Vec2 {
    // (the entity itself is the fallback: no allocation; callers only read it)
    return this.interp.pos(String(e.id), e);
  }

  clampToBounds(x: number, y: number): Vec2 {
    if (!this.room) return { x, y };
    const b = this.room.bounds;
    return {
      x: Math.max(1, Math.min(b.width - 1, x)),
      y: Math.max(1, Math.min(b.height - 1, y)),
    };
  }

  /** World +Y so meshes sit on the displaced dirt instead of clipping through it. */
  standY(x: number, y: number, lift = 0): number {
    return (this.ground?.heightAt(x, y) ?? 0) + lift;
  }

  /** Top of what is drawn at (x, y) — floor triangles or the boss dais (ground decals). */
  surfaceY(x: number, y: number, lift = 0): number {
    return (this.ground?.surfaceAt(x, y) ?? 0) + lift;
  }

  sendMoveThrottled(x: number, y: number) {
    const now = Date.now();
    if (now - this.lastMoveSend < MOVE_SEND_MS) return;
    this.lastMoveSend = now;
    this.socket.move(x, y);
  }

  loop = (now: number = performance.now()) => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    // Tab hidden: drain clock, skip sim/draw (rain + gold-dust CSS pause via .tab-hidden).
    if (document.hidden) {
      this.clock.getDelta();
      this.lastFrameAt = 0;
      this.fpsSince = 0;
      if (this.ash?.points) this.ash.points.visible = false;
      return;
    }
    // 60fps cap: 120Hz+ displays skip alternate vsyncs (accumulated, so no 40fps judder)
    if (!this.pacer.shouldRun(now)) return;
    if (this.ash?.points && !this.ash.points.visible) this.ash.points.visible = true;
    if (this.lastFrameAt > 0) this.noteFrameTime(now - this.lastFrameAt);
    this.lastFrameAt = now;
    this.countFrame(now);
    let dt = this.clock.getDelta();
    // (the hero's combat clock runs on real frame time: no clamp, no hit-stop)
    this.frameRawDt = dt;
    if (performance.now() < this.hitStopUntil) dt *= 0.15;
    // Below 20fps the game no longer runs in slow motion: movement catches up in ≤50ms
    // substeps (tick), bounded so one long stall can't spiral
    dt = Math.min(0.25, dt);
    this.animT += dt * 1000;
    this.tick(dt);
    this.draw(Math.min(0.1, dt));
    this.frameRawDt = null;
  };

  countFrame(now: number) {
    if (this.fpsSince <= 0) {
      this.fpsSince = now;
      this.fpsFrames = 0;
      return;
    }
    this.fpsFrames++;
    const span = now - this.fpsSince;
    if (span >= 1000) {
      this.fps = (this.fpsFrames * 1000) / span;
      this.fpsSince = now;
      this.fpsFrames = 0;
    }
  }

  /** Feed the resolution/tier governor with the interval between drawn frames. */
  noteFrameTime(ms: number) {
    const ev = this.governor.sample(ms);
    if (!ev) return;
    if (ev.tier) this.setTier(ev.tier);
    else if (ev.ratio != null) this.applyPixelRatio(ev.ratio);
  }

  tick(dt: number) {
    if (!this.room) return;
    this.heroMotor?.advance(this.frameRawDt ?? dt);
    const { fwd, right } = camPlanarBasis(this.camera);
    let fx = 0;
    let sx = 0;
    const stick = this.joystick.getVector(dt);
    if (stick && (stick.x !== 0 || stick.y !== 0)) {
      fx += -stick.y;
      sx += stick.x;
    }
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fx += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) sx += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) sx -= 1;

    const ix = fwd.x * fx + right.x * sx;
    const iy = fwd.z * fx + right.z * sx;
    this.predicting = false;
    // Canto mechanic: this frame's move feel (speed/accel multipliers, drift), then its tick
    const mf = this.moveFeel;
    mf.speedMul = 1;
    mf.accelMul = 1;
    mf.driftX = 0;
    mf.driftY = 0;
    this.mech.moveFeel?.(this, mf);
    this.mech.tick?.(this, dt);

    // Hold-to-attack: swing the moment the last one ends, re-targeting live foes
    if (this.attackHeld && this.heroMotor?.canSwing()) this.attackNearest({ silent: true });
    // Shoves: this frame's share of the displacement on wall-clock time (hit-stop can't
    // shorten it); the next integrateVelocity substep applies it
    const shove = this.forces.displacement(this._fd, performance.now());
    this._fv.x += shove.x;
    this._fv.y += shove.y;
    for (let rem = dt; rem > 1e-6; ) {
      const h = Math.min(0.05, rem);
      rem -= h;
      // Dash tween / death collapse pin the hero: no steering or move packets meanwhile
      const pinned = this.heroMotor ? this.heroMotor.pinnedPos(this._pin) : null;
      if (pinned) {
        // held by the motor (a dash outruns any shove)
        this._fv.x = 0;
        this._fv.y = 0;
      } else if (ix !== 0 || iy !== 0) this.applyContinuousMove(ix, iy, h);
      else if (this.moveTarget) this.advanceTapMove(h);
      else this.integrateVelocity(h, false);

      this.renderYou = reconcileLocal(this.renderYou, this.serverYou, h, this.predicting, {
        x: this.velX,
        y: this.velY,
      });
      if (pinned) this.renderYou = { x: pinned.x, y: pinned.y };
    }

    // Mobs + remote pilgrims: interpolated ~one snapshot behind the server clock
    const interpNow = performance.now();
    this.interp.update(interpNow);
    // (darting wisps follow their telegraph instead of the delayed samples)
    this.combat?.applyMotion(interpNow);

    this.autoPickupScan();
    this.pointer?.tick();
    this.tickSoftSnap();
    this.updateEmptyPackCells();
    this.scanNearestInteract();
    this.resolvePendingCast();
    this.tickPortalHold();
    this.tickSpellKeyAim();
    this.hintExit();

    if (this.ash) {
      const fight = this.inCombat();
      const ava = this.room.cantoId === "inferno_07";
      const idle =
        ava &&
        !fight &&
        Math.hypot(this.velX, this.velY) < 0.28 &&
        !this.moveTarget;
      // Idle Avarice: skip more ash motes — gold drift is CSS; keep GPU soft
      document.body.classList.toggle("ava-idle", idle);
      const ashStride = idle
        ? isCompactUi()
          ? 6
          : 4
        : ava && fight && isCompactUi()
          ? 3
          : fight || isCompactUi() || ava
            ? 2
            : 1;
      this.ash.tick(
        dt,
        this.room.bounds,
        this.room.cantoId === "inferno_05" ||
          this.room.cantoId === "inferno_06" ||
          ava,
        this.renderYou.x,
        this.renderYou.y,
        ashStride,
        this.frameN
      );
    } else {
      document.body.classList.remove("ava-idle");
    }

    this.idleLookAtFoes(dt);
    if (this.clickMark) {
      this.clickMark.visible = !!this.moveTarget;
      if (this.moveTarget) {
        setPlanar(this.clickMark.position, this.moveTarget.x, this.moveTarget.y, this.standY(this.moveTarget.x, this.moveTarget.y, 0.06));
        const pulse = 0.9 + Math.sin(this.animT * 0.01) * 0.12;
        this.clickMark.scale.setScalar(pulse);
      }
    }
  }

  /** Speed multiplier from the canto mechanic's feel and any slow / root on you. */
  externalSpeedMul(): number {
    return this.moveFeel.speedMul * this.forces.speedMul(performance.now());
  }

  applyContinuousMove(dx: number, dy: number, dtSec: number) {
    const len = Math.hypot(dx, dy);
    if (len > 0.001) {
      const nx = dx / len;
      const ny = dy / len;
      const mag = Math.min(1, len);
      const maxSp = PREDICT_SPEED * Math.max(0.35, mag) * (this.heroMotor?.moveScale() ?? 1) * this.externalSpeedMul();
      this.steerVelocity(nx, ny, MOVE_ACCEL * this.moveFeel.accelMul, maxSp, dtSec);
      if (mag > 0.2) {
        this.aimX = nx;
        this.aimY = ny;
      }
      // Soft snap pull toward nearby interactables (POI / loot / portal)
      const portalSnap = this.pickInteractable(SOFT_SNAP_PORTAL_PULL_RANGE);
      const snapRange =
        portalSnap && (portalSnap.ent.kind === "exit" || portalSnap.ent.poiKind === "portal")
          ? SOFT_SNAP_PORTAL_PULL_RANGE
          : SOFT_SNAP_PULL_RANGE;
      const snap =
        snapRange === SOFT_SNAP_PORTAL_PULL_RANGE ? portalSnap : this.pickInteractable(SOFT_SNAP_PULL_RANGE);
      if (snap && snap.d > 0.35) {
        const px = (snap.pos.x - this.renderYou.x) / snap.d;
        const py = (snap.pos.y - this.renderYou.y) / snap.d;
        const toward = nx * px + ny * py;
        if (toward > -0.15) {
          const t = 1 - snap.d / snapRange;
          const pull = t * t * 5.5;
          this.velX += px * pull * dtSec;
          this.velY += py * pull * dtSec;
        }
      }
      this.moveTarget = null;
    }
    this.integrateVelocity(dtSec, true);
  }

  advanceTapMove(dtSec: number) {
    if (!this.moveTarget) return;
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
    // Near target: cap speed so click doesn't overshoot relative to WASD stride
    const nearMag = d < 2.2 ? Math.max(0.4, d / 2.2) : 1;
    const maxSp = PREDICT_SPEED * nearMag * (this.heroMotor?.moveScale() ?? 1) * this.externalSpeedMul();
    this.steerVelocity(dx / d, dy / d, MOVE_ACCEL * this.moveFeel.accelMul, maxSp, dtSec);
    this.aimX = dx / d;
    this.aimY = dy / d;
    this.integrateVelocity(dtSec, true);
  }

  /**
   * Steer toward a unit heading: speed along it accelerates to maxSp (or eases
   * down to it), sideways slip decays so turns carve, and a reversal brakes hard
   * first — the body plants and pivots instead of moonwalking backwards.
   */
  steerVelocity(nx: number, ny: number, accel: number, maxSp: number, dtSec: number) {
    let along = this.velX * nx + this.velY * ny;
    const slip = Math.exp(-MOVE_SLIP * dtSec);
    const px = (this.velX - nx * along) * slip;
    const py = (this.velY - ny * along) * slip;
    if (along < 0) along = Math.min(0, along + MOVE_BRAKE * dtSec);
    else if (along > maxSp) along = Math.max(maxSp, along - MOVE_BRAKE * dtSec);
    else along = Math.min(maxSp, along + accel * dtSec);
    this.velX = nx * along + px;
    this.velY = ny * along + py;
  }

  integrateVelocity(dtSec: number, driven: boolean) {
    if (!driven) {
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
    const nowMs = performance.now();
    if (this.forces.rooted(nowMs)) {
      this.velX = 0;
      this.velY = 0;
    }
    // Root step into a sword cut (small, only with room to the target)
    const step = this.heroMotor ? this.heroMotor.stepVelocity(this._step) : this._step;
    // The canto's drift rides on top of the walk; a shove's displacement (taken in tick)
    // lands once, on the frame's first substep
    const ex = step.x + this.moveFeel.driftX;
    const ey = step.y + this.moveFeel.driftY;
    const shX = this._fv.x;
    const shY = this._fv.y;
    this._fv.x = 0;
    this._fv.y = 0;
    if (this.velX === 0 && this.velY === 0 && ex === 0 && ey === 0 && shX === 0 && shY === 0) {
      if (!driven) this.predicting = false;
      return;
    }
    let nx = this.renderYou.x + (this.velX + ex) * dtSec + shX;
    let ny = this.renderYou.y + (this.velY + ey) * dtSec + shY;
    // Bodies: slide around foes the way the server does (room.handleMove)
    if (this.room) {
      const canto = this.room.cantoId;
      for (const e of this.room.entities) {
        if ((e.kind !== "mob" && e.kind !== "boss") || !(e.hp > 0) || (Number(e.stunLeft) || 0) > 0.05) continue;
        const p = this.entityRenderPos(e);
        const rad = bodyRadius(e, canto);
        const ox = nx - p.x;
        const oy = ny - p.y;
        if (Math.abs(ox) >= rad || Math.abs(oy) >= rad) continue;
        const d = Math.hypot(ox, oy);
        if (d >= rad || d < 0.001) continue;
        nx = p.x + (ox / d) * rad;
        ny = p.y + (oy / d) * rad;
      }
    }
    // Canto props that are solid on the server (Lust windbreaks) push you out the same way
    if (this.mech.collide) {
      const cp = this._mechP;
      cp.x = nx;
      cp.y = ny;
      this.mech.collide(this, cp);
      nx = cp.x;
      ny = cp.y;
    }
    this.renderYou = this.clampToBounds(nx, ny);
    this.predicting = true;
    this.sendMoveThrottled(this.renderYou.x, this.renderYou.y);
  }

  draw(dt: number) {
    const compact = isCompactUi();
    this.renderer.info.reset();
    if (this.youGroup && this.heroMotor) {
      // Facing, swing/dash/death poses, blade trail and foot dust (heroMotor.ts)
      this.heroMotor.update(dt, {
        channeling: Boolean(this.portalHold && !this.portalHold.completed),
        dtRaw: this.frameRawDt ?? dt,
      });
      // Net-offline ghost swaps in translucent twins; shared hero materials stay opaque
      setHeroGhost(this.youGroup, this.netOffline);
    }

    this.syncEntities();
    // Foe plates: trash names off on phones, overlaps hidden, none over the hero (~10 Hz)
    this.declutter.tick(this, compact, performance.now());
    if (this.prewarmPending) {
      // New canto: ground + first entity wave exist now — build their programs up front
      this.prewarmPending = false;
      this.prewarmShaders();
    }
    if (this.pickupFx && this.youGroup) {
      const hp = this.youGroup.position;
      this.pickupFx.tick(performance.now(), hp.x, hp.y + 1.25, hp.z);
    }
    if (this.lockRing) {
      const lock = this.lockedId ? this.foeById(this.lockedId, 80) : null;
      this.lockRing.visible = Boolean(lock);
      if (lock) {
        setPlanar(this.lockRing.position, lock.pos.x, lock.pos.y, this.standY(lock.pos.x, lock.pos.y, 0.08));
        this.lockRing.rotation.z = this.animT * 0.004;
      }
    }

    setPlanar(this.camTarget, this.renderYou.x, this.renderYou.y, this.standY(this.renderYou.x, this.renderYou.y));
    // Look-ahead along the walk so the road in front gets the screen
    tickCamLead(this.camLead, this.velX, this.velY, dt, compact);
    this.camTarget.x += this.camLead.x;
    this.camTarget.z += this.camLead.z;
    const rate = compact ? CAM_LERP_MOBILE : CAM_LERP_DESKTOP;
    this.camFollow.lerp(this.camTarget, expAlpha(rate, dt));
    // Crush dais: lift look + floor so the camera clears the raised measure
    let lookY = 1.32;
    let floorLift = 4.6;
    if (this.room?.cantoId === "inferno_07") {
      const crush = this.room.entities.find(
        (e: any) => e.kind === "boss" && (e.id === "hoard_crush" || /^hoard crush$/i.test(String(e.name || "")))
      );
      if (crush) {
        const cpos = this.entityRenderPos(crush);
        const dDais = Math.hypot(cpos.x - this.renderYou.x, cpos.y - this.renderYou.y);
        if (dDais < 18) {
          const u = 1 - dDais / 18;
          lookY = 1.32 + 0.55 * u;
          floorLift = 4.6 + 0.85 * u;
        }
      }
    }
    placeFollowCamera(this.camera, this.camFollow, compact, lookY);
    if (this.camPunch > 0.001) {
      this.camera.position.addScaledVector(UP, this.camPunch * 0.42);
      this.camera.getWorldDirection(this.tmp);
      this.camera.position.addScaledVector(this.tmp, -this.camPunch * 1.45);
      this.camPunch *= Math.exp(-dt * 7.2);
    }
    const camFloor = this.standY(this.camera.position.x, this.camera.position.z, floorLift);
    this.camera.position.y = Math.max(this.camera.position.y, camFloor);
    if (this.camShake > 0.001) {
      // Smooth shake along the hit direction (a few detuned sines, not white noise)
      this.shakeT += dt;
      const a = this.camShake * 0.5;
      const t = this.shakeT;
      const along = Math.sin(t * 47) * 0.8 + Math.sin(t * 73 + 0.7) * 0.2;
      const side = Math.sin(t * 31 + 1.9) * 0.35;
      this.camera.position.x += (this.shakeDirX * along - this.shakeDirY * side) * a;
      this.camera.position.z += (this.shakeDirY * along + this.shakeDirX * side) * a;
      this.camera.position.y += Math.sin(t * 59 + 0.4) * a * 0.35;
      this.camShake *= Math.exp(-dt * 10);
    }
    const baseFov = this.camFov();
    if (Math.abs(this.camFovKick) > 0.02) {
      this.camera.fov = baseFov + this.camFovKick;
      this.camera.updateProjectionMatrix();
      this.camFovKick *= Math.exp(-dt * 9);
    } else if (this.camera.fov !== baseFov) {
      this.camera.fov = baseFov;
      this.camera.updateProjectionMatrix();
      this.camFovKick = 0;
    }
    if (this.gradePass) this.gradePass.flash.value = this.hitFlashAmt;
    this.hitFlashAmt = this.hitFlashAmt > 0.004 ? this.hitFlashAmt * Math.exp(-dt * 8.5) : 0;

    this.sky?.position.set(this.camFollow.x, 0, this.camFollow.z);
    this.sun.position.set(this.camFollow.x + SUN_OFF.x, 22, this.camFollow.z + SUN_OFF.z);
    this.sun.target.position.copy(this.camFollow);
    this.rim.position.set(this.camFollow.x + RIM_OFF.x, 9, this.camFollow.z + RIM_OFF.z);
    this.rim.target.position.copy(this.camFollow);

    this.heroMotor?.setPalette(this.room?.cantoId === "inferno_07");

    this.frameN++;
    const inCombatRoom =
      this.room?.cantoId === "inferno_05" ||
      this.room?.cantoId === "inferno_06" ||
      this.room?.cantoId === "inferno_07";
    const inGlut = this.room?.cantoId === "inferno_06";
    const inAva = this.room?.cantoId === "inferno_07";
    const fighting = this.inCombat();
    // Resolution is owned by the FrameGovernor (noteFrameTime → applyPixelRatio)
    const shadowEvery = compact && inCombatRoom ? (inAva ? 5 : 3) : 2;
    const remoteN = this.room?.players ? this.room.players.length - 1 : 0;
    // Compact combat cantos share Ava label cadence (Lust/Glut parity)
    const labelEvery =
      remoteN >= 2
        ? compact
          ? inCombatRoom
            ? 6
            : 5
          : inCombatRoom
            ? 4
            : 3
        : compact && fighting
          ? inCombatRoom
            ? 4
            : 3
          : 2;
    const shadowPass = this.renderer.shadowMap.enabled && this.frameN % shadowEvery === 0;
    if (shadowPass) this.renderer.shadowMap.needsUpdate = true;
    if (inGlut && this.frameN % 4 === 0) this.tickMawPressure();
    this.tickAtmosphere();
    this.fadeTreeOccluders();
    this.tickFx(dt);
    // Telegraphs, flashes, ash, corpses, combat numbers (after the camera is placed)
    this.combat?.tick(performance.now(), this.viewW, this.viewH);
    this.lightPool.update(this.camFollow, dt);
    this.renderFrame();
    // One finished frame: readers between frames (or mid-bench) never see a partial sum
    const fi = this.frameInfo;
    const ri = this.renderer.info.render;
    fi.calls = ri.calls;
    fi.triangles = ri.triangles;
    fi.points = ri.points;
    fi.shadowPass = shadowPass;
    if (this.frameN % labelEvery === 0) {
      this.labelRenderer.render(this.scene, this.camera);
    }
    this.paintChrome();
    // Objective line + compass + minimap + beacon (self-throttled)
    this.guidance?.tick();
  }

  /** Stand still: slowly face the nearest shade so idle does not look frozen. */
  idleLookAtFoes(dt: number) {
    if (!this.room) return;
    if (Math.hypot(this.velX, this.velY) > 0.35) return;
    if (this.moveTarget || this.portalHold) return;
    const you = this.youPos();
    let best: { x: number; y: number } | null = null;
    let bestD = 13;
    for (const e of this.room.entities) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      const pos = this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      if (d < bestD) {
        bestD = d;
        best = pos;
      }
    }
    if (!best) return;
    let dx = best.x - you.x;
    let dy = best.y - you.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const k = Math.min(1, dt * 2.4);
    this.aimX += (dx - this.aimX) * k;
    this.aimY += (dy - this.aimY) * k;
    const n = Math.hypot(this.aimX, this.aimY) || 1;
    this.aimX /= n;
    this.aimY /= n;
  }

  /**
   * Fade trees that sit between the camera and the hero: anything the view ray
   * touches, plus every trunk on the camera side of the hero inside the view
   * corridor (their canopies otherwise fill the lower half of a phone screen).
   */
  fadeTreeOccluders() {
    if (!this.youGroup || !this.trees.length) return;
    this.treeFadeTick++;
    if (this.treeFadeTick % 2 !== 0) return;
    this.youGroup.getWorldPosition(this.tmp);
    this.tmp.y += 1.35;
    this.tmp2.copy(this.tmp).sub(this.camera.position);
    const dist = this.tmp2.length();
    if (dist < 0.4) return;
    this.tmp2.multiplyScalar(1 / dist);
    this.raycaster.set(this.camera.position, this.tmp2);
    this.raycaster.far = dist - 0.35;
    const hits = this.treeRayHits;
    hits.length = 0;
    this.raycaster.intersectObjects(this.trees, true, hits);
    this.raycaster.far = Infinity;
    const hidden = this.treeRayHidden;
    hidden.clear();
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.name !== "tree") o = o.parent;
      if (o) hidden.add(o);
    }
    // Planar axis hero → camera
    const px = this.tmp.x;
    const pz = this.tmp.z;
    let ax = this.camera.position.x - px;
    let az = this.camera.position.z - pz;
    const alen = Math.hypot(ax, az) || 1;
    ax /= alen;
    az /= alen;
    const portrait = isPortraitCompact();
    const halfW = portrait ? 5.2 : isCompactUi() ? 7.5 : 6.5;
    const heroDist = dist;
    // Trunks beside / behind the lens spill canopy into frame without projecting in view
    const nearR = portrait ? 9 : isCompactUi() ? 12 : 8.8;
    const camX = this.camera.position.x;
    const camZ = this.camera.position.z;
    for (const tree of this.trees) {
      const dx = tree.position.x - px;
      const dz = tree.position.z - pz;
      if (dx * dx + dz * dz > 45 * 45) {
        if (tree.userData.fade) this.setTreeFade(tree, false);
        continue;
      }
      const along = dx * ax + dz * az; // >0 = camera side of the hero
      const side = Math.abs(dx * az - dz * ax);
      const corridor = along > 1.2 && along < alen + 6 && side < halfW + along * 0.18;
      // Screen-space: a canopy nearer the lens than the hero that lands in the
      // lower two-thirds of the frame hides the play space (edges in landscape).
      let screen = false;
      if (along > -2) {
        this.tmp2.set(tree.position.x, tree.position.y + 8.5, tree.position.z);
        const dCam = this.tmp2.distanceTo(this.camera.position);
        if (dCam < heroDist + 4) {
          this.tmp2.project(this.camera);
          screen = this.tmp2.z < 1 && this.tmp2.y < 0.34 && Math.abs(this.tmp2.x) < 1.25;
        }
      }
      const cx = tree.position.x - camX;
      const cz = tree.position.z - camZ;
      const nearCam = cx * cx + cz * cz < nearR * nearR;
      const fade = hidden.has(tree) || corridor || screen || nearCam;
      if (tree.userData.fade !== fade) this.setTreeFade(tree, fade);
    }
  }

  setTreeFade(tree: THREE.Object3D, fade: boolean) {
    tree.userData.fade = fade;
    tree.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || m.name === "discShadow") return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const sm = mat as THREE.MeshStandardMaterial;
        if (!("opacity" in sm)) continue;
        // transparent selects a different shader variant (OPAQUE forces alpha=1)
        if (sm.transparent !== fade) sm.needsUpdate = true;
        sm.transparent = fade;
        sm.opacity = fade ? 0.16 : 1;
        sm.depthWrite = !fade;
      }
    });
  }

  tickFx(dt: number) {
    // Every list is compacted in place (write index + length): no per-frame arrays
    const t = this.animT;
    const nowMs = performance.now();
    const combat = this.combat;
    const bolts = this.bolts;
    let w = 0;
    for (let i = 0; i < bolts.length; i++) {
      const b = bolts[i];
      placeBolt(b, t);
      b.mesh.position.y += this.standY(b.mesh.position.x, b.mesh.position.z);
      if (t > b.start + b.dur) this.scene.remove(b.mesh);
      else bolts[w++] = b;
    }
    bolts.length = w;
    if (this.wardMesh) {
      this.wardMesh.visible = t < this.wardUntil;
      this.wardMesh.rotation.z = t * 0.004;
      if (this.youGroup) this.wardMesh.position.copy(this.youGroup.position).setY(this.youGroup.position.y + 0.15);
    }
    const bursts = this.bursts;
    w = 0;
    for (let i = 0; i < bursts.length; i++) {
      const b = bursts[i];
      if (t - b.start > b.dur) {
        this.scene.remove(b.mesh);
        (b.mesh.material as THREE.Material).dispose(); // per-burst material (shared sphere)
        continue;
      }
      const u = (t - b.start) / b.dur;
      b.mesh.scale.setScalar(b.r * (0.3 + u * 1.4));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.4 * (1 - u));
      bursts[w++] = b;
    }
    bursts.length = w;
    const sparks = this.sparks;
    w = 0;
    for (let i = 0; i < sparks.length; i++) {
      const sp = sparks[i];
      tickSparks(sp, t);
      if (t - sp.start > sp.dur) {
        this.scene.remove(sp.points);
        releaseSparkBurst(sp);
      } else sparks[w++] = sp;
    }
    sparks.length = w;
    const impacts = this.impacts;
    w = 0;
    for (let i = 0; i < impacts.length; i++) {
      const r = impacts[i];
      tickImpact(r, t);
      if (t - r.start > r.dur) {
        this.scene.remove(r.mesh);
        releaseFx(r.mesh);
      } else impacts[w++] = r;
    }
    impacts.length = w;
    if (this.hitLight.intensity > 0.05) this.hitLight.intensity *= Math.exp(-dt * 14);
    else this.hitLight.intensity = 0;
    const teles = this.teles;
    w = 0;
    const teleOp = 0.25 + 0.55 * Math.abs(Math.sin(t * 0.012));
    const teleScale = 0.85 + 0.15 * Math.sin(t * 0.02);
    for (let i = 0; i < teles.length; i++) {
      const tl = teles[i];
      (tl.mesh.material as THREE.MeshBasicMaterial).opacity = teleOp;
      tl.mesh.scale.setScalar(tl.r * teleScale);
      if (tl.until - t <= 0) {
        this.scene.remove(tl.mesh);
        releaseFx(tl.mesh);
      } else teles[w++] = tl;
    }
    teles.length = w;

    for (const n of this.nodes.values()) {
      const fx = n.group.userData.fx as NodeFx;
      const ribbon = fx.ribbon;
      if (ribbon) {
        const rdx = n.group.position.x - this.camFollow.x;
        const rdz = n.group.position.z - this.camFollow.z;
        if (rdx * rdx + rdz * rdz < 48 * 48) ribbon.rotation.y = this.animT * 0.003;
      }
      const disc = fx.galeDisc;
      if (disc) {
        (disc as THREE.Mesh).rotation.z = this.animT * 0.0015;
        let s = 1 + Math.sin(this.animT * 0.004) * 0.04;
        if (this.portalHold && String(this.portalHold.target?.id) === n.id) {
          const u = Math.min(1, (performance.now() - this.portalHold.startMs) / PORTAL_HOLD_MS);
          s = 1 + u * 0.22 + Math.sin(this.animT * 0.012) * 0.05;
        }
        disc.scale.set(s, s, 1);
      }
      const galeRibbon = fx.galeRibbon;
      if (galeRibbon) galeRibbon.rotation.y += 0.0008;
      const galeRing = fx.galeRing;
      if (galeRing) galeRing.rotation.z = -this.animT * 0.0022;
      const inner = fx.portalInner;
      if (inner) {
        const hubGlow =
          this.room?.cantoId === "inferno_07" &&
          Boolean(n.group.userData.avaHubHomeGlow) &&
          Array.isArray(this.room?.you?.firstClears) &&
          this.room.you.firstClears.includes("inferno_07");
        inner.rotation.y = this.animT * (hubGlow ? 0.006 : 0.003);
        if (hubGlow && this.frameN % 2 === 0) {
          const s = 1 + Math.sin(this.animT * 0.008) * 0.12;
          inner.scale.set(s, s, 1);
        }
      }
      const ps = fx.portalSparks as THREE.Points | undefined;
      if (ps && this.frameN % 2 === 0) {
        const px = n.group.position.x - this.camFollow.x;
        const pz = n.group.position.z - this.camFollow.z;
        if (px * px + pz * pz < 42 * 42) {
          const hubGlow = Boolean(n.group.userData.avaHubHomeGlow);
          const arr = (ps.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
          const rise = hubGlow ? 0.028 : 0.018;
          const cap = hubGlow ? 4.2 : 3.6;
          for (let i = 0; i < arr.length / 3; i++) {
            arr[i * 3 + 1] += rise;
            if (arr[i * 3 + 1] > cap) arr[i * 3 + 1] = 0.35;
          }
          (ps.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
          if (hubGlow) {
            const mat = ps.material as THREE.PointsMaterial;
            mat.opacity = 0.78 + Math.sin(this.animT * 0.007) * 0.18;
            mat.size = 0.13;
            mat.color.setHex(0xf2dea0);
          }
        }
      }
      // (Far portal glows need no culling: the LightPool only lights markers near the camera)
      const beam = fx.lootBeam;
      if (beam) {
        const avaLoot = this.room?.cantoId === "inferno_07";
        const crushPile = Boolean((n.label?.element as HTMLElement | undefined)?.classList.contains("ava-crush-pile"));
        // Far cull on compact Avarice — beam tick is free when off-screen
        if (avaLoot && isCompactUi()) {
          const bx = n.group.position.x - this.camFollow.x;
          const bz = n.group.position.z - this.camFollow.z;
          if (bx * bx + bz * bz > 30 * 30) {
            beam.visible = false;
          } else {
            beam.visible = true;
          }
        }
        if ((beam as THREE.Object3D).visible !== false) {
          beam.rotation.y = this.animT * (crushPile ? 0.0045 : avaLoot ? 0.0032 : 0.002);
          const mat = (beam as THREE.Mesh).material as THREE.MeshBasicMaterial;
          mat.opacity = crushPile
            ? 0.52 + Math.sin(this.animT * 0.01 + n.group.position.x) * 0.22
            : avaLoot
              ? 0.38 + Math.sin(this.animT * 0.008) * 0.2
              : 0.28 + Math.sin(this.animT * 0.006) * 0.12;
        }
        // Stagger Crush-dais loot labels so the pile does not read as one glyph
        if (crushPile && n.label) {
          const phase = (n.group.position.x * 0.7 + n.group.position.z * 0.4) % 1;
          n.label.position.y = 1.55 + phase * 0.55 + Math.sin(this.animT * 0.004 + phase * 6) * 0.08;
        }
      }
      const gem = fx.gem;
      if (gem) {
        const gx = n.group.position.x - this.camFollow.x;
        const gz = n.group.position.z - this.camFollow.z;
        const gemR = isCompactUi() ? 26 : 40;
        if (gx * gx + gz * gz < gemR * gemR) {
          gem.rotation.y = this.animT * 0.004;
          gem.position.y = 0.38 + Math.sin(this.animT * 0.005) * 0.08;
        }
      }
      if (n.kind === "guide" || n.kind === "player") {
        const hdx = n.group.position.x - this.renderYou.x;
        const hdz = n.group.position.z - this.renderYou.y;
        // Skip far remotes/guides — idle pose freezes; resume when near.
        const humR = isCompactUi() ? 28 : 42;
        if (hdx * hdx + hdz * hdz < humR * humR) {
          // Remote pilgrims walk/run at their tracked speed (see syncEntities)
          const gait = n.kind === "player" ? Number(n.group.userData.gaitSpeed) || 0 : 0;
          tickHumanoid(n.group, { moving: gait > 0.6, tMs: this.animT, attacking: false, speed: gait });
          // a swinging pilgrim draws its blade trail (pooled, see heroMotor)
          if (n.kind === "player") this.heroMotor?.remoteTick(n.group, dt);
        }
        // The Guide turns to meet an approaching pilgrim (it would otherwise show
        // the phone camera its back)
        if (n.kind === "guide" && hdx * hdx + hdz * hdz < 14 * 14) {
          const want = yawFromPlanar(-hdx, -hdz);
          const d = Math.atan2(Math.sin(want - n.group.rotation.y), Math.cos(want - n.group.rotation.y));
          n.group.rotation.y += d * Math.min(1, dt * 3.5);
        }
      }
      if ((n.kind === "whirl" || n.kind === "champion") && this.frameN % 2 === 0) {
        // Far cull ribbon sparkle for wisps + weight shades (Avarice density)
        const wx = n.group.position.x - this.camFollow.x;
        const wz = n.group.position.z - this.camFollow.z;
        const compact = isCompactUi();
        const avaDense = this.room?.cantoId === "inferno_07";
        const cullR = n.group.userData.coinWisp
          ? compact
            ? 28
            : 36
          : compact
            ? avaDense
              ? 28
              : 34
            : 44;
        const stunned = Number(n.group.userData.stunLeft || 0) > 0.05;
        if (wx * wx + wz * wz > cullR * cullR) {
          /* skip far idle */
        } else if (stunned) {
          const bob = fx.ribbon;
          if (bob) bob.position.y = 0.95 + Math.sin(this.animT * 0.0012) * 0.03;
        } else if (n.group.userData.isHoardHeart) {
          tickHoardHeart(n.group, this.animT);
        } else if (n.group.userData.isCounterweight) {
          tickCounterweight(n.group, this.animT);
          const cwTele = fx.cwTelegraph as THREE.Mesh | undefined;
          if (cwTele) {
            const mat = cwTele.material as THREE.MeshBasicMaterial;
            mat.opacity = 0.22 + Math.sin(this.animT * 0.004) * 0.1;
            const s = 1 + Math.sin(this.animT * 0.0032) * 0.06;
            cwTele.scale.set(s, s, 1);
          }
        } else if (n.group.userData.isLedgerWarden) {
          tickLedgerWarden(n.group, this.animT);
        } else {
          tickWhirl(n.group, this.animT, n.kind === "champion");
          // Attack windup sync — raise weight discs while champ telegraph is live
          const wLeft = Number(n.group.userData.windupLeft || 0);
          if (n.kind === "champion") {
            let discs = n.group.userData.windDiscs as THREE.Object3D[] | undefined;
            if (!discs) {
              discs = [];
              n.group.traverse((o) => {
                if (o.name === "weightDisc") discs!.push(o);
              });
              n.group.userData.windDiscs = discs;
            }
            const raise = wLeft > 0.05 ? Math.min(1, wLeft / 0.62) * 0.22 : 0;
            for (const d of discs) {
              if (d.userData.baseY == null) d.userData.baseY = d.position.y;
              d.position.y = Number(d.userData.baseY) + raise;
            }
          }
        }
      }
      if (n.kind === "triple_maw" && this.frameN % 2 === 0) {
        tickTripleMaw(n.group, this.animT);
      }
      if (n.kind === "hoard_crush" && this.frameN % (isCompactUi() ? 3 : 2) === 0) {
        const hx = n.group.position.x - this.camFollow.x;
        const hz = n.group.position.z - this.camFollow.z;
        const d2 = hx * hx + hz * hz;
        const crushIdleR = isCompactUi() ? 38 : 52;
        if (d2 < crushIdleR * crushIdleR) {
          tickHoardCrush(n.group, this.animT);
        }
        let glow = n.group.userData.crushGlow as VirtualLight | null | undefined;
        if (glow === undefined) {
          const found = n.group.getObjectByName("crushGlow");
          glow = isVirtualLight(found) ? found : null;
          n.group.userData.crushGlow = glow;
        }
        if (glow) {
          const compact = isCompactUi();
          const nearI = compact ? 2.1 : 3.0;
          const midI = compact ? 1.15 : 1.8;
          const farI = compact ? 0.35 : 0.6;
          glow.intensity = d2 > 40 * 40 ? farI : d2 > 22 * 22 ? midI : nearI;
          glow.visible = d2 < (compact ? 40 * 40 : 48 * 48);
          glow.distance = compact ? 10 : 14;
        }
        // Windup / phase-2: hot iron emissive telegraph (capped on compact light budget)
        const wind = Number(n.group.userData.windupLeft || 0);
        const phase = Number(n.group.userData.bossPhase || 1);
        const body = fx.crushBody as THREE.Mesh | undefined;
        if (body && body.material && !Array.isArray(body.material)) {
          const mat = body.material as THREE.MeshStandardMaterial;
          const compact = isCompactUi();
          if (wind > 0.05) {
            const windMax = phase >= 2 ? 1.0 : 1.4;
            mat.emissiveIntensity =
              (phase >= 2 ? 0.72 : 0.55) + (windMax - Math.min(windMax, wind)) * (phase >= 2 ? 0.75 : 0.55);
            if (glow)
              glow.intensity = Math.max(
                glow.intensity,
                compact ? (phase >= 2 ? 3.4 : 2.8) : phase >= 2 ? 5.4 : 4.2
              );
          } else if (phase >= 2) {
            mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 0.48);
            if (glow) glow.intensity = Math.max(glow.intensity, compact ? 2.2 : 3.4);
          }
        }
      }
      // Foes: facing, lean, bob, attack windup/strike, flinch (after their idle anim above)
      if (combat && isMobKind(n.kind)) {
        const mx = n.group.position.x - this.camFollow.x;
        const mz = n.group.position.z - this.camFollow.z;
        combat.tickMob(n, dt, nowMs, mx * mx + mz * mz < 48 * 48);
      }
      const aura = fx.judgeAura;
      if (aura && this.frameN % 2 === 0) {
        const ax = n.group.position.x - this.camFollow.x;
        const az = n.group.position.z - this.camFollow.z;
        if (ax * ax + az * az < 50 * 50) {
          const s = 1 + Math.sin(this.animT * 0.004) * 0.08;
          aura.scale.set(s, s, 1);
        }
      }
    }
    if (!this.inCombat() || this.frameN % 2 === 0) {
      const glut = this.room?.cantoId === "inferno_06";
      const ava = this.room?.cantoId === "inferno_07";
      // Freeze boss-arena pulse when camera is far (big win on compact Gluttony/Avarice).
      const daisNear =
        !(glut || ava) ||
        (this.camFollow.x - 138) * (this.camFollow.x - 138) +
          (this.camFollow.z - 48) * (this.camFollow.z - 48) <
          48 * 48;
      for (const o of this.propAnims) {
        if (o.name === "galeRibbon" || o.name === "ember") {
          const px = o.position.x + (o.parent?.position.x || 0);
          const pz = o.position.z + (o.parent?.position.z || 0);
          const dx = px - this.camFollow.x;
          const dz = pz - this.camFollow.z;
          if (dx * dx + dz * dz < 40 * 40) {
            if (o.name === "galeRibbon") o.rotation.y = Math.sin(this.animT * 0.0009) * 0.18;
            else {
              const s = 0.92 + Math.sin(this.animT * 0.009 + o.id) * 0.14;
              o.scale.setScalar(s);
            }
          }
        }
        if (!daisNear && (o.name === "daisPulse" || o.name === "daisTelegraph")) continue;
        if (o.name === "daisPulse") {
          o.rotation.z = this.animT * 0.0012;
          const s = 1 + Math.sin(this.animT * 0.0035) * 0.045;
          o.scale.set(s, s, 1);
        }
        if (o.name === "daisTelegraph") {
          const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial;
          const nearCrush =
            this.room?.cantoId === "inferno_07" &&
            (this.camFollow.x - 138) * (this.camFollow.x - 138) +
              (this.camFollow.z - 48) * (this.camFollow.z - 48) <
              26 * 26;
          const base = nearCrush ? 0.28 : 0.14;
          const amp = nearCrush ? 0.14 : 0.1;
          mat.opacity = base + Math.sin(this.animT * 0.004) * amp;
          const s = 1 + Math.sin(this.animT * 0.003) * (nearCrush ? 0.08 : 0.06);
          o.scale.set(s, s, 1);
        }
      }
    }
    if (!this.inCombat() || this.frameN % 2 === 0) {
      const px = this.renderYou.x;
      const pz = this.renderYou.y;
      for (const tree of this.trees) {
        const dx = tree.position.x - px;
        const dz = tree.position.z - pz;
        if (dx * dx + dz * dz > 30 * 30) continue;
        tree.rotation.z = Math.sin(this.animT * 0.0007 + tree.id * 0.13) * 0.032;
        tree.rotation.x = Math.sin(this.animT * 0.00055 + tree.id * 0.21) * 0.018;
      }
    }
  }

  syncEntities() {
    if (!this.room || !this.mats) return;
    const stamp = ++this.syncStamp;
    // Live ward heart (storm/mire/hoard), found once per frame instead of once per mob
    let heart: any = null;
    for (const h of this.room.entities) {
      const a = h.archetype;
      if ((a === "storm_heart" || a === "mire_heart" || a === "hoard_heart") && (h.hp == null || h.hp > 0)) {
        heart = h;
        break;
      }
    }
    const you = this.renderYou;
    const cullR2 = isCompactUi() && this.room.cantoId !== "inferno_01" ? FOE_CULL_R * FOE_CULL_R : 0;
    const cullIn2 = (FOE_CULL_R - 4) * (FOE_CULL_R - 4);
    try {
    for (const e of this.room.entities) {
      const id = String(e.id);
      const kind = resolveKind(e);
      let rec = this.nodes.get(id);
      if (!rec || rec.kind !== kind) {
        if (rec) this.disposeNode(rec);
        rec = this.spawnNode(id, kind, e);
      }
      rec.seenAt = stamp;
      const pos = e.kind === "loot" ? this.lootRenderPos(e) : this.entityRenderPos(e);
      setPlanar(rec.group.position, pos.x, pos.y, this.standY(pos.x, pos.y));
      if (cullR2 > 0 && e.kind === "mob") {
        // Phones: foes far across the canto (a speck at the top of the frame, deep in
        // fog) are not drawn — ~11 draws each, and Avarice's ring put 19 of them in view
        const dx = pos.x - you.x;
        const dy = pos.y - you.y;
        const d2 = dx * dx + dy * dy;
        const ud = rec.group.userData;
        const culled = ud.distCulled ? d2 > cullIn2 : d2 > cullR2;
        if (culled !== Boolean(ud.distCulled)) {
          ud.distCulled = culled;
          rec.group.visible = !culled;
        }
      }
      // (foes face their travel / attack / melee target in combatView.tickMob)
      if (e.kind === "mob" && (e.champion || e.archetype === "weight_champion")) {
        rec.group.userData.windupLeft = Number(e.windupLeft) || 0;
      }
      if (e.kind === "boss") {
        rec.group.userData.windupLeft = Number(e.windupLeft) || 0;
        const ph = Number(e.phase) || 1;
        rec.group.userData.bossPhase = ph;
        if (this.room?.cantoId === "inferno_07" && e.id === "hoard_crush") {
          if (ph >= 2 && !this.crushEnrageShown) {
            this.crushEnrageShown = true;
            document.body.classList.add("crush-enrage");
            window.setTimeout(() => document.body.classList.remove("crush-enrage"), 1400);
            this.camPunch = Math.max(this.camPunch, 0.95);
            this.camShake = Math.max(this.camShake, 0.55);
          }
          document.body.classList.toggle("crush-phase2", ph >= 2);
        }
      }
      if (e.kind === "mob") {
        const stun = Number(e.stunLeft) || 0;
        rec.group.userData.stunLeft = stun;
        const fx = rec.group.userData.fx as NodeFx;
        let still = fx.stillRing;
        if (stun > 0.05) {
          if (!still && this.room.cantoId === "inferno_07") {
            // Compact: fewer segs — still rings can spike after Ledger Bell
            const segs = isCompactUi() ? 12 : 18;
            still = new THREE.Mesh(
              sharedGeo(`stillRing${segs}`, () => new THREE.RingGeometry(0.55, 0.78, segs)),
              new THREE.MeshBasicMaterial({
                color: 0xd4a840,
                transparent: true,
                opacity: 0.55,
                side: THREE.DoubleSide,
                forceSinglePass: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
              })
            );
            still.rotation.x = -Math.PI / 2;
            still.position.y = 0.12;
            still.name = "stillRing";
            rec.group.add(still);
            fx.stillRing = still;
          }
          if (still) {
            const dx = rec.group.position.x - this.camFollow.x;
            const dz = rec.group.position.z - this.camFollow.z;
            const cull = isCompactUi() ? 22 : 28;
            const near = dx * dx + dz * dz < cull * cull;
            still.visible = near;
            // Pulse at most every 3rd frame — dozens of stills after a Bell toll
            if (near && this.frameN % 3 === 0) {
              const mat = still.material as THREE.MeshBasicMaterial;
              mat.opacity = 0.35 + Math.min(0.4, stun * 0.12);
              const s = 1 + Math.sin(this.animT * 0.006) * 0.06;
              still.scale.set(s, s, 1);
            }
          }
        } else if (still) {
          still.visible = false;
        }
      }
      const ward = (rec.group.userData.fx as NodeFx).wardRing;
      if (ward) {
        const a = e.archetype;
        const near =
          heart &&
          e.kind === "mob" &&
          a !== "storm_heart" &&
          a !== "mire_heart" &&
          a !== "hoard_heart" &&
          Math.hypot(heart.x - e.x, heart.y - e.y) <= 14;
        ward.visible = Boolean(near);
      }
      if (rec.kind === "portal") {
        this.guidance?.syncGate(rec, e);
        const hubHome =
          this.room?.cantoId === "inferno_07" &&
          e?.toCanto === "inferno_01" &&
          Array.isArray(this.room?.you?.firstClears) &&
          this.room.you.firstClears.includes("inferno_07");
        rec.group.userData.avaHubHomeGlow = hubHome;
        rec.hpEl.classList.toggle("ava-hub-home", Boolean(hubHome));
      }
      // Hub stash glow after Ava/Glut bank tip (Crush/Maw clear → Dark Wood)
      if (
        this.room?.cantoId === "inferno_01" &&
        e?.poiKind === "stash" &&
        (this.avaClearStashTipShown || this.glutClearStashTipShown)
      ) {
        rec.hpEl.classList.add("ava-stash-glow");
        rec.group.userData.avaStashGlow = true;
      } else if (e?.poiKind === "stash") {
        rec.hpEl.classList.remove("ava-stash-glow");
        rec.group.userData.avaStashGlow = false;
      }
      // Avarice Ledger Cache — empty mesh after claim (session)
      if (
        this.room?.cantoId === "inferno_07" &&
        (e?.poiKind === "cache" || e?.id === "ledger_cache" || rec.group.name === "ledger_cache")
      ) {
        const empty = Boolean(this.room?.you?.lootedCache);
        if (rec.group.userData.cacheEmpty !== empty) {
          rec.group.userData.cacheEmpty = empty;
          rec.group.traverse((o) => {
            if (o.name === "weightDisc" || o.name === "ribbon") o.visible = !empty;
          });
          // Dim gold band / coins leftover children without names: scale chest slightly
          if (empty) {
            rec.group.scale.setScalar((Number(rec.group.userData.baseScale) || 1) * 0.96);
            rec.hpEl.classList.add("ava-cache-empty");
          } else {
            rec.group.scale.setScalar(Number(rec.group.userData.baseScale) || 1);
            rec.hpEl.classList.remove("ava-cache-empty");
          }
        }
      }
      this.updateLabel(rec, e, pos);
    }
    for (const pl of this.room.players) {
      if (pl.id === this.room.you.id) continue;
      const id = `pl:${pl.id}`;
      let rec = this.nodes.get(id);
      if (!rec) rec = this.spawnNode(id, "player", { kind: "player", name: pl.name });
      rec.seenAt = stamp;
      const pos = this.interp.pos(id, pl);
      setPlanar(rec.group.position, pos.x, pos.y, this.standY(pos.x, pos.y));
      // Remote gait from the smoothed track: tickFx strides at this speed; the
      // body turns toward where they walk and keeps that heading when they stop
      const ud = rec.group.userData;
      const stepS = ud.gaitT == null ? 0 : Math.min(0.1, Math.max(0, (this.animT - ud.gaitT) / 1000));
      if (stepS > 0) {
        const dx = pos.x - ud.gaitX;
        const dy = pos.y - ud.gaitY;
        const jump = Math.hypot(dx, dy);
        if (jump < 3) {
          // (a larger step is a snap/teleport, not a stride)
          const sp = Math.min(12, jump / stepS);
          ud.gaitSpeed = (ud.gaitSpeed || 0) + (sp - (ud.gaitSpeed || 0)) * Math.min(1, stepS * 8);
          if (sp > 0.4) ud.gaitYaw = yawFromPlanar(dx, dy);
        }
      }
      ud.gaitT = this.animT;
      ud.gaitX = pos.x;
      ud.gaitY = pos.y;
      if (ud.gaitYaw == null) {
        ud.gaitYaw = yawFromPlanar(this.renderYou.x - pos.x, this.renderYou.y - pos.y);
        rec.group.rotation.y = ud.gaitYaw;
      }
      const turn = Math.atan2(Math.sin(ud.gaitYaw - rec.group.rotation.y), Math.cos(ud.gaitYaw - rec.group.rotation.y));
      rec.group.rotation.y += turn * Math.min(1, stepS * 10);
      // 2+ remotes / gold haze: dim far rim lights (perf + declutter)
      const rim = rec.group.userData.fx?.remoteRim as VirtualLight | undefined;
      if (rim) {
        const rd = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
        const many = (this.room?.players?.length || 1) >= 3;
        rim.visible = rd < (many ? 18 : 28);
        rim.intensity = many ? 0.35 : 0.55;
      }
      const eq = pl.equipped || {};
      const lookKey = equipLookKey(eq);
      if (rec.group.userData.equipLookKey !== lookKey) {
        applyEquippedLook(rec.group, eq);
        rec.group.userData.equipLookKey = lookKey;
      }
      this.updateLabel(rec, { name: pl.name, kind: "player", hp: pl.hp, maxHp: pl.maxHp }, pos);
    }
    } finally {
      for (const rec of this.nodes.values()) {
        if (rec.seenAt !== stamp) {
          if (rec.kind === "loot") this.flyPickedLoot(rec);
          this.disposeNode(rec);
          this.nodes.delete(rec.id);
        }
      }
    }
  }

  /** We asked for this drop and it vanished: motes fly from it into the hero. */
  flyPickedLoot(rec: NodeRec) {
    const sent = this.pickupFlyIds.get(rec.id);
    if (sent == null) return;
    this.pickupFlyIds.delete(rec.id);
    if (performance.now() - sent > 4000 || !this.pickupFx) return;
    const p = rec.group.position;
    this.pickupFx.spawn(p.x, p.y + 0.6, p.z, String(rec.group.userData.rarity || "normal"), performance.now());
  }

  /** Remember a pickup request so its disappearance plays the fly-to-hero motes. */
  notePickupSent(id: string) {
    const now = performance.now();
    if (this.pickupFlyIds.size > 24) {
      for (const [k, t] of this.pickupFlyIds) if (now - t > 4000) this.pickupFlyIds.delete(k);
    }
    this.pickupFlyIds.set(id, now);
  }

  spawnNode(id: string, kind: KindKey, e: any): NodeRec {
    const isHeartArch =
      e.archetype === "storm_heart" || e.archetype === "mire_heart" || e.archetype === "hoard_heart";
    const arch = String(e.archetype || "");
    const isMire = arch.startsWith("mire_") || arch === "mud_wisp";
    const isAvaArch =
      arch.startsWith("weight_") || arch === "coin_wisp" || arch === "ledger_warden" || arch === "hoard_heart";
    const nm = String(e.name || "");
    let group: THREE.Group;
    // A canto mechanic builds the entities it owns (its own POI kinds)
    const own = this.mech.nodeMesh?.(this, e, kind) ?? null;
    if (own) {
      group = own;
    } else if (arch === "hoard_heart") {
      group = makeHoardHeart(this.mats!);
      group.userData.isHoardHeart = true;
    } else if (isHeartArch) {
      group = makeByKind("shrine", this.mats!, e.item?.rarity);
    } else if (arch === "mud_wisp") {
      group = makeMudWisp(this.mats!);
    } else if (arch === "coin_wisp") {
      group = makeCoinWisp(this.mats!);
    } else if (arch === "mire_warden") {
      group = makeMireWarden(this.mats!);
    } else if (arch === "ledger_warden") {
      group = makeLedgerWarden(this.mats!);
      group.userData.isLedgerWarden = true;
    } else if (/^cerbero$/i.test(nm)) {
      group = makeCerbero(this.mats!);
    } else if (/^counterweight$/i.test(nm)) {
      group = makeCounterweight(this.mats!);
      group.userData.isCounterweight = true;
      group.userData.midBoss = true;
    } else if (isMire && kind === "champion") {
      group = makeMireChampion(this.mats!);
    } else if (isMire && kind === "whirl") {
      group = makeMireShade(this.mats!);
    } else if (isAvaArch && kind === "champion") {
      group = makeWeightChampion(this.mats!);
    } else if (isAvaArch && kind === "whirl") {
      group = makeWeightShade(this.mats!);
    } else if (this.room?.cantoId === "inferno_06" && e.poiKind === "cache") {
      group = makeFilthCache(this.mats!);
    } else if (this.room?.cantoId === "inferno_06" && e.poiKind === "shrine") {
      group = makeMireShrine(this.mats!);
    } else if (this.room?.cantoId === "inferno_06" && e.poiKind === "bell") {
      group = makeMireBell(this.mats!);
    } else if (this.room?.cantoId === "inferno_07" && e.poiKind === "cache") {
      group = makeLedgerCache(this.mats!);
    } else if (this.room?.cantoId === "inferno_07" && e.poiKind === "shrine") {
      group = makeLedgerShrine(this.mats!);
    } else if (this.room?.cantoId === "inferno_07" && e.poiKind === "bell") {
      group = makeLedgerBell(this.mats!);
    } else if (this.room?.cantoId === "inferno_07" && e.poiKind === "marker") {
      group = makeLedgerStone(this.mats!);
    } else {
      group = makeByKind(kind, this.mats!, e.item?.rarity);
    }
    if (kind === "player") {
      group.scale.setScalar(1.42);
      // Combat haze — bone rim so remotes read through Lust/Glut/Ava wash (skip on compact light budget)
      if (!isCompactUi()) {
        const canto = this.room?.cantoId;
        if (canto === "inferno_07" || canto === "inferno_05" || canto === "inferno_06") {
          const col =
            canto === "inferno_07" ? 0xe8c86a : canto === "inferno_06" ? 0xc8d080 : 0xf0c8a0;
          const rim = new VirtualLight(col, canto === "inferno_07" ? 0.4 : 0.34, 5.5, 2, 0.8);
          rim.name = "avaRemoteRim";
          rim.position.set(0, 1.6, 0);
          group.add(rim);
        }
      }
    }
    if (e.archetype === "gale_wisp") group.scale.setScalar(0.62);
    if (e.archetype === "gale_warden") group.scale.setScalar(1.15);
    if (e.archetype === "mire_shade") group.scale.setScalar(1.05);
    if (e.archetype === "mire_champion" && !/^cerbero$/i.test(nm)) group.scale.setScalar(1.08);
    if (e.archetype === "weight_shade") group.scale.setScalar(1.05);
    if (e.archetype === "weight_champion" && !/^counterweight$/i.test(nm)) group.scale.setScalar(1.08);
    if (e.archetype === "coin_wisp") group.scale.setScalar(0.82);
    if (isHeartArch) group.scale.setScalar(1.45);
    if (
      e.poiKind === "bell" &&
      this.room?.cantoId !== "inferno_06" &&
      this.room?.cantoId !== "inferno_07"
    )
      group.scale.setScalar(0.72);
    if (e.poiKind === "pyre") group.scale.setScalar(1.85);
    if (this.room?.cantoId === "inferno_01") {
      if (e.poiKind === "stash") group.scale.setScalar(1.28);
      else if (e.poiKind === "ah") group.scale.setScalar(1.22);
      else if (e.poiKind === "quest") group.scale.setScalar(1.18);
      else if (e.poiKind === "npc") group.scale.setScalar(1.12);
    }
    // Dedicated mire builders already olive; only tint heart shrine leftover
    if (isMire && isHeartArch) {
      tintMireEnemy(group, this.mats!, true);
    }
    if (kind === "whirl" || kind === "champion") {
      const ring = new THREE.Mesh(
        sharedGeo("wardRing", () => new THREE.RingGeometry(0.62, 0.74, 18)),
        this.wardMat
      );
      ring.name = "wardRing";
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08;
      ring.visible = false;
      group.add(ring);
    }
    // Foes get a posable body (lean/bob/attack/flinch/death) before the label goes on
    this.combat?.rig(group, kind, e);
    if (kind === "portal") {
      const hubHome =
        this.room?.cantoId === "inferno_07" &&
        e?.toCanto === "inferno_01" &&
        Array.isArray(this.room?.you?.firstClears) &&
        this.room.you.firstClears.includes("inferno_07");
      group.userData.avaHubHomeGlow = hubHome;
    }
    group.userData.entityId = id.replace(/^pl:/, "");
    if (e?.packId) group.userData.packId = String(e.packId);
    const wrap = document.createElement("div");
    wrap.className = "world-label";
    wrap.innerHTML = `<div class="wl-name"></div><div class="wl-hp"><i></i></div><div class="interact-prompt" hidden></div>`;
    if (kind === "player") {
      wrap.classList.add("ally", "remote");
      if (this.room?.cantoId === "inferno_07") wrap.classList.add("ava-remote");
      else if (this.room?.cantoId === "inferno_05") wrap.classList.add("lust-remote");
      else if (this.room?.cantoId === "inferno_06") wrap.classList.add("glut-remote");
    }
    const label = new CSS2DObject(wrap);
    label.center.set(0.5, 1);
    const bossY =
      kind === "triple_maw" || kind === "hoard_crush" ? 5.9 : kind === "judge" ? 5.6 : 2.05;
    label.position.set(0, kind === "portal" ? 4.1 : kind === "loot" ? 1.35 : bossY, 0);
    if (kind === "loot") {
      // Drops of one kill land on top of each other: stack their names, don't overprint
      const lx = Number(e?.x) || 0;
      const ly = Number(e?.y) || 0;
      let under = 0;
      for (const r of this.nodes.values()) {
        const at = r.kind === "loot" ? (r.group.userData.lootAt as [number, number] | undefined) : undefined;
        if (at && Math.abs(at[0] - lx) < 1.6 && Math.abs(at[1] - ly) < 1.6) under++;
      }
      group.userData.lootAt = [lx, ly];
      // (screen-space step: the phone camera's steep pitch squashes a world-height offset)
      if (under > 0) wrap.style.marginTop = `${-1.3 * Math.min(under, 4)}em`;
      const rarity = String(e?.item?.rarity || "normal");
      const beam = makeLootBeam(RARITY_HEX[rarity] || 0xe8c86a);
      group.userData.rarity = rarity;
      // Avarice: slightly stronger weighed-drop read (still no neon)
      if (this.room?.cantoId === "inferno_07") {
        const mat = beam.material as THREE.MeshBasicMaterial;
        const nearCrush = Number(e?.x) > 118;
        mat.opacity = nearCrush
          ? rarity === "normal"
            ? 0.68
            : 0.86
          : rarity === "normal"
            ? 0.55
            : rarity === "unique" || rarity === "canto_unique"
              ? 0.78
              : 0.68;
        beam.scale.set(nearCrush ? 1.28 : 1.1, nearCrush ? 1.42 : 1.18, nearCrush ? 1.28 : 1.1);
        if (nearCrush) wrap.classList.add("ava-crush-pile");
      }
      group.add(beam);
      // Name coloured by rarity (styles: .loot-label.r-*)
      wrap.classList.add("loot-label", `r-${rarity in RARITY_HEX ? rarity : "normal"}`);
    }
    if (
      kind === "whirl" ||
      kind === "champion" ||
      kind === "judge" ||
      kind === "triple_maw" ||
      kind === "hoard_crush"
    ) {
      wrap.classList.add("foe");
      if (kind === "champion") wrap.classList.add("elite");
      if (kind === "judge" || kind === "triple_maw" || kind === "hoard_crush") wrap.classList.add("boss");
      if (isMire) wrap.classList.add("mire");
      if (isAvaArch) wrap.classList.add("avarice");
      if (group.userData.midBoss || group.userData.isCounterweight) wrap.classList.add("midboss");
    }
    if (kind === "portal") {
      label.position.set(0, 4.1, 0);
      // Face the camera, colour by state (forward gold / return blue / locked grey)
      this.guidance?.setupGate(group, wrap, e);
      if (this.portalIsLocked(e)) wrap.classList.add("portal-locked");
      if (group.userData.avaHubHomeGlow) wrap.classList.add("ava-hub-home");
      // Avarice weighed gate — bone ledger plate (Glut→Ava approach + Ava return)
      const avaBound =
        e?.toCanto === "inferno_07" ||
        (this.room?.cantoId === "inferno_07" && (e?.toCanto === "inferno_06" || !e?.toCanto));
      if (avaBound && this.mats && !group.userData.avaGatePlate) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.06), this.mats.bone);
        plate.position.set(0, 2.35, -0.55);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.05, 0.03), this.mats.gold);
        trim.position.set(0, 2.55, -0.58);
        const hash = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.025, 0.02), this.mats.bronze);
        hash.position.set(0, 2.38, -0.59);
        group.add(plate, trim, hash);
        group.userData.avaGatePlate = true;
        if (e?.toCanto === "inferno_07") wrap.classList.add("ava-outbound");
      }
    }
    if (e.poiKind === "marker") {
      wrap.classList.add("poi-marker");
      label.position.set(0, 2.4, 0);
    }
    // Guide: the name plate sits above the lantern staff, not over the flame
    if (kind === "guide") label.position.set(0, 2.6, 0);
    group.add(label);
    group.userData.baseScale = group.scale.x;
    group.userData.fx = collectNodeFx(group);
    this.scene.add(group);
    const rec: NodeRec = {
      id,
      kind,
      group,
      label,
      hpEl: wrap,
      nameEl: wrap.querySelector(".wl-name") as HTMLElement,
      hpBar: wrap.querySelector(".wl-hp") as HTMLElement,
      hpFill: wrap.querySelector(".wl-hp i") as HTMLElement,
      seenAt: this.syncStamp,
    };
    this.nodes.set(id, rec);
    return rec;
  }

  /** Leave the old canto's mechanic, enter the new one's (after its ground is built). */
  switchMech(cantoId: string) {
    this.mech.exit?.(this);
    this.mech = mechFor(cantoId);
    this.mech.enter?.(this);
  }

  /** Immediate wipe of entity meshes/labels (canto travel). */
  disposeAllNodes() {
    for (const rec of this.nodes.values()) this.disposeNode(rec);
    this.nodes.clear();
  }


  /** Avarice pack death: brief coin burst, hard-capped so dense packs don't spam lights. */
  avaPackDeathCoins(rec: NodeRec) {
    const ud = rec.group.userData;
    if (ud.coinsDone) return;
    ud.coinsDone = true;
    if (
      this.room?.cantoId === "inferno_07" &&
      (rec.kind === "whirl" || rec.kind === "champion") &&
      this.avaDeathBurstActive < (isCompactUi() ? 1 : 2)
    ) {
      this.spawnAvaPackDeathCoins(rec.group.position.x, rec.group.position.z);
    }
  }

  disposeNode(rec: NodeRec) {
    // (a foe pruned without a death collapse still bursts here; a corpse already did)
    this.avaPackDeathCoins(rec);
    this.scene.remove(rec.group);
    // A hit-flash shell riding on this foe goes back to its pool first
    this.combat?.release(rec.group);
    // Pilgrims / the Guide share geometry + materials; free only the bone texture
    if (rec.kind === "player" || rec.kind === "guide") {
      disposeHero(rec.group);
      this.heroMotor?.releaseRemote(rec.group);
    }
    rec.label.element.remove();
    // Free the node's own buffers/materials (shared kit + cached parts are marked shared)
    disposeNode3D(rec.group);
  }

  /** Sparse bone-gold coin motes on pack death — budgeted, SFX-less. */
  spawnAvaPackDeathCoins(x: number, z: number) {
    this.avaDeathBurstActive++;
    const y = this.standY(x, z, 0.2);
    const n = isCompactUi() ? 3 : 5;
    for (let i = 0; i < n; i++) {
      // (pooled additive motes — no material per coin)
      const mote = acquireFxMote(0.07, 6, i % 2 ? 0xf2dea0 : 0xd4a840, 0.9);
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const r = 0.2 + Math.random() * 0.55;
      setPlanar(mote.position, x + Math.cos(ang) * r, z + Math.sin(ang) * r, y + 0.15);
      this.scene.add(mote);
      this.impacts.push({
        mesh: mote,
        start: this.animT + i * 16,
        dur: 480 + Math.random() * 220,
        from: 1,
        to: 0.1,
        rise: 0.9 + Math.random() * 0.7,
      });
    }
    window.setTimeout(() => {
      this.avaDeathBurstActive = Math.max(0, this.avaDeathBurstActive - 1);
    }, 520);
  }

  updateLabel(rec: NodeRec, e: any, pos: Vec2) {
    const you = this.youPos();
    const d = Math.hypot(pos.x - you.x, pos.y - you.y);
    // Gates: name + distance up to ~30 m on every screen (guidance.ts)
    if (rec.kind === "portal" && this.guidance) {
      this.guidance.gateLabel(rec, e, d);
      return;
    }
    const nameEl = rec.nameEl;
    const hp = rec.hpBar;
    const fill = rec.hpFill;
    const name = e.item?.name || e.label || e.name || "";
    const foe =
      rec.kind === "whirl" ||
      rec.kind === "champion" ||
      rec.kind === "judge" ||
      rec.kind === "triple_maw" ||
      rec.kind === "hoard_crush";
    const boss = rec.kind === "judge" || rec.kind === "triple_maw" || rec.kind === "hoard_crush";
    // Compact far-cull shared across Lust/Glut/Ava (mobile label spam)
    const combatCompact =
      (this.room?.cantoId === "inferno_05" ||
        this.room?.cantoId === "inferno_06" ||
        this.room?.cantoId === "inferno_07") &&
      isCompactUi();
    const midboss = rec.hpEl.classList.contains("midboss");
    const inAva = this.room?.cantoId === "inferno_07";
    const poiish =
      rec.kind === "portal" ||
      rec.kind === "shrine" ||
      rec.kind === "stash" ||
      rec.kind === "guide" ||
      rec.hpEl.classList.contains("poi-marker");
    let far = rec.kind === "loot" ? 22 : boss ? 30 : midboss ? 28 : foe ? 26 : 16;
    if (rec.kind === "player") far = inAva ? 34 : 22;
    if (inAva && poiish) far = Math.min(far, 11);
    if (combatCompact) {
      far = rec.kind === "loot" ? 14 : boss ? 20 : midboss ? 18 : foe ? 13 : poiish ? 8 : 10;
      if (inAva && foe && !boss && !midboss) far = 11;
    }
    // Nearest interact always keeps its plate readable
    if (this.nearestInteract && this.nearestInteract.id === rec.id) far = Math.max(far, 14);
    if (d > far) {
      if (rec.hpEl.style.opacity !== "0") rec.hpEl.style.opacity = "0";
      // Skip CSS2D projection for far plates (perf: fewer label draw updates)
      if (rec.label.visible) rec.label.visible = false;
      return;
    }
    if (!rec.label.visible) rec.label.visible = true;
    const nextOp =
      d > (inAva && poiish ? 7 : 10) &&
      !foe &&
      rec.kind !== "loot" &&
      rec.kind !== "player" &&
      !midboss
        ? "0.4"
        : "1";
    if (rec.hpEl.style.opacity !== nextOp) rec.hpEl.style.opacity = nextOp;
    const nameDist = inAva && poiish ? 6 : rec.kind === "player" && inAva ? 28 : 8;
    const shown =
      foe || midboss || rec.kind === "loot" || rec.kind === "player" || d <= nameDist
        ? name
        : "•";
    if (nameEl && nameEl.textContent !== shown) nameEl.textContent = shown;
    rec.hpEl.classList.toggle("stilled", Number(rec.group.userData.stunLeft || 0) > 0.05);
    if (e.hp != null && e.maxHp) {
      if (hp.style.display !== "block") hp.style.display = "block";
      const ratio = Math.max(0, Math.min(1, e.hp / e.maxHp));
      const w = `${(ratio * 100).toFixed(0)}%`;
      if (fill.style.width !== w) fill.style.width = w;
      fill.classList.toggle("low", ratio <= 0.3);
    } else if (hp.style.display !== "none") {
      hp.style.display = "none";
    }
  }

  lootRenderPos(e: any): Vec2 {
    const you = this.youPos();
    const d = Math.hypot(e.x - you.x, e.y - you.y);
    const canto = this.room?.cantoId;
    const crushPull = canto === "inferno_07" && this.animT < this.crushLootMagnetUntil;
    const range =
      canto === "inferno_07"
        ? MAGNET_RANGE + 1.4 + (crushPull ? 2.2 : 0)
        : canto === "inferno_05" || canto === "inferno_06"
          ? MAGNET_RANGE + 0.7
          : MAGNET_RANGE;
    if (d > range || d < 0.01) return this.entityRenderPos(e);
    const t = 1 - d / range;
    // Shared combat pull; Avarice greed hardest; Crush clear = brief auto-magnet
    const pull =
      t *
      t *
      (canto === "inferno_07"
        ? crushPull
          ? 0.92
          : 0.72
        : canto === "inferno_05" || canto === "inferno_06"
          ? 0.64
          : 0.55);
    return { x: e.x + (you.x - e.x) * pull, y: e.y + (you.y - e.y) * pull };
  }


  /** Brief bone-gold claim ring at a POI (shrine/cache) — no audio required. */
  spawnAvaClaimRing(ent: any, color: number, from: number, to: number, dur: number) {
    const pos = this.entityRenderPos(ent);
    const ring = acquireFxRing(0.7, 1.05, isCompactUi() ? 22 : 32, color, 0.78);
    setPlanar(ring.position, pos.x, pos.y, this.standY(pos.x, pos.y, 0.14));
    this.scene.add(ring);
    this.impacts.push({ mesh: ring, start: this.animT, dur, from, to });
  }


  /** SFX-less first-clear burst at Hoard Crush — nested bone-gold rings + rising ash. */
  spawnAvaFirstClearBurst(ent: any) {
    const pos = this.entityRenderPos(ent);
    const y0 = this.standY(pos.x, pos.y, 0.12);
    // Inner quick measure
    this.spawnAvaClaimRing(ent, 0xf2dea0, 1.2, 4.2, 720);
    // Outer slow ledger wash
    const outer = acquireFxRing(1.1, 1.45, isCompactUi() ? 24 : 36, 0xe8c86a, 0.7);
    setPlanar(outer.position, pos.x, pos.y, y0);
    this.scene.add(outer);
    this.impacts.push({ mesh: outer, start: this.animT, dur: 1400, from: 1.4, to: 7.2 });
    // Rising ash motes (bone dust, no neon)
    const n = isCompactUi() ? 8 : 14;
    for (let i = 0; i < n; i++) {
      const mote = acquireFxMote(0.06 + Math.random() * 0.05, 6, i % 2 ? 0xf2dea0 : 0xd4a840, 0.85);
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const r = 0.6 + Math.random() * 1.4;
      setPlanar(mote.position, pos.x + Math.cos(ang) * r, pos.y + Math.sin(ang) * r, y0 + 0.2);
      this.scene.add(mote);
      this.impacts.push({
        mesh: mote,
        start: this.animT + i * 18,
        dur: 900 + Math.random() * 400,
        from: 1,
        to: 0.2,
        rise: 2.8 + Math.random() * 1.6,
      });
    }
    this.camPunch = Math.max(this.camPunch, 1.75);
    this.camShake = Math.max(this.camShake, 0.48);
    this.camFovKick = Math.max(this.camFovKick, 3.2);
  }

  /** Soft entrance keep-out pulse — bone-gold, no neon (spawn / death wake). */
  spawnAvaEntrancePulse(x: number, y: number) {
    const ring = acquireFxRing(1.15, 1.55, isCompactUi() ? 20 : 28, 0xe8d4a8, 0.55);
    setPlanar(ring.position, x, y, this.standY(x, y, 0.12));
    this.scene.add(ring);
    this.impacts.push({ mesh: ring, start: this.animT, dur: 900, from: 1.2, to: 4.2 });
  }

  /** Rising bone-gold heal motes from Ledger Shrine kneel — soft mend, no neon. */
  spawnAvaHealMotes(x: number, y: number) {
    const y0 = this.standY(x, y, 0.4);
    const n = isCompactUi() ? 6 : 9;
    for (let i = 0; i < n; i++) {
      const mote = acquireFxMote(0.05 + Math.random() * 0.04, 5, i % 2 ? 0xfff0c8 : 0xe8c86a, 0.92);
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.35;
      const r = 0.15 + Math.random() * 0.45;
      setPlanar(mote.position, x + Math.cos(ang) * r, y + Math.sin(ang) * r, y0 + 0.6);
      this.scene.add(mote);
      this.impacts.push({
        mesh: mote,
        start: this.animT + i * 28,
        dur: 780 + Math.random() * 320,
        from: 1,
        to: 0.12,
        rise: 2.2 + Math.random() * 1.2,
      });
    }
  }

  /** Rising bone-gold ash motes on loot pickup — SFX-less clarity in the gold haze. */
  spawnAvaPickupMotes(x: number, y: number, rich = false) {
    const y0 = this.standY(x, y, 0.18);
    const n = isCompactUi() ? (rich ? 6 : 4) : rich ? 10 : 7;
    for (let i = 0; i < n; i++) {
      const mote = acquireFxMote(0.045 + Math.random() * 0.04, 5, i % 2 ? 0xf2dea0 : 0xd4a840, 0.9);
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const r = 0.25 + Math.random() * (rich ? 0.9 : 0.55);
      setPlanar(mote.position, x + Math.cos(ang) * r, y + Math.sin(ang) * r, y0);
      this.scene.add(mote);
      this.impacts.push({
        mesh: mote,
        start: this.animT + i * 22,
        dur: 620 + Math.random() * 280,
        from: 1,
        to: 0.15,
        rise: 1.6 + Math.random() * (rich ? 1.4 : 0.9),
      });
    }
  }

  portalIsLocked(e: any): boolean {
    const need = e?.requireClear;
    if (!need) return false;
    const clears = this.room?.you?.firstClears;
    return !(Array.isArray(clears) && clears.includes(need));
  }

  denyLockedPortal(e: any) {
    const now = performance.now();
    // One seal line per gate per few seconds (taps, Use and soft-snap all land here)
    if (this.lastDeny && this.lastDeny.id === String(e?.id) && now - this.lastDeny.at < 2500) return;
    this.lastDeny = { id: String(e?.id), at: now };
    const why = lockReason(e);
    showToast(`The ${gateTitle(e)} is sealed — ${why.charAt(0).toLowerCase()}${why.slice(1)} first`, "warn");
  }

  /** Audio-free boss pressure: denser fog + CSS fringe within Maw range. */
  tickMawPressure() {
    if (!this.room || this.room.cantoId !== "inferno_06") {
      if (this.mawPressureOn) {
        this.mawPressureOn = false;
        document.body.classList.remove("maw-pressure");
      }
      return;
    }
    const boss = this.room.entities.find(
      (e: any) => e.kind === "boss" && (e.hp == null || e.hp > 0)
    );
    const near = Boolean(
      boss && Math.hypot(boss.x - this.renderYou.x, boss.y - this.renderYou.y) < 26
    );
    if (near !== this.mawPressureOn) {
      this.mawPressureOn = near;
      document.body.classList.toggle("maw-pressure", near);
    }
    this.fogTargetDensity = near ? this.glutFogBase * 1.45 : this.glutFogBase;
  }

  /** Soft fog/clear lerp on canto change — avoids hard pop. */
  tickAtmosphere() {
    const fog = this.scene.fog;
    if (!(fog instanceof THREE.FogExp2)) return;
    fog.color.lerp(this.fogTargetColor, 0.14);
    // Phones look down more steeply (shorter sight lines) — a little more haze keeps depth
    const want = this.fogTargetDensity * (isCompactUi() ? 1.3 : 1);
    fog.density += (want - fog.density) * 0.14;
    this._clearScratch.lerp(this.clearTargetColor, 0.14);
    this.renderer.setClearColor(this._clearScratch, 1);
  }

  rebuildGround() {
    if (!this.room || !this.mats) return;
    if (this.ground) {
      this.scene.remove(this.ground.group);
      // Per-build geometry/materials go; kit materials, cached prop parts and textures stay
      disposeNode3D(this.ground.group);
    }
    const keepouts = [
      { x: this.room.you.x, y: this.room.you.y, r: 4.2 },
      ...this.room.entities
        .filter((e: any) => e.kind === "poi" || e.kind === "exit" || e.kind === "boss")
        .map((e: any) => ({
          x: e.x,
          y: e.y,
          r: e.kind === "boss" ? 10 : e.kind === "exit" ? 4.2 : 3.2,
        })),
    ];
    if (this.room.cantoId === "inferno_01") keepouts.push({ x: 64, y: 72, r: 4.8 });
    this.ground = buildGround(this.room.cantoId, this.room.bounds, this.mats, keepouts);
    this.scene.add(this.ground.group);
    this.trees = [];
    this.propAnims = [];
    this.ground.group.traverse((o) => {
      if (o.name === "tree") this.trees.push(o);
      if (
        o.name === "galeRibbon" ||
        o.name === "ember" ||
        o.name === "daisPulse" ||
        o.name === "daisTelegraph"
      ) {
        this.propAnims.push(o);
      }
    });
    const lust = this.room.cantoId === "inferno_05";
    const glut = this.room.cantoId === "inferno_06";
    const ava = this.room.cantoId === "inferno_07";
    document.body.classList.toggle("in-lust", lust);
    document.body.classList.toggle("in-gluttony", glut);
    document.body.classList.toggle("in-avarice", ava);
    if (this.selfRing) {
      // pale bone where the ground is red (Lust) or gold (Avarice): the ring must not
      // melt into the floor; gold elsewhere
      const m = this.selfRing.material as THREE.MeshBasicMaterial;
      m.color.setHex(lust || ava ? 0xf4ecd6 : 0xe4c060);
      m.opacity = lust || ava ? 0.88 : 0.78;
    }
    if (!ava) document.body.classList.remove("ava-idle");
    if (this.ash) {
      if (ava) this.ash.setColor(0xd4a840, isCompactUi() ? 0.32 : 0.4);
      else if (glut) this.ash.setColor(0xb8c070, isCompactUi() ? 0.4 : 0.5);
      else if (lust) this.ash.setColor(0xffb090, isCompactUi() ? 0.45 : 0.55);
      else this.ash.setColor(0xe8d4b0, 0.55);
    }
    this.setSky(
      lust ? 0x12060a : glut ? 0x0a0c08 : ava ? 0x0a0804 : 0x0e0c09,
      lust ? 0x6e2616 : glut ? 0x3a4022 : ava ? 0x5e4618 : 0x4e4230,
      lust ? 0x2a0e08 : glut ? 0x14120a : ava ? 0x100c06 : 0x1c1812
    );
    if (lust) {
      this.fogTargetColor.setHex(0x3a140e);
      this.fogTargetDensity = 0.0135;
      this.clearTargetColor.setHex(0x1a0c08);
      // Red-black (bible: inferno_red_black) — keep the ember ground from washing out
      this.hemi.color.set(0xe89870);
      this.hemi.groundColor.set(0x1a0806);
      this.sun.color.set(0xff9960);
      this.sun.intensity = 1.7;
      this.rim.color.set(0xff8844);
      this.hemi.intensity = 0.84;
      this.rim.intensity = 1.7;
      // Small hero fill so silhouette reads through Lust fog (point light, cheap).
      this.heroLight.intensity = 4.05;
      this.heroLight.distance = 10;
    } else if (glut) {
      // Slightly brighter hemi + cooler rim so mire labels read through olive fog.
      this.glutFogBase = 0.017;
      this.mawPressureOn = false;
      this.crushPressureOn = false;
      document.body.classList.remove("maw-pressure");
      document.body.classList.remove("crush-pressure", "crush-phase2", "crush-enrage");
        this.crushEnrageShown = false;
      this.fogTargetColor.setHex(0x1e1c10);
      this.fogTargetDensity = this.glutFogBase;
      this.clearTargetColor.setHex(0x100e08);
      this.hemi.color.set(0xc8bc88);
      this.hemi.groundColor.set(0x18140c);
      this.hemi.intensity = 1.22;
      this.sun.color.set(0xc8b060);
      this.sun.intensity = 1.78;
      this.rim.color.set(0xa8c060);
      this.rim.intensity = 1.55;
      this.heroLight.intensity = 3.4;
      this.heroLight.distance = 9;
    } else if (ava) {
      // Gold-on-black irony — clearer road fog; density spikes only near Crush.
      const compact = isCompactUi();
      this.avaFogBase = compact ? 0.012 : 0.013;
      this.mawPressureOn = false;
      this.crushPressureOn = false;
      document.body.classList.remove("maw-pressure");
      document.body.classList.remove("crush-pressure", "crush-phase2", "crush-enrage");
        this.crushEnrageShown = false;
      this.fogTargetColor.setHex(0x16120a);
      this.fogTargetDensity = this.avaFogBase;
      this.clearTargetColor.setHex(0x0e0c06);
      this.hemi.color.set(0xd4c090);
      this.hemi.groundColor.set(0x14100a);
      this.hemi.intensity = compact ? 1.08 : 1.18;
      this.sun.color.set(0xd4a860);
      this.sun.intensity = compact ? 1.55 : 1.85;
      this.rim.color.set(0xc8a040);
      this.rim.intensity = compact ? 1.25 : 1.6;
      this.heroLight.intensity = compact ? 2.2 : 3.0;
      this.heroLight.distance = compact ? 6.5 : 8;
    } else {
      this.fogTargetColor.setHex(0x1c1812);
      this.fogTargetDensity = 0.013;
      this.clearTargetColor.setHex(0x1c1812);
      this.hemi.color.set(0xe8d4b0);
      this.hemi.groundColor.set(0x1a1410);
      this.hemi.intensity = 1.12;
      this.rim.intensity = 1.7;
      this.sun.color.set(0xffe6c0);
      this.sun.intensity = 1.85;
      this.rim.color.set(0xffe0b0);
      this.heroLight.intensity = 3.4;
      this.heroLight.distance = 9;
    }
    if (!(this.scene.fog instanceof THREE.FogExp2)) {
      this.scene.fog = new THREE.FogExp2(this.fogTargetColor.getHex(), this.fogTargetDensity);
      this._clearScratch.copy(this.clearTargetColor);
      this.renderer.setClearColor(this._clearScratch, 1);
    }
    this.placePortalLight();
  }

  /**
   * The one scene-level gate light sits on the forward gate (gold once open,
   * dim while sealed). Re-run when a gate opens.
   */
  placePortalLight() {
    if (!this.room) return;
    const cantoId = this.room.cantoId;
    const clears = this.room.you?.firstClears;
    const portal = forwardGate(this.room.entities, cantoId) || visibleGates(this.room.entities)[0];
    if (!portal) return;
    const st = gateState(portal, cantoId, clears);
    this.portalLight.intensity = st === "locked" ? 1.2 : st === "forward" ? 5.2 : 3.2;
    this.portalLight.color.set(st === "locked" ? 0x5a5040 : st === "forward" ? 0xffc050 : 0x8fb4e8);
    setPlanar(this.portalLight.position, portal.x, portal.y, this.standY(portal.x, portal.y, 2.2));
  }

  setSky(top: number, horizon: number, bottom: number) {
    this.skyColors = [top, horizon, bottom];
    const u = this.sky?.material.uniforms;
    if (!u) return;
    (u.top.value as THREE.Color).setHex(top);
    (u.horizon.value as THREE.Color).setHex(horizon);
    (u.bottom.value as THREE.Color).setHex(bottom);
  }

  onNet(msg: any) {
    switch (msg.type) {
      case "snapshot": {
        const prevCanto = this.lastCantoId;
        const prevYou = this.lastYouSnapshot;
        this.room = msg.room;
        updateStats(msg.room.you, msg.room.title, msg.room.subtitleIt || msg.room.subtitle_it);
        this.lastYouSnapshot = msg.room.you;
        this.refreshInventoryUi();
        this.noteNewInventoryLoot(msg.room.you);
        const sx = msg.room.you.x as number;
        const sy = msg.room.you.y as number;
        const cantoChanged = prevCanto != null && prevCanto !== msg.room.cantoId;
        const first = this.lastCantoId == null;
        this.lastCantoId = msg.room.cantoId;
        this.serverYou = { x: sx, y: sy };
        if (import.meta.env.DEV) {
          (window as unknown as { __selvaWorldReady?: boolean }).__selvaWorldReady = true;
        }
        if (first || cantoChanged) {
          // Memory: flush combat ephemerals on canto leave (Lust/Glut/Ava)
          if (cantoChanged && prevCanto && prevCanto !== msg.room.cantoId) {
            if (prevCanto === "inferno_07") this.disposeAvaEphemerals();
            else if (prevCanto === "inferno_05" || prevCanto === "inferno_06") {
              this.disposeCombatEphemerals();
            }
          }
          this.renderYou = { x: sx, y: sy };
          this.interp.clear();
          this.combat?.clear();
          this.forces.clear();
          this._fv.x = 0;
          this._fv.y = 0;
          this.moveTarget = null;
          this.autoPickupSent.clear();
          this.lastHitFoe = null;
          this.seenInvItemIds.clear();
          resetCombo();
          // Drop prior canto meshes immediately — syncEntities prune alone can miss a frame
          // if spawn throws mid-loop (HUD/title already updated from this snapshot).
          this.disposeAllNodes();
          this.rebuildGround();
          this.switchMech(msg.room.cantoId);
          this.prewarmPending = true;
          this.camFollow.set(sx, this.standY(sx, sy), sy);
          this.cancelPortalHold();
          if (cantoChanged) this.camPunch = 1.2;
          this.camLead.x = 0;
          this.camLead.z = 0;
          // Arrival title card replaces the old "Entered X." / intro toast pile-up
          flushStaleToasts();
          showCantoCard(
            String(msg.room.title || ""),
            String(msg.room.subtitleIt || msg.room.subtitle_it || "").trim(),
            this.guidance?.arrivalGoal(msg.room.cantoId, msg.room.you) ?? ""
          );
        } else if (this.ground && this.ground.cantoId !== msg.room.cantoId) {
          // Recover desync: title/you.cantoId moved but ground rebuild was skipped/raced.
          this.disposeAllNodes();
          this.combat?.clear();
          this.rebuildGround();
          this.switchMech(msg.room.cantoId);
          this.prewarmPending = true;
          this.camFollow.set(sx, this.standY(sx, sy), sy);
        }
        // Server-clock samples for interpolation (render runs ~one snapshot behind)
        this.interp.beginSnapshot(Number(msg.room.st), performance.now());
        for (const e of msg.room.entities) this.interp.push(String(e.id), e.x, e.y);
        for (const pl of msg.room.players) {
          if (pl.id === msg.room.you.id) continue;
          this.interp.push(`pl:${pl.id}`, pl.x, pl.y);
        }
        this.interp.endSnapshot();
        this.mech.onSnapshot?.(this, msg.room.mech);
        // Flask / shrine / pyre: a green number when life comes back (not the respawn refill)
        if (
          prevYou &&
          !first &&
          !cantoChanged &&
          performance.now() - this.lastDeathAt > 3000 &&
          Number(msg.room.you.hp) - Number(prevYou.hp) >= 4
        ) {
          const gy = this.standY(this.renderYou.x, this.renderYou.y);
          this.combat?.number(this.renderYou.x, gy + 2.3, this.renderYou.y, Number(msg.room.you.hp) - Number(prevYou.hp), "heal", "you+", performance.now());
        }
        const isHub = msg.room.role === "hub" || msg.room.cantoId === "inferno_01";
        // (hub arrival counsel rides the canto title card now)
        if (isHub && !this.hubTipShown) this.hubTipShown = true;
        const clears: string[] = Array.isArray(msg.room.you?.firstClears)
          ? msg.room.you.firstClears
          : [];
        // Seed known clears on first snapshot so reconnects do not re-revel
        if (this.seenFirstClears.size === 0 && clears.length && first) {
          for (const c of clears) this.seenFirstClears.add(c);
        } else {
          for (const c of clears) {
            if (!this.seenFirstClears.has(c)) {
              this.seenFirstClears.add(c);
              if (c === "inferno_05" && !this.lustClearRevelShown) {
                this.lustClearRevelShown = true;
                this.camPunch = Math.max(this.camPunch, 1.45);
                // (the server's gate line is the toast; the gate itself flares open)
                const judge = this.room?.entities?.find(
                  (e: any) => e.kind === "boss" || /judge/i.test(String(e.name || e.id || ""))
                );
                if (judge) this.spawnAvaFirstClearBurst(judge);
              }
              if (c === "inferno_06") {
                this.camPunch = Math.max(this.camPunch, 1.2);
                const maw = this.room?.entities?.find(
                  (e: any) => e.kind === "boss" || /maw|cerbero/i.test(String(e.name || e.id || ""))
                );
                if (maw) this.spawnAvaFirstClearBurst(maw);
                if (!this.glutClearStashTipShown) {
                  this.glutClearStashTipShown = true;
                  showToast("Bank champion drops at the Dark Wood stash when you return", "info");
                }
              }
              if (c === "inferno_07") {
                document.body.classList.add("ava-first-clear");
                document.body.classList.remove("crush-pressure", "crush-phase2", "crush-enrage");
        this.crushEnrageShown = false;
                window.setTimeout(() => document.body.classList.remove("ava-first-clear"), 1200);
                const bossEnt = this.room?.entities?.find(
                  (e: any) => e.id === "hoard_crush" || e.kind === "boss"
                );
                if (bossEnt) this.spawnAvaFirstClearBurst(bossEnt);
                else {
                  this.camPunch = Math.max(this.camPunch, 1.75);
                  this.camShake = Math.max(this.camShake, 0.48);
                }
                this.crushLootMagnetUntil = this.animT + 14000;
                if (!this.avaClearStashTipShown) {
                  this.avaClearStashTipShown = true;
                  showToast(
                    "Bank weighed drops at the Dark Wood stash — then speak with the Guide",
                    "info"
                  );
                }
              }
            }
          }
        }
        if (msg.room.cantoId === "inferno_05" && (first || cantoChanged) && !this.lustEnterTipShown) {
          this.lustEnterTipShown = true;
          this.stormHeartDownToastShown = false;
          this.stormHeartSeenAlive = false;
          this.poiHintsShown.clear();
        }
        if (msg.room.cantoId === "inferno_06" && (first || cantoChanged) && !this.glutEnterTipShown) {
          this.glutEnterTipShown = true;
          this.glutAvaGateApproachShown = false;
          this.cerberoApproachShown = false;
          this.mireHeartDownToastShown = false;
          this.mireHeartSeenAlive = false;
          this.poiHintsShown.clear();
        }
        if (msg.room.cantoId === "inferno_07" && (first || cantoChanged)) {
          const epi = String(msg.room.subtitleIt || msg.room.subtitle_it || "").trim();
          if (epi) {
            const el = document.getElementById("canto-title");
            if (el) {
              el.classList.remove("canto-epi-once");
              void el.offsetWidth;
              el.classList.add("canto-epi-once");
              window.setTimeout(() => el.classList.remove("canto-epi-once"), 4400);
            }
          }
        }
        if (msg.room.cantoId === "inferno_07" && (first || cantoChanged) && !this.avaEnterTipShown) {
          this.avaEnterTipShown = true;
          this.counterweightApproachShown = false;
          this.hoardHeartDownToastShown = false;
          this.hoardHeartSeenAlive = false;
          this.poiHintsShown.clear();
          // Entrance keep-out read — quiet bone-gold pulse under the wake stone
          const you = msg.room.you;
          if (you) this.spawnAvaEntrancePulse(you.x, you.y);
        }
        if (
          cantoChanged &&
          msg.room.cantoId === "inferno_05" &&
          clears.includes("inferno_05") &&
          !this.lustReturnGlutNudgeShown
        ) {
          // Title card + the gold gate's beacon carry this now
          this.lustReturnGlutNudgeShown = true;
        }
        if (
          cantoChanged &&
          msg.room.cantoId === "inferno_06" &&
          clears.includes("inferno_06") &&
          !this.glutReturnAvaNudgeShown
        ) {
          this.glutReturnAvaNudgeShown = true;
          this.glutAvaGateApproachShown = false;
        }
        const lootIds = new Set<string>();
        for (const e of msg.room.entities) {
          if (e.kind !== "loot") continue;
          lootIds.add(e.id);
        }
        this.seenLootIds = lootIds;
        for (const id of [...this.autoPickupSent.keys()]) {
          if (!lootIds.has(id)) this.autoPickupSent.delete(id);
        }
        break;
      }
      case "dash_denied": {
        // the server still had cooldown left: the button follows its clock
        const ms = Math.max(0, Number(msg.ms) || 0);
        this.dashReadyAt = Date.now() + ms + 60;
        break;
      }
      case "net":
        if (msg.state === "disconnected") {
          this.netOffline = true;
          showToast("Connection lost — reconnecting…", "warn");
        } else if (msg.state === "reconnected") {
          // (draw() swaps the hero's shared materials back: setHeroGhost)
          this.netOffline = false;
          showToast("Reconnected", "info");
        } else if (msg.state === "replaced") {
          this.netOffline = true;
          showToast("This pilgrim walks on in another tab — reload here to take it back", "warn");
        }
        break;
      case "toast": {
        const text = String(msg.text || "");
        showToast(text, msg.level);
        if (/out of range|nothing to strike|no foe in range|lashes empty air/i.test(text)) resetCombo();
        if (/slain|you fall under the weight|wake at the ledger gate/i.test(text)) this.triggerDeathRevive();
        if (
          this.room?.cantoId === "inferno_07" &&
          (/^pesato — equipped/i.test(text) || /^Equipped /i.test(text))
        ) {
          pulseInvBag();
          document.body.classList.add("ava-equip-flash");
          window.setTimeout(() => document.body.classList.remove("ava-equip-flash"), 420);
          this.camPunch = Math.max(this.camPunch, 0.18);
        }

        if (
          this.room?.cantoId === "inferno_07" &&
          msg.level === "loot" &&
          (/^(Dropped|Weighed):/i.test(text) ||
            /^Picked up /i.test(text) ||
            /^(Ledger Cache|misura — Ledger Cache):/i.test(text))
        ) {
          const isCache = /Ledger Cache|misura — Ledger Cache/i.test(text);
          this.camPunch = Math.max(
            this.camPunch,
            isCache ? 0.55 : /^Picked up /i.test(text) ? 0.32 : 0.18
          );
          this.hitFlashAmt = Math.max(
            this.hitFlashAmt,
            isCache ? 0.2 : /^Picked up /i.test(text) ? 0.12 : 0.06
          );
          document.body.classList.add("ava-loot-flash");
          window.setTimeout(() => document.body.classList.remove("ava-loot-flash"), isCache ? 380 : 220);
          // (pickup motes: the shared fly-to-hero PickupFx covers every canto)
          if (isCache) {
            document.body.classList.add("ava-claim-flash");
            window.setTimeout(() => document.body.classList.remove("ava-claim-flash"), 420);
            const cache = this.room.entities.find(
              (e: any) => e.poiKind === "cache" || e.id === "ledger_cache"
            );
            if (cache) {
              this.spawnAvaClaimRing(cache, 0xe8c86a, 1.05, 3.2, 720);
              const cp = this.entityRenderPos(cache);
              this.spawnAvaPickupMotes(cp.x, cp.y, true);
            }
          }
        }
        // Ledger Shrine kneel — bone-gold claim feel (audio-free)
        if (this.room?.cantoId === "inferno_07" && /rebalance — the Ledger Shrine/i.test(text)) {
          this.camPunch = Math.max(this.camPunch, 0.42);
          document.body.classList.add("ava-claim-flash");
          window.setTimeout(() => document.body.classList.remove("ava-claim-flash"), 480);
          const shrine = this.room.entities.find(
            (e: any) => e.poiKind === "shrine" || e.id === "ledger_shrine"
          );
          if (shrine) {
            this.spawnAvaClaimRing(shrine, 0xf2dea0, 0.9, 2.8, 820);
            const sp = this.entityRenderPos(shrine);
            this.spawnAvaHealMotes(sp.x, sp.y);
            const rec = this.nodes.get(String(shrine.id));
            const ember = rec?.group.getObjectByName("ember");
            if (ember) {
              ember.scale.setScalar(1.55);
              window.setTimeout(() => ember.scale.setScalar(1), 520);
            }
          }
        }
        if (/Gluttony gate|gate past the dais opens/i.test(text)) {
          this.camPunch = Math.max(this.camPunch, 1.25);
          this.lustClearRevelShown = true;
        }
        if (/Avarice gate|gate past the Maw opens/i.test(text)) {
          this.camPunch = Math.max(this.camPunch, 1.25);
        }
        // Ledger Bell still — wide bone-gold measure ring at the post (duration reads in toast)
        if (this.room?.cantoId === "inferno_07" && /Ledger Bell stills/i.test(text)) {
          const bell = this.room.entities.find((e: any) => e.poiKind === "bell" || e.id === "ledger_bell");
          if (bell) {
            const pos = this.entityRenderPos(bell);
            const ring = acquireFxRing(0.8, 1.15, 36, 0xe8c86a, 0.78);
            setPlanar(ring.position, pos.x, pos.y, this.standY(pos.x, pos.y, 0.14));
            this.scene.add(ring);
            this.impacts.push({ mesh: ring, start: this.animT, dur: 1180, from: 1.15, to: 5.4 });
            this.camPunch = Math.max(this.camPunch, 0.28);
            document.body.classList.add("ava-bell-still");
            window.setTimeout(() => document.body.classList.remove("ava-bell-still"), 3400);
          }
        }
        break;
      }
      case "stash_open":
        setStashMode(true);
        this.refreshInventoryUi(true);
        break;
      case "ah_listings":
        renderAh(
          msg.listings,
          (id) => this.socket.ahBuy(id),
          (id) => {
            const L = msg.listings.find((x: any) => x.id === id);
            const floor = Math.max(Number(L?.highestBidAsh) || 0, Number(L?.priceAsh) || 0);
            const bid = floor + Math.max(50, Math.round(floor * 0.1));
            this.socket.ahBid(id, bid);
          },
          Number(this.room?.you?.ash) || 0
        );
        setPanelOpen("ah", true);
        break;
      case "error":
        showToast(msg.message, "warn");
        break;
      case "combat":
        this.onCombat(msg);
        break;
      case "pong":
        // (GameSocket keeps the round-trip estimate)
        break;
      case "spell_fx":
        this.onSpellFx(msg);
        break;
      case "telegraph":
        this.onTelegraph(msg as TelegraphMsg);
        break;
      case "telegraph_cancel":
        this.combat?.onTelegraphCancel(String(msg.id), performance.now());
        break;
      // Older servers: the slam messages, drawn as circle telegraphs
      case "champ_telegraph":
      case "boss_telegraph":
        this.onTelegraph({
          id: `legacy:${msg.id}:${Date.now()}`,
          attackerId: msg.attackerId ?? msg.id,
          shape: "circle",
          x: Number(msg.x) || 0,
          y: Number(msg.y) || 0,
          radius: Number(msg.radius) || (msg.type === "boss_telegraph" ? 3.2 : 2.35),
          duration: (Number(msg.duration) || (msg.type === "boss_telegraph" ? 1.4 : 0.6)) * 1000,
          kind: msg.type === "boss_telegraph" ? "boss_slam" : "champ_slam",
        });
        break;
      case "shove":
        this.forces.shove(Number(msg.dx) || 0, Number(msg.dy) || 0, Number(msg.dur) || 220, performance.now());
        break;
      case "status":
        this.forces.status(Number(msg.slow) || 1, Boolean(msg.root), Number(msg.dur) || 0, performance.now());
        break;
      case "entity_removed": {
        const rid = String(msg.id);
        const list = this.room?.entities;
        const idx = Array.isArray(list) ? list.findIndex((e: any) => String(e.id) === rid) : -1;
        const ent = idx >= 0 ? list[idx] : null;
        if (ent && (ent.kind === "mob" || ent.kind === "boss")) {
          const heavy = ent.kind === "boss";
          const pos = this.entityRenderPos(ent);
          // Your kill (you hit it last) gets the full beat; someone else's, a far echo
          const mine = this.lastHitFoe?.id === rid;
          const near = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y) < 16;
          const k = mine ? 1 : near ? 0.4 : 0;
          if (k > 0) {
            this.kickShake((heavy ? 0.55 : 0.24) * k, pos.x - this.renderYou.x, pos.y - this.renderYou.y);
            this.camPunch = Math.max(this.camPunch, (heavy ? 0.85 : 0.42) * k);
            this.camFovKick = Math.max(this.camFovKick, (heavy ? 3.6 : 2.1) * k);
          }
          this.spawnHitFx(pos, heavy ? 0xffd078 : 0xff8844, heavy);
          // Collapse instead of vanishing: the corpse leaves the live node map now and
          // the entity list too (the next snapshot drops it anyway), so nothing respawns it.
          // It falls away from whoever landed the killing blow.
          const rec = this.nodes.get(rid);
          const killer = this.lastAttackerOf.get(rid);
          this.lastAttackerOf.delete(rid);
          const from = killer ? this.attackerPos(killer, this.renderYou) : this.renderYou;
          if (rec && this.combat?.startDeath(rec, from.x, from.y, performance.now())) {
            this.nodes.delete(rid);
            // Avarice coin burst on the killing blow, not when the corpse is disposed
            this.avaPackDeathCoins(rec);
          }
          list.splice(idx, 1);
        }
        break;
      }
      default:
        // A canto mechanic's own messages (cantoMech/*)
        this.mech.onMessage?.(this, msg);
    }
  }

  /** A foe (or a canto hazard) starts a windup: ground shape + attacker pose + cues. */
  onTelegraph(msg: TelegraphMsg) {
    const now = performance.now();
    this.combat?.onTelegraph(msg, now);
    const kind = String(msg.kind || "");
    const dur = Math.max(0.1, (Number(msg.duration) || 500) / 1000);
    if (kind === "boss_slam") {
      const phase = Number(this.room?.entities?.find((e: any) => String(e.id) === String(msg.attackerId))?.phase) || 1;
      this.flashDodge(dur);
      this.camPunch = Math.max(this.camPunch, this.room?.cantoId === "inferno_07" ? 0.22 : 0.14);
      if (this.room?.cantoId === "inferno_07") {
        // Audio-free Crush windup: screen fringe + punch so mute players still tip the measure
        document.body.classList.add("crush-windup");
        window.setTimeout(() => document.body.classList.remove("crush-windup"), Math.max(420, dur * 1000));
        this.camPunch = Math.max(this.camPunch, phase >= 2 ? 0.36 : 0.26);
        this.camShake = Math.max(this.camShake, 0.12);
        this.camFovKick = Math.max(this.camFovKick, phase >= 2 ? 1.6 : 1.05);
        for (const n of this.nodes.values()) {
          if (n.kind !== "hoard_crush") continue;
          const tele = n.group.getObjectByName("mawTelegraph") as THREE.Mesh | undefined;
          if (tele) {
            const mat = tele.material as THREE.MeshBasicMaterial;
            mat.opacity = Math.max(mat.opacity, 0.55);
            tele.scale.setScalar(1.08);
          }
        }
      }
    } else if (kind === "champ_slam" || kind === "champ_cleave") {
      this.camPunch = Math.max(this.camPunch, 0.14);
      this.camShake = Math.max(this.camShake, 0.06);
      if (this.room?.cantoId === "inferno_07") {
        document.body.classList.add("champ-windup");
        window.setTimeout(() => document.body.classList.remove("champ-windup"), Math.max(280, dur * 1000));
      }
    } else {
      // A canto mechanic's heavy kind (registerTeleWeight): the windup punch (its dodge
      // callout is the mechanic's own)
      const weight = teleWeight(kind);
      if (weight) {
        this.camPunch = Math.max(this.camPunch, weight === "boss" ? 0.16 : 0.1);
        this.camShake = Math.max(this.camShake, weight === "boss" ? 0.08 : 0.05);
      }
    }
  }

  /** A telegraph finished filling: slams crack the ground (the hit itself is the server's). */
  onTelegraphLand(l: TelegraphLand) {
    // (a canto mechanic's own heavy kinds land the same way — registerTeleWeight)
    const weight = teleWeight(l.kind);
    const slam = l.kind === "boss_slam" || l.kind === "champ_slam" || l.kind === "champ_cleave" || weight != null;
    if (!slam) return;
    const ava = this.room?.cantoId === "inferno_07";
    const glut = this.room?.cantoId === "inferno_06";
    const shockHex = ava ? 0xf2dea0 : glut ? 0xd8e8a0 : 0xffe08a;
    const coreHex = ava ? 0xd4a840 : glut ? 0xb8c070 : 0xff5533;
    const boss = l.kind === "boss_slam" || weight === "boss";
    // (on the drawn surface: a boss slam lands on its dais, not inside it)
    const lift = 0.09;
    // a line lands along its length: the shock rides its far half
    const line = l.shape === "line";
    const lx = line ? l.x + Math.cos(l.dir) * l.r * 0.62 : l.x;
    const ly = line ? l.y + Math.sin(l.dir) * l.r * 0.62 : l.y;
    const r = l.shape === "cone" ? l.r * 0.6 : line ? Math.min(2.6, l.r * 0.3) : l.r;
    // Boss slams throw a shock ring past the edge; a champion's just cracks its circle
    if (boss) {
      const shock = acquireFxRing(0.9, 1.08, 48, shockHex, 0.95);
      setPlanar(shock.position, lx, ly, this.surfaceY(lx, ly, lift));
      this.scene.add(shock);
      this.impacts.push({ mesh: shock, start: this.animT, dur: 680, from: r * 0.96, to: r * 1.55 });
    }
    const core = acquireFxRing(0.72, 1.0, 48, coreHex, boss ? 0.9 : 0.55);
    setPlanar(core.position, lx, ly, this.surfaceY(lx, ly, lift + 0.02));
    this.scene.add(core);
    this.impacts.push({ mesh: core, start: this.animT, dur: 420, from: r * 0.2, to: r * 1.05 });
    // (a mechanic's lighter kinds — lines landing in a fan — crack without sparks)
    if (this.sparks.length < 3 && weight !== "champ") {
      const burst = spawnSparks(lx, ly, this.surfaceY(lx, ly, 1.55), coreHex, this.animT);
      burst.dur = 640;
      this.scene.add(burst.points);
      this.sparks.push(burst);
    }
    this.noteCombat();
    this.hitLight.color.setHex(coreHex);
    this.hitLight.intensity = ava ? 12 : 16;
    setPlanar(this.hitLight.position, lx, ly, this.standY(lx, ly, 1.4));
    const d = Math.hypot(this.renderYou.x - lx, this.renderYou.y - ly);
    const k = boss ? 1 : 0.55;
    const near = d < l.r + 8 ? 1 : 0.35;
    this.kickShake(0.5 * k * near, this.renderYou.x - lx, this.renderYou.y - ly);
    this.camPunch = Math.max(this.camPunch, 0.78 * k * near);
    this.camFovKick = Math.max(this.camFovKick, 3.4 * k * near);
    // Just outside the ring: the gold "safe" rim (a hit reads from the server's blow)
    // (not for a mechanic's kinds: a cascade's next ring may still be coming)
    if (l.shape === "circle" && !weight && d > l.r && d <= l.r + 1.25) flashSlamSafeRim();
  }

  onCombat(msg: any) {
    const now = performance.now();
    const tid = String(msg.targetId ?? "");
    const youId = this.room?.you?.id != null ? String(this.room.you.id) : "";
    const sockId = this.socket.playerId != null ? String(this.socket.playerId) : "";
    const hitSelf = Boolean(tid) && (tid === youId || tid === sockId);
    this.remoteHeroCombatPose(msg, tid);
    const heroY = this.standY(this.renderYou.x, this.renderYou.y);
    if (hitSelf) {
      const src = msg.attackerId != null ? this.room?.entities?.find((e: any) => String(e.id) === String(msg.attackerId)) : null;
      const sp = src ? this.entityRenderPos(src) : null;
      const awayX = sp ? this.renderYou.x - sp.x : -this.aimX;
      const awayY = sp ? this.renderYou.y - sp.y : -this.aimY;
      // Crush/champ slam resolved while dashed/respawn-iframed — gold safe rim, not a sting
      if (msg.iframeBlocked) {
        flashSlamSafeRim();
        this.camPunch = Math.max(this.camPunch, 0.18);
        this.kickShake(0.08, awayX, awayY);
        this.combat?.number(this.renderYou.x, heroY + 2.2, this.renderYou.y, 0, "block", "you", now);
        return;
      }
      // Damage over time (a burning zone's tick): the number and a faint edge only —
      // no hit-stop, shake or flinch every second
      if (msg.dot) {
        this.hitFlashAmt = Math.max(this.hitFlashAmt, 0.06);
        this.combat?.number(this.renderYou.x, heroY + 2.2, this.renderYou.y, msg.damage, "self", "you", now);
        if (msg.targetHp != null && msg.targetHp <= 0) this.triggerDeathRevive();
        return;
      }
      const slam = msg.teleKind === "boss_slam" || msg.teleKind === "champ_slam" || msg.teleKind === "champ_cleave" || msg.champTele;
      // (a canto mechanic's heavy kinds sting the same — registerTeleWeight)
      const heavy = slam || teleWeight(msg.teleKind) != null;
      this.kickShake(heavy ? 0.5 : 0.38, awayX, awayY);
      this.camPunch = Math.max(this.camPunch, 0.58);
      this.camFovKick = Math.min(this.camFovKick, -3.2);
      // (a red edge, not a white-out: the number and the flinch carry the blow)
      this.hitFlashAmt = Math.max(this.hitFlashAmt, heavy ? 0.24 : 0.14);
      this.hitStopUntil = now + HIT_STOP_MS + 20;
      this.heroFlinchFrom(String(msg.attackerId ?? ""));
      this.spawnHitFx(this.renderYou, 0xff6644, true);
      this.combat?.number(this.renderYou.x, heroY + 2.2, this.renderYou.y, msg.damage, "self", "you", now);
      if (heavy) flashSlamSting();
      else hapticCombat("hurt");
      const soaked = Number(msg.soaked) || 0;
      if (soaked > 0 && msg.wardActive) flashWardSoak();
      if (msg.targetHp != null && msg.targetHp <= 0) this.triggerDeathRevive();
      return;
    }
    const ent = this.room?.entities?.find((e: any) => String(e.id) === tid);
    // The server no longer pushes a full snapshot per hit: apply the new HP right away so
    // plates/bars move on the hit frame (the next ~12Hz snapshot confirms it)
    if (ent && msg.targetHp != null && Number.isFinite(Number(msg.targetHp))) ent.hp = Number(msg.targetHp);
    const attacker = String(msg.attackerId ?? "");
    const weHit = Boolean(attacker) && (attacker === youId || attacker === sockId);
    // A canto hazard's blow (a rolling weight…) carries where it struck from: fx/fy
    const env = msg.fx != null && msg.fy != null;
    if (ent && attacker && !env) {
      // whoever struck last topples it (entity_removed follows the killing blow)
      if (this.lastAttackerOf.size > 96) this.lastAttackerOf.clear();
      this.lastAttackerOf.set(tid, attacker);
    }
    let comboBoost = 0;
    if (weHit && ent && (ent.kind === "mob" || ent.kind === "boss")) {
      this.lastHitFoe = { id: String(ent.id), until: this.animT + GALE_STICKY_MS };
      const streak = noteComboHit();
      if (isComboMilestone(streak)) comboBoost = 0.12;
      if (isComboInfernoFringe(streak)) comboBoost = 0.22;
      if (isComboEclipse(streak)) comboBoost = 0.32;
      if (isComboVoidCorona(streak)) pulseVoidCorona();
      if (isComboAbyss(streak)) pulseAbyssChroma();
      if (isComboRiftShear(streak)) pulseRiftShear(false);
      if (isComboRiftShearMax(streak)) pulseRiftShear(true);
      if (isComboHorizonFold(streak)) pulseHorizonFold();
    }
    if (!ent) return;
    const heavy = ent.kind === "boss";
    const spell = String(msg.spellId || "");
    const pos = this.entityRenderPos(ent);
    const rec = this.nodes.get(String(ent.id));
    // Our own swing already sparked, flinched and hit-stopped on the blade's frame
    // (onSwingContact): the server's message only brings the number. Other foes the
    // same swing cleaved get their own spark + flinch, but no second freeze / shake.
    const match = weHit && !spell ? (this.combat?.matchSwing(tid, now) ?? "none") : "none";
    const predicted = match === "primary";
    const cleaved = match === "cleave";
    const ava = this.room?.cantoId === "inferno_07";
    const weightHit =
      ava &&
      (String(ent.archetype || "").startsWith("weight_") ||
        ent.archetype === "ledger_warden" ||
        ent.archetype === "hoard_heart" ||
        ent.archetype === "coin_wisp");
    if (!predicted) {
      if (weHit && !cleaved) {
        // Your blow: camera punch + hit-stop (someone else's never freezes your screen)
        this.kickShake(0.2 + comboBoost + (weightHit ? 0.04 : 0), pos.x - this.renderYou.x, pos.y - this.renderYou.y);
        this.camPunch = Math.max(this.camPunch, 0.36 + comboBoost + (heavy ? 0.2 : 0) + (weightHit ? 0.08 : 0));
        this.camFovKick = Math.max(this.camFovKick, 2.4 + comboBoost * 4);
        this.hitFlashAmt = Math.max(this.hitFlashAmt, 0.08 + comboBoost);
        // Weight packs: slightly longer iron hit-stop (Gluttony Cerbero parity feel)
        const stopMs = HIT_STOP_MS + (weightHit && (ent.champion || heavy) ? 22 : weightHit ? 10 : 0) + (msg.heavy ? 24 : 0);
        this.hitStopUntil = now + stopMs;
      }
      const dustElite =
        ava &&
        (Boolean(ent.champion) ||
          ent.archetype === "hoard_heart" ||
          ent.archetype === "ledger_warden" ||
          /^counterweight$/i.test(String(ent.name || "")) ||
          // Regular weights: light coin dust every other hit for measure read
          (ent.archetype === "weight_shade" && (this.frameN & 1) === 0));
      this.spawnHitFx(pos, heavy ? 0xffd078 : ava ? 0xf2dea0 : 0xffe8a0, heavy || comboBoost > 0.2 || Boolean(msg.heavy), dustElite);
      if (rec && this.combat) {
        // flinch away from whoever struck (the burst / heart: from its centre)
        let from = this._atkPos;
        if (env) {
          from.x = Number(msg.fx);
          from.y = Number(msg.fy);
        } else from = this.attackerPos(attacker, pos);
        this.combat.hitMob(rec, from.x, from.y, Boolean(msg.heavy), now);
      }
    }
    if ((predicted || cleaved) && comboBoost > 0) {
      this.camPunch = Math.max(this.camPunch, 0.36 + comboBoost);
      this.hitFlashAmt = Math.max(this.hitFlashAmt, 0.16 + comboBoost);
    }
    const style =
      spell === "dash"
        ? "dash"
        : spell
          ? "spell"
          : msg.heavy
            ? "heavy"
            : weHit
              ? "melee"
              : "other";
    const gy = this.standY(pos.x, pos.y);
    const h = rec ? Number((rec.group.userData.mob as { height?: number } | undefined)?.height) || 2 : 2;
    this.combat?.number(pos.x, gy + Math.min(5.6, h + 0.3), pos.y, msg.damage, weHit || style === "other" ? style : "other", tid, now);
    if (weHit) {
      if (msg.targetHp != null && Number(msg.targetHp) <= 0) hapticCombat("kill");
      // (a finisher already buzzed on the blade's frame)
      else if (msg.heavy && !spell && match === "none") hapticCombat("heavy");
    }
  }

  /** Foe id → the last attacker whose blow landed on it (the killer, on removal). */
  lastAttackerOf = new Map<string, string>();

  /** Planar position of a combat message's attacker (a pilgrim, you, or a foe). */
  attackerPos(attackerId: string, fallback: Vec2): Vec2 {
    if (!attackerId) return fallback;
    const youId = this.room?.you?.id != null ? String(this.room.you.id) : "";
    if (attackerId === youId || attackerId === String(this.socket.playerId ?? "")) return this.renderYou;
    const pl = this.nodes.get(`pl:${attackerId}`);
    if (pl) {
      this._atkPos.x = pl.group.position.x;
      this._atkPos.y = pl.group.position.z;
      return this._atkPos;
    }
    const e = this.room?.entities?.find((x: any) => String(x.id) === attackerId);
    return e ? this.entityRenderPos(e) : fallback;
  }
  _atkPos: Vec2 = { x: 0, y: 0 };

  /** Your pilgrim recoils away from whoever struck (the aim side when unknown). */
  heroFlinchFrom(attackerId: string) {
    const src = attackerId ? this.room?.entities?.find((e: any) => String(e.id) === attackerId) : null;
    if (src) {
      const p = this.entityRenderPos(src);
      this.heroMotor?.flinch(p.x - this.renderYou.x, p.y - this.renderYou.y);
    } else this.heroMotor?.flinch(this.aimX, this.aimY);
  }

  /** Remote pilgrims: swing at whoever they hit (melee only), flinch when struck. */
  remoteHeroCombatPose(msg: any, tid: string) {
    const attacker = String(msg.attackerId ?? "");
    const atk = attacker ? this.nodes.get(`pl:${attacker}`) : undefined;
    if (atk && !msg.spellId) {
      const ud = atk.group.userData;
      // one swing per blow, not per cleave victim
      if (!(this.animT - (Number(ud.lastSwingAt) || -1e9) < 250)) {
        const chain = this.animT - (Number(ud.lastSwingAt) || -1e9) < SWING_MS + 320;
        ud.swingKind = chain ? ((Number(ud.swingKind) || 0) + 1) % 3 : 0;
        ud.lastSwingAt = this.animT;
        // the packet marks contact: skip most of the anticipation
        humanoidSwing(atk.group, this.animT, ud.swingKind, SWING_MS, 0.22);
        this.heroMotor?.remoteSwing(atk.group, ud.swingKind);
        const tgt = this.room?.entities?.find((e: any) => String(e.id) === tid);
        if (tgt) {
          const p = this.entityRenderPos(tgt);
          ud.gaitYaw = yawFromPlanar(p.x - atk.group.position.x, p.y - atk.group.position.z);
        }
      }
    }
    const hurt = msg.targetIsPlayer && tid ? this.nodes.get(`pl:${tid}`) : undefined;
    if (hurt) {
      const src = this.room?.entities?.find((e: any) => String(e.id) === attacker);
      const p = src ? this.entityRenderPos(src) : null;
      const g = hurt.group;
      if (p) humanoidFlinch(g, p.x - g.position.x, p.y - g.position.z, this.animT);
    }
  }

  spawnHitFx(pos: Vec2, color: number, heavy = false, dustElite = false) {
    const ring = makeImpactRing(color);
    setPlanar(ring.position, pos.x, pos.y, this.standY(pos.x, pos.y, 0.07));
    this.scene.add(ring);
    this.impacts.push({ mesh: ring, start: this.animT, dur: heavy ? 560 : 360 });
    const core = makeImpactRing(0xfff1c4);
    setPlanar(core.position, pos.x, pos.y, this.standY(pos.x, pos.y, 0.08));
    core.scale.setScalar(0.55);
    this.scene.add(core);
    this.impacts.push({ mesh: core, start: this.animT, dur: heavy ? 280 : 180 });
    // Skip particle bursts far from camera (off-screen combat still gets rings).
    const sparkDist = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
    const sparkCap = isCompactUi() ? 1 : 3;
    const avaDust = this.room?.cantoId === "inferno_07" && (heavy || dustElite);
    if (sparkDist < 36 && this.sparks.length < sparkCap) {
      const burst =
        this.room?.cantoId === "inferno_06" && heavy
          ? spawnSludgeSplash(pos.x, pos.y, this.standY(pos.x, pos.y, 1.35), this.animT)
          : avaDust
            ? spawnGoldDustSplash(pos.x, pos.y, this.standY(pos.x, pos.y, 1.35), this.animT)
            : spawnSparks(
                pos.x,
                pos.y,
                this.standY(pos.x, pos.y, heavy ? 1.35 : 1.1),
                color,
                this.animT
              );
      burst.dur = heavy ? 640 : avaDust ? 520 : 420;
      this.scene.add(burst.points);
      this.sparks.push(burst);
    }
    this.noteCombat();
    this.hitLight.color.setHex(color);
    // Avarice: keep slash readable — softer wash than Lust/Glut punch lights
    const ava = this.room?.cantoId === "inferno_07";
    this.hitLight.intensity = ava ? (heavy ? 9.5 : 5.5) : heavy ? 14 : 8.5;
    setPlanar(this.hitLight.position, pos.x, pos.y, this.standY(pos.x, pos.y, 1.2));
  }

  onSpellFx(msg: any) {
    const id = String(msg.spellId || "");
    // Remote pilgrims strike the matching cast pose (release frame: short wind)
    const caster = msg.casterId != null ? this.nodes.get(`pl:${msg.casterId}`) : undefined;
    if (caster && (id === "gale_bolt" || id === "whirl_ward" || id === "infernal_burst")) {
      humanoidCast(caster.group, id === "gale_bolt" ? "gale" : id === "whirl_ward" ? "ward" : "burst", this.animT, 70);
    }
    if (id === "gale_bolt") {
      const bolt: Bolt = {
        // Avarice: gold bolt (a cached tinted copy — the ember kit material is shared)
        mesh: makeBolt(this.mats!, this.room?.cantoId === "inferno_07" ? 0xd4a840 : undefined),
        x0: Number(msg.x) || this.renderYou.x,
        y0: Number(msg.y) || this.renderYou.y,
        x1: Number(msg.tx ?? msg.x) || this.renderYou.x + this.aimX * 6,
        y1: Number(msg.ty ?? msg.y) || this.renderYou.y + this.aimY * 6,
        start: this.animT,
        dur: Number(msg.duration ?? 0.28) * 1000 || 280,
      };
      this.scene.add(bolt.mesh);
      this.bolts.push(bolt);
    } else if (id === "whirl_ward") {
      // Only your own ward rings you (another pilgrim's cast just poses them), for the
      // server's duration (4.5 s of armor, not 8)
      const youId = String(this.room?.you?.id ?? this.socket.playerId ?? "");
      if (String(msg.casterId ?? "") === youId) {
        if (!this.wardMesh && this.mats) {
          this.wardMesh = makeWardRing(this.mats);
          this.scene.add(this.wardMesh);
        }
        const dur = Number(msg.duration) > 0 ? Number(msg.duration) : 4.5;
        this.wardUntil = this.animT + dur * 1000;
        noteWardBuff(dur);
      }
    } else if (id === "infernal_burst") {
      const mesh = makeBurst(this.mats!);
      const bx = Number(msg.x) || this.renderYou.x;
      const by = Number(msg.y) || this.renderYou.y;
      setPlanar(mesh.position, bx, by, this.standY(bx, by, 0.4));
      this.scene.add(mesh);
      if (this.room?.cantoId === "inferno_07") {
        const mat = mesh.material as THREE.MeshBasicMaterial;
        if (mat?.color) mat.color.setHex(0xc9a227);
        // bone-gold measure burst (storm/mire blues washed out)
        mat.opacity = Math.min(0.55, (mat.opacity || 0.35) + 0.08);
      }
      this.bursts.push({
        mesh,
        start: this.animT,
        dur: 520,
        r: Number(msg.radius) || BURST_RADIUS,
      });
      // Punch only for your own burst
      if (String(msg.casterId ?? "") === String(this.room?.you?.id ?? this.socket.playerId ?? "")) {
        this.camPunch = Math.max(this.camPunch, 0.62);
        this.camFovKick = Math.max(this.camFovKick, 3.1);
      }
      this.spawnHitFx({ x: bx, y: by }, 0xff5533, true);
    }
  }

  /**
   * Snapshots arrive ~12Hz (plus kills/casts): rebuild the inventory grid only when bag,
   * stash, equipped or gear stats changed, and only while the panel is open (opening it
   * renders a pending change — see onInventoryOpen). The hero look re-applies only when
   * the equipped set changes.
   */
  refreshInventoryUi(force = false) {
    const you = this.lastYouSnapshot;
    if (!you) return;
    const sig = inventorySignature(you);
    if (sig !== this.lastInvSig) {
      this.lastInvSig = sig;
      this.invDirty = true;
    }
    const lookKey = equipLookKey(you.equipped || {});
    if (this.youGroup && lookKey !== this.lastLookKey) {
      this.lastLookKey = lookKey;
      applyEquippedLook(this.youGroup, you.equipped || {});
    }
    if (!force && (!this.invDirty || !isPanelOpen("inventory"))) {
      // The HUD bag button's "crowded" cue is the one grid-derived bit visible while closed
      if (this.invDirty) {
        const n = Array.isArray(you.inventory) ? you.inventory.length : 0;
        document.getElementById("btn-inv")?.classList.toggle("bag-crowded", n >= 32);
      }
      return;
    }
    this.invDirty = false;
    renderInventory(you.inventory || [], () => {}, {
      equipped: you.equipped || {},
      gearStats: you.gearStats || {},
      stash: you.stash || [],
      onEquipSlotClick: (slot) => {
        const worn = you.equipped?.[slot];
        if (worn) this.socket.unequip({ slot });
      },
    });
    if (this.youGroup) applyEquippedLook(this.youGroup, you.equipped || {});
  }

  noteNewInventoryLoot(you: any) {
    const ids = new Set<string>((you.inventory || []).map((it: any) => String(it.id)));
    if (this.seenInvItemIds.size) {
      for (const id of ids) {
        if (!this.seenInvItemIds.has(id)) {
          pulseInvBag();
          break;
        }
      }
    }
    this.seenInvItemIds = ids;
  }

  doInteract(hit: any) {
    if ((hit.kind === "exit" || hit.poiKind === "portal") && this.portalIsLocked(hit)) {
      this.denyLockedPortal(hit);
      return;
    }
    this.socket.interact(hit.id);
    if (hit.kind === "exit" && hit.toCanto) {
      this.camPunch = 0.8;
      window.setTimeout(() => this.socket.travel(hit.toCanto), 50);
    }
    if (hit.poiKind === "portal" && hit.toCanto) {
      this.camPunch = 0.8;
      window.setTimeout(() => this.socket.travel(hit.toCanto), 50);
    }
    if (hit.poiKind === "ah") {
      setPanelOpen("ah", true);
      this.socket.ahBrowse();
    }
    // Avarice ledger POIs: brief bone-gold measure ring (loot/POI feedback)
    if (
      this.room?.cantoId === "inferno_07" &&
      hit.kind === "poi" &&
      (hit.poiKind === "bell" ||
        hit.poiKind === "cache" ||
        hit.poiKind === "shrine" ||
        hit.poiKind === "marker")
    ) {
      const pos = this.entityRenderPos(hit);
      const ring = acquireFxRing(0.35, 0.72, 28, 0xd4a840, 0.78);
      setPlanar(ring.position, pos.x, pos.y, this.standY(pos.x, pos.y, 0.12));
      this.scene.add(ring);
      this.impacts.push({ mesh: ring, start: this.animT, dur: 520, from: 0.55, to: 2.4 });
      this.camPunch = Math.max(this.camPunch, 0.12);
    }
  }

  /** Nearest interactable within `maxRange` (portals preferred inside exit travel). */
  pickInteractable(maxRange: number): { ent: any; d: number; pos: Vec2 } | null {
    if (!this.room) return null;
    const you = this.youPos();
    let best: any = null;
    let bestD = maxRange;
    let bestPos: Vec2 = { x: 0, y: 0 };
    for (const e of this.room.entities) {
      if (e.kind !== "exit" && !(e.kind === "poi" && e.poiKind === "portal")) continue;
      const pos = this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      const cap = Math.max(maxRange, EXIT_TRAVEL_RANGE);
      if (d < cap && d < bestD) {
        bestD = d;
        best = e;
        bestPos = pos;
      }
    }
    if (!best) {
      bestD = maxRange;
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
    }
    return best ? { ent: best, d: bestD, pos: bestPos } : null;
  }

  /** Soft-snap walk-in: arrive then fire the real interact. */
  tickSoftSnap() {
    if (!this.softSnapTargetId || !this.room) return;
    // Steering, a ground tap or a foe chase replaced our walk target: the player chose otherwise
    if (this.moveTarget !== this.softSnapMove || this.animT > this.softSnapUntil) {
      this.softSnapTargetId = null;
      return;
    }
    const ent = this.room.entities.find((e: any) => String(e.id) === this.softSnapTargetId);
    if (!ent) {
      this.softSnapTargetId = null;
      this.moveTarget = null;
      return;
    }
    const you = this.youPos();
    const pos = ent.kind === "loot" ? this.lootRenderPos(ent) : this.entityRenderPos(ent);
    const d = Math.hypot(pos.x - you.x, pos.y - you.y);
    const need =
      ent.kind === "exit" || ent.poiKind === "portal" ? EXIT_TRAVEL_RANGE * 0.92 : INTERACT_RANGE * 0.92;
    if (d <= need) {
      this.softSnapTargetId = null;
      this.moveTarget = null;
      this.fireInteract(ent);
      return;
    }
    this.softSnapMove.x = pos.x;
    this.softSnapMove.y = pos.y;
  }

  fireInteract(best: any) {
    if (best.kind === "loot") {
      // Server confirms with "Picked up …"; the fly-to-hero mote is the local feedback
      this.notePickupSent(String(best.id));
      this.socket.pickup(best.id);
    } else if (best.kind === "exit" || best.poiKind === "portal") {
      if (this.portalIsLocked(best)) {
        this.denyLockedPortal(best);
        return;
      }
      // Arrived by tap / Use walk-in: channel on our own (moving cancels it)
      this.beginPortalHold(best, { fromKey: false, auto: true });
    } else {
      // The server answers every POI with its own line (or the dialogue panel)
      this.doInteract(best);
    }
  }

  interactNearest() {
    if (!this.room) return;
    // What the prompt shows is what E / Use does (the scan breaks ties toward the objective)
    const shownId = this.nearestInteract?.id;
    const shown = shownId ? this.room.entities.find((e: any) => String(e.id) === shownId) : null;
    if (shown) {
      this.walkToInteract(shown);
      return;
    }
    const hit = this.pickInteractable(INTERACT_RANGE);
    if (hit) {
      this.softSnapTargetId = null;
      this.fireInteract(hit.ent);
      return;
    }
    // Soft snap: just out of reach — walk in, then interact
    const soft = this.pickInteractable(SOFT_SNAP_USE_RANGE);
    if (soft) {
      this.walkToInteract(soft.ent);
      return;
    }
    showToast("Nothing nearby — walk closer to a portal, NPC, or loot", "warn");
  }

  /**
   * Target plate + attack-button hint, ~10 Hz. The objective line is owned by
   * the objective model (guidance.ts) so it can never disagree with the
   * compass or the minimap.
   */
  paintChrome() {
    if (!this.room) return;
    const now = performance.now();
    if (now - this.lastChromeAt < 100) return;
    this.lastChromeAt = now;
    const near = this.nearestFoe(16);
    if (near) {
      const hp = Number(near.e.hp) || 0;
      const max = Number(near.e.maxHp) || hp || 1;
      const isBoss =
        near.e.kind === "boss" ||
        near.e.archetype === "hoard_heart" ||
        near.e.archetype === "storm_heart" ||
        near.e.archetype === "mire_heart" ||
        /^counterweight$/i.test(String(near.e.name || ""));
      this.plateTargetId = String(near.e.id);
      setTargetPlate(near.e.name || "Foe", hp / max, {
        boss: isBoss,
        avarice: this.room?.cantoId === "inferno_07",
      });
    } else {
      this.plateTargetId = null;
      setTargetPlate(null, 0);
    }
    const foeNear = Boolean(this.nearestFoe(CHASE_RANGE));
    if (foeNear !== this.lastFoeNear) {
      this.lastFoeNear = foeNear;
      document.getElementById("btn-attack")?.classList.toggle("foe-near", foeNear);
    }
  }

  foeById(id: string, maxDist: number): { e: any; d: number; pos: Vec2 } | null {
    if (!this.room) return null;
    const e = this.room.entities.find((x: any) => String(x.id) === id);
    if (!e || (e.hp != null && e.hp <= 0)) return null;
    const you = this.youPos();
    const pos = this.entityRenderPos(e);
    const d = Math.hypot(pos.x - you.x, pos.y - you.y);
    if (d > maxDist) return null;
    return { e, d, pos };
  }

  nearestFoe(maxDist: number): { e: any; d: number; pos: Vec2 } | null {
    if (!this.room) return null;
    const you = this.youPos();
    let best: { e: any; d: number; pos: Vec2 } | null = null;
    for (const e of this.room.entities) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      if (e.hp != null && e.hp <= 0) continue;
      const pos = this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      if (d < maxDist && (!best || d < best.d)) best = { e, d, pos };
    }
    return best;
  }

  sip() {
    const you = this.room?.you;
    if (you && you.hp >= you.maxHp && you.mana >= (you.maxMana || 100)) {
      showToast("You are already whole.", "info");
      return;
    }
    noteUtilityCd("btn-sip", 8);
    this.socket.sip();
  }

  flashDodge(sec = 1.4) {
    const el = document.getElementById("dodge-callout");
    if (!el) return;
    if (this.room?.cantoId === "inferno_07") {
      el.textContent = "Dash out of Plutus's slam";
      el.classList.add("avarice-dodge");
    } else {
      el.textContent = "Dash the slam";
      el.classList.remove("avarice-dodge");
    }
    el.classList.remove("hidden");
    window.setTimeout(() => el.classList.add("hidden"), Math.max(400, sec * 1000));
  }

  dash() {
    const now = Date.now();
    if (now < this.dashReadyAt) return;
    if (this.heroMotor && !this.heroMotor.canDash()) return;
    // (a hair over the server's 4 s: a dash the server refuses is a dodge with no iframes)
    this.dashReadyAt = now + DASH_CD_MS;
    noteUtilityCd("btn-dash", 4);
    const len = Math.hypot(this.aimX, this.aimY) || 1;
    const nx = this.aimX / len;
    const ny = this.aimY / len;
    // (a canto's ground may shorten it — the server's dashScale hook agrees)
    const step = 5.5 * (this.mech.dashScale?.(this) ?? 1);
    // Same clamp as the server (room.handleDash): it teleports, we tween there
    const b = this.room?.bounds;
    const to = {
      x: b ? Math.max(2, Math.min(b.width - 2, this.renderYou.x + nx * step)) : this.renderYou.x + nx * step,
      y: b ? Math.max(2, Math.min(b.height - 2, this.renderYou.y + ny * step)) : this.renderYou.y + ny * step,
    };
    // Canto mechanic: wind / obstacles move the end (server room.handleDash mirrors it)
    this.mech.adjustDash?.(this, this.renderYou, to, nx, ny);
    this.moveTarget = null;
    if (this.heroMotor) this.heroMotor.startDash(this.renderYou, to);
    else this.renderYou = { x: to.x, y: to.y };
    this.serverYou.x = to.x;
    this.serverYou.y = to.y;
    this.socket.dash(nx, ny);
  }

  attackNearest(opts?: { silent?: boolean }) {
    if (!this.room) return;
    // A canto mechanic may spend the press on its own action (Gluttony: a thrown clod)
    if (this.mech.onAttackPress?.(this)) return;
    if (this.lockedId) {
      const live = this.room.entities.find((e: any) => String(e.id) === this.lockedId);
      if (!live || (live.hp != null && live.hp <= 0)) this.lockedId = null;
    }
    const melee = this.lockedId
      ? this.foeById(this.lockedId, 80)
      : this.nearestFoe(ATTACK_RANGE);
    const inMelee = melee && melee.d <= ATTACK_RANGE ? melee : this.nearestFoe(ATTACK_RANGE);
    if (inMelee) {
      this.moveTarget = null;
      this.aimX = inMelee.pos.x - this.renderYou.x;
      this.aimY = inMelee.pos.y - this.renderYou.y;
      this.sendAttack(inMelee.e.id);
      return;
    }
    const chase = this.lockedId ? this.foeById(this.lockedId, 80) : this.nearestFoe(CHASE_RANGE);
    if (chase) {
      this.moveTarget = { x: chase.pos.x, y: chase.pos.y };
      this.aimX = chase.pos.x - this.renderYou.x;
      this.aimY = chase.pos.y - this.renderYou.y;
      if (!opts?.silent && this.animT - this.lastChaseToast > 1600) {
        this.lastChaseToast = this.animT;
        showToast(`Closing on ${chase.e.name || "foe"}`, "info");
      }
      return;
    }
    if (!opts?.silent) {
      showToast("No foe in sight — follow the red arrow", "warn");
      resetCombo();
    }
  }

  /**
   * Start a swing. The attack packet is NOT sent here: heroMotor calls
   * onSwingContact when the blade meets the target (~150 ms in), so the hit
   * flash, number and server damage line up with the cut.
   */
  sendAttack(targetId: string) {
    if (this.heroMotor && !this.heroMotor.canSwing()) return;
    if (!this.heroMotor && Date.now() < this.attackBusyUntil) return;
    this.noteCombat();
    this.attackBusyUntil = Date.now() + ATTACK_ANIM_MS;
    noteAttackCd(ATTACK_ANIM_MS / 1000);
    if (this.heroMotor) this.heroMotor.startSwing(targetId);
    else this.onSwingContact(targetId, 0);
  }

  /** heroMotor: the blade reached the target — punch the camera and send the attack. */
  onSwingContact(targetId: string | null, kind: number) {
    this.camPunch = Math.max(this.camPunch, kind === 2 ? 0.3 : 0.22);
    this.camFovKick = Math.max(this.camFovKick, kind === 2 ? 1.7 : 1.35);
    if (!targetId) return;
    const live = this.room?.entities.find((e: any) => String(e.id) === String(targetId));
    if (!live || (live.hp != null && live.hp <= 0)) return;
    const pos = this.entityRenderPos(live);
    if (Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y) > ATTACK_RANGE + 0.45) return;
    // combo: 2 = the overhead finisher (the server counts the chain and hits ×1.3)
    this.socket.attack(targetId, kind);
    // Hit feedback on the blade's frame, not a round trip later: spark, flinch, hit-stop.
    // The server's combat message then only adds the number (consumePrediction).
    const now = performance.now();
    const fin = kind === 2;
    this.combat?.predictContact(String(targetId), now);
    const rec = this.nodes.get(String(targetId));
    if (rec) this.combat?.hitMob(rec, this.renderYou.x, this.renderYou.y, fin, now);
    const ava = this.room?.cantoId === "inferno_07";
    this.spawnHitFx(pos, live.kind === "boss" ? 0xffd078 : ava ? 0xf2dea0 : 0xffe8a0, fin || live.kind === "boss");
    this.kickShake(fin ? 0.32 : 0.2, pos.x - this.renderYou.x, pos.y - this.renderYou.y);
    this.camPunch = Math.max(this.camPunch, fin ? 0.5 : 0.36);
    this.camFovKick = Math.max(this.camFovKick, fin ? 3.2 : 2.4);
    this.hitFlashAmt = Math.max(this.hitFlashAmt, fin ? 0.14 : 0.08);
    this.hitStopUntil = now + HIT_STOP_MS + (fin ? 34 : 0);
    if (fin) hapticCombat("heavy");
  }

  /** heroMotor: live render position of a foe (null once gone or dead). */
  foeRenderPos(id: string): Vec2 | null {
    const e = this.room?.entities?.find((x: any) => String(x.id) === id);
    if (!e || (e.hp != null && e.hp <= 0)) return null;
    return this.entityRenderPos(e);
  }

  /**
   * Hold to attack: tick() swings whenever the last swing ends (re-targeting
   * the live nearest / locked foe, chasing when out of reach) while any source
   * holds. A pointer id (mouse / finger held on a foe) is released by that
   * pointer's pointerup (bindInput).
   */
  startAttackHold(source: AttackHoldSource) {
    this.attackHolds.add(source);
    this.attackHeld = true;
    // a click on a foe still says "Closing on …" when it has to walk in
    this.attackNearest({ silent: typeof source !== "number" });
  }

  /** Let go of one hold source, or of all of them (focus lost, death). */
  stopAttackHold(source?: AttackHoldSource) {
    if (source === undefined) this.attackHolds.clear();
    else this.attackHolds.delete(source);
    this.attackHeld = this.attackHolds.size > 0;
  }

  castSpell(spellId: SpellId, opts?: { aimX?: number; aimY?: number; preferNearest?: boolean }) {
    if (!this.room || this.pendingCast) return;
    const def = SPELLS[spellId];
    if (!def) return;
    const mana = Number(this.room.you?.mana) || 0;
    if (mana < def.manaCost) {
      flashManaDeny(spellId);
      showToast(`Not enough mana for ${def.name} (${def.manaCost})`, "warn");
      return;
    }
    let ax = opts?.aimX ?? this.aimX;
    let ay = opts?.aimY ?? this.aimY;
    const preferNearest = opts?.preferNearest !== false && opts?.aimX == null;
    if (spellId === "gale_bolt" && preferNearest) {
      const dir = this.pickGaleAimDir();
      ax = dir.x;
      ay = dir.y;
    }
    const len = Math.hypot(ax, ay) || 1;
    this.aimX = ax / len;
    this.aimY = ay / len;
    const wind = SPELL_TELEGRAPH_MS[spellId] ?? 220;
    this.pendingCast = { spellId, aimX: this.aimX, aimY: this.aimY, until: this.animT + wind };
    this.heroMotor?.cast(spellId, wind);
    if (spellId === "gale_bolt") {
      const mesh = makeTelegraph(0xffd078);
      setPlanar(mesh.position, this.renderYou.x, this.renderYou.y, this.standY(this.renderYou.x, this.renderYou.y, 0.1));
      mesh.scale.setScalar(GALE_RANGE);
      this.scene.add(mesh);
      this.teles.push({ mesh, until: this.animT + wind, r: GALE_RANGE });
    }
  }

  pickGaleAimDir(): { x: number; y: number } {
    const you = this.youPos();
    const stickyId = this.lastHitFoe && this.animT < this.lastHitFoe.until ? this.lastHitFoe.id : null;
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
    const seed = spellId === "gale_bolt" ? this.pickGaleAimDir() : { x: this.aimX, y: this.aimY };
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
        this.cancelSpellHold();
        return;
      }
    }
    if (g.spellId === "gale_bolt") this.setGaleAimFromClient(ev.clientX, ev.clientY);
  }

  setGaleAimFromClient(clientX: number, clientY: number) {
    if (!this.spellHold || this.spellHold.spellId !== "gale_bolt") return;
    const g = this.pickGroundClient(clientX, clientY);
    if (!g) return;
    const you = this.youPos();
    let ax = g.x - you.x;
    let ay = g.y - you.y;
    const len = Math.hypot(ax, ay);
    if (len < 0.15) return;
    this.spellHold.aimX = ax / len;
    this.spellHold.aimY = ay / len;
    this.spellHold.aimed = true;
    this.aimX = this.spellHold.aimX;
    this.aimY = this.spellHold.aimY;
  }

  tickSpellKeyAim() {
    const g = this.spellHold;
    if (!g || !g.fromKey || g.spellId !== "gale_bolt") return;
    if (performance.now() - g.startMs < SPELL_HOLD_CONFIRM_MS) return;
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
    this.clearSpellHoldListeners();
    this.spellHold = null;
    document.getElementById(`btn-spell-${spellId}`)?.classList.remove("aiming");
    if (!cast) return;
    if (spellId === "gale_bolt" && heldMs >= GALE_HOLD_TOAST_MS && heldMs < SPELL_HOLD_CONFIRM_MS) {
      showToast("Gale loosed", "info");
    }
    if (spellId === "gale_bolt") {
      if (aimed) this.castSpell("gale_bolt", { aimX, aimY, preferNearest: false });
      else this.castSpell("gale_bolt", { preferNearest: true });
    } else this.castSpell(spellId);
  }

  cancelSpellHold() {
    if (!this.spellHold) return;
    const heldMs = performance.now() - this.spellHold.startMs;
    const spellId = this.spellHold.spellId;
    this.clearSpellHoldListeners();
    this.spellHold = null;
    document.getElementById(`btn-spell-${spellId}`)?.classList.remove("aiming", "pressed");
    flashSpellCancel(spellId);
    if (spellId === "gale_bolt" && heldMs >= GALE_HOLD_TOAST_MS) showToast("Gale cancelled", "info");
  }

  clearSpellHoldListeners() {
    const g = this.spellHold;
    if (!g) return;
    if (g.onMove) window.removeEventListener("pointermove", g.onMove);
    if (g.onUp) {
      window.removeEventListener("pointerup", g.onUp);
      window.removeEventListener("pointercancel", g.onUp);
    }
  }

  resolvePendingCast() {
    const pc = this.pendingCast;
    if (!pc || !this.room) return;
    if (this.animT < pc.until) return;
    this.pendingCast = null;
    const def = SPELLS[pc.spellId];
    if (!def) return;
    this.aimX = pc.aimX;
    this.aimY = pc.aimY;
    this.noteCombat();
    this.socket.cast(pc.spellId, { x: this.aimX, y: this.aimY });
    noteSpellCast(pc.spellId, def.cooldown);
  }

  nearestIsPortalTravel(): any | null {
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

  /**
   * The gate E / Use should channel: the one the prompt shows. A nearer POI or
   * loot wearing the prompt wins (E / Use act on what the prompt says); with
   * no prompt up, any gate in hold range.
   */
  portalForUse(): any | null {
    if (!this.room) return null;
    const shownId = this.nearestInteract?.id;
    const shown = shownId ? this.room.entities.find((e: any) => String(e.id) === shownId) : null;
    if (!shown) return this.nearestIsPortalTravel();
    if (shown.kind !== "exit" && !(shown.kind === "poi" && shown.poiKind === "portal")) return null;
    const you = this.youPos();
    const pos = this.entityRenderPos(shown);
    // Held over from just outside reach: interactNearest walks in and channels on arrival
    return Math.hypot(pos.x - you.x, pos.y - you.y) < EXIT_TRAVEL_RANGE ? shown : null;
  }

  beginInteractHold(ev?: PointerEvent) {
    const portal = this.portalForUse();
    if (portal) {
      this.beginPortalHold(portal, { fromKey: false, pointer: ev });
      return;
    }
    setPortalHoldUi(null);
    this.interactNearest();
  }

  endInteractHold(_ev: PointerEvent, completed: boolean) {
    const ph = this.portalHold;
    if (!ph || ph.fromKey || ph.auto) {
      if (!ph) setPortalHoldUi(null);
      return;
    }
    if (!completed || !ph.completed) {
      this.nudgeEarlyRelease(ph);
      this.cancelPortalHold();
    } else setPortalHoldUi(null);
  }

  /** Let go before the channel filled: say how, once in a while. */
  nudgeEarlyRelease(ph: { target: any; startMs: number; completed: boolean }) {
    if (ph.completed) return;
    const u = (performance.now() - ph.startMs) / PORTAL_HOLD_MS;
    if (u >= 0.97) return;
    const key = isCompactUi() ? "Use" : "E";
    showToast(`Keep holding ${key} to enter ${this.portalDestName(ph.target)}`, "info");
  }

  portalDestName(target: any): string {
    if (target?.toCanto === "inferno_05") return "Lust";
    if (target?.toCanto === "inferno_06") return "Gluttony";
    if (target?.toCanto === "inferno_07") return "Avarice";
    if (target?.toCanto === "inferno_01") return "Dark Wood";
    return String(target?.label || target?.name || "portal");
  }

  /**
   * Travel channel. fromKey: held E; pointer: held Use button; auto: started by
   * arriving at a tapped gate — completes by itself, any steering cancels it.
   */
  beginPortalHold(
    target: any,
    o: { fromKey: boolean; pointer?: PointerEvent; pointerId?: number; auto?: boolean }
  ) {
    if (!target) return;
    if (this.portalIsLocked(target)) {
      this.denyLockedPortal(target);
      setPortalHoldUi(null);
      return;
    }
    if (this.portalHold) this.cancelPortalHold();
    this.softSnapTargetId = null;
    this.moveTarget = null;
    this.velX = 0;
    this.velY = 0;
    const you = this.youPos();
    this.portalHold = {
      target,
      fromKey: o.fromKey,
      auto: Boolean(o.auto),
      pointerId: o.pointer?.pointerId ?? o.pointerId ?? null,
      startMs: performance.now(),
      completed: false,
      onUp: null,
    };
    setPortalHoldUi(0, this.portalDestName(target), o.auto ? "Entering — move to stay" : undefined);
    if (this.portalHoldFx) {
      this.portalHoldFx.group.visible = true;
      setPlanar(this.portalHoldFx.group.position, you.x, you.y, this.standY(you.x, you.y, 0.05));
      tickPortalHoldFx(this.portalHoldFx, 0);
    }
    if (!o.fromKey && !o.auto) {
      const onUp = (e: PointerEvent) => {
        const ph = this.portalHold;
        if (!ph || ph.fromKey || ph.auto) return;
        if (ph.pointerId != null && e.pointerId !== ph.pointerId) return;
        if (!ph.completed) this.cancelPortalHold();
      };
      this.portalHold.onUp = onUp;
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }
  }

  cancelPortalHold() {
    if (!this.portalHold && !this.portalHoldFx?.group.visible) {
      setPortalHoldUi(null);
      return;
    }
    const onUp = this.portalHold?.onUp;
    if (onUp) {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }
    this.portalHold = null;
    setPortalHoldUi(null);
    if (this.portalHoldFx) {
      this.portalHoldFx.group.visible = false;
      this.portalHoldFx.light.intensity = 0;
    }
    if (this.portalLight.intensity > 5.2) this.portalLight.intensity = 5.2;
  }

  tickPortalHold() {
    const ph = this.portalHold;
    if (!ph || ph.completed) return;
    if (ph.fromKey && !this.keys.has("KeyE")) {
      this.nudgeEarlyRelease(ph);
      this.cancelPortalHold();
      return;
    }
    const you = this.youPos();
    const pos = this.entityRenderPos(ph.target);
    if (Math.hypot(pos.x - you.x, pos.y - you.y) > EXIT_TRAVEL_RANGE) {
      this.cancelPortalHold();
      return;
    }
    const stick = this.joystick.peekVector();
    const steering =
      this.keys.has("KeyW") ||
      this.keys.has("KeyS") ||
      this.keys.has("KeyA") ||
      this.keys.has("KeyD") ||
      this.keys.has("ArrowUp") ||
      this.keys.has("ArrowDown") ||
      this.keys.has("ArrowLeft") ||
      this.keys.has("ArrowRight") ||
      Boolean(stick && (Math.abs(stick.x) > 0.18 || Math.abs(stick.y) > 0.18));
    if (steering || this.moveTarget) {
      this.cancelPortalHold();
      return;
    }
    const dest = this.portalDestName(ph.target);
    const u = Math.min(1, (performance.now() - ph.startMs) / PORTAL_HOLD_MS);
    setPortalHoldUi(u, dest, ph.auto ? "Entering — move to stay" : undefined);
    if (this.portalHoldFx) {
      setPlanar(this.portalHoldFx.group.position, you.x, you.y, this.standY(you.x, you.y, 0.05));
      tickPortalHoldFx(this.portalHoldFx, u);
    }
    this.portalLight.intensity = 5.2 + u * 7.5;
    if (u < 1) return;
    ph.completed = true;
    hapticPortalComplete();
    const target = ph.target;
    this.cancelPortalHold();
    // No "Entering…" toast: the canto title card greets the arrival
    this.doInteract(target);
  }

  /** Avarice: faint empty ledger cell after a fodder pack is wiped, until they refill. */

  /** Flush shared combat impact rings/motes (Lust/Glut leave — memory). */
  disposeCombatEphemerals() {
    for (const r of this.impacts) {
      this.scene.remove(r.mesh);
      releaseFx(r.mesh);
    }
    this.impacts = [];
  }

  /** Drop Avarice-only ephemeral meshes/geo when leaving the circle (memory). */
  disposeAvaEphemerals() {
    for (const cell of this.emptyPackCells.values()) {
      this.scene.remove(cell.mesh);
      (cell.mesh.material as THREE.Material).dispose();
    }
    this.emptyPackCells.clear();
    this.lastPackAlive.clear();
    this.lastPackPos.clear();
    // Flush impact rings/motes immediately so shared coin discs aren't held across cantos
    this.disposeCombatEphemerals();
    this.avaDeathBurstActive = 0;
    if (this.sharedCoinDiscGeo) {
      this.sharedCoinDiscGeo.dispose();
      this.sharedCoinDiscGeo = null;
    }
  }

  updateEmptyPackCells() {
    if (!this.room || this.room.cantoId !== "inferno_07") {
      for (const cell of this.emptyPackCells.values()) {
        this.scene.remove(cell.mesh);
        (cell.mesh.material as THREE.Material).dispose();
      }
      this.emptyPackCells.clear();
      this.lastPackAlive.clear();
      return;
    }
    const lastPackPos = this.lastPackPos;
    // Reused per frame (this runs every Avarice frame)
    const counts = this._packCounts;
    counts.clear();
    for (const e of this.room.entities) {
      if (e.kind !== "mob" || !e.packId) continue;
      if (e.hp != null && e.hp <= 0) continue;
      const arch = String(e.archetype || "");
      if (arch.includes("heart") || /counterweight/i.test(String(e.name || "")) || arch.includes("warden")) continue;
      const n = (counts.get(e.packId) || 0) + 1;
      counts.set(e.packId, n);
      let prev = lastPackPos.get(e.packId);
      if (!prev) lastPackPos.set(e.packId, (prev = { x: 0, z: 0 }));
      // Running mean (n === 1 resets it to this mob)
      prev.x += (e.x - prev.x) / n;
      prev.z += (e.y - prev.z) / n;
    }
    for (const [packId, n] of counts) {
      this.lastPackAlive.set(packId, n);
      const cell = this.emptyPackCells.get(packId);
      if (cell) {
        this.scene.remove(cell.mesh);
        (cell.mesh.material as THREE.Material).dispose();
        this.emptyPackCells.delete(packId);
      }
    }
    for (const [packId, prev] of this.lastPackAlive) {
      if (counts.has(packId) || prev <= 0) continue;
      this.lastPackAlive.set(packId, 0);
      if (this.emptyPackCells.has(packId)) continue;
      const pos = lastPackPos.get(packId);
      if (!pos) continue;
      const geo = this.sharedCoinDiscGeo || (this.sharedCoinDiscGeo = markShared(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 8)));
      const mesh = new THREE.Mesh(
        sharedGeo("packCell", () => new THREE.RingGeometry(0.55, 1.15, 24)),
        new THREE.MeshBasicMaterial({
          color: 0xa89050,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          side: THREE.DoubleSide,
          forceSinglePass: true,
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      setPlanar(mesh.position, pos.x, pos.z, this.standY(pos.x, pos.z, 0.04));
      this.scene.add(mesh);
      this.emptyPackCells.set(packId, { mesh, x: pos.x, z: pos.z });
      void geo;
    }
    // pulse empty cells
    for (const cell of this.emptyPackCells.values()) {
      const mat = cell.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.18 + Math.sin(this.animT * 0.003) * 0.08;
    }
  }

  /** One-word action for the nearest interactable (world prompt + Use button caption). */
  interactVerb(ent: any, kind: string): string {
    if (kind === "loot") return "Take";
    switch (ent?.poiKind) {
      case "npc":
        return "Talk";
      case "stash":
        return "Stash";
      case "ah":
        return "Trade";
      case "quest":
        return "Writ";
      case "pyre":
      case "shrine":
        return "Kneel";
      case "cache":
        return "Claim";
      case "bell":
        return "Ring";
      case "marker":
        return "Read";
      default:
        return "Use";
    }
  }

  /** Desktop shows the key ("E · Talk"); touch shows just the verb. */
  keyedVerb(verb: string): string {
    return isCompactUi() ? verb : `E · ${verb}`;
  }

  /** Bank mode only makes sense while standing at the stash. */
  checkStashRange() {
    if (!isStashMode() || !this.room) return;
    const st = this.room.entities.find((e: any) => e.kind === "poi" && e.poiKind === "stash");
    const you = this.renderYou;
    if (!st || Math.hypot(st.x - you.x, st.y - you.y) > INTERACT_RANGE + 3) {
      setStashMode(false);
      this.refreshInventoryUi(true);
    }
  }

  scanNearestInteract() {
    // ~12 Hz: prompt, Use label and one-shot hints don't need every frame
    const nowMs = performance.now();
    if (nowMs - this.lastScanAt < 80) return;
    this.lastScanAt = nowMs;
    this.checkStashRange();
    if (!this.room) {
      this.nearestInteract = null;
      return;
    }
    // Wait for the first objective so a spawn tie resolves toward it (no stray pyre hint)
    if (this.guidance && !this.guidance.objective) return;
    const you = this.youPos();
    const objId = this.guidance?.objective?.target?.id ?? null;
    let best: any = null;
    let bestScore = Infinity;
    let fromSticky = false;
    for (const e of this.room.entities) {
      if (e.kind !== "poi" && e.kind !== "exit" && e.kind !== "loot") continue;
      const pos = e.kind === "loot" ? this.lootRenderPos(e) : this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      // Highlight exactly where the action works: gates at hold range, the rest at interact range
      const portal = e.kind === "exit" || e.poiKind === "portal";
      if (d >= (portal ? EXIT_TRAVEL_RANGE : INTERACT_HIGHLIGHT_RANGE)) continue;
      // Near-ties go to the current objective (hub spawn: the Guide, not the pyre)
      const score = d - (objId && String(e.id) === objId ? 1.5 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    // Sticky prompt: keep last interactable briefly so circling doesn't flicker the plate
    if (best) {
      this.stickyInteract = {
        id: String(best.id),
        kind: best.kind,
        label: best.label || best.name,
        ent: best,
        until: this.animT + STICKY_INTERACT_MS,
      };
    } else if (this.stickyInteract && this.animT <= this.stickyInteract.until) {
      const still = this.room.entities.find((e: any) => String(e.id) === this.stickyInteract!.id);
      if (still) {
        best = still;
        fromSticky = true;
      }
      else this.stickyInteract = null;
    } else {
      this.stickyInteract = null;
    }
    const interactBtn = document.getElementById("btn-interact");
    const labelEl = interactBtn?.querySelector<HTMLElement>(".action-label");
    const bestId = best ? String(best.id) : "";
    // Move the highlight + world prompt only when the nearest changes
    if (bestId !== this.promptRecId) {
      const old = this.nodes.get(this.promptRecId);
      if (old) {
        old.hpEl.classList.remove("is-nearest");
        const p = old.hpEl.querySelector(".interact-prompt") as HTMLElement | null;
        if (p) p.hidden = true;
      }
      this.promptRecId = bestId;
    }
    const cur = bestId ? this.nodes.get(bestId) : undefined;
    if (cur && best) {
      if (!cur.hpEl.classList.contains("is-nearest")) cur.hpEl.classList.add("is-nearest");
      const prompt = cur.hpEl.querySelector(".interact-prompt") as HTMLElement | null;
      if (prompt) {
        if (prompt.hidden) prompt.hidden = false;
        // Dimmed while held over from just outside reach
        prompt.classList.toggle("is-sticky", fromSticky);
        const isPortal = best.kind === "exit" || best.poiKind === "portal";
        let text: string;
        let bellCd = 0;
        if (isPortal && this.portalIsLocked(best)) {
          text = `${lockReason(best)} first`;
        } else if (isPortal) {
          const dest = this.portalDestName(best);
          text = isCompactUi() ? `Hold Use — ${dest}` : `Hold E — ${dest}`;
        } else if (best.poiKind === "bell" && (bellCd = Number(this.room?.you?.bellCd) || 0) > 0.4) {
          text = `Bell ${Math.ceil(bellCd)}s`;
        } else {
          text = this.keyedVerb(this.interactVerb(best, cur.kind));
        }
        if (prompt.textContent !== text) prompt.textContent = text;
        const cd = bellCd > 0.4;
        if (prompt.classList.contains("bell-cd") !== cd) {
          prompt.classList.toggle("bell-cd", cd);
          if (!cd) prompt.style.removeProperty("--bell-cd");
        }
        if (cd) prompt.style.setProperty("--bell-cd", String(Math.min(1, bellCd / 18)));
      }
    }
    if (!best) {
      this.nearestInteract = null;
      this.lastInteractHintId = null;
      if (interactBtn && !interactBtn.classList.contains("interact-idle")) {
        interactBtn.classList.remove("interact-ready", "interact-kneel", "interact-claim");
        interactBtn.classList.add("interact-idle");
      }
      if (labelEl && !this.portalHold && labelEl.textContent !== "Interact") labelEl.textContent = "Interact";
      return;
    }
    this.nearestInteract = { id: String(best.id), kind: best.kind, label: best.label || best.name };
    if (interactBtn && !interactBtn.classList.contains("interact-ready")) {
      interactBtn.classList.add("interact-ready");
      interactBtn.classList.remove("interact-idle");
    }
    const avaKneel =
      best.poiKind === "shrine" && this.room?.cantoId === "inferno_07";
    const avaClaim =
      best.poiKind === "cache" && this.room?.cantoId === "inferno_07";
    interactBtn?.classList.toggle("interact-kneel", Boolean(avaKneel));
    interactBtn?.classList.toggle("interact-claim", Boolean(avaClaim));
    if (!this.portalHold && labelEl) {
      const isPortal = best.kind === "exit" || best.poiKind === "portal";
      const cap =
        isPortal && this.portalIsLocked(best) ? "Sealed" : isPortal ? "Hold" : this.interactVerb(best, best.kind);
      if (labelEl.textContent !== cap) labelEl.textContent = cap;
    }

    if (this.lastInteractHintId !== String(best.id)) {
      this.lastInteractHintId = String(best.id);
      if (best.kind === "poi") {
        const id = String(best.id);
        if (!this.poiHintsShown.has(id)) {
          // Content hints say "E to …" / "E — …"; on touch the key is the Use seal
          let hint = String(best.hint || "").trim();
          if (isCompactUi()) {
            hint = hint
              .replace(/\bE to\b/g, "Use to")
              .replace(/\bHold E\b/g, "Hold Use")
              .replace(/^E — /, "Use — ");
          }
          // A gate's hint explains its seal: an open road needs no "once X falls…"
          if (best.poiKind === "portal" && !this.portalIsLocked(best)) hint = "";
          if (import.meta.env.DEV && hint.length > HINT_MAX) {
            console.info(`[content] POI ${id} hint is ${hint.length} chars (toast holds ~${HINT_MAX})`);
          }
          let line = hint;
          if (!line) {
            if (best.poiKind === "cache") {
              line =
                this.room?.cantoId === "inferno_07"
                  ? "Ledger Cache — one champion drop per visit"
                  : this.room?.cantoId === "inferno_06"
                    ? "Filth Cache — one champion drop per visit"
                    : "Wind Cache — one champion drop per visit";
            } else if (best.poiKind === "shrine") {
              line =
                this.room?.cantoId === "inferno_07"
                  ? "Ledger Shrine — restores life and breath"
                  : this.room?.cantoId === "inferno_06"
                    ? "Mire Shrine — restores life and breath"
                    : "Wind Shrine — restores life and breath";
            } else if (best.poiKind === "bell") {
              line =
                this.room?.cantoId === "inferno_07"
                  ? "Ledger Bell — stills nearby weights"
                  : this.room?.cantoId === "inferno_06"
                    ? "Mire Bell — stills nearby filth"
                    : "Gale Bell — stills nearby shades";
            } else if (best.poiKind === "marker") {
              line =
                this.room?.cantoId === "inferno_07"
                  ? "Ledger Stone — read how the weights clash"
                  : best.hint || "A stone on the road";
            } else if (best.poiKind === "stash") {
              line = "Stash — bank champion drops here";
            } else if (best.poiKind === "ah") {
              line = "Auction House — list and bid in Ash";
            } else if (best.poiKind === "quest") {
              line = "Daily writs — speak with the Guide, then claim";
            } else if (best.poiKind === "pyre") {
              line = "Camp pyre — kneel to mend wounds";
            } else if (best.poiKind === "npc") {
              line = "Guide — counsel for the road ahead";
            }
          }
          if (line) {
            this.poiHintsShown.add(id);
            showToast(line, "info");
          }
        }
      }
    }

    // After Storm Heart falls: one soft beat toward the Judge
    if (this.room?.cantoId === "inferno_05" && !this.stormHeartDownToastShown) {
      const heartAlive = this.room.entities.some(
        (e: any) => e.archetype === "storm_heart" && (e.hp == null || e.hp > 0)
      );
      if (heartAlive) this.stormHeartSeenAlive = true;
      if (
        this.stormHeartSeenAlive &&
        !heartAlive &&
        this.room.entities.some(
          (e: any) => e.kind === "boss" && (e.hp == null || e.hp > 0)
        )
      ) {
        this.stormHeartDownToastShown = true;
        showToast("Storm Heart broken — Minos waits at the gate", "emit");
      }
    }

    // After Mire Heart falls: one soft beat toward Cerbero / Maw
    if (this.room?.cantoId === "inferno_06" && !this.mireHeartDownToastShown) {
      const heartAlive = this.room.entities.some(
        (e: any) => e.archetype === "mire_heart" && (e.hp == null || e.hp > 0)
      );
      if (heartAlive) this.mireHeartSeenAlive = true;
      if (
        this.mireHeartSeenAlive &&
        !heartAlive &&
        this.room.entities.some(
          (e: any) =>
            (e.kind === "boss" || /^cerbero$/i.test(String(e.name || ""))) &&
            (e.hp == null || e.hp > 0)
        )
      ) {
        this.mireHeartDownToastShown = true;
        showToast("Cerbero stirs — the Maw waits beyond", "emit");
      }
    }

    // After Hoard Heart falls: one soft beat toward Counterweight / Crush
    if (this.room?.cantoId === "inferno_07" && !this.hoardHeartDownToastShown) {
      const heartAlive = this.room.entities.some(
        (e: any) => e.archetype === "hoard_heart" && (e.hp == null || e.hp > 0)
      );
      if (heartAlive) this.hoardHeartSeenAlive = true;
      if (
        this.hoardHeartSeenAlive &&
        !heartAlive &&
        this.room.entities.some(
          (e: any) =>
            (e.kind === "boss" || /^counterweight$/i.test(String(e.name || ""))) &&
            (e.hp == null || e.hp > 0)
        )
      ) {
        this.hoardHeartDownToastShown = true;
        // Soft death beat — bone-gold fringe (the server's emit line carries the words)
        document.body.classList.add("hoard-heart-death");
        window.setTimeout(() => document.body.classList.remove("hoard-heart-death"), 900);
        this.camPunch = Math.max(this.camPunch, 0.72);
        this.camShake = Math.max(this.camShake, 0.28);
        this.camFovKick = Math.max(this.camFovKick, 2.4);
      }
    }

    // Mid-lane elite telegraph: Cerbero once when first in highlight range
    if (this.room?.cantoId === "inferno_06" && !this.cerberoApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob" && e.kind !== "champion") continue;
        if (!/^cerbero$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 14) {
          this.cerberoApproachShown = true;
          showToast("Cerbero guards the road — one maw, then the Triple Maw", "warn");
          break;
        }
      }
    }

    // Glut→Ava outbound: once when near the unlocked weighed gate
    if (this.room?.cantoId === "inferno_06" && !this.glutAvaGateApproachShown) {
      const clears = Array.isArray(this.room.you?.firstClears) ? this.room.you.firstClears : [];
      if (clears.includes("inferno_06")) {
        for (const e of this.room.entities) {
          if (!(e.kind === "exit" || e.poiKind === "portal")) continue;
          if (e.toCanto !== "inferno_07") continue;
          if (this.portalIsLocked(e)) continue;
          const pos = this.entityRenderPos(e);
          if (Math.hypot(pos.x - you.x, pos.y - you.y) < 12) {
            this.glutAvaGateApproachShown = true;
            showToast("peso e contrapeso — Hold E at the Avarice gate", "info");
            this.camPunch = Math.max(this.camPunch, 0.35);
            break;
          }
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.counterweightApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob" && e.kind !== "champion") continue;
        if (!/^counterweight$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 14) {
          this.counterweightApproachShown = true;
          showToast("The Counterweight charges down lanes like the weights — step aside", "warn");
          this.camPunch = Math.max(this.camPunch, 0.55);
          break;
        }
      }
    }
  }

  autoPickupScan() {
    if (!this.room) return;
    const now = Date.now();
    if (now - this.lastAutoPickupScan < 220) return;
    this.lastAutoPickupScan = now;
    // Full bag: stop asking (the server would answer "Inventory full." every second)
    let bag = 0;
    for (const it of this.room.you?.inventory || []) if (it && !it.equipSlot) bag++;
    if (bag >= BAG_CAP) {
      if (!this.bagFullWarned) {
        this.bagFullWarned = true;
        showToast("Bag full — melt it in the Inventory or bank at the stash", "warn");
      }
      return;
    }
    this.bagFullWarned = false;
    const you = this.serverYou;
    for (const e of this.room.entities) {
      if (e.kind !== "loot") continue;
      const d = Math.hypot(e.x - you.x, e.y - you.y);
      if (d > AUTO_PICKUP_RANGE) continue;
      const last = this.autoPickupSent.get(e.id) || 0;
      if (now - last < AUTO_PICKUP_RETRY_MS) continue;
      this.autoPickupSent.set(e.id, now);
      this.notePickupSent(String(e.id));
      this.socket.pickup(e.id);
    }
  }

  /** Hub: one reminder the first time a gate is in reach (the world prompt says the rest). */
  hintExit() {
    if (!this.room || this.hubPortalToastShown) return;
    const isHub = this.room.role === "hub" || this.room.cantoId === "inferno_01";
    if (!isHub) return;
    const portal = this.nearestIsPortalTravel();
    if (!portal) return;
    this.hubPortalToastShown = true;
    // Arrived by a tap: the channel is already running on its own — "Hold E" would contradict it
    if (this.portalHold?.auto || this.softSnapTargetId === String(portal.id)) return;
    showToast(isCompactUi() ? "Hold Use at the gate to travel" : "Hold E at the gate to travel", "info");
  }

  triggerDeathRevive() {
    const now = Date.now();
    if (now < this.deathFxUntil) return;
    this.lastDeathAt = performance.now();
    this.forces.clear();
    this._fv.x = 0;
    this._fv.y = 0;
    const ava = this.room?.cantoId === "inferno_07";
    this.deathFxUntil = now + (ava ? DEATH_FX_LOCK_MS + 400 : DEATH_FX_LOCK_MS);
    playDeathRevive();
    if (!this.firstDeathTipShown) {
      this.firstDeathTipShown = true;
      try {
        if (localStorage.getItem("selva_first_death_tip") !== "1") {
          localStorage.setItem("selva_first_death_tip", "1");
          window.setTimeout(() => {
            showToast(
              this.room?.cantoId === "inferno_07"
                ? "Tip: kneel at the Ledger Shrine before facing Plutus"
                : "Tip: you wake at the entrance, briefly untouchable",
              "info"
            );
          }, 700);
        }
      } catch {
        /* ignore storage */
      }
    }
    this.camShake = ava ? 0.72 : 0.6;
    if (ava) this.camPunch = Math.max(this.camPunch, 0.85);
    this.stopAttackHold();
    this.velX = 0;
    this.velY = 0;
    this.moveTarget = null;
    // Collapse where you fell (heroMotor pins you there), then wake at the entrance
    if (this.heroMotor) this.heroMotor.startDeath(this.renderYou);
    else window.setTimeout(() => this.onReviveTeleport(), 200);
  }

  /** Death pose done (or no motor): jump to the server's respawn point. */
  onReviveTeleport() {
    this.renderYou = { x: this.serverYou.x, y: this.serverYou.y };
    this.velX = 0;
    this.velY = 0;
    this.moveTarget = null;
    // The camera cuts with the hero (under the veil) instead of whip-panning across the
    // canto on its follow smoothing — the travel path does the same
    const sx = this.serverYou.x;
    const sy = this.serverYou.y;
    this.camFollow.set(sx, this.standY(sx, sy), sy);
    this.camLead.x = 0;
    this.camLead.z = 0;
    // Avarice: bone-gold wake pulse at the entrance keep-out
    if (this.room?.cantoId === "inferno_07") {
      this.spawnAvaEntrancePulse(this.serverYou.x, this.serverYou.y);
    }
  }

  /**
   * Dev-only control self-test (Rule 4). Independent oracle = nose marker on the wanderer,
   * which the yaw code does not read.
   */
  async selfTestControls() {
    const press = async (code: string, ms: number) => {
      this.keys.add(code);
      await new Promise((r) => setTimeout(r, ms));
      this.keys.delete(code);
      await new Promise((r) => setTimeout(r, 80));
    };
    const { fwd, right } = camPlanarBasis(this.camera);
    const results: string[] = [];
    for (const [code, axis, sign] of [
      ["KeyD", right, 1],
      ["KeyA", right, -1],
      ["KeyW", fwd, 1],
      ["KeyS", fwd, -1],
    ] as const) {
      const p0 = { x: this.renderYou.x, y: this.renderYou.y };
      await press(code, 400);
      const dx = this.renderYou.x - p0.x;
      const dy = this.renderYou.y - p0.y;
      const planar = new THREE.Vector3(dx, 0, dy);
      if (planar.length() < 0.05) {
        results.push(`${code}: no move`);
        continue;
      }
      planar.normalize();
      const along = planar.dot(axis) * sign;
      const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(this.youGroup!.quaternion);
      facing.y = 0;
      facing.normalize();
      const nose = modelFrontWorld(this.youGroup!);
      const toe = this.youGroup!.getObjectByName("toeR");
      const toeDir = new THREE.Vector3();
      if (toe) {
        toe.getWorldPosition(toeDir);
        const hips = new THREE.Vector3();
        this.youGroup!.getWorldPosition(hips);
        toeDir.sub(hips).setY(0);
        if (toeDir.lengthSq() > 1e-6) toeDir.normalize();
      }
      results.push(
        `${code}: along=${along.toFixed(2)} faceMove=${facing.dot(planar).toFixed(2)} nose=${nose.dot(facing).toFixed(2)} toe=${toeDir.lengthSq() ? toeDir.dot(facing).toFixed(2) : "n/a"}`
      );
      console.assert(along > 0.7, `${code} moved the wrong way (cos=${along})`);
      console.assert(facing.dot(planar) > 0.7, `${code} facing off movement`);
      console.assert(nose.dot(facing) > 0.7, `${code} nose off parent heading`);
      if (toeDir.lengthSq()) console.assert(toeDir.dot(facing) > 0.35, `${code} toes off heading`);
    }
    console.info("[selfTestControls]", results);
    showToast(results.join(" · "), "info");
    return results;
  }
}
