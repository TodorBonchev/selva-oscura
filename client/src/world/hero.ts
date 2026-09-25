/**
 * The Wanderer — the player's hero (also remote players, and the Guide via a palette).
 *
 * A pilgrim in the Doré manner: ivory robe, crimson mantle and hood with a long
 * tail (the poet's cappuccio), laurel circlet, brown leather, steel longsword.
 * Designed to read at phone scale (~110 px tall): light robe against every canto's
 * ground, a dark crimson cape mass behind, gold edges that catch the rim light.
 *
 * Rig contract (anim.ts / gearLook.ts / WorldApp rely on these names):
 *   wanderer → hips → { legL/R → kneeL/R (toeL/R), tabard, apron,
 *                        torso → { armL/R → elbowL/R → handL/R (weapon, offhand, slashAnchor),
 *                                  head → { hood, nose }, cloak } }
 * Local forward is −z, feet on y = 0, ~1.84 tall before the 1.42 world scale.
 * Gear pieces carry userData.gearSlot (shown only when that slot is equipped).
 * Parts are merged per (joint, material, slot) to keep draw calls low on phones,
 * and keep their own smooth normals (no flat recompute after merging).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { MatKit } from "./materials";
import type { EquipSlot } from "../items/icons";
import { tagGearSlot } from "./gearLook";
import { isCompactUi } from "../ui/hud";

export type HeroPalette = "pilgrim" | "guide";

type Slot = EquipSlot | null;

// ——— geometry helpers ————————————————————————————————————————————————

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Transform a freshly built geometry in place (normals follow via the normal matrix). */
function at<G extends THREE.BufferGeometry>(
  g: G,
  px = 0,
  py = 0,
  pz = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1
): G {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(px, py, pz);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  return g;
}

/** Surface of revolution; profile is [radius, y] from bottom to top (outward normals). */
function lathe(profile: [number, number][], seg: number, phiStart = 0, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
    phiStart,
    phiLength
  );
}

/** Tube along a smooth path with a radius profile over t ∈ [0, 1]. */
function taperTube(pts: THREE.Vector3[], r0: number, r1: number, tubular: number, radial: number) {
  const path = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(path, tubular, 1, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    path.getPointAt(t, c);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  pos.needsUpdate = true;
  return g;
}

/** Tube with constant radius (trims, straps). */
function trim(pts: THREE.Vector3[], r: number, tubular: number, radial = 5, closed = false) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), tubular, r, radial, closed);
}

/**
 * Cloth sheet from a surface function f(u, v) → point (u across, v down).
 * Winding gives normals toward +f.normalSide; smooth normals from the index.
 */
function sheet(cols: number, rows: number, f: (u: number, v: number) => THREE.Vector3, flip = false) {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const p = f(c / cols, r / rows);
      pos.push(p.x, p.y, p.z);
      uv.push(c / cols, 1 - r / rows);
    }
  }
  const w = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * w + c;
      const b = a + 1;
      const d = a + w;
      const e = d + 1;
      if (flip) idx.push(a, b, d, b, e, d);
      else idx.push(a, d, b, b, d, e);
    }
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function rbox(w: number, h: number, d: number, r: number, seg = 2) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
}

/** Collects geometry per (joint, material, slot) and merges into one mesh each. */
class Rig {
  private bins = new Map<THREE.Object3D, Map<string, { mat: THREE.Material; slot: Slot; geos: THREE.BufferGeometry[] }>>();

  add(parent: THREE.Object3D, mat: THREE.Material, geo: THREE.BufferGeometry, slot: Slot = null) {
    let m = this.bins.get(parent);
    if (!m) {
      m = new Map();
      this.bins.set(parent, m);
    }
    const key = `${mat.uuid}|${slot ?? ""}`;
    let b = m.get(key);
    if (!b) {
      b = { mat, slot, geos: [] };
      m.set(key, b);
    }
    const flat = geo.index ? geo.toNonIndexed() : geo;
    if (flat !== geo) geo.dispose();
    // mergeGeometries needs identical attribute sets
    for (const name of Object.keys(flat.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") flat.deleteAttribute(name);
    }
    b.geos.push(flat);
  }

  flush() {
    for (const [parent, m] of this.bins) {
      for (const b of m.values()) {
        const merged = b.geos.length === 1 ? b.geos[0]! : mergeGeometries(b.geos, false);
        if (!merged) continue;
        if (b.geos.length > 1) for (const g of b.geos) g.dispose();
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, b.mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (b.slot) tagGearSlot(mesh, b.slot);
        parent.add(mesh);
      }
    }
    this.bins.clear();
  }
}

function joint(name: string, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
}

// ——— materials ————————————————————————————————————————————————————————

let _grainTex: THREE.CanvasTexture | null = null;

/** Soft leather grain (the kit's leather map is near-black embossing). */
function grainTexture(): THREE.CanvasTexture {
  if (_grainTex) return _grainTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#b8b0a4";
  g.fillRect(0, 0, 128, 128);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 900; i++) {
    const v = 150 + rnd() * 80;
    g.fillStyle = `rgba(${v},${v * 0.96},${v * 0.9},${0.25 + rnd() * 0.3})`;
    g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  g.strokeStyle = "rgba(70,60,50,0.25)";
  for (let i = 0; i < 24; i++) {
    g.beginPath();
    const x = rnd() * 128;
    const y = rnd() * 128;
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 30);
    g.stroke();
  }
  _grainTex = new THREE.CanvasTexture(c);
  _grainTex.wrapS = _grainTex.wrapT = THREE.RepeatWrapping;
  _grainTex.colorSpace = THREE.SRGBColorSpace;
  return _grainTex;
}

