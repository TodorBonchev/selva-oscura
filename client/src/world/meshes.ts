/**
 * Hand-built bronze-statue meshes. Local forward is −z, feet on y=0.
 * A child named "nose" sits on the face so heading can be measured independently
 * of the mount (threejs-frame-conventions Rule 3 / 4).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MatKit } from "./materials";
import { isCompactUi } from "../ui/hud";
import { tagGearSlot } from "./gearLook";

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

function segCount(hi: number, lo: number) {
  return isCompactUi() ? lo : hi;
}

function makeLeg(side: number, leather: THREE.Material, bootM: THREE.Material, gold: THREE.Material) {
  const rad = segCount(12, 8);
  const g = new THREE.Group();
  g.name = side < 0 ? "legL" : "legR";
  // Hip pivot ~ adult pelvis width; feet land near y=0 with thigh+calf+boot stack.
  g.position.set(0.125 * side, 0.96, 0.015);

  const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.098, 0.44, rad), leather);
  thigh.position.y = -0.22;
  thigh.scale.set(1.05, 1, 1.12);
  const thighPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.092, 0.16, segCount(10, 7)), gold);
  thighPlate.position.y = -0.12;
  thighPlate.scale.set(1.05, 1, 0.85);
  tagGearSlot(thighPlate, "Chest");

  const knee = new THREE.Group();
  knee.name = side < 0 ? "kneeL" : "kneeR";
  knee.position.y = -0.44;
  const knurl = new THREE.Mesh(new THREE.SphereGeometry(0.062, segCount(10, 7), segCount(8, 6)), leather);
  knurl.scale.set(1.15, 0.85, 1.05);
  const calf = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.066, 0.4, rad), leather);
  calf.position.y = -0.2;
  calf.scale.set(1.02, 1, 1.08);
  const greave = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.18, segCount(10, 7)), gold);
  greave.position.y = -0.24;
  greave.scale.set(1.05, 1, 0.9);
  tagGearSlot(greave, "Feet");

  // Soft foot stub always visible when boots are unequipped.
  const footStub = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.055, 0.16), leather);
  footStub.position.set(0, -0.455, -0.03);

  const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.042, segCount(8, 6), 6), bootM);
  ankle.position.y = -0.4;
  ankle.scale.set(1.15, 0.7, 1.25);
  tagGearSlot(ankle, "Feet");

  const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.26), bootM);
  boot.position.set(0, -0.455, -0.05);
  tagGearSlot(boot, "Feet");
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.028, 0.28), lambert(0x0e0a08));
  sole.position.set(0, -0.51, -0.055);
  tagGearSlot(sole, "Feet");
  const toe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.055, 0.1), bootM);
  toe.name = side < 0 ? "toeL" : "toeR";
  toe.position.set(0, -0.46, -0.175);
  tagGearSlot(toe, "Feet");
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.052, 0.08, segCount(8, 6)), bootM);
  cuff.position.y = -0.36;
  tagGearSlot(cuff, "Feet");

  knee.add(knurl, calf, footStub, greave, ankle, boot, sole, toe, cuff);
  g.add(thigh, thighPlate, knee);
  return g;
}

function makeHand(side: number, glove: THREE.Material, skin: THREE.Material): THREE.Group {
  const hand = new THREE.Group();
  hand.name = side < 0 ? "handL" : "handR";
  hand.position.y = -0.32;

  // Bare skin underlayer — visible when Hands slot is empty.
  const skinPalm = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.045, 0.08), skin);
  skinPalm.position.set(0, 0, 0.01);
  const skinFingers = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.028, 0.045), skin);
  skinFingers.position.set(0, -0.008, -0.05);

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.055, 0.095), glove);
  palm.position.set(0, 0, 0.01);
  palm.scale.set(1, 1, 1.05);
  tagGearSlot(palm, "Hands");

  // Finger mass — readable mitten + slight splits (cheap, compact-safe).
  const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.035, 0.055), glove);
  fingers.position.set(0, -0.01, -0.055);
  tagGearSlot(fingers, "Hands");
  const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.028, segCount(8, 5), 5), glove);
  knuckle.position.set(0, 0.01, -0.03);
  knuckle.scale.set(1.35, 0.7, 0.9);
  tagGearSlot(knuckle, "Hands");

  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.028, 3, segCount(6, 4)), glove);
  thumb.position.set(0.042 * side, -0.005, 0.01);
  thumb.rotation.z = side * 0.55;
  thumb.rotation.x = 0.35;
  tagGearSlot(thumb, "Hands");

  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.04, segCount(8, 6)), glove);
  wrist.position.y = 0.035;
  tagGearSlot(wrist, "Hands");

  hand.add(skinPalm, skinFingers, palm, fingers, knuckle, thumb, wrist);
  return hand;
}

function makeArm(
  side: number,
  leather: THREE.Material,
  armor: THREE.Material,
  glove: THREE.Material,
  skin: THREE.Material
) {
  const rad = segCount(12, 8);
  const g = new THREE.Group();
  g.name = side < 0 ? "armL" : "armR";
  // Rest flare matches tickHumanoid arm.rotation.z = ±0.16
  g.rotation.z = side * 0.16;

  const ua = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.07, 0.32, rad), leather);
  ua.position.y = -0.15;
  ua.scale.set(1.05, 1, 1.08);
  const deltoid = new THREE.Mesh(new THREE.SphereGeometry(0.055, segCount(10, 7), 7), leather);
  deltoid.position.y = -0.02;
  deltoid.scale.set(1.25, 0.85, 1.15);

  const elbow = new THREE.Group();
  elbow.name = side < 0 ? "elbowL" : "elbowR";
  elbow.position.y = -0.31;
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.042, segCount(10, 7), 7), leather);
  joint.scale.set(1.1, 0.9, 1.05);
  const la = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.05, 0.28, rad), leather);
  la.position.y = -0.14;
  const bracer = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.052, 0.14, segCount(10, 7)), armor);
  bracer.position.y = -0.2;
  bracer.scale.set(1.05, 1, 0.95);
  tagGearSlot(bracer, "Hands");

  const hand = makeHand(side, glove, skin);
  elbow.add(joint, la, bracer, hand);
  g.add(deltoid, ua, elbow);
  return g;
}

function makeLongsword(steel: THREE.Material, gold: THREE.Material): THREE.Group {
  const weapon = new THREE.Group();
  weapon.name = "weapon";
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.92, 0.085), steel);
  blade.position.y = -0.48;
  const fuller = new THREE.Mesh(
    new THREE.BoxGeometry(0.01, 0.72, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x9a9488, roughness: 0.28, metalness: 0.82 })
  );
  fuller.position.set(0, -0.46, 0.04);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.14, 4), steel);
  tip.position.y = -0.99;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.07), gold);
  const quillonL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.16), gold);
  quillonL.position.set(-0.13, 0, 0);
  const quillonR = quillonL.clone();
  quillonR.position.x = 0.13;
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.18, segCount(10, 7)), gold);
  hilt.position.y = 0.1;
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, segCount(8, 6)), steel);
  wrap.position.y = 0.1;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.042, segCount(10, 7), segCount(8, 6)), gold);
  pommel.position.y = 0.21;
  weapon.add(blade, fuller, tip, guard, quillonL, quillonR, hilt, wrap, pommel);
  return weapon;
}


function makeOffhandBuckler(steel: THREE.Material, gold: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = "offhand";
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.115, 0.028, segCount(14, 10)), steel);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(-0.02, 0.015, 0.055);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.032, segCount(8, 6), 6), gold);
  boss.position.set(-0.02, 0.015, 0.075);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, segCount(6, 5), segCount(14, 10)), gold);
  rim.position.set(-0.02, 0.015, 0.055);
  g.add(disc, boss, rim);
  tagGearSlot(g, "OffHand");
  g.visible = false;
  return g;
}

/** Dark-fantasy wanderer — adult human proportions, Doré bone-gold silhouette. Local forward −z, feet on y=0. */
export function makeWanderer(mats: MatKit): THREE.Group {
  const root = new THREE.Group();
  root.name = "wanderer";
  const latheSeg = segCount(14, 8);
  const bodyRad = segCount(14, 8);
  const headSeg = segCount(16, 9);

  const leather = std(mats.leather.map, 0x7a6248, { roughness: 0.82, metalness: 0.08 });
  const armor = std(mats.armor.map, 0xc49a52, { roughness: 0.38, metalness: 0.58, emissive: 0x3a2408, emissiveIntensity: 0.28 });
  const gold = std(mats.gold.map, 0xe8c86a, { roughness: 0.28, metalness: 0.78, emissive: 0x6a4a10, emissiveIntensity: 0.5 });
  const skin = lambert(0xc4a07a, 0x2a1810, 0.06);
  const bootM = lambert(0x1c1610);
  const steel = std(null, 0xc8c0a8, { roughness: 0.32, metalness: 0.74 });
  const glove = lambert(0x3a2c20);
  const capeM = std(mats.leather.map, 0x4a3c30, { roughness: 0.9, side: THREE.DoubleSide });
  const tabardM = std(mats.cloth.map, 0x6a5340, {
    roughness: 0.86,
    side: THREE.DoubleSide,
  });

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.38, 0.44, segCount(36, 24)),
    new THREE.MeshBasicMaterial({
      color: 0xc9a227,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.renderOrder = 2;

  // --- Hips / pelvis (~0.96) — shoulders will sit wider than this ---
  const hips = new THREE.Group();
  hips.name = "hips";

  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.14, bodyRad, segCount(10, 7)), leather);
  pelvis.scale.set(1.28, 0.55, 0.92);
  pelvis.position.y = 0.96;

  const abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.155, 0.16, bodyRad), leather);
  abdomen.position.y = 1.05;
  abdomen.scale.set(1.05, 1, 0.88);

  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.024, segCount(8, 6), segCount(18, 12)), gold);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.97;
  tagGearSlot(belt, "Chest");

  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.04, 0.02), gold);
  buckle.position.set(0, 0.97, -0.175);
  tagGearSlot(buckle, "Chest");

  const tabard = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.08, 0),
        new THREE.Vector2(0.14, -0.1),
        new THREE.Vector2(0.155, -0.28),
        new THREE.Vector2(0.13, -0.52),
      ],
      latheSeg,
      Math.PI * 0.82,
      Math.PI * 0.36
    ),
    tabardM
  );
  tabard.name = "tabard";
  tabard.position.set(0, 0.95, -0.03);
  tabard.rotation.y = Math.PI;
  tagGearSlot(tabard, "Chest");

  hips.add(
    pelvis,
    abdomen,
    belt,
    buckle,
    tabard,
    makeLeg(-1, leather, bootM, gold),
    makeLeg(1, leather, bootM, gold)
  );

  // --- Torso pivot near waist (anim rotates this group) ---
  const torso = new THREE.Group();
  torso.name = "torso";
  torso.position.y = 1.06;

  // Lathe torso: narrow waist → wider chest with depth via scale
  const ribcage = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.13, 0),
        new THREE.Vector2(0.155, 0.12),
        new THREE.Vector2(0.195, 0.32),
        new THREE.Vector2(0.185, 0.5),
        new THREE.Vector2(0.12, 0.58),
      ],
      latheSeg
    ),
    leather
  );
  ribcage.position.y = 0.02;
  ribcage.scale.set(1.12, 1, 0.78);

  const breast = new THREE.Mesh(new THREE.SphereGeometry(0.175, bodyRad, segCount(10, 7)), armor);
  breast.position.set(0, 0.38, -0.08);
  breast.scale.set(1.38, 0.58, 0.55);
  tagGearSlot(breast, "Chest");

  const sternum = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.02), gold);
  sternum.position.set(0, 0.36, -0.155);
  tagGearSlot(sternum, "Chest");

  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.022, segCount(8, 6), segCount(18, 12)), gold);
  sash.rotation.x = Math.PI / 2;
  sash.position.y = 0.06;
  tagGearSlot(sash, "Chest");

  // Shoulders wider than hips (~0.56 span vs ~0.25 hip)
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.028, segCount(8, 6), segCount(14, 10)), leather);
  collar.rotation.x = Math.PI / 2.2;
  collar.position.y = 0.55;

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.1, segCount(10, 7)), skin);
  neck.position.y = 0.62;

  const pauldronL = new THREE.Mesh(new THREE.SphereGeometry(0.115, bodyRad, segCount(10, 7)), armor);
  pauldronL.position.set(-0.27, 0.51, 0.02);
  pauldronL.scale.set(1.52, 0.48, 1.22);
  tagGearSlot(pauldronL, "Chest");
  const pauldronR = pauldronL.clone();
  pauldronR.position.x = 0.27;
  tagGearSlot(pauldronR, "Chest");
  const pauldronTrimL = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.016, segCount(6, 5), segCount(12, 8)), gold);
  pauldronTrimL.position.set(-0.285, 0.51, 0.02);
  pauldronTrimL.rotation.z = Math.PI / 2.35;
  tagGearSlot(pauldronTrimL, "Chest");
  const pauldronTrimR = pauldronTrimL.clone();
  pauldronTrimR.position.x = 0.285;
  pauldronTrimR.rotation.z = -Math.PI / 2.35;
  tagGearSlot(pauldronTrimR, "Chest");
  // Desktop-only ridge plates — keep compact at the wanderer mesh budget.
  let pauldronRidgeL: THREE.Mesh | null = null;
  let pauldronRidgeR: THREE.Mesh | null = null;
  if (!isCompactUi()) {
    pauldronRidgeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.022, 0.12), gold);
    pauldronRidgeL.position.set(-0.3, 0.545, 0.01);
    pauldronRidgeL.rotation.z = 0.35;
    tagGearSlot(pauldronRidgeL, "Chest");
    pauldronRidgeR = pauldronRidgeL.clone();
    pauldronRidgeR.position.x = 0.3;
    pauldronRidgeR.rotation.z = -0.35;
    tagGearSlot(pauldronRidgeR, "Chest");
  }

  const armL = makeArm(-1, leather, armor, glove, skin);
  const armR = makeArm(1, leather, armor, glove, skin);
  armL.position.set(-0.29, 0.48, 0);
  armR.position.set(0.29, 0.48, 0);

  const weapon = makeLongsword(steel, gold);
  weapon.position.set(0.015, 0.015, 0.035);
  weapon.rotation.x = 0.55;
  weapon.rotation.z = 0.12;
  tagGearSlot(weapon, "MainHand");
  const handR = armR.getObjectByName("handR");
  handR?.add(weapon);
  // Always-present anchor for attack slash FX (sibling of weapon; survives gear hide).
  const slashAnchor = new THREE.Group();
  slashAnchor.name = "slashAnchor";
  handR?.add(slashAnchor);

  const offhand = makeOffhandBuckler(steel, gold);
  armL.getObjectByName("handL")?.add(offhand);

  // --- Head: oval skull ~1/7.5 of ~1.82 height ---
  const headY = 0.66;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, headSeg, segCount(14, 9)), skin);
  head.position.y = headY;
  head.scale.set(0.92, 1.12, 0.95);

  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.072, segCount(10, 7), 7), skin);
  jaw.position.set(0, headY - 0.075, -0.025);
  jaw.scale.set(0.98, 0.52, 0.88);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.028, 0.042), skin);
  brow.position.set(0, headY + 0.038, -0.102);
  brow.scale.set(1, 0.72, 0.78);

  const noseBridge = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.052, 0.038), skin);
  noseBridge.position.set(0, headY - 0.008, -0.122);

  // Bare scalp fringe — desktop only (compact keeps head/jaw stubs for budget).
  let scalp: THREE.Mesh | null = null;
  if (!isCompactUi()) {
    scalp = new THREE.Mesh(new THREE.SphereGeometry(0.118, headSeg, segCount(10, 7), 0, Math.PI * 2, 0, Math.PI * 0.42), lambert(0x2a2218));
    scalp.position.set(0, headY + 0.02, 0.01);
    scalp.scale.set(0.98, 0.85, 1.02);
  }

  const cheekL = new THREE.Mesh(new THREE.SphereGeometry(0.036, segCount(8, 5), 5), skin);
  cheekL.position.set(-0.058, headY - 0.028, -0.072);
  cheekL.scale.set(0.72, 0.62, 0.55);
  const cheekR = cheekL.clone();
  cheekR.position.x = 0.058;

  const socketM = new THREE.MeshLambertMaterial({ color: 0x1a100c, emissive: 0x120c08, emissiveIntensity: 0.2 });
  const socketL = new THREE.Mesh(new THREE.SphereGeometry(0.03, segCount(8, 5), 5), socketM);
  socketL.position.set(-0.04, headY + 0.012, -0.108);
  socketL.scale.set(1.12, 0.68, 0.52);
  const socketR = socketL.clone();
  socketR.position.x = 0.04;

  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.015, segCount(8, 5), 5), mats.ember);
  eyeL.position.set(-0.04, headY + 0.012, -0.12);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.04;

  // Hood drapes over crown without swallowing face (anim rest hood.rotation.x = -0.38)
  const hood = new THREE.Mesh(
    new THREE.SphereGeometry(0.162, headSeg, segCount(12, 8), 0, Math.PI * 2, 0, Math.PI * 0.62),
    leather
  );
  hood.name = "hood";
  hood.position.set(0, headY + 0.048, 0.03);
  hood.rotation.x = -0.38;
  hood.scale.set(1.08, 0.98, 1.12);
  tagGearSlot(hood, "Head");

  // Soft front brim — desktop only.
  let hoodBrim: THREE.Mesh | null = null;
  if (!isCompactUi()) {
    hoodBrim = new THREE.Mesh(
      new THREE.TorusGeometry(0.12, 0.02, segCount(6, 5), segCount(14, 10), Math.PI * 1.05),
      leather
    );
    hoodBrim.position.set(0, headY + 0.02, -0.08);
    hoodBrim.rotation.x = 1.15;
    tagGearSlot(hoodBrim, "Head");
  }

  const cowl = new THREE.Mesh(
    new THREE.TorusGeometry(0.135, 0.026, segCount(8, 5), segCount(16, 10), Math.PI * 1.2),
    leather
  );
  cowl.position.set(0, headY - 0.085, -0.01);
  cowl.rotation.x = 0.58;
  tagGearSlot(cowl, "Head");

  const cloak = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.15, 0),
        new THREE.Vector2(0.26, -0.14),
        new THREE.Vector2(0.34, -0.42),
        new THREE.Vector2(0.3, -0.82),
        new THREE.Vector2(0.22, -1.08),
        new THREE.Vector2(0.14, -1.22),
      ],
      latheSeg,
      Math.PI * 0.52,
      Math.PI * 0.96
    ),
    capeM
  );
  cloak.name = "cloak";
  cloak.position.set(0, 0.48, 0.1);
  cloak.rotation.y = Math.PI;
  tagGearSlot(cloak, "Chest");

  const clasp = new THREE.Mesh(new THREE.SphereGeometry(0.03, segCount(8, 5), 5), gold);
  clasp.position.set(0, 0.48, -0.15);
  tagGearSlot(clasp, "Chest");

  torso.add(
    ribcage,
    breast,
    sternum,
    sash,
    collar,
    neck,
    pauldronL,
    pauldronR,
    pauldronTrimL,
    pauldronTrimR,
    armL,
    armR,
    head,
    jaw,
    brow,
    noseBridge,
    cheekL,
    cheekR,
    socketL,
    socketR,
    eyeL,
    eyeR,
    hood,
    cowl,
    cloak,
    clasp,
    nose(mats, headY, -0.138)
  );
  if (pauldronRidgeL) torso.add(pauldronRidgeL);
  if (pauldronRidgeR) torso.add(pauldronRidgeR);
  if (scalp) torso.add(scalp);
  if (hoodBrim) torso.add(hoodBrim);
  root.add(discShadow(mats, 0.38), ring, hips, torso);
  shadow(root);
  return root;
}

