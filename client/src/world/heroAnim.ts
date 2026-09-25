/**
 * Procedural humanoid motion for the wanderer rig (local hero, remote pilgrims,
 * the Guide). Joints are the named bones built in hero.ts.
 *
 * Every frame builds one pose as a flat channel array:
 *   locomotion (gait phase integrated per root, cadence from ground speed, lean
 *   from acceleration, bank from lateral acceleration, turn lead, idle weight
 *   shift) → attack / cast / dash / death layers blended over it → flinch added
 *   on top → applied to the bones → hips height from the legs so the lower foot
 *   stays on the ground → ankles flattened → cloth springs (cape chain, robe).
 * No allocation per frame; all state lives in root.userData.hum.
 *
 * Joint conventions (three.js, model forward = −z): +rotation.x swings a
 * hanging limb FORWARD and tilts an upright part BACK. Knees flex with −x,
 * elbows with +x. legL leads when sin(phase) > 0.
 */
import * as THREE from "three";

// ——— channels ——————————————————————————————————————————————————————————
const H_YAW = 0;
const H_PITCH = 1;
const H_ROLL = 2;
const H_X = 3;
const H_Z = 4;
const H_DROP = 5;
const T_X = 6;
const T_Y = 7;
const T_Z = 8;
const AR_X = 9;
const AR_Y = 10;
const AR_Z = 11;
const ER = 12;
const W_X = 13;
const W_Y = 14;
const W_Z = 15;
const AL_X = 16;
const AL_Y = 17;
const AL_Z = 18;
const EL = 19;
const LL_X = 20;
const KL = 21;
const LR_X = 22;
const KR = 23;
const LL_Z = 24;
const LR_Z = 25;
const HD_X = 26;
const HD_Y = 27;
const AK_L = 28;
const AK_R = 29;
const NCH = 30;

/** Channels the legs own (they keep walking when the hero moves while swinging). */
const LEG_CH = [H_X, H_Z, LL_X, KL, LR_X, KR, LL_Z, LR_Z, AK_L, AK_R] as const;

type Key = { v: Float32Array; m: Uint8Array };
type KeySpec = Partial<Record<
  | "hYaw" | "hPitch" | "hRoll" | "hX" | "hZ" | "hDrop"
  | "tX" | "tY" | "tZ"
  | "arX" | "arY" | "arZ" | "er" | "wX" | "wY" | "wZ"
  | "alX" | "alY" | "alZ" | "el"
  | "llX" | "kl" | "lrX" | "kr" | "llZ" | "lrZ"
  | "hdX" | "hdY" | "akL" | "akR",
  number
>>;
const NAMES: Record<string, number> = {
  hYaw: H_YAW, hPitch: H_PITCH, hRoll: H_ROLL, hX: H_X, hZ: H_Z, hDrop: H_DROP,
  tX: T_X, tY: T_Y, tZ: T_Z,
  arX: AR_X, arY: AR_Y, arZ: AR_Z, er: ER, wX: W_X, wY: W_Y, wZ: W_Z,
  alX: AL_X, alY: AL_Y, alZ: AL_Z, el: EL,
  llX: LL_X, kl: KL, lrX: LR_X, kr: KR, llZ: LL_Z, lrZ: LR_Z,
  hdX: HD_X, hdY: HD_Y, akL: AK_L, akR: AK_R,
};
/** Right arm + blade channels from the offline IK solve (fist target, blade direction). */
type Arm = [number, number, number, number, number, number, number];
function key(spec: KeySpec, arm?: Arm): Key {
  const v = new Float32Array(NCH);
  const m = new Uint8Array(NCH);
  for (const [k, val] of Object.entries(spec)) {
    const i = NAMES[k]!;
    v[i] = val as number;
    m[i] = 1;
  }
  if (arm) {
    const ch = [AR_X, AR_Y, AR_Z, ER, W_X, W_Y, W_Z];
    for (let i = 0; i < 7; i++) {
      v[ch[i]!] = arm[i]!;
      m[ch[i]!] = 1;
    }
  }
  return { v, m };
}

// Rest carry: fist by the thigh, blade low and back (tip at knee height behind),
// rolled out so it never crosses the legs. Solved for fist (0.29, 0.87, 0.03),
// blade (0.18, −0.55, 0.82).
const REST_ARM: Arm = [-0.23, -0.15, 0.1, 0.39, -1.04, -0.09, 0.2];

