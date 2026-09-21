/**
 * One spatial frame for the Three.js client.
 *
 * Server planar (x, y) → world (x, 0, y). Y is up. Object3D local forward is −z.
 *
 * Camera sits at target + (CAM_BACK, CAM_HEIGHT, CAM_BACK) and looks at the
 * target, so getWorldDirection flattened is (−,0,−). WASD is derived from that
 * vector every frame (never from a second yaw formula).
 *
 * Check: camera behind the player, fwd = (0,0,−1) → right = fwd × UP = (1,0,0).
 * Planar W (Phaser iso) decreased both x and y = screen-up; that is this fwd.
 */
import * as THREE from "three";

export const UP = new THREE.Vector3(0, 1, 0);

/** Camera offset in world units. Pulled back on compact UI. */
export const CAM_BACK_DESKTOP = 22;
export const CAM_HEIGHT_DESKTOP = 16.5;
export const CAM_BACK_MOBILE = 28;
export const CAM_HEIGHT_MOBILE = 20;

/** Local Object3D forward. */
export const LOCAL_FWD = new THREE.Vector3(0, 0, -1);

export function planarToWorld(x: number, y: number, h = 0): THREE.Vector3 {
  return new THREE.Vector3(x, h, y);
}

export function setPlanar(out: THREE.Vector3, x: number, y: number, h = 0): THREE.Vector3 {
  return out.set(x, h, y);
}

export function worldToPlanar(v: THREE.Vector3): { x: number; y: number } {
  return { x: v.x, y: v.z };
}

/**
 * Yaw so a −z-fronted object faces planar direction (dx, dy).
 * Rule 2: rotation.y = atan2(−d.x, −d.z) with d.z = planar y.
 */
export function yawFromPlanar(dx: number, dy: number): number {
  return Math.atan2(-dx, -dy);
}

/** Planar facing of a −z-fronted object (parent heading). */
export function planarFacingFromQuat(q: THREE.Quaternion): { x: number; y: number } {
  const f = LOCAL_FWD.clone().applyQuaternion(q);
  return { x: f.x, y: f.z };
}

export function camOffset(compact: boolean): THREE.Vector3 {
  const b = compact ? CAM_BACK_MOBILE : CAM_BACK_DESKTOP;
  const h = compact ? CAM_HEIGHT_MOBILE : CAM_HEIGHT_DESKTOP;
  return new THREE.Vector3(b, h, b);
}

/**
 * Camera-relative planar axes. Must be called with the live camera, every frame.
 * right = forward × up  (y-up, right-handed).
 */
export function camPlanarBasis(camera: THREE.Camera): {
  fwd: THREE.Vector3;
  right: THREE.Vector3;
} {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1);
  else fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, UP);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  else right.normalize();
  return { fwd, right };
}

/** Place the follow camera from the same offset used for movement. */
export function placeFollowCamera(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  compact: boolean,
  lookY = 1.15
) {
  const o = camOffset(compact);
  camera.up.copy(UP);
  camera.position.set(target.x + o.x, target.y + o.y, target.z + o.z);
  camera.lookAt(target.x, lookY, target.z);
}
