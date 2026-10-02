/**
 * Pozzo dei Giganti — Inf. XXXI. Giants ring the well like towers in the murk.
 * Planar (x, y) is three.js (x, z). The floor faces +y (PlaneGeometry rotateX −π/2).
 *
 * Cost: instanced bodies, chains, braziers, spawn marks. No real PointLights —
 * at most six VirtualLight markers (the existing LightPool promotes a few).
 * The tick closes over its buffers; it does not allocate.
 */
import * as THREE from "three";
import type { MatKit } from "./materials";
import type { GroundRig } from "./ground";
import type { Tier } from "./quality";
import { isCompactUi } from "../ui/hud";
import { VirtualLight } from "./lightPool";
import { softDotTexture } from "./fx";

const SPAWNS: ReadonlyArray<readonly [number, number]> = [
  [56.4, 35.7],
  [68.3, 47.6],
  [68.3, 64.4],
  [56.4, 76.3],
  [39.6, 76.3],
  [27.7, 64.4],
  [27.7, 47.6],
  [39.6, 35.7],
];

const RANKED = { x: 48, z: 26, r: 9 };
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function wellHeight(w: number, h: number, x: number, z: number): number {
  const dx = x - w * 0.5;
  const dz = z - h * 0.5;
  const r = Math.hypot(dx, dz);
  let n = r < 40 ? -0.16 * (1 - r / 40) * (1 - r / 40) : 0;
  n += Math.sin(x * 0.31) * Math.cos(z * 0.27) * 0.03;
  return n;
}

/** Eight towers on a ring, nudged off the north exit and the wake spawn. */
function towerAngles(w: number, h: number): number[] {
  const cx = w * 0.5;
  const cy = h * 0.5;
  const exitY = h * 0.916;
  const spawnY = h * 0.77;
  const r = 40;
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    let a = ((18 + i * 45) * Math.PI) / 180;
    for (let k = 0; k < 8; k++) {
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const nearExit = Math.hypot(x - cx, y - exitY) < 8;
      const nearSpawn = Math.hypot(x - cx, y - spawnY) < 6;
      if (!nearExit && !nearSpawn) break;
      a += 0.18;
    }
    out.push(a);
  }
  return out;
}

function disc(geo: THREE.BufferGeometry): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0xe8c86a,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 6;
  return mesh;
}