/** Cloaked guide with lantern staff — same rig as wanderer, softer cloth read. */
export function makeGuide(mats: MatKit): THREE.Group {
  const g = makeWanderer(mats);
  g.name = "guide";
  g.scale.setScalar(1.08);
  const wep = g.getObjectByName("weapon");
  if (wep) wep.visible = false;
  // Soften metal plates toward scholar-robes (keep silhouette / joints).
  const robe = std(mats.cloth.map, 0x5a4a3a, { roughness: 0.9, metalness: 0.04 });
  const robeGold = std(mats.gold.map, 0xb89850, { roughness: 0.45, metalness: 0.4, emissive: 0x3a2808, emissiveIntensity: 0.18 });
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!mat.isMeshStandardMaterial) return;
    if (mat.metalness != null && mat.metalness >= 0.5) m.material = robeGold;
    else if (mat.metalness != null && mat.metalness >= 0.08 && mat.roughness != null && mat.roughness < 0.5) m.material = robe;
  });
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 2.2, 8), mats.bronze);
  staff.position.set(-0.38, 1.15, 0.08);
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), mats.gold);
  lantern.position.set(-0.38, 2.22, 0.08);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mats.ember);
  flame.position.set(-0.38, 2.28, 0.08);
  flame.name = "ember";
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), mats.gale.clone());
  (halo.material as THREE.MeshBasicMaterial).opacity = 0.35;
  (halo.material as THREE.MeshBasicMaterial).transparent = true;
  (halo.material as THREE.MeshBasicMaterial).depthWrite = false;
  halo.position.set(-0.38, 2.28, 0.08);
  halo.name = "ember";
  g.add(staff, lantern, flame, halo);
  return g;
}

