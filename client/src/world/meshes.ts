/**
 * Hand-built bronze-statue meshes. Local forward is −z, feet on y=0.
 * A child named "nose" sits on the face so heading can be measured independently
 * of the mount (threejs-frame-conventions Rule 3 / 4).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MatKit } from "./materials";

const _eul = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _mtx = new THREE.Matrix4();

function xform(
  geo: THREE.BufferGeometry,
  px: number,
  py: number,
  pz: number,
  rx: number,
  ry: number,
  rz: number,
  sx = 1,
  sy = 1,
  sz = 1
): THREE.BufferGeometry {
  _eul.set(rx, ry, rz);
  _quat.setFromEuler(_eul);
  _pos.set(px, py, pz);
  _scl.set(sx, sy, sz);
  _mtx.compose(_pos, _quat, _scl);
  const g = geo.clone();
  g.applyMatrix4(_mtx);
  return g.index ? g.toNonIndexed() : g;
}

function mergeMesh(geos: THREE.BufferGeometry[], mat: THREE.Material, cast = true): THREE.Mesh | null {
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  if (!merged) return null;
  merged.computeVertexNormals();
  const m = new THREE.Mesh(merged, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function shadow(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
}

function nose(mats: MatKit, y: number, z: number) {
  const n = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mats.gold);
  n.name = "nose";
  n.position.set(0, y, z);
  return n;
}

function discShadow(mats: MatKit, r: number) {
  const s = new THREE.Mesh(new THREE.CircleGeometry(r, 16), mats.shadowCatch);
  s.rotation.x = -Math.PI / 2;
  s.position.y = 0.02;
  s.receiveShadow = false;
  s.castShadow = false;
  return s;
}

function lambert(color: number, emissive = 0x000000, em = 0) {
  return new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: em });
}

function std(map: THREE.Texture | null, color: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({
    map: map ?? undefined,
    color,
    roughness: 0.72,
    metalness: 0.08,
    ...extra,
  });
}

function makeLeg(side: number, leather: THREE.Material, bootM: THREE.Material) {
  const g = new THREE.Group();
  g.name = side < 0 ? "legL" : "legR";
  g.position.set(0.13 * side, 0.92, 0);
  const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.42, 8), leather);
  thigh.position.y = -0.2;
  const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.4, 8), leather);
  shin.position.y = -0.58;
  const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.3), bootM);
  boot.position.set(0, -0.82, 0.06);
  g.add(thigh, shin, boot);
  return g;
}

function makeArm(side: number, leather: THREE.Material, armor: THREE.Material) {
  const g = new THREE.Group();
  g.name = side < 0 ? "armL" : "armR";
  g.position.set(0.28 * side, 1.48, 0);
  g.rotation.z = side * 0.18;
  const ua = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.36, 8), leather);
  ua.position.y = -0.16;
  const la = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.34, 8), leather);
  la.position.y = -0.48;
  const pad = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), armor);
  pad.position.set(0.02 * side, 0.02, 0);
  pad.scale.set(1.2, 0.7, 1);
  g.add(ua, la, pad);
  return g;
}

/** Dark-fantasy wanderer (D4/PoE2 silhouette). Local forward −z, feet on y=0. */
export function makeWanderer(mats: MatKit): THREE.Group {
  const root = new THREE.Group();
  root.name = "wanderer";

  const leather = std(mats.leather.map, 0x5c4a38, { roughness: 0.86, metalness: 0.06 });
  const armor = std(mats.armor.map, 0xb08a48, { roughness: 0.4, metalness: 0.55, emissive: 0x2a1c08, emissiveIntensity: 0.2 });
  const gold = std(mats.gold.map, 0xe8c86a, { roughness: 0.3, metalness: 0.75, emissive: 0x6a4a10, emissiveIntensity: 0.45 });
  const skin = lambert(0xe2c4a4, 0x3a2818, 0.08);
  const bootM = lambert(0x2a2218);
  const steel = std(null, 0xc8c0a8, { roughness: 0.35, metalness: 0.7 });
  const capeM = std(mats.leather.map, 0x3a3228, { roughness: 0.9, side: THREE.DoubleSide });

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.46, 28),
    new THREE.MeshBasicMaterial({
      color: 0xc9a227,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;

  const hips = new THREE.Group();
  hips.name = "hips";
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), leather);
  pelvis.scale.set(1.25, 0.7, 0.9);
  pelvis.position.y = 0.92;
  hips.add(pelvis, makeLeg(-1, leather, bootM), makeLeg(1, leather, bootM));

  const torso = new THREE.Group();
  torso.name = "torso";
  torso.position.y = 1.05;
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.55, 12), leather);
  chest.position.y = 0.28;
  const breast = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), armor);
  breast.position.set(0, 0.38, 0.06);
  breast.scale.set(1.15, 0.7, 0.55);
  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 20), gold);
  sash.rotation.x = Math.PI / 2;
  sash.position.y = 0.06;
  const armL = makeArm(-1, leather, armor);
  const armR = makeArm(1, leather, armor);
  armL.position.set(-0.26, 0.48, 0);
  armR.position.set(0.26, 0.48, 0);

  const weapon = new THREE.Group();
  weapon.name = "weapon";
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.95, 0.09), steel);
  blade.position.y = -0.42;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.08), gold);
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), gold);
  hilt.position.y = 0.1;
  weapon.add(blade, guard, hilt);
  weapon.position.set(0, -0.55, 0.02);
  weapon.rotation.z = 0.12;
  armR.add(weapon);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 12), skin);
  head.position.y = 0.72;
  const hood = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    leather
  );
  hood.name = "hood";
  hood.position.set(0, 0.78, 0.02);
  hood.rotation.x = -0.42;

  const cloak = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.08, 0),
        new THREE.Vector2(0.28, 0.1),
        new THREE.Vector2(0.4, 0.45),
        new THREE.Vector2(0.36, 0.95),
        new THREE.Vector2(0.22, 1.25),
      ],
      14,
      Math.PI * 0.55,
      Math.PI * 0.9
    ),
    capeM
  );
  cloak.name = "cloak";
  cloak.position.set(0, -0.15, 0.12);
  cloak.rotation.y = Math.PI;

  torso.add(chest, breast, sash, armL, armR, head, hood, cloak, nose(mats, 0.72, -0.13));
  root.add(ring, hips, torso);
  shadow(root);
  return root;
}

