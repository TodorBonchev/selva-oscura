/**
 * Procedural humanoid motion for the wanderer rig (local hero, remote pilgrims,
 * the Guide). Joints are the named bones built in hero.ts.
 *
 * Every frame builds one pose as a flat channel array:
 *   locomotion upper body (gait phase integrated per root, lean from
 *   acceleration, bank from lateral acceleration, turn lead, pelvis turned
 *   into a sidestep, idle weight shift) → attack / cast / dash / death layers
 *   blended over it → flinch added on top → the FOOT SOLVER places the feet and
 *   solves the legs by two-bone IK → applied to the bones → cloth (cape chain
 *   springs; robe panels pushed clear of the legs, springs on top).
 * Foot solver (solveFeet): while travelling, stance feet are locked in the
 * world from heel strike (heel roll) to toe-off (onto the ball) and swing feet
 * fly Hermite arcs to the next contact, cadence = ground speed / stride; when
 * standing, attacking, casting or hurt, feet stay locked and step when the pose
 * or a turn pulls them away (planted feet keep their heading via an ankle
 * twist). No skating at any speed, turn or stance change.
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
/** Death timeline (s): knees buckle, then the body slumps forward (held until the respawn). */
const DEATH_KNEEL_S = 0.2;
const DEATH_FALL_S = 0.44;
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
  /** robe panels, [left, right] */
  apron: (THREE.Object3D | undefined)[];
  apronHem: (THREE.Object3D | undefined)[];
  tabard: (THREE.Object3D | undefined)[];
  tabardHem: (THREE.Object3D | undefined)[];
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

/**
 * One foot of the foot solver. Targets are the ankle joint in root space (rig
 * units, x right, y up, z back) plus the sole pitch (+ toe up). A planted foot
 * is locked in WORLD space (wx, wz = the ankle's ground projection), so it can
 * never slide while the body moves or turns over it.
 */
type Foot = {
  planted: boolean;
  wx: number;
  wz: number;
  x: number;
  y: number;
  z: number;
  p: number;
  /** lift-off state (root space) of the current swing / step */
  x0: number;
  y0: number;
  z0: number;
  p0: number;
  /** gait: cycle fraction at lift-off; plant step: start time (ms) */
  s0: number;
  /** plant step duration (ms) */
  dur: number;
  /** gait: lifted before its toe-off (out of reach) — swings until the next strike */
  released: boolean;
  lastPsi: number;
  /** world yaw the foot was set down with; its twist against the body (ankle yaw) */
  wyaw: number;
  yo: number;
  /** plant mode: where the pose wants this foot (root space) */
  dx: number;
  dy: number;
  dz: number;
  dp: number;
  err: number;
};

const foot = (): Foot => ({
  planted: true,
  wx: 0,
  wz: 0,
  x: 0,
  y: 0,
  z: 0,
  p: 0,
  x0: 0,
  y0: 0,
  z0: 0,
  p0: 0,
  s0: 0,
  dur: 150,
  released: false,
  lastPsi: 0,
  wyaw: 0,
  yo: 0,
  dx: 0,
  dy: 0,
  dz: 0,
  dp: 0,
  err: 0,
});

/** Per-frame gait layout (rig units / seconds), shared by the solver. */
type Gait = {
  sp: number;
  gw: number;
  gr: number;
  beta: number;
  D: number;
  cF: number;
  freq: number;
  w: number;
  lift: number;
  /** clearance bump skew (0: mid-swing peak … 0.8: early heel kick) */
  liftExp: number;
  th: number;
  tt: number;
  qh: number;
  qt: number;
  /** travel direction (unit) and body velocity in root space */
  dxr: number;
  dzr: number;
  vxr: number;
  vzr: number;
};

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
  // feet
  feet: [Foot, Foot];
  /** 0 = legs follow the pose (dash / death), 1 = planted / stepping, 2 = gait */
  mode: number;
  feetValid: boolean;
  hipOff: number;
  lastHipsY: number;
  /** pelvis turn toward a sideways travel (rad) */
  hipTurn: number;
  /** smoothed travel direction (world, unit) */
  tdx: number;
  tdz: number;
  /** attack stance: kind + hold time after the last swing */
  stanceKind: number;
  stanceUntil: number;
  gait: Gait;
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
    apron: [g("apronL"), g("apronR")],
    apronHem: [g("apronHemL"), g("apronHemR")],
    tabard: [g("tabardL"), g("tabardR")],
    tabardHem: [g("tabardHemL"), g("tabardHemR")],
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
      feet: [foot(), foot()],
      mode: 1,
      feetValid: false,
      hipOff: 0,
      lastHipsY: 0,
      hipTurn: 0,
      tdx: -Math.sin(root.rotation.y),
      tdz: -Math.cos(root.rotation.y),
      stanceKind: 0,
      stanceUntil: -1e9,
      gait: {
        sp: 0,
        gw: 0,
        gr: 0,
        beta: 0.6,
        D: 0.5,
        cF: 0.5,
        freq: 0,
        w: 0.1,
        lift: 0.06,
        liftExp: 1,
        th: 0,
        tt: 0,
        qh: 0.15,
        qt: 0.65,
        dxr: 0,
        dzr: -1,
        vxr: 0,
        vzr: 0,
      },
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

// ——— leg geometry + IK (rig units; hero.ts builds the same skeleton) ——————
const L1 = THIGH; // hip → knee
const L2 = SHIN - ANKLE; // knee → ankle joint
const LEG = L1 + L2;
const HIP_Y = THIGH + SHIN; // leg pivot above the hips bone origin
const HIP_X = 0.1; // leg pivot half-spacing
const BALL = 0.11; // ball of the foot ahead of the ankle
const HEEL = 0.06; // heel behind the ankle
const TAU = Math.PI * 2;

