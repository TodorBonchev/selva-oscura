import * as THREE from "three";
import { setPlanar } from "./frames";
import type { MatKit } from "./materials";

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

/**
 * Layered additive flame billboards + a ground glow. Returned group is named
 * "ember" so WorldApp's prop animator flickers it (scale pulse).
 */
export function makeFlame(scale = 1, tint = 0xffffff): THREE.Group {
  const g = new THREE.Group();
  g.name = "ember";
  const tex = flameTexture();
  const layers: [number, number, number][] = [
    // [width, height, opacity]
    [0.62, 1.15, 0.95],
    [0.42, 0.85, 0.9],
    [0.9, 0.7, 0.35],
  ];
  for (const [w, h, op] of layers) {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        color: tint,
        transparent: true,
        opacity: op,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    );
    sp.center.set(0.5, 0.08);
    sp.scale.set(w * scale, h * scale, 1);
    g.add(sp);
  }
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softDotTexture(),
      color: 0xff8a3a,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  glow.scale.set(1.8 * scale, 1.8 * scale, 1);
  glow.position.y = 0.25 * scale;
  g.add(glow);
  // Self-driven flicker (POI nodes are not in the ground prop animator).
  const sprites = g.children.slice(0, layers.length) as THREE.Sprite[];
  const baseH = layers.map(([, h]) => h * scale);
  const baseW = layers.map(([w]) => w * scale);
  const seed = Math.random() * 100;
  sprites[0].onBeforeRender = () => {
    const t = performance.now() * 0.001 + seed;
    for (let i = 0; i < sprites.length; i++) {
      const f = 1 + Math.sin(t * (11 + i * 3.7)) * 0.07 + Math.sin(t * (5.3 + i)) * 0.05;
      sprites[i].scale.set(baseW[i] * (2 - f) * 0.5 + baseW[i] * 0.5, baseH[i] * f, 1);
    }
    (glow.material as THREE.SpriteMaterial).opacity = 0.38 + Math.sin(t * 9.1) * 0.07;
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

export function makeBolt(mats: MatKit): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 1, 6), mats.ember);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  return mesh;
}

export function placeBolt(b: Bolt, t: number) {
  const u = Math.min(1, Math.max(0, (t - b.start) / b.dur));
  const x = b.x0 + (b.x1 - b.x0) * u;
  const y = b.y0 + (b.y1 - b.y0) * u;
  setPlanar(b.mesh.position, x, y, 1.2);
  const dx = b.x1 - b.x0;
  const dy = b.y1 - b.y0;
  const len = Math.hypot(dx, dy) || 1;
  b.mesh.scale.set(1, len * 0.35, 1);
  const dir = new THREE.Vector3(dx, 0, dy).normalize();
  b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}

export function makeWardRing(mats: MatKit): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 8, 32), mats.gold);
  m.rotation.x = Math.PI / 2;
  return m;
}

export function makeBurst(mats: MatKit): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
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

export function makeTelegraph(color = 0xff3311): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 32),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

/** Judge slam — filled danger disc, outer rim, growing countdown sweep. */
export type SlamTele = {
  group: THREE.Group;
  fill: THREE.Mesh;
  rim: THREE.Mesh;
  sweep: THREE.Mesh;
  light: THREE.PointLight;
  x: number;
  y: number;
  r: number;
  start: number;
  dur: number;
};

function slamMat(color: number, opacity: number, additive = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export type SlamPalette = "lust" | "avarice" | "gluttony";

/** Judge/Maw/Crush slam — filled danger disc; Avarice uses bone-gold irony (no Lust crimson). */
export function makeSlamTelegraph(
  palette: SlamPalette = "lust"
): Pick<SlamTele, "group" | "fill" | "rim" | "sweep" | "light"> {
  const group = new THREE.Group();
  group.name = "slamTele";
  group.userData.slamPalette = palette;

  const ava = palette === "avarice";
  const glut = palette === "gluttony";
  const fillHex = ava ? 0x3a2a10 : glut ? 0x2a3010 : 0xa01810;
  const sweepHex = ava ? 0xd4a840 : glut ? 0xb8c070 : 0xff4a22;
  const rimHex = ava ? 0xe8c86a : glut ? 0xc8d878 : 0xff6644;
  const glowHex = ava ? 0xa07828 : glut ? 0x708030 : 0xff2208;
  const tickHex = ava ? 0xf2dea0 : glut ? 0xd8e8a0 : 0xffd078;
  const lightHex = ava ? 0xd4a840 : glut ? 0xb8c070 : 0xff4418;

  // Compact Avarice: fewer segs/ticks — frame budget on phones near Crush
  const compact =
    typeof window !== "undefined" &&
    (window.matchMedia("(max-width: 900px)").matches ||
      window.matchMedia("(max-height: 520px)").matches);
  const segs = ava && compact ? 28 : 48;
  const tickN = ava && compact ? 8 : 16;

  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, segs), slamMat(fillHex, ava ? 0.2 : 0.22));
  fill.rotation.x = -Math.PI / 2;
  fill.name = "slamFill";
  fill.renderOrder = 2;

  const sweep = new THREE.Mesh(new THREE.CircleGeometry(1, segs), slamMat(sweepHex, ava ? 0.28 : 0.32, true));
  sweep.rotation.x = -Math.PI / 2;
  sweep.position.y = 0.02;
  sweep.scale.setScalar(0.06);
  sweep.name = "slamSweep";
  sweep.renderOrder = 3;

  const rim = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.02, segs), slamMat(rimHex, 0.92, true));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.03;
  rim.name = "slamRim";
  rim.renderOrder = 4;

  const glow = new THREE.Mesh(new THREE.RingGeometry(1.02, 1.2, segs), slamMat(glowHex, ava ? 0.24 : 0.28, true));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.025;
  glow.name = "slamGlow";
  glow.renderOrder = 3;

  const tickMat = slamMat(tickHex, 0.85, true);
  const tickGeo = new THREE.PlaneGeometry(0.16, 0.04);
  for (let i = 0; i < tickN; i++) {
    const tick = new THREE.Mesh(tickGeo, tickMat);
    const a = (i / tickN) * Math.PI * 2;
    tick.position.set(Math.cos(a) * 0.96, 0.035, Math.sin(a) * 0.96);
    tick.rotation.set(-Math.PI / 2, -a, 0);
    tick.name = "slamTick";
    tick.renderOrder = 5;
    group.add(tick);
  }

  const light = new THREE.PointLight(lightHex, ava ? 1.0 : 1.2, 10, 2);
  light.position.y = 1.15;
  light.name = "slamLight";

  group.add(fill, sweep, rim, glow, light);
  return { group, fill, rim, sweep, light };
}

