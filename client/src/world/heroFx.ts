/**
 * Hero motion effects, all pooled (no per-frame or per-event allocation):
 *  - BladeTrail: a ribbon from a ring buffer of blade tip/base samples, so the
 *    swoosh follows the sword's real arc (fed by heroAnim.sampleBlade).
 *  - DustPool: footstep / dash dust puffs from a fixed set of meshes.
 *  - DashStreak: one camera-facing band stretched along the dash path.
 *
 * Shader warmth: idle effects are hidden (no draw call). Their programs still
 * exist before first use: WorldApp.prewarmShaders compiles hidden meshes too
 * (renderer.compile walks the whole scene) after every canto build and tier
 * change, and the real light count never changes at runtime (lightPool.ts).
 */
import * as THREE from "three";

// ——— blade trail ————————————————————————————————————————————————————————

const TRAIL_N = 28;

export class BladeTrail {
  readonly mesh: THREE.Mesh;
  private tip = new Float32Array(TRAIL_N * 3);
  private base = new Float32Array(TRAIL_N * 3);
  private time = new Float32Array(TRAIL_N);
  private head = 0;
  private count = 0;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private tint = new THREE.Color(0xfff2d8);
  /** Sample lifetime (ms): the ribbon length is this much of the arc. */
  life = 120;
  intensity = 1;

  /** `material`: share another trail's (same program, one material to keep warm). */
  constructor(material?: THREE.Material) {
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3);
    this.col.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.pos);
    geo.setAttribute("color", this.col);
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(
      geo,
      material ??
      new THREE.MeshBasicMaterial({
        // fog-independent: fewer program variants to keep warm
        fog: false,
        vertexColors: true,
        transparent: true,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        // like the old swoosh: canto haze never buries the cut
        depthTest: false,
      })
    );
    this.mesh.name = "bladeTrail";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  setTint(hex: number) {
    this.tint.setHex(hex);
  }

  clear() {
    this.count = 0;
    this.mesh.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  push(tip: THREE.Vector3, base: THREE.Vector3, tMs: number) {
    if (this.count > 0) {
      const prev = (this.head - 1 + TRAIL_N) % TRAIL_N;
      const dx = tip.x - this.tip[prev * 3]!;
      const dz = tip.z - this.tip[prev * 3 + 2]!;
      // A seam wrap jumps the blade; drop the ribbon instead of slicing the map.
      if (dx * dx + dz * dz > 144) this.clear();
    }
    if (!this.mesh.visible) this.mesh.visible = true;
    const i = this.head;
    this.tip[i * 3] = tip.x;
    this.tip[i * 3 + 1] = tip.y;
    this.tip[i * 3 + 2] = tip.z;
    this.base[i * 3] = base.x;
    this.base[i * 3 + 1] = base.y;
    this.base[i * 3 + 2] = base.z;
    this.time[i] = tMs;
    this.head = (i + 1) % TRAIL_N;
    this.count = Math.min(TRAIL_N, this.count + 1);
  }

  /** Rebuild the strip oldest → newest; fade by sample age (additive: colour = alpha). */
  update(tMs: number) {
    if (this.count < 2) return;
    const p = this.pos.array as Float32Array;
    const c = this.col.array as Float32Array;
    let live = 0;
    const start = (this.head - this.count + TRAIL_N) % TRAIL_N;
    for (let k = 0; k < this.count; k++) {
      const i = (start + k) % TRAIL_N;
      const age = tMs - this.time[i]!;
      const a = Math.max(0, 1 - age / this.life);
      if (a > 0) live++;
      const f = Math.pow(a, 1.4) * this.intensity;
      const o = k * 6;
      p[o] = this.tip[i * 3]!;
      p[o + 1] = this.tip[i * 3 + 1]!;
      p[o + 2] = this.tip[i * 3 + 2]!;
      p[o + 3] = this.base[i * 3]!;
      p[o + 4] = this.base[i * 3 + 1]!;
      p[o + 5] = this.base[i * 3 + 2]!;
      c[o] = this.tint.r * f;
      c[o + 1] = this.tint.g * f;
      c[o + 2] = this.tint.b * f;
      const fb = f * 0.05;
      c[o + 3] = this.tint.r * fb;
      c[o + 4] = this.tint.g * fb;
      c[o + 5] = this.tint.b * fb;
    }
    if (live === 0) {
      this.clear();
      return;
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, (this.count - 1) * 6);
  }
}

// ——— dust ————————————————————————————————————————————————————————————————

const DUST_N = 10;

type Puff = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; start: number; dur: number; size: number; alpha: number };