/** Cloaked guide with lantern staff. */
export function makeGuide(mats: MatKit): THREE.Group {
  const g = makeWanderer(mats);
  g.name = "guide";
  g.scale.setScalar(1.08);
  const wep = g.getObjectByName("weapon");
  if (wep) wep.visible = false;
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 2.2, 8), mats.bronze);
  staff.position.set(-0.38, 1.15, 0.08);
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), mats.gold);
  lantern.position.set(-0.38, 2.2, 0.08);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), mats.ember);
  flame.position.set(-0.38, 2.2, 0.08);
  flame.name = "ember";
  g.add(staff, lantern, flame);
  return g;
}

function makeShadeBody(mats: MatKit, scale: number, goldTrim: boolean): THREE.Group {
  const g = new THREE.Group();
  const wraith = goldTrim
    ? std(mats.leather.map, 0x3a2418, { roughness: 0.7, metalness: 0.15, emissive: 0x2a1008, emissiveIntensity: 0.18 })
    : std(mats.leather.map, 0x2a2420, { roughness: 0.82, metalness: 0.06, emissive: 0x1a0804, emissiveIntensity: 0.12 });
  const pts = [
    new THREE.Vector2(0.02, 0),
    new THREE.Vector2(0.22, 0.18),
    new THREE.Vector2(0.32, 0.55),
    new THREE.Vector2(0.24, 1.05),
    new THREE.Vector2(0.12, 1.55),
    new THREE.Vector2(0.04, 1.85),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), wraith);
  body.position.y = 0.2;
  const hood = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.72),
    goldTrim ? mats.gold : wraith
  );
  hood.position.set(0, 1.78, 0.04);
  hood.rotation.x = -0.35;
  const voidFace = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mats.ember);
  voidFace.position.set(0, 1.68, -0.14);
  voidFace.name = "ember";
  const rib = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 16), goldTrim ? mats.gold : mats.bronze);
  rib.position.set(0, 1.15, 0.04);
  rib.rotation.x = 0.4;
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.045, 0.85, 6), wraith);
  armL.position.set(-0.38, 1.15, -0.15);
  armL.rotation.z = 0.55;
  armL.rotation.x = 0.35;
  const armR = armL.clone();
  armR.position.x = 0.38;
  armR.rotation.z = -0.55;
  const clawL = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 5), mats.bone);
  clawL.position.set(-0.62, 0.72, -0.32);
  clawL.rotation.x = 0.9;
  const clawR = clawL.clone();
  clawR.position.x = 0.62;
  const ribbon = new THREE.Mesh(new THREE.TorusKnotGeometry(0.48, 0.035, 90, 8, 2, 5), mats.gale);
  ribbon.position.y = 0.95;
  ribbon.name = "ribbon";
  const ribbon2 = new THREE.Mesh(new THREE.TorusKnotGeometry(0.62, 0.022, 70, 6, 3, 4), mats.gale);
  ribbon2.position.y = 0.7;
  ribbon2.name = "ribbon2";
  g.add(
    discShadow(mats, 0.55),
    body,
    hood,
    voidFace,
    rib,
    armL,
    armR,
    clawL,
    clawR,
    ribbon,
    ribbon2,
    nose(mats, 1.68, -0.22)
  );
  g.scale.setScalar(scale);
  shadow(g);
  return g;
}