const shadeMats: { plain?: THREE.Material; gold?: THREE.Material } = {};

function shadeMat(mats: MatKit, goldTrim: boolean): THREE.Material {
  const key = goldTrim ? "gold" : "plain";
  if (!shadeMats[key]) {
    shadeMats[key] = goldTrim
      ? std(mats.leather.map, 0x5a3020, { roughness: 0.62, metalness: 0.2, emissive: 0x6a2010, emissiveIntensity: 0.35 })
      : std(mats.leather.map, 0x3a2824, { roughness: 0.74, metalness: 0.08, emissive: 0x4a180c, emissiveIntensity: 0.28 });
  }
  return shadeMats[key]!;
}

const mireShadeMats: { plain?: THREE.Material; gold?: THREE.Material } = {};

function mireShadeMat(mats: MatKit, goldTrim: boolean): THREE.Material {
  const key = goldTrim ? "gold" : "plain";
  if (!mireShadeMats[key]) {
    mireShadeMats[key] = goldTrim
      ? std(mats.leather.map, 0x5a4a28, { roughness: 0.7, metalness: 0.14, emissive: 0x3a4020, emissiveIntensity: 0.4 })
      : std(mats.leather.map, 0x3a3420, { roughness: 0.82, metalness: 0.06, emissive: 0x2a3010, emissiveIntensity: 0.3 });
  }
  return mireShadeMats[key]!;
}

