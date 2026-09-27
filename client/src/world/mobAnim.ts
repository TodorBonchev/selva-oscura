/**
 * Mob and boss body language, layered on the idle spin/bob in anim.ts:
 *  - facing: turn toward the direction of travel at a turn rate; toward the target only
 *    while attacking or in melee (no snapping to the local player every frame),
 *  - locomotion: lean into speed and acceleration, bank into turns, hover-bob,
 *  - attacks: a windup → strike → recover pose driven by the server telegraph
 *    (attackerId, duration), per attack kind — see ATTACK_POSES / registerAttackPose,
 *  - flinch: tilt + slide away from the hitter, decaying in ~150 ms,
 *  - death: an archetype-flavoured collapse (unravel, pop, topple) before disposal.
 *
 * rigMob() wraps everything that should lean/bob (not the ground shadow or rings) in a
 * "mobBody" group at spawn and caches the parts poses touch (shade shoulder pivots,
 * Maw heads/jaws, ribbons). All state lives on root.userData.mob; nothing allocates per
 * frame.
 */
import * as THREE from "three";
import { yawFromPlanar } from "./frames";

export type MobFamily = "shade" | "wisp" | "champion" | "brute" | "heart" | "judge" | "maw" | "crush";

export type MobState = {
  family: MobFamily;
  body: THREE.Object3D;
  armL: THREE.Object3D | null;
  armR: THREE.Object3D | null;
  armRest: [number, number, number, number];
  heads: THREE.Object3D[];
  headRest: number[];
  headY: number[];
  jaws: THREE.Object3D[];
  ribbons: THREE.Object3D[];
  shadow: THREE.Object3D | null;
  /** The body's biggest mesh: the hit-flash shell borrows its geometry. */
  flashMesh: THREE.Mesh | null;
  /** world height of the model (flash / burst sizing) */
  height: number;
  turn: number;
  topSpeed: number;
  leanAmt: number;
  bobAmp: number;
  bobPh: number;
  yaw: number;
  yawInit: boolean;
  lean: number;
  bank: number;
  lastSpeed: number;
  // attack (telegraph-driven)
  atkKind: string;
  atkStart: number;
  atkDur: number;
  atkDir: number;
  atkActive: boolean;
  atkCancelled: boolean;
  // flinch
  flAt: number;
  flF: number;
  flR: number;
  flAmp: number;
  // death
  dying: boolean;
  deathStart: number;
  deathDur: number;
  deathStyle: "unravel" | "pop" | "topple" | "crumble";
  deathF: number;
  deathR: number;
  /** body yaw when the collapse began (the unravel spin is measured from it) */
  deathYaw0: number;
};

/** Pose deltas an attack writes each frame (composed with locomotion + flinch). */
export type Pose = {
  rx: number;
  ry: number;
  rz: number;
  y: number;
  fz: number;
  sx: number;
  sy: number;
  sz: number;
  /** absolute shoulder pivot rotations (NaN = rest) */
  aLx: number;
  aLz: number;
  aRx: number;
  aRz: number;
  /** Maw heads: extra pitch; jaws: extra gape */
  head: number;
  jaw: number;
};

/**
 * u: windup progress 0..1 (1 once it lands), r: recovery 0..1 after landing (0 during
 * the windup), st: the mob (family, arms, …). Write deltas into `out` (pre-cleared).
 */
export type PoseFn = (u: number, r: number, st: MobState, out: Pose) => void;

const RECOVER_MS = 360;
const STAGGER_MS = 420;

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) * (1 - t));
/** strike 0..STRIKE of recovery snaps in; the rest eases back to rest */
const STRIKE = 0.32;

function strikeK(r: number): number {
  return r <= 0 ? 0 : r < STRIKE ? easeOut(r / STRIKE) : 1 - ease((r - STRIKE) / (1 - STRIKE));
}
function windK(u: number, r: number): number {
  // windup builds, then drains through the strike
  return r > 0 ? Math.max(0, 1 - r / (STRIKE * 0.6)) : ease(u);
}

