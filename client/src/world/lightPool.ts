/**
 * Fixed point-light budget.
 *
 * Scene code places VirtualLight markers (plain Object3Ds with PointLight-like fields)
 * instead of real PointLights. Each frame LightPool picks the strongest markers near the
 * camera focus and drives a fixed set of real PointLights with them. The count of real
 * lights in the scene never changes, so three.js never recompiles shaders mid-fight
 * (adding one PointLight used to rebuild ~9 programs, a 60–200ms hitch), and idle or
 * far glows cost nothing per pixel.
 *
 * Markers keep the PointLight fields existing code writes (color, intensity, distance,
 * decay, visible), so they are drop-in at creation sites.
 */
import * as THREE from "three";

const registry = new Set<VirtualLight>();

export class VirtualLight extends THREE.Object3D {
  readonly isVirtualLight = true;
  color: THREE.Color;
  intensity: number;
  distance: number;
  decay: number;
  /** Score multiplier when competing for a real light (hit flash / slam > glows). */
  priority: number;
  /** Frames spent detached from the scene; pruned from the registry after a while. */
  _orphan = 0;
  /** World position cached by LightPool.update for this frame. */
  _wp = new THREE.Vector3();

  constructor(color: THREE.ColorRepresentation = 0xffffff, intensity = 1, distance = 0, decay = 2, priority = 1) {
    super();
    this.color = new THREE.Color(color);
    this.intensity = intensity;
    this.distance = distance;
    this.decay = decay;
    this.priority = priority;
    registry.add(this);
  }
}

export function isVirtualLight(o: THREE.Object3D | null | undefined): o is VirtualLight {
  return Boolean(o && (o as VirtualLight).isVirtualLight);
}

type Slot = {
  light: THREE.PointLight;
  src: VirtualLight | null;
};

/**
 * Markers closer than this share one real light: the target-portal fill sits on top of
 * that portal's own glow, a boss glow on its telegraph light — one lamp, not two slots.
 */
const CLUSTER_R = 2.6;

/** Is `o` attached to `root` with every ancestor visible? */
function liveIn(o: THREE.Object3D, root: THREE.Object3D): boolean | null {
  let visible = o.visible;
  let n: THREE.Object3D | null = o.parent;
  while (n) {
    if (!n.visible) visible = false;
    if (n === root) return visible;
    n = n.parent;
  }
  return null; // detached
}

export class LightPool {
  slots: Slot[] = [];
  private scene: THREE.Scene;
  private cand: VirtualLight[] = [];
  private score = new Map<VirtualLight, number>();
  /** Intensity of nearby markers folded into a head's light (see CLUSTER_R). */
  private extra = new Map<VirtualLight, number>();
  private heads: VirtualLight[] = [];
  private byScore = (a: VirtualLight, b: VirtualLight) => this.score.get(b)! - this.score.get(a)!;

  private slotOf(v: VirtualLight): number {
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].src === v) return i;
    return -1;
  }

  constructor(scene: THREE.Scene, count: number) {
    this.scene = scene;
    this.setCount(count);
  }

  /** Change the real-light budget (tier change only — it recompiles lit programs). */
  setCount(count: number) {
    while (this.slots.length > count) {
      const s = this.slots.pop()!;
      this.scene.remove(s.light);
      s.light.dispose();
    }
    while (this.slots.length < count) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2);
      light.name = `pooledLight${this.slots.length}`;
      light.castShadow = false;
      this.scene.add(light);
      this.slots.push({ light, src: null });
    }
  }

  /**
   * Assign markers to real lights around `focus` (the camera's follow point).
   * Call once per frame before rendering.
   */
  update(focus: THREE.Vector3, dt: number) {
    const cand = this.cand;
    cand.length = 0;
    this.score.clear();
    for (const v of registry) {
      const live = liveIn(v, this.scene);
      if (live === null) {
        // Detached (despawned node / removed fx): forget it after ~2s of absence
        if (++v._orphan > 120) registry.delete(v);
        continue;
      }
      v._orphan = 0;
      if (!live || v.intensity <= 0.01) continue;
      const p = v.getWorldPosition(v._wp);
      const reach = v.distance > 0 ? v.distance : 20;
      const dx = p.x - focus.x;
      const dz = p.z - focus.z;
      const d2 = dx * dx + dz * dz;
      const lim = reach + 18;
      if (d2 > lim * lim) continue;
      const k = Math.sqrt(d2) / (reach * 0.8 + 4);
      let s = (v.intensity * v.priority) / (1 + k * k);
      // Hysteresis: a light already driving a slot keeps it unless clearly beaten
      if (this.slotOf(v) >= 0) s *= 1.3;
      this.score.set(v, s);
      cand.push(v);
    }
    cand.sort(this.byScore);
    // Pick cluster heads in score order; markers near a head fold into its light
    const heads = this.heads;
    heads.length = 0;
    this.extra.clear();
    for (const v of cand) {
      let merged = false;
      for (const h of heads) {
        if (h._wp.distanceToSquared(v._wp) < CLUSTER_R * CLUSTER_R) {
          this.extra.set(h, (this.extra.get(h) || 0) + v.intensity * 0.5);
          merged = true;
          break;
        }
      }
      if (merged || heads.length >= this.slots.length) continue;
      heads.push(v);
      this.extra.set(v, 0);
    }
    // Keep heads on their current slot (no position pops), free the rest
    for (const sl of this.slots) {
      if (sl.src && heads.indexOf(sl.src) < 0) sl.src = null;
    }
    for (const v of heads) {
      if (this.slotOf(v) >= 0) continue;
      for (const sl of this.slots) {
        if (sl.src === null) {
          sl.src = v;
          break;
        }
      }
    }
    for (const sl of this.slots) {
      const L = sl.light;
      if (sl.src) {
        const v = sl.src;
        L.position.copy(v._wp);
        L.color.copy(v.color);
        L.intensity = v.intensity + (this.extra.get(v) || 0);
        L.distance = v.distance;
        L.decay = v.decay;
      } else if (L.intensity > 0) {
        // Fade out instead of toggling visibility (visibility changes recompile)
        L.intensity = L.intensity > 0.05 ? L.intensity * Math.exp(-dt * 16) : 0;
      }
    }
  }
}
