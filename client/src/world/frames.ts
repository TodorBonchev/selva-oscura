/**
 * One spatial frame for the Three.js client.
 *
 * Server planar (x, y) → world (x, 0, y). Y is up. Object3D local forward is −z.
 *
 * Camera sits at target + (CAM_SIDE_X·CAM_BACK, CAM_HEIGHT, CAM_SIDE_Z·CAM_BACK)
 * = up and back along (−x, +z), and looks at the target, so getWorldDirection
 * flattened is (+,0,−). WASD is derived from that vector every frame (never from
 * a second yaw formula).
 *
 * Why this yaw: every canto's road runs west → east (+x) and the hub gate lies
 * to +x −z. With the camera on the (−x, +z) side, +x projects to the upper
 * right of the screen and the hub gate straight up — progress reads away from
 * the phone thumb cluster (lower right) instead of underneath it.
 *
 * Check: camera behind the player, fwd = (0,0,−1) → right = fwd × UP = (1,0,0).
 */
import * as THREE from "three";

export const UP = new THREE.Vector3(0, 1, 0);

/** Planar side of the hero the camera sits on (unit steps, see header). */
export const CAM_SIDE_X = -1;
export const CAM_SIDE_Z = 1;

/**
 * Rotate a planar offset authored for the legacy (+x, +z) camera into the
 * current camera yaw, so camera-relative rigs (sun, rim, fill) keep their look.
 * Legacy side (1, 1) → current side (CAM_SIDE_X, CAM_SIDE_Z).
 */
export function camRel(x: number, z: number): { x: number; z: number } {
  // Rotation that maps (1,1) onto (CAM_SIDE_X, CAM_SIDE_Z): angle between them.
  const a = Math.atan2(CAM_SIDE_Z, CAM_SIDE_X) - Math.PI / 4;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c - z * s, z: x * s + z * c };
}

/**
 * Yaw (rotation.y) that turns a +z-facing flat object (portal disc, plate)
 * toward the follow camera.
 */
export const CAM_FACE_YAW = Math.atan2(CAM_SIDE_X, CAM_SIDE_Z);

/**
 * Movement look-ahead: ease `lead` toward a short lead along the hero's
 * velocity so more of the road ahead is on screen while walking. Mutates
 * `lead` (x, z) in place — no allocation.
 */
export function tickCamLead(
  lead: { x: number; z: number },
  velX: number,
  velY: number,
  dt: number,
  compact: boolean
) {
  const k = compact && isPortraitCompact() ? 0.16 : 0.26;
  const cap = compact && isPortraitCompact() ? 1.4 : 2.3;
  let tx = velX * k;
  let tz = velY * k;
  const len = Math.hypot(tx, tz);
  if (len > cap) {
    tx = (tx / len) * cap;
    tz = (tz / len) * cap;
  }
  // Slow ease so a dash or a turn doesn't whip the frame around.
  const a = 1 - Math.exp(-Math.max(0, dt) * 2.2);
  lead.x += (tx - lead.x) * a;
  lead.z += (tz - lead.z) * a;
}

/**
 * Camera offset in world units. Phones sit higher (steeper pitch) so the camera
 * clears the canopy band (trees are 7–14 tall) and the ground around the hero
 * reads on a small screen; portrait is steepest since it has the most vertical room.
 *   desktop  ≈ 27° pitch · landscape ≈ 41° · portrait ≈ 43°
 */
export const CAM_BACK_DESKTOP = 9.2;
export const CAM_HEIGHT_DESKTOP = 6.7;
export const CAM_BACK_MOBILE = 9.2;
export const CAM_HEIGHT_MOBILE = 11.4;
export const CAM_BACK_PORTRAIT = 9.8;
export const CAM_HEIGHT_PORTRAIT = 13.2;

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

export function isPortraitCompact(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(orientation: portrait)").matches && window.innerWidth < 900;
}

const _camOff = new THREE.Vector3();

/** Camera offset from the follow target (shared scratch vector — copy if kept). */
export function camOffset(compact: boolean): THREE.Vector3 {
  if (compact && isPortraitCompact()) {
    return _camOff.set(CAM_SIDE_X * CAM_BACK_PORTRAIT, CAM_HEIGHT_PORTRAIT, CAM_SIDE_Z * CAM_BACK_PORTRAIT);
  }
  const b = compact ? CAM_BACK_MOBILE : CAM_BACK_DESKTOP;
  const h = compact ? CAM_HEIGHT_MOBILE : CAM_HEIGHT_DESKTOP;
  return _camOff.set(CAM_SIDE_X * b, h, CAM_SIDE_Z * b);
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
  camera.position.y = Math.max(camera.position.y, target.y + 4.6);
  // Look a little past the hero into the scene so they sit in the lower third (D4-style).
  // Portrait phones keep the hero nearer centre: the bottom third belongs to the thumbs.
  const ahead = compact && isPortraitCompact() ? 0.7 : 1.8;
  camera.lookAt(target.x - CAM_SIDE_X * ahead, target.y + lookY, target.z - CAM_SIDE_Z * ahead);
}
