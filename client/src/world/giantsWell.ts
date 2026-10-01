/**
 * Pozzo dei Giganti — a dark round pit, bone-gold rim, towers sunk to the waist.
 * Planar (x, y) is three.js (x, z). The floor faces +y (PlaneGeometry rotateX −π/2).
 * Cheap: one displaced plane, one open cylinder, instanced towers. No real lights.
 */
import * as THREE from "three";
import type { MatKit } from "./materials";
import type { GroundRig } from "./ground";
import { isCompactUi } from "../ui/hud";
import { VirtualLight } from "./lightPool";

function wellHeight(w: number, h: number, x: number, z: number): number {
  const dx = x - w * 0.5;
  const dz = z - h * 0.5;
  const r = Math.hypot(dx, dz);
  let n = r < 36 ? -0.22 * (1 - r / 36) * (1 - r / 36) : 0;
  n += Math.sin(x * 0.31) * Math.cos(z * 0.27) * 0.04;
  return n;
}

/** Eight towers on a ring, nudged off the north exit and the wake spawn. */
function towerAngles(w: number, h: number): number[] {
  const cx = w * 0.5;
  const cy = h * 0.5;
  const exitY = h * 0.916;
  const spawnY = h * 0.77;
  const r = 39;
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    let a = ((22 + i * 45) * Math.PI) / 180;
    for (let k = 0; k < 8; k++) {
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const nearExit = Math.hypot(x - cx, y - exitY) < 7;
      const nearSpawn = Math.hypot(x - cx, y - spawnY) < 7;
      if (!nearExit && !nearSpawn) break;
      a += 0.16;
    }
    out.push(a);
  }
  return out;
}

export function buildGiantsWell(bounds: { width: number; height: number }, _mats: MatKit): GroundRig {
  const w = bounds.width;
  const h = bounds.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const compact = isCompactUi();
  const group = new THREE.Group();
  group.name = "ground:inferno_31";

  const heightAt = (x: number, z: number) => wellHeight(w, h, x, z);

  const segs = compact ? 16 : 26;
  const geo = new THREE.PlaneGeometry(w + 16, h + 16, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + cx;
    const wz = pos.getZ(i) + cy;
    pos.setY(i, heightAt(wx, wz));
    const dx = wx - cx;
    const dz = wz - cy;
    const r = Math.hypot(dx, dz);
    const u = Math.min(1, r / 46);
    // Bowl is near-black; the lip lifts to a cold ash so the rim reads.
    const shade = 0.07 + u * 0.16;
    cols[i * 3] = shade * 0.85;
    cols[i * 3 + 1] = shade * 0.78;
    cols[i * 3 + 2] = shade * 0.68;
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
    roughness: 1,
    metalness: 0,
  });
  const floor = new THREE.Mesh(geo, floorMat);
  floor.name = "floor";
  floor.receiveShadow = true;
  group.add(floor);

  const wallSeg = compact ? 16 : 24;
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(45.2, 45.2, 3.4, wallSeg, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x100e0c,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    })
  );
  wall.name = "pitWall";
  wall.position.set(cx, 0.85, cy);
  group.add(wall);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(45.2, 0.26, compact ? 4 : 6, compact ? 32 : 48),
    new THREE.MeshBasicMaterial({ color: 0xe4c060 })
  );
  rim.name = "pitRim";
  rim.rotation.x = Math.PI / 2;
  rim.position.set(cx, 2.15, cy);
  group.add(rim);

  const etch = new THREE.Mesh(
    new THREE.RingGeometry(17.6, 18.15, compact ? 28 : 40),
    new THREE.MeshBasicMaterial({
      color: 0xc9a227,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  etch.rotation.x = -Math.PI / 2;
  etch.position.set(cx, 0.08, cy);
  group.add(etch);

  const ash = new THREE.Mesh(
    new THREE.CircleGeometry(34, compact ? 16 : 24),
    new THREE.MeshBasicMaterial({
      color: 0x2a241c,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  ash.rotation.x = -Math.PI / 2;
  ash.position.set(cx, 0.04, cy);
  group.add(ash);

  const bodyGeo = new THREE.CylinderGeometry(1.25, 1.85, 18, 6);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x3a3028,
    roughness: 1,
    metalness: 0,
    emissive: 0x241810,
    emissiveIntensity: 0.65,
  });
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, 8);
  bodies.name = "giants";
  const headGeo = new THREE.SphereGeometry(1.35, compact ? 6 : 8, compact ? 5 : 6);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x4a3c32,
    roughness: 1,
    metalness: 0,
    emissive: 0x2a1c14,
    emissiveIntensity: 0.5,
  });
  const heads = new THREE.InstancedMesh(headGeo, headMat, 8);
  heads.name = "giantHeads";
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const angles = towerAngles(w, h);
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i]!;
    p.set(cx + Math.cos(a) * 39, 0, cy + Math.sin(a) * 39);
    m.compose(p, q, s);
    bodies.setMatrixAt(i, m);
    p.y = 8.55;
    m.compose(p, q, s);
    heads.setMatrixAt(i, m);
  }
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  const waistGeo = new THREE.TorusGeometry(1.72, 0.07, 4, 8);
  const waistMat = new THREE.MeshBasicMaterial({ color: 0xc9a227 });
  const waists = new THREE.InstancedMesh(waistGeo, waistMat, 8);
  waists.name = "giantWaists";
  const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i]!;
    p.set(cx + Math.cos(a) * 39, 2.2, cy + Math.sin(a) * 39);
    m.compose(p, wq, s);
    waists.setMatrixAt(i, m);
  }
  waists.instanceMatrix.needsUpdate = true;
  group.add(bodies, heads, waists);

  // Markers only — LightPool may promote one, and the priority stays under the hero lantern.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const vl = new VirtualLight(0xc4a060, 0.7, 12, 2, 0.35);
    vl.position.set(cx + Math.cos(a) * 28, 2.2, cy + Math.sin(a) * 28);
    group.add(vl);
  }

  return {
    group,
    floor,
    cantoId: "inferno_31",
    heightAt,
    surfaceAt: heightAt,
  };
}