export function tickSlamTelegraph(s: SlamTele, t: number) {
  const u = Math.min(1, Math.max(0, (t - s.start) / s.dur));
  s.sweep.scale.setScalar(0.06 + u * 0.94);
  const fillMat = s.fill.material as THREE.MeshBasicMaterial;
  const rimMat = s.rim.material as THREE.MeshBasicMaterial;
  const sweepMat = s.sweep.material as THREE.MeshBasicMaterial;
  fillMat.opacity = 0.18 + u * 0.28;
  sweepMat.opacity = 0.22 + u * 0.28;
  rimMat.opacity = 0.72 + 0.28 * Math.abs(Math.sin(t * 0.016));
  s.light.intensity = 1.1 + u * 5.5;
  if (u > 0.82) {
    const flash = (u - 0.82) / 0.18;
    fillMat.opacity = 0.42 + flash * 0.28;
    sweepMat.opacity = 0.5 + flash * 0.4;
    const pal = s.group.userData.slamPalette as SlamPalette | undefined;
    if (pal === "avarice") {
      rimMat.color.setHex(flash > 0.55 ? 0xfff6d8 : 0xf2dea0);
    } else if (pal === "gluttony") {
      rimMat.color.setHex(flash > 0.55 ? 0xe8f0c0 : 0xd0e080);
    } else {
      rimMat.color.setHex(flash > 0.55 ? 0xfff1c4 : 0xffe08a);
    }
    s.light.intensity = 7 + flash * 6;
  }
}

export function disposeObject3D(obj: THREE.Object3D) {
  const mats = new Set<THREE.Material>();
  const geos = new Set<THREE.BufferGeometry>();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.geometry && !geos.has(m.geometry)) {
      geos.add(m.geometry);
      m.geometry.dispose();
    }
    const list = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of list) {
      if (!mat || mats.has(mat)) continue;
      mats.add(mat);
      mat.dispose();
    }
  });
}

export function makeHitFlash(): THREE.PointLight {
  const l = new THREE.PointLight(0xffcc88, 0, 10, 2);
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
};

export function makeImpactRing(color: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.48, 32),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.name = "impactRing";
  return m;
}

export function tickImpact(ring: ImpactRing, t: number) {
  const u = Math.min(1, Math.max(0, (t - ring.start) / Math.max(1, ring.dur)));
  const from = ring.from ?? 0.45;
  const to = ring.to ?? 3.85;
  const s = from + u * (to - from);
  if (ring.rise != null) {
    if ((ring as any)._baseY == null) (ring as any)._baseY = ring.mesh.position.y;
    ring.mesh.scale.setScalar(Math.max(0.12, 1 - u * 0.85));
    ring.mesh.position.y = (ring as any)._baseY + ring.rise * u;
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
  light: THREE.PointLight;
};

function portalHoldMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
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

  const light = new THREE.PointLight(0xffc878, 0, 8, 2);
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

export function makeSlashTrail(): THREE.Mesh {
  // Brighter bone-gold arc; fewer segments on compact via caller scale, not geometry thrash.
  // depthTest off so Lust fog/haze doesn't bury the trail; tube ~+8% for combat read.
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(1.22, 0.076, 6, 24, Math.PI * 1.22),
    new THREE.MeshBasicMaterial({
      color: 0xfff6d8,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    })
  );
  m.name = "slashTrail";
  // Hand-local (parent: slashAnchor on handR). Mid-blade ~ weapon rest rx=0.55.
  // youGroup root scale (~1.42) still applies; offsets are model-space.
  // Tuned so arc sits along the blade when weapon shown and still reads when hidden.
  m.position.set(0.02, -0.40, -0.22);
  m.rotation.x = Math.PI * 0.24;
  m.rotation.z = 0.22;
  m.renderOrder = 4;
  return m;
}

export type SparkBurst = {
  points: THREE.Points;
  vel: Float32Array;
  start: number;
  dur: number;
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
  return { points, vel, start: 0, dur: 420 };
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
  b.dur = 420;
  return b;
}

export function tickSparks(b: SparkBurst, t: number) {
  const u = (t - b.start) / b.dur;
  const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
  const dt = 0.016;
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
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.08, 0.22, 16),
    new THREE.MeshBasicMaterial({
      color: 0xc4b08a,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  m.rotation.x = -Math.PI / 2;
  return m;
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
