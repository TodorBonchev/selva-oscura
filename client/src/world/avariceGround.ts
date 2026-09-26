/**
 * Avarice ground dressing that follows the processions (avariceProcession.ts): the two
 * worn tracks the weights roll in (both arcs: gold rims, dark rut grooves, a polished
 * lane) and the scarred clash rings where the road meets them — one merged, vertex-
 * coloured mesh (one draw) — plus Plutus's two coin piles. Static, built with the
 * canto's ground and disposed with it (ground.ts).
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

/** Bronze of the scarred clash rings (linear RGB, like the track profile). */
const RING_RGB: [number, number, number] = [0.62, 0.42, 0.16];

/** A torus as a track part: position + normal + colour only (merges with the strip). */
function ringPart(r: number, tube: number, segs: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, tube, 3, segs);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  g.deleteAttribute("uv");
  const n = g.attributes.position!.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = RING_RGB[0];
    col[i * 3 + 1] = RING_RGB[1];
    col[i * 3 + 2] = RING_RGB[2];
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** The tracks + scarred clash rings at W and E, merged (one draw). */
function trackAndRings(heightAt: (x: number, z: number) => number, compact: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [trackGeometry(heightAt, compact ? 48 : 96)];
  for (const c of [PROC.W, PROC.E]) {
    const y = heightAt(c.x, c.y) + 0.06;
    parts.push(ringPart(PROC.CLASH_R, 0.075, compact ? 28 : 40, c.x, y, c.y));
    parts.push(ringPart(PROC.CLASH_R * 0.42, 0.05, compact ? 14 : 22, c.x, y, c.y));
  }
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g!;
}

/** Plutus's hoard: two coin piles in the tip of the ring, flanking the Ledger Bell (the Fiorini rise from them; server PILES). */
const PILES: [number, number][] = [
  [120.5, 48.2],
  [120.5, 53.2],
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

/** Add the tracks + clash rings and the coin piles to the Avarice ground group. */
export function buildAvariceTracks(
  group: THREE.Group,
  heightAt: (x: number, z: number) => number,
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
  const tracks = new THREE.Mesh(trackAndRings(heightAt, compact), trackMat);
  tracks.name = "avaTracks";
  tracks.receiveShadow = true;
  tracks.castShadow = false;
  // (drawn with the floor pass: after the other opaques, before the sky)
  tracks.renderOrder = 5;
  group.add(tracks);
  const piles = new THREE.Mesh(pileGeometry(heightAt), pileMat);
  piles.name = "avaCoinPiles";
  piles.castShadow = !compact;
  group.add(piles);
}
