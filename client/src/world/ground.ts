/**
 * Canto ground plane (XZ) + props. PlaneGeometry faces +z; rotateX(−π/2) maps
 * that to +y so the floor is visible from above (threejs-frame-conventions Rule 2).
 */
import * as THREE from "three";
import type { MatKit } from "./materials";
import {
  makeBrazier,
  makeFallenLog,
  makeForestRock,
  makeGaleRibbon,
  makeMossClump,
  makeRuinObelisk,
  makeStump,
  makeTree,
} from "./meshes";
import { isCompactUi } from "../ui/hud";

export type GroundRig = {
  group: THREE.Group;
  floor: THREE.Mesh;
  cantoId: string;
  heightAt: (x: number, z: number) => number;
};

function hash(i: number, j: number) {
  let n = i * 374761393 + j * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

function distToPoly(x: number, z: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const az = pts[i][1];
    const bx = pts[i + 1][0];
    const bz = pts[i + 1][1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) best = d;
  }
  return best;
}

const HUB_PATH: [number, number][] = [
  [52, 78],
  [58, 74],
  [64, 72],
  [70, 62],
  [80, 52],
  [90, 44],
  [96, 40],
];
const HUB_SPUR: [number, number][] = [
  [64, 72],
  [70, 76],
  [76, 78],
];
const HUB_WRIT: [number, number][] = [
  [64, 72],
  [64, 60],
];
const LUST_HUNT: [number, number][] = [
  [20, 60],
  [48, 48],
  [72, 60],
  [100, 52],
  [140, 60],
];
const GLUTTONY_HUNT: [number, number][] = [
  [18, 52],
  [44, 62],
  [70, 48],
  [100, 58],
  [138, 48],
];
const AVARICE_HUNT: [number, number][] = [
  [18, 52],
  [28, 50],
  [38, 56],
  [54, 68],
  [70, 48],
  [86, 58],
  [110, 52],
  [138, 48],
];

function huntPathFor(cantoId: string): [number, number][] {
  if (cantoId === "inferno_07") return AVARICE_HUNT;
  if (cantoId === "inferno_06") return GLUTTONY_HUNT;
  return LUST_HUNT;
}

function bossDaisFor(cantoId: string): { x: number; z: number } {
  if (cantoId === "inferno_07") return { x: 138, z: 48 };
  if (cantoId === "inferno_06") return { x: 138, z: 48 };
  return { x: 140, z: 60 };
}

/** Same displacement the floor mesh uses, so feet and props sit on the dirt. */
export function terrainHeight(
  cantoId: string,
  bounds: { width: number; height: number },
  wx: number,
  wz: number
): number {
  const isHub = cantoId === "inferno_01";
  const x = wx - bounds.width / 2;
  const z = wz - bounds.height / 2;
  const isGlut = cantoId === "inferno_06";
  const isAva = cantoId === "inferno_07";
  let n =
    Math.sin(x * 0.17) * Math.cos(z * 0.13) * (isHub ? 0.28 : isGlut || isAva ? 0.16 : 0.12) +
    Math.sin(x * 0.41 + z * 0.27) * (isGlut || isAva ? 0.11 : 0.08);
  if (isHub) {
    const pathD = Math.min(
      distToPoly(wx, wz, HUB_PATH),
      distToPoly(wx, wz, HUB_SPUR),
      distToPoly(wx, wz, HUB_WRIT)
    );
    if (pathD < 2.6) n *= 0.22;
  } else if (distToPoly(wx, wz, huntPathFor(cantoId)) < (isGlut || isAva ? 3.6 : 3.2)) {
    n *= isGlut || isAva ? 0.08 : 0.15;
  } else if (isGlut) {
    // Soft sinks between hunt lanes — mire pockets
    n -= 0.06 * Math.abs(Math.sin(x * 0.09) * Math.cos(z * 0.11));
  } else if (isAva) {
    // Hard scorched flats between weight lanes
    n *= 0.7;
  }
  return n;
}

