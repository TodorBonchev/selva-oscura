/**
 * Avarice ground dressing that follows the processions (avariceProcession.ts): the two
 * worn tracks the weights roll in (one merged strip, both arcs: gold rims, dark rut
 * grooves, a polished lane) and the scarred clash rings where the road crosses them.
 * Static, built with the canto's ground and disposed with it (ground.ts).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GEO, PROC, arcPoint, type ArcPt } from "./avariceProcession";

/** Across-lane profile: offset from the track centreline → colour (linear RGB). */
const PROFILE: [number, number, number, number][] = [
  [-1.3, 0.5, 0.36, 0.13],
  [-1.14, 0.95, 0.7, 0.28],
  [-0.98, 0.025, 0.02, 0.012],
  [-0.62, 0.07, 0.055, 0.032],
  [0.62, 0.07, 0.055, 0.032],
  [0.98, 0.025, 0.02, 0.012],
  [1.14, 0.95, 0.7, 0.28],
  [1.3, 0.5, 0.36, 0.13],
];

/** Worn tracks: one strip per arc, merged (one draw). */
function trackGeometry(heightAt: (x: number, z: number) => number, segs: number): THREE.BufferGeometry {
  const ext = 1.4;
  const nA = PROFILE.length;
  const rows = segs + 1;
  const pos = new Float32Array(2 * rows * nA * 3);
  const col = new Float32Array(2 * rows * nA * 3);
  const idx: number[] = [];
  const p: ArcPt = { x: 0, y: 0, tx: 1, ty: 0 };
  let v = 0;
  for (let k = 0; k < 2; k++) {
    const base = v;
    for (let i = 0; i < rows; i++) {
      const s = -ext + ((GEO.L + 2 * ext) * i) / segs;
      arcPoint(k, s, p);
      // across = left of the tangent (−ty, tx)
      for (let a = 0; a < nA; a++) {
        const [o, r, g, b] = PROFILE[a]!;
        const x = p.x - p.ty * o;
        const z = p.y + p.tx * o;
        pos[v * 3] = x;
        pos[v * 3 + 1] = heightAt(x, z) + 0.035;
        pos[v * 3 + 2] = z;
        // the lane darkens toward the clash points (worn by every blow)
        const end = Math.min(s, GEO.L - s);
        const scar = end < 6 ? 0.7 + 0.3 * Math.max(0, end / 6) : 1;
        col[v * 3] = r * scar;
        col[v * 3 + 1] = g * scar;
        col[v * 3 + 2] = b * scar;
        v++;
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let a = 0; a < nA - 1; a++) {
        const i0 = base + i * nA + a;
        const i1 = i0 + 1;
        const j0 = i0 + nA;
        const j1 = j0 + 1;
        // across × along = +y: the faces look up whichever way the arc turns
        idx.push(i0, i1, j0, i1, j1, j0);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Scarred clash rings at W and E (merged, one draw). */
function clashGeometry(heightAt: (x: number, z: number) => number, compact: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const c of [PROC.W, PROC.E]) {
    const ring = new THREE.TorusGeometry(PROC.CLASH_R, 0.075, 4, compact ? 28 : 40);
    ring.rotateX(Math.PI / 2);
    ring.translate(c.x, heightAt(c.x, c.y) + 0.06, c.y);
    parts.push(ring);
    const inner = new THREE.TorusGeometry(PROC.CLASH_R * 0.42, 0.05, 4, compact ? 16 : 22);
    inner.rotateX(Math.PI / 2);
    inner.translate(c.x, heightAt(c.x, c.y) + 0.06, c.y);
    parts.push(inner);
  }
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g!;
}

/** Plutus's two coin piles on his dais rim (the Fiorini rise from them; server PILES). */
const PILES: [number, number][] = [
  [138, 39.5],
  [138, 56.5],
];

function pileGeometry(heightAt: (x: number, z: number) => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [px, pz] of PILES) {
    const y0 = heightAt(px, pz);
    for (let i = 0; i < 6; i++) {
      const r = 0.72 - i * 0.1;
      const c = new THREE.CylinderGeometry(r, r + 0.04, 0.16, 12);
      const a = i * 1.7;
      c.translate(px + Math.cos(a) * 0.06 * i, y0 + 0.08 + i * 0.15, pz + Math.sin(a) * 0.06 * i);
      parts.push(c);
    }
    // a few loose coins spilled around it
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const c = new THREE.CylinderGeometry(0.22, 0.22, 0.05, 8);
      c.rotateZ(0.25 * (i % 2 ? 1 : -1));
      c.translate(px + Math.cos(a) * 1.05, y0 + 0.04, pz + Math.sin(a) * 1.05);
      parts.push(c);
    }
  }
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g!;
}

/** Add the tracks + clash rings to the Avarice ground group. */
export function buildAvariceTracks(
  group: THREE.Group,
  heightAt: (x: number, z: number) => number,
  ringMat: THREE.Material,
  compact: boolean,
  pileMat: THREE.Material
) {
  const trackMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    // (fully rough: no grazing-angle sheen turning the dark lane into a pale band)
    roughness: 1,
    metalness: 0,
    emissive: 0x140a02,
    emissiveIntensity: 0.3,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const tracks = new THREE.Mesh(trackGeometry(heightAt, compact ? 64 : 96), trackMat);
  tracks.name = "avaTracks";
  tracks.receiveShadow = true;
  tracks.castShadow = false;
  // (drawn with the floor pass: after the other opaques, before the sky)
  tracks.renderOrder = 5;
  group.add(tracks);
  const clash = new THREE.Mesh(clashGeometry(heightAt, compact), ringMat);
  clash.name = "avaClashRings";
  clash.castShadow = false;
  group.add(clash);
  const piles = new THREE.Mesh(pileGeometry(heightAt), pileMat);
  piles.name = "avaCoinPiles";
  piles.castShadow = !compact;
  group.add(piles);
}
