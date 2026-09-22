/**
 * Procedural humanoid motion. Joints are named Object3Ds on the wanderer rig
 * (hips, torso, cloak, tabard, hood, legL/R, kneeL/R, armL/R, elbowL/R, weapon).
 * Local forward is −z: thigh swing is negated so the stride plants toward the nose.
 */
import * as THREE from "three";

type HumJoints = {
  hips?: THREE.Object3D;
  torso?: THREE.Object3D;
  cloak?: THREE.Object3D;
  tabard?: THREE.Object3D;
  legL?: THREE.Object3D;
  legR?: THREE.Object3D;
  kneeL?: THREE.Object3D;
  kneeR?: THREE.Object3D;
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  elbowL?: THREE.Object3D;
  elbowR?: THREE.Object3D;
  weapon?: THREE.Object3D;
  hood?: THREE.Object3D;
};

type MawCache = {
  ribbon?: THREE.Object3D;
  ribbon2?: THREE.Object3D;
  tele?: THREE.Object3D;
  heads: THREE.Object3D[];
  jaws: THREE.Object3D[];
};

function jointsOf(root: THREE.Object3D): HumJoints {
  let j = root.userData.humJoints as HumJoints | undefined;
  if (!j) {
    j = {
      hips: root.getObjectByName("hips") ?? undefined,
      torso: root.getObjectByName("torso") ?? undefined,
      cloak: root.getObjectByName("cloak") ?? undefined,
      tabard: root.getObjectByName("tabard") ?? undefined,
      legL: root.getObjectByName("legL") ?? undefined,
      legR: root.getObjectByName("legR") ?? undefined,
      kneeL: root.getObjectByName("kneeL") ?? undefined,
      kneeR: root.getObjectByName("kneeR") ?? undefined,
      armL: root.getObjectByName("armL") ?? undefined,
      armR: root.getObjectByName("armR") ?? undefined,
      elbowL: root.getObjectByName("elbowL") ?? undefined,
      elbowR: root.getObjectByName("elbowR") ?? undefined,
      weapon: root.getObjectByName("weapon") ?? undefined,
      hood: root.getObjectByName("hood") ?? undefined,
    };
    root.userData.humJoints = j;
  }
  return j;
}

function smooth(a: number, b: number, t: number) {
  const u = Math.max(0, Math.min(1, t));
  const s = u * u * (3 - 2 * u);
  return a + (b - a) * s;
}

/** Softstep move weight so walk↔idle never snaps when `moving` flips. */
function moveWeightOf(root: THREE.Object3D, moving: boolean, tMs: number): number {
  const last = (root.userData._animLastT as number) ?? tMs;
  const dt = Math.min(0.05, Math.max(0, (tMs - last) * 0.001));
  root.userData._animLastT = tMs;
  const cur = (root.userData.moveWeight as number) ?? (moving ? 1 : 0);
  const target = moving ? 1 : 0;
  // Snappy engage, softer release — reads as foot plant settling.
  const rate = moving ? 14 : 9;
  const next = cur + (target - cur) * (1 - Math.exp(-rate * Math.max(dt, 0.001)));
  root.userData.moveWeight = next;
  return next;
}