export function makeWhirlShade(mats: MatKit): THREE.Group {
  const g = makeShadeBody(mats, 1.12, false);
  g.name = "whirl";
  return g;
}

export function makeChampion(mats: MatKit): THREE.Group {
  const g = makeShadeBody(mats, 1.45, true);
  g.name = "champion";
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.42, 6), mats.gold);
  crown.position.set(0, 2.15, 0);
  const plume = new THREE.Mesh(new THREE.TorusKnotGeometry(0.22, 0.03, 40, 6, 2, 3), mats.gale);
  plume.position.set(0, 2.05, 0);
  plume.name = "ribbon";
  g.add(crown, plume);
  return g;
}

/** Judge of the Gate — tall horned magistrate, coiled tail, ember gaze. */
export function makeJudge(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "judge";
  const robePts = [
    new THREE.Vector2(0.18, 0),
    new THREE.Vector2(1.15, 0.35),
    new THREE.Vector2(1.25, 1.4),
    new THREE.Vector2(0.85, 2.8),
    new THREE.Vector2(0.52, 3.7),
  ];
  const robe = new THREE.Mesh(new THREE.LatheGeometry(robePts, 28), mats.cloth);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.58, 1.35, 14), mats.armor);
  torso.position.y = 3.55;
  const pauldronL = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), mats.gold);
  pauldronL.position.set(-0.48, 4.05, 0.05);
  pauldronL.scale.set(1.3, 0.55, 1);
  const pauldronR = pauldronL.clone();
  pauldronR.position.x = 0.48;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 14), mats.bone);
  head.position.set(0, 4.45, 0.06);
  const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.09, 1.15, 7), mats.gold);
  hornL.position.set(-0.28, 5.05, -0.08);
  hornL.rotation.z = 0.55;
  hornL.rotation.x = -0.28;
  const hornR = hornL.clone();
  hornR.position.x = 0.28;
  hornR.rotation.z = -0.55;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), mats.ember);
  eyeL.position.set(-0.12, 4.48, -0.3);
  eyeL.name = "ember";
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.12;
  const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 24), mats.gold);
  circlet.position.set(0, 4.62, 0.04);
  circlet.rotation.x = Math.PI / 2.4;

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.35, 0.25, 0.5),
    new THREE.Vector3(1.35, 0.55, 0.35),
    new THREE.Vector3(1.85, 1.4, -0.4),
    new THREE.Vector3(1.1, 2.4, -1.15),
    new THREE.Vector3(-0.4, 3.0, -0.7),
    new THREE.Vector3(-1.15, 2.1, 0.35),
    new THREE.Vector3(-0.55, 1.2, 0.85),
  ]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(curve, 56, 0.2, 10, false), mats.bronze);
  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 28), mats.gold);
  sash.position.y = 2.85;
  sash.rotation.x = Math.PI / 2;
  const aura = new THREE.Mesh(
    new THREE.RingGeometry(1.6, 2.05, 36),
    new THREE.MeshBasicMaterial({
      color: 0xff5533,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  aura.rotation.x = -Math.PI / 2;
  aura.position.y = 0.08;
  aura.name = "judgeAura";
  const glow = new THREE.PointLight(0xff6622, 5.5, 16, 1.5);
  glow.position.set(0, 3.4, 0.4);

  g.add(
    discShadow(mats, 1.4),
    robe,
    torso,
    pauldronL,
    pauldronR,
    head,
    hornL,
    hornR,
    eyeL,
    eyeR,
    circlet,
    tail,
    sash,
    aura,
    glow,
    nose(mats, 4.45, -0.32)
  );
  shadow(g);
  return g;
}

export function makeChest(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "stash";
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.55), mats.bronze);
  box.position.y = 0.32;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.12, 0.58), mats.gold);
  lid.position.set(0, 0.62, 0);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.08, 0.08), mats.gold);
  band.position.set(0, 0.32, 0.28);
  g.add(discShadow(mats, 0.55), box, lid, band, nose(mats, 0.55, -0.3));
  shadow(g);
  return g;
}

