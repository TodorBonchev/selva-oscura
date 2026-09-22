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

function huntPathFor(cantoId: string): [number, number][] {
  if (cantoId === "inferno_06") return GLUTTONY_HUNT;
  return LUST_HUNT;
}

function bossDaisFor(cantoId: string): { x: number; z: number } {
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
  let n =
    Math.sin(x * 0.17) * Math.cos(z * 0.13) * (isHub ? 0.28 : isGlut ? 0.16 : 0.12) +
    Math.sin(x * 0.41 + z * 0.27) * (isGlut ? 0.11 : 0.08);
  if (isHub) {
    const pathD = Math.min(
      distToPoly(wx, wz, HUB_PATH),
      distToPoly(wx, wz, HUB_SPUR),
      distToPoly(wx, wz, HUB_WRIT)
    );
    if (pathD < 2.6) n *= 0.22;
  } else if (distToPoly(wx, wz, huntPathFor(cantoId)) < (isGlut ? 3.6 : 3.2)) {
    n *= isGlut ? 0.08 : 0.15;
  } else if (isGlut) {
    // Soft sinks between hunt lanes — mire pockets
    n -= 0.06 * Math.abs(Math.sin(x * 0.09) * Math.cos(z * 0.11));
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

  const floorMat =
    isHub ? mats.groundHub : cantoId === "inferno_06" ? mats.groundGlut : mats.groundLust;
  const floor = new THREE.Mesh(geo, floorMat);
  floor.receiveShadow = true;
  floor.position.set(w / 2, 0, h / 2);
  floor.name = "floor";
  group.add(floor);

  const fogRing = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(w, h) * 0.62, Math.max(w, h) * 1.4, 48),
    new THREE.MeshBasicMaterial({
      color: isHub ? 0x1a1810 : cantoId === "inferno_06" ? 0x18160c : 0x201008,
      transparent: true,
      opacity: cantoId === "inferno_06" ? 0.4 : 0.28,
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

    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * Math.PI * 2 + hash(i, 71) * 0.2;
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
    for (let i = 0; i < 360 && placed < 64; i++) {
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
    for (let i = 0; i < 110 && placed < 16; i++) {
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
    for (let i = 0; i < 90 && placed < 12; i++) {
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
    for (let i = 0; i < 220 && placed < 48; i++) {
      const x = 5 + hash(i, 31) * (w - 10);
      const z = 5 + hash(i, 32) * (h - 10);
      if (blocked(x, z, 0.9)) continue;
      const moss = makeMossClump(mats, (hash(i, 33) * 1e9) | 1);
      moss.position.set(x, heightAt(x, z), z);
      group.add(moss);
      placed++;
    }
    placed = 0;
    for (let i = 0; i < 140 && placed < 22; i++) {
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
    const arenas: { x: number; z: number; r: number }[] = isGlut
      ? [
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
        // Muddy olive-brown with darker off-path sinks
        const sink = pathD > 10 ? 0.82 : 1;
        colors[i * 3] = k * 0.78 * sink;
        colors[i * 3 + 1] = k * 0.72 * sink;
        colors[i * 3 + 2] = k * 0.38 * sink;
      } else {
        colors[i * 3] = k * 1.05;
        colors[i * 3 + 1] = k * 0.72;
        colors[i * 3 + 2] = k * 0.55;
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    let placed = 0;
    for (let i = 0; i < 70 && placed < 8; i++) {
      const x = 8 + hash(i, 7) * (w - 16);
      const z = 8 + hash(i, 8) * (h - 16);
      if (blocked(x, z, 3.2) || distToPoly(x, z, hunt) < 4.5) continue;
      if (arenas.some((a) => Math.hypot(x - a.x, z - a.z) < a.r + 1.5)) continue;
      const ob = makeRuinObelisk(mats);
      ob.position.set(x, heightAt(x, z), z);
      ob.rotation.y = hash(i, 9) * Math.PI * 2;
      ob.scale.setScalar(0.85 + hash(i, 10) * 0.7);
      group.add(ob);
      placed++;
    }
    for (const a of arenas) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(a.r, isGlut ? 0.09 : 0.07, 8, 40),
        isGlut ? mats.mire : mats.gold
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(a.x, heightAt(a.x, a.z) + 0.12, a.z);
      group.add(ring);
      const brazL = makeBrazier(mats);
      const lx = a.x - a.r * 0.72;
      const lz = a.z - a.r * 0.22;
      brazL.position.set(lx, heightAt(lx, lz), lz);
      const brazR = makeBrazier(mats);
      const rx = a.x + a.r * 0.72;
      const rz = a.z + a.r * 0.22;
      brazR.position.set(rx, heightAt(rx, rz), rz);
      group.add(brazL, brazR);
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
      mat.opacity = isGlut ? 0.32 : 0.45;
      if (isGlut && mat.color) mat.color.set(0x6a5a30);
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
        emissiveIntensity: 0.2,
      });
      const dais = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 8.2, 0.55, 22), mud);
      dais.position.set(daisPos.x, heightAt(daisPos.x, daisPos.z) + 0.18, daisPos.z);
      dais.receiveShadow = true;
      group.add(dais);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(7.6, 0.12, 8, 40), mats.gold);
      lip.rotation.x = Math.PI / 2;
      lip.position.set(daisPos.x, heightAt(daisPos.x, daisPos.z) + 0.48, daisPos.z);
      group.add(lip);
      const filth = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.09, 8, 36), mats.mire);
      filth.rotation.x = Math.PI / 2;
      filth.position.set(daisPos.x, heightAt(daisPos.x, daisPos.z) + 0.52, daisPos.z);
      group.add(filth);
      // Puddles along the hunt path
      for (let i = 0; i < hunt.length; i++) {
        const [px, pz] = hunt[i];
        const puddle = new THREE.Mesh(
          new THREE.CircleGeometry(1.4 + hash(i, 91) * 1.1, 18),
          new THREE.MeshStandardMaterial({
            color: 0x2a2818,
            roughness: 0.35,
            metalness: 0.25,
            emissive: 0x3a4018,
            emissiveIntensity: 0.18,
            transparent: true,
            opacity: 0.72,
          })
        );
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(px + (hash(i, 92) - 0.5) * 2.2, heightAt(px, pz) + 0.06, pz + (hash(i, 93) - 0.5) * 2.2);
        puddle.receiveShadow = true;
        group.add(puddle);
      }
      // Sludge mounds off-path
      let mounds = 0;
      for (let i = 0; i < 90 && mounds < 14; i++) {
        const x = 10 + hash(i, 61) * (w - 20);
        const z = 10 + hash(i, 62) * (h - 20);
        if (blocked(x, z, 2.2) || distToPoly(x, z, hunt) < 3.8) continue;
        if (arenas.some((a) => Math.hypot(x - a.x, z - a.z) < a.r + 1.2)) continue;
        const mound = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 + hash(i, 63) * 0.7, 0), mats.moss);
        mound.position.set(x, heightAt(x, z) + 0.12, z);
        mound.scale.set(1.4, 0.35 + hash(i, 64) * 0.25, 1.2);
        mound.rotation.y = hash(i, 65) * Math.PI * 2;
        group.add(mound);
        mounds++;
      }
      // Low mire haze ribbons (olive) instead of high gale streamers
      for (let i = 0; i < 6; i++) {
        const ribbon = makeGaleRibbon(mats, 12 + i * 2);
        const mat = ribbon.material as THREE.MeshBasicMaterial;
        mat.color.set(0x6a7a30);
        mat.opacity = 0.28;
        const rx = 22 + i * 20;
        const rz = 46 + (i % 2) * 10;
        ribbon.position.set(rx, heightAt(rx, rz) + 0.85, rz);
        ribbon.rotation.y = 0.12 * (i % 2 ? -1 : 1);
        ribbon.rotation.x = Math.PI * 0.08;
        group.add(ribbon);
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