export function tickHumanoid(
  root: THREE.Object3D,
  opts: {
    moving: boolean;
    tMs: number;
    attacking: boolean;
    speed: number;
    channeling?: boolean;
    attackU?: number;
  }
) {
  const t = opts.tMs * 0.001;
  const mw = moveWeightOf(root, opts.moving, opts.tMs);
  const gait = t * (1.35 + mw * (6.05 + opts.speed * 0.38));
  const step = mw;
  const {
    hips,
    torso,
    cloak,
    tabard,
    legL,
    legR,
    kneeL,
    kneeR,
    armL,
    armR,
    elbowL,
    elbowR,
    weapon,
    hood,
  } = jointsOf(root);

  if (opts.channeling) {
    if (hips) {
      hips.position.y = Math.sin(t * 3.2) * 0.01;
      hips.position.z = 0;
      hips.rotation.y = 0;
      hips.rotation.z = 0;
    }
    if (torso) {
      torso.rotation.y = 0;
      torso.rotation.x = 0.18;
      torso.rotation.z = 0;
    }
    if (cloak) {
      cloak.rotation.x = 0.34 + Math.sin(t * 3.6) * 0.05;
      cloak.rotation.y = Math.sin(t * 2.4) * 0.07;
      cloak.rotation.z = 0;
    }
    if (tabard) tabard.rotation.x = 0.04;
    if (legL) legL.rotation.x = 0.06;
    if (legR) legR.rotation.x = -0.05;
    if (kneeL) kneeL.rotation.x = 0.12;
    if (kneeR) kneeR.rotation.x = 0.1;
    if (armL) {
      armL.rotation.x = -0.62;
      armL.rotation.z = -0.16;
    }
    if (armR) {
      armR.rotation.x = -0.7;
      armR.rotation.z = 0.16;
    }
    if (elbowL) elbowL.rotation.x = -0.35;
    if (elbowR) elbowR.rotation.x = -0.4;
    if (weapon) {
      weapon.rotation.x = 0.35;
      weapon.rotation.z = 0.18;
    }
    if (hood) hood.rotation.x = -0.38 + Math.sin(t * 2.1) * 0.02;
    return;
  }

  const swingL = Math.sin(gait);
  const swingR = Math.sin(gait + Math.PI);
  // Foot-plant weight: peaks just after downstroke (less floaty than |sin|).
  const plant = Math.max(0, Math.sin(gait * 2));
  const idleBreath = Math.sin(t * 1.85);

  if (hips) {
    hips.position.y =
      plant * 0.048 * step + idleBreath * 0.014 * (1 - step * 0.85);
    hips.position.z = 0;
    hips.rotation.y = swingL * 0.08 * step;
    hips.rotation.z = swingL * 0.038 * step;
  }
  if (torso) {
    torso.rotation.y = -swingL * 0.1 * step;
    torso.rotation.x = 0.06 * step + idleBreath * 0.022 * (1 - step * 0.7);
    torso.rotation.z = -swingL * 0.028 * step;
  }
  if (cloak) {
    const idle = 1 - step;
    cloak.rotation.x =
      0.14 +
      Math.sin(gait * 2) * 0.1 * step +
      Math.sin(t * 1.35) * 0.028 +
      Math.sin(t * 2.4) * 0.055 * idle;
    cloak.rotation.y = swingL * 0.07 * step + Math.sin(t * 1.8) * 0.048 * idle;
    cloak.rotation.z = Math.sin(t * 2.05) * 0.028 * idle;
  }
  if (tabard) {
    tabard.rotation.x = Math.sin(gait * 2) * 0.055 * step + Math.sin(t * 1.55) * 0.018;
    tabard.rotation.z = swingL * 0.035 * step;
  }
  // Longer-limb stride: slightly deeper thigh swing, delayed knee fold on plant.
  if (legL) {
    legL.rotation.x = -swingL * 0.88 * step;
    legL.rotation.z = 0;
  }
  if (legR) {
    legR.rotation.x = -swingR * 0.88 * step;
    legR.rotation.z = 0;
  }
  if (kneeL) kneeL.rotation.x = 0.1 + Math.max(0, -swingL) * 1.12 * step;
  if (kneeR) kneeR.rotation.x = 0.1 + Math.max(0, -swingR) * 1.12 * step;
  // Arm counter-swing matches longer reach; rest rz stays ±0.16 for gear.
  if (armL) {
    armL.rotation.x = -swingR * 0.52 * step;
    armL.rotation.z = -0.16;
  }
  if (armR) {
    armR.rotation.x = -swingL * 0.34 * step - 0.1;
    armR.rotation.z = 0.16;
  }
  if (elbowL) elbowL.rotation.x = -0.2 - Math.max(0, swingR) * 0.42 * step;
  if (elbowR) elbowR.rotation.x = -0.16 - Math.max(0, swingL) * 0.26 * step;
  if (weapon) {
    weapon.rotation.x = 0.55;
    weapon.rotation.z = 0.12;
    weapon.rotation.y = 0;
  }
  if (hood) hood.rotation.x = -0.38 + idleBreath * 0.02;

  if (!opts.attacking) return;

  // Phases aligned to client WINDUP(~22%) → impact snap → RECOVERY.
  const u = Math.max(0, Math.min(1, opts.attackU ?? 0));
  let torsoY = 0;
  let torsoX = 0.06 * step + 0.02 * (1 - step);
  let armRx = armR?.rotation.x ?? -0.1;
  let armRz = 0.16;
  let armLx = armL?.rotation.x ?? 0;
  let elRx = elbowR?.rotation.x ?? -0.16;
  let elLx = elbowL?.rotation.x ?? -0.2;
  let wepX = 0.55;
  let wepZ = 0.12;
  let wepY = 0;
  let lungeZ = 0;

  if (u < 0.22) {
    const k = u / 0.22;
    torsoY = smooth(0, -0.68, k);
    torsoX = smooth(torsoX, 0.14, k);
    armRx = smooth(armRx, 0.62, k);
    armRz = smooth(0.16, 0.78, k);
    armLx = smooth(armLx, -0.5, k);
    elRx = smooth(elRx, -1.52, k);
    elLx = smooth(elLx, -0.58, k);
    wepX = smooth(0.55, -0.22, k);
    wepZ = smooth(0.12, 0.62, k);
    wepY = smooth(0, 0.28, k);
    lungeZ = smooth(0, 0.04, k);
  } else if (u < 0.4) {
    const k = (u - 0.22) / 0.18;
    // Impact snap — sharp ease into contact.
    const snap = k * k;
    torsoY = smooth(-0.68, 0.85, snap);
    torsoX = smooth(0.14, 0.26, snap);
    armRx = smooth(0.62, -1.55, snap);
    armRz = smooth(0.78, -0.28, snap);
    armLx = smooth(-0.5, -0.85, snap);
    elRx = smooth(-1.52, -0.05, snap);
    elLx = smooth(-0.58, -0.32, snap);
    wepX = smooth(-0.22, 0.52, snap);
    wepZ = smooth(0.62, -0.92, snap);
    wepY = smooth(0.28, -0.18, snap);
    lungeZ = smooth(0.04, -0.1, snap);
  } else {
    const k = (u - 0.4) / 0.6;
    torsoY = smooth(0.85, 0, k);
    torsoX = smooth(0.26, 0.06 * step + 0.02 * (1 - step), k);
    armRx = smooth(-1.55, -swingL * 0.34 * step - 0.1, k);
    armRz = smooth(-0.28, 0.16, k);
    armLx = smooth(-0.85, -swingR * 0.52 * step, k);
    elRx = smooth(-0.05, -0.16 - Math.max(0, swingL) * 0.26 * step, k);
    elLx = smooth(-0.32, -0.2 - Math.max(0, swingR) * 0.42 * step, k);
    wepX = smooth(0.52, 0.55, k);
    wepZ = smooth(-0.92, 0.12, k);
    wepY = smooth(-0.18, 0, k);
    lungeZ = smooth(-0.1, 0, k);
  }

  if (torso) {
    torso.rotation.y = torsoY;
    torso.rotation.x = torsoX;
  }
  if (armR) {
    armR.rotation.x = armRx;
    armR.rotation.z = armRz;
  }
  if (armL) armL.rotation.x = armLx;
  if (elbowR) elbowR.rotation.x = elRx;
  if (elbowL) elbowL.rotation.x = elLx;
  if (weapon) {
    weapon.rotation.x = wepX;
    weapon.rotation.z = wepZ;
    weapon.rotation.y = wepY;
  }
  if (hips) {
    hips.rotation.y = torsoY * -0.28;
    // Local forward is −z: negative lungeZ reads as a short step into the cut.
    hips.position.z = lungeZ;
  }
}

