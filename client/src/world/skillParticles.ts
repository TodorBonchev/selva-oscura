/**
 * Pooled skill particles and ground decals.
 * One Points draw per blend mode. Buffers are allocated once; emit and tick
 * only write into them (no Vector3 / Color / array per call).
 * World axes: x, height y, planar z (the game's ground y).
 */
import * as THREE from "three";
import { setPlanar } from "./frames";

type Tier = "low" | "mid" | "high";

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uAtt;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uAtt / max(0.6, -mv.z), 0.0, 56.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float a = smoothstep(0.5, 0.12, length(d)) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }
`;

function tierMul(tier: Tier): number {
  if (tier === "low") return 0.35;
  if (tier === "mid") return 0.7;
  return 1;
}

/** high 1200 / mid 700 / low 280, split glow:smoke about 7:3. */
function capacities(tier: Tier): [number, number] {
  if (tier === "low") return [196, 84];
  if (tier === "mid") return [490, 210];
  return [840, 360];
}

class Layer {
  readonly points: THREE.Points;
  readonly cap: number;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private sz: THREE.BufferAttribute;
  private al: THREE.BufferAttribute;
  private px: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private baseA: Float32Array;
  private head = 0;
  private alive = 0;
  private tint = new THREE.Color();

  constructor(cap: number, additive: boolean) {
    this.cap = cap;
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(cap * 3);
    const c = new Float32Array(cap * 3);
    const s = new Float32Array(cap);
    const a = new Float32Array(cap);
    this.pos = new THREE.BufferAttribute(p, 3);
    this.col = new THREE.BufferAttribute(c, 3);
    this.sz = new THREE.BufferAttribute(s, 1);
    this.al = new THREE.BufferAttribute(a, 1);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    this.sz.setUsage(THREE.DynamicDrawUsage);
    this.al.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.pos);
    geo.setAttribute("aColor", this.col);
    geo.setAttribute("aSize", this.sz);
    geo.setAttribute("aAlpha", this.al);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAtt: { value: 780 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 4;
    this.points.name = additive ? "skillGlow" : "skillSmoke";
    this.px = p;
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.baseA = new Float32Array(cap);
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    lifeMs: number,
    size0: number,
    size1: number,
    colorHex: number,
    alpha: number,
    gravity: number,
    drag: number
  ) {
    const i = this.head;
    this.head = (i + 1) % this.cap;
    const was = this.life[i] > this.age[i];
    const o = i * 3;
    this.px[o] = x;
    this.px[o + 1] = y;
    this.px[o + 2] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = lifeMs > 40 ? lifeMs : 40;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.baseA[i] = alpha;
    this.tint.setHex(colorHex);
    const ca = this.col.array as Float32Array;
    ca[o] = this.tint.r;
    ca[o + 1] = this.tint.g;
    ca[o + 2] = this.tint.b;
    const sa = this.sz.array as Float32Array;
    const aa = this.al.array as Float32Array;
    sa[i] = size0;
    aa[i] = alpha;
    if (!was) this.alive++;
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.sz.needsUpdate = true;
    this.al.needsUpdate = true;
  }

  private warm = 45;
  step(dt: number, dtMs: number) {
    if (this.alive <= 0) {
      // nothing live: skip the draw call (after a short warm-up so the shader compiles at load)
      if (this.warm > 0) this.warm--;
      else if (this.points.visible) this.points.visible = false;
      return;
    }
    if (!this.points.visible) this.points.visible = true;
    const sa = this.sz.array as Float32Array;
    const aa = this.al.array as Float32Array;
    const n = this.cap;
    for (let i = 0; i < n; i++) {
      const life = this.life[i];
      if (!(life > this.age[i])) continue;
      this.age[i] += dtMs;
      if (this.age[i] >= life) {
        this.life[i] = 0;
        this.age[i] = 1;
        sa[i] = 0;
        aa[i] = 0;
        this.alive--;
        continue;
      }
      const u = this.age[i] / life;
      let k = 1;
      const drag = this.drag[i];
      if (drag > 0 && dt > 0) k = Math.exp(-drag * dt);
      this.vx[i] *= k;
      this.vy[i] = this.vy[i] * k + this.grav[i] * dt;
      this.vz[i] *= k;
      const o = i * 3;
      this.px[o] += this.vx[i] * dt;
      this.px[o + 1] += this.vy[i] * dt;
      this.px[o + 2] += this.vz[i] * dt;
      sa[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * u;
      const fade = u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
      aa[i] = this.baseA[i] * fade;
    }
    this.pos.needsUpdate = true;
    this.sz.needsUpdate = true;
    this.al.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.age.fill(1);
    (this.sz.array as Float32Array).fill(0);
    (this.al.array as Float32Array).fill(0);
    this.alive = 0;
    this.sz.needsUpdate = true;
    this.al.needsUpdate = true;
  }
}

export class SkillParticles {
  private glow: Layer;
  private smoke: Layer;
  private last = -1;
  private tierOf: () => Tier;

  constructor(scene: THREE.Scene, tier: () => Tier) {
    this.tierOf = tier;
    const [g, s] = capacities(tier());
    this.glow = new Layer(g, true);
    this.smoke = new Layer(s, false);
    scene.add(this.glow.points, this.smoke.points);
  }

  private n(count: number): number {
    if (!(count > 0)) return 0;
    const scaled = Math.round(count * tierMul(this.tierOf()));
    return scaled < 1 ? 1 : scaled;
  }

  private layer(id: 0 | 1): Layer {
    return id === 1 ? this.smoke : this.glow;
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    lifeMs: number,
    size0: number,
    size1: number,
    colorHex: number,
    alpha: number,
    gravity: number,
    drag: number,
    layer: 0 | 1
  ) {
    this.layer(layer).emit(x, y, z, vx, vy, vz, lifeMs, size0, size1, colorHex, alpha, gravity, drag);
  }

  /** Omnidirectional burst. `h` is world height. */
  burst(
    x: number,
    z: number,
    h: number,
    count: number,
    speed: number,
    color: number,
    life = 640,
    size0 = 0.22,
    size1 = 0.05,
    up = 2.4,
    gravity = -5.5,
    layer: 0 | 1 = 0,
    drag = 1.15
  ) {
    const n = this.n(count);
    const L = this.layer(layer);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = speed * (0.45 + Math.random() * 0.7);
      L.emit(
        x,
        h + Math.random() * 0.25,
        z,
        Math.cos(ang) * sp,
        up * (0.35 + Math.random() * 0.85),
        Math.sin(ang) * sp,
        life,
        size0,
        size1,
        color,
        0.9,
        gravity,
        drag
      );
    }
  }

  /** Dust / sparks kicked out along the ground. */
  ringBurst(
    x: number,
    z: number,
    count: number,
    speed: number,
    color: number,
    h = 0.25,
    life = 720,
    layer: 0 | 1 = 1,
    up = 1.15
  ) {
    const n = this.n(count);
    const L = this.layer(layer);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const sp = speed * (0.65 + Math.random() * 0.5);
      L.emit(
        x,
        h,
        z,
        Math.cos(ang) * sp,
        up * (0.25 + Math.random() * 0.75),
        Math.sin(ang) * sp,
        life,
        layer === 1 ? 0.34 : 0.2,
        layer === 1 ? 0.1 : 0.04,
        color,
        layer === 1 ? 0.55 : 0.88,
        layer === 1 ? -3.2 : -2.2,
        1.4
      );
    }
  }

  /** Trail of motes along a ground segment. `h` is world height. */
  streak(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    count: number,
    color: number,
    h = 0.8,
    life = 680,
    layer: 0 | 1 = 0
  ) {
    const n = this.n(count);
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const L = this.layer(layer);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const side = (Math.random() - 0.5) * 0.45;
      L.emit(
        x0 + dx * t - uz * side,
        h + Math.random() * 0.55,
        z0 + dz * t + ux * side,
        ux * (0.4 + Math.random() * 1.6) + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.25) * 1.4,
        uz * (0.4 + Math.random() * 1.6) + (Math.random() - 0.5) * 0.6,
        life,
        0.2,
        0.04,
        color,
        0.88,
        -1.6,
        0.8
      );
    }
  }

  /**
   * Motes ease inward to (x, h, z). `travel` is the collapse time; `life` keeps
   * them on screen after they arrive.
   */
  converge(
    x: number,
    z: number,
    h: number,
    radius: number,
    count: number,
    color: number,
    life = 520,
    travel = 200
  ) {
    const n = this.n(count);
    const T = Math.max(0.08, Math.min(life, travel) / 1000);
    const drag = 7;
    const v0 = (radius * drag) / (1 - Math.exp(-drag * T));
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rad = radius * (0.82 + (i % 5) * 0.04);
      const cy = Math.cos(ang);
      const sy = Math.sin(ang);
      const py = h + Math.sin(ang * 2) * 0.28;
      this.glow.emit(
        x + cy * rad,
        py,
        z + sy * rad,
        -cy * v0,
        ((h - py) / T) * 0.35,
        -sy * v0,
        life,
        0.2,
        0.07,
        color,
        0.9,
        0,
        drag
      );
    }
  }

  /** Embers / motes drifting up out of a disc. */
  rise(
    x: number,
    z: number,
    radius: number,
    count: number,
    color: number,
    h = 0.3,
    life = 980,
    speed = 1.55,
    layer: 0 | 1 = 0
  ) {
    const n = this.n(count);
    const L = this.layer(layer);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      L.emit(
        x + Math.cos(ang) * r,
        h + Math.random() * 0.2,
        z + Math.sin(ang) * r,
        (Math.random() - 0.5) * 0.45,
        speed * (0.55 + Math.random() * 0.7),
        (Math.random() - 0.5) * 0.45,
        life,
        0.16,
        0.04,
        color,
        0.85,
        0.35,
        0.45
      );
    }
  }

  tick(now: number) {
    let dt = 0;
    if (this.last >= 0) dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0;
    else if (dt > 0.05) dt = 0.05;
    const dtMs = dt * 1000;
    this.glow.step(dt, dtMs);
    this.smoke.step(dt, dtMs);
  }

  clear() {
    this.glow.clear();
    this.smoke.clear();
  }
}

export type DecalKind = "scorch" | "crack" | "crackLit" | "rune";

const TEX = new Map<DecalKind, THREE.CanvasTexture>();

function decalTexture(kind: DecalKind): THREE.CanvasTexture {
  const hit = TEX.get(kind);
  if (hit) return hit;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const cx = S / 2;
  const cy = S / 2;
  if (kind === "scorch") {
    const grd = g.createRadialGradient(cx, cy, 4, cx, cy, S * 0.5);
    grd.addColorStop(0, "rgba(22,8,5,0.9)");
    grd.addColorStop(0.38, "rgba(42,14,8,0.62)");
    grd.addColorStop(0.62, "rgba(58,18,8,0.22)");
    grd.addColorStop(0.78, "rgba(255,112,36,0.62)");
    grd.addColorStop(0.9, "rgba(255,78,18,0.16)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  } else if (kind === "crack") {
    const wash = g.createRadialGradient(cx, cy, 2, cx, cy, S * 0.48);
    wash.addColorStop(0, "rgba(14,8,6,0.8)");
    wash.addColorStop(0.6, "rgba(18,10,8,0.28)");
    wash.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = wash;
    g.fillRect(0, 0, S, S);
    g.lineCap = "round";
    g.lineJoin = "round";
    const arms = [
      [1, 0.02],
      [0.2, 0.42],
      [-0.15, 0.62],
      [-0.9, 0.08],
      [-0.05, -0.72],
      [0.28, -0.38],
      [0.72, 0.4],
      [0.5, -0.5],
    ];
    for (let a = 0; a < arms.length; a++) {
      const dx = arms[a][0];
      const dy = arms[a][1];
      g.beginPath();
      g.moveTo(cx, cy);
      const steps = 4;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const jx = (i & 1) === 0 ? 7 : -6;
        const jy = (i & 1) === 0 ? -5 : 6;
        g.lineTo(cx + dx * t * S * 0.46 + jx, cy + dy * t * S * 0.46 + jy);
      }
      g.strokeStyle = "rgba(255,122,42,0.5)";
      g.lineWidth = 5;
      g.stroke();
      g.strokeStyle = "rgba(12,8,6,0.95)";
      g.lineWidth = 2.2;
      g.stroke();
    }
  } else if (kind === "crackLit") {
    // Earthsplitter seam: soft dark bed, a black outline, a molten core and a white
    // centre line — contrast on any floor (normal blending, untinted)
    const wash = g.createRadialGradient(cx, cy, 2, cx, cy, S * 0.48);
    wash.addColorStop(0, "rgba(10,6,4,0.55)");
    wash.addColorStop(0.65, "rgba(10,6,4,0.18)");
    wash.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = wash;
    g.fillRect(0, 0, S, S);
    g.lineCap = "round";
    g.lineJoin = "round";
    const arms = [
      [1, 0.02],
      [0.2, 0.42],
      [-0.15, 0.62],
      [-0.95, 0.06],
      [-0.05, -0.72],
      [0.28, -0.38],
      [0.72, 0.4],
    ];
    const pass = (style: string, width: number) => {
      for (let a = 0; a < arms.length; a++) {
        const dx = arms[a][0];
        const dy = arms[a][1];
        const main = a === 0 || a === 3;
        g.beginPath();
        g.moveTo(cx, cy);
        const steps = 4;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const jx = (i & 1) === 0 ? 7 : -6;
          const jy = (i & 1) === 0 ? -5 : 6;
          g.lineTo(cx + dx * t * S * (main ? 0.48 : 0.34) + jx, cy + dy * t * S * (main ? 0.48 : 0.34) + jy);
        }
        g.strokeStyle = style;
        g.lineWidth = main ? width : width * 0.65;
        g.stroke();
      }
    };
    pass("rgba(0,0,0,0.85)", 9);
    pass("rgba(255,150,50,0.95)", 5);
    pass("rgba(255,238,190,1)", 2.2);
  } else {
    const glow = g.createRadialGradient(cx, cy, 4, cx, cy, S * 0.42);
    glow.addColorStop(0, "rgba(255,236,190,0.35)");
    glow.addColorStop(0.6, "rgba(244,210,122,0.12)");
    glow.addColorStop(1, "rgba(244,210,122,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = "rgba(255,244,220,0.95)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, S * 0.36, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(cx, cy, S * 0.22, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * S * 0.24, cy + Math.sin(a) * S * 0.24);
      g.lineTo(cx + Math.cos(a) * S * 0.38, cy + Math.sin(a) * S * 0.38);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(cx, cy - S * 0.12);
    g.lineTo(cx + S * 0.09, cy + S * 0.02);
    g.lineTo(cx, cy + S * 0.14);
    g.lineTo(cx - S * 0.09, cy + S * 0.02);
    g.closePath();
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  TEX.set(kind, tex);
  return tex;
}

type DecalSlot = {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t0: number;
  life: number;
  on: boolean;
  /** Stamp t0 from the sim clock on the next tick. */
  arm: boolean;
};

export class GroundDecals {
  private slots: DecalSlot[] = [];
  private cursor = 0;
  private geo: THREE.PlaneGeometry;
  private standY: (x: number, y: number, h?: number) => number;
  private tierOf: () => Tier;

  constructor(scene: THREE.Scene, standY: (x: number, y: number, h?: number) => number, tier: () => Tier) {
    this.standY = standY;
    this.tierOf = tier;
    const t = tier();
    const cap = t === "low" ? 5 : t === "mid" ? 9 : 14;
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < cap; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: decalTexture("scorch"),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        forceSinglePass: true,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      mesh.visible = false;
      mesh.name = "skillDecal";
      scene.add(mesh);
      this.slots.push({ mesh, mat, t0: 0, life: 1, on: false, arm: false });
    }
  }

  private limit(): number {
    const want = this.tierOf() === "low" ? 5 : this.tierOf() === "mid" ? 9 : 14;
    return Math.min(want, this.slots.length);
  }

  /** Flat ground mark. Fades in fast, holds, then eases out. Life clamped to 2.5–4 s. */
  spawn(kind: DecalKind, x: number, y: number, radius: number, colorHex: number, lifeMs: number, yaw: number) {
    const cap = this.limit();
    if (cap <= 0) return;
    const s = this.slots[this.cursor % cap];
    this.cursor = (this.cursor + 1) % cap;
    const life = Math.max(2500, Math.min(4000, lifeMs));
    s.mat.map = decalTexture(kind);
    s.mat.blending = kind === "rune" ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.mat.color.setHex(colorHex);
    s.mat.opacity = 0.25;
    s.mat.needsUpdate = true;
    s.mesh.rotation.set(0, yaw, 0);
    s.mesh.scale.setScalar(Math.max(0.4, radius) * 2);
    setPlanar(s.mesh.position, x, y, this.standY(x, y, 0.04));
    s.mesh.visible = true;
    s.t0 = 0;
    s.life = life;
    s.on = true;
    s.arm = true;
  }

  tick(now: number) {
    const n = this.slots.length;
    for (let i = 0; i < n; i++) {
      const s = this.slots[i];
      if (!s.on) continue;
      if (s.arm) {
        s.t0 = now;
        s.arm = false;
      }
      const u = (now - s.t0) / s.life;
      if (u >= 1) {
        s.on = false;
        s.mesh.visible = false;
        continue;
      }
      const inn = 0.045;
      let a: number;
      if (u < inn) a = 0.25 + 0.75 * (u / inn);
      else {
        const v = (u - inn) / (1 - inn);
        a = 1 - v * v;
      }
      s.mat.opacity = 0.9 * a;
    }
  }

  clear() {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i].on = false;
      this.slots[i].mesh.visible = false;
      this.slots[i].arm = false;
    }
  }
}