/** Lust: TorusKnot on desktop; cheap Torus on compact. Gluttony: Torus rings. */
function makeShadeBody(mats: MatKit, scale: number, goldTrim: boolean, mire = false): THREE.Group {
  const g = new THREE.Group();
  const wraith = mire ? mireShadeMat(mats, goldTrim) : shadeMat(mats, goldTrim);
  const cheapPlume = mire || isCompactUi();
  const pts = [
    new THREE.Vector2(0.02, 0),
    new THREE.Vector2(0.22, 0.18),
    new THREE.Vector2(0.32, 0.55),
    new THREE.Vector2(0.24, 1.05),
    new THREE.Vector2(0.12, 1.55),
    new THREE.Vector2(0.04, 1.85),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, cheapPlume ? 10 : 12), wraith);
  body.position.y = 0.2;
  const hood = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, cheapPlume ? 10 : 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.72),
    goldTrim ? mats.gold : wraith
  );
  hood.position.set(0, 1.78, 0.04);
  hood.rotation.x = -0.35;
  const voidFace = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), mats.ember);
  voidFace.position.set(0, 1.68, -0.14);
  voidFace.name = "ember";
  const rib = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 14), goldTrim ? mats.gold : mire ? mats.mire : mats.bronze);
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
  const ribbon = new THREE.Mesh(
    cheapPlume
      ? new THREE.TorusGeometry(0.48, 0.045, 6, 16)
      : new THREE.TorusKnotGeometry(0.48, 0.04, 18, 5, 2, 3),
    mire ? mats.mire : mats.gale
  );
  ribbon.position.y = 0.95;
  ribbon.name = "ribbon";
  const ribbon2 = new THREE.Mesh(
    cheapPlume
      ? new THREE.TorusGeometry(0.62, 0.032, 5, 14)
      : new THREE.TorusKnotGeometry(0.62, 0.028, 14, 4, 2, 3),
    mire ? mats.mire : mats.gale
  );
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
  const g = makeShadeBody(mats, 1.72, true);
  g.name = "champion";
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.42, 6), mats.gold);
  crown.position.set(0, 2.15, 0);
  const plumeGeo = isCompactUi()
    ? new THREE.TorusGeometry(0.22, 0.032, 5, 12)
    : new THREE.TorusKnotGeometry(0.22, 0.03, 14, 5, 2, 3);
  const plume = new THREE.Mesh(plumeGeo, mats.gale);
  plume.position.set(0, 2.05, 0);
  plume.name = "ribbon";
  g.add(crown, plume);
  return g;
}