// Three-swing chain. Targets (root space, facing −z): forehand cocks the fist
// above/behind the right shoulder, sweeps round the right side and cuts across
// the body to the low left; backhand rises flat from the left hip to the right;
// the overhead finisher chops from behind the head to the ground ahead.
const SWINGS: Key[][] = [
  [
    key({ hYaw: -0.25, tY: -0.42, tX: 0.08, tZ: 0.06, llX: 0.18, kl: -0.24, lrX: -0.12, kr: -0.3, alX: 1.05, alY: 0.35, alZ: -0.2, el: 0.35, hdY: 0.35, hdX: 0.05 }, [1.09, 0.02, 1.9, 1.94, -1.55, -0.52, 0.4]),
    key({ hYaw: 0.0, tY: 0.02, tX: -0.08, llX: 0.2, kl: -0.3, lrX: 0.15, kr: -0.5, alX: 0.55, alY: 0.2, alZ: -0.35, el: 0.6, hdY: 0.05, hdX: 0.08 }, [0.33, -0.47, 1.29, 2.25, -1.03, -0.28, 0.18]),
    key({ hYaw: 0.28, tY: 0.32, tX: -0.26, tZ: -0.04, llX: -0.3, kl: -0.28, lrX: 0.5, kr: -0.55, alX: -0.35, alY: 0, alZ: -0.55, el: 0.9, hdY: -0.5, hdX: 0.14 }, [0.31, 0.34, 0.68, 1.23, -0.03, -0.1, 0.02]),
    key({ hYaw: 0.35, tY: 0.48, tX: -0.3, tZ: -0.06, llX: -0.34, kl: -0.3, lrX: 0.52, kr: -0.58, alX: -0.45, alY: 0, alZ: -0.65, el: 0.8, hdY: -0.6, hdX: 0.12 }, [0.82, 0.34, -0.29, 0.26, -0.36, 0.13, -0.55]),
  ],
  [
    key({ hYaw: 0.3, tY: 0.42, tX: -0.1, llX: 0.3, kl: -0.42, lrX: -0.25, kr: -0.2, alX: 0.25, alY: -0.3, alZ: -0.25, el: 1.5, hdY: -0.4, hdX: 0.08 }, [0.86, 0.76, -1, 1.23, -0.29, 0.13, -0.62]),
    key({ hYaw: 0.12, tY: 0.14, tX: -0.14, llX: 0.42, kl: -0.5, lrX: -0.3, kr: -0.25, alX: 0.0, alY: 0, alZ: -0.45, el: 1.0, hdY: -0.1, hdX: 0.1 }, [0.88, 0.26, -0.44, 1.05, -0.15, 0.05, -0.07]),
    key({ hYaw: -0.15, tY: -0.2, tX: -0.2, llX: 0.48, kl: -0.55, lrX: -0.34, kr: -0.28, alX: -0.55, alY: 0, alZ: -0.75, el: 0.45, hdY: 0.35, hdX: 0.12 }, [1.37, -0.03, -0.37, 0.19, 0.21, 0.12, 0.45]),
    key({ hYaw: -0.3, tY: -0.45, tX: -0.12, llX: 0.46, kl: -0.5, lrX: -0.36, kr: -0.3, alX: -0.6, alY: 0, alZ: -0.8, el: 0.4, hdY: 0.55, hdX: 0.1 }, [0.37, -0.54, -0.61, 1.74, 0.41, 0.22, 0.65]),
  ],
  [
    key({ hYaw: -0.12, tY: -0.1, tX: 0.2, llX: 0.12, kl: -0.34, lrX: -0.22, kr: -0.36, alX: 1.7, alY: 0.3, alZ: -0.15, el: 0.7, hdX: -0.18, hdY: 0.1 }, [1.26, 1.21, 1.57, 1, -0.73, -0.24, 1.27]),
    key({ hYaw: -0.04, tY: -0.04, tX: 0.02, llX: 0.0, kl: -0.4, lrX: 0.3, kr: -0.6, alX: 1.2, alY: 0.2, alZ: -0.25, el: 0.6, hdX: -0.05 }, [1.05, 1.49, 1.35, 0.5, -0.37, -0.11, 0.18]),
    key({ hYaw: 0.05, tY: 0.05, tX: -0.42, llX: -0.42, kl: -0.38, lrX: 0.62, kr: -0.8, alX: -0.25, alY: 0, alZ: -0.5, el: 0.6, hdX: 0.28 }, [0.51, 1.34, 0.83, 0.57, -0.41, -0.13, 0.34]),
    key({ hYaw: 0.06, tY: 0.06, tX: -0.5, llX: -0.44, kl: -0.4, lrX: 0.64, kr: -0.84, alX: -0.3, alY: 0, alZ: -0.55, el: 0.6, hdX: 0.3 }, [0.31, 1.6, 0.76, 0.19, -0.35, -0.06, 0.06]),
  ],
];
/** Swing timeline (fraction of SWING cycle): anticipation → strike → contact → follow → recover. */
export const SWING_U_COCK = 0.26;
const SWING_U_MID = 0.31;
export const SWING_U_HIT = 0.345;
const SWING_U_FOL = 0.5;
const SWING_U_REC = 0.56;

// Salute: blade upright before the face (fist (0.1, 1.35, −0.26), blade up)
const SALUTE_ARM: Arm = [0.14, 0.44, -0.05, 2.19, 0.78, 0, 0.03];

const CAST: Record<"gale" | "ward" | "burst", [Key, Key]> = {
  // Gale bolt: draw the left palm back, then thrust it at the aim, sword arm swept back
  gale: [
    key({ hYaw: -0.1, tY: 0.3, tX: 0.04, alX: -0.35, alY: 0.1, alZ: -0.3, el: 1.6, llX: 0.1, kl: -0.2, lrX: -0.1, kr: -0.25, hdY: -0.2 }),
    key({ hYaw: 0.2, tY: -0.45, tX: -0.14, alX: 1.5, alY: 0.2, alZ: -0.05, el: 0.06, llX: 0.45, kl: -0.45, lrX: -0.3, kr: -0.2, hdY: 0.3, hdX: 0.05 }, [-0.51, -0.21, 0.35, 0.43, -0.63, -0.11, 0.35]),
  ],
  // Whirl ward: both arms rise, blade upright, chin lifted
  ward: [
    key({ tX: -0.06, alX: 0.8, alZ: -0.4, el: 1.2, llX: 0.04, kl: -0.28, lrX: -0.04, kr: -0.28, hdX: 0.1 }, SALUTE_ARM),
    key({ tX: 0.1, alX: 2.55, alY: -0.2, alZ: -0.45, el: 0.35, llX: 0.08, kl: -0.2, lrX: -0.08, kr: -0.2, hdX: -0.25 }, [1.72, -1.17, -1, 0.67, -0.29, -0.05, -0.22]),
  ],
  // Infernal burst: sword raised overhead in both hands, then planted in the ground
  burst: [
    key({ hYaw: -0.05, tX: 0.16, alX: 2.3, alY: -0.35, alZ: 0.1, el: 0.9, llX: 0.05, kl: -0.3, lrX: -0.1, kr: -0.3, hdX: -0.15 }, [1.12, 1.49, 1.42, 0.5, -0.4, -0.03, 0.64]),
    key({ tY: 0.02, tX: -0.55, alX: 0.95, alY: -0.45, alZ: 0.15, el: 0.8, llX: -0.2, kl: -1.0, lrX: 0.75, kr: -1.25, hdX: 0.2 }, [0.25, 1.22, 0.8, 0.87, -0.66, 0.16, -0.39]),
  ],
};

