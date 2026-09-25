/**
 * The Wanderer — the player's hero (also remote players, and the Guide via a palette).
 *
 * A pilgrim in the Doré manner: warm-ivory robe to mid-shin, crimson mantle and
 * hood with a long tail (the poet's cappuccio), laurel circlet, brown leather,
 * steel longsword. Designed silhouette-first for phone scale (~45 px tall): a
 * flared robe bell (no stick legs), a dark crimson cape mass behind, the blade
 * carried low and back, gold edges that catch the rim light.
 *
 * Rig contract (heroAnim.ts / gearLook.ts / WorldApp rely on these names):
 *   wanderer → hips → { legL/R → kneeL/R → ankleL/R (toeL/R),
 *                        apron → apronHem, tabard → tabardHem,
 *                        torso → { armL/R → elbowL/R → handL/R (weapon, offhand),
 *                                  head → { hood, nose }, cloak → cloakMid → cloakHem,
 *                                  slashAnchor } }
 * Local forward is −z, feet on y = 0, ~1.84 tall before the 1.42 world scale.
 *
 * Draw calls: every part is baked into root space with a vertex colour (palette ×
 * height AO; alpha = metalness) and rigidly skinned to its joint, then merged into
 * one SkinnedMesh per (family, gear slot): ~8–10 draws per hero instead of 71.
 * Cloth (cape chain, robe skirt) is smoothly skinned across several joints so it
 * bends instead of swinging as a plank. Materials are two module-wide shared
 * instances (solid / double-sided sheet); geometry is built once per
 * (palette, detail) and every hero is a cheap SkeletonUtils clone.
 * Gear pieces carry userData.gearSlot (shown only when that slot is equipped).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
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

function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ——— paints / shared materials ————————————————————————————————————————

/** A part's baked colour: linear RGB and a metalness weight (0 cloth → 1 metal). */
type Paint = { c: THREE.Color; m: number; sheet?: boolean };
function paint(hex: number, m = 0, sheetFam = false): Paint {
  return { c: new THREE.Color(hex), m, sheet: sheetFam };
}

type HeroPaints = {
  robe: Paint;
  robeSheet: Paint;
  tunic: Paint;
  tunicSheet: Paint;
  trousers: Paint;
  mantle: Paint;
  leather: Paint;
  darkLeather: Paint;
  gold: Paint;
  plate: Paint;
  steel: Paint;
  skin: Paint;
  hair: Paint;
  eye: Paint;
};

const PALETTES: Record<HeroPalette, { robe: number; tunic: number; mantle: number; leather: number; trousers: number }> = {
  // Warm ivory pilgrim, crimson mantle — the living soul among dark shades.
  // Robe sits a stop under white so desktop bloom + hero light never blow it out.
  pilgrim: { robe: 0xbcaa86, tunic: 0x8e785a, mantle: 0x7e1d15, leather: 0x6e4a30, trousers: 0x4a3a2a },
  // Guide: slate scholar's robe, umber mantle (no crimson — never mistaken for a player)
  guide: { robe: 0x6c6e7a, tunic: 0x4e4e58, mantle: 0x46372a, leather: 0x54402e, trousers: 0x35302c },
};

function heroPaints(palette: HeroPalette): HeroPaints {
  const P = PALETTES[palette];
  return {
    robe: paint(P.robe),
    robeSheet: paint(P.robe, 0, true),
    tunic: paint(P.tunic),
    tunicSheet: paint(P.tunic, 0, true),
    trousers: paint(P.trousers),
    mantle: paint(P.mantle, 0, true),
    leather: paint(P.leather),
    darkLeather: paint(0x30231a),
    gold: paint(0xe2b85c, 1),
    plate: paint(0x9c7c52, 0.78),
    steel: paint(0xdedcd6, 0.92),
    skin: paint(0xc89478),
    hair: paint(0x2a1d14),
    eye: paint(0x1a120c),
  };
}

let _linenTex: THREE.CanvasTexture | null = null;

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** Fine linen weave with faint etched hatching — one neutral map for every fabric. */
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
  g.strokeStyle = "rgba(90,75,60,0.1)";
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

/**
 * Per-vertex PBR from the colour attribute: alpha is a metal weight, so cloth,
 * leather, skin, gold and steel share one program. Sheets are double-sided and
 * shade their inside darker (lining / robe interior) without a second mesh.
 */
function heroShader(sheetFam: boolean) {
  return (shader: { fragmentShader: string }) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  diffuseColor *= mix( sampledDiffuseColor, vec4( 1.0 ), vColor.a );
#endif`
      )
      .replace(
        "#include <color_fragment>",
        `diffuseColor.rgb *= vColor.rgb;
float heroMetal = vColor.a;
${sheetFam ? "if ( ! gl_FrontFacing ) diffuseColor.rgb *= 0.44;" : ""}`
      )
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = mix( 0.86, 0.32, heroMetal );")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = mix( 0.02, 0.8, heroMetal );")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * heroMetal * 0.2;"
      );
  };
}