/** Hips rotation (three.js Euler XYZ), row-major 3×3; set once per solve. */
const _R = new Float64Array(9);
function setHipsRot(o: Float32Array) {
  const a = Math.cos(o[H_PITCH]!);
  const b = Math.sin(o[H_PITCH]!);
  const c = Math.cos(o[H_YAW]!);
  const d = Math.sin(o[H_YAW]!);
  const e = Math.cos(o[H_ROLL]!);
  const f = Math.sin(o[H_ROLL]!);
  _R[0] = c * e;
  _R[1] = -c * f;
  _R[2] = d;
  _R[3] = a * f + b * e * d;
  _R[4] = a * e - b * f * d;
  _R[5] = -b * c;
  _R[6] = b * f - a * e * d;
  _R[7] = b * e + a * f * d;
  _R[8] = a * c;
}

const _fk = new Float64Array(3);
/** Ankle joint of a leg (root space) from the pose's leg angles, hips bone at height hy. */
function ankleFK(o: Float32Array, side: number, hy: number) {
  const left = side < 0;
  const a = o[left ? LL_X : LR_X]!;
  const c = o[left ? LL_Z : LR_Z]!;
  const k = o[left ? KL : KR]!;
  const A = L1 + L2 * Math.cos(k);
  const B = -L2 * Math.sin(k);
  const Ac = A * Math.cos(c);
  const lx = A * Math.sin(c) + HIP_X * side;
  const ly = -Ac * Math.cos(a) - B * Math.sin(a) + HIP_Y;
  const lz = -Ac * Math.sin(a) + B * Math.cos(a);
  _fk[0] = _R[0]! * lx + _R[1]! * ly + _R[2]! * lz + o[H_X]!;
  _fk[1] = _R[3]! * lx + _R[4]! * ly + _R[5]! * lz + hy;
  _fk[2] = _R[6]! * lx + _R[7]! * ly + _R[8]! * lz + o[H_Z]!;
}

/** Hips height at which the pose's lower foot stands on the ground (sole at y = 0). */
function groundedHipsY(o: Float32Array) {
  ankleFK(o, -1, 0);
  const yl = _fk[1]!;
  ankleFK(o, 1, 0);
  return ANKLE - Math.min(yl, _fk[1]!);
}

/** Highest hips height at which a leg of length lm still reaches ankle target (x, y, z). */
function hipsCap(o: Float32Array, side: number, x: number, y: number, z: number, lm: number) {
  const px = _R[0]! * HIP_X * side + _R[1]! * HIP_Y + o[H_X]!;
  const py = _R[3]! * HIP_X * side + _R[4]! * HIP_Y;
  const pz = _R[6]! * HIP_X * side + _R[7]! * HIP_Y + o[H_Z]!;
  const hx = x - px;
  const hz = z - pz;
  return y + Math.sqrt(Math.max(0, lm * lm - hx * hx - hz * hz)) - py;
}

/**
 * Analytic two-bone leg IK: thigh pitch + abduction and knee so the ankle joint
 * lands on (x, y, z) (root space) with the hips bone at height hy; the sole
 * pitch goes to the ankle channel. Returns distance / leg length (> 1: short).
 */
function solveLeg(o: Float32Array, side: number, hy: number, x: number, y: number, z: number, p: number) {
  const left = side < 0;
  const rx = x - o[H_X]!;
  const ry = y - hy;
  const rz = z - o[H_Z]!;
  let lx = _R[0]! * rx + _R[3]! * ry + _R[6]! * rz - HIP_X * side;
  let ly = _R[1]! * rx + _R[4]! * ry + _R[7]! * rz - HIP_Y;
  let lz = _R[2]! * rx + _R[5]! * ry + _R[8]! * rz;
  const d0 = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1e-6;
  const d = clamp(d0, 0.12, LEG * 0.9995);
  if (d !== d0) {
    const k = d / d0;
    lx *= k;
    ly *= k;
    lz *= k;
  }
  const ck = clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
  const k = -Math.acos(ck);
  const A = L1 + L2 * ck;
  const B = -L2 * Math.sin(k);
  const c = Math.asin(clamp(lx / A, -1, 1));
  const a = wrapPi(Math.atan2(lz, ly) - Math.atan2(B, -A * Math.cos(c)));
  o[left ? LL_X : LR_X] = a;
  o[left ? LL_Z : LR_Z] = c;
  o[left ? KL : KR] = k;
  o[left ? AK_L : AK_R] = p;
  return d0 / LEG;
}

const _w = { x: 0, z: 0 };
function toRoot(root: THREE.Object3D, wx: number, wz: number) {
  const dx = wx - root.position.x;
  const dz = wz - root.position.z;
  const c = Math.cos(root.rotation.y);
  const s = Math.sin(root.rotation.y);
  const inv = 1 / (root.scale.x || 1);
  _w.x = (dx * c - dz * s) * inv;
  _w.z = (dx * s + dz * c) * inv;
  return _w;
}
function toWorld(root: THREE.Object3D, x: number, z: number) {
  const c = Math.cos(root.rotation.y);
  const s = Math.sin(root.rotation.y);
  const sc = root.scale.x || 1;
  _w.x = root.position.x + sc * (x * c + z * s);
  _w.z = root.position.z + sc * (-x * s + z * c);
  return _w;
}

/** Ankle target of a stance foot at stance fraction q: heel strike roll → flat → heel-off onto the ball. */
function stanceAnkle(f: Foot, rx: number, rz: number, q: number, g: Gait) {
  let z = rz;
  let y = ANKLE;
  let p = 0;
  if (q < g.qh && g.th > 0) {
    // rolling down onto the sole about the heel (heel point fixed)
    const th = g.th * (1 - q / g.qh) * (1 - q / g.qh);
    z = rz + HEEL - HEEL * Math.cos(th) + ANKLE * Math.sin(th);
    y = HEEL * Math.sin(th) + ANKLE * Math.cos(th);
    p = th;
  } else if (q > g.qt && g.tt > 0) {
    // heel lifts, the foot pivots on the ball (ball point fixed)
    const th = g.tt * Math.pow(clamp((q - g.qt) / (1 - g.qt), 0, 1), 1.4);
    z = rz - BALL + BALL * Math.cos(th) - ANKLE * Math.sin(th);
    y = BALL * Math.sin(th) + ANKLE * Math.cos(th);
    p = -th;
  }
  f.x = rx;
  f.y = y;
  f.z = z;
  f.p = p;
}