let _linenTex: THREE.CanvasTexture | null = null;
let _woolTex: THREE.CanvasTexture | null = null;

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** Fine linen weave with faint etched hatching — keeps the palette colour clean. */
function linenTexture(): THREE.CanvasTexture {
  if (_linenTex) return _linenTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f2ede4";
  g.fillRect(0, 0, 256, 256);
  const rnd = seeded(11);
  for (let i = 0; i < 256; i += 2) {
    g.fillStyle = `rgba(120,105,85,${0.05 + rnd() * 0.05})`;
    g.fillRect(0, i, 256, 1);
    g.fillStyle = `rgba(120,105,85,${0.04 + rnd() * 0.04})`;
    g.fillRect(i, 0, 1, 256);
  }
  g.strokeStyle = "rgba(90,75,60,0.08)";
  g.lineWidth = 1;
  for (let i = -256; i < 512; i += 7) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 256, 256);
    g.stroke();
  }
  _linenTex = new THREE.CanvasTexture(c);
  _linenTex.wrapS = _linenTex.wrapT = THREE.RepeatWrapping;
  _linenTex.repeat.set(3, 3);
  _linenTex.colorSpace = THREE.SRGBColorSpace;
  return _linenTex;
}

/** Heavy wool: soft vertical fold streaks under engraved cross-hatching. */
function woolTexture(): THREE.CanvasTexture {
  if (_woolTex) return _woolTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ece6de";
  g.fillRect(0, 0, 256, 256);
  const rnd = seeded(23);
  for (let i = 0; i < 18; i++) {
    const x = rnd() * 256;
    const w = 6 + rnd() * 18;
    const grd = g.createLinearGradient(x - w, 0, x + w, 0);
    grd.addColorStop(0, "rgba(60,40,30,0)");
    grd.addColorStop(0.5, `rgba(60,40,30,${0.06 + rnd() * 0.08})`);
    grd.addColorStop(1, "rgba(60,40,30,0)");
    g.fillStyle = grd;
    g.fillRect(x - w, 0, w * 2, 256);
  }
  g.strokeStyle = "rgba(50,35,25,0.1)";
  for (let i = -256; i < 512; i += 5) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 180, 256);
    g.stroke();
  }
  _woolTex = new THREE.CanvasTexture(c);
  _woolTex.wrapS = _woolTex.wrapT = THREE.RepeatWrapping;
  _woolTex.repeat.set(2, 2);
  _woolTex.colorSpace = THREE.SRGBColorSpace;
  return _woolTex;
}

type HeroMats = {
  robe: THREE.MeshStandardMaterial;
  tunic: THREE.MeshStandardMaterial;
  trousers: THREE.MeshStandardMaterial;
  mantle: THREE.MeshStandardMaterial;
  lining: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  darkLeather: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
};

const PALETTES: Record<HeroPalette, { robe: number; tunic: number; mantle: number; lining: number; leather: number }> = {
  // Ivory pilgrim, crimson mantle — the living soul among dark shades
  pilgrim: { robe: 0xe4d7b6, tunic: 0xa89572, mantle: 0x8a2219, lining: 0x3c0f0b, leather: 0x7a5236 },
  // Guide: slate scholar's robe, umber mantle (no crimson — never mistaken for a player)
  guide: { robe: 0x7a7c88, tunic: 0x5a5a64, mantle: 0x4a3a2c, lining: 0x241a12, leather: 0x5a4030 },
};

function heroMats(mats: MatKit, palette: HeroPalette): HeroMats {
  const P = PALETTES[palette];
  const linen = linenTexture();
  const wool = woolTexture();
  const grain = grainTexture();
  return {
    robe: new THREE.MeshStandardMaterial({ map: linen, color: P.robe, roughness: 0.86, metalness: 0.02 }),
    tunic: new THREE.MeshStandardMaterial({ map: linen, color: P.tunic, roughness: 0.9, metalness: 0.02 }),
    trousers: new THREE.MeshStandardMaterial({ map: wool, color: 0x4a3c2e, roughness: 0.92, metalness: 0.02 }),
    mantle: new THREE.MeshStandardMaterial({
      map: wool,
      color: P.mantle,
      roughness: 0.82,
      metalness: 0.03,
      side: THREE.FrontSide,
    }),
    lining: new THREE.MeshStandardMaterial({
      map: wool,
      color: P.lining,
      roughness: 0.9,
      metalness: 0.02,
      side: THREE.BackSide,
    }),
    leather: new THREE.MeshStandardMaterial({ map: grain, color: P.leather, roughness: 0.66, metalness: 0.06 }),
    darkLeather: new THREE.MeshStandardMaterial({ map: grain, color: 0x3a2a1e, roughness: 0.6, metalness: 0.06 }),
    gold: new THREE.MeshStandardMaterial({
      map: mats.gold.map,
      color: 0xf0cc70,
      roughness: 0.3,
      metalness: 0.85,
      emissive: 0x5a3c0c,
      emissiveIntensity: 0.35,
    }),
    plate: new THREE.MeshStandardMaterial({
      map: mats.gold.map,
      color: 0xa88458,
      roughness: 0.36,
      metalness: 0.72,
      emissive: 0x2a1a08,
      emissiveIntensity: 0.2,
    }),
    // Bright, slightly warm steel: the dim hemisphere env would turn pure chrome grey
    steel: new THREE.MeshStandardMaterial({
      color: 0xeceae4,
      roughness: 0.3,
      metalness: 0.72,
      emissive: 0x2a2620,
      emissiveIntensity: 0.35,
      envMapIntensity: 1.3,
    }),
    skin: new THREE.MeshStandardMaterial({ color: 0xcf9f7c, roughness: 0.62, metalness: 0.0 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x2e2016, roughness: 0.7, metalness: 0.02 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.25, metalness: 0.1 }),
  };
}

