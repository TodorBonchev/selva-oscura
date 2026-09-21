/**
 * Procedural humanoid motion. Joints are named Object3Ds on the wanderer rig
 * (legL, legR, armL, armR, torso, cloak, hips, weapon).
 */
import * as THREE from "three";

export function tickHumanoid(
  root: THREE.Object3D,
  opts: { moving: boolean; tMs: number; attacking: boolean; speed: number }
) {
  const t = opts.tMs * 0.001;
  const gait = opts.moving ? t * (7.2 + opts.speed * 0.4) : t * 1.35;
  const step = opts.moving ? 1 : 0.12;

  const hips = root.getObjectByName("hips");
  const torso = root.getObjectByName("torso");
  const cloak = root.getObjectByName("cloak");
  const legL = root.getObjectByName("legL");
  const legR = root.getObjectByName("legR");
  const armL = root.getObjectByName("armL");
  const armR = root.getObjectByName("armR");
  const weapon = root.getObjectByName("weapon");
  const hood = root.getObjectByName("hood");

  if (hips) {
    hips.position.y = opts.moving ? 0.02 + Math.abs(Math.sin(gait)) * 0.055 : Math.sin(t * 2.1) * 0.012;
  }
  if (torso) {
    torso.rotation.y = Math.sin(gait) * 0.07 * step;
    torso.rotation.x = opts.moving ? 0.08 : Math.sin(t * 2.1) * 0.02;
  }
  if (cloak) {
    cloak.rotation.x = 0.18 + Math.sin(gait * 2) * 0.08 * step + Math.sin(t * 1.4) * 0.03;
    cloak.rotation.y = Math.sin(gait) * 0.05 * step;
  }
  if (legL) legL.rotation.x = Math.sin(gait) * 0.62 * step;
  if (legR) legR.rotation.x = Math.sin(gait + Math.PI) * 0.62 * step;
  if (armL) armL.rotation.x = Math.sin(gait + Math.PI) * 0.42 * step;
  if (armR) {
    if (opts.attacking) {
      const swing = Math.sin(opts.tMs * 0.018) * 1.1;
      armR.rotation.x = -0.9 + swing;
    } else {
      armR.rotation.x = Math.sin(gait) * 0.38 * step - 0.15;
    }
  }
  if (weapon) weapon.rotation.z = opts.attacking ? -0.35 : 0.12;
  if (hood) hood.rotation.x = -0.42 + Math.sin(t * 1.7) * 0.03;
}

export function tickWhirl(root: THREE.Object3D, tMs: number, champion: boolean) {
  const ribbon = root.getObjectByName("ribbon");
  if (ribbon) {
    ribbon.rotation.y = tMs * (champion ? 0.0045 : 0.0032);
    ribbon.rotation.x = Math.sin(tMs * 0.0015) * 0.25;
  }
  const body = root;
  body.position.y = Math.sin(tMs * 0.0022) * 0.08;
}