/** Cycle fraction of leg k (left heel strike at phase π/2; the right one half a cycle later). */
function legPsi(phase: number, k: number) {
  const v = (phase - Math.PI / 2) / TAU + 0.5 * k;
  return v - Math.floor(v);
}

/** Where a swinging foot lands (flat ankle projection, root space): ahead along the travel. */
function contactRef(g: Gait, side: number) {
  _w.x = side * g.w + g.dxr * g.cF * g.D;
  _w.z = g.dzr * g.cF * g.D;
  return _w;
}

/**
 * Attack stance per swing kind, feet in root space [Lx, Lz, Rx, Rz]: the left
 * foot leads for the forehand/backhand, the right steps through on the overhead.
 */
const SWING_STANCE: [number, number, number, number][] = [
  [-0.12, -0.15, 0.11, 0.19],
  [-0.11, -0.17, 0.11, 0.17],
  [-0.11, 0.14, 0.1, -0.2],
];
/** Swing fraction after which the foot hangs over its landing spot (world-still). */
const SWING_HANG = 0.82;
/** A planted foot steps once the pose wants it this far away (rig units). */
const STEP_AT = 0.11;

/**
 * Foot solver (runs after all pose layers): writes the leg channels and returns
 * the hips height.
 *  gait  — the phase drives stance/swing per leg; a stance foot is locked in the
 *          world from heel strike to toe-off (so the body walks over it: no
 *          skating whatever the speed, turn or acceleration); a swing foot flies
 *          on a Hermite arc to the next contact ahead along the travel.
 *  plant — standing, attacking, casting, flinching: feet stay locked where they
 *          are while the pose's legs bend over them; a foot the pose (or a
 *          turn in place) pulls too far away takes a quick step.
 *  free  — dash / death / revive: the pose's leg angles as authored.
 */
function solveFeet(
  root: THREE.Object3D,
  s: HumState,
  o: Float32Array,
  gaitOn: boolean,
  legsFree: boolean,
  jumped: boolean,
  tMs: number,
  breathY: number,
  dt: number
): number {
  const g = s.gait;
  const F = s.feet;
  setHipsRot(o);
  const ruleY = groundedHipsY(o) + o[H_DROP]!;
  const prevMode = s.mode;
  if (legsFree) {
    s.mode = 0;
    s.feetValid = false;
    F[0].yo = 0;
    F[1].yo = 0;
    return finishHips(s, ruleY + breathY, prevMode, dt);
  }

  // Desired feet (plant mode): the pose's own legs, pulled toward the attack stance
  let sw = 0;
  if (s.swingT0 >= 0) {
    const u = (tMs - s.swingT0) / s.swingDur;
    sw = u < SWING_U_COCK ? smoothstep(0.02, SWING_U_COCK * 0.8, u) : 1;
    s.stanceKind = s.swingKind;
    s.stanceUntil = tMs + Math.max(0, 1 - u) * s.swingDur + 650;
  } else if (tMs < s.stanceUntil) sw = 1;
  else sw = 1 - smoothstep(0, 320, tMs - s.stanceUntil);
  const st = SWING_STANCE[s.stanceKind]!;
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? -1 : 1;
    ankleFK(o, side, ruleY);
    const f = F[k]!;
    f.dx = _fk[0]! + ((k === 0 ? st[0] : st[2]) - _fk[0]!) * sw;
    f.dy = _fk[1]!;
    f.dz = _fk[2]! + ((k === 0 ? st[1] : st[3]) - _fk[2]!) * sw;
    f.dp = o[k === 0 ? AK_L : AK_R]!;
  }

  // (Re)seat both feet where the pose has them: first frame, after dash/death, teleports
  if (!s.feetValid || jumped) {
    for (const f of F) {
      f.planted = true;
      f.released = false;
      const w = toWorld(root, f.dx, f.dz);
      f.wx = w.x;
      f.wz = w.z;
      f.wyaw = root.rotation.y;
      f.yo = 0;
      f.x = f.dx;
      f.y = f.dy;
      f.z = f.dz;
      f.p = f.dp;
    }
    s.feetValid = true;
    s.mode = 1;
  }

  const want = gaitOn ? 2 : 1;
  if (want === 2 && s.mode !== 2) enterGait(s);
  else if (want === 1 && s.mode === 2) {
    // stopping: stance feet stay put, a foot in the air finishes as a quick step
    const T = g.freq > 0.05 ? 1000 / g.freq : 400;
    for (const f of F) {
      if (f.planted) continue;
      beginStep(f, tMs, clamp((1 - clamp((legPsiNow(s, f) - f.s0) / Math.max(0.05, 1 - f.s0), 0, 1)) * (1 - g.beta) * T, 90, 200));
    }
  }
  s.mode = want;

  let hy: number;
  if (s.mode === 2) hy = gaitFeet(root, s, o);
  else hy = plantFeet(root, s, o, tMs, ruleY);
  hy = finishHips(s, hy + (s.mode === 1 ? breathY : 0), prevMode, dt);

  // Hard reach cap for grounded feet (a little crouch to reach a foot that is
  // still set down, never a collapse: a foot out of reach steps or lifts instead)
  const floorY = hy - 0.14;
  for (let k = 0; k < 2; k++) {
    const f = F[k]!;
    if (f.planted || f.y < ANKLE + 0.03) hy = Math.min(hy, Math.max(floorY, hipsCap(o, k === 0 ? -1 : 1, f.x, f.y, f.z, LEG * 0.999)));
  }
  s.lastHipsY = hy;
  for (let k = 0; k < 2; k++) {
    const f = F[k]!;
    const r = solveLeg(o, k === 0 ? -1 : 1, hy, f.x, f.y, f.z, f.p);
    f.err = r;
    // a set-down foot keeps its heading while the body turns over it (ankle
    // twist, until it steps); a foot in the air squares up with the body
    if (f.planted) f.yo = clamp(wrapPi(f.wyaw - root.rotation.y), -0.7, 0.7);
    else f.yo *= Math.exp(-dt * 14);
  }
  return hy;
}

