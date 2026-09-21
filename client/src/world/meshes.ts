/**
 * Hand-built bronze-statue meshes. Local forward is −z, feet on y=0.
 * A child named "nose" sits on the face so heading can be measured independently
 * of the mount (threejs-frame-conventions Rule 3 / 4).
 */
import * as THREE from "three";
import type { MatKit } from "./materials";

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

/** Hooded pilgrim — pale bone cloak, gold trim, readable upright silhouette. −z face. */
export function makeWanderer(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "wanderer";
  const cloakM = lambert(0xf3e6c4, 0x4a3c22, 0.22);
  const hoodM = lambert(0xe8d7a8, 0x3a2c14, 0.18);
  const skinM = lambert(0xf0d8bc, 0x5a4030, 0.12);
  const goldM = lambert(0xffe27a, 0xc9a227, 0.7);
  const bootM = lambert(0x5a4630);
  const steelM = lambert(0xe8dcc0, 0x8a7a50, 0.25);

  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.32), bootM);
  bootL.position.set(-0.13, 0.08, 0.04);
  const bootR = bootL.clone();
  bootR.position.x = 0.13;
  const shinL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.52, 8), cloakM);
  shinL.position.set(-0.13, 0.38, 0);
  const shinR = shinL.clone();
  shinR.position.x = 0.13;

  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), cloakM);
  hips.position.y = 0.82;
  hips.scale.set(1.05, 0.7, 0.85);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.62, 12), cloakM);
  torso.position.y = 1.22;

  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 8, 20), goldM);
  sash.position.y = 0.98;
  sash.rotation.x = Math.PI / 2;

  const cloak = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.18, 0),
        new THREE.Vector2(0.42, 0.15),
        new THREE.Vector2(0.5, 0.55),
        new THREE.Vector2(0.38, 1.05),
        new THREE.Vector2(0.22, 1.28),
      ],
      18
    ),
    cloakM
  );
  cloak.position.set(0, 0.35, 0.08);
  cloak.rotation.x = 0.12;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), skinM);
  head.position.set(0, 1.68, 0.02);
  const hood = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
    hoodM
  );
  hood.position.set(0, 1.78, 0.04);
  hood.rotation.x = -0.55;

  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.58, 8), cloakM);
  armL.position.set(-0.34, 1.2, 0.02);
  armL.rotation.z = 0.28;
  const armR = armL.clone();
  armR.position.x = 0.34;
  armR.rotation.z = -0.55;

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.85, 0.1), steelM);
  blade.position.set(0.52, 0.62, -0.06);
  blade.rotation.z = 0.18;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.045, 0.09), goldM);
  guard.position.set(0.48, 1.02, -0.05);
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), goldM);
  lantern.position.set(-0.38, 0.95, 0.12);
  lantern.name = "ember";

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.38, 0.5, 24),
    new THREE.MeshBasicMaterial({
      color: 0xe8c86a,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;

  g.add(
    ring,
    bootL,
    bootR,
    shinL,
    shinR,
    hips,
    cloak,
    torso,
    sash,
    head,
    hood,
    armL,
    armR,
    blade,
    guard,
    lantern,
    nose(mats, 1.66, -0.15)
  );
  shadow(g);
  return g;
}

/** Cloaked guide with lantern staff. */
export function makeGuide(mats: MatKit): THREE.Group {
  const g = makeWanderer(mats);
  g.name = "guide";
  g.scale.setScalar(1.12);
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 2.4, 8), mats.bronze);
  staff.position.set(-0.42, 1.2, 0.1);
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.18), mats.gold);
  lantern.position.set(-0.42, 2.28, 0.1);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), mats.ember);
  flame.position.set(-0.42, 2.28, 0.1);
  flame.name = "ember";
  g.add(staff, lantern, flame);
  return g;
}

function makeShadeBody(mats: MatKit, scale: number, goldTrim: boolean): THREE.Group {
  const g = new THREE.Group();
  const pts = [
    new THREE.Vector2(0.02, 0),
    new THREE.Vector2(0.28, 0.25),
    new THREE.Vector2(0.38, 0.7),
    new THREE.Vector2(0.22, 1.15),
    new THREE.Vector2(0.08, 1.45),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), mats.cloth);
  body.position.y = 0.15;
  const hood = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.7),
    goldTrim ? mats.gold : mats.bronze
  );
  hood.position.set(0, 1.42, 0);
  hood.rotation.x = 0.4;
  const voidFace = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mats.ember);
  voidFace.position.set(0, 1.32, -0.12);
  const ribbon = new THREE.Mesh(new THREE.TorusKnotGeometry(0.42, 0.045, 80, 8, 2, 3), mats.gale);
  ribbon.position.y = 0.85;
  ribbon.name = "ribbon";
  g.add(discShadow(mats, 0.5), body, hood, voidFace, ribbon, nose(mats, 1.32, -0.22));
  g.scale.setScalar(scale);
  shadow(g);
  return g;
}

