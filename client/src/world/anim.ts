/**
 * Procedural humanoid motion. Joints are named Object3Ds on the wanderer rig
 * (hips, torso, cloak, tabard, hood, legL/R, kneeL/R, armL/R, elbowL/R, weapon).
 */
import * as THREE from "three";

function smooth(a: number, b: number, t: number) {
  const u = Math.max(0, Math.min(1, t));
  const s = u * u * (3 - 2 * u);
  return a + (b - a) * s;
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
  const gait = opts.moving ? t * (7.4 + opts.speed * 0.38) : t * 1.35;
  const step = opts.moving ? 1 : 0.1;

  const hips = root.getObjectByName("hips");
  const torso = root.getObjectByName("torso");
  const cloak = root.getObjectByName("cloak");
  const tabard = root.getObjectByName("tabard");
  const legL = root.getObjectByName("legL");
  const legR = root.getObjectByName("legR");
  const kneeL = root.getObjectByName("kneeL");
  const kneeR = root.getObjectByName("kneeR");
  const armL = root.getObjectByName("armL");
  const armR = root.getObjectByName("armR");
  const elbowL = root.getObjectByName("elbowL");
  const elbowR = root.getObjectByName("elbowR");
  const weapon = root.getObjectByName("weapon");
  const hood = root.getObjectByName("hood");

  if (opts.channeling) {
    if (hips) {
      hips.position.y = Math.sin(t * 3.2) * 0.01;
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
      armL.rotation.z = -0.12;
    }
    if (armR) {
      armR.rotation.x = -0.7;
      armR.rotation.z = 0.12;
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

  if (hips) {
    hips.position.y = opts.moving ? Math.abs(Math.sin(gait)) * 0.07 : Math.sin(t * 2.1) * 0.012;
    hips.rotation.y = swingL * 0.09 * step;
    hips.rotation.z = swingL * 0.045 * step;
  }
  if (torso) {
    torso.rotation.y = -swingL * 0.11 * step;
    torso.rotation.x = opts.moving ? 0.09 : Math.sin(t * 2.1) * 0.018;
    torso.rotation.z = -swingL * 0.03 * step;
  }
  if (cloak) {
    const idle = opts.moving ? 0 : 1;
    cloak.rotation.x =
      0.16 + Math.sin(gait * 2) * 0.09 * step + Math.sin(t * 1.4) * 0.03 + Math.sin(t * 2.6) * 0.06 * idle;
    cloak.rotation.y = swingL * 0.06 * step + Math.sin(t * 1.9) * 0.05 * idle;
    cloak.rotation.z = Math.sin(t * 2.2) * 0.03 * idle;
  }
  if (tabard) {
    tabard.rotation.x = Math.sin(gait * 2) * 0.06 * step + Math.sin(t * 1.6) * 0.02;
    tabard.rotation.z = swingL * 0.04 * step;
  }
  if (legL) {
    legL.rotation.x = swingL * 0.82 * step;
    legL.rotation.z = 0;
  }
  if (legR) {
    legR.rotation.x = swingR * 0.82 * step;
    legR.rotation.z = 0;
  }
  if (kneeL) kneeL.rotation.x = 0.12 + Math.max(0, -swingL) * 1.05 * step;
  if (kneeR) kneeR.rotation.x = 0.12 + Math.max(0, -swingR) * 1.05 * step;
  if (armL) {
    armL.rotation.x = swingR * 0.42 * step;
    armL.rotation.z = -0.16;
  }
  if (armR) {
    armR.rotation.x = swingL * 0.28 * step - 0.12;
    armR.rotation.z = 0.16;
  }
  if (elbowL) elbowL.rotation.x = -0.22 - Math.max(0, swingR) * 0.38 * step;
  if (elbowR) elbowR.rotation.x = -0.18 - Math.max(0, swingL) * 0.22 * step;
  if (weapon) {
    weapon.rotation.x = 0.55;
    weapon.rotation.z = 0.12;
    weapon.rotation.y = 0;
  }
  if (hood) hood.rotation.x = -0.38 + Math.sin(t * 1.7) * 0.025;

  if (!opts.attacking) return;

  const u = Math.max(0, Math.min(1, opts.attackU ?? 0));
  let torsoY = 0;
  let torsoX = opts.moving ? 0.09 : 0.02;
  let armRx = armR?.rotation.x ?? -0.12;
  let armRz = 0.16;
  let armLx = armL?.rotation.x ?? 0;
  let elRx = elbowR?.rotation.x ?? -0.18;
  let elLx = elbowL?.rotation.x ?? -0.22;
  let wepX = 0.55;
  let wepZ = 0.12;
  let wepY = 0;

  if (u < 0.26) {
    const k = u / 0.26;
    torsoY = smooth(0, -0.62, k);
    torsoX = smooth(torsoX, 0.12, k);
    armRx = smooth(armRx, 0.55, k);
    armRz = smooth(0.16, 0.72, k);
    armLx = smooth(armLx, -0.45, k);
    elRx = smooth(elRx, -1.45, k);
    elLx = smooth(elLx, -0.55, k);
    wepX = smooth(0.55, -0.15, k);
    wepZ = smooth(0.12, 0.55, k);
    wepY = smooth(0, 0.25, k);
  } else if (u < 0.55) {
    const k = (u - 0.26) / 0.29;
    torsoY = smooth(-0.62, 0.78, k);
    torsoX = smooth(0.12, 0.22, k);
    armRx = smooth(0.55, -1.42, k);
    armRz = smooth(0.72, -0.22, k);
    armLx = smooth(-0.45, -0.78, k);
    elRx = smooth(-1.45, -0.08, k);
    elLx = smooth(-0.55, -0.35, k);
    wepX = smooth(-0.15, 0.45, k);
    wepZ = smooth(0.55, -0.85, k);
    wepY = smooth(0.25, -0.15, k);
  } else {
    const k = (u - 0.55) / 0.45;
    torsoY = smooth(0.78, 0, k);
    torsoX = smooth(0.22, opts.moving ? 0.09 : 0.02, k);
    armRx = smooth(-1.42, swingL * 0.28 * step - 0.12, k);
    armRz = smooth(-0.22, 0.16, k);
    armLx = smooth(-0.78, swingR * 0.42 * step, k);
    elRx = smooth(-0.08, -0.18 - Math.max(0, swingL) * 0.22 * step, k);
    elLx = smooth(-0.35, -0.22 - Math.max(0, swingR) * 0.38 * step, k);
    wepX = smooth(0.45, 0.55, k);
    wepZ = smooth(-0.85, 0.12, k);
    wepY = smooth(-0.15, 0, k);
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
  if (hips) hips.rotation.y = torsoY * -0.25;
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
  root.position.y += 0.12 + Math.sin(tMs * 0.0022) * 0.1;
}