/** Hips height with mode switches blended out (inertialization), no pops. */
function finishHips(s: HumState, hy: number, prevMode: number, dt: number) {
  if (prevMode !== s.mode && s.lastHipsY !== 0) s.hipOff = s.lastHipsY - hy;
  s.hipOff *= Math.exp(-dt * 11);
  if (Math.abs(s.hipOff) < 1e-4) s.hipOff = 0;
  const out = hy + s.hipOff;
  s.lastHipsY = out;
  return out;
}

function legPsiNow(s: HumState, f: Foot) {
  return legPsi(s.phase, f === s.feet[0] ? 0 : 1);
}

function beginStep(f: Foot, tMs: number, dur: number) {
  f.planted = false;
  f.x0 = f.x;
  f.y0 = f.y;
  f.z0 = f.z;
  f.p0 = f.p;
  f.s0 = tMs;
  f.dur = dur;
}

/** Plant → gait: phase so the foot further along the travel is the one in stance. */
function enterGait(s: HumState) {
  const g = s.gait;
  const F = s.feet;
  let lead = 0;
  let best = -1e9;
  for (let k = 0; k < 2; k++) {
    const f = F[k]!;
    if (!f.planted) continue;
    const along = f.x * g.dxr + f.z * g.dzr;
    if (along > best) {
      best = along;
      lead = k;
    }
  }
  let ph = Math.PI / 2 + TAU * (0.25 * g.beta - 0.5 * lead);
  ph += TAU * Math.round((s.phase - ph) / TAU);
  s.phase = ph;
  for (let k = 0; k < 2; k++) {
    const f = F[k]!;
    const psi = legPsi(ph, k);
    f.lastPsi = psi;
    f.released = false;
    if (f.planted && psi < g.beta) continue;
    // lift off now and fly to the next contact
    f.planted = false;
    f.x0 = f.x;
    f.y0 = f.y;
    f.z0 = f.z;
    f.p0 = f.p;
    f.s0 = psi;
    f.released = psi < g.beta;
  }
}

/** Gait: stance feet world-locked from heel strike to toe-off, swing feet on arcs. */
function gaitFeet(root: THREE.Object3D, s: HumState, o: Float32Array): number {
  const g = s.gait;
  const F = s.feet;
  // nominal pelvis height for this stride (contact / toe-off reach)
  const zC = -g.cF * g.D + HEEL - HEEL * Math.cos(g.th) + ANKLE * Math.sin(g.th);
  const yC = HEEL * Math.sin(g.th) + ANKLE * Math.cos(g.th);
  const zT = (1 - g.cF) * g.D - BALL + BALL * Math.cos(g.tt) - ANKLE * Math.sin(g.tt);
  const yT = BALL * Math.sin(g.tt) + ANKLE * Math.cos(g.tt);
  const low = Math.min(hipsCap(o, -1, -g.w, yC, zC, LEG * 0.985), hipsCap(o, -1, -g.w, yT, zT, LEG * 0.985));
  let pend = 1e9;
  let nSt = 0;
  let qSt = 0;
  for (let k = 0; k < 2; k++) {
    const f = F[k]!;
    const side = k === 0 ? -1 : 1;
    const psi = legPsi(s.phase, k);
    const wrapped = psi < f.lastPsi - 0.5;
    f.lastPsi = psi;
    if (wrapped) {
      // heel strike: lock the landing spot in the world
      const c = contactRef(g, side);
      const w = toWorld(root, c.x, c.z);
      f.wx = w.x;
      f.wz = w.z;
      f.wyaw = root.rotation.y;
      f.planted = true;
      f.released = false;
      s.plantCount++;
      s.plant = k + 1;
    }
    if (f.planted) {
      const q = Math.min(1, psi / g.beta);
      const r = toRoot(root, f.wx, f.wz);
      stanceAnkle(f, r.x, r.z, q, g);
      // toe-off, or the body has run away from the foot (sharp turn, reversal,
      // a stop): lift it rather than sink the hips to keep reaching it
      const cap = hipsCap(o, side, f.x, f.y, f.z, LEG * 0.985);
      const tooFar = (f.err > 1.02 || cap < low - 0.07) && psi > 0.05;
      if (psi >= g.beta || tooFar) {
        f.planted = false;
        f.x0 = f.x;
        f.y0 = f.y;
        f.z0 = f.z;
        f.p0 = f.p;
        f.s0 = psi;
        f.released = psi < g.beta;
      } else {
        pend = Math.min(pend, cap);
        nSt++;
        qSt = q;
        continue;
      }
    }
    // swing: Hermite from lift-off to a point ahead of the next contact, then
    // the last stretch hangs still over the landing spot (the body closes on it)
    // so the heel meets the ground with no forward speed: no touchdown skid
    const u = clamp((psi - f.s0) / Math.max(0.02, 1 - f.s0), 0, 1);
    const c = contactRef(g, side);
    const x1 = c.x;
    const z1 = c.z + HEEL - HEEL * Math.cos(g.th) + ANKLE * Math.sin(g.th);
    const y1 = HEEL * Math.sin(g.th) + ANKLE * Math.cos(g.th);
    const Tsw = Math.min(0.6, (1 - f.s0) / Math.max(0.4, g.freq));
    // (at a run the hang is only a few centimetres: a world-still foot far out
    // front would need a leg longer than the hero's)
    const vr = Math.hypot(g.vxr, g.vzr);
    const hang = Math.max(SWING_HANG, 1 - 0.045 / Tsw, 1 - 0.07 / Math.max(0.01, vr * 0.9 * Tsw));
    const tail = (1 - hang) * Tsw * 0.9;
    const xR = x1 + g.vxr * tail;
    const zR = z1 + g.vzr * tail;
    if (u < hang) {
      const w = u / hang;
      const T = hang * Tsw;
      const span = Math.hypot(xR - f.x0, zR - f.z0);
      let m0x = -0.85 * g.vxr * T;
      let m0z = -0.85 * g.vzr * T;
      let m1x = -0.9 * g.vxr * T;
      let m1z = -0.9 * g.vzr * T;
      // tangents capped so the arc never overshoots far behind / in front
      const ml0 = Math.hypot(m0x, m0z);
      if (ml0 > span * 0.8) {
        m0x *= (span * 0.8) / ml0;
        m0z *= (span * 0.8) / ml0;
      }
      const ml1 = Math.hypot(m1x, m1z);
      if (ml1 > span * 0.5) {
        m1x *= (span * 0.5) / ml1;
        m1z *= (span * 0.5) / ml1;
      }
      const w2 = w * w;
      const w3 = w2 * w;
      const h00 = 2 * w3 - 3 * w2 + 1;
      const h10 = w3 - 2 * w2 + w;
      const h01 = -2 * w3 + 3 * w2;
      const h11 = w3 - w2;
      f.x = h00 * f.x0 + h10 * m0x + h01 * xR + h11 * m1x;
      f.z = h00 * f.z0 + h10 * m0z + h01 * zR + h11 * m1z;
    } else {
      const e = (u - hang) * Tsw * 0.9;
      f.x = xR - g.vxr * e;
      f.z = zR - g.vzr * e;
    }
    // clearance: an early, high heel kick when running (warped bump, finite slopes)
    const wu = u + g.liftExp * u * (1 - u);
    f.y = f.y0 + (y1 - f.y0) * u + g.lift * Math.sin(Math.PI * wu);
    f.p = f.p0 + (g.th - f.p0) * smoothstep(0.15, 0.9, u) + 0.14 * (1 - g.gr) * Math.sin(Math.PI * u);
  }

  // Pelvis height: vaults over a straight stance leg when walking, sinks through
  // the stance and floats in the flight phase when running
  const walkY = nSt > 0 ? Math.min(pend, low + 0.6 * (pend - low)) : low;
  let runY: number;
  if (nSt === 1) runY = Math.min(pend, low - 0.035 * Math.sin(Math.PI * qSt));
  else if (nSt === 0) {
    const sig = legPsi(s.phase, 0) * 2;
    const sg = sig - Math.floor(sig);
    const ff = clamp((sg - 2 * g.beta) / Math.max(0.05, 1 - 2 * g.beta), 0, 1);
    runY = low + 0.035 * Math.sin(Math.PI * ff);
  } else runY = Math.min(pend, low);
  return walkY + (runY - walkY) * g.gr + o[H_DROP]!;
}