export function makeMireShade(mats: MatKit): THREE.Group {
  const g = makeShadeBody(mats, 1.12, false, true);
  g.name = "whirl";
  return g;
}

export function makeMireChampion(mats: MatKit): THREE.Group {
  const g = makeShadeBody(mats, 1.72, true, true);
  g.name = "champion";
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.48, 6), mats.gold);
  crown.position.set(0, 2.18, 0);
  const plume = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 5, 12), mats.mire);
  plume.position.set(0, 2.08, 0);
  plume.name = "ribbon";
  g.add(crown, plume);
  return g;
}

/** Mud wisp — low blob, twin ember eyes, olive halo (silhouette ≠ shade). */
export function makeMudWisp(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "whirl";
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 10, 8),
    std(null, 0x3a4020, { roughness: 0.55, metalness: 0.08, emissive: 0x4a5820, emissiveIntensity: 0.55 })
  );
  core.position.y = 0.55;
  core.scale.set(1.15, 0.85, 1.15);
  const drip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.42, 6), mats.moss);
  drip.position.set(0, 0.22, 0);
  drip.rotation.x = Math.PI;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), mats.ember);
  eyeL.position.set(-0.1, 0.62, -0.28);
  eyeL.name = "ember";
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.1;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 5, 14), mats.mire);
  halo.position.y = 0.55;
  halo.rotation.x = Math.PI / 2.2;
  halo.name = "ribbon";
  g.add(discShadow(mats, 0.35), core, drip, eyeL, eyeR, halo, nose(mats, 0.62, -0.32));
  g.scale.setScalar(0.95);
  shadow(g);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = false;
  });
  return g;
}

/** Mire warden — broad shield silhouette, no TorusKnot. */
export function makeMireWarden(mats: MatKit): THREE.Group {
  const g = makeShadeBody(mats, 1.35, true, true);
  g.name = "champion";
  const shield = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.95, 0.08),
    std(mats.armor.map, 0x5a5030, { roughness: 0.55, metalness: 0.35, emissive: 0x2a3010, emissiveIntensity: 0.25 })
  );
  shield.position.set(-0.55, 1.15, -0.15);
  shield.rotation.y = 0.35;
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mats.gold);
  boss.position.set(-0.55, 1.15, -0.22);
  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 5), mats.gold);
  crest.position.set(0, 2.2, 0.05);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 5, 16), mats.mire);
  ring.position.y = 0.95;
  ring.name = "ribbon";
  g.add(shield, boss, crest, ring);
  return g;
}