export function tickWhirl(root: THREE.Object3D, tMs: number, champion: boolean) {
  const ribbon = root.getObjectByName("ribbon");
  if (ribbon) {
    ribbon.rotation.y = tMs * (champion ? 0.0045 : 0.0032);
    ribbon.rotation.x = Math.sin(tMs * 0.0015) * 0.25;
  }
  const ribbon2 = root.getObjectByName("ribbon2");
  if (ribbon2) {
    ribbon2.rotation.y = -tMs * 0.0026;
    ribbon2.rotation.z = Math.sin(tMs * 0.0011) * 0.2;
  }
  const bob = root.getObjectByName("ribbon");
  if (bob) bob.position.y = 0.95 + Math.sin(tMs * 0.0022) * 0.08;
}

/** Cheap Triple Maw idle: ribbon spin + staggered head/jaw hints (named mawHead / mawJaw). */
export function tickTripleMaw(root: THREE.Object3D, tMs: number) {
  let cache = root.userData.mawCache as MawCache | undefined;
  if (!cache) {
    cache = { heads: [], jaws: [] };
    root.traverse((o) => {
      if (o.name === "ribbon") cache!.ribbon = o;
      else if (o.name === "ribbon2") cache!.ribbon2 = o;
      else if (o.name === "mawTelegraph") cache!.tele = o;
      else if (o.name === "mawHead") cache!.heads.push(o);
      else if (o.name === "mawJaw") cache!.jaws.push(o);
    });
    root.userData.mawCache = cache;
  }
  if (cache.ribbon) {
    cache.ribbon.rotation.y = tMs * 0.0018;
    cache.ribbon.position.y = 1.55 + Math.sin(tMs * 0.002) * 0.05;
  }
  if (cache.ribbon2) {
    cache.ribbon2.rotation.y = -tMs * 0.0014;
    cache.ribbon2.position.y = 1.15 + Math.sin(tMs * 0.0017 + 1.2) * 0.04;
  }
  if (cache.tele) {
    const s = 1 + Math.sin(tMs * 0.0024) * 0.05;
    cache.tele.scale.set(s, s, 1);
  }
  for (let hi = 0; hi < cache.heads.length; hi++) {
    const o = cache.heads[hi]!;
    const phase = hi * 1.7;
    if (o.userData.baseY == null) o.userData.baseY = o.position.y;
    o.rotation.x = Math.sin(tMs * 0.0016 + phase) * 0.07;
    o.position.y = o.userData.baseY + Math.sin(tMs * 0.0013 + phase) * 0.04;
  }
  for (let ji = 0; ji < cache.jaws.length; ji++) {
    const o = cache.jaws[ji]!;
    if (o.userData.jawPhase == null) o.userData.jawPhase = ji + 0.4;
    o.rotation.x = 1.85 + Math.sin(tMs * 0.0031 + o.userData.jawPhase) * 0.12;
  }
}