/** Plant: locked feet under a posing body; a foot pulled too far steps. */
function plantFeet(root: THREE.Object3D, s: HumState, o: Float32Array, tMs: number, ruleY: number): number {
  const F = s.feet;
  let stepping = false;
  for (let k = 0; k < 2; k++) {
    const f = F[k]!;
    if (f.planted) {
      const r = toRoot(root, f.wx, f.wz);
      f.x = r.x;
      f.z = r.z;
      f.y = f.dy;
      f.p = f.dp;
      continue;
    }
    stepping = true;
    const u = clamp((tMs - f.s0) / f.dur, 0, 1);
    const e = easeInOut(u);
    f.x = f.x0 + (f.dx - f.x0) * e;
    f.z = f.z0 + (f.dz - f.z0) * e;
    // (a quick lift clear of the ground, a longer carry, a quick set-down)
    f.y = f.y0 + (f.dy - f.y0) * u + 0.06 * Math.pow(Math.sin(Math.PI * u), 0.6);
    f.p = f.p0 + (f.dp - f.p0) * e + 0.12 * Math.sin(Math.PI * u);
    if (u >= 1) {
      f.planted = true;
      const w = toWorld(root, f.dx, f.dz);
      f.wx = w.x;
      f.wz = w.z;
      f.wyaw = root.rotation.y;
    }
  }
  // the foot the pose (or a turn on the spot, or drifting remote motion) pulls
  // furthest steps first; a foot far out of place goes even while the other steps
  let kk = -1;
  let worst = 0;
  for (let k = 0; k < 2; k++) {
    const f = F[k]!;
    if (!f.planted) continue;
    const e = Math.hypot(f.x - f.dx, f.z - f.dz) + (f.err > 1.01 ? 1 : 0) + Math.max(0, Math.abs(f.yo) - 0.45);
    if (e > worst) {
      worst = e;
      kk = k;
    }
  }
  if (kk >= 0 && worst > (stepping ? 0.45 : STEP_AT)) beginStep(F[kk]!, tMs, 120 + 160 * Math.min(0.5, worst));
  return ruleY;
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
  /**
   * Swing progress driven by the caller's own clock (local hero: the combat
   * clock), −1 = no swing. Overrides the tMs-based swing timeline.
   */
  swingU?: number;
  /** world planar velocity (x, z); derived from root motion when omitted (remotes) */
  vx?: number;
  vz?: number;
  /** wind on the cloth (world planar, ~0..1.4 at a full gust): the cape streams with it */
  windX?: number;
  windZ?: number;
};

