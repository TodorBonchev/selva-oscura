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
  head?: THREE.Object3D;
  apron?: THREE.Object3D;
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
      head: root.getObjectByName("head") ?? undefined,
      apron: root.getObjectByName("apron") ?? undefined,
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
    head,
    apron,
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
      torso.rotation.x = -0.08;
      torso.rotation.z = 0;
    }
    if (cloak) {
      // Negative x swings the hem back (+z): the mantle lifts in the portal draught
      cloak.rotation.x = -0.32 + Math.sin(t * 3.6) * 0.05;
      cloak.rotation.y = Math.sin(t * 2.4) * 0.07;
      cloak.rotation.z = 0;
    }
    if (tabard) tabard.rotation.x = -0.04;
    if (apron) apron.rotation.x = 0.02;
    if (head) {
      head.rotation.x = -0.12;
      head.rotation.y = 0;
    }
    if (legL) legL.rotation.x = 0.08;
    if (legR) legR.rotation.x = -0.08;
    if (kneeL) kneeL.rotation.x = -0.14;
    if (kneeR) kneeR.rotation.x = -0.1;
    if (armL) {
      armL.rotation.x = 0.9;
      armL.rotation.z = -0.16;
    }
    if (armR) {
      armR.rotation.x = 0.55;
      armR.rotation.z = 0.16;
    }
    if (elbowL) elbowL.rotation.x = 0.45;
    if (elbowR) elbowR.rotation.x = 0.35;
    if (weapon) {
      weapon.rotation.x = 0.35;
      weapon.rotation.z = 0.18;
    }
    if (hood) hood.rotation.x = Math.sin(t * 2.1) * 0.015;
    return;
  }

  // Joint conventions (three.js, model forward = −z): +rotation.x swings a
  // hanging limb FORWARD and tilts an upright part BACK. Knees flex with −x,
  // elbows with +x. legL leads when sin(gait) > 0.
  const sL = Math.sin(gait);
  const cL = Math.cos(gait);
  const run = Math.min(1, opts.speed / 8);
  const plant = Math.max(0, Math.sin(gait * 2));
  const idleBreath = Math.sin(t * 1.85);

  // Thighs: walk ±0.34 rad → run ±0.56 rad
  const A = (0.34 + 0.22 * run) * step;
  const aL = A * sL;
  const aR = -A * sL;
  // Knee flexion peaks mid-swing (foot tucked), eases out to plant, stays soft in stance
  const flexOf = (c: number) => 0.06 + step * (0.14 + (0.75 + 0.35 * run) * Math.pow(Math.max(0, c), 1.3));
  const fL = flexOf(cL);
  const fR = flexOf(-cL);
  if (legL) {
    legL.rotation.x = aL;
    legL.rotation.z = 0;
  }
  if (legR) {
    legR.rotation.x = aR;
    legR.rotation.z = 0;
  }
  if (kneeL) kneeL.rotation.x = -fL;
  if (kneeR) kneeR.rotation.x = -fR;

  if (hips) {
    // Foot plant: lower the pelvis until the lower foot meets the ground, so a
    // wide stride never floats; a small bounce on each plant when running.
    const T = 0.43;
    const S = 0.5;
    const reach = Math.max(T * Math.cos(aL) + S * Math.cos(aL - fL), T * Math.cos(aR) + S * Math.cos(aR - fR));
    hips.position.y = reach - (T + S) + plant * 0.02 * step * run + idleBreath * 0.01 * (1 - step);
    hips.position.z = 0;
    hips.rotation.y = -sL * 0.09 * step;
    hips.rotation.z = -sL * 0.03 * step;
  }
  if (torso) {
    // Child of the hips: cancel their yaw/roll, then counter-swing the shoulders
    // (+0.10 world yaw) and lean into the run (−x is forward for an upright part).
    torso.rotation.y = sL * 0.19 * step;
    torso.rotation.x = -(0.03 + 0.12 * run) * step + idleBreath * 0.02 * (1 - step * 0.7);
    torso.rotation.z = sL * 0.05 * step;
  }
  if (cloak) {
    const idle = 1 - step;
    // Negative x trails the hem behind (+z); more speed → more lift, with a
    // double-time flutter on each foot plant. Idle hangs almost straight.
    const lift = run * step;
    cloak.rotation.x =
      -0.03 -
      0.3 * lift -
      Math.sin(gait * 2) * 0.07 * step -
      Math.sin(t * 1.35) * 0.02 * idle;
    cloak.rotation.y = -sL * 0.06 * step + Math.sin(t * 1.8) * 0.03 * idle;
    cloak.rotation.z = -sL * 0.03 * step + Math.sin(t * 2.05) * 0.018 * idle;
  }
  // Robe panels ride the thighs so knees never poke through: the front apron
  // follows whichever leg is forward (+x), the back tabard the trailing leg.
  if (apron) {
    apron.rotation.x = Math.max(0, aL, aR) * 0.95 + Math.sin(t * 1.6) * 0.012;
    apron.rotation.z = (aL - aR) * 0.05;
  }
  if (tabard) {
    tabard.rotation.x = Math.min(0, aL, aR) * 0.85 - 0.04 * run * step + Math.sin(t * 1.55) * 0.012;
    tabard.rotation.z = -sL * 0.03 * step;
  }
  // Arms counter-swing their opposite leg; elbows soften, more on the forward swing
  const restArmLx = -sL * (0.34 + 0.18 * run) * step;
  const restArmRx = sL * (0.24 + 0.1 * run) * step + 0.06;
  const restElL = 0.22 + 0.5 * run * step + Math.max(0, -sL) * 0.35 * step;
  const restElR = 0.28 + 0.4 * run * step + Math.max(0, sL) * 0.25 * step;
  if (armL) {
    armL.rotation.x = restArmLx;
    armL.rotation.z = -0.16;
  }
  if (armR) {
    armR.rotation.x = restArmRx;
    armR.rotation.z = 0.16;
  }
  if (elbowL) elbowL.rotation.x = restElL;
  if (elbowR) elbowR.rotation.x = restElR;
  // The Guide grips its lantern staff (meshes.makeGuide plants it through this
  // fist): forearm forward, upper arm steady against the breathing torso
  const grip = root.userData.staffGrip as { arm: number; elbow: number } | undefined;
  if (grip) {
    if (armL) armL.rotation.x = grip.arm - (torso?.rotation.x ?? 0);
    if (elbowL) elbowL.rotation.x = grip.elbow;
  }
  // Blade carried low, point angled down and back, whatever the arm swing
  const restWepX = -0.45 - (restArmRx + restElR);
  if (weapon) {
    weapon.rotation.x = restWepX;
    weapon.rotation.z = 0.12;
    weapon.rotation.y = 0;
  }
  if (head) {
    // Idle: slow look-around; moving: steady gaze with a small counter-nod
    const idle = 1 - step;
    head.rotation.y = Math.sin(t * 0.37) * 0.16 * idle - sL * 0.05 * step;
    head.rotation.x = idleBreath * 0.018 * idle + (0.04 + 0.08 * run) * step - plant * 0.02 * step;
  }
  if (hood) hood.rotation.x = idleBreath * 0.012;

  if (!opts.attacking) return;

  // Diagonal forehand cut, phases aligned to the client WINDUP(~22%) → impact
  // snap → RECOVERY. Same joint conventions as locomotion (+x forward/flex).
  const u = Math.max(0, Math.min(1, opts.attackU ?? 0));
  const restTorsoX = -(0.03 + 0.12 * run) * step;
  let torsoY = 0;
  let torsoX = restTorsoX;
  let armRx = restArmRx;
  let armRz = 0.16;
  let armLx = restArmLx;
  let elRx = restElR;
  let elLx = restElL;
  let wepX = restWepX;
  let wepZ = 0.12;
  let wepY = 0;
  let lungeZ = 0;

  // Key poses: cocked (sword raised over the right shoulder, chest turned away)
  // → struck (arm swept down across the body, chest turned into the cut).
  const COCK = { ty: -0.55, tx: 0.06, arx: 2.15, arz: 0.5, alx: 0.55, erx: 1.25, elx: 0.9, wx: 0.25, wz: 0.35, wy: 0.2, lz: 0.03 };
  const HIT = { ty: 0.62, tx: -0.2, arx: 0.85, arz: -0.32, alx: 0.1, erx: 0.12, elx: 0.55, wx: 0.45, wz: -0.45, wy: -0.1, lz: -0.12 };
  if (u < 0.22) {
    const k = u / 0.22;
    torsoY = smooth(0, COCK.ty, k);
    torsoX = smooth(restTorsoX, COCK.tx, k);
    armRx = smooth(restArmRx, COCK.arx, k);
    armRz = smooth(0.16, COCK.arz, k);
    armLx = smooth(restArmLx, COCK.alx, k);
    elRx = smooth(restElR, COCK.erx, k);
    elLx = smooth(restElL, COCK.elx, k);
    wepX = smooth(restWepX, COCK.wx, k);
    wepZ = smooth(0.12, COCK.wz, k);
    wepY = smooth(0, COCK.wy, k);
    lungeZ = smooth(0, COCK.lz, k);
  } else if (u < 0.4) {
    // Impact snap — sharp ease into contact.
    const k = (u - 0.22) / 0.18;
    const snap = k * k;
    torsoY = smooth(COCK.ty, HIT.ty, snap);
    torsoX = smooth(COCK.tx, HIT.tx, snap);
    armRx = smooth(COCK.arx, HIT.arx, snap);
    armRz = smooth(COCK.arz, HIT.arz, snap);
    armLx = smooth(COCK.alx, HIT.alx, snap);
    elRx = smooth(COCK.erx, HIT.erx, snap);
    elLx = smooth(COCK.elx, HIT.elx, snap);
    wepX = smooth(COCK.wx, HIT.wx, snap);
    wepZ = smooth(COCK.wz, HIT.wz, snap);
    wepY = smooth(COCK.wy, HIT.wy, snap);
    lungeZ = smooth(COCK.lz, HIT.lz, snap);
  } else {
    const k = (u - 0.4) / 0.6;
    torsoY = smooth(HIT.ty, 0, k);
    torsoX = smooth(HIT.tx, restTorsoX, k);
    armRx = smooth(HIT.arx, restArmRx, k);
    armRz = smooth(HIT.arz, 0.16, k);
    armLx = smooth(HIT.alx, restArmLx, k);
    elRx = smooth(HIT.erx, restElR, k);
    elLx = smooth(HIT.elx, restElL, k);
    wepX = smooth(HIT.wx, restWepX, k);
    wepZ = smooth(HIT.wz, 0.12, k);
    wepY = smooth(HIT.wy, 0, k);
    lungeZ = smooth(HIT.lz, 0, k);
  }

  if (torso) {
    // hips counter-rotate by −0.28·torsoY below; the child torso adds it back
    torso.rotation.y = torsoY * 1.28;
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

/** Idle for Counterweight elite — roller spin + disc bob (Crush foreshadow). */
export function tickCounterweight(root: THREE.Object3D, tMs: number) {
  let cache = root.userData.cwCache as
    | { rollers: THREE.Object3D[]; discs: THREE.Object3D[]; body?: THREE.Object3D; ribbon?: THREE.Object3D }
    | undefined;
  if (!cache) {
    cache = { rollers: [], discs: [] };
    root.traverse((o) => {
      if (o.name === "crushRoller") cache!.rollers.push(o);
      else if (o.name === "weightDisc") cache!.discs.push(o);
      else if (o.name === "crushBody") cache!.body = o;
      else if (o.name === "ribbon") cache!.ribbon = o;
    });
    root.userData.cwCache = cache;
  }
  if (cache.body) {
    cache.body.position.y = 1.0 + Math.sin(tMs * 0.0024) * 0.04;
  }
  if (cache.ribbon) {
    cache.ribbon.rotation.z = tMs * 0.0014;
  }
  for (let i = 0; i < cache.rollers.length; i++) {
    const o = cache.rollers[i]!;
    o.rotation.x = tMs * (0.002 + i * 0.0005) * (i % 2 ? -1 : 1);
  }
  for (let i = 0; i < cache.discs.length; i++) {
    const o = cache.discs[i]!;
    o.rotation.z = tMs * 0.0016 * (i % 2 ? -1 : 1);
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
  // Coin wisp: spin stacked discs for greed read (cheap; only when flagged)
  if (root.userData.coinWisp) {
    let discs = root.userData.coinDiscs as THREE.Object3D[] | undefined;
    if (!discs) {
      discs = [];
      root.traverse((o) => {
        if (o.name === "weightDisc") discs!.push(o);
      });
      root.userData.coinDiscs = discs;
    }
    for (let i = 0; i < discs.length; i++) {
      discs[i]!.rotation.z = tMs * (0.0022 + i * 0.0006) * (i % 2 ? -1 : 1);
    }
  }
}

/** Idle for Ledger Warden — tablet sway + plate pulse. */
export function tickLedgerWarden(root: THREE.Object3D, tMs: number) {
  tickWhirl(root, tMs, true);
  const tab = root.getObjectByName("ledgerTablet");
  if (tab) {
    tab.rotation.z = Math.sin(tMs * 0.0022) * 0.08;
    tab.position.y = 1.18 + Math.sin(tMs * 0.0018) * 0.03;
  }
}

/** Idle for Hoard Heart ward — disc spin + soft bob (measure tips). */
export function tickHoardHeart(root: THREE.Object3D, tMs: number) {
  let cache = root.userData.heartCache as
    | { discs: THREE.Object3D[]; ribbon?: THREE.Object3D; body?: THREE.Object3D; aura?: THREE.Object3D }
    | undefined;
  if (!cache) {
    cache = { discs: [] };
    root.traverse((o) => {
      if (o.name === "weightDisc") cache!.discs.push(o);
      else if (o.name === "ribbon") cache!.ribbon = o;
      else if (o.name === "crushBody") cache!.body = o;
      else if (o.name === "judgeAura") cache!.aura = o;
    });
    root.userData.heartCache = cache;
  }
  if (cache.body) cache.body.position.y = 0.98 + Math.sin(tMs * 0.002) * 0.03;
  if (cache.ribbon) cache.ribbon.rotation.z = tMs * 0.0012;
  if (cache.aura) {
    const s = 1 + Math.sin(tMs * 0.003) * 0.05;
    cache.aura.scale.set(s, s, 1);
  }
  for (let i = 0; i < cache.discs.length; i++) {
    cache.discs[i]!.rotation.z = tMs * 0.0018 * (i % 2 ? -1 : 1);
  }
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
    const mesh = cache.tele as { material?: { opacity?: number } };
    if (mesh.material && typeof mesh.material.opacity === "number") {
      mesh.material.opacity = 0.2 + Math.sin(tMs * 0.003) * 0.06;
    }
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


type CrushCache = {
  ribbon?: THREE.Object3D;
  ribbon2?: THREE.Object3D;
  tele?: THREE.Object3D;
  aura?: THREE.Object3D;
  body?: THREE.Object3D;
  rollers: THREE.Object3D[];
  discs: THREE.Object3D[];
  ironMat?: THREE.MeshStandardMaterial;
};

/** Idle for Hoard Crush — rollers, discs, ribbon bob, telegraph, emissive pulse (cached). */
export function tickHoardCrush(root: THREE.Object3D, tMs: number) {
  let cache = root.userData.crushCache as CrushCache | undefined;
  if (!cache) {
    cache = { rollers: [], discs: [] };
    root.traverse((o) => {
      if (o.name === "ribbon") cache!.ribbon = o;
      else if (o.name === "ribbon2") cache!.ribbon2 = o;
      else if (o.name === "mawTelegraph") cache!.tele = o;
      else if (o.name === "judgeAura") cache!.aura = o;
      else if (o.name === "crushBody") cache!.body = o;
      else if (o.name === "crushRoller") cache!.rollers.push(o);
      else if (o.name === "weightDisc") cache!.discs.push(o);
    });
    const bodyMesh = cache.body as THREE.Mesh | undefined;
    if (bodyMesh && bodyMesh.material && !Array.isArray(bodyMesh.material)) {
      cache.ironMat = bodyMesh.material as THREE.MeshStandardMaterial;
    }
    root.userData.crushCache = cache;
  }
  if (cache.ribbon) {
    cache.ribbon.rotation.z = tMs * 0.0016;
    cache.ribbon.position.y = 2.2 + Math.sin(tMs * 0.002) * 0.04;
  }
  if (cache.ribbon2) {
    cache.ribbon2.rotation.z = -tMs * 0.0012;
    cache.ribbon2.position.y = 1.4 + Math.sin(tMs * 0.0017 + 1.1) * 0.035;
  }
  if (cache.tele) {
    const s = 1 + Math.sin(tMs * 0.0024) * 0.05;
    cache.tele.scale.set(s, s, 1);
    const mesh = cache.tele as { material?: { opacity?: number } };
    if (mesh.material && typeof mesh.material.opacity === "number") {
      mesh.material.opacity = 0.2 + Math.sin(tMs * 0.003) * 0.06;
    }
  }
  if (cache.aura) {
    const s = 1 + Math.sin(tMs * 0.0031) * 0.04;
    cache.aura.scale.set(s, s, 1);
  }
  if (cache.ironMat) {
    cache.ironMat.emissiveIntensity = 0.34 + Math.sin(tMs * 0.0028) * 0.08;
  }
  if (cache.body) {
    cache.body.position.y = 1.55 + Math.sin(tMs * 0.0021) * 0.045;
  }
  for (let i = 0; i < cache.rollers.length; i++) {
    const o = cache.rollers[i]!;
    o.rotation.x = tMs * (0.0022 + i * 0.0004) * (i % 2 ? -1 : 1);
  }
  for (let i = 0; i < cache.discs.length; i++) {
    const o = cache.discs[i]!;
    o.rotation.z = tMs * 0.0018 * (i % 2 ? -1 : 1);
  }
}
