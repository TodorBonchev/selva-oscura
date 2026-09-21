import * as THREE from "three";
import { setPlanar } from "./frames";
import type { MatKit } from "./materials";

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
      size: 0.12,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  private respawn(i: number, scatter: boolean) {
    const o = i * 3;
    this.pos[o] = Math.random() * 160;
    this.pos[o + 1] = scatter ? Math.random() * 8 : 0.2;
    this.pos[o + 2] = Math.random() * 130;
    this.vel[o] = (Math.random() - 0.5) * 0.6;
    this.vel[o + 1] = 0.25 + Math.random() * 0.55;
    this.vel[o + 2] = (Math.random() - 0.5) * 0.6;
  }

  tick(dt: number, bounds: { width: number; height: number }, gale: boolean) {
    const w = bounds.width;
    const h = bounds.height;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      this.pos[o] += this.vel[o] * dt + (gale ? 1.8 * dt : 0);
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.pos[o + 1] > 9 || this.pos[o] < -4 || this.pos[o] > w + 4) this.respawn(i, false);
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

export function makeSlamTelegraph(): Pick<SlamTele, "group" | "fill" | "rim" | "sweep" | "light"> {
  const group = new THREE.Group();
  group.name = "slamTele";

  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), slamMat(0xa01810, 0.22));
  fill.rotation.x = -Math.PI / 2;
  fill.name = "slamFill";
  fill.renderOrder = 2;

  const sweep = new THREE.Mesh(new THREE.CircleGeometry(1, 48), slamMat(0xff4a22, 0.32, true));
  sweep.rotation.x = -Math.PI / 2;
  sweep.position.y = 0.02;
  sweep.scale.setScalar(0.06);
  sweep.name = "slamSweep";
  sweep.renderOrder = 3;

  const rim = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.02, 48), slamMat(0xff6644, 0.92, true));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.03;
  rim.name = "slamRim";
  rim.renderOrder = 4;

  const glow = new THREE.Mesh(new THREE.RingGeometry(1.02, 1.2, 48), slamMat(0xff2208, 0.28, true));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.025;
  glow.name = "slamGlow";
  glow.renderOrder = 3;

  const tickMat = slamMat(0xffd078, 0.85, true);
  const tickGeo = new THREE.PlaneGeometry(0.16, 0.04);
  for (let i = 0; i < 16; i++) {
    const tick = new THREE.Mesh(tickGeo, tickMat);
    const a = (i / 16) * Math.PI * 2;
    tick.position.set(Math.cos(a) * 0.96, 0.035, Math.sin(a) * 0.96);
    tick.rotation.set(-Math.PI / 2, -a, 0);
    tick.name = "slamTick";
    tick.renderOrder = 5;
    group.add(tick);
  }

  const light = new THREE.PointLight(0xff4418, 1.2, 10, 2);
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
    rimMat.color.setHex(flash > 0.55 ? 0xfff1c4 : 0xffe08a);
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
  const u = Math.min(1, Math.max(0, (t - ring.start) / ring.dur));
  const from = ring.from ?? 0.45;
  const to = ring.to ?? 3.85;
  const s = from + u * (to - from);
  ring.mesh.scale.set(s, s, 1);
  (ring.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - u) * (1 - u) * 0.95);
}

export function makeSlashTrail(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(0.98, 0.07, 6, 24, Math.PI * 1.2),
    new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  m.name = "slashTrail";
  m.position.set(0, 1.08, -0.52);
  m.rotation.x = Math.PI * 0.58;
  m.rotation.z = 0.28;
  m.renderOrder = 4;
  return m;
}

export type SparkBurst = {
  points: THREE.Points;
  vel: Float32Array;
  start: number;
  dur: number;
};

export function spawnSparks(x: number, z: number, y: number, color: number, t: number): SparkBurst {
  const n = 22;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    const a = Math.random() * Math.PI * 2;
    const sp = 1.6 + Math.random() * 3.4;
    vel[i * 3] = Math.cos(a) * sp;
    vel[i * 3 + 1] = 2.2 + Math.random() * 4.2;
    vel[i * 3 + 2] = Math.sin(a) * sp;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color,
      size: 0.14,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
  );
  return { points, vel, start: t, dur: 420 };
}

export function tickSparks(b: SparkBurst, t: number) {
  const u = (t - b.start) / b.dur;
  const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
  const dt = 0.016;
  for (let i = 0; i < b.vel.length / 3; i++) {
    const o = i * 3;
    b.vel[o + 1] -= 9 * dt;
    pos.array[o] += b.vel[o] * dt;
    pos.array[o + 1] += b.vel[o + 1] * dt;
    pos.array[o + 2] += b.vel[o + 2] * dt;
  }
  pos.needsUpdate = true;
  (b.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - u);
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