let _mats: { solid: THREE.MeshStandardMaterial; sheet: THREE.MeshStandardMaterial } | null = null;

/** The two hero materials, shared by every hero, remote player and the Guide. */
function heroMaterials() {
  if (_mats) return _mats;
  const make = (sheetFam: boolean) => {
    const m = new THREE.MeshStandardMaterial({
      map: linenTexture(),
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.02,
      envMapIntensity: 1.1,
      side: sheetFam ? THREE.DoubleSide : THREE.FrontSide,
    });
    m.name = sheetFam ? "heroSheet" : "heroSolid";
    m.onBeforeCompile = heroShader(sheetFam);
    m.customProgramCacheKey = () => (sheetFam ? "hero-sheet" : "hero-solid");
    m.userData.shared = true;
    return m;
  };
  _mats = { solid: make(false), sheet: make(true) };
  return _mats;
}

// ——— rig builder ——————————————————————————————————————————————————————

type Weights = (local: THREE.Vector3) => [THREE.Bone, number][];

/**
 * Collects parts per (family, slot), baking each into root space with its
 * joint's rest transform, a colour (paint × height AO) and skin weights.
 */
class Rig {
  bones: THREE.Bone[] = [];
  private boneIndex = new Map<THREE.Bone, number>();
  private bins = new Map<string, { sheet: boolean; slot: Slot; geos: THREE.BufferGeometry[] }>();

  bone(name: string, parent: THREE.Object3D | null, x = 0, y = 0, z = 0): THREE.Bone {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    this.boneIndex.set(b, this.bones.length);
    this.bones.push(b);
    if (parent) parent.add(b);
    return b;
  }