// ——— proportions ——————————————————————————————————————————————————————

const HIP_Y = 0.93; // leg pivot (abs)
const THIGH = 0.43;
const SHIN = 0.5; // knee → sole
const WAIST_Y = 1.06; // torso pivot (abs), child of hips
const SHOULDER_X = 0.205;
const SHOULDER_Y = 0.395; // torso-local
const NECK_Y = 0.52; // torso-local head pivot
const HEAD_SCALE = 1.12;

/** Tunic torso radius at torso-local y (before the 1.22 × 0.74 ellipse). */
const TORSO_PROFILE: [number, number][] = [
  [0.136, -0.07],
  [0.14, 0.04],
  [0.153, 0.14],
  [0.168, 0.25],
  [0.172, 0.32],
  [0.16, 0.39],
  [0.124, 0.44],
  [0.07, 0.48],
];
const TORSO_SX = 1.22;
const TORSO_SZ = 0.74;

function torsoR(y: number): number {
  const p = TORSO_PROFILE;
  if (y <= p[0]![1]) return p[0]![0];
  for (let i = 1; i < p.length; i++) {
    const [r1, y1] = p[i]!;
    const [r0, y0] = p[i - 1]!;
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return p[p.length - 1]![0];
}

/** Point on the (robe) torso surface: side = −1 front, +1 back. */
function torsoSurf(x: number, y: number, side: -1 | 1, pad = 0.012): THREE.Vector3 {
  const r = torsoR(y) + pad;
  const a = r * TORSO_SX;
  const b = r * TORSO_SZ;
  const k = Math.min(0.999, Math.abs(x) / a);
  return new THREE.Vector3(x, y, side * b * Math.sqrt(1 - k * k));
}

// ——— parts ————————————————————————————————————————————————————————————

function buildLeg(rig: Rig, M: HeroMats, side: -1 | 1, hi: boolean, armored: boolean): THREE.Group {
  const seg = hi ? 14 : 9;
  const leg = joint(side < 0 ? "legL" : "legR", 0.098 * side, HIP_Y, 0);
  // thigh + hip joint cover
  rig.add(leg, M.trousers, at(new THREE.SphereGeometry(0.079, seg, hi ? 10 : 7), 0, -0.01, 0, 0, 0, 0, 1, 0.9, 1.02));
  rig.add(
    leg,
    M.trousers,
    at(lathe([[0.052, -THIGH], [0.06, -0.36], [0.07, -0.22], [0.078, -0.09], [0.08, 0]], seg), 0, 0, 0, 0, 0, 0, 1, 1, 1.05)
  );

  const knee = joint(side < 0 ? "kneeL" : "kneeR", 0, -THIGH, 0);
  rig.add(knee, M.trousers, at(new THREE.SphereGeometry(0.052, seg, hi ? 8 : 6), 0, 0, -0.004, 0, 0, 0, 1, 0.95, 1.05));
  rig.add(
    knee,
    M.trousers,
    lathe([[0.034, -0.45], [0.04, -0.39], [0.052, -0.24], [0.057, -0.13], [0.05, 0]], seg)
  );
  // bare foot: soft shoe (always)
  rig.add(knee, M.darkLeather, at(rbox(0.078, 0.062, 0.2, 0.026, hi ? 3 : 2), 0, -SHIN + 0.031, -0.045));
  rig.add(knee, M.darkLeather, at(new THREE.SphereGeometry(0.04, seg, 6), 0, -0.445, 0.0, 0, 0, 0, 1, 0.8, 1.1));

  // Feet slot: tall riding boots with a folded cuff, gilded shin plate and knee cop
  rig.add(
    knee,
    M.leather,
    lathe([[0.046, -0.45], [0.05, -0.37], [0.061, -0.22], [0.066, -0.14], [0.068, -0.11]], seg),
    "Feet"
  );
  rig.add(knee, M.leather, at(new THREE.TorusGeometry(0.068, 0.016, 6, seg), 0, -0.115, 0, Math.PI / 2), "Feet");
  rig.add(knee, M.leather, at(rbox(0.09, 0.078, 0.228, 0.03, hi ? 3 : 2), 0, -SHIN + 0.043, -0.05), "Feet");
  rig.add(knee, M.darkLeather, at(rbox(0.094, 0.02, 0.236, 0.008, 1), 0, -SHIN + 0.01, -0.052), "Feet");
  if (armored) {
    rig.add(
      knee,
      M.plate,
      at(new THREE.CylinderGeometry(0.069, 0.058, 0.25, seg, 1, true, Math.PI * 0.62, Math.PI * 0.76), 0, -0.27, 0),
      "Feet"
    );
    rig.add(
      knee,
      M.gold,
      at(new THREE.SphereGeometry(0.046, seg, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 0.005, -0.03, -Math.PI / 2, 0, 0, 1, 0.6, 1),
      "Feet"
    );
    rig.add(knee, M.gold, at(rbox(0.06, 0.03, 0.05, 0.012, 1), 0, -SHIN + 0.05, -0.15), "Feet");
  }

  const toe = joint(side < 0 ? "toeL" : "toeR", 0, -SHIN + 0.03, -0.14);
  knee.add(toe);
  leg.add(knee);
  return leg;
}

function buildHand(rig: Rig, M: HeroMats, side: -1 | 1, hi: boolean): THREE.Group {
  const hand = joint(side < 0 ? "handL" : "handR", 0, -0.27, 0);
  // bare fist (always; the glove covers it)
  rig.add(hand, M.skin, at(rbox(0.052, 0.082, 0.066, 0.022, hi ? 3 : 2), 0, -0.045, -0.004));
  rig.add(hand, M.skin, at(new THREE.CapsuleGeometry(0.014, 0.03, 3, hi ? 8 : 6), -side * 0.024, -0.035, -0.03, 0.6, 0, -side * 0.35));
  // Hands slot: leather gauntlet with flared cuff and gold knuckle bar
  rig.add(hand, M.leather, at(rbox(0.06, 0.09, 0.074, 0.025, hi ? 3 : 2), 0, -0.046, -0.004), "Hands");
  rig.add(
    hand,
    M.leather,
    lathe([[0.034, -0.005], [0.046, 0.04], [0.058, 0.085]], hi ? 12 : 8),
    "Hands"
  );
  rig.add(hand, M.gold, at(new THREE.TorusGeometry(0.058, 0.007, 5, hi ? 16 : 10), 0, 0.085, 0, Math.PI / 2), "Hands");
  rig.add(hand, M.gold, at(rbox(0.064, 0.014, 0.02, 0.006, 1), 0, -0.06, -0.04), "Hands");
  return hand;
}

function buildArm(rig: Rig, M: HeroMats, side: -1 | 1, hi: boolean, armored: boolean): THREE.Group {
  const seg = hi ? 14 : 9;
  const arm = joint(side < 0 ? "armL" : "armR", SHOULDER_X * side, SHOULDER_Y, 0);
  arm.rotation.z = side * 0.16; // rest flare (tickHumanoid keeps ±0.16)
  // tunic sleeve (always)
  rig.add(arm, M.tunic, at(new THREE.SphereGeometry(0.062, seg, hi ? 10 : 7), 0, -0.01, 0, 0, 0, 0, 1, 0.92, 1.05));
  rig.add(arm, M.tunic, lathe([[0.044, -0.29], [0.05, -0.2], [0.056, -0.11], [0.057, -0.04], [0.05, 0.01]], seg));
  // Chest slot: robe sleeve over it + layered pauldron (the Guide goes unarmoured)
  rig.add(arm, M.robe, lathe([[0.05, -0.28], [0.056, -0.19], [0.062, -0.1], [0.063, -0.04], [0.057, 0.015]], seg), "Chest");
  const tilt = side * -0.5;
  if (armored) {
    rig.add(
      arm,
      M.plate,
      at(new THREE.SphereGeometry(0.086, seg, hi ? 8 : 6, 0, Math.PI * 2, 0, Math.PI * 0.5), side * 0.012, 0.018, 0, 0, 0, tilt, 1.12, 0.78, 1.15),
      "Chest"
    );
    rig.add(
      arm,
      M.plate,
      at(new THREE.SphereGeometry(0.078, seg, hi ? 7 : 5, 0, Math.PI * 2, 0, Math.PI * 0.42), side * 0.03, -0.035, 0, 0, 0, tilt * 1.3, 1.05, 0.7, 1.1),
      "Chest"
    );
    rig.add(
      arm,
      M.gold,
      at(new THREE.TorusGeometry(0.094, 0.008, 5, hi ? 22 : 14), side * 0.012, 0.018, 0, Math.PI / 2, 0, tilt, 1.02, 1.04, 1),
      "Chest"
    );
    rig.add(arm, M.gold, at(new THREE.SphereGeometry(0.013, 6, 5), side * 0.03, 0.07, 0), "Chest");
  }

  const elbow = joint(side < 0 ? "elbowL" : "elbowR", 0, -0.29, 0);
  rig.add(elbow, M.tunic, at(new THREE.SphereGeometry(0.046, seg, 6), 0, 0, 0));
  rig.add(elbow, M.tunic, lathe([[0.036, -0.26], [0.041, -0.2], [0.048, -0.1], [0.047, 0.01]], seg));
  rig.add(elbow, M.robe, lathe([[0.043, -0.25], [0.047, -0.19], [0.054, -0.09], [0.054, 0.02]], seg), "Chest");
  rig.add(elbow, M.gold, at(new THREE.TorusGeometry(0.045, 0.007, 5, hi ? 16 : 10), 0, -0.235, 0, Math.PI / 2), "Chest");
  elbow.add(buildHand(rig, M, side, hi));
  arm.add(elbow);
  return arm;
}

function buildSword(rig: Rig, M: HeroMats, hi: boolean): THREE.Group {
  const w = joint("weapon");
  // Blade: tapered, beveled edges, point along −y from the guard at y = 0
  const s = new THREE.Shape();
  s.moveTo(-0.021, 0);
  s.lineTo(-0.019, -0.62);
  s.quadraticCurveTo(-0.017, -0.76, 0, -0.86);
  s.quadraticCurveTo(0.017, -0.76, 0.019, -0.62);
  s.lineTo(0.021, 0);
  s.closePath();
  const blade = new THREE.ExtrudeGeometry(s, {
    depth: 0.004,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.007,
    bevelSegments: 1,
    curveSegments: hi ? 6 : 4,
  });
  blade.translate(0, 0, -0.002);
  rig.add(w, M.steel, blade, "MainHand");
  rig.add(w, M.plate, at(new THREE.BoxGeometry(0.008, 0.5, 0.0185), 0, -0.3, 0), "MainHand");
  // Cross-guard with down-swept quillons
  rig.add(w, M.gold, at(rbox(0.07, 0.03, 0.036, 0.01, 1), 0, 0, 0), "MainHand");
  for (const sx of [-1, 1]) {
    rig.add(
      w,
      M.gold,
      taperTube(
        [new THREE.Vector3(0.03 * sx, 0, 0), new THREE.Vector3(0.09 * sx, 0.004, 0), new THREE.Vector3(0.13 * sx, -0.022, 0)],
        0.013,
        0.008,
        6,
        hi ? 6 : 4
      ),
      "MainHand"
    );
    rig.add(w, M.gold, at(new THREE.SphereGeometry(0.014, 6, 5), 0.132 * sx, -0.024, 0), "MainHand");
  }
  // Grip wrapped in dark leather with gold ferrules, disc pommel
  rig.add(w, M.darkLeather, at(new THREE.CylinderGeometry(0.019, 0.021, 0.15, hi ? 10 : 7), 0, 0.09, 0), "MainHand");
  rig.add(w, M.gold, at(new THREE.TorusGeometry(0.021, 0.005, 4, 10), 0, 0.02, 0, Math.PI / 2), "MainHand");
  rig.add(w, M.gold, at(new THREE.TorusGeometry(0.021, 0.005, 4, 10), 0, 0.162, 0, Math.PI / 2), "MainHand");
  rig.add(w, M.gold, at(new THREE.CylinderGeometry(0.034, 0.034, 0.024, hi ? 14 : 9), 0, 0.19, 0, Math.PI / 2), "MainHand");
  return w;
}

function buildBuckler(rig: Rig, M: HeroMats, hi: boolean): THREE.Group {
  const g = joint("offhand", 0, -0.045, -0.035);
  const seg = hi ? 20 : 12;
  // Domed face toward −z (outward from the fist), gold rim, boss and rivets
  rig.add(
    g,
    M.leather,
    at(new THREE.SphereGeometry(0.22, seg, 4, 0, Math.PI * 2, 0, 0.62), 0, 0, 0.19, -Math.PI / 2, 0, 0),
    "OffHand"
  );
  rig.add(g, M.darkLeather, at(new THREE.CircleGeometry(0.128, seg), 0, 0, 0.012, 0, 0, 0), "OffHand");
  rig.add(g, M.gold, at(new THREE.TorusGeometry(0.128, 0.012, 6, seg), 0, 0, 0.01), "OffHand");
  rig.add(g, M.gold, at(new THREE.SphereGeometry(0.036, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 0, -0.03, -Math.PI / 2, 0, 0), "OffHand");
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    rig.add(g, M.gold, at(new THREE.SphereGeometry(0.009, 5, 4), Math.cos(a) * 0.1, Math.sin(a) * 0.1, -0.012), "OffHand");
  }
  return g;
}

function buildHead(rig: Rig, M: HeroMats, hi: boolean, palette: HeroPalette): THREE.Group {
  const head = joint("head", 0, NECK_Y, 0);
  head.scale.setScalar(HEAD_SCALE);
  const seg = hi ? 20 : 12;
  const C = new THREE.Vector3(0, 0.115, -0.004); // skull centre
  // skull, jaw, chin
  rig.add(head, M.skin, at(new THREE.SphereGeometry(0.103, seg, hi ? 16 : 10), C.x, C.y, C.z, 0, 0, 0, 0.88, 1.04, 0.98));
  rig.add(head, M.skin, at(new THREE.SphereGeometry(0.066, seg, 8), 0, 0.058, -0.03, 0, 0, 0, 1.02, 0.82, 1.0));
  rig.add(head, M.skin, at(new THREE.SphereGeometry(0.03, 10, 8), 0, 0.03, -0.074, 0, 0, 0, 1.1, 0.8, 0.9));
  // brow ridge, nose, cheekbones, ears
  rig.add(head, M.skin, at(rbox(0.13, 0.024, 0.03, 0.011, 1), 0, 0.14, -0.093, -0.12, 0, 0));
  rig.add(head, M.skin, at(new THREE.ConeGeometry(0.018, 0.058, 4), 0, 0.1, -0.106, 0.38, Math.PI / 4, 0, 1, 1, 0.85));
  for (const sx of [-1, 1]) {
    rig.add(head, M.skin, at(new THREE.SphereGeometry(0.026, 8, 6), 0.047 * sx, 0.093, -0.074, 0, 0, 0, 1.2, 0.8, 0.9));
    rig.add(head, M.skin, at(new THREE.SphereGeometry(0.02, 8, 6), 0.09 * sx, 0.11, 0.004, 0, 0, 0, 0.45, 1.1, 0.8));
    // eyes set under the brow, dark brows above
    rig.add(head, M.eye, at(new THREE.SphereGeometry(0.0115, 8, 6), 0.035 * sx, 0.124, -0.091, 0, 0, 0, 1.25, 0.8, 0.8));
    rig.add(head, M.hair, at(rbox(0.04, 0.009, 0.012, 0.004, 1), 0.037 * sx, 0.147, -0.104, 0, 0, sx * -0.14));
  }
  rig.add(head, M.eye, at(rbox(0.03, 0.005, 0.008, 0.002, 1), 0, 0.07, -0.098));
  // hair: short dark cap with a clean hairline (hidden under the hood when worn)
  rig.add(
    head,
    M.hair,
    at(new THREE.SphereGeometry(0.108, seg, hi ? 10 : 7, 0, Math.PI * 2, 0, Math.PI * 0.52), C.x, C.y + 0.004, C.z + 0.008, 0.32, 0, 0, 0.9, 1.04, 1.0)
  );
  // neck
  const neck = at(new THREE.CylinderGeometry(0.043, 0.05, 0.12, hi ? 12 : 8), 0, 0.0, 0.006);
  rig.add(head, M.skin, neck);

  // Head slot — the poet's hood: crimson cappuccio with ivory lining, a long tail
  // down the back, and a laurel circlet in gold.
  const hood = joint("hood");
  const gap = Math.PI * 0.52;
  const shell = new THREE.SphereGeometry(0.128, seg, hi ? 12 : 8, Math.PI * 1.5 + gap / 2, Math.PI * 2 - gap, 0, Math.PI * 0.66);
  const hoodShell = () => at(shell.clone(), C.x, C.y + 0.012, C.z + 0.014, 0, 0, 0, 0.96, 1.06, 1.08);
  if (palette === "pilgrim") {
    rig.add(hood, M.mantle, hoodShell(), "Head");
    rig.add(hood, M.lining, hoodShell(), "Head");
    rig.add(hood, M.tunic, at(new THREE.TorusGeometry(0.092, 0.0075, 5, hi ? 20 : 12, Math.PI * 1.25), 0, C.y + 0.004, -0.088, 0.1, 0, -Math.PI * 0.125, 0.98, 1.18, 1), "Head");
    // cowl collar that drapes onto the shoulders
    rig.add(hood, M.mantle, lathe([[0.25, -0.12], [0.2, -0.07], [0.14, -0.015], [0.115, 0.03]], seg), "Head");
    rig.add(hood, M.lining, lathe([[0.25, -0.12], [0.2, -0.07], [0.14, -0.015], [0.115, 0.03]], seg), "Head");
    rig.add(hood, M.gold, at(new THREE.TorusGeometry(0.25, 0.008, 5, hi ? 28 : 18), 0, -0.12, 0, Math.PI / 2), "Head");
    // liripipe tail
    rig.add(
      hood,
      M.mantle,
      taperTube(
        [
          new THREE.Vector3(0, 0.2, 0.07),
          new THREE.Vector3(0, 0.17, 0.14),
          new THREE.Vector3(0, 0.05, 0.19),
          new THREE.Vector3(0, -0.14, 0.2),
          new THREE.Vector3(0.01, -0.33, 0.18),
        ],
        0.034,
        0.009,
        hi ? 16 : 10,
        hi ? 8 : 6
      ),
      "Head"
    );
    rig.add(hood, M.gold, at(new THREE.SphereGeometry(0.014, 6, 5), 0.01, -0.34, 0.18), "Head");
    shell.dispose();
  } else {
    shell.dispose();
  }
  // laurel circlet (Head slot for the pilgrim; always for the Guide)
  const laurelSlot: Slot = palette === "pilgrim" ? "Head" : null;
  const ly = C.y + (palette === "pilgrim" ? 0.052 : 0.034);
  const lr = palette === "pilgrim" ? 0.122 : 0.1;
  rig.add(hood, M.gold, at(new THREE.TorusGeometry(lr, 0.007, 5, hi ? 26 : 16), 0, ly, C.z + 0.004, Math.PI / 2 - 0.16, 0, 0, 0.92, 1.02, 1), laurelSlot);
  const leaves = hi ? 9 : 6;
  for (let i = 0; i < leaves; i++) {
    for (const sx of [-1, 1]) {
      const a = -Math.PI / 2 + sx * (0.25 + (i / leaves) * 1.9);
      const x = Math.cos(a) * lr * 0.93;
      const z = Math.sin(a) * lr + C.z + 0.004;
      const yy = ly + (z - C.z) * -0.16;
      rig.add(
        hood,
        M.gold,
        at(new THREE.SphereGeometry(0.016, 6, 4), x, yy + 0.008, z, 0.3, -a, sx * 0.5, 0.5, 1.15, 0.2),
        laurelSlot
      );
    }
  }
  head.add(hood);

  const nose = new THREE.Object3D();
  nose.name = "nose";
  nose.position.set(0, 0.11, -0.13);
  head.add(nose);
  return head;
}

function buildCape(rig: Rig, M: HeroMats, hi: boolean): THREE.Group {
  // Pivot at the upper back, just under the shoulder line
  const cloak = joint("cloak", 0, SHOULDER_Y + 0.03, 0.1);
  const L = 1.08;
  const cols = hi ? 16 : 10;
  const rows = hi ? 12 : 7;
  const hw = (v: number) => 0.21 + 0.17 * Math.pow(v, 0.85);
  const depth = (v: number) => 0.075 + 0.15 * v;
  const surf = (u: number, v: number, pad = 0) => {
    const phi = (u - 0.5) * Math.PI;
    const fold = 1 + 0.07 * v * Math.sin(phi * 7 + 0.6);
    const x = hw(v) * Math.sin(phi) * (1 + 0.04 * v);
    const z = (depth(v) * Math.cos(phi) - 0.02) * fold + pad;
    const y = -v * L + 0.018 * Math.cos(phi) * (1 - v); // slight hump over the shoulder blades
    return new THREE.Vector3(x, y, z);
  };
  // outward normals (+z) → mantle on the outside, lining inside (BackSide)
  const outer = sheet(cols, rows, (u, v) => surf(u, v));
  rig.add(cloak, M.mantle, outer.clone(), "Chest");
  rig.add(cloak, M.lining, outer, "Chest");
  // gilded border: down one edge, along the hem, up the other
  const edge: THREE.Vector3[] = [];
  const n = hi ? 10 : 6;
  for (let i = 0; i <= n; i++) edge.push(surf(0, i / n, 0.004));
  for (let i = 1; i < n; i++) edge.push(surf(i / n, 1, 0.004));
  for (let i = n; i >= 0; i--) edge.push(surf(1, i / n, 0.004));
  rig.add(cloak, M.gold, trim(edge, 0.01, hi ? 90 : 48, hi ? 5 : 4), "Chest");
  return cloak;
}

/** Robe panel hanging from the waist (front "apron" or back "tabard"). */
function buildPanel(rig: Rig, M: HeroMats, name: string, facing: -1 | 1, hi: boolean): THREE.Group {
  const pivotZ = facing * 0.02;
  const p = joint(name, 0, 1.03, pivotZ);
  const L = 0.56;
  const span = facing < 0 ? 1.25 : 1.45;
  const R = (v: number) => 0.155 + 0.06 * v;
  const surf = (u: number, v: number, pad = 0) => {
    const phi = (u - 0.5) * span;
    const fold = 1 + 0.035 * v * Math.sin(phi * 9);
    return new THREE.Vector3(R(v) * Math.sin(phi) * fold, -v * L, facing * (R(v) * Math.cos(phi) * fold - 0.02 + pad));
  };
  const cols = hi ? 10 : 6;
  const rows = hi ? 6 : 4;
  // back panel faces +z, front panel −z → flip winding for the front so FrontSide is outside
  const g = sheet(cols, rows, (u, v) => surf(u, v), facing < 0);
  rig.add(p, M.robe, g.clone(), "Chest");
  const inner = M.tunic.clone();
  inner.side = THREE.BackSide;
  rig.add(p, inner, g, "Chest");
  const hem: THREE.Vector3[] = [];
  const band: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    hem.push(surf(i / 8, 1, 0.004));
    band.push(surf(i / 8, 0.86, 0.004));
  }
  rig.add(p, M.gold, trim(hem, 0.009, hi ? 24 : 14, 4), "Chest");
  rig.add(p, M.gold, trim(band, 0.005, hi ? 24 : 14, 4), "Chest");
  if (facing < 0) {
    const mid: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) mid.push(surf(0.5, i / 6, 0.004));
    rig.add(p, M.gold, trim(mid, 0.006, 12, 4), "Chest");
  }
  return p;
}

