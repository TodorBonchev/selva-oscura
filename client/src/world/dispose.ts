/**
 * GPU-resource bookkeeping for despawned nodes.
 *
 * three.js keeps each geometry's buffers (and a VAO cache entry per geometry/program pair)
 * and each material's program reference alive until dispose() — dropping a node from the
 * scene alone leaked ~47 geometries per Avarice pack respawn. disposeNode3D() frees what a
 * node owns; anything reused across instances must be marked shared (markShared /
 * sharedGeo / sharedMat) so it survives. Textures are never freed here: maps come from the
 * MatKit or module-level canvas caches.
 */
import * as THREE from "three";

// A registry, not a userData flag: Material.clone() copies userData, and a per-instance
// clone of a shared kit material must still be freed with its node.
const shared = new WeakSet<object>();

export function markShared<T extends object>(res: T): T {
  shared.add(res);
  return res;
}

export function isShared(res: object | null | undefined): boolean {
  return Boolean(res && shared.has(res));
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

/** One geometry per key for the whole session (marked shared). */
export function sharedGeo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = markShared(make());
    geoCache.set(key, g);
  }
  return g;
}

/** One material per key for the whole session (marked shared). */
export function sharedMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = markShared(make());
    matCache.set(key, m);
  }
  return m;
}

/** Dispose the non-shared geometries and materials under `root` (call after scene.remove). */
export function disposeNode3D(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite)) return;
    // Sprites all share three's internal quad geometry — never dispose it
    if (!(o as THREE.Sprite).isSprite && m.geometry && !isShared(m.geometry)) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (mat && !isShared(mat)) mat.dispose();
    }
    // Instance matrices are their own GPU buffer
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}
