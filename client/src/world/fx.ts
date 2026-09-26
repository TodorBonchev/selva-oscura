import * as THREE from "three";
import { setPlanar } from "./frames";
import type { MatKit } from "./materials";
import { VirtualLight } from "./lightPool";
import { isShared, sharedGeo, sharedMat } from "./dispose";

/** Canvas-drawn sprite textures, built once and shared (no extra asset fetches). */
let _softDot: THREE.CanvasTexture | null = null;
let _flameTex: THREE.CanvasTexture | null = null;

/** Soft round mote: bright core, feathered edge (points were square without a map). */
export function softDotTexture(): THREE.CanvasTexture {
  if (_softDot) return _softDot;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.75)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _softDot = new THREE.CanvasTexture(c);
  _softDot.colorSpace = THREE.SRGBColorSpace;
  return _softDot;
}

/** Teardrop flame: white-gold core → ember → transparent tip. */
export function flameTexture(): THREE.CanvasTexture {
  if (_flameTex) return _flameTex;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.translate(32, 0);
  const body = new Path2D();
  body.moveTo(0, 4);
  body.bezierCurveTo(20, 46, 30, 76, 26, 96);
  body.bezierCurveTo(22, 118, -22, 118, -26, 96);
  body.bezierCurveTo(-30, 76, -20, 46, 0, 4);
  const grd = g.createRadialGradient(0, 94, 2, 0, 80, 70);
  grd.addColorStop(0, "rgba(255,248,220,1)");
  grd.addColorStop(0.25, "rgba(255,196,96,0.95)");
  grd.addColorStop(0.6, "rgba(232,86,32,0.7)");
  grd.addColorStop(1, "rgba(120,20,8,0)");
  g.fillStyle = grd;
  g.filter = "blur(3px)";
  g.fill(body);
  _flameTex = new THREE.CanvasTexture(c);
  _flameTex.colorSpace = THREE.SRGBColorSpace;
  return _flameTex;
}

/** Sprite box for the baked flame, in flame-scale units: x ±0.9, y −0.65 … 1.15. */
const FLAME_BOX = { w: 1.8, h: 1.8, below: 0.65 };
/**
 * Canvas "lighter" adds in sRGB and clips at 1, which would blow the overlapping teardrop
 * cores out to a white ball. Bake at 1/GAIN and multiply back in the (HDR, linear) shader.
 */
const FLAME_GAIN = 1.6;
let _flameSpriteTex: THREE.CanvasTexture | null = null;

/**
 * The three additive teardrop layers and the ground glow that used to be four sprites,
 * pre-composited ("lighter" = additive) into one texture: one draw per brazier/shrine.
 */