/** Cerbero — broader three-headed silhouette foreshadowing the Triple Maw. */
export function makeCerbero(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "champion";
  const hide = std(null, 0x4a3a28, { roughness: 0.8, metalness: 0.1, emissive: 0x2a3010, emissiveIntensity: 0.35 });
  const body = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.18, 0),
    new THREE.Vector2(0.82, 0.28),
    new THREE.Vector2(0.92, 0.95),
    new THREE.Vector2(0.55, 1.75),
    new THREE.Vector2(0.3, 2.15),
  ], 14), hide);
  // Stub legs for a grounded quadruped read at distance
  const legGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.7, 6);
  for (const [lx, lz] of [[-0.38, 0.28], [0.38, 0.28], [-0.32, -0.35], [0.32, -0.35]] as [number, number][]) {
    const leg = new THREE.Mesh(legGeo, hide);
    leg.position.set(lx, 0.35, lz);
    g.add(leg);
  }
  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), hide);
  shoulder.position.set(0, 1.85, 0.05);
  shoulder.scale.set(1.55, 0.55, 1.05);
  const mkHead = (ox: number, oy: number, oz: number, yaw: number, s: number) => {
    const h = new THREE.Group();
    h.position.set(ox, oy, oz);
    h.rotation.y = yaw;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24 * s, 10, 8), mats.bone);
    skull.scale.set(1, 0.9, 1.2);
    const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.15 * s, 0.34 * s, 6), mats.bronze);
    jaw.position.set(0, -0.15 * s, -0.2 * s);
    jaw.rotation.x = 1.8;
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035 * s, 6, 6), mats.ember);
    eyeL.position.set(-0.07 * s, 0.05 * s, -0.22 * s);
    eyeL.name = "ember";
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.07 * s;
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05 * s, 0.22 * s, 5), mats.bronze);
    ear.position.set(0, 0.22 * s, 0.02 * s);
    ear.rotation.x = -0.4;
    h.add(skull, jaw, eyeL, eyeR, ear);
    return h;
  };
  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 6, 18), mats.gold);
  sash.position.y = 1.45;
  sash.rotation.x = Math.PI / 2;
  const sludge = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.05, 5, 16), mats.mire);
  sludge.position.y = 0.95;
  sludge.name = "ribbon";
  // Cheap drip cones (static) for sludge read without particle cost
  for (const [dx, dy] of [[-0.35, 0.55], [0.4, 0.42], [0.05, 0.7]] as [number, number][]) {
    const drip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 5), mats.moss);
    drip.position.set(dx, dy, 0.45);
    drip.rotation.x = Math.PI;
    g.add(drip);
  }
  g.add(
    discShadow(mats, 0.95),
    body,
    shoulder,
    mkHead(0, 2.55, -0.15, 0, 1.2),
    mkHead(-0.62, 2.32, 0.1, 0.55, 0.98),
    mkHead(0.62, 2.32, 0.1, -0.55, 0.98),
    sash,
    sludge,
    nose(mats, 2.7, -0.38)
  );
  shadow(g);
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