function arms(st: MobState, out: Pose, wx: number, wz: number, sx: number, sz: number, w: number, s: number) {
  if (!st.armL) return;
  const ar = st.armRest;
  const lx = ar[0];
  const lz = ar[1];
  const rx = ar[2];
  const rz = ar[3];
  out.aLx = lx + (wx - lx) * w + (sx - lx) * s;
  out.aRx = rx + (wx - rx) * w + (sx - rx) * s;
  out.aLz = lz + (-Math.abs(wz) - lz) * w + (Math.abs(sz) - lz) * s;
  out.aRz = rz + (Math.abs(wz) - rz) * w + (-Math.abs(sz) - rz) * s;
}

/** Shade claw swipe: arms up and back, then a raking cut across the front. */
const swipe: PoseFn = (u, r, st, out) => {
  const w = windK(u, r);
  const s = strikeK(r);
  out.rx = 0.2 * w - 0.34 * s;
  out.y = 0.12 * w - 0.04 * s;
  out.fz = 0.3 * s;
  arms(st, out, -2.35, 0.7, 1.3, 0.45, w, s);
};

/** Wisp dart: coil (squash, lean back), then stretch forward into the lunge. */
const dart: PoseFn = (u, r, st, out) => {
  const w = windK(u, r);
  const s = strikeK(r);
  out.sy = 1 - 0.3 * w + 0.1 * s;
  out.sx = 1 + 0.18 * w - 0.12 * s;
  out.sz = 1 + 0.18 * w + 0.4 * s;
  out.rx = 0.32 * w - 0.4 * s;
  out.y = -0.08 * w;
  arms(st, out, -0.4, 1.0, 1.6, 0.2, w, s);
};

/** Champion / warden slam: rise and rear back with arms high, then crash down. */
const slam: PoseFn = (u, r, st, out) => {
  const w = windK(u, r);
  const s = strikeK(r);
  out.rx = 0.26 * w - 0.38 * s;
  out.y = 0.32 * w - 0.12 * s;
  out.sy = 1 + 0.05 * w - 0.08 * s;
  out.fz = 0.2 * s;
  arms(st, out, -2.7, 0.35, 1.5, 0.15, w, s);
};

/** Lust champion cleave: wind the body back, then sweep across. */
const cleave: PoseFn = (u, r, st, out) => {
  const w = windK(u, r);
  const s = strikeK(r);
  out.ry = 0.65 * w - 0.8 * s;
  out.rx = 0.12 * w - 0.22 * s;
  out.y = 0.1 * w;
  arms(st, out, -1.6, 1.1, 1.1, 0.9, w, s);
};

/** Judge: rears up to full height, then the slam bows him forward. */
const judge: PoseFn = (u, r, _st, out) => {
  const w = windK(u, r);
  const s = strikeK(r);
  out.rx = 0.2 * w - 0.3 * s;
  out.y = 0.42 * w - 0.08 * s;
  out.sy = 1 + 0.04 * w;
};

/** Triple Maw: heads rear and jaws gape, then all three snap down. */
const maw: PoseFn = (u, r, _st, out) => {
  const w = windK(u, r);
  const s = strikeK(r);
  out.head = -0.65 * w + 0.5 * s;
  out.jaw = 0.5 * w - 0.2 * s;
  out.rx = 0.12 * w - 0.22 * s;
  out.y = 0.18 * w - 0.06 * s;
};

/** Hoard Crush: heaves its bulk up, then drops the weight (squash on impact). */
const crush: PoseFn = (u, r, _st, out) => {
  const w = windK(u, r);
  const s = strikeK(r);
  out.y = 0.62 * w - 0.18 * s;
  out.rx = 0.16 * w - 0.14 * s;
  out.sy = 1 + 0.04 * w - 0.1 * s;
  out.sx = 1 - 0.02 * w + 0.07 * s;
  out.sz = out.sx;
};

/** Interrupted windup: the foe reels back (the poise break reads). */
const stagger: PoseFn = (_u, r, st, out) => {
  const k = Math.sin(Math.min(1, r) * Math.PI) * (1 - r * 0.4);
  out.rx = 0.32 * k;
  out.rz = 0.1 * k;
  out.fz = -0.25 * k;
  arms(st, out, -0.6, 1.1, 0, 0, k, 0);
};

