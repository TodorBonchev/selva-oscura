/**
 * Gluttony's pooled effects. Every pool is built once on arrival and freed on leaving
 * (dispose()); nothing allocates per frame.
 *
 *  - MudRipples: flat rings that spread and fade on the mud — a pilgrim's steps off the
 *    causeway, buried mounds bubbling, hailstones and clods landing, a shade tearing out
 *    of the ground. One instanced draw; the spread/fade runs in the vertex shader from
 *    a time uniform, so a ripple costs one attribute write when it starts, not per frame.
 *  - Hailstones: "grandine grossa" — ice lumps dropping onto each hail telegraph,
 *    landing on its deadline. Same pattern: start/end/time per instance, fall in shader.
 *  - Mounds: the bubbling mud over each buried shade (the ground's moss mound, instanced),
 *    heaving slowly; a woken one sinks away.
 *  - Clods: the fistful of mire in your hand, and thrown clods arcing onto a maw.
 */
import * as THREE from "three";
import type { MatKit } from "./materials";
import { sharedMat } from "./dispose";

// ——— ripples ——————————————————————————————————————————————————————————————

const RIPPLE_VERT = /* glsl */ `
  attribute vec4 aP;   // x, y (ground height), z, start time (s)
  attribute vec4 aS;   // radius, duration (s), alpha, colour mix (0 mud … 1 ice)
  uniform float uTime;
  varying float vA;
  varying float vMix;
  varying float vR;
  void main() {
    float age = (uTime - aP.w) / max(0.05, aS.y);
    if (age < 0.0 || age > 1.0) {
      vA = 0.0;
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
    float r = aS.x * (0.3 + 0.95 * (1.0 - (1.0 - age) * (1.0 - age)));
    vec3 wp = vec3(aP.x + position.x * r, aP.y + 0.05, aP.z + position.z * r);
    vA = aS.z * (1.0 - age) * (1.0 - age);
    vMix = aS.w;
    vR = length(position.xz);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const RIPPLE_FRAG = /* glsl */ `
  uniform vec3 uMud;
  uniform vec3 uIce;
  varying float vA;
  varying float vMix;
  varying float vR;
  void main() {
    // a soft band at the ring's rim (geometry is an annulus 0.72 … 1)
    float band = smoothstep(0.72, 0.86, vR) * (1.0 - smoothstep(0.9, 1.0, vR));
    float a = vA * band;
    if (a <= 0.004) discard;
    gl_FragColor = vec4(mix(uMud, uIce, vMix) * a, 1.0);
    #include <colorspace_fragment>
  }