  add(parent: THREE.Bone, pt: Paint, geo: THREE.BufferGeometry, slot: Slot = null, weights?: Weights) {
    let g = geo;
    if (!g.index) {
      const n = g.attributes.position!.count;
      const idx: number[] = new Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(idx);
    }
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
    const pos = g.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const own = this.boneIndex.get(parent) ?? 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (weights) {
        v.fromBufferAttribute(pos, i);
        const ws = weights(v);
        let k = 0;
        for (const [b, w] of ws) {
          if (w <= 1e-4 || k > 3) continue;
          si[i * 4 + k] = this.boneIndex.get(b) ?? own;
          sw[i * 4 + k] = w;
          k++;
        }
        if (k === 0) {
          si[i * 4] = own;
          sw[i * 4] = 1;
        }
      } else {
        si[i * 4] = own;
        sw[i * 4] = 1;
      }
    }
    parent.updateWorldMatrix(true, false);
    g.applyMatrix4(parent.matrixWorld);
    const col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      // Height AO: feet and hem sit in shadow, shoulders catch the light
      const y = pos.getY(i);
      const ao = 0.6 + 0.4 * smoothstep(0.05, 1.45, y);
      col[i * 4] = pt.c.r * ao;
      col[i * 4 + 1] = pt.c.g * ao;
      col[i * 4 + 2] = pt.c.b * ao;
      col[i * 4 + 3] = pt.m;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 4));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
    const key = `${pt.sheet ? "sheet" : "solid"}|${slot ?? ""}`;
    let b = this.bins.get(key);
    if (!b) {
      b = { sheet: Boolean(pt.sheet), slot, geos: [] };
      this.bins.set(key, b);
    }
    b.geos.push(g);
  }

  flush(root: THREE.Object3D) {
    const mats = heroMaterials();
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    const ident = new THREE.Matrix4();
    for (const b of this.bins.values()) {
      const merged = b.geos.length === 1 ? b.geos[0]! : mergeGeometries(b.geos, false);
      if (!merged) continue;
      if (b.geos.length > 1) for (const g of b.geos) g.dispose();
      merged.userData.shared = true;
      merged.computeBoundingSphere();
      const mesh = new THREE.SkinnedMesh(merged, b.sheet ? mats.sheet : mats.solid);
      mesh.name = `hero:${b.sheet ? "sheet" : "solid"}:${b.slot ?? "body"}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Poses stay inside a padded rest sphere: never recomputed per frame
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.75);
      if (b.slot) tagGearSlot(mesh, b.slot);
      root.add(mesh);
      mesh.bind(skeleton, ident);
    }
    this.bins.clear();
  }
}

// ——— proportions ——————————————————————————————————————————————————————

const HIP_Y = 0.93; // leg pivot (abs)
const THIGH = 0.43;
const SHIN = 0.5; // knee → sole
const ANKLE_Y = 0.075; // ankle pivot above the sole
const WAIST_Y = 1.06; // torso pivot (abs), child of hips
const SHOULDER_X = 0.215;
const SHOULDER_Y = 0.395; // torso-local
const NECK_Y = 0.505; // torso-local head pivot
const HEAD_SCALE = 1.1;
const SKIRT_TOP = 1.035;
const SKIRT_L = 0.68; // robe hem ≈ mid-shin (y ≈ 0.36)
const PANEL_DROP = 0.34; // apron/tabard hem joint below the belt
const CAPE_L = 1.1;

/** Tunic torso radius at torso-local y (before the TORSO_SX × TORSO_SZ ellipse). */
const TORSO_PROFILE: [number, number][] = [
  [0.138, -0.07],
  [0.142, 0.04],
  [0.156, 0.14],
  [0.172, 0.25],
  [0.176, 0.32],
  [0.163, 0.39],
  [0.126, 0.44],
  [0.07, 0.48],
];
const TORSO_SX = 1.24;
const TORSO_SZ = 0.76;

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

function buildLeg(rig: Rig, hips: THREE.Bone, M: HeroPaints, side: -1 | 1, hi: boolean, armored: boolean) {
  const seg = hi ? 14 : 9;
  const L = side < 0 ? "L" : "R";
  const leg = rig.bone(`leg${L}`, hips, 0.1 * side, HIP_Y, 0);
  // thigh + hip joint cover (a little fuller than before: no stick legs)
  rig.add(leg, M.trousers, at(new THREE.SphereGeometry(0.086, seg, hi ? 10 : 7), 0, -0.01, 0, 0, 0, 0, 1, 0.9, 1.02));
  rig.add(
    leg,
    M.trousers,
    at(lathe([[0.058, -THIGH], [0.067, -0.36], [0.079, -0.22], [0.087, -0.09], [0.088, 0]], seg), 0, 0, 0, 0, 0, 0, 1, 1, 1.05)
  );

  const knee = rig.bone(`knee${L}`, leg, 0, -THIGH, 0);
  rig.add(knee, M.trousers, at(new THREE.SphereGeometry(0.058, seg, hi ? 8 : 6), 0, 0, -0.004, 0, 0, 0, 1, 0.95, 1.05));
  // shin with a real calf
  rig.add(
    knee,
    M.trousers,
    at(lathe([[0.042, -0.43], [0.048, -0.37], [0.063, -0.25], [0.068, -0.16], [0.058, -0.02]], seg), 0, 0, 0.008, 0, 0, 0, 1, 1, 1.08)
  );
  // low travelling boot (always): cuff round the ankle, foot on the ankle joint
  rig.add(knee, M.darkLeather, lathe([[0.056, -0.445], [0.058, -0.38], [0.054, -0.33]], seg));
  const ankle = rig.bone(`ankle${L}`, knee, 0, -SHIN + ANKLE_Y, 0);
  rig.add(ankle, M.darkLeather, at(rbox(0.088, 0.07, 0.22, 0.03, hi ? 3 : 2), 0, -ANKLE_Y + 0.035, -0.05));
  rig.add(ankle, M.darkLeather, at(new THREE.SphereGeometry(0.052, seg, 6), 0, -0.015, 0.0, 0, 0, 0, 1, 0.9, 1.1));

  // Feet slot: tall riding boots with a folded cuff, gilded shin plate and knee cop
  rig.add(
    knee,
    M.leather,
    at(lathe([[0.058, -0.45], [0.062, -0.37], [0.072, -0.22], [0.074, -0.14], [0.076, -0.11]], seg), 0, 0, 0.006),
    "Feet"
  );
  rig.add(knee, M.leather, at(new THREE.TorusGeometry(0.076, 0.017, 6, seg), 0, -0.115, 0.006, Math.PI / 2), "Feet");
  rig.add(ankle, M.leather, at(rbox(0.098, 0.084, 0.234, 0.032, hi ? 3 : 2), 0, -ANKLE_Y + 0.043, -0.052), "Feet");
  rig.add(ankle, M.darkLeather, at(rbox(0.1, 0.02, 0.24, 0.008, 1), 0, -ANKLE_Y + 0.01, -0.054), "Feet");
  if (armored) {
    rig.add(
      knee,
      M.plate,
      at(new THREE.CylinderGeometry(0.078, 0.066, 0.25, seg, 1, true, Math.PI * 0.62, Math.PI * 0.76), 0, -0.27, 0),
      "Feet"
    );
    rig.add(
      knee,
      M.gold,
      at(new THREE.SphereGeometry(0.05, seg, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 0.005, -0.034, -Math.PI / 2, 0, 0, 1, 0.6, 1),
      "Feet"
    );
    rig.add(ankle, M.gold, at(rbox(0.06, 0.03, 0.05, 0.012, 1), 0, -ANKLE_Y + 0.05, -0.15), "Feet");
  }

  const toe = new THREE.Object3D();
  toe.name = `toe${L}`;
  toe.position.set(0, -ANKLE_Y + 0.03, -0.14);
  ankle.add(toe);
}

function buildHand(rig: Rig, elbow: THREE.Bone, M: HeroPaints, side: -1 | 1, hi: boolean): THREE.Bone {
  const hand = rig.bone(side < 0 ? "handL" : "handR", elbow, 0, -0.27, 0);
  // bare fist (always; the glove covers it)
  rig.add(hand, M.skin, at(rbox(0.056, 0.084, 0.07, 0.024, hi ? 3 : 2), 0, -0.045, -0.004));
  rig.add(hand, M.skin, at(new THREE.CapsuleGeometry(0.015, 0.03, 3, hi ? 8 : 6), -side * 0.026, -0.035, -0.03, 0.6, 0, -side * 0.35));
  // Hands slot: leather gauntlet with flared cuff and gold knuckle bar
  rig.add(hand, M.leather, at(rbox(0.064, 0.092, 0.078, 0.026, hi ? 3 : 2), 0, -0.046, -0.004), "Hands");
  rig.add(hand, M.leather, lathe([[0.036, -0.005], [0.048, 0.04], [0.06, 0.085]], hi ? 12 : 8), "Hands");
  rig.add(hand, M.gold, at(new THREE.TorusGeometry(0.06, 0.007, 5, hi ? 16 : 10), 0, 0.085, 0, Math.PI / 2), "Hands");
  rig.add(hand, M.gold, at(rbox(0.066, 0.014, 0.02, 0.006, 1), 0, -0.06, -0.042), "Hands");
  return hand;
}

function buildArm(rig: Rig, torso: THREE.Bone, M: HeroPaints, side: -1 | 1, hi: boolean, armored: boolean): THREE.Bone {
  const seg = hi ? 14 : 9;
  const arm = rig.bone(side < 0 ? "armL" : "armR", torso, SHOULDER_X * side, SHOULDER_Y, 0);
  // tunic sleeve (always)
  rig.add(arm, M.tunic, at(new THREE.SphereGeometry(0.066, seg, hi ? 10 : 7), 0, -0.01, 0, 0, 0, 0, 1, 0.92, 1.05));
  rig.add(arm, M.tunic, lathe([[0.047, -0.29], [0.053, -0.2], [0.059, -0.11], [0.06, -0.04], [0.053, 0.01]], seg));
  // Chest slot: robe sleeve over it + layered pauldron (the Guide goes unarmoured)
  rig.add(arm, M.robe, lathe([[0.054, -0.28], [0.06, -0.19], [0.066, -0.1], [0.067, -0.04], [0.06, 0.015]], seg), "Chest");
  const tilt = side * -0.5;
  if (armored) {
    // flatter, layered pauldron (reads as a shoulder, not a ball)
    rig.add(
      arm,
      M.plate,
      at(new THREE.SphereGeometry(0.088, seg, hi ? 8 : 6, 0, Math.PI * 2, 0, Math.PI * 0.5), side * 0.012, 0.012, 0, 0, 0, tilt, 1.12, 0.62, 1.15),
      "Chest"
    );
    rig.add(
      arm,
      M.plate,
      at(new THREE.SphereGeometry(0.08, seg, hi ? 7 : 5, 0, Math.PI * 2, 0, Math.PI * 0.42), side * 0.03, -0.035, 0, 0, 0, tilt * 1.3, 1.05, 0.58, 1.1),
      "Chest"
    );
    rig.add(
      arm,
      M.gold,
      at(new THREE.TorusGeometry(0.096, 0.008, 5, hi ? 22 : 14), side * 0.012, 0.012, 0, Math.PI / 2, 0, tilt, 1.02, 1.04, 1),
      "Chest"
    );
  }

  const elbow = rig.bone(side < 0 ? "elbowL" : "elbowR", arm, 0, -0.29, 0);
  rig.add(elbow, M.tunic, at(new THREE.SphereGeometry(0.049, seg, 6), 0, 0, 0));
  rig.add(elbow, M.tunic, lathe([[0.038, -0.26], [0.043, -0.2], [0.05, -0.1], [0.049, 0.01]], seg));
  rig.add(elbow, M.robe, lathe([[0.045, -0.25], [0.049, -0.19], [0.056, -0.09], [0.056, 0.02]], seg), "Chest");
  rig.add(elbow, M.gold, at(new THREE.TorusGeometry(0.047, 0.007, 5, hi ? 16 : 10), 0, -0.235, 0, Math.PI / 2), "Chest");
  buildHand(rig, elbow, M, side, hi);
  return arm;
}

function buildSword(rig: Rig, hand: THREE.Bone, M: HeroPaints, hi: boolean) {
  const w = rig.bone("weapon", hand, 0, -0.096, -0.036);
  // Blade: tapered, beveled edges, point along −y from the guard at y = 0
  const s = new THREE.Shape();
  s.moveTo(-0.022, 0);
  s.lineTo(-0.02, -0.62);
  s.quadraticCurveTo(-0.018, -0.76, 0, -0.86);
  s.quadraticCurveTo(0.018, -0.76, 0.02, -0.62);
  s.lineTo(0.022, 0);
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
  }
  // Grip wrapped in dark leather with gold ferrules, disc pommel
  rig.add(w, M.darkLeather, at(new THREE.CylinderGeometry(0.019, 0.021, 0.15, hi ? 10 : 7), 0, 0.09, 0), "MainHand");
  rig.add(w, M.gold, at(new THREE.TorusGeometry(0.021, 0.005, 4, 10), 0, 0.02, 0, Math.PI / 2), "MainHand");
  rig.add(w, M.gold, at(new THREE.CylinderGeometry(0.034, 0.034, 0.024, hi ? 14 : 9), 0, 0.19, 0, Math.PI / 2), "MainHand");
}

function buildBuckler(rig: Rig, hand: THREE.Bone, M: HeroPaints, hi: boolean) {
  const g = rig.bone("offhand", hand, 0, -0.045, -0.035);
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
}

function buildHead(rig: Rig, torso: THREE.Bone, M: HeroPaints, hi: boolean, palette: HeroPalette) {
  const head = rig.bone("head", torso, 0, NECK_Y, 0);
  head.scale.setScalar(HEAD_SCALE);
  const seg = hi ? 20 : 12;
  const C = new THREE.Vector3(0, 0.115, -0.004); // skull centre
  // skull, jaw, small chin — a calm face, no caricature
  rig.add(head, M.skin, at(new THREE.SphereGeometry(0.103, seg, hi ? 16 : 10), C.x, C.y, C.z, 0, 0, 0, 0.88, 1.04, 0.98));
  rig.add(head, M.skin, at(new THREE.SphereGeometry(0.064, seg, 8), 0, 0.062, -0.026, 0, 0, 0, 1.0, 0.8, 0.96));
  rig.add(head, M.skin, at(new THREE.SphereGeometry(0.022, 10, 8), 0, 0.036, -0.07, 0, 0, 0, 1.1, 0.75, 0.8));
  // brow ridge, a small straight nose, ears
  rig.add(head, M.skin, at(rbox(0.12, 0.02, 0.026, 0.009, 1), 0, 0.142, -0.09, -0.12, 0, 0));
  rig.add(head, M.skin, at(new THREE.ConeGeometry(0.013, 0.04, 4), 0, 0.106, -0.1, 0.3, Math.PI / 4, 0, 1, 1, 0.8));
  for (const sx of [-1, 1]) {
    rig.add(head, M.skin, at(new THREE.SphereGeometry(0.02, 8, 6), 0.09 * sx, 0.11, 0.004, 0, 0, 0, 0.45, 1.1, 0.8));
    // eyes set under the brow, dark brows above
    rig.add(head, M.eye, at(new THREE.SphereGeometry(0.011, 8, 6), 0.035 * sx, 0.124, -0.09, 0, 0, 0, 1.25, 0.8, 0.8));
    rig.add(head, M.hair, at(rbox(0.038, 0.009, 0.012, 0.004, 1), 0.037 * sx, 0.147, -0.1, 0, 0, sx * -0.12));
  }
  rig.add(head, M.eye, at(rbox(0.026, 0.004, 0.008, 0.002, 1), 0, 0.072, -0.092));
  // hair: swept back with a nape, not a bowl cap (hidden under the hood when worn)
  rig.add(
    head,
    M.hair,
    at(new THREE.SphereGeometry(0.11, seg, hi ? 10 : 7, 0, Math.PI * 2, 0, Math.PI * 0.5), C.x, C.y + 0.004, C.z + 0.014, 0.62, 0, 0, 0.93, 1.03, 1.05)
  );
  rig.add(head, M.hair, at(new THREE.SphereGeometry(0.072, seg, 7), 0, 0.085, 0.052, 0, 0, 0, 1.25, 0.95, 0.8));
  for (const sx of [-1, 1]) {
    rig.add(head, M.hair, at(new THREE.SphereGeometry(0.04, 8, 6), 0.078 * sx, 0.14, 0.02, 0, 0, 0, 0.6, 1.1, 1.2));
  }
  // neck
  rig.add(head, M.skin, at(new THREE.CylinderGeometry(0.05, 0.057, 0.11, hi ? 12 : 8), 0, 0.005, 0.006));

  // Head slot — the poet's hood: crimson cappuccio (lining is its dark inside),
  // a long tail down the back, and a laurel circlet in gold.
  const hood = rig.bone("hood", head);
  if (palette === "pilgrim") {
    const gap = Math.PI * 0.52;
    const shell = new THREE.SphereGeometry(0.128, seg, hi ? 12 : 8, Math.PI * 1.5 + gap / 2, Math.PI * 2 - gap, 0, Math.PI * 0.66);
    rig.add(hood, M.mantle, at(shell, C.x, C.y + 0.012, C.z + 0.014, 0, 0, 0, 0.96, 1.06, 1.08), "Head");
    rig.add(hood, M.tunic, at(new THREE.TorusGeometry(0.092, 0.0075, 5, hi ? 20 : 12, Math.PI * 1.25), 0, C.y + 0.004, -0.088, 0.1, 0, -Math.PI * 0.125, 0.98, 1.18, 1), "Head");
    // cowl collar that drapes onto the shoulders
    // (elliptical so it lies on chest and back instead of standing off like a brim)
    rig.add(hood, M.mantle, at(lathe([[0.24, -0.2], [0.21, -0.12], [0.16, -0.04], [0.115, 0.03]], seg), 0, 0, 0.01, 0, 0, 0, 1.08, 1, 0.8), "Head");
    rig.add(hood, M.gold, at(new THREE.TorusGeometry(0.24, 0.008, 5, hi ? 28 : 18), 0, -0.2, 0.01, Math.PI / 2, 0, 0, 1.08, 0.8, 1), "Head");
    // liripipe tail
    rig.add(
      hood,
      { ...M.mantle, sheet: false },
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
      rig.add(hood, M.gold, at(new THREE.SphereGeometry(0.016, 6, 4), x, yy + 0.008, z, 0.3, -a, sx * 0.5, 0.5, 1.15, 0.2), laurelSlot);
    }
  }

  const nose = new THREE.Object3D();
  nose.name = "nose";
  nose.position.set(0, 0.11, -0.13);
  head.add(nose);
}

/** Cape on a three-joint chain; vertices blend smoothly down the chain so it bends. */
function buildCape(rig: Rig, torso: THREE.Bone, M: HeroPaints, hi: boolean) {
  // Pivot at the upper back, just under the shoulder line
  const cloak = rig.bone("cloak", torso, 0, SHOULDER_Y + 0.03, 0.1);
  const seg = CAPE_L / 3;
  const mid = rig.bone("cloakMid", cloak, 0, -seg, 0);
  const hem = rig.bone("cloakHem", mid, 0, -seg, 0);
  const weights: Weights = (p) => {
    const v = -p.y / CAPE_L;
    const wm = smoothstep(1 / 3 - 0.14, 1 / 3 + 0.14, v);
    const wh = smoothstep(2 / 3 - 0.14, 2 / 3 + 0.14, v);
    return [
      [cloak, 1 - wm],
      [mid, wm - wh],
      [hem, wh],
    ];
  };
  const cols = hi ? 16 : 10;
  const rows = hi ? 12 : 9;
  const hw = (v: number) => 0.22 + 0.19 * Math.pow(v, 0.85);
  const depth = (v: number) => 0.078 + 0.14 * v;
  const surf = (u: number, v: number, pad = 0) => {
    const phi = (u - 0.5) * Math.PI;
    const fold = 1 + 0.08 * v * Math.sin(phi * 7 + 0.6);
    const x = hw(v) * Math.sin(phi) * (1 + 0.04 * v);
    const z = (depth(v) * Math.cos(phi) - 0.02) * fold + pad;
    const y = -v * CAPE_L + 0.018 * Math.cos(phi) * (1 - v); // slight hump over the shoulder blades
    return new THREE.Vector3(x, y, z);
  };
  // outward normals (+z) → mantle outside; the sheet shader darkens the inside (lining)
  rig.add(cloak, M.mantle, sheet(cols, rows, (u, v) => surf(u, v)), "Chest", weights);
  // gilded border: down one edge, along the hem, up the other
  const edge: THREE.Vector3[] = [];
  const n = hi ? 10 : 6;
  for (let i = 0; i <= n; i++) edge.push(surf(0, i / n, 0.004));
  for (let i = 1; i < n; i++) edge.push(surf(i / n, 1, 0.004));
  for (let i = n; i >= 0; i--) edge.push(surf(1, i / n, 0.004));
  rig.add(cloak, M.gold, trim(edge, 0.01, hi ? 90 : 48, hi ? 5 : 4), "Chest", weights);
}

/**
 * Full robe skirt from the belt to mid-shin. Front vertices ride the apron
 * joints, back ones the tabard joints, the flanks stay on the hips — so the
 * bell opens and swings with the stride and never gaps into planks.
 */
function buildRobeSkirt(rig: Rig, hips: THREE.Bone, M: HeroPaints, hi: boolean, armored: boolean) {
  const apron = rig.bone("apron", hips, 0, SKIRT_TOP, -0.02);
  const apronHem = rig.bone("apronHem", apron, 0, -PANEL_DROP, 0);
  const tabard = rig.bone("tabard", hips, 0, SKIRT_TOP, 0.02);
  const tabardHem = rig.bone("tabardHem", tabard, 0, -PANEL_DROP, 0);
  const weights: Weights = (p) => {
    const v = (SKIRT_TOP - p.y) / SKIRT_L;
    const phi = Math.atan2(p.x, -p.z);
    const cf = Math.cos(phi);
    const front = cf > 0 ? Math.pow(cf, 1.3) : 0;
    const back = cf < 0 ? Math.pow(-cf, 1.3) : 0;
    const a = smoothstep(0.0, 0.26, v);
    const b = smoothstep(0.3, 0.85, v);
    const out: [THREE.Bone, number][] = [[hips, 1 - (front + back) * a]];
    if (front > 0) out.push([apron, front * a * (1 - b)], [apronHem, front * a * b]);
    if (back > 0) out.push([tabard, back * a * (1 - b)], [tabardHem, back * a * b]);
    return out;
  };
  const R = (v: number) => 0.17 + 0.115 * Math.pow(v, 1.15);
  const surf = (u: number, v: number, pad = 0) => {
    const phi = (u - 0.5) * Math.PI * 2; // 0 = front, seam at the back
    const fold = 1 + 0.045 * v * Math.sin(phi * 8);
    const r = R(v) * fold + pad;
    return new THREE.Vector3(Math.sin(phi) * r * 1.14, SKIRT_TOP - v * SKIRT_L, -Math.cos(phi) * r * 0.94);
  };
  const cols = hi ? 30 : 18;
  const rows = hi ? 9 : 6;
  rig.add(hips, M.robeSheet, sheet(cols, rows, (u, v) => surf(u, v), true), "Chest", weights);
  const hem: THREE.Vector3[] = [];
  const band: THREE.Vector3[] = [];
  const hn = hi ? 40 : 24;
  for (let i = 0; i <= hn; i++) {
    hem.push(surf(i / hn, 1, 0.005));
    band.push(surf(i / hn, 0.88, 0.005));
  }
  rig.add(hips, M.gold, trim(hem, 0.009, hi ? 60 : 36, 4, true), "Chest", weights);
  if (armored) rig.add(hips, M.gold, trim(band, 0.005, hi ? 60 : 36, 4, true), "Chest", weights);
  // front placket down the skirt
  const mid: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) mid.push(surf(0.5, i / 6, 0.006));
  rig.add(hips, M.gold, trim(mid, 0.006, 12, 4), "Chest", weights);
}

// ——— assembly —————————————————————————————————————————————————————————

function buildTemplate(mats: MatKit, palette: HeroPalette, hi: boolean): THREE.Group {
  const seg = hi ? 16 : 10;
  const M = heroPaints(palette);
  const rig = new Rig();
  // The Guide is a scholar-shade: no pauldrons, shin plates or knee cops
  const armored = palette === "pilgrim";

  const root = new THREE.Group();
  root.name = "wanderer";

  const hips = rig.bone("hips", root);
  // trousers pelvis + tunic skirt + plain belt (always)
  rig.add(hips, M.trousers, at(new THREE.SphereGeometry(0.135, seg, hi ? 10 : 7), 0, 0.95, 0, 0, 0, 0, 1.22, 0.72, 0.86));
  rig.add(hips, M.trousers, at(lathe([[0.14, 0.9], [0.147, 0.98], [0.141, 1.06], [0.134, 1.1]], seg), 0, 0, 0, 0, 0, 0, TORSO_SX * 0.98, 1, TORSO_SZ * 1.12));
  rig.add(hips, M.tunicSheet, at(lathe([[0.205, 0.78], [0.183, 0.88], [0.165, 0.97], [0.154, 1.06]], seg), 0, 0, 0, 0, 0, 0, 1.12, 1, 0.9));
  rig.add(hips, M.leather, at(new THREE.TorusGeometry(0.154, 0.016, 5, seg * 2), 0, 1.035, 0, Math.PI / 2, 0, 0, TORSO_SX * 0.98, TORSO_SZ * 1.18, 1));
  // Chest slot: wide sword belt, gilt buckle, pouch and a scroll case
  rig.add(hips, M.leather, at(lathe([[0.16, 1.005], [0.164, 1.035], [0.16, 1.065]], seg * 2), 0, 0, 0, 0, 0, 0, TORSO_SX, 1, TORSO_SZ * 1.2), "Chest");
  rig.add(hips, M.gold, at(rbox(0.056, 0.05, 0.02, 0.008, 1), 0, 1.035, -0.146), "Chest");
  rig.add(hips, M.leather, at(rbox(0.07, 0.085, 0.05, 0.018, 2), 0.16, 0.975, -0.05, 0, 0.5, 0), "Chest");
  rig.add(hips, M.gold, at(rbox(0.03, 0.012, 0.012, 0.004, 1), 0.172, 1.005, -0.078, 0, 0.5, 0), "Chest");
  rig.add(hips, M.darkLeather, at(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), -0.17, 0.98, 0.07, 0.3, 0, 0.2), "Chest");
  rig.add(hips, M.gold, at(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8), -0.15, 1.075, 0.1, 0.3, 0, 0.2), "Chest");
  buildLeg(rig, hips, M, -1, hi, armored);
  buildLeg(rig, hips, M, 1, hi, armored);
  buildRobeSkirt(rig, hips, M, hi, armored);

  const torso = rig.bone("torso", hips, 0, WAIST_Y, 0);
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
  for (const side of [-1, 1] as const) {
    const baldric: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      baldric.push(torsoSurf(-0.16 + 0.34 * t, 0.4 - 0.43 * t, side, 0.02));
    }
    rig.add(torso, M.leather, trim(baldric, 0.014, 20, 4), "Chest");
  }
  // mantle brooches at the collarbones
  for (const sx of [-1, 1]) {
    rig.add(torso, M.gold, at(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 10), 0.12 * sx, 0.43, -0.06, Math.PI / 2 - 0.5, 0, 0), "Chest");
  }

  buildArm(rig, torso, M, -1, hi, armored);
  const armR = buildArm(rig, torso, M, 1, hi, armored);
  buildHead(rig, torso, M, hi, palette);
  buildCape(rig, torso, M, hi);

  // weapon + buckler in the fists
  const handR = armR.getObjectByName("handR") as THREE.Bone;
  buildSword(rig, handR, M, hi);
  buildBuckler(rig, torso.getObjectByName("handL") as THREE.Bone, M, hi);
  // Legacy anchor (chest-high, right of centre) for effects that follow the torso
  const slashAnchor = new THREE.Object3D();
  slashAnchor.name = "slashAnchor";
  slashAnchor.position.set(0.1, 0.34, -0.04);
  torso.add(slashAnchor);

  rig.flush(root);

  // selection ring + soft contact shadow (shared geometry/material across clones)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.38, 0.44, hi ? 36 : 24),
    new THREE.MeshBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.name = "heroRing";
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.renderOrder = 2;
  ring.geometry.userData.shared = true;
  (ring.material as THREE.Material).userData.shared = true;
  const contact = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), mats.shadowCatch);
  contact.name = "discShadow";
  contact.geometry.userData.shared = true;
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.02;
  root.add(contact, ring);
  return root;
}

const _templates = new Map<string, THREE.Group>();

const _rayProxy = new THREE.Sphere();
const _rayHit = new THREE.Vector3();
/** Clicks test a torso-sized sphere, not 15k skinned triangles. */
function heroRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
  _rayProxy.center.set(0, 1.05, 0);
  _rayProxy.radius = 0.55;
  _rayProxy.applyMatrix4(this.matrixWorld);
  if (!raycaster.ray.intersectSphere(_rayProxy, _rayHit)) return;
  const d = raycaster.ray.origin.distanceTo(_rayHit);
  if (d < raycaster.near || d > raycaster.far) return;
  hits.push({ distance: d, point: _rayHit.clone(), object: this });
}
function noRaycast() {
  /* merged skinned parts: the body mesh answers for the whole hero */
}

/** Build the hero rig. `palette` "guide" restyles it for the Dark Wood guide. */
export function makeHero(mats: MatKit, palette: HeroPalette = "pilgrim"): THREE.Group {
  const hi = !isCompactUi();
  const key = `${palette}|${hi ? 1 : 0}`;
  let tpl = _templates.get(key);
  if (!tpl) {
    tpl = buildTemplate(mats, palette, hi);
    _templates.set(key, tpl);
  }
  const root = cloneSkinned(tpl) as THREE.Group;
  // One skeleton (one bone texture upload) per hero, shared by all its parts
  let skeleton: THREE.Skeleton | null = null;
  let first = true;
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    if (!skeleton) skeleton = sm.skeleton;
    else sm.bind(skeleton, sm.bindMatrix);
    sm.raycast = first && !sm.userData.gearSlot ? heroRaycast : noRaycast;
    if (first && !sm.userData.gearSlot) first = false;
  });
  root.userData.heroSkeleton = skeleton;
  return root;
}

const _ghosts = new Map<THREE.Material, THREE.Material>();

/** Net-offline ghost: swap in cached translucent twins (shared mats stay opaque). */
export function setHeroGhost(root: THREE.Object3D, on: boolean) {
  if (Boolean(root.userData.heroGhost) === on) return;
  root.userData.heroGhost = on;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.material || Array.isArray(m.material)) return;
    if (on) {
      const base = m.material;
      let g = _ghosts.get(base);
      if (!g) {
        g = base.clone();
        g.transparent = true;
        g.opacity = 0.45;
        g.onBeforeCompile = base.onBeforeCompile;
        g.customProgramCacheKey = base.customProgramCacheKey;
        g.userData.shared = true;
        _ghosts.set(base, g);
      }
      m.userData.baseMat = base;
      m.material = g;
    } else if (m.userData.baseMat) {
      m.material = m.userData.baseMat as THREE.Material;
      delete m.userData.baseMat;
    }
  });
}

/** Free a hero's per-instance GPU state (bone texture); geometry/materials are shared. */
export function disposeHero(root: THREE.Object3D) {
  const sk = root.userData.heroSkeleton as THREE.Skeleton | undefined;
  if (sk) sk.dispose();
  root.userData.heroSkeleton = null;
}