export function makeLectern(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "ah";
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.05, 8), mats.bronze);
  post.position.y = 0.52;
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.5), mats.gold);
  top.position.set(0, 1.08, 0.05);
  top.rotation.x = -0.35;
  const book = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.32), mats.cloth);
  book.position.set(0, 1.14, 0.02);
  book.rotation.x = -0.35;
  g.add(discShadow(mats, 0.4), post, top, book, nose(mats, 1.1, -0.2));
  shadow(g);
  return g;
}

export function makeWrit(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "quest";
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.5, 0.22), mats.stone);
  pillar.position.y = 0.75;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.1, 0.32), mats.gold);
  cap.position.y = 1.55;
  const tablet = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.42, 0.04), mats.bone);
  tablet.position.set(0, 0.95, -0.14);
  g.add(discShadow(mats, 0.35), pillar, cap, tablet, nose(mats, 1.2, -0.18));
  shadow(g);
  return g;
}

export function makePortal(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "portal";
  const colL = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 3.6, 12), mats.stone);
  colL.position.set(-1.15, 1.8, 0);
  const colR = colL.clone();
  colR.position.x = 1.15;
  const capL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.42), mats.gold);
  capL.position.set(-1.15, 3.62, 0);
  const capR = capL.clone();
  capR.position.x = 1.15;
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.14, 10, 28, Math.PI), mats.stone);
  arch.position.y = 3.55;
  arch.rotation.z = Math.PI;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.05, 32), mats.gale);
  disc.position.set(0, 2.05, 0);
  disc.name = "galeDisc";
  const disc2 = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.95, 28), mats.gale);
  disc2.position.set(0, 2.05, 0.02);
  disc2.name = "galeRing";
  const trim = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.05, 8, 32), mats.gold);
  trim.position.y = 2.05;
  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 8, 24), mats.gold);
  inner.position.y = 2.05;
  inner.name = "portalInner";
  const glow = new THREE.PointLight(0xff6633, 6.5, 14, 1.6);
  glow.position.set(0, 2.1, 0.2);
  const n = 48;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * (0.25 + (i % 5) * 0.12);
    pos[i * 3 + 1] = 0.4 + (i % 7) * 0.38;
    pos[i * 3 + 2] = Math.sin(a) * (0.25 + (i % 4) * 0.1);
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const sparks = new THREE.Points(
    pgeo,
    new THREE.PointsMaterial({
      color: 0xff8844,
      size: 0.11,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sparks.name = "portalSparks";
  g.add(discShadow(mats, 1.45), colL, colR, capL, capR, arch, disc, disc2, trim, inner, glow, sparks, nose(mats, 2.0, -0.2));
  shadow(g);
  return g;
}

export function makeLootGem(mats: MatKit, rarity = "normal"): THREE.Group {
  const g = new THREE.Group();
  g.name = "loot";
  const mat = mats.gem.clone();
  const hex = { normal: 0xb8b0a0, magic: 0x4a7fd4, rare: 0xd4b84a, set: 0x33cc88, unique: 0xcc8800, canto_unique: 0xee66cc }[
    rarity
  ] ?? 0xb8b0a0;
  mat.color.setHex(hex);
  mat.emissive.setHex(hex);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), mat);
  gem.position.y = 0.52;
  gem.name = "gem";
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 8, 18), mats.gold);
  ring.position.y = 0.28;
  ring.rotation.x = Math.PI / 2;
  const glow = new THREE.PointLight(hex, rarity === "normal" ? 0.8 : 2.2, 5, 2);
  glow.position.y = 0.6;
  g.add(discShadow(mats, 0.3), gem, ring, glow, nose(mats, 0.55, -0.14));
  return g;
}