export function buildGiantsWell(
  bounds: { width: number; height: number },
  _mats: MatKit,
  tier: Tier = "high"
): GroundRig {
  const w = bounds.width;
  const h = bounds.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const low = tier === "low" || isCompactUi();
  const group = new THREE.Group();
  group.name = "ground:inferno_31";

  const heightAt = (x: number, z: number) => wellHeight(w, h, x, z);

  const segs = low ? 14 : tier === "mid" ? 20 : 28;
  const geo = new THREE.PlaneGeometry(w + 16, h + 16, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + cx;
    const wz = pos.getZ(i) + cy;
    pos.setY(i, heightAt(wx, wz));
    const ffa = Math.hypot(wx - cx, wz - (cy + 8));
    const ranked = Math.hypot(wx - RANKED.x, wz - RANKED.z);
    const stage = Math.min(ffa / 26, ranked / 13);
    const lift = stage < 1 ? (1 - stage) * (1 - stage) : 0;
    let shade = 0.05 + lift * 0.32;
    shade += Math.sin(wx * 1.55) * Math.sin(wz * 1.45) * 0.012;
    if (Math.abs(wx - 48) < 2.4 && wz > 70 && wz < 90) shade = Math.max(shade, 0.24);
    cols[i * 3] = shade * 1.08;
    cols[i * 3 + 1] = shade * 0.9;
    cols[i * 3 + 2] = shade * 0.7;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const ny = geo.attributes.normal.getY(0);
  if (ny < 0) {
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setY(i, -nrm.getY(i));
  }
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.02,
  });
  const floor = new THREE.Mesh(geo, floorMat);
  floor.name = "floor";
  floor.receiveShadow = true;
  floor.renderOrder = 5;
  // Geometry is centred on its origin; the pit (and height samples) live at the map centre.
  floor.position.set(cx, 0, cy);
  group.add(floor);

  const wallSeg = low ? 16 : 28;
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(44.6, 46.2, 6.2, wallSeg, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x0c0a09,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    })
  );
  wall.name = "pitWall";
  wall.position.set(cx, 2.4, cy);
  group.add(wall);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(44.8, 0.34, low ? 4 : 6, low ? 28 : 48),
    new THREE.MeshBasicMaterial({ color: 0xe4c060 })
  );
  rim.name = "pitRim";
  rim.rotation.x = Math.PI / 2;
  rim.position.set(cx, 5.35, cy);
  group.add(rim);

  const stage = disc(new THREE.RingGeometry(22.4, 23.15, low ? 28 : 48));
  (stage.material as THREE.MeshBasicMaterial).opacity = 0.72;
  stage.position.set(cx, 0.08, cy + 8);
  stage.name = "ffaRing";
  group.add(stage);

  const rankedFill = new THREE.Mesh(
    new THREE.CircleGeometry(RANKED.r - 0.35, low ? 20 : 32),
    new THREE.MeshBasicMaterial({
      color: 0x4a3418,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  rankedFill.rotation.x = -Math.PI / 2;
  rankedFill.position.set(RANKED.x, 0.05, RANKED.z);
  rankedFill.name = "rankedFill";
  rankedFill.renderOrder = 6;
  group.add(rankedFill);

  const rankedRing = disc(new THREE.RingGeometry(RANKED.r - 0.28, RANKED.r + 0.18, low ? 28 : 48));
  rankedRing.position.set(RANKED.x, 0.1, RANKED.z);
  rankedRing.name = "rankedRing";
  group.add(rankedRing);
  const rankedInner = disc(new THREE.RingGeometry(RANKED.r - 1.35, RANKED.r - 1.18, low ? 24 : 40));
  (rankedInner.material as THREE.MeshBasicMaterial).opacity = 0.45;
  rankedInner.position.set(RANKED.x, 0.09, RANKED.z);
  rankedInner.name = "rankedInner";
  group.add(rankedInner);

  const exitPath = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 16),
    new THREE.MeshBasicMaterial({
      color: 0xd4b06a,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  exitPath.rotation.x = -Math.PI / 2;
  exitPath.position.set(48, 0.07, 80);
  exitPath.name = "exitPath";
  exitPath.renderOrder = 6;
  group.add(exitPath);

  const fogGeo = new THREE.RingGeometry(27, 54, low ? 18 : 28);
  const fogMat = new THREE.MeshBasicMaterial({
    color: 0x120c0c,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fog = new THREE.Mesh(fogGeo, fogMat);
  fog.rotation.x = -Math.PI / 2;
  fog.position.set(cx, 1.8, cy);
  fog.name = "pitFog";
  fog.renderOrder = 4;
  group.add(fog);
  const fogs: THREE.Mesh[] = [fog];
  if (!low) {
    const fog2 = new THREE.Mesh(
      new THREE.RingGeometry(18, 58, 24),
      fogMat.clone()
    );
    (fog2.material as THREE.MeshBasicMaterial).opacity = 0.1;
    fog2.rotation.x = -Math.PI / 2;
    fog2.position.set(cx, 6.2, cy);
    fog2.name = "pitFogHigh";
    fog2.renderOrder = 4;
    group.add(fog2);
    fogs.push(fog2);
  }

  const angles = towerAngles(w, h);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const heights: number[] = [];

  const bodyGeo = new THREE.CylinderGeometry(1.2, 2.05, 1, 6);
  bodyGeo.translate(0, 0.5, 0);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x241e1a,
    roughness: 1,
    metalness: 0,
    emissive: 0x100c0a,
    emissiveIntensity: 0.55,
  });
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, 8);
  bodies.name = "giants";
  bodies.frustumCulled = false;
  const headGeo = new THREE.SphereGeometry(1.25, low ? 6 : 8, low ? 5 : 6);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x3a3028,
    roughness: 1,
    metalness: 0,
    emissive: 0x1c120e,
    emissiveIntensity: 0.4,
  });
  const heads = new THREE.InstancedMesh(headGeo, headMat, 8);
  heads.name = "giantHeads";
  heads.frustumCulled = false;
  const crownGeo = new THREE.CylinderGeometry(1.45, 1.55, 1.1, 6);
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0x1a1614,
    roughness: 1,
    metalness: 0,
    emissive: 0x0c0a08,
    emissiveIntensity: 0.3,
  });
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, 8);
  crowns.name = "giantCrowns";
  crowns.frustumCulled = false;
  const shackleGeo = new THREE.TorusGeometry(1.85, 0.09, 4, 8);
  const shackleMat = new THREE.MeshBasicMaterial({ color: 0xe4c060 });
  const shackles = new THREE.InstancedMesh(shackleGeo, shackleMat, 8);
  shackles.name = "giantWaists";
  shackles.frustumCulled = false;
  const shackleQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));

  for (let i = 0; i < angles.length; i++) {
    const a = angles[i]!;
    const hgt = 15.5 + (i % 4) * 1.7 + (i % 3) * 0.8;
    heights.push(hgt);
    const gx = cx + Math.cos(a) * 40;
    const gz = cy + Math.sin(a) * 40;
    s.set(1, hgt, 1);
    p.set(gx, 0, gz);
    q.identity();
    m.compose(p, q, s);
    bodies.setMatrixAt(i, m);
    s.set(1, 1, 1);
    p.y = hgt + 0.35;
    m.compose(p, q, s);
    heads.setMatrixAt(i, m);
    p.y = hgt + 1.7;
    s.set(1, 1, 1);
    m.compose(p, q, s);
    crowns.setMatrixAt(i, m);
    p.y = hgt * 0.46;
    m.compose(p, shackleQ, s);
    shackles.setMatrixAt(i, m);
  }
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  shackles.instanceMatrix.needsUpdate = true;
  group.add(bodies, heads, crowns, shackles);

  const linksPer = low ? 4 : 6;
  const linkGeo = new THREE.BoxGeometry(1, 1, 1);
  const linkMat = new THREE.MeshStandardMaterial({
    color: 0x6a5a40,
    roughness: 0.6,
    metalness: 0.35,
    emissive: 0x3a2c16,
    emissiveIntensity: 0.25,
  });
  const chains = new THREE.InstancedMesh(linkGeo, linkMat, angles.length * linksPer);
  chains.name = "chains";
  chains.frustumCulled = false;
  const dir = new THREE.Vector3();
  let link = 0;
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i]!;
    const hgt = heights[i]!;
    const x0 = cx + Math.cos(a) * 39.2;
    const z0 = cy + Math.sin(a) * 39.2;
    const y0 = hgt * 0.42;
    const x1 = cx + Math.cos(a) * 33.5;
    const z1 = cy + Math.sin(a) * 33.5;
    const y1 = 0.55;
    for (let k = 0; k < linksPer; k++) {
      const u0 = k / linksPer;
      const u1 = (k + 0.68) / linksPer;
      const ax = x0 + (x1 - x0) * u0;
      const ay = y0 + (y1 - y0) * u0;
      const az = z0 + (z1 - z0) * u0;
      const bx = x0 + (x1 - x0) * u1;
      const by = y0 + (y1 - y0) * u1;
      const bz = z0 + (z1 - z0) * u1;
      dir.set(bx - ax, by - ay, bz - az);
      const len = dir.length() || 0.2;
      dir.multiplyScalar(1 / len);
      q.setFromUnitVectors(Y_AXIS, dir);
      p.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
      s.set(0.1, len, 0.1);
      m.compose(p, q, s);
      chains.setMatrixAt(link++, m);
    }
  }
  chains.instanceMatrix.needsUpdate = true;
  group.add(chains);

  const spots: { x: number; z: number }[] = [
    { x: 43.2, z: 84.2 },
    { x: 52.8, z: 84.2 },
  ];
  const brazierN = low ? 4 : 6;
  const avoid: { x: number; z: number; r: number }[] = [
    { x: RANKED.x, z: RANKED.z, r: 11 },
    { x: 48, z: 88, r: 3.2 },
  ];
  for (let i = 0; i < SPAWNS.length; i++) avoid.push({ x: SPAWNS[i]![0], z: SPAWNS[i]![1], r: 3.4 });
  for (let i = 0; spots.length < brazierN && i < 20; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.35;
    const x = cx + Math.cos(a) * 32.5;
    const z = cy + Math.sin(a) * 32.5;
    let bad = false;
    for (let k = 0; k < spots.length; k++) {
      if (Math.hypot(spots[k]!.x - x, spots[k]!.z - z) < 8) bad = true;
    }
    for (let k = 0; k < avoid.length; k++) {
      const s0 = avoid[k]!;
      if (Math.hypot(s0.x - x, s0.z - z) < s0.r) bad = true;
    }
    for (let k = 0; k < angles.length; k++) {
      const gx = cx + Math.cos(angles[k]!) * 40;
      const gz = cy + Math.sin(angles[k]!) * 40;
      if (Math.hypot(gx - x, gz - z) < 3.4) bad = true;
    }
    if (!bad) spots.push({ x, z });
  }

  const bowlGeo = new THREE.CylinderGeometry(0.62, 0.46, 0.38, low ? 6 : 8);
  const bowlMat = new THREE.MeshStandardMaterial({
    color: 0x2a2018,
    roughness: 0.7,
    metalness: 0.2,
    emissive: 0x6a3010,
    emissiveIntensity: 0.55,
  });
  const bowls = new THREE.InstancedMesh(bowlGeo, bowlMat, spots.length);
  bowls.name = "braziers";
  bowls.frustumCulled = false;
  const flameGeo = new THREE.ConeGeometry(0.26, 0.72, low ? 5 : 6);
  flameGeo.translate(0, 0.36, 0);
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffb45a,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flames = new THREE.InstancedMesh(flameGeo, flameMat, spots.length);
  flames.name = "brazierFlames";
  flames.frustumCulled = false;
  const poolGeo = new THREE.CircleGeometry(3.3, low ? 10 : 16);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xffb060,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, spots.length);
  pools.name = "brazierPools";
  pools.frustumCulled = false;
  pools.renderOrder = 6;
  const flameXZ = new Float32Array(spots.length * 2);
  const lights: VirtualLight[] = [];
  q.identity();
  s.set(1, 1, 1);
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i]!;
    flameXZ[i * 2] = sp.x;
    flameXZ[i * 2 + 1] = sp.z;
    p.set(sp.x, 0.32, sp.z);
    m.compose(p, q, s);
    bowls.setMatrixAt(i, m);
    p.y = 0.08;
    m.compose(p, q, s);
    pools.setMatrixAt(i, m);
    p.y = 0.62;
    m.compose(p, q, s);
    flames.setMatrixAt(i, m);
    const vl = new VirtualLight(0xffb060, 1.35, 11, 2, 0.42);
    vl.position.set(sp.x, 1.5, sp.z);
    vl.name = "brazierLight";
    group.add(vl);
    lights.push(vl);
  }
  bowls.instanceMatrix.needsUpdate = true;
  flames.instanceMatrix.needsUpdate = true;
  pools.instanceMatrix.needsUpdate = true;
  group.add(bowls, pools, flames);

  const spawnRingGeo = new THREE.TorusGeometry(1.15, 0.07, 4, 12);
  spawnRingGeo.rotateX(Math.PI / 2);
  const spawnMat = new THREE.MeshBasicMaterial({
    color: 0xf0d48a,
    transparent: true,
    opacity: 0.85,
  });
  const spawnRings = new THREE.InstancedMesh(spawnRingGeo, spawnMat, SPAWNS.length);
  spawnRings.name = "spawnMarks";
  spawnRings.frustumCulled = false;
  const pillarGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 5);
  const pillarMat = new THREE.MeshBasicMaterial({ color: 0xe8c86a });
  const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, SPAWNS.length);
  pillars.name = "spawnPillars";
  pillars.frustumCulled = false;
  q.identity();
  s.set(1, 1, 1);
  for (let i = 0; i < SPAWNS.length; i++) {
    const sp = SPAWNS[i]!;
    p.set(sp[0], 0.1, sp[1]);
    m.compose(p, q, s);
    spawnRings.setMatrixAt(i, m);
    p.y = 0.85;
    m.compose(p, q, s);
    pillars.setMatrixAt(i, m);
  }
  spawnRings.instanceMatrix.needsUpdate = true;
  pillars.instanceMatrix.needsUpdate = true;
  group.add(spawnRings, pillars);

  const ashN = low ? 64 : 120;
  const ashPos = new Float32Array(ashN * 3);
  const ashVel = new Float32Array(ashN);
  for (let i = 0; i < ashN; i++) {
    const a = (i * 2.399) % (Math.PI * 2);
    const rad = 3 + ((i * 17) % 100) * 0.36;
    ashPos[i * 3] = cx + Math.cos(a) * rad;
    ashPos[i * 3 + 1] = 0.8 + ((i * 13) % 70) * 0.1;
    ashPos[i * 3 + 2] = cy + Math.sin(a * 1.17) * rad;
    ashVel[i] = 0.45 + (i % 5) * 0.11;
  }
  const ashGeo = new THREE.BufferGeometry();
  const ashAttr = new THREE.BufferAttribute(ashPos, 3);
  ashGeo.setAttribute("position", ashAttr);
  const ashMat = new THREE.PointsMaterial({
    color: 0xd8c8b0,
    map: softDotTexture(),
    size: low ? 0.16 : 0.2,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const ash = new THREE.Points(ashGeo, ashMat);
  ash.name = "wellAsh";
  ash.frustumCulled = false;
  group.add(ash);

  const tickM = new THREE.Matrix4();
  const tickP = new THREE.Vector3();
  const tickQ = new THREE.Quaternion();
  const tickS = new THREE.Vector3();
  let last = 0;
  group.userData.wellTick = (now: number) => {
    let dt = last ? (now - last) / 1000 : 0.016;
    last = now;
    if (!(dt > 0) || dt > 0.1) dt = 0.016;
    const n = flames.count;
    for (let i = 0; i < n; i++) {
      const flick = 0.82 + Math.sin(now * 0.009 + i * 1.7) * 0.2;
      tickS.set(flick, 0.75 + flick * 0.45, flick);
      tickP.set(flameXZ[i * 2]!, 0.62 + Math.sin(now * 0.013 + i) * 0.05, flameXZ[i * 2 + 1]!);
      tickM.compose(tickP, tickQ, tickS);
      flames.setMatrixAt(i, tickM);
      const L = lights[i];
      if (L) L.intensity = 1.05 + Math.sin(now * 0.011 + i * 1.3) * 0.4;
    }
    flames.instanceMatrix.needsUpdate = true;
    spawnMat.opacity = 0.55 + Math.sin(now * 0.004) * 0.28;
    for (let i = 0; i < ashN; i++) {
      const o = i * 3;
      ashPos[o + 1]! -= ashVel[i]! * dt;
      ashPos[o]! += Math.sin(now * 0.001 + i) * 0.004;
      if (ashPos[o + 1]! < 0.25) ashPos[o + 1] = 6.5 + (i % 4) * 0.4;
    }
    ashAttr.needsUpdate = true;
    for (let i = 0; i < fogs.length; i++) {
      const mat = fogs[i]!.material as THREE.MeshBasicMaterial;
      mat.opacity = (i === 0 ? 0.18 : 0.09) + Math.sin(now * 0.0007 + i) * 0.03;
    }
  };

  return {
    group,
    floor,
    cantoId: "inferno_31",
    heightAt,
    surfaceAt: heightAt,
  };
}