/** Attack poses by pose name; telegraph kinds map onto them in poseFor(). */
export const ATTACK_POSES: Record<string, PoseFn> = { swipe, dart, slam, cleave, judge, maw, crush, stagger };

const KIND_POSE: Record<string, string> = {
  shade_swipe: "swipe",
  wisp_dart: "dart",
  champ_slam: "slam",
  champ_cleave: "cleave",
};

/**
 * Wave-3 hook: a canto boss pattern plugs its own pose for its own telegraph kind
 * (e.g. registerAttackPose("maw_bite_left", fn)).
 */
export function registerAttackPose(teleKind: string, fn: PoseFn) {
  ATTACK_POSES[`kind:${teleKind}`] = fn;
}

function poseFor(kind: string, st: MobState): PoseFn {
  const custom = ATTACK_POSES[`kind:${kind}`];
  if (custom) return custom;
  if (kind === "stagger") return stagger;
  if (st.family === "judge") return judge;
  if (st.family === "maw") return maw;
  if (st.family === "crush") return crush;
  const name = KIND_POSE[kind];
  if (name && ATTACK_POSES[name]) return ATTACK_POSES[name]!;
  if (st.family === "wisp") return dart;
  if (st.family === "shade") return swipe;
  return slam;
}

const RIG_SKIP = new Set(["discShadow", "wardRing", "stillRing", "judgeAura", "mawTelegraph", "cwTelegraph"]);
const _box = new THREE.Box3();
const _size = new THREE.Vector3();

/** Wrap a freshly built mob/boss for posing (call before its label is attached). */
export function rigMob(root: THREE.Group, family: MobFamily): MobState {
  const body = new THREE.Group();
  body.name = "mobBody";
  for (const c of [...root.children]) {
    if (RIG_SKIP.has(c.name) || (c as { isCSS2DObject?: boolean }).isCSS2DObject) continue;
    body.add(c);
  }
  root.add(body);
  let armL: THREE.Object3D | null = null;
  let armR: THREE.Object3D | null = null;
  const heads: THREE.Object3D[] = [];
  const jaws: THREE.Object3D[] = [];
  const ribbons: THREE.Object3D[] = [];
  let flashMesh: THREE.Mesh | null = null;
  let flashR = 0;
  body.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry && !(m.material as THREE.Material).transparent) {
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const r = (m.geometry.boundingSphere?.radius ?? 0) * m.scale.x;
      if (r > flashR) {
        flashR = r;
        flashMesh = m;
      }
    }
    if (o.name === "armPivotL") armL = o;
    else if (o.name === "armPivotR") armR = o;
    else if (o.name === "mawHead") heads.push(o);
    else if (o.name === "mawJaw") jaws.push(o);
    else if (o.name === "ribbon" || o.name === "ribbon2") ribbons.push(o);
  });
  const aL = armL as THREE.Object3D | null;
  const aR = armR as THREE.Object3D | null;
  root.updateMatrixWorld(true);
  _box.setFromObject(body);
  _box.getSize(_size);
  const height = Math.max(0.6, Number.isFinite(_size.y) ? _size.y : 2);
  const f = family;
  const st: MobState = {
    family: f,
    body,
    armL: aL,
    armR: aR,
    armRest: [aL?.rotation.x ?? 0, aL?.rotation.z ?? 0, aR?.rotation.x ?? 0, aR?.rotation.z ?? 0],
    heads,
    headRest: heads.map((h) => h.rotation.x),
    headY: heads.map((h) => h.position.y),
    jaws,
    ribbons,
    shadow: root.getObjectByName("discShadow") ?? null,
    flashMesh,
    height,
    turn: f === "wisp" ? 11 : f === "shade" ? 7 : f === "champion" ? 4.5 : f === "brute" ? 3.4 : 2.4,
    topSpeed: f === "wisp" ? 5.4 : f === "judge" || f === "maw" || f === "crush" ? 2.2 : 3,
    leanAmt: f === "wisp" ? 0.3 : f === "shade" ? 0.22 : f === "champion" ? 0.13 : f === "brute" ? 0.08 : 0.05,
    bobAmp: f === "wisp" ? 0.09 : f === "shade" ? 0.07 : f === "champion" ? 0.035 : f === "heart" ? 0 : 0.03,
    bobPh: Math.random() * Math.PI * 2,
    yaw: 0,
    yawInit: false,
    lean: 0,
    bank: 0,
    lastSpeed: 0,
    atkKind: "",
    atkStart: 0,
    atkDur: 1,
    atkDir: 0,
    atkActive: false,
    atkCancelled: false,
    flAt: -1e9,
    flF: 0,
    flR: 0,
    flAmp: 0,
    dying: false,
    deathStart: 0,
    deathDur: 1,
    deathStyle: "unravel",
    deathF: 0,
    deathR: 0,
    deathYaw0: 0,
  };
  root.userData.mob = st;
  return st;
}