export function buildGround(
  cantoId: string,
  bounds: { width: number; height: number },
  mats: MatKit,
  keepouts: { x: number; y: number; r: number }[]
): GroundRig {
  const group = new THREE.Group();
  group.name = `ground:${cantoId}`;
  const isHub = cantoId === "inferno_01";
  const w = bounds.width;
  const h = bounds.height;

  const heightAt = (x: number, z: number) => terrainHeight(cantoId, bounds, x, z);

  const segs = isHub ? 48 : 40;
  const geo = new THREE.PlaneGeometry(w + 24, h + 24, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + w / 2;
    const wz = pos.getZ(i) + h / 2;
    pos.setY(i, heightAt(wx, wz));
  }
  geo.computeVertexNormals();
  const ny = geo.attributes.normal.getY(0);
  if (ny < 0) {
    // Flip if the plane ended up facing down.
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setY(i, -nrm.getY(i));
  }

  if (isHub) {
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + w / 2;
      const wz = pos.getZ(i) + h / 2;
      const pathD = Math.min(distToPoly(wx, wz, HUB_PATH), distToPoly(wx, wz, HUB_SPUR), distToPoly(wx, wz, HUB_WRIT));
      const spawnD = Math.hypot(wx - 64, wz - 72);
      let k = 0.78 + hash((wx * 3) | 0, (wz * 3) | 0) * 0.16;
      if (spawnD < 7) k = 0.9 - (spawnD / 7) * 0.08;
      if (pathD < 3.4) k = 1.02 - (pathD / 3.4) * 0.1;
      colors[i * 3] = k;
      colors[i * 3 + 1] = k * 0.93;
      colors[i * 3 + 2] = k * 0.78;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
  }

  const floorMat = isHub
    ? mats.groundHub
    : cantoId === "inferno_07"
      ? mats.groundAvarice
      : cantoId === "inferno_06"
        ? mats.groundGlut
        : mats.groundLust;
  const floor = new THREE.Mesh(geo, floorMat);
  floor.receiveShadow = true;
  floor.position.set(w / 2, 0, h / 2);
  floor.name = "floor";
  group.add(floor);

  const fogSegs =
    cantoId === "inferno_07" || cantoId === "inferno_06"
      ? isCompactUi()
        ? 20
        : 32
      : 48;
  const fogRing = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(w, h) * 0.62, Math.max(w, h) * 1.4, fogSegs),
    new THREE.MeshBasicMaterial({
      color: isHub
        ? 0x1a1810
        : cantoId === "inferno_07"
          ? 0x14120a
          : cantoId === "inferno_06"
            ? 0x18160c
            : 0x201008,
      transparent: true,
      opacity: cantoId === "inferno_07" ? 0.34 : cantoId === "inferno_06" ? 0.4 : 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  fogRing.rotation.x = -Math.PI / 2;
  fogRing.position.set(w / 2, 0.04, h / 2);
  group.add(fogRing);

  const blocked = (x: number, z: number, r: number) => {
    if (x < 4 || z < 4 || x > w - 4 || z > h - 4) return true;
    for (const k of keepouts) {
      if (Math.hypot(x - k.x, z - k.y) < k.r + r) return true;
    }
    return false;
  };

  if (isHub) {
    const onTrail = (x: number, z: number, pad: number) =>
      distToPoly(x, z, HUB_PATH) < pad ||
      distToPoly(x, z, HUB_SPUR) < pad ||
      distToPoly(x, z, HUB_WRIT) < pad;
    const compactHub = isCompactUi();
    const groveN = compactHub ? 16 : 28;
    const treeCap = compactHub ? 36 : 64;
    const stumpCap = compactHub ? 8 : 16;
    const logCap = compactHub ? 6 : 12;
    const mossCap = compactHub ? 22 : 48;
    const rockCap = compactHub ? 12 : 22;

    for (let i = 0; i < groveN; i++) {
      const ang = (i / groveN) * Math.PI * 2 + hash(i, 71) * 0.2;
      let placedGrove = false;
      for (const rad of [6.4, 8.2, 10.4, 13.2]) {
        const x = 64 + Math.cos(ang) * rad;
        const z = 72 + Math.sin(ang) * rad;
        if (blocked(x, z, 1.8) || onTrail(x, z, 2.35)) continue;
        const tree = makeTree(mats, (hash(i, 73 + rad) * 1e9) | 1);
        tree.position.set(x, heightAt(x, z), z);
        tree.rotation.y = hash(i, 74) * Math.PI * 2;
        tree.scale.setScalar((rad < 8 ? 0.55 : 0.82) + hash(i, 75) * 0.55);
        group.add(tree);
        placedGrove = true;
        break;
      }
      if (!placedGrove) continue;
    }

    let placed = 0;
    for (let i = 0; i < 360 && placed < treeCap; i++) {
      const x = 4 + hash(i, 1) * (w - 8);
      const z = 4 + hash(i, 2) * (h - 8);
      if (blocked(x, z, 2.2) || onTrail(x, z, 2.9)) continue;
      const tree = makeTree(mats, (hash(i, 3) * 1e9) | 1);
      tree.position.set(x, heightAt(x, z), z);
      tree.rotation.y = hash(i, 4) * Math.PI * 2;
      const s = 0.62 + hash(i, 5) * 0.95;
      tree.scale.setScalar(s);
      group.add(tree);
      placed++;
    }
    placed = 0;
    for (let i = 0; i < 110 && placed < stumpCap; i++) {
      const x = 6 + hash(i, 11) * (w - 12);
      const z = 6 + hash(i, 12) * (h - 12);
      if (blocked(x, z, 1.4) || onTrail(x, z, 1.8)) continue;
      const stump = makeStump(mats, (hash(i, 13) * 1e9) | 1);
      stump.position.set(x, heightAt(x, z), z);
      stump.rotation.y = hash(i, 14) * Math.PI * 2;
      stump.scale.setScalar(0.85 + hash(i, 15) * 0.5);
      group.add(stump);
      placed++;
    }
    placed = 0;
    for (let i = 0; i < 90 && placed < logCap; i++) {
      const x = 6 + hash(i, 21) * (w - 12);
      const z = 6 + hash(i, 22) * (h - 12);
      if (blocked(x, z, 1.8) || onTrail(x, z, 2.2)) continue;
      const log = makeFallenLog(mats, (hash(i, 23) * 1e9) | 1);
      log.position.set(x, heightAt(x, z), z);
      log.rotation.y = hash(i, 24) * Math.PI * 2;
      log.scale.setScalar(0.8 + hash(i, 25) * 0.45);
      group.add(log);
      placed++;
    }
    placed = 0;
    for (let i = 0; i < 220 && placed < mossCap; i++) {
      const x = 5 + hash(i, 31) * (w - 10);
      const z = 5 + hash(i, 32) * (h - 10);
      if (blocked(x, z, 0.9)) continue;
      const moss = makeMossClump(mats, (hash(i, 33) * 1e9) | 1);
      moss.position.set(x, heightAt(x, z), z);
      group.add(moss);
      placed++;
    }
    placed = 0;
    for (let i = 0; i < 140 && placed < rockCap; i++) {
      const x = 5 + hash(i, 41) * (w - 10);
      const z = 5 + hash(i, 42) * (h - 10);
      if (blocked(x, z, 1.1) || onTrail(x, z, 1.4)) continue;
      const rock = makeForestRock(mats, (hash(i, 43) * 1e9) | 1);
      rock.position.set(x, heightAt(x, z), z);
      rock.rotation.y = hash(i, 44) * Math.PI * 2;
      group.add(rock);
      placed++;
    }
  } else {
    const hunt = huntPathFor(cantoId);
    const isGlut = cantoId === "inferno_06";
    const isAva = cantoId === "inferno_07";
    const isWeightLane = isGlut || isAva;
    const arenas: { x: number; z: number; r: number }[] = isWeightLane
      ? isAva
        ? [
            { x: 22, z: 22, r: 4 },
            { x: 30, z: 52, r: 5 },
            { x: 70, z: 48, r: 5 },
            { x: 86, z: 58, r: 6 },
            { x: 100, z: 26, r: 5 },
            { x: 112, z: 82, r: 5 },
            { x: 138, z: 48, r: 9 },
          ]
        : [
          { x: 30, z: 48, r: 5 },
          { x: 52, z: 38, r: 7 },
          { x: 68, z: 78, r: 7 },
          { x: 98, z: 44, r: 8 },
          { x: 118, z: 54, r: 6 },
          { x: 138, z: 48, r: 9 },
        ]
      : [
          { x: 32, z: 56, r: 5 },
          { x: 48, z: 40, r: 7 },
          { x: 72, z: 70, r: 7 },
          { x: 100, z: 50, r: 8 },
          { x: 122, z: 58, r: 6 },
          { x: 140, z: 60, r: 9 },
        ];
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + w / 2;
      const wz = pos.getZ(i) + h / 2;
      const pathD = distToPoly(wx, wz, hunt);
      let k = 0.72 + hash((wx * 2) | 0, (wz * 2) | 0) * 0.18;
      if (pathD < 4.2) k = 1.12 - (pathD / 4.2) * 0.16;
      else if (pathD > 16) k *= 0.62;
      for (const a of arenas) {
        const d = Math.hypot(wx - a.x, wz - a.z);
        if (d < a.r) k = Math.max(k, 0.92 + (1 - d / a.r) * 0.18);
      }
      if (isGlut) {
        // Brighter packed path vs darker off-path mire sinks
        const onPath = pathD < 3.8;
        const sink = pathD > 11 ? 0.72 : pathD > 6 ? 0.88 : 1;
        if (onPath) {
          colors[i * 3] = k * 1.05;
          colors[i * 3 + 1] = k * 0.95;
          colors[i * 3 + 2] = k * 0.55;
        } else {
          colors[i * 3] = k * 0.7 * sink;
          colors[i * 3 + 1] = k * 0.62 * sink;
          colors[i * 3 + 2] = k * 0.32 * sink;
        }
      } else if (isAva) {
        // Stronger gold road vs pitch off-path (gold-on-black irony; slash-readable)
        const onPath = pathD < 3.9;
        const sink = pathD > 11 ? 0.48 : pathD > 6 ? 0.72 : 1;
        // NW Drift scorched flats — darker ledger corner
        const nw = Math.hypot(wx - 22, wz - 22);
        const nwScorch = nw < 18 ? 0.72 + (nw / 18) * 0.28 : 1;
        if (onPath) {
          colors[i * 3] = k * 1.22;
          colors[i * 3 + 1] = k * 0.98;
          colors[i * 3 + 2] = k * 0.42;
        } else {
          colors[i * 3] = k * 0.38 * sink * nwScorch;
          colors[i * 3 + 1] = k * 0.32 * sink * nwScorch;
          colors[i * 3 + 2] = k * 0.18 * sink * nwScorch;
        }
      } else {
        colors[i * 3] = k * 1.05;
        colors[i * 3 + 1] = k * 0.72;
        colors[i * 3 + 2] = k * 0.55;
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const compactDecor = isCompactUi();
    const obCap = compactDecor ? (isWeightLane ? 4 : 5) : isWeightLane ? 6 : 8;
    let placed = 0;
    for (let i = 0; i < 70 && placed < obCap; i++) {
      const x = 8 + hash(i, 7) * (w - 16);
      const z = 8 + hash(i, 8) * (h - 16);
      if (blocked(x, z, 3.2) || distToPoly(x, z, hunt) < 4.5) continue;
      if (arenas.some((a) => Math.hypot(x - a.x, z - a.z) < a.r + 1.5)) continue;
      const ob = makeRuinObelisk(mats);
      ob.position.set(x, heightAt(x, z), z);
      ob.rotation.y = hash(i, 9) * Math.PI * 2;
      ob.scale.setScalar(0.85 + hash(i, 10) * 0.7);
      if (isWeightLane) {
        ob.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.castShadow = false;
        });
      }
      group.add(ob);
      placed++;
    }
    const compact = isCompactUi();
    const ringSegs = compact ? (isWeightLane ? 18 : 22) : isWeightLane ? 24 : 40;
    for (const a of arenas) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(a.r, isWeightLane ? 0.1 : 0.07, 6, ringSegs),
        isGlut ? mats.mire : mats.gold
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(a.x, heightAt(a.x, a.z) + 0.12, a.z);
      ring.castShadow = false;
      group.add(ring);
      // Compact / Avarice: one brazier per arena (density + tick cost)
      const placeBoth = !compact && !isAva;
      const brazL = makeBrazier(mats);
      const lx = a.x - a.r * 0.72;
      const lz = a.z - a.r * 0.22;
      brazL.position.set(lx, heightAt(lx, lz), lz);
      group.add(brazL);
      if (placeBoth) {
        const brazR = makeBrazier(mats);
        const rx = a.x + a.r * 0.72;
        const rz = a.z + a.r * 0.22;
        brazR.position.set(rx, heightAt(rx, rz), rz);
        group.add(brazR);
      }
    }
    for (let i = 0; i < hunt.length - 1; i++) {
      const a = hunt[i];
      const b = hunt[i + 1];
      const mx = (a[0] + b[0]) * 0.5;
      const mz = (a[1] + b[1]) * 0.5;
      const rib = makeGaleRibbon(mats, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.55);
      rib.position.set(mx, heightAt(mx, mz) + 1.8, mz);
      rib.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      const mat = rib.material as THREE.MeshBasicMaterial;
      mat.side = THREE.DoubleSide;
      mat.opacity = isWeightLane ? 0.32 : 0.45;
      if (isGlut && mat.color) mat.color.set(0x6a5a30);
      if (isAva && mat.color) mat.color.set(0x8a7040);
      group.add(rib);
      const crack = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.62, 0.05, 0.22), mats.ember);
      crack.position.set(mx, heightAt(mx, mz) + 0.05, mz);
      crack.rotation.y = rib.rotation.y;
      crack.castShadow = false;
      crack.receiveShadow = false;
      group.add(crack);
    }
    const daisPos = bossDaisFor(cantoId);
    if (isGlut) {
      const mud = new THREE.MeshStandardMaterial({
        color: 0x3a3220,
        roughness: 0.95,
        metalness: 0.04,
        emissive: 0x1a180c,
        emissiveIntensity: 0.22,
      });
      const hy = heightAt(daisPos.x, daisPos.z);
      // Stepped dais: plinth + lip + dual sludge rings (readable boss arena)
      const dais = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 8.6, 0.62, compact ? 14 : 18), mud);
      dais.position.set(daisPos.x, hy + 0.22, daisPos.z);
      dais.receiveShadow = true;
      dais.castShadow = false;
      group.add(dais);
      const step = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.8, 0.28, compact ? 12 : 16), mud);
      step.position.set(daisPos.x, hy + 0.58, daisPos.z);
      step.receiveShadow = true;
      step.castShadow = false;
      group.add(step);
      const lipSegs = compact ? 20 : 28;
      const lip = new THREE.Mesh(new THREE.TorusGeometry(7.8, 0.14, 6, lipSegs), mats.gold);
      lip.rotation.x = Math.PI / 2;
      lip.position.set(daisPos.x, hy + 0.55, daisPos.z);
      lip.castShadow = false;
      group.add(lip);
      const filth = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.1, 6, lipSegs), mats.mire);
      filth.rotation.x = Math.PI / 2;
      filth.position.set(daisPos.x, hy + 0.72, daisPos.z);
      filth.castShadow = false;
      filth.name = "daisPulse";
      group.add(filth);
      const filth2 = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.07, 5, compact ? 16 : 22), mats.mire);
      filth2.rotation.x = Math.PI / 2;
      filth2.position.set(daisPos.x, hy + 0.76, daisPos.z);
      filth2.castShadow = false;
      filth2.name = "daisPulse";
      group.add(filth2);
      // Cheap boss-arena telegraph: additive ring, pulsed in WorldApp (no custom shaders).
      const tele = new THREE.Mesh(
        new THREE.RingGeometry(6.2, 6.55, compact ? 24 : 32),
        new THREE.MeshBasicMaterial({
          color: 0xa8b040,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      tele.rotation.x = -Math.PI / 2;
      tele.position.set(daisPos.x, hy + 0.82, daisPos.z);
      tele.castShadow = false;
      tele.name = "daisTelegraph";
      group.add(tele);

      // Shared puddle geo/mat + InstancedMesh (was N unique Mesh+Material)
      const puddleMat = new THREE.MeshStandardMaterial({
        color: 0x2a2818,
        roughness: 0.35,
        metalness: 0.25,
        emissive: 0x3a4018,
        emissiveIntensity: 0.2,
        transparent: true,
        opacity: 0.74,
      });
      const puddleGeo = new THREE.CircleGeometry(1, 12);
      const puddleN = compact ? Math.min(4, hunt.length) : hunt.length + 3;
      const puddles = new THREE.InstancedMesh(puddleGeo, puddleMat, puddleN);
      puddles.castShadow = false;
      puddles.receiveShadow = true;
      puddles.frustumCulled = true;
      const _m = new THREE.Matrix4();
      const _p = new THREE.Vector3();
      const _q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      const _s = new THREE.Vector3();
      for (let i = 0; i < puddleN; i++) {
        const [px, pz] =
          i < hunt.length
            ? hunt[i]
            : ([20 + hash(i, 90) * (w - 40), 20 + hash(i, 91) * (h - 40)] as [number, number]);
        const sc = 1.3 + hash(i, 92) * 1.2;
        _p.set(px + (hash(i, 93) - 0.5) * 2.4, heightAt(px, pz) + 0.05, pz + (hash(i, 94) - 0.5) * 2.4);
        _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s);
        puddles.setMatrixAt(i, _m);
      }
      puddles.instanceMatrix.needsUpdate = true;
      group.add(puddles);

      // Instanced sludge mounds — one Icosahedron + shared moss mat
      const moundCap = compact ? 7 : 12;
      const moundGeo = new THREE.IcosahedronGeometry(0.7, 0);
      const moundsMesh = new THREE.InstancedMesh(moundGeo, mats.moss, moundCap);
      moundsMesh.castShadow = false;
      moundsMesh.receiveShadow = true;
      moundsMesh.frustumCulled = true;
      let mounds = 0;
      for (let i = 0; i < 100 && mounds < moundCap; i++) {
        const x = 10 + hash(i, 61) * (w - 20);
        const z = 10 + hash(i, 62) * (h - 20);
        if (blocked(x, z, 2.2) || distToPoly(x, z, hunt) < 3.8) continue;
        if (arenas.some((a) => Math.hypot(x - a.x, z - a.z) < a.r + 1.2)) continue;
        _p.set(x, heightAt(x, z) + 0.1, z);
        _q.setFromEuler(new THREE.Euler(0, hash(i, 65) * Math.PI * 2, 0));
        _s.set(1.35 + hash(i, 63) * 0.5, 0.32 + hash(i, 64) * 0.22, 1.15 + hash(i, 66) * 0.35);
        _m.compose(_p, _q, _s);
        moundsMesh.setMatrixAt(mounds++, _m);
      }
      moundsMesh.count = mounds;
      moundsMesh.instanceMatrix.needsUpdate = true;
      group.add(moundsMesh);

      // Fewer low olive haze ribbons (compact: 3, desktop: 4)
      const hazeN = compact ? 3 : 4;
      for (let i = 0; i < hazeN; i++) {
        const ribbon = makeGaleRibbon(mats, 14 + i * 3);
        const mat = ribbon.material as THREE.MeshBasicMaterial;
        mat.color.set(0x6a7a30);
        mat.opacity = compact ? 0.2 : 0.26;
        const rx = 28 + i * 28;
        const rz = 44 + (i % 2) * 12;
        ribbon.position.set(rx, heightAt(rx, rz) + 0.7, rz);
        ribbon.rotation.y = 0.12 * (i % 2 ? -1 : 1);
        ribbon.rotation.x = Math.PI * 0.06;
        ribbon.castShadow = false;
        group.add(ribbon);
      }
    } else if (isAva) {
      const metal = new THREE.MeshStandardMaterial({
        color: 0x2a2418,
        roughness: 0.55,
        metalness: 0.45,
        emissive: 0x3a2a10,
        emissiveIntensity: 0.28,
      });
      const hy = heightAt(daisPos.x, daisPos.z);
      const dais = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 8.6, 0.62, compact ? 14 : 18), metal);
      dais.position.set(daisPos.x, hy + 0.22, daisPos.z);
      dais.receiveShadow = true;
      dais.castShadow = false;
      group.add(dais);
      const step = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.8, 0.28, compact ? 12 : 16), metal);
      step.position.set(daisPos.x, hy + 0.58, daisPos.z);
      step.receiveShadow = true;
      step.castShadow = false;
      group.add(step);
      const lipSegs = compact ? 20 : 28;
      const lip = new THREE.Mesh(new THREE.TorusGeometry(7.8, 0.14, 6, lipSegs), mats.gold);
      lip.rotation.x = Math.PI / 2;
      lip.position.set(daisPos.x, hy + 0.55, daisPos.z);
      lip.castShadow = false;
      lip.name = "daisPulse";
      group.add(lip);
      const coinRing = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.1, 6, lipSegs), mats.gold);
      coinRing.rotation.x = Math.PI / 2;
      coinRing.position.set(daisPos.x, hy + 0.72, daisPos.z);
      coinRing.castShadow = false;
      coinRing.name = "daisPulse";
      group.add(coinRing);
      // Inner measure ring (Gluttony filth2 parity — Crush dais read)
      // Compact: static (no daisPulse tick) to cut propAnims cost
      const coinInner = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.07, 5, compact ? 14 : 22), mats.bronze);
      coinInner.rotation.x = Math.PI / 2;
      coinInner.position.set(daisPos.x, hy + 0.76, daisPos.z);
      coinInner.castShadow = false;
      if (!compact) coinInner.name = "daisPulse";
      group.add(coinInner);
      const tele = new THREE.Mesh(
        new THREE.RingGeometry(6.2, 6.55, compact ? 24 : 32),
        new THREE.MeshBasicMaterial({
          color: 0xd4a840,
          transparent: true,
          opacity: 0.24,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      tele.rotation.x = -Math.PI / 2;
      tele.position.set(daisPos.x, hy + 0.82, daisPos.z);
      tele.castShadow = false;
      tele.name = "daisTelegraph";
      group.add(tele);

      // Scorched coin discs along hunt (InstancedMesh)
      const coinMat = new THREE.MeshStandardMaterial({
        color: 0x9a7840,
        roughness: 0.38,
        metalness: 0.58,
        emissive: 0x4a3810,
        emissiveIntensity: 0.32,
        transparent: true,
        opacity: 0.88,
      });
      const coinGeo = new THREE.CircleGeometry(1, compact ? 8 : 10);
      const coinN = compact ? Math.min(4, hunt.length) : hunt.length + 3;
      const coins = new THREE.InstancedMesh(coinGeo, coinMat, coinN);
      coins.castShadow = false;
      coins.receiveShadow = true;
      coins.frustumCulled = true;
      const _m = new THREE.Matrix4();
      const _p = new THREE.Vector3();
      const _q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      const _s = new THREE.Vector3();
      for (let i = 0; i < coinN; i++) {
        const [px, pz] =
          i < hunt.length
            ? hunt[i]
            : ([20 + hash(i, 90) * (w - 40), 20 + hash(i, 91) * (h - 40)] as [number, number]);
        const sc = 1.1 + hash(i, 92) * 1.0;
        _p.set(px + (hash(i, 93) - 0.5) * 2.4, heightAt(px, pz) + 0.05, pz + (hash(i, 94) - 0.5) * 2.4);
        _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s);
        coins.setMatrixAt(i, _m);
      }
      coins.instanceMatrix.needsUpdate = true;
      group.add(coins);

      // Scorched ledger cracks along hunt (InstancedMesh; cheap boxes)
      const crackMat = new THREE.MeshStandardMaterial({
        color: 0x1a140c,
        roughness: 0.92,
        metalness: 0.08,
        emissive: 0x3a2a10,
        emissiveIntensity: 0.22,
      });
      const crackGeo = new THREE.BoxGeometry(1.8, 0.04, 0.14);
      const crackN = compact ? 4 : 9;
      const cracks = new THREE.InstancedMesh(crackGeo, crackMat, crackN);
      cracks.castShadow = false;
      cracks.receiveShadow = true;
      cracks.frustumCulled = true;
      for (let i = 0; i < crackN; i++) {
        const [px, pz] =
          i < hunt.length
            ? hunt[i]
            : ([30 + hash(i, 81) * (w - 60), 30 + hash(i, 82) * (h - 60)] as [number, number]);
        _p.set(px + (hash(i, 83) - 0.5) * 1.6, heightAt(px, pz) + 0.04, pz + (hash(i, 84) - 0.5) * 1.6);
        _q.setFromEuler(new THREE.Euler(0, hash(i, 85) * Math.PI, 0));
        _s.set(0.9 + hash(i, 86) * 0.7, 1, 1);
        _m.compose(_p, _q, _s);
        cracks.setMatrixAt(i, _m);
      }
      cracks.instanceMatrix.needsUpdate = true;
      group.add(cracks);

      // Rolling weight props (short cylinders)
      const weightCap = compact ? 4 : 10;
      const weightGeo = new THREE.CylinderGeometry(0.55, 0.62, 0.35, compact ? 8 : 10);
      const weightsMesh = new THREE.InstancedMesh(weightGeo, mats.bronze, weightCap);
      weightsMesh.castShadow = false;
      weightsMesh.receiveShadow = true;
      weightsMesh.frustumCulled = true;
      let weights = 0;
      for (let i = 0; i < 100 && weights < weightCap; i++) {
        const x = 10 + hash(i, 61) * (w - 20);
        const z = 10 + hash(i, 62) * (h - 20);
        if (blocked(x, z, 2.2) || distToPoly(x, z, hunt) < 3.8) continue;
        if (arenas.some((a) => Math.hypot(x - a.x, z - a.z) < a.r + 1.2)) continue;
        _p.set(x, heightAt(x, z) + 0.18, z);
        _q.setFromEuler(new THREE.Euler(0, hash(i, 65) * Math.PI * 2, Math.PI / 2));
        _s.set(1.1 + hash(i, 63) * 0.4, 1, 1.1 + hash(i, 66) * 0.35);
        _m.compose(_p, _q, _s);
        weightsMesh.setMatrixAt(weights++, _m);
      }
      weightsMesh.count = weights;
      weightsMesh.instanceMatrix.needsUpdate = true;
      group.add(weightsMesh);

      // Restrained gold haze (Lust-soften parity — keep slash readable)
      const hazeN = compact ? 1 : 2;
      for (let i = 0; i < hazeN; i++) {
        const ribbon = makeGaleRibbon(mats, 14 + i * 3);
        const mat = ribbon.material as THREE.MeshBasicMaterial;
        mat.color.set(0xa88a40);
        mat.opacity = compact ? 0.1 : 0.13;
        const rx = 28 + i * 28;
        const rz = 44 + (i % 2) * 12;
        ribbon.position.set(rx, heightAt(rx, rz) + 0.7, rz);
        ribbon.rotation.y = 0.12 * (i % 2 ? -1 : 1);
        ribbon.rotation.x = Math.PI * 0.06;
        ribbon.castShadow = false;
        group.add(ribbon);
      }

      // Mid-path ledger slabs + Gluttony-gate approach plates (content beat; cheap boxes)
      const slabPts: [number, number][] = compact
        ? [[18, 52], [28, 50], [70, 48], [86, 58]]
        : [[14, 50], [22, 52], [28, 50], [44, 58], [70, 48], [86, 58], [100, 56], [112, 82], [124, 40]];
      for (let i = 0; i < slabPts.length; i++) {
        const [sx, sz] = slabPts[i]!;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.7), mats.bone);
        slab.position.set(sx, heightAt(sx, sz) + 0.06, sz);
        slab.rotation.y = hash(i, 77) * Math.PI;
        slab.castShadow = false;
        slab.receiveShadow = true;
        const trim = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.03, 0.08), mats.gold);
        trim.position.set(sx, heightAt(sx, sz) + 0.12, sz);
        trim.rotation.y = slab.rotation.y;
        trim.castShadow = false;
        group.add(slab, trim);
      }
    } else {
      const dais = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7.2, 0.4, 20), mats.stone);
      dais.position.set(daisPos.x, heightAt(daisPos.x, daisPos.z) + 0.14, daisPos.z);
      dais.receiveShadow = true;
      group.add(dais);
      for (let i = 0; i < 5; i++) {
        const ribbon = makeGaleRibbon(mats, 14 + i * 2);
        const rx = 28 + i * 24;
        const rz = 58 + (i % 2) * 4;
        ribbon.position.set(rx, heightAt(rx, rz) + 1.15, rz);
        ribbon.rotation.y = 0.08 * (i % 2 ? -1 : 1);
        group.add(ribbon);
      }
    }
  }

  return { group, floor, cantoId, heightAt };
}