export function tickHumanoid(root: THREE.Object3D, opts: HumanoidOpts) {
  const s = stateOf(root);
  const tMs = opts.tMs;
  const t = tMs * 0.001;
  const dt = s.init ? clamp((tMs - s.lastT) * 0.001, 0, 0.05) : 0;
  const scale = root.scale.x || 1;

  // —— velocity / acceleration / yaw rate ——
  let vx: number;
  let vz: number;
  const mdx = root.position.x - s.lastX;
  const mdz = root.position.z - s.lastZ;
  // (a big jump is a snap/teleport, not a stride)
  const jumped = s.init && mdx * mdx + mdz * mdz > 2.25;
  if (opts.vx != null && opts.vz != null) {
    vx = opts.vx;
    vz = opts.vz;
  } else if (s.init && dt > 0) {
    const k = 1 - Math.exp(-dt * 10);
    vx = jumped ? 0 : s.vx + (mdx / dt - s.vx) * k;
    vz = jumped ? 0 : s.vz + (mdz / dt - s.vz) * k;
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
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const fx = -sy;
  const fz = -cy;
  const rx = cy;
  const rz = -sy;
  const vF = vx * fx + vz * fz; // world units / s along facing
  const vL = vx * rx + vz * rz; // toward the right
  const aF = s.ax * fx + s.az * fz;
  const aL = s.ax * rx + s.az * rz;
  const speedW = Math.hypot(vx, vz);
  const sp = speedW / scale; // rig units / s

  // —— move weight ——
  const moving = opts.moving || speedW > 0.45;
  const mwRate = moving ? 12 : 8;
  s.mw += ((moving ? 1 : 0) - s.mw) * (1 - Math.exp(-mwRate * Math.max(dt, 0.001)));
  const mw = s.mw;
  const run = clamp((sp - 2.2) / 3.2, 0, 1);

  // —— gait layout: stance fraction, contact length and cadence from ground speed ——
  // Cadence = speed / stride, stride = contact length / stance fraction, so a
  // stance foot is swept back at exactly the body's speed (and it is locked in
  // the world besides). Walk → jog → run: shorter stance, longer contact, a
  // flight phase, higher knees.
  if (speedW > 0.2) {
    const k = 1 - Math.exp(-dt * 14);
    s.tdx += (vx / speedW - s.tdx) * k;
    s.tdz += (vz / speedW - s.tdz) * k;
    const l = Math.hypot(s.tdx, s.tdz) || 1;
    s.tdx /= l;
    s.tdz /= l;
  }
  const g = s.gait;
  g.sp = sp;
  g.gw = smoothstep(1.2, 3.0, sp);
  g.gr = smoothstep(2.6, 5.6, sp);
  g.dxr = s.tdx * cy - s.tdz * sy;
  g.dzr = s.tdx * sy + s.tdz * cy;
  g.vxr = (vx * cy - vz * sy) / scale;
  g.vzr = (vx * sy + vz * cy) / scale;
  const fwdness = Math.max(0, -g.dzr);
  const lat = Math.abs(g.dxr);
  g.beta = 0.6 - 0.2 * g.gw - 0.15 * g.gr;
  g.D = (0.72 + 0.06 * g.gw + 0.02 * g.gr) * (1 - 0.55 * lat) * clamp(0.35 + sp / 2.2, 0, 1);
  g.cF = 0.5 - 0.13 * g.gr;
  g.freq = sp > 0.02 ? Math.min(2.6, (sp * g.beta) / g.D) : 0;
  // braking: quick short steps catch the body (the feet don't freeze mid-stride)
  if (s.mode === 2) g.freq = Math.max(g.freq, 1.5 * clamp(-aF / (14 * scale), 0, 1));
  g.w = 0.1 - 0.03 * g.gr;
  g.lift = 0.06 + 0.05 * g.gw + 0.09 * g.gr;
  g.liftExp = 0.25 + 0.45 * g.gr;
  g.th = (0.22 - 0.1 * g.gr) * fwdness;
  g.tt = (0.5 + 0.35 * g.gr) * fwdness;
  g.qh = 0.15 - 0.07 * g.gr;
  g.qt = 0.6 - 0.2 * g.gr;
  s.phase += TAU * g.freq * dt;
  if (s.phase > 1000) s.phase -= TAU * 100;
  // gait while travelling (hysteresis); planted feet otherwise
  const gaitOn = s.mode === 2 ? moving && sp > 0.2 : moving && sp > 0.35;
  const ph = s.phase;
  const sL = Math.sin(ph);
  const cL = Math.cos(ph);
  const idle = 1 - mw;
  const breath = Math.sin(t * 1.85);

  // —— locomotion pose (upper body; legs here are the standing pose the solver plants) ——
  const P = s.loco;
  // Idle contrapposto: weight rests on one leg, the other knee eases; swaps every few seconds
  const want = Math.sin(t * 0.21 + (root.id % 7)) > 0 ? 1 : -1;
  s.shift += (want - s.shift) * (1 - Math.exp(-dt * 1.3));
  // (the Guide leans on a planted staff: no weight shift, or the fist drifts off it)
  const grip = root.userData.staffGrip as { arm: number; elbow: number } | undefined;
  const ws = grip ? 0 : s.shift * idle; // +1 → weight on the right leg
  P[LL_X] = 0.06 * Math.max(0, ws);
  P[LR_X] = 0.06 * Math.max(0, -ws);
  P[KL] = -(0.2 * Math.max(0, ws) + 0.05);
  P[KR] = -(0.2 * Math.max(0, -ws) + 0.05);
  P[LL_Z] = -0.02;
  P[LR_Z] = 0.02;
  P[AK_L] = 0;
  P[AK_R] = 0;
  // Pelvis: sways over the stance foot, rolls down on the swing side, yaws with the stride
  const walkSway = 1 - 0.6 * run;
  P[H_X] = 0.024 * cL * mw * walkSway + 0.03 * ws;
  P[H_Z] = 0;
  P[H_DROP] = 0;
  P[H_ROLL] = 0.04 * cL * mw * walkSway + 0.045 * ws;
  // Sidestepping: the pelvis (and the robe on it) turns toward the travel so the
  // legs stride in their own plane instead of swinging out sideways; the chest
  // counter-turns and keeps facing the aim. Backpedalling folds to a small turn.
  let trav = Math.atan2(g.dxr, -g.dzr);
  if (trav > Math.PI / 2) trav -= Math.PI;
  else if (trav < -Math.PI / 2) trav += Math.PI;
  const moveW = mw * smoothstep(0.15, 0.6, sp);
  s.hipTurn += (-clamp(trav, -0.9, 0.9) * 0.9 * moveW - s.hipTurn) * (1 - Math.exp(-dt * 12));
  P[H_YAW] = -0.1 * sL * mw + s.hipTurn;
  // Bank into turns (centripetal) with the whole body, lean with acceleration
  const bank = clamp(-aL * 0.0065, -0.2, 0.2) * mw;
  const lean = clamp(-aF * 0.009, -0.26, 0.2);
  P[H_PITCH] = lean * 0.3;
  P[T_X] = -(0.04 + 0.14 * run) * mw + lean * 0.7 + breath * 0.018 * (1 - mw * 0.7);
  // Chest leads a turn; the Guide keeps its torso square to the staff (head only)
  const lead = clamp(s.yawRate * 0.045, -0.32, 0.32);
  P[T_Y] = (0.2 + 0.08 * run) * sL * mw + (grip ? 0 : lead) - s.hipTurn;
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
  // caller-clocked swing (local hero): pin the timeline to its progress
  if (opts.swingU != null) {
    if (opts.swingU < 0 || opts.swingU >= 1) s.swingT0 = -1;
    else if (s.swingT0 >= 0) s.swingT0 = tMs - opts.swingU * s.swingDur;
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
    if (e < DEATH_KNEEL_S) lerpKey(s.tmp, s.deathEntry, DEATH_KNEEL, out, easeOut(e / DEATH_KNEEL_S));
    else if (e < DEATH_FALL_S)
      lerpKeys(s.tmp, DEATH_KNEEL, DEATH_FALL, out, easeInOut((e - DEATH_KNEEL_S) / (DEATH_FALL_S - DEATH_KNEEL_S)));
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

  // —— feet: world-locked stance / swing arcs / steps, legs solved by IK ——
  const legsFree = s.deathT0 >= 0 || s.reviveT0 >= 0 || s.dashT0 >= 0;
  const hipsY = solveFeet(root, s, out, gaitOn, legsFree, jumped, tMs, breath * 0.006 * idle, dt);

  s.prev.set(out);
  // wind on the cloth, in the body frame (forward / right)
  const wX = opts.windX ?? 0;
  const wZ = opts.windZ ?? 0;
  _windF = wX * fx + wZ * fz;
  _windL = wX * rx + wZ * rz;
  applyPose(s, out, hipsY, mw, run, vF, vL, aF, dt, t, ph);
}

/** Cloth wind for the pose being applied (body frame; set just before applyPose). */
let _windF = 0;
let _windL = 0;

/** Write the channel pose to the bones (hips height from the foot solver) and drive the cloth. */
function applyPose(
  s: HumState,
  o: Float32Array,
  hipsY: number,
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
  // Soles level with the ground (cancel hips + thigh + shin pitch and the side
  // tilt), plus the solver's roll: heel strike toe-up, push-off onto the ball
  if (J.ankleL) J.ankleL.rotation.set(-(o[H_PITCH]! + o[LL_X]! + o[KL]!) + o[AK_L]!, s.feet[0].yo, -(o[H_ROLL]! + o[LL_Z]!));
  if (J.ankleR) J.ankleR.rotation.set(-(o[H_PITCH]! + o[LR_X]! + o[KR]!) + o[AK_R]!, s.feet[1].yo, -(o[H_ROLL]! + o[LR_Z]!));
  if (J.head) J.head.rotation.set(o[HD_X]!, o[HD_Y]!, 0);
  if (J.hood) J.hood.rotation.x = Math.sin(t * 1.85) * 0.012;

  // —— cloth ——
  if (dt > 0) {
    const bodyPitch = o[H_PITCH]! + o[T_X]!;
    // Cape: trails with forward speed, swings forward on a stop (spring overshoot),
    // sways against sideways motion; the chain below lags for a whip.
    // (a headwind lifts the cape back, a tailwind throws it forward, a crosswind aside)
    const windMag = Math.min(1.5, Math.hypot(_windF, _windL));
    const liftT =
      clamp(-(0.05 + 0.07 * Math.max(0, vF) + 0.025 * Math.abs(vL)) + _windF * 0.55, -1.05, 0.26) - bodyPitch * 0.75;
    stepSpring(s.capeX, liftT, 10, 0.42, dt);
    stepSpring(s.capeZ, clamp(-vL * 0.045 + _windL * 0.4, -0.55, 0.55), 9, 0.4, dt);
    stepSpring(s.capeY, clamp(-s.yawRate * 0.03, -0.3, 0.3), 9, 0.5, dt);
    const flutter =
      Math.sin(ph * 2 + 0.8) * 0.07 * mw * (0.4 + run) +
      Math.sin(t * 1.35) * 0.02 * idle +
      Math.sin(t * 13.7) * 0.07 * windMag;
    stepSpring(s.capeMid, s.capeX.x * 0.35 + flutter, 8, 0.35, dt);
    stepSpring(s.capeHem, s.capeX.x * 0.3 + flutter * 1.3, 6.5, 0.3, dt);
    s.capeX.x = clamp(s.capeX.x, -1.35, 0.28);
    // Robe: bell swings forward when braking, trails when running
    stepSpring(s.robe, clamp(-aF * 0.01 - vF * 0.012, -0.3, 0.32), 9, 0.32, dt);
    stepSpring(s.robeZ, clamp(-vL * 0.02, -0.2, 0.2), 8, 0.35, dt);
  }
  if (J.cloak) {
    J.cloak.rotation.set(s.capeX.x * 0.55, s.capeY.x, s.capeZ.x * 0.6);
  }
  if (J.cloakMid) J.cloakMid.rotation.set(s.capeX.x * 0.25 + s.capeMid.x * 0.55, 0, s.capeZ.x * 0.25);
  if (J.cloakHem) J.cloakHem.rotation.set(s.capeX.x * 0.2 + s.capeHem.x * 0.5, 0, s.capeZ.x * 0.2);
  // Robe panels: pushed out just far enough to clear the knees and shins (the
  // cloth drapes over the legs instead of riding the thighs like a bell), the
  // lower half hangs back toward vertical, springs add the swing
  // [upper, lower] × [left, right] × [front, back]
  const R = _robe;
  for (let i = 0; i < 2; i++) {
    const a = o[i === 0 ? LL_X : LR_X]!;
    const k = o[i === 0 ? KL : KR]!;
    const c = o[i === 0 ? LL_Z : LR_Z]!;
    const ls = i === 0 ? -1 : 1;
    skirtNeed(a, k, c, ls, 1);
    R[i * 4] = _skirt[0]!;
    R[i * 4 + 1] = _skirt[1]!;
    skirtNeed(a, k, c, ls, -1);
    R[i * 4 + 2] = _skirt[0]!;
    R[i * 4 + 3] = _skirt[1]!;
  }
  for (let i = 0; i < 2; i++) {
    // continuous cloth: a panel pushed out drags its neighbour across the
    // centre seam part of the way (no leg showing through the seam)
    const j = (1 - i) * 4;
    const upF = Math.max(R[i * 4]!, R[j]! * ROBE_COUPLE);
    const loF = upF === R[i * 4]! ? R[i * 4 + 1]! : Math.max(R[i * 4 + 1]!, R[j + 1]!);
    const upB = Math.max(R[i * 4 + 2]!, R[j + 2]! * ROBE_COUPLE);
    const loB = upB === R[i * 4 + 2]! ? R[i * 4 + 3]! : Math.max(R[i * 4 + 3]!, R[j + 3]!);
    const ap = J.apron[i];
    const aph = J.apronHem[i];
    const tb = J.tabard[i];
    const tbh = J.tabardHem[i];
    // springs swing the cloth out freely, but never back into a leg
    const sw = s.robe.x;
    if (ap) ap.rotation.set(Math.max(upF, upF * 0.3 + sw * 0.4 - o[H_PITCH]! * 0.5), 0, s.robeZ.x);
    if (aph) aph.rotation.set(loF + Math.max(0, sw) * 0.6 + Math.min(0, sw) * 0.2, 0, s.robeZ.x * 0.6);
    if (tb) tb.rotation.set(Math.min(-upB, -upB * 0.3 - 0.04 * run * mw + sw * 0.3 - o[H_PITCH]! * 0.5), 0, s.robeZ.x);
    if (tbh) tbh.rotation.set(-loB + Math.min(0, sw) * 0.5 + Math.max(0, sw) * 0.15 - 0.05 * run * mw, 0, s.robeZ.x * 0.6);
  }
}

const _robe = new Float64Array(8);
const ROBE_COUPLE = 0.55;

// Robe skirt (hero.ts): top at 1.035 in the hips frame, 0.68 long, the panel
// joint 0.34 down. Over the legs (x ≈ ±0.1) the front/back surface sits about
// 0.83 × R(v) from the axis.
const SKIRT_TOP = 1.035;
const SKIRT_L = 0.68;
const PANEL = 0.34;
/** Robe skirt radius at a depth below the belt (hero.ts: an ellipse 1.14 × 0.94 of it). */
const skirtR = (depth: number) => 0.17 + 0.115 * Math.pow(clamp(depth / SKIRT_L, 0, 1), 1.15);
const _skirt = new Float64Array(2);
const _low = new Float64Array(32);
/** (thigh fraction | 1 + shin fraction, limb radius + room) sample points along a leg */
const LEG_PTS = [0.5, 0.092, 0.8, 0.085, 1, 0.08, 1.35, 0.076, 1.7, 0.068, 2, 0.062];
/**
 * Panel angles (upper about the belt, lower relative to it) that keep a leg's
 * robe panel in front of (side 1) / behind (side −1) it: thigh, knee, shin,
 * ankle and where the shin crosses the hem, wherever the leg is spread to
 * (the skirt is an ellipse, and a panel swings its flank less). Positive = out.
 */
function skirtNeed(a: number, k: number, c: number, legSide: number, side: number) {
  let up = 0;
  let nLow = 0;
  const hemY = SKIRT_TOP - SKIRT_L;
  const test = (x: number, y: number, f: number, m: number) => {
    const d = SKIRT_TOP - y;
    if (d < 0.05 || d > SKIRT_L + 0.02) return;
    const r = skirtR(d);
    const ax = 1.14 * r;
    const q = clamp(Math.abs(x) / ax, 0, 0.97);
    // cloth surface in front of / behind this point, and how much of the
    // panel joint's swing reaches that far round the skirt
    const surf = 0.94 * r * Math.sqrt(1 - q * q);
    // (and near the centre seam the neighbour panel, dragged at ROBE_COUPLE, shares it)
    const share = smoothstep(-0.12, 0.12, x * legSide);
    const w = Math.pow(surf / Math.hypot(surf, Math.abs(x)), 1.3) * (share + (1 - share) * ROBE_COUPLE);
    const need = (f * side + m - surf) / Math.max(0.35, w);
    if (need <= 0) return;
    const rigid = Math.asin(clamp(need / d, 0, 0.8));
    if (d <= PANEL) up = Math.max(up, rigid);
    else {
      // just under the panel joint it is the upper panel's job; toward the hem
      // the lower one takes over
      up = Math.max(up, rigid * clamp(1 - ((d - PANEL - 0.06) / (SKIRT_L - PANEL)) * 0.8, 0.35, 1));
      if (nLow < 32) {
        _low[nLow++] = d;
        _low[nLow++] = need;
      }
    }
  };
  {
    // leg in the hips frame (thigh pitch a, spread c, knee k), forward = +f
    const px = HIP_X * legSide;
    const cc = Math.cos(c);
    const kneeX = px + L1 * Math.sin(c);
    const kneeY = HIP_Y - L1 * cc * Math.cos(a);
    const kneeF = L1 * cc * Math.sin(a);
    const A = L1 + L2 * Math.cos(k);
    const B = -L2 * Math.sin(k);
    const ankX = px + A * Math.sin(c);
    const ankY = HIP_Y - A * cc * Math.cos(a) - B * Math.sin(a);
    const ankF = A * cc * Math.sin(a) - B * Math.cos(a);
    for (let j = 0; j < LEG_PTS.length; j += 2) {
      const u = LEG_PTS[j]!;
      const m = LEG_PTS[j + 1]!;
      if (u <= 1) test(px + (kneeX - px) * u, HIP_Y + (kneeY - HIP_Y) * u, kneeF * u, m);
      else {
        const v = u - 1;
        test(kneeX + (ankX - kneeX) * v, kneeY + (ankY - kneeY) * v, kneeF + (ankF - kneeF) * v, m);
      }
    }
    // where the lower leg crosses the hem line
    if ((kneeY - hemY) * (ankY - hemY) < 0) {
      const t = (kneeY - hemY) / (kneeY - ankY);
      test(kneeX + (ankX - kneeX) * t, hemY + 1e-3, kneeF + (ankF - kneeF) * t, 0.06);
    }
  }
  // lower panel: hangs back toward vertical unless a shin pushes it out
  const s1 = PANEL * Math.sin(up);
  let low = -up * 0.45;
  for (let j = 0; j < nLow; j += 2) {
    const d = _low[j]!;
    const need = _low[j + 1]!;
    low = Math.max(low, Math.asin(clamp((need - s1) / Math.max(0.07, d - PANEL), -0.9, 0.9)) - up);
  }
  low = Math.min(low, 0.8);
  _skirt[0] = up;
  _skirt[1] = low;
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