export class DustPool {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];
  private next = 0;

  constructor() {
    this.group.name = "heroDust";
    const geo = new THREE.RingGeometry(0.06, 0.22, 16);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < DUST_N; i++) {
      const mat = new THREE.MeshBasicMaterial({
        fog: false,
        color: 0xc4b08a,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.puffs.push({ mesh, mat, start: 0, dur: 1, size: 1, alpha: 0 });
    }
  }

  setColor(hex: number) {
    for (const p of this.puffs) p.mat.color.setHex(hex);
  }

  spawn(x: number, y: number, z: number, tMs: number, size = 1, alpha = 0.4, dur = 420) {
    const p = this.puffs[this.next]!;
    this.next = (this.next + 1) % DUST_N;
    p.mesh.position.set(x, y, z);
    p.start = tMs;
    p.dur = dur;
    p.size = size;
    p.alpha = alpha;
    p.mesh.visible = true;
    p.mesh.scale.setScalar(size);
    p.mat.opacity = alpha;
  }

  update(tMs: number) {
    for (let i = 0; i < DUST_N; i++) {
      const p = this.puffs[i]!;
      if (p.alpha === 0) continue;
      const u = (tMs - p.start) / p.dur;
      if (u >= 1 || u < 0) {
        p.alpha = 0;
        p.mat.opacity = 0;
        p.mesh.visible = false;
        continue;
      }
      p.mesh.scale.setScalar(p.size * (1 + u * 2.2));
      p.mat.opacity = p.alpha * (1 - u) * (1 - u);
    }
  }
}

// ——— dash streak —————————————————————————————————————————————————————————

const _a = new THREE.Vector3();
const _w = new THREE.Vector3();
const _v = new THREE.Vector3();

export class DashStreak {
  readonly mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private start = -1;
  private dur = 160;
  private mat: THREE.MeshBasicMaterial;

  constructor() {
    const geo = new THREE.BufferGeometry();
    // hidden while idle (see the header: prewarm keeps the program built)
    this.pos = new THREE.BufferAttribute(new Float32Array(6 * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.pos);
    // tail (0 edge, 1 centre, 2 edge) dark → head centre (4) bright, head edges dark:
    // additive, so the colour is the fade — a soft tapered wake, not a slab
    geo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0.9, 0.74, 0, 0, 0]), 3)
    );
    geo.setIndex([0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5]);
    this.mat = new THREE.MeshBasicMaterial({
      fog: false,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = "dashStreak";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  begin(from: THREE.Vector3, to: THREE.Vector3, tMs: number, durMs: number) {
    this.from.copy(from);
    this.to.copy(to);
    this.start = tMs;
    this.dur = durMs;
    this.mesh.visible = true;
  }

  private collapse() {
    (this.pos.array as Float32Array).fill(0);
    this.pos.needsUpdate = true;
    this.mat.opacity = 0;
    this.mesh.visible = false;
  }

  /** Drop the band (a dash that crossed the seam must not stretch across the canto). */
  cancel() {
    this.start = -1;
    this.collapse();
  }

  /** `head` is the hero's current world position (the streak ends at the body). */
  update(tMs: number, head: THREE.Vector3, camera: THREE.Camera) {
    if (this.start < 0) return;
    const e = tMs - this.start;
    const fadeMs = 240;
    if (e > this.dur + fadeMs || e < 0) {
      this.start = -1;
      this.collapse();
      return;
    }
    const alpha = e < this.dur ? 0.4 : 0.4 * (1 - (e - this.dur) / fadeMs);
    // the tail catches up after the dash so the band shrinks into the hero
    const tailK = e < this.dur ? 0 : Math.min(1, (e - this.dur) / fadeMs);
    _a.copy(head).sub(this.from);
    const len = _a.length();
    if (len < 0.05) {
      this.mat.opacity = 0;
      return;
    }
    _a.multiplyScalar(1 / len);
    camera.getWorldPosition(_v).sub(head).normalize();
    _w.crossVectors(_a, _v);
    if (_w.lengthSq() < 1e-6) _w.set(0, 1, 0);
    _w.normalize().multiplyScalar(0.34);
    const p = this.pos.array as Float32Array;
    const y = 1.2;
    const tx = this.from.x + (head.x - this.from.x) * tailK;
    const tz = this.from.z + (head.z - this.from.z) * tailK;
    const ty = this.from.y + (head.y - this.from.y) * tailK + y;
    const hy = head.y + y;
    for (let k = 0; k < 3; k++) {
      const s = 1 - k; // +1 edge, 0 centre, −1 edge
      p[k * 3] = tx + _w.x * s;
      p[k * 3 + 1] = ty + _w.y * s;
      p[k * 3 + 2] = tz + _w.z * s;
      p[9 + k * 3] = head.x + _w.x * s;
      p[9 + k * 3 + 1] = hy + _w.y * s;
      p[9 + k * 3 + 2] = head.z + _w.z * s;
    }
    this.pos.needsUpdate = true;
    this.mat.opacity = alpha;
  }
}