export function makeTree(mats: MatKit, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "tree";
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const h = 7.4 + rng() * 6.2;
  const leanX = (rng() - 0.5) * 0.34;
  const leanZ = (rng() - 0.5) * 0.28;
  const dead = rng() > 0.58;
  const rBase = 0.28 + rng() * 0.2;
  const barkGeos: THREE.BufferGeometry[] = [];
  const leafGeos: THREE.BufferGeometry[] = [];
  const canopyMat = rng() > 0.5 ? mats.canopyA : mats.canopyB;

  const nRoots = 4 + ((rng() * 3) | 0);
  for (let i = 0; i < nRoots; i++) {
    const ang = (i / nRoots) * Math.PI * 2 + rng() * 0.5;
    const len = 0.9 + rng() * 0.7;
    const cyl = new THREE.CylinderGeometry(0.025 + rng() * 0.02, 0.08 + rng() * 0.04, len, 5);
    barkGeos.push(
      xform(cyl, Math.cos(ang) * 0.42, 0.07, Math.sin(ang) * 0.42, 1.18, -ang, 0.18, 1, 1, 1)
    );
    cyl.dispose();
  }

  let y = 0;
  let r = rBase;
  const segs = 3;
  for (let i = 0; i < segs; i++) {
    const segH = h / segs * (i === 0 ? 1.05 : 0.95);
    const rTop = r * (0.58 + rng() * 0.14);
    const cyl = new THREE.CylinderGeometry(rTop, r, segH, 7);
    const px = leanX * (y + segH * 0.5);
    const pz = leanZ * (y + segH * 0.5);
    barkGeos.push(xform(cyl, px, y + segH / 2, pz, leanZ * 0.45, 0, -leanX * 0.45));
    cyl.dispose();
    y += segH;
    r = rTop;
  }

  const nBr = 6 + ((rng() * 4) | 0);
  for (let i = 0; i < nBr; i++) {
    const t = 0.38 + rng() * 0.55;
    const by = h * t;
    const ang = rng() * Math.PI * 2;
    const len = 1.35 + rng() * 2.4;
    const px = Math.cos(ang) * 0.18 + leanX * by;
    const pz = Math.sin(ang) * 0.18 + leanZ * by;
    const rx = Math.sin(ang) * (0.65 + rng() * 0.55);
    const rz = Math.cos(ang) * (0.65 + rng() * 0.55);
    const cyl = new THREE.CylinderGeometry(0.02 + rng() * 0.015, 0.055 + rng() * 0.03, len, 5);
    barkGeos.push(xform(cyl, px, by, pz, rx, 0, rz));
    cyl.dispose();

    if (!dead && rng() > 0.18) {
      const s = 0.42 + rng() * 0.7;
      const ico = new THREE.IcosahedronGeometry(s, 0);
      leafGeos.push(
        xform(
          ico,
          px + Math.cos(ang) * len * 0.42,
          by + 0.22 + rng() * 0.4,
          pz + Math.sin(ang) * len * 0.42,
          rng() * 0.8,
          rng() * Math.PI,
          rng() * 0.8,
          1.25 + rng() * 0.4,
          0.28 + rng() * 0.16,
          1.15 + rng() * 0.3
        )
      );
      ico.dispose();
    }
  }

  if (!dead) {
    for (let t = 0; t < 3; t++) {
      const tuft = new THREE.IcosahedronGeometry(0.7 + rng() * 0.55, 0);
      leafGeos.push(
        xform(
          tuft,
          leanX * h + (rng() - 0.5) * 1.1,
          h - 0.35 + rng() * 0.55,
          leanZ * h + (rng() - 0.5) * 1.1,
          rng() * 0.7,
          rng(),
          rng() * 0.7,
          1.2 + rng() * 0.35,
          0.26 + rng() * 0.12,
          1.15 + rng() * 0.25
        )
      );
      tuft.dispose();
    }
  }

  const barkMesh = mergeMesh(barkGeos, mats.bark.clone());
  if (barkMesh) g.add(barkMesh);
  const leafMesh = mergeMesh(leafGeos, canopyMat.clone());
  if (leafMesh) g.add(leafMesh);
  g.add(discShadow(mats, 0.55 + rBase));
  return g;
}