`;

export class MudRipples {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private p: THREE.InstancedBufferAttribute;
  private s: THREE.InstancedBufferAttribute;
  private n: number;
  private next = 0;

  constructor(count: number) {
    this.n = count;
    const ring = new THREE.RingGeometry(0.72, 1, 28, 1).rotateX(-Math.PI / 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = ring.index;
    this.geo.setAttribute("position", ring.getAttribute("position"));
    this.p = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.s = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.p.setUsage(THREE.DynamicDrawUsage);
    this.s.setUsage(THREE.DynamicDrawUsage);
    // start long dead
    for (let i = 0; i < count; i++) this.p.setW(i, -1e4);
    this.geo.setAttribute("aP", this.p);
    this.geo.setAttribute("aS", this.s);
    this.geo.instanceCount = count;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMud: { value: new THREE.Color(0x9a9058) },
        uIce: { value: new THREE.Color(0xdce8f4) },
      },
      vertexShader: RIPPLE_VERT,
      fragmentShader: RIPPLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = "glutRipples";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Start a ripple (the oldest slot is reused). mix: 0 mud … 1 ice. */
  spawn(x: number, y: number, z: number, tSec: number, radius: number, dur: number, alpha: number, mix = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.p.setXYZW(i, x, y, z, tSec);
    this.s.setXYZW(i, radius, dur, alpha, mix);
    this.p.addUpdateRange(i * 4, 4);
    this.s.addUpdateRange(i * 4, 4);
    this.p.needsUpdate = true;
    this.s.needsUpdate = true;
  }

  update(tSec: number) {
    this.mat.uniforms.uTime.value = tSec;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ——— hailstones ————————————————————————————————————————————————————————————

const HAIL_VERT = /* glsl */ `
  attribute vec4 aFrom;  // start x, y, z, t0 (s)
  attribute vec4 aTo;    // end x, y, z, t1 (s)
  uniform float uTime;
  varying float vL;
  void main() {
    float u = (uTime - aFrom.w) / max(0.05, aTo.w - aFrom.w);
    if (u < 0.0 || u > 1.0) {
      vL = 0.0;
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
    // it falls: accelerating toward the mark
    vec3 c = mix(aFrom.xyz, aTo.xyz, u * u);
    float s = 0.7 + 0.3 * u;
    vL = 0.55 + 0.45 * max(0.0, normal.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(c + position * s, 1.0);
  }
`;

const HAIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vL;
  void main() {
    gl_FragColor = vec4(uColor * vL, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Hailstones {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private from: THREE.InstancedBufferAttribute;
  private to: THREE.InstancedBufferAttribute;
  private n: number;
  private next = 0;
  /** Landings still to come (for the splash): x, y, z, t1 per slot. */
  private land: Float32Array;

  constructor(count: number) {
    this.n = count;
    const stone = new THREE.IcosahedronGeometry(0.17, 0);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute("position", stone.getAttribute("position"));
    this.geo.setAttribute("normal", stone.getAttribute("normal"));
    this.from = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.to = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.from.setUsage(THREE.DynamicDrawUsage);
    this.to.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) {
      this.from.setW(i, -1e4);
      this.to.setW(i, -1e4 + 1);
    }
    this.geo.setAttribute("aFrom", this.from);
    this.geo.setAttribute("aTo", this.to);
    this.geo.instanceCount = count;
    this.land = new Float32Array(count * 4).fill(-1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xe6eef6) } },
      vertexShader: HAIL_VERT,
      fragmentShader: HAIL_FRAG,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = "glutHail";
    this.mesh.frustumCulled = false;
  }

  /** A stone dropping from (fx, fy, fz) at t0 onto (tx, ty, tz) at t1. */
  drop(fx: number, fy: number, fz: number, t0: number, tx: number, ty: number, tz: number, t1: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.from.setXYZW(i, fx, fy, fz, t0);
    this.to.setXYZW(i, tx, ty, tz, t1);
    this.from.addUpdateRange(i * 4, 4);
    this.to.addUpdateRange(i * 4, 4);
    this.from.needsUpdate = true;
    this.to.needsUpdate = true;
    this.land[i * 4] = tx;
    this.land[i * 4 + 1] = ty;
    this.land[i * 4 + 2] = tz;
    this.land[i * 4 + 3] = t1;
  }

  /** Per frame; calls onLand(x, y, z) for each stone that hit the ground since. */
  update(tSec: number, onLand: (x: number, y: number, z: number) => void) {
    this.mat.uniforms.uTime.value = tSec;
    const L = this.land;
    for (let i = 0; i < this.n; i++) {
      const t1 = L[i * 4 + 3]!;
      if (t1 < 0 || tSec < t1) continue;
      L[i * 4 + 3] = -1;
      onLand(L[i * 4]!, L[i * 4 + 1]!, L[i * 4 + 2]!);
    }
  }

  clear() {
    for (let i = 0; i < this.n; i++) {
      this.from.setW(i, -1e4);
      this.to.setW(i, -1e4 + 1);
      this.land[i * 4 + 3] = -1;
    }
    this.from.needsUpdate = true;
    this.to.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ——— buried mounds ————————————————————————————————————————————————————————

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

function moundMat(_mats: MatKit): THREE.MeshStandardMaterial {
  return sharedMat("glutMound", () => new THREE.MeshStandardMaterial({
    color: 0x5e5628,
    roughness: 0.36,
    metalness: 0.12,
    emissive: 0x3a4210,
    emissiveIntensity: 0.4,
  }));
}

export class BuriedMounds {
  readonly mesh: THREE.InstancedMesh;
  private geo: THREE.IcosahedronGeometry;
  private cap: number;
  /** x, groundY, z, phase per mound */
  private spots: Float32Array;
  private count = 0;
  /** 1 = still buried (drawn), 0 = risen / sinking */
  private alive: Uint8Array;
  /** performance seconds a mound began to sink (−1 = not sinking) */
  private sinkAt: Float32Array;

  constructor(mats: MatKit, cap: number) {
    this.cap = cap;
    this.geo = new THREE.IcosahedronGeometry(0.72, 0);
    // wet, bulging mud with a sick sheen (same program as the kit's standard materials)
    this.mesh = new THREE.InstancedMesh(this.geo, moundMat(mats), cap);
    this.mesh.name = "glutMounds";
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    // mounds spread over the whole mire: cull as one volume would draw them always
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.spots = new Float32Array(cap * 4);
    this.alive = new Uint8Array(cap);
    this.sinkAt = new Float32Array(cap).fill(-1);
  }

  /** Mound spots (flat [x, y, …]) with ground heights from `standY`. */
  setSpots(flat: number[], standY: (x: number, y: number) => number) {
    this.count = Math.min(this.cap, Math.floor(flat.length / 2));
    for (let i = 0; i < this.count; i++) {
      const x = Number(flat[i * 2]);
      const y = Number(flat[i * 2 + 1]);
      this.spots[i * 4] = x;
      this.spots[i * 4 + 1] = standY(x, y);
      this.spots[i * 4 + 2] = y;
      this.spots[i * 4 + 3] = (i * 2.399) % (Math.PI * 2);
      this.alive[i] = 1;
      this.sinkAt[i] = -1;
    }
    this.mesh.count = this.count;
  }

  get size(): number {
    return this.count;
  }

  isBuried(k: number): boolean {
    return k >= 0 && k < this.count && this.alive[k] === 1;
  }

  spot(k: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.spots[k * 4]!, this.spots[k * 4 + 1]!, this.spots[k * 4 + 2]!);
  }

  /** The server's still-buried mask; newly cleared bits start sinking. */
  applyMask(mask: number, tSec: number) {
    for (let k = 0; k < this.count; k++) {
      const on = (mask >>> k) & 1;
      if (!on && this.alive[k] === 1) {
        this.alive[k] = 0;
        this.sinkAt[k] = tSec;
      } else if (on && this.alive[k] === 0) {
        // world reset: it lies buried again
        this.alive[k] = 1;
        this.sinkAt[k] = -1;
      }
    }
  }

  /** Heave the mud (call at ~20 Hz; a handful of matrices). */
  update(tSec: number) {
    for (let k = 0; k < this.count; k++) {
      const ph = this.spots[k * 4 + 3]!;
      let sy = 0.4 + 0.07 * Math.sin(tSec * 2.1 + ph) + 0.04 * Math.sin(tSec * 5.3 + ph * 2);
      let sxz = 1.45 + 0.05 * Math.sin(tSec * 1.7 + ph);
      if (this.alive[k] === 0) {
        const t = this.sinkAt[k]! < 0 ? 1 : Math.min(1, (tSec - this.sinkAt[k]!) / 0.6);
        sy *= 1 - t;
        sxz *= 1 + 0.4 * t;
        if (t >= 1) sy = 0;
      }
      _p.set(this.spots[k * 4]!, this.spots[k * 4 + 1]! + 0.04, this.spots[k * 4 + 2]!);
      _e.set(0, ph, 0);
      _q.setFromEuler(_e);
      _s.set(sxz, Math.max(0.0001, sy), sxz * 0.86);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(k, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mesh.dispose();
  }
}

// ——— clods ——————————————————————————————————————————————————————————————————

type Flight = {
  mesh: THREE.Mesh;
  active: boolean;
  fx: number;
  fy: number;
  fz: number;
  tid: string;
  tx: number;
  ty: number;
  tz: number;
  t0: number;
  dur: number;
};

/** The fistful in your hand and the ones in the air (a small fixed pool). */
export class Clods {
  readonly group = new THREE.Group();
  readonly hand: THREE.Mesh;
  private geo: THREE.IcosahedronGeometry;
  private flights: Flight[] = [];

  constructor(mats: MatKit) {
    this.group.name = "glutClods";
    this.geo = new THREE.IcosahedronGeometry(0.2, 1);
    this.hand = new THREE.Mesh(this.geo, mats.moss);
    this.hand.visible = false;
    this.hand.castShadow = false;
    this.group.add(this.hand);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(this.geo, mats.moss);
      m.visible = false;
      m.castShadow = false;
      m.scale.setScalar(1.3);
      this.group.add(m);
      this.flights.push({ mesh: m, active: false, fx: 0, fy: 0, fz: 0, tid: "", tx: 0, ty: 0, tz: 0, t0: 0, dur: 1 });
    }
  }

  throw(fx: number, fy: number, fz: number, tid: string, tx: number, ty: number, tz: number, tSec: number, dur: number) {
    let f = this.flights.find((x) => !x.active);
    if (!f) f = this.flights.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    f.active = true;
    f.fx = fx;
    f.fy = fy;
    f.fz = fz;
    f.tid = tid;
    f.tx = tx;
    f.ty = ty;
    f.tz = tz;
    f.t0 = tSec;
    f.dur = Math.max(0.12, dur);
    f.mesh.visible = true;
  }

  /**
   * Per frame. aim(tid, out) may refresh a flight's target point (the maw moves);
   * onLand(x, y, z) when one arrives.
   */
  update(
    tSec: number,
    aim: (tid: string, out: THREE.Vector3) => boolean,
    onLand: (x: number, y: number, z: number) => void
  ) {
    for (const f of this.flights) {
      if (!f.active) continue;
      if (aim(f.tid, _p)) {
        f.tx = _p.x;
        f.ty = _p.y;
        f.tz = _p.z;
      }
      const u = (tSec - f.t0) / f.dur;
      if (u >= 1) {
        f.active = false;
        f.mesh.visible = false;
        onLand(f.tx, f.ty, f.tz);
        continue;
      }
      const arc = 4 * u * (1 - u) * (1.2 + 0.08 * Math.hypot(f.tx - f.fx, f.tz - f.fz));
      f.mesh.position.set(f.fx + (f.tx - f.fx) * u, f.fy + (f.ty - f.fy) * u + arc, f.fz + (f.tz - f.fz) * u);
      f.mesh.rotation.x = u * 9;
      f.mesh.rotation.z = u * 5;
    }
  }

  clear() {
    for (const f of this.flights) {
      f.active = false;
      f.mesh.visible = false;
    }
    this.hand.visible = false;
  }

  dispose() {
    this.group.removeFromParent();
    this.geo.dispose();
  }
}