/** Triple Maw — three-headed cerberine mass; telegraph ring + sludge tori (no TorusKnot). */
export function makeTripleMaw(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "triple_maw";
  const bodyPts = [
    new THREE.Vector2(0.28, 0),
    new THREE.Vector2(1.55, 0.4),
    new THREE.Vector2(1.65, 1.45),
    new THREE.Vector2(1.2, 2.55),
    new THREE.Vector2(0.78, 3.25),
  ];
  const hide = new THREE.MeshStandardMaterial({
    color: 0x4a3a28,
    roughness: 0.82,
    metalness: 0.12,
    emissive: 0x2a3010,
    emissiveIntensity: 0.32,
  });
  const body = new THREE.Mesh(new THREE.LatheGeometry(bodyPts, 14), hide);
  const neckBase = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), hide);
  neckBase.position.set(0, 3.05, 0.12);
  neckBase.scale.set(1.55, 0.65, 1.15);
  // Three thick neck stalks for readable silhouette at distance
  const stalkGeo = new THREE.CylinderGeometry(0.22, 0.32, 0.85, 8);
  const stalkC = new THREE.Mesh(stalkGeo, hide);
  stalkC.position.set(0, 3.55, -0.05);
  stalkC.rotation.x = 0.25;
  const stalkL = new THREE.Mesh(stalkGeo, hide);
  stalkL.position.set(-0.85, 3.35, 0.12);
  stalkL.rotation.z = 0.55;
  stalkL.rotation.x = 0.15;
  const stalkR = new THREE.Mesh(stalkGeo, hide);
  stalkR.position.set(0.85, 3.35, 0.12);
  stalkR.rotation.z = -0.55;
  stalkR.rotation.x = 0.15;

  const makeHead = (ox: number, oy: number, oz: number, yaw: number, s = 1) => {
    const head = new THREE.Group();
    head.name = "mawHead";
    head.position.set(ox, oy, oz);
    head.rotation.y = yaw;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.42 * s, 10, 8), mats.bone);
    skull.scale.set(1.1, 0.95, 1.25);
    const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.32 * s, 0.62 * s, 6), mats.bronze);
    jaw.name = "mawJaw";
    jaw.position.set(0, -0.32 * s, -0.36 * s);
    jaw.rotation.x = 1.85;
    const fangL = new THREE.Mesh(new THREE.ConeGeometry(0.055 * s, 0.26 * s, 5), mats.bone);
    fangL.position.set(-0.14 * s, -0.2 * s, -0.55 * s);
    fangL.rotation.x = 0.9;
    const fangR = fangL.clone();
    fangR.position.x = 0.14 * s;
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07 * s, 8, 8), mats.ember);
    eyeL.position.set(-0.15 * s, 0.1 * s, -0.38 * s);
    eyeL.name = "ember";
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.15 * s;
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08 * s, 0.62 * s, 6), mats.gold);
    horn.position.set(0, 0.48 * s, -0.05 * s);
    horn.rotation.x = -0.45;
    head.add(skull, jaw, fangL, fangR, eyeL, eyeR, horn);
    return head;
  };

  const headC = makeHead(0, 4.15, -0.22, 0, 1.12);
  const headL = makeHead(-1.15, 3.75, 0.18, 0.58, 1);
  const headR = makeHead(1.15, 3.75, 0.18, -0.58, 1);

  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.09, 5, 16), mats.gold);
  sash.position.y = 2.35;
  sash.rotation.x = Math.PI / 2;
  // Cheap sludge rings (readable telegraph, no TorusKnot)
  const sludge = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 5, 14), mats.mire);
  sludge.position.y = 1.55;
  sludge.rotation.x = Math.PI / 2.4;
  sludge.name = "ribbon";
  const sludge2 = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.055, 5, 12), mats.mire);
  sludge2.position.y = 1.15;
  sludge2.rotation.x = Math.PI / 2.1;
  sludge2.name = "ribbon2";
  const aura = new THREE.Mesh(
    new THREE.RingGeometry(2.05, 2.65, 20),
    new THREE.MeshBasicMaterial({
      color: 0xc8d858,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  aura.rotation.x = -Math.PI / 2;
  aura.position.y = 0.1;
  aura.name = "judgeAura";
  const telegraph = new THREE.Mesh(
    new THREE.RingGeometry(3.1, 3.35, 22),
    new THREE.MeshBasicMaterial({
      color: 0xa8b040,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  telegraph.rotation.x = -Math.PI / 2;
  telegraph.position.y = 0.06;
  telegraph.name = "mawTelegraph";
  const glow = new THREE.PointLight(0xaabb44, 5.2, 20, 1.5);
  glow.position.set(0, 3.4, 0.5);

  g.add(
    discShadow(mats, 1.7),
    body,
    neckBase,
    stalkC,
    stalkL,
    stalkR,
    headC,
    headL,
    headR,
    sash,
    sludge,
    sludge2,
    aura,
    telegraph,
    glow,
    nose(mats, 4.35, -0.6)
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
  const gem = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), mats.ember);
  gem.position.set(0, 0.72, 0.12);
  gem.name = "ember";
  g.add(discShadow(mats, 0.55), box, lid, band, gem, nose(mats, 0.55, -0.3));
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
  const quill = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.28, 5), mats.gold);
  quill.position.set(0.18, 1.22, 0.06);
  quill.rotation.z = -0.55;
  quill.rotation.x = -0.35;
  g.add(discShadow(mats, 0.4), post, top, book, quill, nose(mats, 1.1, -0.2));
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
  const seal = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), mats.ember);
  seal.position.set(0, 1.55, -0.12);
  seal.name = "ember";
  g.add(discShadow(mats, 0.35), pillar, cap, tablet, seal, nose(mats, 1.2, -0.18));
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
  const glow = new THREE.PointLight(0xff6633, 1.6, 8, 2);
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


/** Dim / brighten a portal group for require_clear lock state. */
export function setPortalGateVisual(root: THREE.Object3D, locked: boolean, openTint = 0xff6633) {
  root.userData.portalLocked = locked;
  const disc = root.getObjectByName("galeDisc") as THREE.Mesh | undefined;
  const ring = root.getObjectByName("galeRing") as THREE.Mesh | undefined;
  const sparks = root.getObjectByName("portalSparks") as THREE.Points | undefined;
  const apply = (m: THREE.Material | THREE.Material[] | undefined, fn: (mat: any) => void) => {
    if (!m) return;
    if (Array.isArray(m)) m.forEach(fn);
    else fn(m);
  };
  if (disc) {
    apply(disc.material, (mat) => {
      if (mat.color) mat.color.setHex(locked ? 0x3a3428 : openTint);
      if ("opacity" in mat) mat.opacity = locked ? 0.22 : 0.62;
    });
  }
  if (ring) {
    apply(ring.material, (mat) => {
      if (mat.color) mat.color.setHex(locked ? 0x2a2818 : openTint);
      if ("opacity" in mat) mat.opacity = locked ? 0.18 : 0.55;
    });
  }
  if (sparks) {
    apply(sparks.material, (mat) => {
      if (mat.color) mat.color.setHex(locked ? 0x5a5040 : 0xff8844);
      if ("opacity" in mat) mat.opacity = locked ? 0.25 : 0.85;
      if ("size" in mat) mat.size = locked ? 0.05 : 0.11;
    });
  }
  root.traverse((o) => {
    if ((o as THREE.PointLight).isPointLight) {
      const L = o as THREE.PointLight;
      L.intensity = locked ? 0.35 : 1.6;
      L.color.setHex(locked ? 0x6a6040 : openTint);
    }
  });
}

/** Shared olive tints — one clone per weight, not per mesh (avoids .clone() storms). */
const mireTintShared: {
  hideL?: THREE.MeshStandardMaterial;
  hideH?: THREE.MeshStandardMaterial;
  ribL?: THREE.MeshBasicMaterial;
  ribH?: THREE.MeshBasicMaterial;
} = {};

function mireSharedHide(heavy: boolean): THREE.MeshStandardMaterial {
  const key = heavy ? "hideH" : "hideL";
  if (!mireTintShared[key]) {
    mireTintShared[key] = new THREE.MeshStandardMaterial({
      color: heavy ? 0x5a4a28 : 0x3a3420,
      roughness: 0.8,
      metalness: 0.08,
      emissive: heavy ? 0x4a5020 : 0x2a3010,
      emissiveIntensity: heavy ? 0.42 : 0.3,
    });
  }
  return mireTintShared[key]!;
}

function mireSharedRibbon(mats: MatKit, heavy: boolean): THREE.MeshBasicMaterial {
  const key = heavy ? "ribH" : "ribL";
  if (!mireTintShared[key]) {
    const c = mats.mire.clone();
    c.color.setHex(heavy ? 0xb0c050 : 0x8a9a44);
    mireTintShared[key] = c;
  }
  return mireTintShared[key]!;
}

/** Olive-filth tint for leftover mire archetypes (prefer dedicated mire builders). */
export function tintMireEnemy(root: THREE.Object3D, mats: MatKit, heavy = false) {
  const hide = mireSharedHide(heavy);
  const rib = mireSharedRibbon(mats, heavy);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material & {
      color?: THREE.Color;
      isMeshStandardMaterial?: boolean;
    };
    if (!mat || !("color" in mat)) return;
    if (m.name === "ember") return;
    if (mat === (mats.gold as any) || mat === (mats.bone as any) || mat === (mats.ember as any)) return;
    if (mat === (mats.gale as any) || mat === (mats.mire as any) || m.name === "ribbon" || m.name === "ribbon2") {
      m.material = rib;
      return;
    }
    if (mat.isMeshStandardMaterial) m.material = hide;
  });
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
  g.add(discShadow(mats, 0.3), gem, ring, nose(mats, 0.55, -0.14));
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

  const nBr = 4 + ((rng() * 2) | 0);
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
    for (let t = 0; t < 2; t++) {
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
  const leafMesh = mergeMesh(leafGeos, canopyMat.clone(), false);
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
  g.add(discShadow(mats, 0.32), stem, bowl, flame);
  return g;
}

