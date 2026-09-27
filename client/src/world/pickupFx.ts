/**
 * Loot pickup feedback: a few rarity-coloured motes arc from the drop into the
 * hero. Pooled — fixed meshes, one shared geometry, one shared material per
 * rarity; nothing is allocated per pickup or per frame.
 */
import * as THREE from "three";
import { RARITY_HEX } from "./materials";

const MOTES_PER_PICKUP = 5;
const FLY_MS = 420;

type Mote = {
  mesh: THREE.Mesh;
  active: boolean;
  start: number;
  fx: number;
  fy: number;
  fz: number;
  /** Sideways arc offset so motes fan out instead of stacking. */
  side: number;
};

export class PickupFx {
  private motes: Mote[] = [];
  private mats = new Map<string, THREE.MeshBasicMaterial>();

  constructor(scene: THREE.Scene, compact: boolean) {
    const geo = new THREE.OctahedronGeometry(0.15, 0);
    const n = compact ? 12 : 20;
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(geo, this.mat("normal"));
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.motes.push({ mesh, active: false, start: 0, fx: 0, fy: 0, fz: 0, side: 0 });
    }
  }

  private mat(rarity: string): THREE.MeshBasicMaterial {
    const key = rarity in RARITY_HEX ? rarity : "normal";
    let m = this.mats.get(key);
    if (!m) {
      // Normal drops fly gold so they read; richer ones keep their rarity hue
      const hex = key === "normal" ? 0xf2dea0 : RARITY_HEX[key];
      m = new THREE.MeshBasicMaterial({
        color: hex,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.mats.set(key, m);
    }
    return m;
  }

  /** Launch motes from a drop at world (x, y, z). */
  spawn(x: number, y: number, z: number, rarity: string, nowMs: number) {
    const mat = this.mat(rarity);
    let launched = 0;
    for (const m of this.motes) {
      if (m.active) continue;
      m.active = true;
      m.start = nowMs + launched * 45;
      m.fx = x;
      m.fy = y;
      m.fz = z;
      m.side = (launched - (MOTES_PER_PICKUP - 1) / 2) * 0.55;
      m.mesh.material = mat;
      m.mesh.position.set(x, y, z);
      m.mesh.visible = false;
      if (++launched >= MOTES_PER_PICKUP) break;
    }
  }

  /** Per frame: fly toward the hero's chest (hx, hy, hz). */
  tick(nowMs: number, hx: number, hy: number, hz: number) {
    for (const m of this.motes) {
      if (!m.active) continue;
      const u = (nowMs - m.start) / FLY_MS;
      if (u < 0) continue;
      if (u >= 1) {
        m.active = false;
        m.mesh.visible = false;
        continue;
      }
      if (!m.mesh.visible) m.mesh.visible = true;
      const e = u * u * (3 - 2 * u);
      // Perpendicular (planar) to the flight line for the fan-out arc
      const dx = hx - m.fx;
      const dz = hz - m.fz;
      const len = Math.hypot(dx, dz) || 1;
      const arc = Math.sin(u * Math.PI);
      m.mesh.position.set(
        m.fx + dx * e + (-dz / len) * m.side * arc,
        m.fy + (hy - m.fy) * e + arc * 1.1,
        m.fz + dz * e + (dx / len) * m.side * arc
      );
      m.mesh.scale.setScalar(1.15 - 0.75 * u);
      m.mesh.rotation.y = u * 6;
    }
  }
}