const DASH_KEY = key(
  { tX: -0.55, llX: 0.6, kl: -0.35, lrX: -0.8, kr: -0.7, alX: -0.9, alZ: -0.35, el: 0.5, hdX: -0.4 },
  [-0.44, -0.18, 0.18, 0.05, -0.47, -0.04, 0.11]
);
const DEATH_KNEEL = key({
  tX: -0.35, tY: 0.1, llX: 1.15, kl: -1.55, lrX: -0.05, kr: -1.95, akR: 0.9,
  arX: 0.25, arY: 0, arZ: 0.35, er: 0.5, wX: -0.6, wY: 0, wZ: 0.3,
  alX: 0.35, alY: 0, alZ: -0.3, el: 0.5, hdX: 0.45, hdY: 0.1,
});
const DEATH_FALL = key({
  hPitch: -0.28, hDrop: -0.06, tX: -0.95, tY: 0.15, tZ: 0.12, llX: 1.25, kl: -1.7, lrX: 0.05, kr: -2.0, akR: 0.9,
  arX: 1.35, arY: 0, arZ: 0.45, er: 0.25, wX: 0.2, wY: 0, wZ: 0.6,
  alX: 1.25, alY: 0, alZ: -0.35, el: 0.35, hdX: 0.15, hdY: 0.3,
});
const CHANNEL_KEY = key({
  tX: -0.08, llX: 0.08, lrX: -0.08, kl: -0.14, kr: -0.1,
  alX: 0.9, alZ: -0.16, el: 0.45, arX: 0.55, arY: 0, arZ: 0.16, er: 0.35, wX: -0.2, wY: 0, wZ: 0.18, hdX: -0.12, hdY: 0,
});

// ——— state ——————————————————————————————————————————————————————————————

type Joints = {
  hips?: THREE.Object3D;
  torso?: THREE.Object3D;
  head?: THREE.Object3D;
  hood?: THREE.Object3D;
  cloak?: THREE.Object3D;
  cloakMid?: THREE.Object3D;
  cloakHem?: THREE.Object3D;
  apron?: THREE.Object3D;
  apronHem?: THREE.Object3D;
  tabard?: THREE.Object3D;
  tabardHem?: THREE.Object3D;
  legL?: THREE.Object3D;
  legR?: THREE.Object3D;
  kneeL?: THREE.Object3D;
  kneeR?: THREE.Object3D;
  ankleL?: THREE.Object3D;
  ankleR?: THREE.Object3D;
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  elbowL?: THREE.Object3D;
  elbowR?: THREE.Object3D;
  weapon?: THREE.Object3D;
};

type Spring = { x: number; v: number };

type HumState = {
  j: Joints;
  init: boolean;
  lastT: number;
  mw: number;
  phase: number;
  lastX: number;
  lastZ: number;
  vx: number;
  vz: number;
  ax: number;
  az: number;
  lastYaw: number;
  yawRate: number;
  shift: number;
  chanW: number;
  /** last frame's final pose (swing / cast entry snapshots copy from it) */
  prev: Float32Array;
  loco: Float32Array;
  out: Float32Array;
  entry: Float32Array;
  castEntry: Float32Array;
  deathEntry: Float32Array;
  tmp: Float32Array;
  chain: (THREE.Object3D | undefined)[];
  // actions (−1 = none)
  swingT0: number;
  swingDur: number;
  swingKind: number;
  swingU0: number;
  swingEntryTaken: boolean;
  castT0: number;
  castWind: number;
  castKind: "gale" | "ward" | "burst";
  castEntryTaken: boolean;
  dashT0: number;
  dashDur: number;
  flinchT0: number;
  flinchF: number;
  flinchS: number;
  deathT0: number;
  deathEntryTaken: boolean;
  reviveT0: number;
  // cloth
  capeX: Spring;
  capeZ: Spring;
  capeY: Spring;
  capeMid: Spring;
  capeHem: Spring;
  robe: Spring;
  robeZ: Spring;
  /** foot-plant events for the caller: 1 = left, 2 = right (cleared by the caller) */
  plant: number;
  plantCount: number;
};

function jointsOf(root: THREE.Object3D): Joints {
  const g = (n: string) => root.getObjectByName(n) ?? undefined;
  return {
    hips: g("hips"),
    torso: g("torso"),
    head: g("head"),
    hood: g("hood"),
    cloak: g("cloak"),
    cloakMid: g("cloakMid"),
    cloakHem: g("cloakHem"),
    apron: g("apron"),
    apronHem: g("apronHem"),
    tabard: g("tabard"),
    tabardHem: g("tabardHem"),
    legL: g("legL"),
    legR: g("legR"),
    kneeL: g("kneeL"),
    kneeR: g("kneeR"),
    ankleL: g("ankleL"),
    ankleR: g("ankleR"),
    armL: g("armL"),
    armR: g("armR"),
    elbowL: g("elbowL"),
    elbowR: g("elbowR"),
    weapon: g("weapon"),
  };
}

const spring = (): Spring => ({ x: 0, v: 0 });

function stateOf(root: THREE.Object3D): HumState {
  let s = root.userData.hum as HumState | undefined;
  if (!s) {
    s = {
      j: jointsOf(root),
      init: false,
      lastT: 0,
      mw: 0,
      phase: 0,
      lastX: 0,
      lastZ: 0,
      vx: 0,
      vz: 0,
      ax: 0,
      az: 0,
      lastYaw: 0,
      yawRate: 0,
      shift: 1,
      chanW: 0,
      prev: new Float32Array(NCH),
      loco: new Float32Array(NCH),
      out: new Float32Array(NCH),
      entry: new Float32Array(NCH),
      castEntry: new Float32Array(NCH),
      deathEntry: new Float32Array(NCH),
      tmp: new Float32Array(NCH),
      chain: [],
      swingT0: -1,
      swingDur: 440,
      swingKind: 0,
      swingU0: 0,
      swingEntryTaken: false,
      castT0: -1,
      castWind: 200,
      castKind: "gale",
      castEntryTaken: false,
      dashT0: -1,
      dashDur: 160,
      flinchT0: -1,
      flinchF: 0,
      flinchS: 0,
      deathT0: -1,
      deathEntryTaken: false,
      reviveT0: -1,
      capeX: spring(),
      capeZ: spring(),
      capeY: spring(),
      capeMid: spring(),
      capeHem: spring(),
      robe: spring(),
      robeZ: spring(),
      plant: 0,
      plantCount: 0,
    };
    s.chain = [s.j.hips, s.j.torso, s.j.armR, s.j.elbowR, s.j.weapon];
    // (templates are never ticked, so clones never inherit this state)
    root.userData.hum = s;
  }
  return s;
}