function flameSpriteTexture(): THREE.CanvasTexture {
  if (_flameSpriteTex) return _flameSpriteTex;
  const S = 192;
  const k = S / FLAME_BOX.w;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const toX = (x: number) => (x + FLAME_BOX.w / 2) * k;
  const toY = (y: number) => (FLAME_BOX.h - FLAME_BOX.below - y) * k;
  g.globalCompositeOperation = "lighter";
  // Ground glow: soft 1.8-wide disc at y 0.25, ember orange, ~0.42 average opacity
  const glow = g.createRadialGradient(toX(0), toY(0.25), 0, toX(0), toY(0.25), 0.9 * k);
  glow.addColorStop(0, `rgba(255,138,58,${0.42 / FLAME_GAIN})`);
  glow.addColorStop(0.35, `rgba(255,138,58,${0.31 / FLAME_GAIN})`);
  glow.addColorStop(1, "rgba(255,138,58,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  // Teardrop layers [width, height, opacity], anchored 8% below their base like before
  const flame = flameTexture().image as HTMLCanvasElement;
  for (const [w, h, op] of [
    [0.62, 1.15, 0.95],
    [0.42, 0.85, 0.9],
    [0.9, 0.7, 0.35],
  ] as const) {
    g.globalAlpha = op / FLAME_GAIN;
    g.drawImage(flame, toX(-w / 2), toY(h * 0.92), w * k, h * k);
  }
  _flameSpriteTex = new THREE.CanvasTexture(c);
  _flameSpriteTex.colorSpace = THREE.SRGBColorSpace;
  return _flameSpriteTex;
}

/**
 * Additive flame billboard (flame layers + ground glow baked into one sprite). Returned
 * group is named "ember" so WorldApp's prop animator flickers it (scale pulse).
 */
export function makeFlame(scale = 1, tint = 0xffffff): THREE.Group {
  const g = new THREE.Group();
  g.name = "ember";
  const mat = new THREE.SpriteMaterial({
    map: flameSpriteTexture(),
    color: new THREE.Color(tint).multiplyScalar(FLAME_GAIN),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.center.set(0.5, FLAME_BOX.below / FLAME_BOX.h);
  const baseW = FLAME_BOX.w * scale;
  const baseH = FLAME_BOX.h * scale;
  sp.scale.set(baseW, baseH, 1);
  g.add(sp);
  // Self-driven flicker (POI nodes are not in the ground prop animator).
  const seed = Math.random() * 100;
  sp.onBeforeRender = () => {
    const t = performance.now() * 0.001 + seed;
    const f = 1 + Math.sin(t * 11) * 0.06 + Math.sin(t * 5.3) * 0.045;
    sp.scale.set(baseW * (1.5 - f * 0.5), baseH * f, 1);
    mat.opacity = 0.9 + Math.sin(t * 9.1) * 0.1;
  };
  return g;
}

let _shaftTex: THREE.CanvasTexture | null = null;

/** Slanted god-ray: bright at the canopy gap, feathered toward the ground. */
function shaftTexture(): THREE.CanvasTexture {
  if (_shaftTex) return _shaftTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.filter = "blur(10px)";
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, "rgba(255,240,205,0)");
  grd.addColorStop(0.12, "rgba(255,240,205,0.9)");
  grd.addColorStop(0.7, "rgba(255,232,190,0.35)");
  grd.addColorStop(1, "rgba(255,232,190,0)");
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(58, 0);
  g.lineTo(100, 0);
  g.lineTo(82, 512);
  g.lineTo(18, 512);
  g.closePath();
  g.fill();
  _shaftTex = new THREE.CanvasTexture(c);
  _shaftTex.colorSpace = THREE.SRGBColorSpace;
  return _shaftTex;
}

/**
 * Doré light shaft through the canopy (bible: "dramatic shafts of light").
 * A camera-facing additive sprite anchored at its foot; breathes slowly.
 */
export function makeLightShaft(height = 11, opacity = 0.16): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: shaftTexture(),
    color: 0xffe2b0,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.center.set(0.5, 0);
  sp.scale.set(height * 0.42, height, 1);
  sp.name = "lightShaft";
  const seed = Math.random() * 10;
  sp.onBeforeRender = () => {
    mat.opacity = opacity * (0.75 + 0.25 * Math.sin(performance.now() * 0.0004 + seed));
  };
  return sp;
}

export class AshField {
  points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private n: number;

  constructor(n: number, color: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.respawn(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({
      color,
      map: softDotTexture(),
      size: 0.22,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  private respawn(i: number, scatter: boolean, px = 64, pz = 64) {
    const o = i * 3;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 22;
    this.pos[o] = px + Math.cos(a) * r;
    this.pos[o + 1] = scatter ? Math.random() * 7 : 0.15;
    this.pos[o + 2] = pz + Math.sin(a) * r;
    this.vel[o] = (Math.random() - 0.5) * 0.55;
    this.vel[o + 1] = 0.22 + Math.random() * 0.7;
    this.vel[o + 2] = (Math.random() - 0.5) * 0.55;
  }

  setColor(color: number, opacity = 0.55) {
    const mat = this.points.material as THREE.PointsMaterial;
    mat.color.setHex(color);
    mat.opacity = opacity;
  }

  tick(
    dt: number,
    _bounds: { width: number; height: number },
    gale: boolean,
    px = 64,
    pz = 64,
    stride = 1,
    phase = 0
  ) {
    const step = Math.max(1, stride | 0);
    for (let i = phase % step; i < this.n; i += step) {
      const o = i * 3;
      this.pos[o] += this.vel[o] * dt + (gale ? 2.2 * dt : 0);
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      const dx = this.pos[o] - px;
      const dz = this.pos[o + 2] - pz;
      if (this.pos[o + 1] > 8 || dx * dx + dz * dz > 26 * 26) this.respawn(i, false, px, pz);
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

export type Bolt = {
  mesh: THREE.Mesh;
  x0: number; y0: number; x1: number; y1: number;
  start: number; dur: number;
};

/** `tint` recolours a cached copy of the ember material, never the kit's shared one. */
export function makeBolt(mats: MatKit, tint?: number): THREE.Mesh {
  const mat =
    tint == null
      ? mats.ember
      : sharedMat(`fx:bolt:${tint}`, () => {
          const m = mats.ember.clone();
          m.color.setHex(tint);
          return m;
        });
  const mesh = new THREE.Mesh(sharedGeo("fx:bolt", () => new THREE.CylinderGeometry(0.05, 0.02, 1, 6)), mat);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  return mesh;
}

const _boltUp = new THREE.Vector3(0, 1, 0);
const _boltDir = new THREE.Vector3();

export function placeBolt(b: Bolt, t: number) {
  const u = Math.min(1, Math.max(0, (t - b.start) / b.dur));
  const x = b.x0 + (b.x1 - b.x0) * u;
  const y = b.y0 + (b.y1 - b.y0) * u;
  setPlanar(b.mesh.position, x, y, 1.2);
  const dx = b.x1 - b.x0;
  const dy = b.y1 - b.y0;
  const len = Math.hypot(dx, dy) || 1;
  b.mesh.scale.set(1, len * 0.35, 1);
  _boltDir.set(dx, 0, dy).normalize();
  b.mesh.quaternion.setFromUnitVectors(_boltUp, _boltDir);
}

export function makeWardRing(mats: MatKit): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 8, 32), mats.gold);
  m.rotation.x = Math.PI / 2;
  return m;
}

export function makeBurst(mats: MatKit): THREE.Mesh {
  // Shared sphere; the material is per burst (its opacity fades) and freed on removal
  const m = new THREE.Mesh(
    sharedGeo("fx:burst", () => new THREE.SphereGeometry(1, 16, 12)),
    new THREE.MeshBasicMaterial({
      color: 0xff5533,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      wireframe: false,
    })
  );
  return m;
}

/** Pooled cast ring (return it with releaseFx). */
export function makeTelegraph(color = 0xff3311): THREE.Mesh {
  return acquireFxRing(0.85, 1, 32, color, 0.7, false);
}

/** Hit flash marker — drives a pooled light while it decays (see lightPool.ts). */
export function makeHitFlash(): VirtualLight {
  const l = new VirtualLight(0xffcc88, 0, 10, 2, 2.5);
  l.name = "hitFlash";
  return l;
}

export type ImpactRing = {
  mesh: THREE.Mesh;
  start: number;
  dur: number;
  from?: number;
  to?: number;
  /** Optional upward drift (world Y units over life) for ash motes. */
  rise?: number;
  baseY?: number;
};

/**
 * Pooled flat rings / motes for hit, slam, dust and claim effects. Geometry is shared per
 * shape and each mesh keeps its own material (per-instance colour/opacity); finished
 * effects go back to the pool instead of allocating + disposing GPU buffers per hit.
 */
const fxPools = new Map<string, THREE.Mesh[]>();
const FX_POOL_MAX = 24;

function acquireFx(key: string, geo: () => THREE.BufferGeometry, color: number, opacity: number, additive: boolean): THREE.Mesh {
  const pool = fxPools.get(key);
  let m = pool?.pop();
  if (!m) {
    m = new THREE.Mesh(
      sharedGeo(`fx:${key}`, geo),
      new THREE.MeshBasicMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
    );
    m.userData.fxPoolKey = key;
  }
  const mat = m.material as THREE.MeshBasicMaterial;
  mat.color.setHex(color);
  mat.opacity = opacity;
  m.position.set(0, 0, 0);
  m.rotation.set(0, 0, 0);
  m.scale.set(1, 1, 1);
  m.userData.baseScale = 1;
  m.visible = true;
  return m;
}

/** Flat ground ring (lying in XZ) from the pool. */
export function acquireFxRing(inner: number, outer: number, segs: number, color: number, opacity = 0.9, additive = true): THREE.Mesh {
  const m = acquireFx(
    `ring:${inner}:${outer}:${segs}:${additive ? "a" : "n"}`,
    () => new THREE.RingGeometry(inner, outer, segs),
    color,
    opacity,
    additive
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

/** Small additive mote (unit sphere scaled to `radius`) from the pool. */
export function acquireFxMote(radius: number, segs: number, color: number, opacity = 0.9): THREE.Mesh {
  const m = acquireFx(`mote:${segs}`, () => new THREE.SphereGeometry(1, segs, segs), color, opacity, true);
  m.scale.setScalar(radius);
  m.userData.baseScale = radius;
  return m;
}

/** Return a finished effect mesh (already removed from the scene) to its pool. */
export function releaseFx(m: THREE.Mesh) {
  const key = m.userData.fxPoolKey as string | undefined;
  if (!key) {
    // Not pooled: free what it owns (shared geometry — e.g. the coin disc — stays)
    if (!isShared(m.geometry)) m.geometry.dispose();
    const mat = m.material as THREE.Material;
    if (!isShared(mat)) mat.dispose();
    return;
  }
  let pool = fxPools.get(key);
  if (!pool) fxPools.set(key, (pool = []));
  if (pool.length < FX_POOL_MAX) pool.push(m);
  else (m.material as THREE.Material).dispose();
}

export function makeImpactRing(color: number): THREE.Mesh {
  const m = acquireFxRing(0.18, 0.48, 32, color, 0.9);
  m.name = "impactRing";
  return m;
}

export function tickImpact(ring: ImpactRing, t: number) {
  const u = Math.min(1, Math.max(0, (t - ring.start) / Math.max(1, ring.dur)));
  const from = ring.from ?? 0.45;
  const to = ring.to ?? 3.85;
  const s = from + u * (to - from);
  if (ring.rise != null) {
    if (ring.baseY == null) ring.baseY = ring.mesh.position.y;
    const base = Number(ring.mesh.userData.baseScale) || 1;
    ring.mesh.scale.setScalar(base * Math.max(0.12, 1 - u * 0.85));
    ring.mesh.position.y = ring.baseY + ring.rise * u;
  } else {
    ring.mesh.scale.set(s, s, 1);
  }
  (ring.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - u) * (1 - u) * 0.95);
}

/** Pilgrim-foot channel ring while holding Interact to travel a portal. */
export type PortalHoldFx = {
  group: THREE.Group;
  fill: THREE.Mesh;
  rim: THREE.Mesh;
  sweep: THREE.Mesh;
  column: THREE.Mesh;
  light: VirtualLight;
};

function portalHoldMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export function makePortalHoldFx(): PortalHoldFx {
  const group = new THREE.Group();
  group.name = "portalHold";
  group.visible = false;

  const fill = new THREE.Mesh(new THREE.CircleGeometry(1.15, 48), portalHoldMat(0xc9a227, 0.18));
  fill.rotation.x = -Math.PI / 2;
  fill.name = "portalHoldFill";
  fill.renderOrder = 2;

  const sweep = new THREE.Mesh(new THREE.CircleGeometry(1.15, 48), portalHoldMat(0xffe8a0, 0.34));
  sweep.rotation.x = -Math.PI / 2;
  sweep.position.y = 0.02;
  sweep.scale.setScalar(0.06);
  sweep.name = "portalHoldSweep";
  sweep.renderOrder = 3;

  const rim = new THREE.Mesh(new THREE.RingGeometry(1.02, 1.2, 48), portalHoldMat(0xffe08a, 0.92));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.03;
  rim.name = "portalHoldRim";
  rim.renderOrder = 4;

  const glow = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.45, 48), portalHoldMat(0xff8844, 0.28));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.025;
  glow.name = "portalHoldGlow";
  glow.renderOrder = 3;

  const tickMat = portalHoldMat(0xffe8a0, 0.8);
  const tickGeo = new THREE.PlaneGeometry(0.14, 0.035);
  for (let i = 0; i < 12; i++) {
    const tick = new THREE.Mesh(tickGeo, tickMat);
    const a = (i / 12) * Math.PI * 2;
    tick.position.set(Math.cos(a) * 1.11, 0.035, Math.sin(a) * 1.11);
    tick.rotation.set(-Math.PI / 2, -a, 0);
    tick.name = "portalHoldTick";
    tick.renderOrder = 5;
    group.add(tick);
  }

  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.38, 1, 18, 1, true),
    portalHoldMat(0xffd090, 0.2)
  );
  column.position.y = 0.55;
  column.name = "portalHoldColumn";
  column.renderOrder = 3;

  const light = new VirtualLight(0xffc878, 0, 8, 2, 2);
  light.position.y = 0.95;
  light.name = "portalHoldLight";

  group.add(fill, sweep, rim, glow, column, light);
  return { group, fill, rim, sweep, column, light };
}

export function tickPortalHoldFx(fx: PortalHoldFx, u: number) {
  const t = Math.min(1, Math.max(0, u));
  fx.group.visible = true;
  fx.sweep.scale.setScalar(0.08 + t * 0.92);
  const fillMat = fx.fill.material as THREE.MeshBasicMaterial;
  const rimMat = fx.rim.material as THREE.MeshBasicMaterial;
  const sweepMat = fx.sweep.material as THREE.MeshBasicMaterial;
  fillMat.opacity = 0.12 + t * 0.22;
  sweepMat.opacity = 0.2 + t * 0.32;
  rimMat.opacity = 0.62 + 0.3 * Math.abs(Math.sin(t * Math.PI));
  fx.column.scale.set(1, 0.35 + t * 2.1, 1);
  fx.column.position.y = (0.35 + t * 2.1) * 0.5;
  (fx.column.material as THREE.MeshBasicMaterial).opacity = 0.1 + t * 0.28;
  fx.light.intensity = 0.6 + t * 4.2;
  if (t > 0.84) {
    const flash = (t - 0.84) / 0.16;
    fillMat.opacity = 0.32 + flash * 0.28;
    sweepMat.opacity = 0.48 + flash * 0.4;
    rimMat.color.setHex(flash > 0.5 ? 0xfff6d0 : 0xffe08a);
    fx.light.intensity = 5 + flash * 5;
  } else {
    rimMat.color.setHex(0xffe08a);
  }
}

export type SparkBurst = {
  points: THREE.Points;
  vel: Float32Array;
  start: number;
  dur: number;
  /** animT of the previous tick (sparks integrate real frame time, not a fixed 16ms). */
  last: number;
};

const SPARK_N = 18;
const sparkPool: SparkBurst[] = [];
const SPARK_POOL_MAX = 8;

function acquireSparkBurst(): SparkBurst {
  const pooled = sparkPool.pop();
  if (pooled) return pooled;
  const pos = new Float32Array(SPARK_N * 3);
  const vel = new Float32Array(SPARK_N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.14,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
  );
  return { points, vel, start: 0, dur: 420, last: 0 };
}

/** Return a finished burst to the pool (caller must scene.remove first). */
export function releaseSparkBurst(b: SparkBurst) {
  if (sparkPool.length >= SPARK_POOL_MAX) {
    b.points.geometry.dispose();
    (b.points.material as THREE.Material).dispose();
    return;
  }
  sparkPool.push(b);
}

export function spawnSparks(x: number, z: number, y: number, color: number, t: number): SparkBurst {
  const b = acquireSparkBurst();
  const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < SPARK_N; i++) {
    const o = i * 3;
    pos.array[o] = x;
    pos.array[o + 1] = y;
    pos.array[o + 2] = z;
    const a = Math.random() * Math.PI * 2;
    const sp = 1.6 + Math.random() * 3.4;
    b.vel[o] = Math.cos(a) * sp;
    b.vel[o + 1] = 2.2 + Math.random() * 4.2;
    b.vel[o + 2] = Math.sin(a) * sp;
  }
  pos.needsUpdate = true;
  const mat = b.points.material as THREE.PointsMaterial;
  mat.color.setHex(color);
  mat.opacity = 1;
  b.start = t;
  b.last = t;
  b.dur = 420;
  return b;
}

export function tickSparks(b: SparkBurst, t: number) {
  const u = (t - b.start) / b.dur;
  const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
  const dt = Math.min(0.05, Math.max(0, (t - b.last) / 1000));
  b.last = t;
  for (let i = 0; i < SPARK_N; i++) {
    const o = i * 3;
    b.vel[o + 1] -= 9 * dt;
    pos.array[o] += b.vel[o] * dt;
    pos.array[o + 1] += b.vel[o + 1] * dt;
    pos.array[o + 2] += b.vel[o + 2] * dt;
  }
  pos.needsUpdate = true;
  (b.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - u);
}

/** Olive sludge splash — pooled sparks (caller should cap concurrent bursts). */
export function spawnSludgeSplash(x: number, z: number, y: number, t: number): SparkBurst {
  return spawnSparks(x, z, y, 0xb8c858, t);
}

/** Sparse gold-dust hit spark — Avarice heavy hits only (no arcade neon). */
export function spawnGoldDustSplash(x: number, z: number, y: number, t: number): SparkBurst {
  return spawnSparks(x, z, y, 0xd4a840, t);
}

export function makeDustPuff(): THREE.Mesh {
  return acquireFxRing(0.08, 0.22, 16, 0xc4b08a, 0.45, false);
}

export function makeLootBeam(color: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.09, 4.2, 8),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  m.position.y = 2.2;
  m.name = "lootBeam";
  return m;
}
