/**
 * Canto ground plane (XZ) + props. PlaneGeometry faces +z; rotateX(−π/2) maps
 * that to +y so the floor is visible from above (threejs-frame-conventions Rule 2).
 */
import * as THREE from "three";
import type { MatKit } from "./materials";
import { makeRuinObelisk, makeTree } from "./meshes";

export type GroundRig = {
  group: THREE.Group;
  floor: THREE.Mesh;
  cantoId: string;
};

function hash(i: number, j: number) {
  let n = i * 374761393 + j * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
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

  const segs = isHub ? 48 : 40;
  const geo = new THREE.PlaneGeometry(w + 24, h + 24, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 0.17) * Math.cos(z * 0.13) * (isHub ? 0.28 : 0.12) +
      Math.sin(x * 0.41 + z * 0.27) * 0.08;
    pos.setY(i, n);
  }
  geo.computeVertexNormals();
  const ny = geo.attributes.normal.getY(0);
  if (ny < 0) {
    // Flip if the plane ended up facing down.
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setY(i, -nrm.getY(i));
  }

  const floor = new THREE.Mesh(geo, isHub ? mats.groundHub : mats.groundLust);
  floor.receiveShadow = true;
  floor.position.set(w / 2, 0, h / 2);
  floor.name = "floor";
  group.add(floor);

  const fogRing = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(w, h) * 0.62, Math.max(w, h) * 1.4, 48),
    new THREE.MeshBasicMaterial({
      color: isHub ? 0x1a1810 : 0x201008,
      transparent: true,
      opacity: 0.28,
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
    let placed = 0;
    for (let i = 0; i < 180 && placed < 36; i++) {
      const x = 4 + hash(i, 1) * (w - 8);
      const z = 4 + hash(i, 2) * (h - 8);
      if (blocked(x, z, 2.4)) continue;
      const tree = makeTree(mats, (hash(i, 3) * 1e9) | 1);
      tree.position.set(x, 0, z);
      tree.rotation.y = hash(i, 4) * Math.PI * 2;
      const s = 0.75 + hash(i, 5) * 0.7;
      tree.scale.setScalar(s);
      group.add(tree);
      placed++;
    }
  } else {
    let placed = 0;
    for (let i = 0; i < 80 && placed < 18; i++) {
      const x = 8 + hash(i, 7) * (w - 16);
      const z = 8 + hash(i, 8) * (h - 16);
      if (blocked(x, z, 3.2)) continue;
      const ob = makeRuinObelisk(mats);
      ob.position.set(x, 0, z);
      ob.rotation.y = hash(i, 9) * Math.PI * 2;
      ob.scale.setScalar(0.8 + hash(i, 10) * 0.7);
      group.add(ob);
      placed++;
    }
    // Boss dais
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7.2, 0.35, 24), mats.stone);
    dais.position.set(140, 0.12, 60);
    dais.receiveShadow = true;
    group.add(dais);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(6.8, 0.08, 8, 40), mats.gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(140, 0.32, 60);
    group.add(rim);
  }

  return { group, floor, cantoId };
}