// ——— math helpers ——————————————————————————————————————————————————————

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
const easeInOut = (t: number) => t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** out[i] = a[i]·(1−t) + (key masked ? key : b)[i]·t over masked channels only when `onlyMask`. */
function lerpKey(out: Float32Array, from: Float32Array, k: Key, base: Float32Array, t: number) {
  for (let i = 0; i < NCH; i++) {
    const to = k.m[i] ? k.v[i]! : base[i]!;
    out[i] = from[i]! + (to - from[i]!) * t;
  }
}
function lerpKeys(out: Float32Array, a: Key, b: Key, base: Float32Array, t: number) {
  for (let i = 0; i < NCH; i++) {
    const va = a.m[i] ? a.v[i]! : base[i]!;
    const vb = b.m[i] ? b.v[i]! : base[i]!;
    out[i] = va + (vb - va) * t;
  }
}
function mix(out: Float32Array, a: Float32Array, b: Float32Array, t: number) {
  for (let i = 0; i < NCH; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t;
}
function stepSpring(s: Spring, target: number, omega: number, zeta: number, dt: number) {
  const a = omega * omega * (target - s.x) - 2 * zeta * omega * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
}

const THIGH = 0.43;
const SHIN = 0.5;
const ANKLE = 0.075;
/** Vertical reach of a leg from hip pivot to sole for thigh pitch a and knee k (k ≤ 0). */
function legReach(a: number, k: number) {
  return THIGH * Math.cos(a) + (SHIN - ANKLE) * Math.cos(a + k) + ANKLE;
}

// ——— public action API ——————————————————————————————————————————————————

/** Start a sword swing (kind 0 forehand, 1 backhand, 2 overhead). `startU` skips anticipation. */
export function humanoidSwing(root: THREE.Object3D, tMs: number, kind: number, durMs: number, startU = 0) {
  const s = stateOf(root);
  s.swingT0 = tMs - startU * durMs;
  s.swingDur = durMs;
  s.swingKind = ((kind % 3) + 3) % 3;
  s.swingU0 = startU;
  s.swingEntryTaken = false;
}

/** Current swing progress u ∈ [0, 1], or −1 when not swinging. */
export function humanoidSwingU(root: THREE.Object3D, tMs: number): number {
  const s = root.userData.hum as HumState | undefined;
  if (!s || s.swingT0 < 0) return -1;
  const u = (tMs - s.swingT0) / s.swingDur;
  return u >= 0 && u < 1 ? u : -1;
}

export function humanoidCast(root: THREE.Object3D, kind: "gale" | "ward" | "burst", tMs: number, windMs: number) {
  const s = stateOf(root);
  s.castT0 = tMs;
  s.castWind = Math.max(60, windMs);
  s.castKind = kind;
  s.castEntryTaken = false;
}

export function humanoidDash(root: THREE.Object3D, tMs: number, durMs: number) {
  const s = stateOf(root);
  s.dashT0 = tMs;
  s.dashDur = durMs;
  s.swingT0 = -1;
  // The mantle flares hard: kick the cape springs backward/up
  s.capeX.v -= 9;
  s.capeMid.v -= 6;
  s.capeHem.v -= 5;
}

/** Hit reaction; (fromX, fromZ) is the world direction toward the attacker. */
export function humanoidFlinch(root: THREE.Object3D, fromX: number, fromZ: number, tMs: number) {
  const s = stateOf(root);
  const yaw = root.rotation.y;
  // local forward (−z) and right (+x) in world planar terms
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const len = Math.hypot(fromX, fromZ) || 1;
  s.flinchF = (fromX * fx + fromZ * fz) / len; // +1: hit from the front
  s.flinchS = (fromX * rx + fromZ * rz) / len; // +1: hit from the right
  s.flinchT0 = tMs;
  s.capeX.v += 2.5 * s.flinchF;
}

export function humanoidDeath(root: THREE.Object3D, tMs: number) {
  const s = stateOf(root);
  s.deathT0 = tMs;
  s.deathEntryTaken = false;
  s.reviveT0 = -1;
  s.swingT0 = -1;
  s.castT0 = -1;
  s.dashT0 = -1;
}

export function humanoidRevive(root: THREE.Object3D, tMs: number) {
  const s = stateOf(root);
  s.deathT0 = -1;
  s.reviveT0 = tMs;
}

/** Foot-plant event since the last call: 0 none, 1 left, 2 right. */
export function takeFootPlant(root: THREE.Object3D): number {
  const s = root.userData.hum as HumState | undefined;
  if (!s) return 0;
  const p = s.plant;
  s.plant = 0;
  return p;
}

// ——— the tick ———————————————————————————————————————————————————————————

export type HumanoidOpts = {
  moving: boolean;
  tMs: number;
  attacking: boolean;
  speed: number;
  channeling?: boolean;
  /** legacy: explicit swing progress (starts a forehand when no swing is running) */
  attackU?: number;
  /** world planar velocity (x, z); derived from root motion when omitted (remotes) */
  vx?: number;
  vz?: number;
};

export function tickHumanoid(root: THREE.Object3D, opts: HumanoidOpts) {
  const s = stateOf(root);
  const J = s.j;
  const tMs = opts.tMs;
  const t = tMs * 0.001;
  const dt = s.init ? clamp((tMs - s.lastT) * 0.001, 0, 0.05) : 0;
  const scale = root.scale.x || 1;

  // —— velocity / acceleration / yaw rate ——
  let vx: number;
  let vz: number;
  if (opts.vx != null && opts.vz != null) {
    vx = opts.vx;
    vz = opts.vz;
  } else if (s.init && dt > 0) {
    const dx = root.position.x - s.lastX;
    const dz = root.position.z - s.lastZ;
    // (a big jump is a snap/teleport, not a stride)
    const jump = dx * dx + dz * dz > 9;
    const k = 1 - Math.exp(-dt * 10);
    vx = jump ? 0 : s.vx + (dx / dt - s.vx) * k;
    vz = jump ? 0 : s.vz + (dz / dt - s.vz) * k;
  } else {
    vx = 0;
    vz = 0;
  }
  if (!opts.moving && opts.vx == null && Math.hypot(vx, vz) < 0.5) {
    vx *= 0.5;
    vz *= 0.5;
  }
  if (s.init && dt > 0) {
    const k = 1 - Math.exp(-dt * 12);
    s.ax += ((vx - s.vx) / dt - s.ax) * k;
    s.az += ((vz - s.vz) / dt - s.az) * k;
    const yr = wrapPi(root.rotation.y - s.lastYaw) / dt;
    s.yawRate += (clamp(yr, -20, 20) - s.yawRate) * (1 - Math.exp(-dt * 14));
  }
  s.vx = vx;
  s.vz = vz;
  s.lastX = root.position.x;
  s.lastZ = root.position.z;
  s.lastYaw = root.rotation.y;
  s.lastT = tMs;
  s.init = true;

  const yaw = root.rotation.y;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const vF = vx * fx + vz * fz; // world units / s along facing
  const vL = vx * rx + vz * rz; // toward the right
  const aF = s.ax * fx + s.az * fz;
  const aL = s.ax * rx + s.az * rz;
  const speedW = Math.hypot(vx, vz);
  const sp = speedW / scale; // rig units / s

  // —— move weight + gait phase (integrated: no flicker when speed changes) ——
  const moving = opts.moving || speedW > 0.45;
  const mwRate = moving ? 12 : 8;
  s.mw += ((moving ? 1 : 0) - s.mw) * (1 - Math.exp(-mwRate * Math.max(dt, 0.001)));
  const mw = s.mw;
  const run = clamp((sp - 2.2) / 3.2, 0, 1);
  // Thigh amplitude grows with speed; cadence is ground speed over stride so the
  // stance foot moves backward at the body's speed (no skating).
  const A = clamp(0.3 + 0.055 * sp, 0.3, 0.62);
  const omega = sp > 0.05 ? clamp(sp / (0.9 * A), 0, 12.5) : 0;
  const dir = vF < -0.35 * speedW ? -1 : 1;
  const prevPhase = s.phase;
  s.phase += omega * dir * dt;
  if (s.phase > 1000) s.phase -= Math.PI * 200;
  if (s.phase < -1000) s.phase += Math.PI * 200;
  // Foot plant (heel strike) at thigh-forward extreme: φ = π/2 (left), 3π/2 (right)
  if (mw > 0.6 && sp > 1.6 && dir > 0) {
    const a = Math.floor((prevPhase - Math.PI / 2) / Math.PI);
    const b = Math.floor((s.phase - Math.PI / 2) / Math.PI);
    if (b !== a) {
      s.plantCount++;
      s.plant = (b & 1) === 0 ? 1 : 2;
    }
  }
  const ph = s.phase;
  const sL = Math.sin(ph);
  const cL = Math.cos(ph);
  const idle = 1 - mw;
  const breath = Math.sin(t * 1.85);

  // —— locomotion pose ——
  const P = s.loco;
  const amp = A * mw;
  const aLeg = amp * sL;
  // Knee: tucked through mid-swing, soft in stance (a little compression when running)
  const swingFlex = (c: number) => Math.pow(Math.max(0, c), 1.25);
  const stanceK = (c: number) => Math.max(0, -c);
  const fL = mw * (0.1 + (0.72 + 0.5 * run) * swingFlex(cL) + 0.22 * run * stanceK(cL) * Math.max(0, Math.sin(ph + Math.PI / 2 + 0.3)));
  const fR = mw * (0.1 + (0.72 + 0.5 * run) * swingFlex(-cL) + 0.22 * run * stanceK(-cL) * Math.max(0, Math.sin(ph - Math.PI / 2 + 0.3)));
  // Idle contrapposto: weight rests on one leg, the other knee eases; swaps every few seconds
  const want = Math.sin(t * 0.21 + (root.id % 7)) > 0 ? 1 : -1;
  s.shift += (want - s.shift) * (1 - Math.exp(-dt * 1.3));
  // (the Guide leans on a planted staff: no weight shift, or the fist drifts off it)
  const grip = root.userData.staffGrip as { arm: number; elbow: number } | undefined;
  const ws = grip ? 0 : s.shift * idle; // +1 → weight on the right leg
  P[LL_X] = aLeg + 0.06 * Math.max(0, ws);
  P[LR_X] = -aLeg + 0.06 * Math.max(0, -ws);
  P[KL] = -(fL + 0.2 * Math.max(0, ws) + 0.05 * idle);
  P[KR] = -(fR + 0.2 * Math.max(0, -ws) + 0.05 * idle);
  P[LL_Z] = -0.02 * idle;
  P[LR_Z] = 0.02 * idle;
  P[AK_L] = 0;
  P[AK_R] = 0;
  // Pelvis: sways over the stance foot, rolls down on the swing side, yaws with the stride
  const walkSway = 1 - 0.6 * run;
  P[H_X] = 0.024 * cL * mw * walkSway + 0.03 * ws;
  P[H_Z] = 0;
  P[H_DROP] = 0;
  P[H_ROLL] = 0.04 * cL * mw * walkSway + 0.045 * ws;
  P[H_YAW] = -0.1 * sL * mw;
  // Bank into turns (centripetal) with the whole body, lean with acceleration
  const bank = clamp(-aL * 0.0065, -0.2, 0.2) * mw;
  const lean = clamp(-aF * 0.009, -0.26, 0.2);
  P[H_PITCH] = lean * 0.3;
  P[T_X] = -(0.04 + 0.14 * run) * mw + lean * 0.7 + breath * 0.018 * (1 - mw * 0.7);
  const lead = clamp(s.yawRate * 0.045, -0.32, 0.32);
  P[T_Y] = (0.2 + 0.08 * run) * sL * mw + lead;
  P[T_Z] = -P[H_ROLL] * 1.3 + bank;
  P[H_ROLL] += bank * 0.6;
  // Arms counter-swing the opposite leg; the sword arm swings less and keeps its carry
  const armAmp = (0.3 + 0.2 * run) * mw;
  P[AL_X] = -sL * armAmp + 0.06 * idle;
  P[AL_Y] = 0;
  P[AL_Z] = -0.14 - 0.08 * run * mw;
  P[EL] = 0.24 + 0.5 * run * mw + Math.max(0, -sL) * 0.16 * mw;
  P[AR_X] = REST_ARM[0] + sL * (0.18 + 0.12 * run) * mw + 0.05 * idle;
  P[AR_Y] = REST_ARM[1];
  P[AR_Z] = REST_ARM[2] + 0.06 * run * mw;
  P[ER] = REST_ARM[3] + 0.3 * run * mw + Math.max(0, sL) * 0.2 * mw;
  // Blade keeps its world angle whatever the arm swing (low, back, tip off the ground)
  P[W_X] = REST_ARM[4] - (P[AR_X] - REST_ARM[0]) - (P[ER] - REST_ARM[3]) - P[T_X] * 0.5;
  P[W_Y] = REST_ARM[5];
  P[W_Z] = REST_ARM[6];
  // Head: steady gaze into the turn; idle look-around
  P[HD_Y] = Math.sin(t * 0.37) * 0.16 * idle - sL * 0.05 * mw + lead * 0.9 - P[T_Y] * 0.5 * mw;
  P[HD_X] = breath * 0.018 * idle + (0.04 + 0.08 * run) * mw - P[T_X] * 0.4;

  // The Guide grips its lantern staff (meshes.makeGuide plants it through this
  // fist): forearm forward, upper arm steady against the breathing torso
  if (grip) {
    P[AL_X] = grip.arm - P[T_X];
    P[AL_Z] = -0.16;
    P[EL] = grip.elbow;
  }

  // —— layers ——
  const out = s.out;
  out.set(P);

  // portal channel (static pose, eased in and out)
  s.chanW += ((opts.channeling ? 1 : 0) - s.chanW) * (1 - Math.exp(-dt * 9));
  if (s.chanW > 0.001) {
    lerpKey(s.tmp, out, CHANNEL_KEY, P, s.chanW);
    out.set(s.tmp);
  }

  // legacy attackU (callers that drive progress directly)
  if (opts.attacking && opts.attackU != null && s.swingT0 < 0) {
    humanoidSwing(root, tMs, 0, 440, clamp(opts.attackU, 0, 0.99));
  }

  // sword swing
  if (s.swingT0 >= 0) {
    const u = (tMs - s.swingT0) / s.swingDur;
    if (u >= 1 || u < 0) {
      s.swingT0 = -1;
    } else {
      if (!s.swingEntryTaken) {
        s.entry.set(s.prev);
        s.swingEntryTaken = true;
      }
      const K = SWINGS[s.swingKind]!;
      const A2 = s.tmp;
      if (u < SWING_U_COCK) {
        const k0 = s.swingU0 / SWING_U_COCK;
        const k = easeInOut(clamp((u / SWING_U_COCK - k0) / Math.max(0.05, 1 - k0), 0, 1));
        lerpKey(A2, s.entry, K[0]!, P, k);
      } else if (u < SWING_U_MID) {
        const k = (u - SWING_U_COCK) / (SWING_U_MID - SWING_U_COCK);
        lerpKeys(A2, K[0]!, K[1]!, P, k * k);
      } else if (u < SWING_U_HIT) {
        lerpKeys(A2, K[1]!, K[2]!, P, (u - SWING_U_MID) / (SWING_U_HIT - SWING_U_MID));
      } else if (u < SWING_U_FOL) {
        lerpKeys(A2, K[2]!, K[3]!, P, easeOut((u - SWING_U_HIT) / (SWING_U_FOL - SWING_U_HIT)));
      } else {
        lerpKey(A2, P, K[3]!, P, 1);
        const k = smoothstep(SWING_U_REC, 1, u);
        for (let i = 0; i < NCH; i++) A2[i] = A2[i]! + (P[i]! - A2[i]!) * k;
      }
      // Legs keep walking when the hero moves while swinging
      const legKeep = mw * 0.8;
      for (const c of LEG_CH) A2[c] = A2[c]! + (P[c]! - A2[c]!) * legKeep;
      out.set(A2);
    }
  }

  // spell casts: wind (build) → release (snap) → hold → recover
  if (s.castT0 >= 0) {
    const e = tMs - s.castT0;
    const [W, R] = CAST[s.castKind];
    const hold = s.castKind === "gale" ? 150 : 220;
    const rec = 280;
    if (e > s.castWind + 80 + hold + rec) {
      s.castT0 = -1;
    } else {
      if (!s.castEntryTaken) {
        s.castEntry.set(s.prev);
        s.castEntryTaken = true;
      }
      const A2 = s.tmp;
      if (e < s.castWind) lerpKey(A2, s.castEntry, W, out, easeInOut(e / s.castWind));
      else if (e < s.castWind + 80) lerpKeys(A2, W, R, out, easeOut((e - s.castWind) / 80));
      else if (e < s.castWind + 80 + hold) lerpKey(A2, out, R, out, 1);
      else {
        lerpKey(A2, out, R, out, 1);
        const k = easeInOut((e - s.castWind - 80 - hold) / rec);
        for (let i = 0; i < NCH; i++) A2[i] = A2[i]! + (out[i]! - A2[i]!) * k;
      }
      out.set(A2);
    }
  }

  // dash: long lunge, chest low, arms and blade trailing
  if (s.dashT0 >= 0) {
    const e = tMs - s.dashT0;
    const total = s.dashDur + 220;
    if (e > total) s.dashT0 = -1;
    else {
      const w = e < 50 ? easeOut(e / 50) : e < s.dashDur ? 1 : 1 - easeInOut((e - s.dashDur) / 220);
      lerpKey(s.tmp, out, DASH_KEY, out, w);
      out.set(s.tmp);
    }
  }

  // death: knees buckle → slump forward onto the hands; revive rises from a kneel
  if (s.deathT0 >= 0) {
    const e = (tMs - s.deathT0) / 1000;
    if (!s.deathEntryTaken) {
      s.deathEntry.set(s.prev);
      s.deathEntryTaken = true;
    }
    if (e < 0.32) lerpKey(s.tmp, s.deathEntry, DEATH_KNEEL, out, easeOut(e / 0.32));
    else if (e < 0.7) lerpKeys(s.tmp, DEATH_KNEEL, DEATH_FALL, out, easeInOut((e - 0.32) / 0.38));
    else lerpKey(s.tmp, out, DEATH_FALL, out, 1);
    out.set(s.tmp);
  } else if (s.reviveT0 >= 0) {
    const e = (tMs - s.reviveT0) / 1000;
    if (e > 0.55) s.reviveT0 = -1;
    else {
      lerpKey(s.tmp, out, DEATH_KNEEL, out, 1);
      mix(out, s.tmp, out, easeInOut(e / 0.55));
    }
  }

  // flinch (additive): recoil away from the blow, head snaps, arms fly out
  if (s.flinchT0 >= 0) {
    const e = (tMs - s.flinchT0) / 1000;
    if (e > 0.42) s.flinchT0 = -1;
    else {
      const env = e < 0.045 ? e / 0.045 : Math.exp(-(e - 0.045) * 9);
      const f = s.flinchF;
      const sd = s.flinchS;
      out[T_X] += 0.3 * f * env;
      out[T_Z] += 0.22 * sd * env;
      out[T_Y] += -0.18 * sd * env;
      out[HD_X] += 0.25 * f * env;
      out[HD_Y] += -0.2 * sd * env;
      out[H_Z] += 0.07 * f * env;
      out[H_X] += -0.05 * sd * env;
      out[AL_X] += 0.35 * env;
      out[AL_Z] += -0.35 * env;
      out[AR_Z] += 0.3 * env;
      out[KL] += -0.18 * env;
      out[KR] += -0.18 * env;
    }
  }

  s.prev.set(out);
  applyPose(s, out, mw, run, vF, vL, aF, dt, t, ph);
}

/** Write the channel pose to the bones, plant the feet, flatten ankles, drive the cloth. */
function applyPose(
  s: HumState,
  o: Float32Array,
  mw: number,
  run: number,
  vF: number,
  vL: number,
  aF: number,
  dt: number,
  t: number,
  ph: number
) {
  const J = s.j;
  const idle = 1 - mw;
  // Lower foot on the ground: pelvis height from both legs (+ hip roll lift)
  const rollL = -0.1 * Math.sin(o[H_ROLL]!);
  const rollR = 0.1 * Math.sin(o[H_ROLL]!);
  const reachL = legReach(o[LL_X]!, o[KL]!) * Math.cos(o[LL_Z]!) - rollL;
  const reachR = legReach(o[LR_X]!, o[KR]!) * Math.cos(o[LR_Z]!) - rollR;
  const bounce = 0.018 * run * mw * Math.abs(Math.sin(ph * 2));
  const hipsY = Math.max(reachL, reachR) - (THIGH + SHIN) + o[H_DROP]! + bounce + Math.sin(t * 1.85) * 0.006 * idle;
  if (J.hips) {
    J.hips.position.set(o[H_X]!, hipsY, o[H_Z]!);
    J.hips.rotation.set(o[H_PITCH]!, o[H_YAW]!, o[H_ROLL]!);
  }
  if (J.torso) J.torso.rotation.set(o[T_X]!, o[T_Y]!, o[T_Z]!);
  if (J.armR) J.armR.rotation.set(o[AR_X]!, o[AR_Y]!, o[AR_Z]!);
  if (J.elbowR) J.elbowR.rotation.x = o[ER]!;
  if (J.weapon) J.weapon.rotation.set(o[W_X]!, o[W_Y]!, o[W_Z]!);
  if (J.armL) J.armL.rotation.set(o[AL_X]!, o[AL_Y]!, o[AL_Z]!);
  if (J.elbowL) J.elbowL.rotation.x = o[EL]!;
  if (J.legL) J.legL.rotation.set(o[LL_X]!, 0, o[LL_Z]!);
  if (J.legR) J.legR.rotation.set(o[LR_X]!, 0, o[LR_Z]!);
  if (J.kneeL) J.kneeL.rotation.x = o[KL]!;
  if (J.kneeR) J.kneeR.rotation.x = o[KR]!;
  // Soles stay parallel to the ground in stance (counter hips + thigh + shin pitch);
  // a toe-off flick early in the swing
  const cL = Math.cos(ph);
  const sL = Math.sin(ph);
  const toeOffL = mw * 0.55 * Math.max(0, cL) * Math.max(0, -sL);
  const toeOffR = mw * 0.55 * Math.max(0, -cL) * Math.max(0, sL);
  if (J.ankleL) J.ankleL.rotation.x = -(o[H_PITCH]! + o[LL_X]! + o[KL]!) * 0.9 + toeOffL + o[AK_L]!;
  if (J.ankleR) J.ankleR.rotation.x = -(o[H_PITCH]! + o[LR_X]! + o[KR]!) * 0.9 + toeOffR + o[AK_R]!;
  if (J.head) J.head.rotation.set(o[HD_X]!, o[HD_Y]!, 0);
  if (J.hood) J.hood.rotation.x = Math.sin(t * 1.85) * 0.012;

  // —— cloth ——
  if (dt > 0) {
    const bodyPitch = o[H_PITCH]! + o[T_X]!;
    // Cape: trails with forward speed, swings forward on a stop (spring overshoot),
    // sways against sideways motion; the chain below lags for a whip.
    const liftT = clamp(-(0.05 + 0.07 * Math.max(0, vF) + 0.025 * Math.abs(vL)), -1.05, 0.1) - bodyPitch * 0.75;
    stepSpring(s.capeX, liftT, 10, 0.42, dt);
    stepSpring(s.capeZ, clamp(-vL * 0.045, -0.45, 0.45), 9, 0.4, dt);
    stepSpring(s.capeY, clamp(-s.yawRate * 0.03, -0.3, 0.3), 9, 0.5, dt);
    const flutter = Math.sin(ph * 2 + 0.8) * 0.07 * mw * (0.4 + run) + Math.sin(t * 1.35) * 0.02 * idle;
    stepSpring(s.capeMid, s.capeX.x * 0.35 + flutter, 8, 0.35, dt);
    stepSpring(s.capeHem, s.capeX.x * 0.3 + flutter * 1.3, 6.5, 0.3, dt);
    s.capeX.x = clamp(s.capeX.x, -1.35, 0.28);
    // Robe: bell swings forward when braking, trails when running
    stepSpring(s.robe, clamp(aF * 0.01 - vF * 0.012, -0.3, 0.32), 9, 0.32, dt);
    stepSpring(s.robeZ, clamp(-vL * 0.02, -0.2, 0.2), 8, 0.35, dt);
  }
  if (J.cloak) {
    J.cloak.rotation.set(s.capeX.x * 0.55, s.capeY.x, s.capeZ.x * 0.6);
  }
  if (J.cloakMid) J.cloakMid.rotation.set(s.capeX.x * 0.25 + s.capeMid.x * 0.55, 0, s.capeZ.x * 0.25);
  if (J.cloakHem) J.cloakHem.rotation.set(s.capeX.x * 0.2 + s.capeHem.x * 0.5, 0, s.capeZ.x * 0.2);
  // Front of the robe rides the forward thigh; back the trailing one; hems hang
  const fwd = Math.max(0, o[LL_X]!, o[LR_X]!);
  const back = Math.min(0, o[LL_X]!, o[LR_X]!);
  const fwdKnee = o[LL_X]! > o[LR_X]! ? o[KL]! : o[KR]!;
  if (J.apron) J.apron.rotation.set(fwd * 0.95 + s.robe.x * 0.4 - o[H_PITCH]! * 0.5, 0, s.robeZ.x);
  if (J.apronHem) J.apronHem.rotation.set(-fwd * 0.3 + fwdKnee * 0.25 + s.robe.x * 0.6, 0, s.robeZ.x * 0.6);
  if (J.tabard) J.tabard.rotation.set(back * 0.9 - 0.04 * run * mw + s.robe.x * 0.3 - o[H_PITCH]! * 0.5, 0, s.robeZ.x);
  if (J.tabardHem) J.tabardHem.rotation.set(-back * 0.25 + s.robe.x * 0.5 - 0.05 * run * mw, 0, s.robeZ.x * 0.6);
}

// ——— blade sampling (for the slash trail) ———————————————————————————————

const _tip = new THREE.Vector3();
const _base = new THREE.Vector3();
const _prevRot = new Float32Array(16);

/**
 * Sub-frame blade samples between last frame's pose and this frame's pose:
 * interpolates the arm-chain rotations (so the path is an arc, not a chord),
 * runs forward kinematics for each sub-step and hands tip/base world points to
 * `emit`. Restores this frame's pose afterwards.
 */
export function sampleBlade(
  root: THREE.Object3D,
  prevRots: Float32Array,
  steps: number,
  emit: (tip: THREE.Vector3, base: THREE.Vector3, k: number) => void
) {
  const s = root.userData.hum as HumState | undefined;
  if (!s) return;
  const J = s.j;
  const chain = s.chain;
  if (!J.weapon || !J.hips || !J.torso || !J.armR || !J.elbowR) return;
  // capture current
  let n = 0;
  for (const o of chain) {
    _prevRot[n++] = o!.rotation.x;
    _prevRot[n++] = o!.rotation.y;
    _prevRot[n++] = o!.rotation.z;
  }
  _prevRot[15] = J.hips.position.y;
  for (let k = 1; k <= steps; k++) {
    const a = k / steps;
    let i = 0;
    for (const o of chain) {
      o!.rotation.set(
        prevRots[i]! + (_prevRot[i]! - prevRots[i]!) * a,
        prevRots[i + 1]! + (_prevRot[i + 1]! - prevRots[i + 1]!) * a,
        prevRots[i + 2]! + (_prevRot[i + 2]! - prevRots[i + 2]!) * a
      );
      i += 3;
    }
    J.hips.position.y = prevRots[15]! + (_prevRot[15]! - prevRots[15]!) * a;
    J.weapon.updateWorldMatrix(true, false);
    _tip.set(0, -0.86, 0).applyMatrix4(J.weapon.matrixWorld);
    _base.set(0, -0.46, 0).applyMatrix4(J.weapon.matrixWorld);
    emit(_tip, _base, a);
  }
  // restore
  let i = 0;
  for (const o of chain) {
    o!.rotation.set(_prevRot[i]!, _prevRot[i + 1]!, _prevRot[i + 2]!);
    i += 3;
  }
  J.hips.position.y = _prevRot[15]!;
  // store for the next frame
  prevRots.set(_prevRot);
}

/** Snapshot the blade chain rotations (seed for sampleBlade on a swing's first frame). */
export function captureBladeChain(root: THREE.Object3D, out: Float32Array) {
  const s = root.userData.hum as HumState | undefined;
  if (!s) return;
  const J = s.j;
  let n = 0;
  for (const o of s.chain) {
    out[n++] = o?.rotation.x ?? 0;
    out[n++] = o?.rotation.y ?? 0;
    out[n++] = o?.rotation.z ?? 0;
  }
  out[15] = J.hips?.position.y ?? 0;
}