export function makeWhirlShade(mats: MatKit): THREE.Group {
  const g = makeShadeBody(mats, 1, false);
  g.name = "whirl";
  return g;
}

export function makeChampion(mats: MatKit): THREE.Group {
  const g = makeShadeBody(mats, 1.28, true);
  g.name = "champion";
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 6), mats.gold);
  crown.position.set(0, 1.85, 0);
  g.add(crown);
  return g;
}

/** Judge of the Gate — tall robed figure, coiled tail, horned crown. */
export function makeJudge(mats: MatKit): THREE.Group {
  const g = new THREE.Group();
  g.name = "judge";
  const robePts = [
    new THREE.Vector2(0.2, 0),
    new THREE.Vector2(0.95, 0.4),
    new THREE.Vector2(1.05, 1.6),
    new THREE.Vector2(0.7, 2.6),
    new THREE.Vector2(0.45, 3.2),
  ];
  const robe = new THREE.Mesh(new THREE.LatheGeometry(robePts, 24), mats.cloth);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.5, 1.1, 12), mats.bronze);
  torso.position.y = 3.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 12), mats.bone);
  head.position.set(0, 3.9, 0.05);
  const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.7, 6), mats.gold);
  hornL.position.set(-0.22, 4.28, -0.05);
  hornL.rotation.z = 0.45;
  hornL.rotation.x = -0.2;
  const hornR = hornL.clone();
  hornR.position.x = 0.22;
  hornR.rotation.z = -0.45;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), mats.ember);
  eyeL.position.set(-0.1, 3.94, -0.26);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.1;

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.2, 0.2, 0.4),
    new THREE.Vector3(0.9, 0.4, 0.2),
    new THREE.Vector3(1.3, 1.1, -0.3),
    new THREE.Vector3(0.7, 1.8, -0.8),
    new THREE.Vector3(-0.2, 2.2, -0.5),
    new THREE.Vector3(-0.6, 1.4, 0.2),
  ]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.16, 8, false), mats.bronze);
  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.06, 8, 24), mats.gold);
  sash.position.y = 2.55;
  sash.rotation.x = Math.PI / 2;

  g.add(
    discShadow(mats, 1.1),
    robe,
    torso,
    head,
    hornL,
    hornR,
    eyeL,
    eyeR,
    tail,
    sash,
    nose(mats, 3.9, -0.3)
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
  const colL = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.2, 10), mats.stone);
  colL.position.set(-1.05, 1.6, 0);
  const colR = colL.clone();
  colR.position.x = 1.05;
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.16, 10, 24, Math.PI), mats.stone);
  arch.position.y = 3.15;
  arch.rotation.z = Math.PI;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), mats.gale);
  disc.position.set(0, 1.85, 0);
  disc.name = "galeDisc";
  const trim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.045, 8, 24), mats.gold);
  trim.position.y = 1.85;
  g.add(discShadow(mats, 1.3), colL, colR, arch, disc, trim, nose(mats, 1.8, -0.2));
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
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), mat);
  gem.position.y = 0.38;
  gem.name = "gem";
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 8, 16), mats.gold);
  ring.position.y = 0.22;
  ring.rotation.x = Math.PI / 2;
  g.add(discShadow(mats, 0.22), gem, ring, nose(mats, 0.4, -0.12));
  return g;
}

export function makeTree(mats: MatKit, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "tree";
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const h = 5.5 + rng() * 5.5;
  const lean = (rng() - 0.5) * 0.35;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 + rng() * 0.1, 0.28 + rng() * 0.18, h, 7),
    mats.bark
  );
  trunk.position.y = h / 2;
  trunk.rotation.z = lean;
  g.add(trunk);
  const canopyMat = mats.cloth.clone();
  canopyMat.color.setHex(0x3a4638);
  for (let i = 0; i < 3; i++) {
    const s = 0.9 + rng() * 1.1;
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), canopyMat);
    ball.position.set((rng() - 0.5) * 1.2, h - 0.4 + rng() * 0.8, (rng() - 0.5) * 1.2);
    g.add(ball);
  }
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

export function makeSlashArc(mats: MatKit): THREE.Mesh {
  const geo = new THREE.TorusGeometry(0.7, 0.035, 6, 16, Math.PI * 0.9);
  const m = new THREE.Mesh(geo, mats.gold);
  m.rotation.x = Math.PI / 2;
  m.rotation.z = 0.4;
  return m;
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
