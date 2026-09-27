/**
 * Pooled combat effects that must never allocate mid-fight:
 *  - HitFlashPool: a brief additive white shell over a struck foe's body (mobs share
 *    materials per kind, so the flash is an overlay, not a material tweak),
 *  - AshBurstPool: rising embers / ash / gold dust when a foe dies.
 * Every mesh and material is built once; spawn() reuses the oldest slot when full.
 */
import * as THREE from "three";
import { softDotTexture } from "./fx";
import { markShared } from "./dispose";

const FLASH_N = 8;

type Flash = {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  start: number;
  dur: number;
  alpha: number;
  active: boolean;
};

/**
 * Hit flash as an additive "shell": a pooled mesh that borrows the struck foe's own
 * body geometry and rides on that mesh for ~120 ms, lighting its visible surface
 * (same depth → LessEqual passes exactly where the body is). Foes keep their shared
 * per-kind materials; each slot owns one additive material (one program for all).
 */
export class HitFlashPool {
  /** Parking spot for idle slots (kept in the scene so prewarm compiles the program). */
  readonly group = new THREE.Group();
  private items: Flash[] = [];
  private next = 0;
  private parkGeo: THREE.BufferGeometry;

  constructor() {
    this.group.name = "hitFlashes";
    this.parkGeo = markShared(new THREE.BufferGeometry());
    this.parkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
    for (let i = 0; i < FLASH_N; i++) {
      const mat = markShared(
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        })
      );
      const mesh = new THREE.Mesh(this.parkGeo, mat);
      mesh.name = "hitFlashShell";
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      this.items.push({ mesh, mat, start: 0, dur: 1, alpha: 0, active: false });
    }
  }

  /** Light up `target` (a foe's body mesh) for durMs. */
  flash(target: THREE.Mesh, color: number, nowMs: number, alpha = 0.7, durMs = 120) {
    // the same foe flashing again reuses its slot
    let f = this.items.find((x) => x.active && x.mesh.parent === target);
    if (!f) {
      f = this.items[this.next]!;
      this.next = (this.next + 1) % FLASH_N;
      if (f.active) this.park(f);
    }
    f.mesh.geometry = target.geometry;
    f.mesh.position.set(0, 0, 0);
    f.mesh.rotation.set(0, 0, 0);
    f.mesh.scale.set(1, 1, 1);
    if (f.mesh.parent !== target) target.add(f.mesh);
    f.mat.color.setHex(color);
    f.mat.opacity = alpha;
    f.alpha = alpha;
    f.start = nowMs;
    f.dur = durMs;
    f.active = true;
    f.mesh.visible = true;
  }

  private park(f: Flash) {
    f.active = false;
    f.mesh.visible = false;
    f.mat.opacity = 0;
    f.mesh.geometry = this.parkGeo;
    this.group.add(f.mesh);
  }

  /** Take every shell off `root` (before the foe is disposed). */
  release(root: THREE.Object3D) {
    for (const f of this.items) {
      if (!f.active) continue;
      let p: THREE.Object3D | null = f.mesh.parent;
      while (p && p !== root) p = p.parent;
      if (p === root) this.park(f);
    }
  }

  update(nowMs: number) {
    for (let i = 0; i < FLASH_N; i++) {
      const f = this.items[i]!;
      if (!f.active) continue;
      const u = (nowMs - f.start) / f.dur;
      if (u >= 1 || u < 0) {
        this.park(f);
        continue;
      }
      f.mat.opacity = f.alpha * (1 - u) * (1 - u);
    }
  }

  clear() {
    for (const f of this.items) if (f.active) this.park(f);
  }
}

const ASH_BURSTS = 6;
const ASH_N = 26;

type Ash = {
  points: THREE.Points;
  mat: THREE.PointsMaterial;
  pos: THREE.BufferAttribute;
  vel: Float32Array;
  start: number;
  last: number;
  dur: number;
  active: boolean;
};

export class AshBurstPool {
  readonly group = new THREE.Group();
  private items: Ash[] = [];
  private next = 0;

  constructor() {
    this.group.name = "ashBursts";
    const tex = softDotTexture();
    for (let i = 0; i < ASH_BURSTS; i++) {
      const geo = markShared(new THREE.BufferGeometry());
      const pos = new THREE.BufferAttribute(new Float32Array(ASH_N * 3), 3);
      pos.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("position", pos);
      const mat = markShared(
        new THREE.PointsMaterial({
          map: tex,
          color: 0xffa050,
          size: 0.2,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          sizeAttenuation: true,
          fog: false,
        })
      );
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.visible = false;
      this.group.add(points);
      this.items.push({ points, mat, pos, vel: new Float32Array(ASH_N * 3), start: 0, last: 0, dur: 1, active: false });
    }
  }

  /**
   * Burst at a foe's feet: `size` scales spread/lift (bosses ≈2.5), `rise` how much
   * the motes float up (ash) versus scatter (sparks).
   */
  spawn(x: number, y: number, z: number, color: number, nowMs: number, size = 1, durMs = 900, rise = 1) {
    const b = this.items[this.next]!;
    this.next = (this.next + 1) % ASH_BURSTS;
    const a = b.pos.array as Float32Array;
    for (let i = 0; i < ASH_N; i++) {
      const o = i * 3;
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.45 * size;
      a[o] = x + Math.cos(ang) * r;
      a[o + 1] = y + 0.2 + Math.random() * 1.2 * size;
      a[o + 2] = z + Math.sin(ang) * r;
      const sp = (0.6 + Math.random() * 1.8) * size;
      b.vel[o] = Math.cos(ang) * sp;
      b.vel[o + 1] = (0.8 + Math.random() * 2.2) * rise * Math.sqrt(size);
      b.vel[o + 2] = Math.sin(ang) * sp;
    }
    b.pos.needsUpdate = true;
    b.mat.color.setHex(color);
    b.mat.opacity = 1;
    b.mat.size = 0.16 + 0.05 * size;
    b.start = nowMs;
    b.last = nowMs;
    b.dur = durMs;
    b.active = true;
    b.points.visible = true;
  }

  update(nowMs: number) {
    for (let k = 0; k < ASH_BURSTS; k++) {
      const b = this.items[k]!;
      if (!b.active) continue;
      const u = (nowMs - b.start) / b.dur;
      if (u >= 1 || u < 0) {
        b.active = false;
        b.points.visible = false;
        b.mat.opacity = 0;
        continue;
      }
      const dt = Math.min(0.05, Math.max(0, (nowMs - b.last) / 1000));
      b.last = nowMs;
      const drag = Math.exp(-2.6 * dt);
      const a = b.pos.array as Float32Array;
      for (let i = 0; i < ASH_N; i++) {
        const o = i * 3;
        b.vel[o] *= drag;
        b.vel[o + 2] *= drag;
        // ash floats: a little buoyancy that the drag bleeds off
        b.vel[o + 1] = b.vel[o + 1] * drag + 0.6 * dt;
        a[o] += b.vel[o] * dt;
        a[o + 1] += b.vel[o + 1] * dt;
        a[o + 2] += b.vel[o + 2] * dt;
      }
      b.pos.needsUpdate = true;
      b.mat.opacity = u < 0.15 ? 1 : (1 - u) / 0.85;
    }
  }

  clear() {
    for (const b of this.items) {
      b.active = false;
      b.points.visible = false;
    }
  }
}