const _galePlaneCache = new Map<number, THREE.PlaneGeometry>();
function galePlaneGeo(len: number): THREE.PlaneGeometry {
  const key = Math.round(len * 10);
  let g = _galePlaneCache.get(key);
  if (!g) {
    g = new THREE.PlaneGeometry(len, 2.6, 1, 1);
    _galePlaneCache.set(key, g);
  }
  return g;
}

export function makeGaleRibbon(mats: MatKit, len = 8): THREE.Mesh {
  const mat = mats.gale.clone();
  mat.opacity = 0.8;
  const m = new THREE.Mesh(galePlaneGeo(len), mat);
  m.rotation.x = Math.PI * 0.16;
  m.position.y = 1.7;
  m.name = "galeRibbon";
  m.renderOrder = 2;
  m.frustumCulled = true;
  return m;
}

export function makeShrine(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "shrine";
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 2.4, 8), mats.stone);
  pillar.position.y = 1.2;
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), mats.gold);
  bowl.position.y = 2.45;
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), mats.ember);
  flame.position.y = 2.72;
  flame.name = "ember";
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.04, 6, 20),
    mats.gale
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  g.add(discShadow(mats, 0.55), pillar, bowl, flame, ring);
  shadow(g);
  return g;
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
  | "triple_maw"
  | "stash"
  | "ah"
  | "quest"
  | "shrine"
  | "pyre"
  | "portal"
  | "loot";


/** Filth Cache — chest with olive sludge band (Gluttony-readable vs Wind Cache). */
export function makeFilthCache(mats: MatKit): THREE.Group {
  const g = makeChest(mats);
  g.name = "filth_cache";
  const drip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 5), mats.mire);
  drip.position.set(0.28, 0.48, 0.22);
  drip.rotation.x = Math.PI;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.1, 0.08), mats.mire);
  band.position.set(0, 0.32, 0.28);
  g.add(drip, band);
  return g;
}

/** Mire Shrine — olive mend pillar (distinct from Lust Wind Shrine gale ring). */
export function makeMireShrine(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "mire_shrine";
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.2, 8), mats.stone);
  pillar.position.y = 1.1;
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), mats.mire);
  bowl.position.y = 2.3;
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 7), mats.ember);
  flame.position.y = 2.58;
  flame.name = "ember";
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.045, 5, 16), mats.mire);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  const drip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), mats.mire);
  drip.position.set(0.2, 2.05, 0.18);
  drip.rotation.x = 0.4;
  g.add(discShadow(mats, 0.55), pillar, bowl, flame, ring, drip);
  shadow(g);
  return g;
}

/** Mire Bell — squat toll post with hanging cone (readable vs shrine). */
export function makeMireBell(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "mire_bell";
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.05, 7), mats.stone);
  post.position.y = 1.05;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.1), mats.bronze);
  arm.position.set(0.25, 2.05, 0);
  const bell = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.48, 8), mats.gold);
  bell.position.set(0.48, 1.55, 0);
  bell.rotation.x = Math.PI;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.035, 5, 12), mats.mire);
  lip.position.set(0.48, 1.32, 0);
  lip.rotation.x = Math.PI / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 5, 14), mats.mire);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  g.add(discShadow(mats, 0.45), post, arm, bell, lip, ring);
  shadow(g);
  return g;
}

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
    case "triple_maw":
      return makeTripleMaw(mats);
    case "stash":
      return makeChest(mats);
    case "ah":
      return makeLectern(mats);
    case "quest":
      return makeWrit(mats);
    case "shrine":
      return makeShrine(mats);
    case "pyre":
      return makeBrazier(mats);
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
  id?: string;
  archetype?: string;
}): KindKey {
  if (ent.kind === "player") return "player";
  if (ent.kind === "boss") {
    const id = String(ent.id || "");
    const nm = String(ent.name || "");
    if (id.includes("triple_maw") || /triple maw/i.test(nm)) return "triple_maw";
    return "judge";
  }
  if (ent.kind === "loot") return "loot";
  if (ent.kind === "exit" || ent.poiKind === "portal") return "portal";
  if (ent.kind === "poi") {
    if (ent.poiKind === "stash" || ent.poiKind === "cache") return "stash";
    if (ent.poiKind === "ah") return "ah";
    if (ent.poiKind === "quest") return "quest";
    if (ent.poiKind === "shrine" || ent.poiKind === "bell") return "shrine";
    if (ent.poiKind === "pyre") return "pyre";
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