/** A telegraph from this mob started: play its windup → strike on the same clock. */
export function mobAttack(st: MobState, kind: string, dir: number, durMs: number, nowMs: number) {
  st.atkKind = kind;
  st.atkStart = nowMs;
  st.atkDur = Math.max(60, durMs);
  st.atkDir = dir;
  st.atkActive = true;
  st.atkCancelled = false;
}

/** The server broke the windup (poise / stagger / bell): reel instead of striking. */
export function mobAttackCancel(st: MobState, nowMs: number) {
  if (!st.atkActive) return;
  st.atkKind = "stagger";
  st.atkStart = nowMs - 1;
  st.atkDur = 1;
  st.atkCancelled = true;
}

/** A blow from planar direction (fromX, fromY) = hitter − mob. amp 1 normal, ~1.7 heavy. */
export function mobFlinch(st: MobState, fromX: number, fromY: number, amp: number, nowMs: number) {
  const l = Math.hypot(fromX, fromY) || 1;
  // away from the hitter, in the body's frame (forward = −z)
  const ax = -fromX / l;
  const ay = -fromY / l;
  const s = Math.sin(st.yaw);
  const c = Math.cos(st.yaw);
  st.flF = ax * -s + ay * -c;
  st.flR = ax * c + ay * -s;
  st.flAt = nowMs;
  const weight =
    st.family === "heart" ? 0.2 : st.family === "judge" || st.family === "maw" || st.family === "crush" ? 0.35 : st.family === "brute" || st.family === "champion" ? 0.6 : 1;
  st.flAmp = Math.min(2.2, amp * weight);
}

const pose: Pose = { rx: 0, ry: 0, rz: 0, y: 0, fz: 0, sx: 1, sy: 1, sz: 1, aLx: NaN, aLz: NaN, aRx: NaN, aRz: NaN, head: 0, jaw: 0 };

function clearPose() {
  pose.rx = pose.ry = pose.rz = pose.y = pose.fz = 0;
  pose.sx = pose.sy = pose.sz = 1;
  pose.aLx = pose.aLz = pose.aRx = pose.aRz = NaN;
  pose.head = pose.jaw = 0;
}