export function makeStump(mats: MatKit, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "stump";
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const h = 0.45 + rng() * 0.4;
  const r = 0.22 + rng() * 0.14;
  const geos: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(r * 0.82, r, h, 8);
  geos.push(xform(trunk, 0, h / 2, 0, 0, rng(), 0));
  trunk.dispose();
  const cap = new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.05, 8);
  geos.push(xform(cap, 0, h + 0.02, 0, 0, 0, 0));
  cap.dispose();
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + rng() * 0.4;
    const root = new THREE.CylinderGeometry(0.03, 0.08, 0.7, 5);
    geos.push(xform(root, Math.cos(ang) * 0.28, 0.06, Math.sin(ang) * 0.28, 1.2, -ang, 0));
    root.dispose();
  }
  const mesh = mergeMesh(geos, mats.bark);
  if (mesh) g.add(mesh);
  g.add(discShadow(mats, r + 0.15));
  return g;
}

export function makeFallenLog(mats: MatKit, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "log";
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const len = 2.2 + rng() * 2.4;
  const r = 0.12 + rng() * 0.1;
  const geos: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(r * 0.85, r, len, 7);
  geos.push(xform(body, 0, r * 0.7, 0, 0, 0, Math.PI / 2));
  body.dispose();
  if (rng() > 0.4) {
    const stub = new THREE.CylinderGeometry(0.03, 0.06, 0.45 + rng() * 0.3, 5);
    geos.push(xform(stub, (rng() - 0.5) * len * 0.3, r + 0.2, 0.05, 0.7, 0, 0.4));
    stub.dispose();
  }
  const mesh = mergeMesh(geos, mats.bark);
  if (mesh) g.add(mesh);
  g.add(discShadow(mats, len * 0.28));
  return g;
}