// ——— assembly —————————————————————————————————————————————————————————

/** Build the hero rig. `palette` "guide" restyles it for the Dark Wood guide. */
export function makeHero(mats: MatKit, palette: HeroPalette = "pilgrim"): THREE.Group {
  const hi = !isCompactUi();
  const seg = hi ? 16 : 10;
  const M = heroMats(mats, palette);
  const rig = new Rig();
  // The Guide is a scholar-shade: no pauldrons, shin plates or knee cops
  const armored = palette === "pilgrim";

  const root = new THREE.Group();
  root.name = "wanderer";

  const hips = joint("hips");
  // trousers pelvis + tunic skirt + plain belt (always)
  rig.add(hips, M.trousers, at(new THREE.SphereGeometry(0.13, seg, hi ? 10 : 7), 0, 0.95, 0, 0, 0, 0, 1.2, 0.72, 0.86));
  rig.add(hips, M.trousers, at(lathe([[0.138, 0.9], [0.145, 0.98], [0.139, 1.06], [0.132, 1.1]], seg), 0, 0, 0, 0, 0, 0, TORSO_SX * 0.98, 1, TORSO_SZ * 1.12));
  rig.add(hips, M.tunic, at(lathe([[0.2, 0.8], [0.18, 0.88], [0.163, 0.97], [0.152, 1.06]], seg), 0, 0, 0, 0, 0, 0, 1.12, 1, 0.9));
  const innerSkirt = M.tunic.clone();
  innerSkirt.side = THREE.BackSide;
  rig.add(hips, innerSkirt, at(lathe([[0.2, 0.8], [0.18, 0.88], [0.163, 0.97], [0.152, 1.06]], seg), 0, 0, 0, 0, 0, 0, 1.12, 1, 0.9));
  rig.add(hips, M.leather, at(new THREE.TorusGeometry(0.152, 0.016, 5, seg * 2), 0, 1.035, 0, Math.PI / 2, 0, 0, TORSO_SX * 0.98, TORSO_SZ * 1.18, 1));
  // Chest slot: wide sword belt, gilt buckle, pouch and a scroll case
  rig.add(hips, M.leather, at(lathe([[0.158, 1.005], [0.162, 1.035], [0.158, 1.065]], seg * 2), 0, 0, 0, 0, 0, 0, TORSO_SX, 1, TORSO_SZ * 1.2), "Chest");
  rig.add(hips, M.gold, at(rbox(0.056, 0.05, 0.02, 0.008, 1), 0, 1.035, -0.142), "Chest");
  rig.add(hips, M.leather, at(rbox(0.07, 0.085, 0.05, 0.018, 2), 0.15, 0.975, -0.05, 0, 0.5, 0), "Chest");
  rig.add(hips, M.gold, at(rbox(0.03, 0.012, 0.012, 0.004, 1), 0.162, 1.005, -0.078, 0, 0.5, 0), "Chest");
  rig.add(hips, M.darkLeather, at(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), -0.16, 0.98, 0.07, 0.3, 0, 0.2), "Chest");
  rig.add(hips, M.gold, at(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8), -0.14, 1.075, 0.1, 0.3, 0, 0.2), "Chest");
  hips.add(buildLeg(rig, M, -1, hi, armored), buildLeg(rig, M, 1, hi, armored));
  hips.add(buildPanel(rig, M, "apron", -1, hi), buildPanel(rig, M, "tabard", 1, hi));

  const torso = joint("torso", 0, WAIST_Y, 0);
  // tunic torso (always), collar opening
  rig.add(torso, M.tunic, at(lathe(TORSO_PROFILE, seg * 2), 0, 0, 0, 0, 0, 0, TORSO_SX, 1, TORSO_SZ));
  // Chest slot: ivory robe over the tunic, stand collar, gilt placket and baldric
  const robeProfile = TORSO_PROFILE.map(([r, y]) => [r + 0.012, y] as [number, number]);
  rig.add(torso, M.robe, at(lathe(robeProfile, seg * 2), 0, 0, 0, 0, 0, 0, TORSO_SX, 1, TORSO_SZ), "Chest");
  rig.add(torso, M.robe, at(new THREE.TorusGeometry(0.066, 0.016, 6, seg), 0, 0.455, 0.004, Math.PI / 2 - 0.2), "Chest");
  rig.add(torso, M.gold, at(new THREE.TorusGeometry(0.068, 0.006, 4, seg), 0, 0.47, 0.004, Math.PI / 2 - 0.2), "Chest");
  const placket: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) placket.push(torsoSurf(0, -0.06 + (i / 6) * 0.48, -1, 0.016));
  rig.add(torso, M.gold, trim(placket, 0.008, 16, 4), "Chest");
  const baldric: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    baldric.push(torsoSurf(-0.16 + 0.34 * t, 0.4 - 0.43 * t, -1, 0.02));
  }
  rig.add(torso, M.leather, trim(baldric, 0.014, 20, 4), "Chest");
  const baldricBack: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    baldricBack.push(torsoSurf(-0.16 + 0.34 * t, 0.4 - 0.43 * t, 1, 0.02));
  }
  rig.add(torso, M.leather, trim(baldricBack, 0.014, 20, 4), "Chest");
  // mantle brooches at the collarbones
  for (const sx of [-1, 1]) {
    rig.add(torso, M.gold, at(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 10), 0.12 * sx, 0.43, -0.06, Math.PI / 2 - 0.5, 0, 0), "Chest");
  }

  torso.add(buildArm(rig, M, -1, hi, armored), buildArm(rig, M, 1, hi, armored));
  const head = buildHead(rig, M, hi, palette);
  torso.add(head);
  torso.add(buildCape(rig, M, hi));
  hips.add(torso);

  // weapon + buckler in the fists, slash anchor for the attack trail
  const handR = torso.getObjectByName("handR")!;
  const sword = buildSword(rig, M, hi);
  sword.position.set(0, -0.096, -0.036);
  sword.rotation.set(0.55, 0, 0.12);
  tagGearSlot(sword, "MainHand");
  handR.add(sword);
  // Swoosh origin (see fx.makeSlashTrail): chest-high, just right of centre, so
  // the cut plane turns with the torso through the swing
  const slashAnchor = joint("slashAnchor", 0.1, 0.34, -0.04);
  torso.add(slashAnchor);
  const buckler = buildBuckler(rig, M, hi);
  tagGearSlot(buckler, "OffHand");
  buckler.visible = false;
  torso.getObjectByName("handL")!.add(buckler);

  rig.flush();

  // selection ring + soft contact shadow
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.38, 0.44, hi ? 36 : 24),
    new THREE.MeshBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.renderOrder = 2;
  const contact = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), mats.shadowCatch);
  contact.name = "discShadow";
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.02;
  root.add(contact, ring, hips);
  return root;
}