function wrapA(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Per frame. (vx, vy): planar render velocity (u/s). face: planar direction to a
 * target in melee (or null). detail false = far away: facing only.
 */
export function tickMob(
  root: THREE.Object3D,
  st: MobState,
  dt: number,
  nowMs: number,
  vx: number,
  vy: number,
  faceX: number,
  faceY: number,
  hasFace: boolean,
  detail: boolean
) {
  if (st.dying) return;
  const speed = Math.hypot(vx, vy);
  // — facing —
  let want = st.yaw;
  let rate = st.turn;
  const atkE = nowMs - st.atkStart;
  const atkTotal = st.atkDur + (st.atkCancelled ? STAGGER_MS : RECOVER_MS);
  if (st.atkActive && atkE > atkTotal) st.atkActive = false;
  if (st.atkActive && !st.atkCancelled) {
    want = yawFromPlanar(Math.cos(st.atkDir), Math.sin(st.atkDir));
    rate = Math.max(rate * 2.5, 10);
  } else if (speed > 0.35) {
    want = yawFromPlanar(vx, vy);
  } else if (hasFace) {
    want = yawFromPlanar(faceX, faceY);
  }
  if (!st.yawInit) {
    st.yaw = want;
    st.yawInit = true;
  }
  const diff = wrapA(want - st.yaw);
  const step = Math.max(-rate * dt, Math.min(rate * dt, diff * Math.min(1, dt * 14)));
  st.yaw = wrapA(st.yaw + step);
  root.rotation.y = st.yaw;
  if (!detail) return;

  // — locomotion: lean into speed and acceleration, bank into the turn —
  const accel = dt > 0 ? (speed - st.lastSpeed) / dt : 0;
  st.lastSpeed = speed;
  const leanT = Math.min(1.2, speed / st.topSpeed) * st.leanAmt + Math.max(-0.08, Math.min(0.08, accel * 0.012));
  const k = 1 - Math.exp(-dt * 8);
  st.lean += (leanT - st.lean) * k;
  const yawRate = dt > 0 ? step / dt : 0;
  const bankT = Math.max(-0.2, Math.min(0.2, -yawRate * Math.min(1, speed / st.topSpeed) * 0.08));
  st.bank += (bankT - st.bank) * k;
  const t = nowMs * 0.001;
  const bob = st.bobAmp * Math.sin(t * (st.family === "wisp" ? 7.5 : 5.2) * (1 + speed * 0.06) + st.bobPh);

  // — attack pose —
  clearPose();
  if (st.atkActive) {
    const u = Math.min(1, atkE / st.atkDur);
    const r = atkE <= st.atkDur ? 0 : Math.min(1, (atkE - st.atkDur) / (st.atkCancelled ? STAGGER_MS : RECOVER_MS));
    poseFor(st.atkKind, st)(u, r, st, pose);
  }

  // — flinch: tilt + slide away from the hitter —
  const fe = (nowMs - st.flAt) / 1000;
  let fk = 0;
  if (fe >= 0 && fe < 0.5) fk = st.flAmp * Math.min(1, fe * 70) * Math.exp(-fe * 13);

  const b = st.body;
  b.rotation.set(-st.lean + pose.rx - st.flF * 0.32 * fk, pose.ry, st.bank + pose.rz - st.flR * 0.32 * fk);
  b.position.set(st.flR * 0.2 * fk, bob + pose.y, -pose.fz - st.flF * 0.2 * fk);
  b.scale.set(pose.sx, pose.sy, pose.sz);
  if (st.armL && st.armR) {
    const ar = st.armRest;
    const lx = ar[0];
    const lz = ar[1];
    const rx = ar[2];
    const rz = ar[3];
    // idle: slow claw sway so the arms never freeze
    const sway = Math.sin(t * 2.3 + st.bobPh) * 0.08;
    st.armL.rotation.x = Number.isNaN(pose.aLx) ? lx + sway + st.lean * 0.8 : pose.aLx;
    st.armL.rotation.z = Number.isNaN(pose.aLz) ? lz - sway * 0.5 : pose.aLz;
    st.armR.rotation.x = Number.isNaN(pose.aRx) ? rx - sway + st.lean * 0.8 : pose.aRx;
    st.armR.rotation.z = Number.isNaN(pose.aRz) ? rz - sway * 0.5 : pose.aRz;
  }
  for (let i = 0; i < st.heads.length; i++) {
    const h = st.heads[i]!;
    const ph = i * 1.7;
    h.rotation.x = st.headRest[i]! + Math.sin(t * 1.6 + ph) * 0.07 + pose.head * (i === 0 ? 1 : 0.85);
    h.position.y = st.headY[i]! + Math.sin(t * 1.3 + ph) * 0.04;
  }
  for (let i = 0; i < st.jaws.length; i++) {
    st.jaws[i]!.rotation.x = 1.85 + Math.sin(t * 3.1 + i + 0.4) * 0.12 + pose.jaw;
  }
}

/**
 * Start the death collapse. (awayX, awayY): planar direction the body falls (away
 * from the killer). Returns the duration (ms).
 */
export function mobDeath(st: MobState, awayX: number, awayY: number, nowMs: number): number {
  st.dying = true;
  st.deathStart = nowMs;
  const f = st.family;
  st.deathStyle = f === "wisp" ? "pop" : f === "shade" ? "unravel" : f === "heart" ? "crumble" : "topple";
  st.deathDur = f === "wisp" ? 450 : f === "shade" ? 620 : f === "heart" ? 650 : f === "judge" || f === "maw" || f === "crush" ? 1150 : 720;
  const l = Math.hypot(awayX, awayY) || 1;
  const s = Math.sin(st.yaw);
  const c = Math.cos(st.yaw);
  const ax = awayX / l;
  const ay = awayY / l;
  st.deathF = ax * -s + ay * -c;
  st.deathR = ax * c + ay * -s;
  st.deathYaw0 = st.body.rotation.y;
  return st.deathDur;
}

/** Unravel: total spin (rad) over the collapse, gathering speed as it comes apart. */
const UNRAVEL_SPIN = 10;
/** ∫₀ᵘ ease — the closed form of the smoothstep's integral (so the spin is per time, not per frame) */
const easeInt = (u: number) => u * u * u - (u * u * u * u) / 2;

/** Advance a dying mob; returns true once the collapse is over (dispose it). */
export function tickMobDeath(root: THREE.Object3D, st: MobState, nowMs: number): boolean {
  const u = Math.min(1, (nowMs - st.deathStart) / st.deathDur);
  const b = st.body;
  switch (st.deathStyle) {
    case "pop": {
      // swell, then burst into nothing (the ash burst carries the read)
      const s = u < 0.3 ? 1 + 0.55 * easeOut(u / 0.3) : Math.max(0.001, 1.55 * (1 - ease((u - 0.3) / 0.7)));
      b.scale.set(s, s * (u < 0.3 ? 1 : 0.8), s);
      b.position.y = 0.15 * u;
      break;
    }
    case "unravel": {
      // the wraith spins apart and sinks into the ground; its ribbons fly loose
      const e = ease(u);
      // angular speed ∝ 0.25 + 0.35·ease(u), integrated in closed form
      b.rotation.y = st.deathYaw0 + (UNRAVEL_SPIN * (0.25 * u + 0.35 * easeInt(u))) / 0.425;
      b.rotation.x = -0.2 * e;
      b.position.y = -1.4 * e * e;
      b.scale.set(1 + 0.35 * e, Math.max(0.05, 1 - 0.8 * e), 1 + 0.35 * e);
      for (const r of st.ribbons) r.scale.setScalar(1 + e * 1.8);
      if (st.armL && st.armR) {
        st.armL.rotation.x = st.armRest[0] - 2.2 * e;
        st.armR.rotation.x = st.armRest[2] - 2.2 * e;
      }
      break;
    }
    case "crumble": {
      const e = ease(u);
      b.position.y = -Math.max(1.6, st.height * 0.7) * e;
      const fade = u > 0.8 ? Math.max(0.001, 1 - ease((u - 0.8) / 0.2)) : 1;
      b.scale.set((1 + 0.15 * e) * fade, Math.max(0.05, 1 - 0.6 * e) * fade, (1 + 0.15 * e) * fade);
      b.rotation.z = Math.sin(u * 40) * 0.03 * (1 - u);
      break;
    }
    default: {
      // topple away from the killer, then settle into the ground (sink by its size —
      // a boss lies taller than a champion) and shrink away, so nothing pops at dispose
      const fall = easeOut(Math.min(1, u / 0.7));
      const ang = fall * 1.45;
      b.rotation.set(-st.deathF * ang, 0, -st.deathR * ang);
      const bounce = u > 0.55 && u < 0.75 ? Math.sin(((u - 0.55) / 0.2) * Math.PI) * 0.06 : 0;
      const sink = Math.max(0.7, st.height * 0.55);
      b.position.set(0, bounce - ease(Math.max(0, (u - 0.66) / 0.34)) * sink, 0);
      const fade = u > 0.76 ? Math.max(0.001, 1 - ease((u - 0.76) / 0.24)) : 1;
      b.scale.set(fade, fade, fade);
    }
  }
  if (st.shadow) st.shadow.scale.setScalar(Math.max(0.01, 1 - u));
  return u >= 1;
}