export function makeMossClump(mats: MatKit, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "moss";
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const s = 0.35 + rng() * 0.55;
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mats.moss);
  m.position.y = 0.06;
  m.scale.set(1.3, 0.22 + rng() * 0.12, 1.15);
  m.rotation.y = rng() * Math.PI * 2;
  m.castShadow = false;
  m.receiveShadow = true;
  g.add(m);
  return g;
}

export function makeForestRock(mats: MatKit, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "rock";
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 + rng() * 0.32, 0), mats.stone);
  m.position.y = 0.12;
  m.scale.set(1.1 + rng() * 0.5, 0.45 + rng() * 0.35, 0.9 + rng() * 0.4);
  m.rotation.set(rng() * 0.4, rng() * Math.PI, rng() * 0.4);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m, discShadow(mats, 0.32));
  return g;
}

export function makeBrazier(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "brazier";
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.18, 0.22, 10), mats.bronze);
  bowl.position.y = 0.55;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.5, 8), mats.stone);
  stem.position.y = 0.25;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 7), mats.ember);
  flame.position.y = 0.85;
  flame.name = "ember";
  const light = new THREE.PointLight(0xff6622, 2.4, 8, 2);
  light.position.y = 0.9;
  g.add(discShadow(mats, 0.32), stem, bowl, flame, light);
  return g;
}

export function makeGaleRibbon(mats: MatKit, len = 8): THREE.Mesh {
  const mat = mats.gale.clone();
  mat.opacity = 0.8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.6, 1, 1), mat);
  m.rotation.x = Math.PI * 0.16;
  m.position.y = 1.7;
  m.name = "galeRibbon";
  m.renderOrder = 2;
  return m;
}

export function makeRuinObelisk(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.8, 0.45), mats.stone);
  shaft.position.y = 1.4;
  shaft.rotation.y = 0.3;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.5, 4), mats.gold);
  cap.position.y = 3.05;
  g.add(discShadow(mats, 0.4), shaft, cap);
  shadow(g);
  return g;
}

export type KindKey =
  | "player"
  | "guide"
  | "whirl"
  | "champion"
  | "judge"
  | "stash"
  | "ah"
  | "quest"
  | "portal"
  | "loot";

export function makeByKind(kind: KindKey, mats: MatKit, rarity?: string): THREE.Group {
  switch (kind) {
    case "player":
      return makeWanderer(mats);
    case "guide":
      return makeGuide(mats);
    case "whirl":
      return makeWhirlShade(mats);
    case "champion":
      return makeChampion(mats);
    case "judge":
      return makeJudge(mats);
    case "stash":
      return makeChest(mats);
    case "ah":
      return makeLectern(mats);
    case "quest":
      return makeWrit(mats);
    case "portal":
      return makePortal(mats);
    case "loot":
      return makeLootGem(mats, rarity);
  }
}

export function resolveKind(ent: {
  kind: string;
  poiKind?: string;
  champion?: boolean;
  name?: string;
}): KindKey {
  if (ent.kind === "player") return "player";
  if (ent.kind === "boss") return "judge";
  if (ent.kind === "loot") return "loot";
  if (ent.kind === "exit" || ent.poiKind === "portal") return "portal";
  if (ent.kind === "poi") {
    if (ent.poiKind === "stash") return "stash";
    if (ent.poiKind === "ah") return "ah";
    if (ent.poiKind === "quest") return "quest";
    return "guide";
  }
  if (ent.kind === "mob") return ent.champion ? "champion" : "whirl";
  return "whirl";
}

/** Independent front cue (the "nose" child), flattened to XZ. */
export function modelFrontWorld(root: THREE.Object3D): THREE.Vector3 {
  const n = root.getObjectByName("nose");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  root.getWorldPosition(a);
  if (n) n.getWorldPosition(b);
  else b.copy(a).add(new THREE.Vector3(0, 0, -1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
  b.sub(a);
  b.y = 0;
  if (b.lengthSq() < 1e-8) return new THREE.Vector3(0, 0, -1);
  return b.normalize();
}
