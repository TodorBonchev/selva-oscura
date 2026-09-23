import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { GameSocket } from "../net/GameSocket";
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
  isLandscapeCompact,
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
import { camPlanarBasis, placeFollowCamera, setPlanar, yawFromPlanar, UP } from "./frames";
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
  setPortalGateVisual,
  tintMireEnemy,
  type KindKey,
} from "./meshes";
import { applyEquippedLook, equipLookKey } from "./gearLook";
import { buildGround, type GroundRig } from "./ground";
import {
  AshField,
  makeBolt,
  makeBurst,
  disposeObject3D,
  makeDustPuff,
  makeHitFlash,
  makeImpactRing,
  makeLootBeam,
  makePortalHoldFx,
  makeSlashTrail,
  makeSlamTelegraph,
  makeTelegraph,
  makeWardRing,
  placeBolt,
  releaseSparkBurst,
  spawnSparks,
  spawnGoldDustSplash,
  spawnSludgeSplash,
  tickImpact,
  tickPortalHoldFx,
  tickSlamTelegraph,
  tickSparks,
  type Bolt,
  type ImpactRing,
  type PortalHoldFx,
  type SlamTele,
  type SparkBurst,
} from "./fx";
import { tickCounterweight, tickHoardHeart, tickHumanoid, tickHoardCrush, tickLedgerWarden, tickTripleMaw, tickWhirl } from "./anim";
import { makeComposer } from "./post";
import type { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { Radar } from "../ui/radar";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import type { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

type RoomSnap = any;

const INTERACT_RANGE = 5.2;
const INTERACT_HIGHLIGHT_RANGE = 5.0;
const EXIT_HINT_RANGE = 7;
const EXIT_TRAVEL_RANGE = 6.2;
const GALE_STICKY_MS = 1600;
/** Must stay inside the server melee check (3.5) or swings toast "Out of range". */
const ATTACK_RANGE = 3.35;
const CHASE_RANGE = 26;
const AUTO_PICKUP_RANGE = 4.0;
const MAGNET_RANGE = 5.5;
const AUTO_PICKUP_RETRY_MS = 900;
const PREDICT_SPEED = 8.0;
const MOVE_ACCEL = 28;
const MOVE_FRICTION = 18;
const TAP_ARRIVE = 0.35;
const ATTACK_WINDUP_MS = 70;
const ATTACK_RECOVERY_MS = 240;
/** Client slash/attackU duration — matches windup+recovery so anim hits with send. */
const ATTACK_ANIM_MS = ATTACK_WINDUP_MS + ATTACK_RECOVERY_MS;
const SPELL_TELEGRAPH_MS: Record<string, number> = {
  gale_bolt: 180,
  whirl_ward: 260,
  infernal_burst: 300,
};
const SPELL_HOLD_CONFIRM_MS = 200;
const GALE_DRAG_AIM_PX = 26;
const PORTAL_HOLD_MS = 680;
const DEATH_FX_LOCK_MS = 1600;
const ATTACK_HOLD_MS = 720;
const GALE_HOLD_TOAST_MS = 90;
const HIT_STOP_MS = 58;

type NodeRec = {
  id: string;
  kind: KindKey;
  group: THREE.Group;
  label: CSS2DObject;
  hpEl: HTMLElement;
};

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
  portalLight = new THREE.PointLight(0xff6633, 0, 18, 2);
  heroLight = new THREE.PointLight(0xffc878, 4.2, 12, 1.6);
  clickMark: THREE.Group | null = null;
  composer: EffectComposer | null = null;
  gradePass: ShaderPass | null = null;
  bloom: UnrealBloomPass | null = null;
  hitLight = makeHitFlash();
  radar: Radar | null = null;
  frameN = 0;
  combatUntil = 0;
  lastChaseToast = 0;
  dashReadyAt = 0;
  lockedId: string | null = null;
  lockRing: THREE.Mesh | null = null;
  wardMat = new THREE.MeshBasicMaterial({
    color: 0xff5533,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  slowFrames = 0;
  gfxDropped = false;
  propAnims: THREE.Object3D[] = [];
  treeFadeTick = 0;

  room: RoomSnap | null = null;
  joystick: VirtualJoystick;
  keys = new Set<string>();
  moveTarget: Vec2 | null = null;
  lastMoveSend = 0;
  serverYou: Vec2 = { x: 0, y: 0 };
  renderYou: Vec2 = { x: 0, y: 0 };
  predicting = false;
  remoteSmooth = new SmoothStore();
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
  nearExitToastAt = 0;
  seenLootIds = new Set<string>();
  seenInvItemIds = new Set<string>();
  autoPickupSent = new Map<string, number>();
  lastAutoPickupScan = 0;
  attackBusyUntil = 0;
  attackHoldTimer: number | null = null;
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
    pointerId: number | null;
    startMs: number;
    completed: boolean;
    onUp: ((e: PointerEvent) => void) | null;
  } | null = null;
  portalHoldFx: PortalHoldFx | null = null;
  nearestInteract: { id: string; kind: string; label: string } | null = null;
  lastInteractHintId: string | null = null;
  cerberoApproachShown = false;
  mireHeartDownToastShown = false;
  mireHeartSeenAlive = false;
  counterweightApproachShown = false;
  ledgerMidApproachShown = false;
  northMeasureApproachShown = false;
  crushApproachShown = false;
  southSpillApproachShown = false;
  weightChampApproachShown = false;
  nwDriftApproachShown = false;
  swSpillApproachShown = false;
  seDriftApproachShown = false;
  roadWeightsApproachShown = false;
  goldChorusApproachShown = false;
  crushFlankApproachShown = false;
  strayCoinApproachShown = false;
  northLedgerApproachShown = false;
  southBalanceApproachShown = false;
  coinWispsApproachShown = false;
  ledgerWardenApproachShown = false;
  hoardHeartDownToastShown = false;
  hoardHeartSeenAlive = false;
  stormHeartDownToastShown = false;
  stormHeartSeenAlive = false;
  glutClearStashTipShown = false;
  avaClearStashTipShown = false;
  poiHintsShown = new Set<string>();
  mawPressureOn = false;
  crushPressureOn = false;
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
  slams: SlamTele[] = [];
  slash: THREE.Mesh | null = null;
  slashUntil = 0;
  sparks: SparkBurst[] = [];
  dust: { mesh: THREE.Mesh; start: number }[] = [];
  lastDustAt = 0;
  impacts: ImpactRing[] = [];
  hitStopUntil = 0;
  raycaster = new THREE.Raycaster();
  groundPlane = new THREE.Plane(UP, 0);
  tmp = new THREE.Vector3();
  tmp2 = new THREE.Vector3();
  running = false;

  constructor(root: HTMLElement, socket: GameSocket) {
    this.root = root;
    this.socket = socket;
    this.camera = new THREE.PerspectiveCamera(this.camFov(), 1, 0.2, isCompactUi() ? 170 : 240);
    this.renderer = new THREE.WebGLRenderer({
      antialias: !isCompactUi(),
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setClearColor(0x1c1812, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.enabled = !isCompactUi();
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    root.appendChild(this.renderer.domElement);

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
    this.sun.shadow.mapSize.set(256, 256);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 90;
    this.sun.shadow.camera.left = -40;
    this.sun.shadow.camera.right = 40;
    this.sun.shadow.camera.top = 40;
    this.sun.shadow.camera.bottom = -40;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(this.portalLight);
    this.scene.add(this.hitLight);

    const amb = new THREE.AmbientLight(0x8a7a62, 0.48);
    this.scene.add(amb);
    this.fill = new THREE.DirectionalLight(0x88aacc, 0.55);
    this.fill.position.set(-12, 10, -8);
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
    {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = new THREE.Scene();
      env.add(new THREE.HemisphereLight(0xf0e0c0, 0x22180c, 1.35));
      this.scene.environment = pmrem.fromScene(env, 0.04).texture;
      pmrem.dispose();
    }
    this.youGroup = makeByKind("player", this.mats);
    this.youGroup.userData.entityId = "you";
    this.youGroup.scale.setScalar(1.42);
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
          depthWrite: false,
        })
      );
      lock.rotation.x = -Math.PI / 2;
      lock.visible = false;
      this.lockRing = lock;
      this.scene.add(lock);
    }
    this.slash = makeSlashTrail();
    this.slash.visible = false;
    {
      const anchor =
        this.youGroup.getObjectByName("slashAnchor") ||
        this.youGroup.getObjectByName("handR") ||
        this.youGroup;
      anchor.add(this.slash);
    }
    this.portalHoldFx = makePortalHoldFx();
    this.scene.add(this.portalHoldFx.group);

    this.ash = new AshField(isCompactUi() ? 48 : 90, 0xe8d4b0);
    this.scene.add(this.ash.points);
    this.radar = new Radar();

    this.bindInput();
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
      meltBag: () => this.socket.salvageBag(),
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
      const sky = new THREE.Mesh(
        new THREE.SphereGeometry(160, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0x241810, side: THREE.BackSide, fog: false })
      );
      this.scene.add(sky);
    }
    {
      const rig = makeComposer(this.renderer, this.scene, this.camera, { bloom: !isCompactUi() });
      this.composer = rig.composer;
      this.gradePass = rig.grade;
      this.bloom = rig.bloom;
      const bw = this.root.clientWidth || window.innerWidth;
      const bh = this.root.clientHeight || window.innerHeight;
      this.composer.setSize(bw, bh);
      this.bloom?.setSize(Math.max(2, bw >> 1), Math.max(2, bh >> 1));
    }
    this.running = true;
    this.clock.start();
    this.loop();
    document.getElementById("boot-veil")?.classList.add("out");
  }

  pixelRatio(): number {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(isCompactUi() ? 1.2 : 1.5, dpr);
  }

  camFov(): number {
    if (isLandscapeCompact()) return 56;
    if (isCompactUi()) return 54;
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
    this.camera.fov = this.camFov();
    this.camera.far = isCompactUi() ? 170 : 240;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.bloom?.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
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
      if (e.code === "Space") {
        e.preventDefault();
        this.dash();
      }
      if (e.code === "KeyE") {
        const portal = this.nearestIsPortalTravel();
        if (portal) this.beginPortalHold(portal, { fromKey: true });
        else this.interactNearest();
      }
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") {
        this.releaseSpellHold(true);
      }
    });

    this.renderer.domElement.addEventListener("pointerdown", (ev) => {
      if (!this.room) return;
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.("#action-bar, #panels, #hud button, #virtual-joystick, .vj-base, .vj-knob, #modal-backdrop")) {
        return;
      }
      if (this.joystick.isVisible() && this.joystick.containsClientPoint(ev.clientX, ev.clientY)) return;

      const hit = this.pickEntity(ev);
      if (hit) {
        if (hit.kind === "mob" || hit.kind === "boss") {
          this.lockedId = String(hit.id);
          this.attackNearest();
          return;
        }
        if (hit.kind === "loot") {
          this.socket.pickup(hit.id);
          return;
        }
        if (hit.kind === "poi" || hit.kind === "exit") {
          if (hit.kind === "exit" || hit.poiKind === "portal") {
            this.beginPortalHold(hit, { fromKey: false, pointerId: ev.pointerId });
          } else {
            this.doInteract(hit);
          }
          return;
        }
      }
      if (this.joystick.isActive()) return;
      const g = this.pickGround(ev);
      if (g) this.setClickMove(g);
    });
  }

  ndcFromEvent(ev: PointerEvent): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1
    );
  }

  /** Click-to-move: walk locally toward dest and stream predicted steps (never the far dest). */
  setClickMove(g: Vec2) {
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

  pickEntity(ev: PointerEvent): any | null {
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
    return this.remoteSmooth.pos(e.id, { x: e.x, y: e.y });
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

  sendMoveThrottled(x: number, y: number) {
    const now = Date.now();
    if (now - this.lastMoveSend < MOVE_SEND_MS) return;
    this.lastMoveSend = now;
    this.socket.move(x, y);
  }

  loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    // Tab hidden: drain clock, skip sim/draw (rain CSS already pauses via .tab-hidden).
    if (document.hidden) {
      this.clock.getDelta();
      return;
    }
    let dt = this.clock.getDelta();
    if (performance.now() < this.hitStopUntil) dt *= 0.15;
    dt = Math.min(0.05, dt);
    if (dt > 0.034) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (!this.gfxDropped && this.slowFrames > 40) {
      this.gfxDropped = true;
      this.renderer.setPixelRatio(1);
      this.resize();
    }
    this.animT += dt * 1000;
    this.tick(dt);
    this.draw(dt);
  };

  tick(dt: number) {
    if (!this.room) return;
    const { fwd, right } = camPlanarBasis(this.camera);
    let fx = 0;
    let sx = 0;
    const stick = this.joystick.getVector();
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

    if (ix !== 0 || iy !== 0) this.applyContinuousMove(ix, iy, dt);
    else if (this.moveTarget) this.advanceTapMove(dt);
    else this.integrateVelocity(dt, false);

    this.renderYou = reconcileLocal(this.renderYou, this.serverYou, dt, this.predicting, {
      x: this.velX,
      y: this.velY,
    });

    const targets = new Map<string, Vec2>();
    for (const e of this.room.entities) targets.set(e.id, { x: e.x, y: e.y });
    for (const pl of this.room.players) {
      if (pl.id === this.room.you.id) continue;
      targets.set(`pl:${pl.id}`, { x: pl.x, y: pl.y });
    }
    this.remoteSmooth.tick(targets, dt);

    this.autoPickupScan();
    this.scanNearestInteract();
    this.resolvePendingCast();
    this.tickPortalHold();
    this.tickSpellKeyAim();
    this.hintExit();

    if (this.ash) {
      const fight = this.inCombat();
      const ava = this.room.cantoId === "inferno_07";
      // Avarice: stride harder while fighting (gold ash is denser on retint)
      const ashStride = ava && fight && isCompactUi() ? 3 : fight || isCompactUi() || ava ? 2 : 1;
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

  applyContinuousMove(dx: number, dy: number, dtSec: number) {
    const len = Math.hypot(dx, dy);
    if (len > 0.001) {
      const nx = dx / len;
      const ny = dy / len;
      this.velX += nx * MOVE_ACCEL * dtSec;
      this.velY += ny * MOVE_ACCEL * dtSec;
      const mag = Math.min(1, len);
      const maxSp = PREDICT_SPEED * Math.max(0.35, mag);
      const sp = Math.hypot(this.velX, this.velY);
      if (sp > maxSp) {
        this.velX = (this.velX / sp) * maxSp;
        this.velY = (this.velY / sp) * maxSp;
      }
      if (mag > 0.2) {
        this.aimX = nx;
        this.aimY = ny;
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
    this.velX += (dx / d) * MOVE_ACCEL * dtSec;
    this.velY += (dy / d) * MOVE_ACCEL * dtSec;
    const sp = Math.hypot(this.velX, this.velY);
    if (sp > PREDICT_SPEED) {
      this.velX = (this.velX / sp) * PREDICT_SPEED;
      this.velY = (this.velY / sp) * PREDICT_SPEED;
    }
    this.aimX = dx / d;
    this.aimY = dy / d;
    this.integrateVelocity(dtSec, true);
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
    if (this.velX === 0 && this.velY === 0) {
      if (!driven) this.predicting = false;
      return;
    }
    const nx = this.renderYou.x + this.velX * dtSec;
    const ny = this.renderYou.y + this.velY * dtSec;
    this.renderYou = this.clampToBounds(nx, ny);
    this.predicting = true;
    this.sendMoveThrottled(this.renderYou.x, this.renderYou.y);
  }

  draw(dt: number) {
    const compact = isCompactUi();
    if (this.youGroup) {
      setPlanar(this.youGroup.position, this.renderYou.x, this.renderYou.y, this.standY(this.renderYou.x, this.renderYou.y));
      this.youGroup.rotation.y = yawFromPlanar(this.aimX, this.aimY);
      const moving = Math.hypot(this.velX, this.velY) > 0.4;
      const attacking = this.animT < this.slashUntil;
      tickHumanoid(this.youGroup, {
        moving,
        tMs: this.animT,
        attacking,
        attackU: attacking ? 1 - (this.slashUntil - this.animT) / ATTACK_ANIM_MS : 0,
        speed: Math.hypot(this.velX, this.velY),
        channeling: Boolean(this.portalHold && !this.portalHold.completed),
      });
      if (moving && this.animT - this.lastDustAt > 160 && this.dust.length < 8) {
        this.lastDustAt = this.animT;
        const puff = makeDustPuff();
        setPlanar(puff.position, this.renderYou.x, this.renderYou.y, this.standY(this.renderYou.x, this.renderYou.y, 0.05));
        this.scene.add(puff);
        this.dust.push({ mesh: puff, start: this.animT });
      }
      if (this.netOffline) {
        this.youGroup.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.material && "opacity" in m.material) {
            (m.material as THREE.MeshStandardMaterial).transparent = true;
            (m.material as THREE.MeshStandardMaterial).opacity = 0.45;
          }
        });
      }
    }

    this.syncEntities();
    if (this.lockRing) {
      const lock = this.lockedId ? this.foeById(this.lockedId, 80) : null;
      this.lockRing.visible = Boolean(lock);
      if (lock) {
        setPlanar(this.lockRing.position, lock.pos.x, lock.pos.y, this.standY(lock.pos.x, lock.pos.y, 0.08));
        this.lockRing.rotation.z = this.animT * 0.004;
      }
    }

    setPlanar(this.camTarget, this.renderYou.x, this.renderYou.y, this.standY(this.renderYou.x, this.renderYou.y));
    const rate = compact ? CAM_LERP_MOBILE : CAM_LERP_DESKTOP;
    this.camFollow.lerp(this.camTarget, expAlpha(rate, dt));
    placeFollowCamera(this.camera, this.camFollow, compact, 1.32);
    if (this.camPunch > 0.001) {
      this.camera.position.addScaledVector(UP, this.camPunch * 0.42);
      this.camera.getWorldDirection(this.tmp);
      this.camera.position.addScaledVector(this.tmp, -this.camPunch * 1.45);
      this.camPunch *= Math.exp(-dt * 7.2);
    }
    const camFloor = this.standY(this.camera.position.x, this.camera.position.z, 4.6);
    this.camera.position.y = Math.max(this.camera.position.y, camFloor);
    if (this.camShake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.camShake;
      this.camera.position.y += (Math.random() - 0.5) * this.camShake * 0.45;
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
    if (this.gradePass) {
      this.gradePass.uniforms.hitFlash.value = this.hitFlashAmt;
      this.hitFlashAmt *= Math.exp(-dt * 8.5);
    }

    this.sun.position.set(this.camFollow.x + 14, 22, this.camFollow.z + 8);
    this.sun.target.position.copy(this.camFollow);
    this.rim.position.set(this.camFollow.x - 10, 9, this.camFollow.z - 12);
    this.rim.target.position.copy(this.camFollow);

    if (this.slash && this.slashUntil > this.animT) {
      this.slash.visible = true;
      const left = this.slashUntil - this.animT;
      const u = 1 - left / ATTACK_ANIM_MS;
      // Windup holds arc back; impact snaps through; recovery fades.
      const swing = u < 0.22 ? u / 0.22 * 0.22 : u < 0.4 ? 0.22 + ((u - 0.22) / 0.18) * 0.7 : 0.92 + (u - 0.4) * 0.12;
      this.slash.rotation.y = (1 - swing) * Math.PI * 1.05;
      this.slash.rotation.z = 0.22 + swing * 0.7;
      const sm = this.slash.material as THREE.MeshBasicMaterial;
      const bright = u >= 0.22 && u < 0.45 ? 1 : 0.85;
      sm.opacity = bright * (1 - u * u);
      const avaSlash = this.room?.cantoId === "inferno_07";
      sm.color.setHex(
        u >= 0.22 && u < 0.4
          ? avaSlash
            ? 0xfff0c0
            : 0xfff6d8
          : avaSlash
            ? 0xe8c86a
            : 0xffe8a8
      );
      const punch = u >= 0.22 && u < 0.4 ? (avaSlash ? 1.3 : 1.24) : 1;
      this.slash.scale.setScalar((0.82 + swing * 0.55) * punch * (compact ? 0.92 : 1));
    } else if (this.slash) this.slash.visible = false;

    this.frameN++;
    const inCombatRoom =
      this.room?.cantoId === "inferno_05" ||
      this.room?.cantoId === "inferno_06" ||
      this.room?.cantoId === "inferno_07";
    const inGlut = this.room?.cantoId === "inferno_06";
    const inAva = this.room?.cantoId === "inferno_07";
    const fighting = this.inCombat();
    // Compact combat: ease pixel ratio slightly when still at the soft cap (skip if already gfx-dropped).
    if (compact && !this.gfxDropped && this.frameN % 30 === 0) {
      const want = Math.min(fighting ? 1.05 : 1.2, window.devicePixelRatio || 1);
      if (Math.abs(this.renderer.getPixelRatio() - want) > 0.04) {
        this.renderer.setPixelRatio(want);
      }
    }
    const shadowEvery = compact && inCombatRoom ? (inAva ? 5 : 3) : 2;
    const labelEvery = compact && fighting ? (inAva ? 4 : 3) : 2;
    if (this.renderer.shadowMap.enabled && this.frameN % shadowEvery === 0) {
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (inGlut && this.frameN % 4 === 0) this.tickMawPressure();
    if (inAva && this.frameN % (compact ? 5 : 4) === 0) this.tickCrushPressure();
    this.tickAtmosphere();
    this.fadeTreeOccluders();
    this.tickFx(dt);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    if (this.frameN % labelEvery === 0) {
      this.labelRenderer.render(this.scene, this.camera);
    }
    this.paintChrome();
    if (this.radar && this.room) {
      this.radar.tick({
        you: this.renderYou,
        aimX: this.aimX,
        aimY: this.aimY,
        bounds: this.room.bounds,
        entities: this.room.entities,
        cantoId: this.room.cantoId,
        camera: this.camera,
        compact: compact,
        firstClears: Array.isArray(this.room.you?.firstClears) ? this.room.you.firstClears : [],
      });
    }
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
    const hits = this.raycaster.intersectObjects(this.trees, true);
    this.raycaster.far = Infinity;
    const hidden = new Set<THREE.Object3D>();
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.name !== "tree") o = o.parent;
      if (o) hidden.add(o);
    }
    const camX = this.camera.position.x;
    const camZ = this.camera.position.z;
    for (const tree of this.trees) {
      const dx = tree.position.x - camX;
      const dz = tree.position.z - camZ;
      const nearCam = dx * dx + dz * dz < 8.8 * 8.8;
      const fade = hidden.has(tree) || nearCam;
      if (tree.userData.fade === fade) continue;
      tree.userData.fade = fade;
      tree.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const sm = mat as THREE.MeshStandardMaterial;
          if (!("opacity" in sm)) continue;
          sm.transparent = fade;
          sm.opacity = fade ? 0.18 : 1;
          sm.depthWrite = !fade;
        }
      });
    }
  }

  tickFx(dt: number) {
    for (const b of this.bolts) {
      placeBolt(b, this.animT);
      b.mesh.position.y += this.standY(b.mesh.position.x, b.mesh.position.z);
    }
    this.bolts = this.bolts.filter((b) => {
      if (this.animT > b.start + b.dur) {
        this.scene.remove(b.mesh);
        return false;
      }
      return true;
    });
    if (this.wardMesh) {
      this.wardMesh.visible = this.animT < this.wardUntil;
      this.wardMesh.rotation.z = this.animT * 0.004;
      if (this.youGroup) this.wardMesh.position.copy(this.youGroup.position).setY(this.youGroup.position.y + 0.15);
    }
    for (const b of this.bursts) {
      const u = (this.animT - b.start) / b.dur;
      const s = b.r * (0.3 + u * 1.4);
      b.mesh.scale.setScalar(s);
      const mat = b.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 0.4 * (1 - u));
    }
    this.bursts = this.bursts.filter((b) => {
      if (this.animT - b.start > b.dur) {
        this.scene.remove(b.mesh);
        return false;
      }
      return true;
    });
    this.sparks = this.sparks.filter((s) => {
      tickSparks(s, this.animT);
      if (this.animT - s.start > s.dur) {
        this.scene.remove(s.points);
        releaseSparkBurst(s);
        return false;
      }
      return true;
    });
    this.dust = this.dust.filter((d) => {
      const u = (this.animT - d.start) / 380;
      d.mesh.scale.setScalar(1 + u * 2.4);
      const mat = d.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 0.4 * (1 - u));
      if (u >= 1) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        mat.dispose();
        return false;
      }
      return true;
    });
    this.impacts = this.impacts.filter((r) => {
      tickImpact(r, this.animT);
      if (this.animT - r.start > r.dur) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
    if (this.hitLight.intensity > 0.05) this.hitLight.intensity *= Math.exp(-dt * 14);
    else this.hitLight.intensity = 0;
    this.teles = this.teles.filter((t) => {
      const left = t.until - this.animT;
      const mat = t.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.25 + 0.55 * Math.abs(Math.sin(this.animT * 0.012));
      t.mesh.scale.setScalar(t.r * (0.85 + 0.15 * Math.sin(this.animT * 0.02)));
      if (left <= 0) {
        this.scene.remove(t.mesh);
        return false;
      }
      return true;
    });
    this.slams = this.slams.filter((s) => {
      tickSlamTelegraph(s, this.animT);
      if (this.animT >= s.start + s.dur) {
        this.resolveSlam(s);
        this.scene.remove(s.group);
        disposeObject3D(s.group);
        return false;
      }
      return true;
    });

    for (const n of this.nodes.values()) {
      const ribbon = n.group.getObjectByName("ribbon");
      if (ribbon) {
        const rdx = n.group.position.x - this.camFollow.x;
        const rdz = n.group.position.z - this.camFollow.z;
        if (rdx * rdx + rdz * rdz < 48 * 48) ribbon.rotation.y = this.animT * 0.003;
      }
      const disc = n.group.getObjectByName("galeDisc");
      if (disc) {
        (disc as THREE.Mesh).rotation.z = this.animT * 0.0015;
        let s = 1 + Math.sin(this.animT * 0.004) * 0.04;
        if (this.portalHold && String(this.portalHold.target?.id) === n.id) {
          const u = Math.min(1, (performance.now() - this.portalHold.startMs) / PORTAL_HOLD_MS);
          s = 1 + u * 0.22 + Math.sin(this.animT * 0.012) * 0.05;
        }
        disc.scale.set(s, s, 1);
      }
      const galeRibbon = n.group.getObjectByName("galeRibbon");
      if (galeRibbon) galeRibbon.rotation.y += 0.0008;
      const galeRing = n.group.getObjectByName("galeRing");
      if (galeRing) galeRing.rotation.z = -this.animT * 0.0022;
      const inner = n.group.getObjectByName("portalInner");
      if (inner) inner.rotation.y = this.animT * 0.003;
      const ps = n.group.getObjectByName("portalSparks") as THREE.Points | undefined;
      if (ps && this.frameN % 2 === 0) {
        const px = n.group.position.x - this.camFollow.x;
        const pz = n.group.position.z - this.camFollow.z;
        if (px * px + pz * pz < 42 * 42) {
          const arr = (ps.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
          for (let i = 0; i < arr.length / 3; i++) {
            arr[i * 3 + 1] += 0.018;
            if (arr[i * 3 + 1] > 3.6) arr[i * 3 + 1] = 0.35;
          }
          (ps.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        }
      }
      const beam = n.group.getObjectByName("lootBeam");
      if (beam) {
        const avaLoot = this.room?.cantoId === "inferno_07";
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
          beam.rotation.y = this.animT * (avaLoot ? 0.0032 : 0.002);
          const mat = (beam as THREE.Mesh).material as THREE.MeshBasicMaterial;
          mat.opacity = avaLoot
            ? 0.38 + Math.sin(this.animT * 0.008) * 0.2
            : 0.28 + Math.sin(this.animT * 0.006) * 0.12;
        }
      }
      const gem = n.group.getObjectByName("gem");
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
          tickHumanoid(n.group, { moving: false, tMs: this.animT, attacking: false, speed: 0 });
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
          const bob = n.group.getObjectByName("ribbon");
          if (bob) bob.position.y = 0.95 + Math.sin(this.animT * 0.0012) * 0.03;
        } else if (n.group.userData.isHoardHeart) {
          tickHoardHeart(n.group, this.animT);
        } else if (n.group.userData.isCounterweight) {
          tickCounterweight(n.group, this.animT);
          const cwTele = n.group.getObjectByName("cwTelegraph") as THREE.Mesh | undefined;
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
        let glow = n.group.userData.crushGlow as THREE.PointLight | undefined;
        if (glow === undefined) {
          glow = n.group.getObjectByName("crushGlow") as THREE.PointLight | undefined;
          n.group.userData.crushGlow = glow || null;
        }
        if (glow) {
          glow.intensity = d2 > 40 * 40 ? 0.6 : d2 > 22 * 22 ? 1.8 : 3.0;
          glow.visible = d2 < 48 * 48;
        }
        // Windup / phase-2: hot iron emissive telegraph
        const wind = Number(n.group.userData.windupLeft || 0);
        const phase = Number(n.group.userData.bossPhase || 1);
        const body = n.group.getObjectByName("crushBody") as THREE.Mesh | undefined;
        if (body && body.material && !Array.isArray(body.material)) {
          const mat = body.material as THREE.MeshStandardMaterial;
          if (wind > 0.05) {
            const windMax = phase >= 2 ? 1.0 : 1.4;
            mat.emissiveIntensity =
              (phase >= 2 ? 0.72 : 0.55) + (windMax - Math.min(windMax, wind)) * (phase >= 2 ? 0.75 : 0.55);
            if (glow) glow.intensity = Math.max(glow.intensity, phase >= 2 ? 5.4 : 4.2);
          } else if (phase >= 2) {
            mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 0.48);
            if (glow) glow.intensity = Math.max(glow.intensity, 3.4);
          }
        }
      }
      const pulse = Number(n.group.userData.hitPulse) || 0;
      if (pulse > 0.04) {
        const base = Number(n.group.userData.baseScale) || 1;
        const avaWeight = this.room?.cantoId === "inferno_07" && n.kind !== "player";
        n.group.userData.hitPulse = pulse * (avaWeight ? 0.88 : 0.82);
        n.group.scale.setScalar(base * (1 + n.group.userData.hitPulse * (avaWeight ? 0.1 : 0.08)));
      } else if (pulse > 0) {
        n.group.userData.hitPulse = 0;
        const base = Number(n.group.userData.baseScale) || 1;
        n.group.scale.setScalar(base);
      }
      const aura = n.group.getObjectByName("judgeAura");
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
    const seen = new Set<string>();
    for (const e of this.room.entities) {
      const id = String(e.id);
      seen.add(id);
      const kind = resolveKind(e);
      let rec = this.nodes.get(id);
      if (!rec || rec.kind !== kind) {
        if (rec) this.disposeNode(rec);
        rec = this.spawnNode(id, kind, e);
      }
      const pos = e.kind === "loot" ? this.lootRenderPos(e) : this.entityRenderPos(e);
      setPlanar(rec.group.position, pos.x, pos.y, this.standY(pos.x, pos.y));
      if (e.kind === "mob" || e.kind === "boss" || e.kind === "player") {
        const you = this.youPos();
        rec.group.rotation.y = yawFromPlanar(you.x - pos.x, you.y - pos.y);
      }
      if (e.kind === "boss") {
        rec.group.userData.windupLeft = Number(e.windupLeft) || 0;
        const ph = Number(e.phase) || 1;
        rec.group.userData.bossPhase = ph;
        if (this.room?.cantoId === "inferno_07" && e.id === "hoard_crush") {
          document.body.classList.toggle("crush-phase2", ph >= 2);
        }
      }
      if (e.kind === "mob") {
        const stun = Number(e.stunLeft) || 0;
        rec.group.userData.stunLeft = stun;
        let still = rec.group.getObjectByName("stillRing") as THREE.Mesh | undefined;
        if (stun > 0.05) {
          if (!still && this.room.cantoId === "inferno_07") {
            still = new THREE.Mesh(
              new THREE.RingGeometry(0.55, 0.78, 20),
              new THREE.MeshBasicMaterial({
                color: 0xd4a840,
                transparent: true,
                opacity: 0.55,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
              })
            );
            still.rotation.x = -Math.PI / 2;
            still.position.y = 0.12;
            still.name = "stillRing";
            rec.group.add(still);
          }
          if (still) {
            const dx = rec.group.position.x - this.camFollow.x;
            const dz = rec.group.position.z - this.camFollow.z;
            const near = dx * dx + dz * dz < 28 * 28;
            still.visible = near;
            if (near) {
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
      const ward = rec.group.getObjectByName("wardRing");
      if (ward) {
        const isHeart = (a: string | undefined) =>
          a === "storm_heart" || a === "mire_heart" || a === "hoard_heart";
        const heart = this.room.entities.find(
          (h: any) => isHeart(h.archetype) && (h.hp == null || h.hp > 0)
        );
        const near =
          heart &&
          e.kind === "mob" &&
          !isHeart(e.archetype) &&
          Math.hypot(heart.x - e.x, heart.y - e.y) <= 14;
        ward.visible = Boolean(near);
      }
      if (rec.kind === "portal") {
        const locked = this.portalIsLocked(e);
        setPortalGateVisual(rec.group, locked, this.portalOpenTint(e));
        rec.hpEl.classList.toggle("portal-locked", locked);
      }
      this.updateLabel(rec, e, pos);
    }
    for (const pl of this.room.players) {
      if (pl.id === this.room.you.id) continue;
      const id = `pl:${pl.id}`;
      seen.add(id);
      let rec = this.nodes.get(id);
      if (!rec) rec = this.spawnNode(id, "player", { kind: "player", name: pl.name });
      const pos = this.remoteSmooth.pos(id, { x: pl.x, y: pl.y });
      setPlanar(rec.group.position, pos.x, pos.y, this.standY(pos.x, pos.y));
      rec.group.rotation.y = yawFromPlanar(this.renderYou.x - pos.x, this.renderYou.y - pos.y);
      const eq = pl.equipped || {};
      const lookKey = equipLookKey(eq);
      if (rec.group.userData.equipLookKey !== lookKey) {
        applyEquippedLook(rec.group, eq);
        rec.group.userData.equipLookKey = lookKey;
      }
      this.updateLabel(rec, { name: pl.name, kind: "player", hp: pl.hp, maxHp: pl.maxHp }, pos);
    }
    for (const [id, rec] of this.nodes) {
      if (!seen.has(id)) {
        this.disposeNode(rec);
        this.nodes.delete(id);
      }
    }
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
    if (arch === "hoard_heart") {
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
        new THREE.RingGeometry(0.62, 0.74, 18),
        this.wardMat
      );
      ring.name = "wardRing";
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08;
      ring.visible = false;
      group.add(ring);
    }
    if (kind === "portal") {
      setPortalGateVisual(group, this.portalIsLocked(e), this.portalOpenTint(e));
    }
    group.userData.entityId = id.replace(/^pl:/, "");
    const wrap = document.createElement("div");
    wrap.className = "world-label";
    wrap.innerHTML = `<div class="wl-name"></div><div class="wl-hp"><i></i></div><div class="interact-prompt" hidden></div>`;
    const label = new CSS2DObject(wrap);
    label.center.set(0.5, 1);
    const bossY =
      kind === "triple_maw" || kind === "hoard_crush" ? 5.9 : kind === "judge" ? 5.6 : 2.05;
    label.position.set(0, kind === "portal" ? 4.1 : kind === "loot" ? 1.35 : bossY, 0);
    if (kind === "loot") {
      const rarity = String(e?.item?.rarity || "normal");
      const beam = makeLootBeam(RARITY_HEX[rarity] || 0xe8c86a);
      // Avarice: slightly stronger weighed-drop read (still no neon)
      if (this.room?.cantoId === "inferno_07") {
        const mat = beam.material as THREE.MeshBasicMaterial;
        mat.opacity = rarity === "normal" ? 0.55 : rarity === "unique" || rarity === "canto_unique" ? 0.78 : 0.68;
        beam.scale.set(1.1, 1.18, 1.1);
      }
      group.add(beam);
      wrap.classList.add("loot-label");
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
      if (this.portalIsLocked(e)) wrap.classList.add("portal-locked");
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
    group.add(label);
    group.userData.baseScale = group.scale.x;
    this.scene.add(group);
    const rec: NodeRec = { id, kind, group, label, hpEl: wrap };
    this.nodes.set(id, rec);
    return rec;
  }

  disposeNode(rec: NodeRec) {
    this.scene.remove(rec.group);
    rec.label.element.remove();
  }

  updateLabel(rec: NodeRec, e: any, pos: Vec2) {
    const you = this.youPos();
    const d = Math.hypot(pos.x - you.x, pos.y - you.y);
    const nameEl = rec.hpEl.querySelector(".wl-name") as HTMLElement;
    const hp = rec.hpEl.querySelector(".wl-hp") as HTMLElement;
    const fill = rec.hpEl.querySelector(".wl-hp i") as HTMLElement;
    const name = e.item?.name || e.label || e.name || "";
    const foe =
      rec.kind === "whirl" ||
      rec.kind === "champion" ||
      rec.kind === "judge" ||
      rec.kind === "triple_maw" ||
      rec.kind === "hoard_crush";
    const boss = rec.kind === "judge" || rec.kind === "triple_maw" || rec.kind === "hoard_crush";
    const glutCompact =
      (this.room?.cantoId === "inferno_06" || this.room?.cantoId === "inferno_07") && isCompactUi();
    const midboss = rec.hpEl.classList.contains("midboss");
    let far = rec.kind === "loot" ? 22 : boss ? 30 : midboss ? 28 : foe ? 26 : 16;
    if (glutCompact) {
      far = rec.kind === "loot" ? 14 : boss ? 20 : midboss ? 18 : foe ? 13 : 10;
    }
    if (d > far) {
      if (rec.hpEl.style.opacity !== "0") rec.hpEl.style.opacity = "0";
      return;
    }
    const nextOp = d > 10 && !foe && rec.kind !== "loot" ? "0.45" : "1";
    if (rec.hpEl.style.opacity !== nextOp) rec.hpEl.style.opacity = nextOp;
    const shown = foe || midboss || rec.kind === "loot" || d <= 8 ? name : "•";
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
    const range = this.room?.cantoId === "inferno_07" ? MAGNET_RANGE + 1.4 : MAGNET_RANGE;
    if (d > range || d < 0.01) return this.entityRenderPos(e);
    const t = 1 - d / range;
    // Avarice: greed pulls harder (gold-on-black irony)
    const pull = t * t * (this.room?.cantoId === "inferno_07" ? 0.72 : 0.55);
    return { x: e.x + (you.x - e.x) * pull, y: e.y + (you.y - e.y) * pull };
  }


  portalIsLocked(e: any): boolean {
    const need = e?.requireClear;
    if (!need) return false;
    const clears = this.room?.you?.firstClears;
    return !(Array.isArray(clears) && clears.includes(need));
  }

  portalOpenTint(e: any): number {
    if (e?.toCanto === "inferno_07") return 0xd4a840;
    if (e?.toCanto === "inferno_06") return 0xa8c050;
    if (e?.toCanto === "inferno_05") return 0x66ffaa;
    if (this.room?.cantoId === "inferno_07") return 0xc8a040;
    if (this.room?.cantoId === "inferno_06") return 0x88aa44;
    if (this.room?.cantoId === "inferno_05") return 0xff8844;
    return 0xff6633;
  }

  denyLockedPortal(e: any) {
    const need =
      e?.requireClear === "inferno_05"
        ? "the Judge"
        : e?.requireClear === "inferno_06"
          ? "Triple Maw"
          : "the prior circle";
    showToast(`Sealed — clear ${need} first`, "warn");
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

  /** Audio-free Crush pressure: denser fog + gold haze fringe near Hoard Crush. */
  tickCrushPressure() {
    if (!this.room || this.room.cantoId !== "inferno_07") {
      if (this.crushPressureOn) {
        this.crushPressureOn = false;
        document.body.classList.remove("crush-pressure", "crush-phase2");
      }
      return;
    }
    const boss = this.room.entities.find(
      (e: any) => e.kind === "boss" && (e.hp == null || e.hp > 0)
    );
    const near = Boolean(
      boss && Math.hypot(boss.x - this.renderYou.x, boss.y - this.renderYou.y) < 26
    );
    if (near !== this.crushPressureOn) {
      this.crushPressureOn = near;
      document.body.classList.toggle("crush-pressure", near);
    }
    this.fogTargetDensity = near ? this.avaFogBase * 1.4 : this.avaFogBase;
  }

  /** Soft fog/clear lerp on canto change — avoids hard pop. */
  tickAtmosphere() {
    const fog = this.scene.fog;
    if (!(fog instanceof THREE.FogExp2)) return;
    fog.color.lerp(this.fogTargetColor, 0.14);
    fog.density += (this.fogTargetDensity - fog.density) * 0.14;
    this._clearScratch.lerp(this.clearTargetColor, 0.14);
    this.renderer.setClearColor(this._clearScratch, 1);
  }

  rebuildGround() {
    if (!this.room || !this.mats) return;
    if (this.ground) {
      this.scene.remove(this.ground.group);
      this.ground.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry?.dispose();
        // Shared MatKit materials must not be disposed
      });
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
    if (this.ash) {
      if (ava) this.ash.setColor(0xd4a840, isCompactUi() ? 0.32 : 0.4);
      else if (glut) this.ash.setColor(0xb8c070, isCompactUi() ? 0.4 : 0.5);
      else if (lust) this.ash.setColor(0xffb090, isCompactUi() ? 0.45 : 0.55);
      else this.ash.setColor(0xe8d4b0, 0.55);
    }
    if (lust) {
      this.fogTargetColor.setHex(0x3a140e);
      this.fogTargetDensity = 0.015;
      this.clearTargetColor.setHex(0x1a0c08);
      this.hemi.color.set(0xffb080);
      this.hemi.groundColor.set(0x2a1008);
      this.sun.color.set(0xff9960);
      this.sun.intensity = 2.15;
      this.rim.color.set(0xff8844);
      this.hemi.intensity = 1.12;
      this.rim.intensity = 1.7;
      // Small hero fill so silhouette reads through Lust fog (point light, cheap).
      this.heroLight.intensity = 4.05;
      this.heroLight.distance = 10;
    } else if (glut) {
      // Slightly brighter hemi + cooler rim so mire labels read through olive fog.
      this.glutFogBase = 0.022;
      this.mawPressureOn = false;
      this.crushPressureOn = false;
      document.body.classList.remove("maw-pressure");
      document.body.classList.remove("crush-pressure", "crush-phase2");
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
      // Gold-on-black irony — restrained fog so slash stays readable.
      this.avaFogBase = 0.016;
      this.mawPressureOn = false;
      this.crushPressureOn = false;
      document.body.classList.remove("maw-pressure");
      document.body.classList.remove("crush-pressure", "crush-phase2");
      this.fogTargetColor.setHex(0x16120a);
      this.fogTargetDensity = this.avaFogBase;
      this.clearTargetColor.setHex(0x0e0c06);
      this.hemi.color.set(0xd4c090);
      this.hemi.groundColor.set(0x14100a);
      this.hemi.intensity = 1.18;
      this.sun.color.set(0xd4a860);
      this.sun.intensity = 1.85;
      this.rim.color.set(0xc8a040);
      this.rim.intensity = 1.6;
      this.heroLight.intensity = 3.5;
      this.heroLight.distance = 9;
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
    const portals = this.room.entities.filter((e: any) => e.kind === "exit" || e.poiKind === "portal");
    const clears = this.room.you?.firstClears;
    const lustCleared = Array.isArray(clears) && clears.includes("inferno_05");
    const glutCleared = Array.isArray(clears) && clears.includes("inferno_06");
    const portal =
      (glut &&
        glutCleared &&
        portals.find((e: any) => e.toCanto === "inferno_07" && !this.portalIsLocked(e))) ||
      (lust && lustCleared && portals.find((e: any) => e.toCanto === "inferno_06" && !this.portalIsLocked(e))) ||
      portals.find((e: any) => e.toCanto && e.toCanto !== "inferno_01") ||
      portals[0];
    if (portal) {
      const locked = this.portalIsLocked(portal);
      this.portalLight.intensity = locked ? 1.2 : 4.5;
      this.portalLight.color.set(
        portal.toCanto === "inferno_07"
          ? locked
            ? 0x5a5040
            : 0xd4a840
          : portal.toCanto === "inferno_06"
            ? locked
              ? 0x5a5040
              : 0xa8c050
            : lust
              ? 0x66ffaa
              : ava
                ? 0xc8a040
                : glut
                  ? 0x88aa44
                  : 0xff6633
      );
      setPlanar(this.portalLight.position, portal.x, portal.y, this.standY(portal.x, portal.y, 2.2));
    }
  }

  onNet(msg: any) {
    switch (msg.type) {
      case "snapshot": {
        const prevCanto = this.lastCantoId;
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
        if (first || cantoChanged) {
          this.renderYou = { x: sx, y: sy };
          this.remoteSmooth.clear();
          this.moveTarget = null;
          this.autoPickupSent.clear();
          this.lastHitFoe = null;
          this.seenInvItemIds.clear();
          resetCombo();
          this.rebuildGround();
          this.camFollow.set(sx, this.standY(sx, sy), sy);
          this.cancelPortalHold();
          if (cantoChanged) this.camPunch = 1.2;
        }
        const targets = new Map<string, Vec2>();
        for (const e of msg.room.entities) targets.set(e.id, { x: e.x, y: e.y });
        for (const pl of msg.room.players) {
          if (pl.id === msg.room.you.id) continue;
          targets.set(`pl:${pl.id}`, { x: pl.x, y: pl.y });
        }
        for (const [id, t] of targets) {
          if (!this.remoteSmooth.get(id)) this.remoteSmooth.set(id, t);
        }
        const isHub = msg.room.role === "hub" || msg.room.cantoId === "inferno_01";
        if (isHub && !this.hubTipShown) {
          this.hubTipShown = true;
          const clears0: string[] = Array.isArray(msg.room.you?.firstClears)
            ? msg.room.you.firstClears
            : [];
          showToast(
            clears0.includes("inferno_07")
              ? "Avarice is clear — Guide, writ, stash, or hunt the circles again."
              : clears0.includes("inferno_06")
                ? "Gluttony is clear — Guide, writ, stash, then Avarice past the Maw."
                : clears0.includes("inferno_05")
                  ? "Lust is clear — Guide, writ, stash, then Gluttony past the Judge."
                  : "No foes here — speak with the Guide, then take Toward Lust.",
            "info"
          );
        }
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
                showToast("Lust falls — the Gluttony gate past the dais opens", "emit");
              }
              if (c === "inferno_06") {
                this.camPunch = Math.max(this.camPunch, 1.2);
                showToast("Triple Maw broken — the Avarice gate past the Maw opens", "emit");
                if (!this.glutClearStashTipShown) {
                  this.glutClearStashTipShown = true;
                  showToast("Bank champion drops at the Dark Wood stash when you return", "info");
                }
              }
              if (c === "inferno_07") {
                this.camPunch = Math.max(this.camPunch, 1.55);
                document.body.classList.add("ava-first-clear");
                window.setTimeout(() => document.body.classList.remove("ava-first-clear"), 900);
                showToast("misura spezzata — Hoard Crush yields; peso e contrapeso is paid", "emit");
                if (!this.avaClearStashTipShown) {
                  this.avaClearStashTipShown = true;
                  showToast("Bank weighed drops at the Dark Wood stash — then speak with the Guide", "info");
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
          showToast("la bufera — break the Storm Heart, then the Judge", "info");
        }
        if (msg.room.cantoId === "inferno_06" && (first || cantoChanged) && !this.glutEnterTipShown) {
          this.glutEnterTipShown = true;
          this.glutAvaGateApproachShown = false;
          this.cerberoApproachShown = false;
          this.mireHeartDownToastShown = false;
          this.mireHeartSeenAlive = false;
          this.poiHintsShown.clear();
          showToast("piova etterna — clear the mire, then the Triple Maw", "info");
        }
        if (msg.room.cantoId === "inferno_07" && (first || cantoChanged) && !this.avaEnterTipShown) {
          this.avaEnterTipShown = true;
          this.counterweightApproachShown = false;
          this.ledgerMidApproachShown = false;
          this.northMeasureApproachShown = false;
          this.crushApproachShown = false;
          this.southSpillApproachShown = false;
          this.weightChampApproachShown = false;
          this.nwDriftApproachShown = false;
          this.swSpillApproachShown = false;
          this.seDriftApproachShown = false;
          this.roadWeightsApproachShown = false;
          this.goldChorusApproachShown = false;
          this.crushFlankApproachShown = false;
          this.strayCoinApproachShown = false;
          this.northLedgerApproachShown = false;
          this.southBalanceApproachShown = false;
          this.coinWispsApproachShown = false;
          this.ledgerWardenApproachShown = false;
          this.hoardHeartDownToastShown = false;
          this.hoardHeartSeenAlive = false;
          this.poiHintsShown.clear();
          // Gluttony-portal side: weigh the first road; hub/DEV travel keeps the classic line
          if (prevCanto === "inferno_06") {
            showToast("di qua dal peso — Road Weights measure the gate road", "info");
          } else {
            showToast("peso e contrapeso — measure the road, then break Hoard Crush", "info");
          }
        }
        if (
          cantoChanged &&
          msg.room.cantoId === "inferno_05" &&
          clears.includes("inferno_05") &&
          !this.lustReturnGlutNudgeShown
        ) {
          this.lustReturnGlutNudgeShown = true;
          showToast("The Gluttony portal waits past the Judge's dais", "info");
        }
        if (
          cantoChanged &&
          msg.room.cantoId === "inferno_06" &&
          clears.includes("inferno_06") &&
          !this.glutReturnAvaNudgeShown
        ) {
          this.glutReturnAvaNudgeShown = true;
          this.glutAvaGateApproachShown = false;
          showToast("The Avarice gate (peso e contrapeso) waits past the Maw", "info");
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
      case "net":
        if (msg.state === "disconnected") {
          this.netOffline = true;
          showToast("Connection lost — reconnecting…", "warn");
        } else if (msg.state === "reconnected") {
          this.netOffline = false;
          showToast("Reconnected", "info");
          this.youGroup?.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh && m.material && "opacity" in m.material) {
              (m.material as THREE.MeshStandardMaterial).opacity = 1;
            }
          });
        }
        break;
      case "toast": {
        const text = String(msg.text || "");
        showToast(text, msg.level);
        if (/out of range|nothing to strike|no foe in range|lashes empty air/i.test(text)) resetCombo();
        if (/slain/i.test(text)) this.triggerDeathRevive();
        if (
          this.room?.cantoId === "inferno_07" &&
          msg.level === "loot" &&
          (/^(Dropped|Weighed):/i.test(text) ||
            /^Picked up /i.test(text) ||
            /^(Ledger Cache|misura — Ledger Cache):/i.test(text))
        ) {
          this.camPunch = Math.max(this.camPunch, /^Picked up /i.test(text) ? 0.32 : 0.18);
          this.hitFlashAmt = Math.max(this.hitFlashAmt, /^Picked up /i.test(text) ? 0.12 : 0.06);
          document.body.classList.add("ava-loot-flash");
          window.setTimeout(() => document.body.classList.remove("ava-loot-flash"), 220);
        }
        if (/Gluttony gate|gate past the dais opens/i.test(text)) {
          this.camPunch = Math.max(this.camPunch, 1.25);
          this.lustClearRevelShown = true;
        }
        if (/Avarice gate|gate past the Maw opens/i.test(text)) {
          this.camPunch = Math.max(this.camPunch, 1.25);
        }
        // Ledger Bell still — wide bone-gold measure ring at the post
        if (this.room?.cantoId === "inferno_07" && /Ledger Bell stills/i.test(text)) {
          const bell = this.room.entities.find((e: any) => e.poiKind === "bell" || e.id === "ledger_bell");
          if (bell) {
            const pos = this.entityRenderPos(bell);
            const ring = new THREE.Mesh(
              new THREE.RingGeometry(0.8, 1.15, 36),
              new THREE.MeshBasicMaterial({
                color: 0xe8c86a,
                transparent: true,
                opacity: 0.72,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
              })
            );
            ring.rotation.x = -Math.PI / 2;
            setPlanar(ring.position, pos.x, pos.y, this.standY(pos.x, pos.y, 0.14));
            this.scene.add(ring);
            this.impacts.push({ mesh: ring, start: this.animT, dur: 780, from: 1.1, to: 4.6 });
            this.camPunch = Math.max(this.camPunch, 0.22);
          }
        }
        break;
      }
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
      case "spell_fx":
        this.onSpellFx(msg);
        break;
      case "boss_telegraph": {
        const x = Number(msg.x) || 0;
        const y = Number(msg.y) || 0;
        const radius = Number(msg.radius) || 3.2;
        const dur = Number(msg.duration) || 1.4;
        const phase = Number(msg.phase) || 1;
        this.spawnJudgeSlam(x, y, radius, dur);
        this.flashDodge(dur);
        if (phase >= 2 && this.room?.cantoId === "inferno_07") {
          this.camPunch = Math.max(this.camPunch, 0.28);
          this.camFovKick = Math.max(this.camFovKick, 1.6);
        }
        break;
      }
      case "entity_removed": {
        const rid = String(msg.id);
        const ent = this.room?.entities?.find((e: any) => e.id === rid);
        if (ent && (ent.kind === "mob" || ent.kind === "boss")) {
          const heavy = ent.kind === "boss";
          this.camShake = Math.max(this.camShake, heavy ? 0.55 : 0.24);
          this.camPunch = Math.max(this.camPunch, heavy ? 0.85 : 0.42);
          this.camFovKick = Math.max(this.camFovKick, heavy ? 3.6 : 2.1);
          const pos = this.entityRenderPos(ent);
          this.spawnHitFx(pos, heavy ? 0xffd078 : 0xff8844, heavy);
        }
        break;
      }
    }
  }

  onCombat(msg: any) {
    const tid = String(msg.targetId ?? "");
    const youId = this.room?.you?.id != null ? String(this.room.you.id) : "";
    const sockId = this.socket.playerId != null ? String(this.socket.playerId) : "";
    const hitSelf = Boolean(tid) && (tid === youId || tid === sockId);
    if (hitSelf) {
      this.camShake = Math.max(this.camShake, 0.38);
      this.camPunch = Math.max(this.camPunch, 0.58);
      this.camFovKick = Math.min(this.camFovKick, -3.2);
      this.hitFlashAmt = Math.max(this.hitFlashAmt, 0.38);
      this.hitStopUntil = performance.now() + HIT_STOP_MS + 20;
      this.spawnHitFx(this.renderYou, 0xff6644, true);
      this.floatDmg(this.renderYou, msg.damage, true);
      const soaked = Number(msg.soaked) || 0;
      if (soaked > 0 && msg.wardActive) flashWardSoak();
      if (msg.targetHp != null && msg.targetHp <= 0) this.triggerDeathRevive();
      return;
    }
    const ent = this.room?.entities?.find((e: any) => String(e.id) === tid);
    const attacker = String(msg.attackerId ?? "");
    const weHit = Boolean(attacker) && (attacker === youId || attacker === sockId);
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
    if (ent) {
      const heavy = ent.kind === "boss";
      const ava = this.room?.cantoId === "inferno_07";
      const weightHit =
        ava &&
        (String(ent.archetype || "").startsWith("weight_") ||
          ent.archetype === "ledger_warden" ||
          ent.archetype === "hoard_heart" ||
          ent.archetype === "coin_wisp");
      this.camShake = Math.max(this.camShake, 0.2 + comboBoost + (weightHit ? 0.04 : 0));
      this.camPunch = Math.max(
        this.camPunch,
        (weHit ? 0.36 : 0.22) + comboBoost + (heavy ? 0.2 : 0) + (weightHit ? 0.08 : 0)
      );
      this.camFovKick = Math.max(this.camFovKick, (weHit ? 2.4 : 1.2) + comboBoost * 4);
      if (weHit) this.hitFlashAmt = Math.max(this.hitFlashAmt, 0.16 + comboBoost);
      // Weight packs: slightly longer iron hit-stop (Gluttony Cerbero parity feel)
      const stopMs = HIT_STOP_MS + (weightHit && (ent.champion || heavy) ? 22 : weightHit ? 10 : 0);
      this.hitStopUntil = performance.now() + stopMs;
      const pos = this.entityRenderPos(ent);
      this.floatDmg(pos, msg.damage, false);
      const rec = this.nodes.get(String(ent.id));
      if (rec) {
        const base = Number(rec.group.userData.baseScale) || rec.group.scale.x || 1;
        rec.group.userData.baseScale = base;
        rec.group.userData.hitPulse = weightHit ? 1.25 : 1;
        rec.group.scale.setScalar(base * (heavy ? 1.1 : weightHit ? 1.09 : 1.06));
      }
      const dustElite =
        ava &&
        (Boolean(ent.champion) ||
          ent.archetype === "hoard_heart" ||
          ent.archetype === "ledger_warden" ||
          /^counterweight$/i.test(String(ent.name || "")) ||
          // Regular weights: light coin dust every other hit for measure read
          (ent.archetype === "weight_shade" && (this.frameN & 1) === 0));
      this.spawnHitFx(pos, heavy ? 0xffd078 : ava ? 0xf2dea0 : 0xffe8a0, heavy || comboBoost > 0.2, dustElite);
    }
  }

  spawnJudgeSlam(x: number, y: number, radius = 3.2, durationSec = 1.4) {
    const pal =
      this.room?.cantoId === "inferno_07"
        ? "avarice"
        : this.room?.cantoId === "inferno_06"
          ? "gluttony"
          : "lust";
    const built = makeSlamTelegraph(pal);
    // Sit above the Lust dais (top ~0.34) so the disc isn't buried in stone.
    setPlanar(built.group.position, x, y, this.standY(x, y, 0.38));
    built.group.scale.setScalar(Math.max(0.6, radius));
    this.scene.add(built.group);
    this.slams.push({
      ...built,
      x,
      y,
      r: radius,
      start: this.animT,
      dur: Math.max(0.2, durationSec) * 1000,
    });
    this.camPunch = Math.max(this.camPunch, 0.14);
  }

  resolveSlam(s: SlamTele) {
    const pal = s.group.userData.slamPalette as string | undefined;
    const ava = pal === "avarice";
    const glut = pal === "gluttony";
    const shockHex = ava ? 0xf2dea0 : glut ? 0xd8e8a0 : 0xffe08a;
    const coreHex = ava ? 0xd4a840 : glut ? 0xb8c070 : 0xff5533;
    const sparkHex = coreHex;
    const shock = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.08, 48),
      new THREE.MeshBasicMaterial({
        color: shockHex,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    shock.rotation.x = -Math.PI / 2;
    setPlanar(shock.position, s.x, s.y, this.standY(s.x, s.y, 0.4));
    this.scene.add(shock);
    this.impacts.push({ mesh: shock, start: this.animT, dur: 680, from: s.r * 0.96, to: s.r * 1.55 });
    const core = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 1.0, 48),
      new THREE.MeshBasicMaterial({
        color: coreHex,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    core.rotation.x = -Math.PI / 2;
    setPlanar(core.position, s.x, s.y, this.standY(s.x, s.y, 0.42));
    this.scene.add(core);
    this.impacts.push({ mesh: core, start: this.animT, dur: 420, from: s.r * 0.2, to: s.r * 1.05 });
    if (this.sparks.length < 3) {
      const burst = spawnSparks(s.x, s.y, this.standY(s.x, s.y, 1.55), sparkHex, this.animT);
      burst.dur = 640;
      this.scene.add(burst.points);
      this.sparks.push(burst);
    }
    this.noteCombat();
    this.hitLight.color.setHex(coreHex);
    this.hitLight.intensity = ava ? 12 : 16;
    setPlanar(this.hitLight.position, s.x, s.y, this.standY(s.x, s.y, 1.4));
    this.camShake = Math.max(this.camShake, 0.5);
    this.camPunch = Math.max(this.camPunch, 0.78);
    this.camFovKick = Math.max(this.camFovKick, 3.4);
    const d = Math.hypot(this.renderYou.x - s.x, this.renderYou.y - s.y);
    if (d <= s.r + 0.2) flashSlamSting();
    else if (d <= s.r + 1.25) flashSlamSafeRim();
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
    if (id === "gale_bolt") {
      const bolt: Bolt = {
        mesh: makeBolt(this.mats!),
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
      if (!this.wardMesh && this.mats) {
        this.wardMesh = makeWardRing(this.mats);
        this.scene.add(this.wardMesh);
      }
      this.wardUntil = this.animT + 8000;
      noteWardBuff(8);
    } else if (id === "infernal_burst") {
      const mesh = makeBurst(this.mats!);
      const bx = Number(msg.x) || this.renderYou.x;
      const by = Number(msg.y) || this.renderYou.y;
      setPlanar(mesh.position, bx, by, this.standY(bx, by, 0.4));
      this.scene.add(mesh);
      this.bursts.push({
        mesh,
        start: this.animT,
        dur: 520,
        r: Number(msg.radius) || BURST_RADIUS,
      });
      this.camPunch = Math.max(this.camPunch, 0.62);
      this.camFovKick = Math.max(this.camFovKick, 3.1);
      this.spawnHitFx({ x: bx, y: by }, 0xff5533, true);
    }
  }

  floatDmg(pos: Vec2, amount: number, self: boolean) {
    const el = document.createElement("div");
    el.className = `float-dmg${self ? " self" : ""}`;
    el.textContent = `−${Math.round(Number(amount) || 0)}`;
    const obj = new CSS2DObject(el);
    const gy = this.standY(pos.x, pos.y);
    setPlanar(obj.position, pos.x, pos.y, gy + 1.8);
    this.scene.add(obj);
    const t0 = this.animT;
    const tick = () => {
      const u = (this.animT - t0) / 700;
      obj.position.y = gy + 1.8 + u * 1.1;
      el.style.opacity = String(Math.max(0, 1 - u));
      if (u < 1) requestAnimationFrame(tick);
      else {
        this.scene.remove(obj);
        el.remove();
      }
    };
    requestAnimationFrame(tick);
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
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.35, 0.72, 28),
        new THREE.MeshBasicMaterial({
          color: 0xd4a840,
          transparent: true,
          opacity: 0.78,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      setPlanar(ring.position, pos.x, pos.y, this.standY(pos.x, pos.y, 0.12));
      this.scene.add(ring);
      this.impacts.push({ mesh: ring, start: this.animT, dur: 520, from: 0.55, to: 2.4 });
      this.camPunch = Math.max(this.camPunch, 0.12);
    }
  }

  interactNearest() {
    if (!this.room) return;
    const you = this.youPos();
    let best: any = null;
    let bestD = INTERACT_RANGE;
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
      showToast(`Picking up ${best.item?.name || "loot"}`, "loot");
      this.socket.pickup(best.id);
    } else if (best.kind === "exit" || best.poiKind === "portal") {
      if (this.portalIsLocked(best)) {
        this.denyLockedPortal(best);
        return;
      }
      const dest =
        best.toCanto === "inferno_05"
          ? "Lust"
          : best.toCanto === "inferno_06"
            ? "Gluttony"
            : best.toCanto === "inferno_07"
              ? "Avarice"
              : best.toCanto === "inferno_01"
                ? "Dark Wood"
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

  paintChrome() {
    if (!this.room) return;
    const you = this.room.you || {};
    const canto = this.room.cantoId;
    const foes = this.room.entities.filter(
      (e: any) => (e.kind === "mob" || e.kind === "boss") && (e.hp == null || e.hp > 0)
    );
    let line = "Explore the wood";
    if (canto === "inferno_05" || canto === "inferno_06" || canto === "inferno_07") {
      const boss = foes.find((e: any) => e.kind === "boss");
      const shades = foes.filter((e: any) => e.kind === "mob").length;
      const heart = this.room.entities.some(
        (e: any) =>
          (e.archetype === "storm_heart" ||
            e.archetype === "mire_heart" ||
            e.archetype === "hoard_heart") &&
          (e.hp == null || e.hp > 0)
      );
      const isGlut = canto === "inferno_06";
      const isAva = canto === "inferno_07";
      const cerberoUp =
        isGlut &&
        this.room.entities.some(
          (e: any) =>
            /^cerbero$/i.test(String(e.name || "")) && (e.hp == null || e.hp > 0)
        );
      const counterUp =
        isAva &&
        this.room.entities.some(
          (e: any) =>
            /^counterweight$/i.test(String(e.name || "")) && (e.hp == null || e.hp > 0)
        );
      if ((you.hp ?? you.maxHp) < (you.maxHp || 1) * 0.7) {
        line = isAva
          ? "Ledger Shrine on the road will mend you"
          : isGlut
            ? "Mire Shrine on the road will mend you"
            : "Wind Shrine on the road will mend you";
      } else if (isAva && you.x < 36 && heart) {
        line = "peso e contrapeso — weigh the road";
      } else if (heart) {
        line = isAva
          ? "Break the Hoard Heart — nearby shades are warded"
          : isGlut
            ? "Break the Mire Heart — nearby shades are warded"
            : "Break the Storm Heart — nearby shades are warded";
      } else if (isGlut && !heart && cerberoUp) {
        line = "Cerbero stirs — then the Triple Maw";
      } else if (isAva && !heart && counterUp) {
        line = "Tip the Counterweight — then Hoard Crush";
      } else if (shades >= 8 && this.room.entities.some((e: any) => e.poiKind === "bell")) {
        line = isAva
          ? "Ring the Ledger Bell to still a pack"
          : isGlut
            ? "Ring the Mire Bell to still a pack"
            : "Ring the Gale Bell to still a pack";
      } else if (shades > 0) {
        line = `Clear the road — ${shades} shade${shades === 1 ? "" : "s"} left`;
      } else if (boss) {
        line = isAva ? "Slay Hoard Crush" : isGlut ? "Slay the Triple Maw" : "Slay the Judge of the Gate";
      } else if (isAva) {
        line = "Return to Gluttony — bank loot at the Dark Wood stash";
      } else if (isGlut) {
        const cleared = Array.isArray(you.firstClears) && you.firstClears.includes("inferno_06");
        line = cleared
          ? "Hold E at the gold gate — Avarice awaits"
          : "Return to Lust — bank loot at the Dark Wood stash";
      } else {
        const cleared = Array.isArray(you.firstClears) && you.firstClears.includes("inferno_05");
        line = cleared
          ? "Hold E at the gold gate — Gluttony awaits"
          : "Defeat the Judge to open the Gluttony gate";
      }
    } else if ((you.hp ?? you.maxHp) < (you.maxHp || 1) * 0.85) {
      line = "The camp pyre will mend you";
    } else if (!you.spokeToGuide) {
      line = "Speak with the Guide";
    } else if (!you.visitedInferno) {
      line = "Follow the gold arrow into Lust";
    } else {
      const avaOk = Array.isArray(you.firstClears) && you.firstClears.includes("inferno_07");
      const glutOk = Array.isArray(you.firstClears) && you.firstClears.includes("inferno_06");
      const lustOk = Array.isArray(you.firstClears) && you.firstClears.includes("inferno_05");
      line = avaOk
        ? "Claim the daily writ, or hunt Lust / Gluttony / Avarice again"
        : glutOk
          ? "Claim the daily writ, or hunt Lust / Gluttony / Avarice"
          : lustOk
            ? "Claim the daily writ, or hunt Lust / Gluttony"
            : "Claim the daily writ, or hunt Lust again";
    }
    setQuestLine(line);
    const near = this.nearestFoe(16);
    if (near) {
      const hp = Number(near.e.hp) || 0;
      const max = Number(near.e.maxHp) || hp || 1;
      setTargetPlate(near.e.name || "Foe", hp / max);
    } else {
      setTargetPlate(null, 0);
    }
    document.getElementById("btn-attack")?.classList.toggle("foe-near", Boolean(this.nearestFoe(CHASE_RANGE)));
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
      el.textContent = "Tip the measure — dash the Crush";
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
    this.dashReadyAt = now + 4000;
    noteUtilityCd("btn-dash", 4);
    const len = Math.hypot(this.aimX, this.aimY) || 1;
    const nx = this.aimX / len;
    const ny = this.aimY / len;
    const step = 5.5;
    const nxPos = this.renderYou.x + nx * step;
    const nyPos = this.renderYou.y + ny * step;
    this.renderYou.x = nxPos;
    this.renderYou.y = nyPos;
    this.serverYou.x = nxPos;
    this.serverYou.y = nyPos;
    this.socket.dash(nx, ny);
    if (this.dust.length < 8) {
      const puff = makeDustPuff();
      setPlanar(puff.position, nxPos, nyPos, this.standY(nxPos, nyPos, 0.05));
      this.scene.add(puff);
      this.dust.push({ mesh: puff, start: this.animT });
    }
  }

  attackNearest(opts?: { silent?: boolean }) {
    if (!this.room) return;
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

  sendAttack(targetId: string) {
    const now = Date.now();
    if (now < this.attackBusyUntil) return;
    this.noteCombat();
    this.attackBusyUntil = now + ATTACK_ANIM_MS;
    noteAttackCd(ATTACK_ANIM_MS / 1000);
    this.slashUntil = this.animT + ATTACK_ANIM_MS;
    this.camPunch = Math.max(this.camPunch, 0.22);
    this.camFovKick = Math.max(this.camFovKick, 1.35);
    window.setTimeout(() => {
      const live = this.room?.entities.find((e: any) => String(e.id) === String(targetId));
      if (!live || (live.hp != null && live.hp <= 0)) return;
      const pos = this.entityRenderPos(live);
      if (Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y) > ATTACK_RANGE + 0.45) return;
      this.socket.attack(targetId);
    }, ATTACK_WINDUP_MS);
  }

  startAttackHold() {
    this.attackNearest({ silent: true });
    this.stopAttackHold();
    this.attackHoldTimer = window.setInterval(() => this.attackNearest({ silent: true }), ATTACK_HOLD_MS);
  }

  stopAttackHold() {
    if (this.attackHoldTimer != null) {
      window.clearInterval(this.attackHoldTimer);
      this.attackHoldTimer = null;
    }
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

  beginInteractHold(ev?: PointerEvent) {
    const portal = this.nearestIsPortalTravel();
    if (portal) {
      this.beginPortalHold(portal, { fromKey: false, pointer: ev });
      return;
    }
    setPortalHoldUi(null);
    this.interactNearest();
  }

  endInteractHold(_ev: PointerEvent, completed: boolean) {
    const ph = this.portalHold;
    if (!ph || ph.fromKey) {
      if (!ph) setPortalHoldUi(null);
      return;
    }
    if (!completed || !ph.completed) this.cancelPortalHold();
    else setPortalHoldUi(null);
  }

  portalDestName(target: any): string {
    if (target?.toCanto === "inferno_05") return "Lust";
    if (target?.toCanto === "inferno_06") return "Gluttony";
    if (target?.toCanto === "inferno_07") return "Avarice";
    if (target?.toCanto === "inferno_01") return "Dark Wood";
    return String(target?.label || target?.name || "portal");
  }

  beginPortalHold(target: any, o: { fromKey: boolean; pointer?: PointerEvent; pointerId?: number }) {
    if (!target) return;
    if (this.portalIsLocked(target)) {
      this.denyLockedPortal(target);
      setPortalHoldUi(null);
      return;
    }
    if (this.portalHold) this.cancelPortalHold();
    this.moveTarget = null;
    this.velX = 0;
    this.velY = 0;
    const you = this.youPos();
    this.portalHold = {
      target,
      fromKey: o.fromKey,
      pointerId: o.pointer?.pointerId ?? o.pointerId ?? null,
      startMs: performance.now(),
      completed: false,
      onUp: null,
    };
    setPortalHoldUi(0, this.portalDestName(target));
    if (this.portalHoldFx) {
      this.portalHoldFx.group.visible = true;
      setPlanar(this.portalHoldFx.group.position, you.x, you.y, this.standY(you.x, you.y, 0.05));
      tickPortalHoldFx(this.portalHoldFx, 0);
    }
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
    if (this.portalLight.intensity > 4.5) this.portalLight.intensity = 4.5;
  }

  tickPortalHold() {
    const ph = this.portalHold;
    if (!ph || ph.completed) return;
    if (ph.fromKey && !this.keys.has("KeyE")) {
      this.cancelPortalHold();
      return;
    }
    const you = this.youPos();
    const pos = this.entityRenderPos(ph.target);
    if (Math.hypot(pos.x - you.x, pos.y - you.y) > EXIT_TRAVEL_RANGE) {
      this.cancelPortalHold();
      return;
    }
    const stick = this.joystick.getVector();
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
    setPortalHoldUi(u, dest);
    if (this.portalHoldFx) {
      setPlanar(this.portalHoldFx.group.position, you.x, you.y, this.standY(you.x, you.y, 0.05));
      tickPortalHoldFx(this.portalHoldFx, u);
    }
    this.portalLight.intensity = 4.5 + u * 7.5;
    if (u < 1) return;
    ph.completed = true;
    hapticPortalComplete();
    showToast(`Entering ${dest}…`, "emit");
    const target = ph.target;
    this.cancelPortalHold();
    this.doInteract(target);
  }

  scanNearestInteract() {
    if (!this.room) {
      this.nearestInteract = null;
      return;
    }
    const you = this.youPos();
    let best: any = null;
    let bestD = INTERACT_HIGHLIGHT_RANGE;
    for (const e of this.room.entities) {
      if (e.kind !== "poi" && e.kind !== "exit" && e.kind !== "loot") continue;
      const pos = e.kind === "loot" ? this.lootRenderPos(e) : this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    const interactBtn = document.getElementById("btn-interact");
    const labelEl = interactBtn?.querySelector<HTMLElement>(".action-label");
    const bestId = best ? String(best.id) : "";
    for (const rec of this.nodes.values()) {
      rec.hpEl.classList.toggle("is-nearest", rec.id === bestId);
      const prompt = rec.hpEl.querySelector(".interact-prompt") as HTMLElement | null;
      if (!prompt) continue;
      const on = rec.id === bestId;
      prompt.hidden = !on;
      if (on) {
        const isPortal = best.kind === "exit" || best.poiKind === "portal";
        if (isPortal && this.portalIsLocked(best)) {
          prompt.textContent =
            best.requireClear === "inferno_05"
              ? "Clear the Judge first"
              : best.requireClear === "inferno_06"
                ? "Clear Triple Maw first"
                : "Sealed";
        } else if (isPortal) {
          const dest = this.portalDestName(best);
          prompt.textContent = `Hold E — ${dest}`;
        } else {
          prompt.textContent = rec.kind === "loot" ? "Take" : "E";
        }
      }
    }
    if (!best) {
      this.nearestInteract = null;
      this.lastInteractHintId = null;
      interactBtn?.classList.remove("interact-ready");
      interactBtn?.classList.add("interact-idle");
      if (labelEl && !this.portalHold) labelEl.textContent = "Interact";
      return;
    }
    this.nearestInteract = { id: String(best.id), kind: best.kind, label: best.label || best.name };
    interactBtn?.classList.add("interact-ready");
    interactBtn?.classList.remove("interact-idle");
    if (!this.portalHold && labelEl) {
      const isPortal = best.kind === "exit" || best.poiKind === "portal";
      if (isPortal && this.portalIsLocked(best)) labelEl.textContent = "Sealed";
      else if (isPortal) labelEl.textContent = "Hold";
      else labelEl.textContent = "Interact";
    }
    if (this.lastInteractHintId !== String(best.id)) {
      this.lastInteractHintId = String(best.id);
      if (best.kind === "poi") {
        const id = String(best.id);
        if (!this.poiHintsShown.has(id)) {
          const hint = String(best.hint || "").trim();
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
                  ? "Ledger Stone — measure before the Crush"
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
        showToast("Storm Heart broken — the Judge waits at the gate", "emit");
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
        showToast("Hoard Heart broken — Counterweight stirs; Crush waits beyond", "emit");
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
          showToast("Cerbero ahead — three maws taste the road", "warn");
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
          showToast("contrapeso — Counterweight mid-measure; tip it before the Crush", "warn");
          this.camPunch = Math.max(this.camPunch, 0.55);
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.ledgerMidApproachShown) {
      const stone = this.room.entities.find((e: any) => e.id === "ledger_stone" || e.poiKind === "marker");
      if (stone) {
        const pos = this.entityRenderPos(stone);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 11) {
          this.ledgerMidApproachShown = true;
          showToast("The ledger stone marks mid-measure — Bell, then Crush", "info");
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.northMeasureApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^north measure$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 12) {
          this.northMeasureApproachShown = true;
          showToast("North Measure — unpaid tallies on the empty flats", "info");
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.crushApproachShown) {
      const boss = this.room.entities.find(
        (e: any) => e.kind === "boss" || /^hoard crush$/i.test(String(e.name || ""))
      );
      if (boss && (boss.hp == null || boss.hp > 0)) {
        const pos = this.entityRenderPos(boss);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 16) {
          this.crushApproachShown = true;
          showToast("Hoard Crush — weight without rest; tip the measure", "warn");
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.southSpillApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^south spill$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 12) {
          this.southSpillApproachShown = true;
          showToast("South Spill — undervalued coin, still sharp", "info");
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.weightChampApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^weight champions$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 13) {
          this.weightChampApproachShown = true;
          showToast("peso — Weight Champions; heavy measures before the Crush", "warn");
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.nwDriftApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^northwest drift$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 12) {
          this.nwDriftApproachShown = true;
          showToast("peso — Northwest Drift; scorched flats still hold weight", "info");
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.swSpillApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^southwest spill$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 12) {
          this.swSpillApproachShown = true;
          showToast("contrapeso — Southwest Spill; undervalued coin on empty flats", "info");
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.seDriftApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^southeast drift$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 12) {
          this.seDriftApproachShown = true;
          showToast("peso — Southeast Drift; unpaid weights off the Crush lane", "info");
          break;
        }
      }
    }

    // Gluttony-portal side: first weights on the scorched ledger road
    if (this.room?.cantoId === "inferno_07" && !this.roadWeightsApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^road weights$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 12) {
          this.roadWeightsApproachShown = true;
          showToast("Road Weights — first measure past the Gluttony gate", "info");
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.goldChorusApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^gold chorus$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 12) {
          this.goldChorusApproachShown = true;
          showToast("Gold Chorus — undervalued choir off the crush lane", "info");
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.crushFlankApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^crush approach$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 12) {
          this.crushFlankApproachShown = true;
          showToast("Crush Approach — north flank before the dais", "warn");
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.strayCoinApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^stray coin$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 11) {
          this.strayCoinApproachShown = true;
          showToast("Stray Coin — loose change under the Bell", "info");
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.northLedgerApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^north ledger$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 12) {
          this.northLedgerApproachShown = true;
          showToast("North Ledger — unpaid tallies; the Bell stills them", "info");
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.southBalanceApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^south balance$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 12) {
          this.southBalanceApproachShown = true;
          showToast("South Balance — scale tipped wrong; pay or press through", "info");
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.coinWispsApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (!/^coin wisps$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 11) {
          this.coinWispsApproachShown = true;
          showToast("Coin Wisps — scattered greed, easy to undervalue", "info");
          break;
        }
      }
    }

    if (this.room?.cantoId === "inferno_07" && !this.ledgerWardenApproachShown) {
      for (const e of this.room.entities) {
        if (e.kind !== "mob") continue;
        if (e.archetype !== "ledger_warden" && !/^ledger warden$/i.test(String(e.name || ""))) continue;
        const pos = this.entityRenderPos(e);
        if (Math.hypot(pos.x - you.x, pos.y - you.y) < 14) {
          this.ledgerWardenApproachShown = true;
          showToast("Ledger Warden — tablet shield before the Crush", "warn");
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
    const you = this.serverYou;
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

  hintExit() {
    if (!this.room) return;
    const isHub = this.room.role === "hub" || this.room.cantoId === "inferno_01";
    if (!isHub) return;
    let nearD = EXIT_HINT_RANGE;
    let near = false;
    for (const e of this.room.entities) {
      if (e.kind !== "exit" && !(e.kind === "poi" && e.poiKind === "portal")) continue;
      const pos = this.entityRenderPos(e);
      const d = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
      if (d < nearD) {
        nearD = d;
        near = true;
      }
    }
    if (near) {
      const now = Date.now();
      if (now - this.nearExitToastAt > 8000) {
        this.nearExitToastAt = now;
        showToast("Portal near — hold Interact to travel", "info");
      }
    }
  }

  triggerDeathRevive() {
    const now = Date.now();
    if (now < this.deathFxUntil) return;
    this.deathFxUntil = now + DEATH_FX_LOCK_MS;
    playDeathRevive();
    this.camShake = 0.6;
    window.setTimeout(() => {
      this.renderYou = { x: this.serverYou.x, y: this.serverYou.y };
      this.velX = 0;
      this.velY = 0;
      this.moveTarget = null;
    }, 200);
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
