/**
 * Procedural motion for mobs and bosses. The humanoid (wanderer rig) animation
 * lives in heroAnim.ts and is re-exported here for existing callers.
 */
import * as THREE from "three";

export { tickHumanoid } from "./heroAnim";

type MawCache = {
  ribbon?: THREE.Object3D;
  ribbon2?: THREE.Object3D;
  tele?: THREE.Object3D;
  heads: THREE.Object3D[];
  jaws: THREE.Object3D[];
};

/** Idle for Counterweight elite — roller spin + disc bob (Crush foreshadow). */
export function tickCounterweight(root: THREE.Object3D, tMs: number) {
  let cache = root.userData.cwCache as
    | { rollers: THREE.Object3D[]; discs: THREE.Object3D[]; body?: THREE.Object3D; ribbon?: THREE.Object3D }
    | undefined;
  if (!cache) {
    cache = { rollers: [], discs: [] };
    root.traverse((o) => {
      if (o.name === "crushRoller") cache!.rollers.push(o);
      else if (o.name === "weightDisc") cache!.discs.push(o);
      else if (o.name === "crushBody") cache!.body = o;
      else if (o.name === "ribbon") cache!.ribbon = o;
    });
    root.userData.cwCache = cache;
  }
  if (cache.body) {
    cache.body.position.y = 1.0 + Math.sin(tMs * 0.0024) * 0.04;
  }
  if (cache.ribbon) {
    cache.ribbon.rotation.z = tMs * 0.0014;
  }
  for (let i = 0; i < cache.rollers.length; i++) {
    const o = cache.rollers[i]!;
    o.rotation.x = tMs * (0.002 + i * 0.0005) * (i % 2 ? -1 : 1);
  }
  for (let i = 0; i < cache.discs.length; i++) {
    const o = cache.discs[i]!;
    o.rotation.z = tMs * 0.0016 * (i % 2 ? -1 : 1);
  }
}

export function tickWhirl(root: THREE.Object3D, tMs: number, champion: boolean) {
  const ribbon = root.getObjectByName("ribbon");
  if (ribbon) {
    ribbon.rotation.y = tMs * (champion ? 0.0045 : 0.0032);
    ribbon.rotation.x = Math.sin(tMs * 0.0015) * 0.25;
  }
  const ribbon2 = root.getObjectByName("ribbon2");
  if (ribbon2) {
    ribbon2.rotation.y = -tMs * 0.0026;
    ribbon2.rotation.z = Math.sin(tMs * 0.0011) * 0.2;
  }
  const bob = root.getObjectByName("ribbon");
  if (bob) bob.position.y = 0.95 + Math.sin(tMs * 0.0022) * 0.08;
  // Coin wisp: spin stacked discs for greed read (cheap; only when flagged)
  if (root.userData.coinWisp) {
    let discs = root.userData.coinDiscs as THREE.Object3D[] | undefined;
    if (!discs) {
      discs = [];
      root.traverse((o) => {
        if (o.name === "weightDisc") discs!.push(o);
      });
      root.userData.coinDiscs = discs;
    }
    for (let i = 0; i < discs.length; i++) {
      discs[i]!.rotation.z = tMs * (0.0022 + i * 0.0006) * (i % 2 ? -1 : 1);
    }
  }
}

/** Idle for Ledger Warden — tablet sway + plate pulse. */
export function tickLedgerWarden(root: THREE.Object3D, tMs: number) {
  tickWhirl(root, tMs, true);
  const tab = root.getObjectByName("ledgerTablet");
  if (tab) {
    tab.rotation.z = Math.sin(tMs * 0.0022) * 0.08;
    tab.position.y = 1.18 + Math.sin(tMs * 0.0018) * 0.03;
  }
}

/** Idle for Hoard Heart ward — disc spin + soft bob (measure tips). */
export function tickHoardHeart(root: THREE.Object3D, tMs: number) {
  let cache = root.userData.heartCache as
    | { discs: THREE.Object3D[]; ribbon?: THREE.Object3D; body?: THREE.Object3D; aura?: THREE.Object3D }
    | undefined;
  if (!cache) {
    cache = { discs: [] };
    root.traverse((o) => {
      if (o.name === "weightDisc") cache!.discs.push(o);
      else if (o.name === "ribbon") cache!.ribbon = o;
      else if (o.name === "crushBody") cache!.body = o;
      else if (o.name === "judgeAura") cache!.aura = o;
    });
    root.userData.heartCache = cache;
  }
  if (cache.body) cache.body.position.y = 0.98 + Math.sin(tMs * 0.002) * 0.03;
  if (cache.ribbon) cache.ribbon.rotation.z = tMs * 0.0012;
  if (cache.aura) {
    const s = 1 + Math.sin(tMs * 0.003) * 0.05;
    cache.aura.scale.set(s, s, 1);
  }
  for (let i = 0; i < cache.discs.length; i++) {
    cache.discs[i]!.rotation.z = tMs * 0.0018 * (i % 2 ? -1 : 1);
  }
}

/** Cheap Triple Maw idle: ribbon spin + staggered head/jaw hints (named mawHead / mawJaw). */
export function tickTripleMaw(root: THREE.Object3D, tMs: number) {
  let cache = root.userData.mawCache as MawCache | undefined;
  if (!cache) {
    cache = { heads: [], jaws: [] };
    root.traverse((o) => {
      if (o.name === "ribbon") cache!.ribbon = o;
      else if (o.name === "ribbon2") cache!.ribbon2 = o;
      else if (o.name === "mawTelegraph") cache!.tele = o;
      else if (o.name === "mawHead") cache!.heads.push(o);
      else if (o.name === "mawJaw") cache!.jaws.push(o);
    });
    root.userData.mawCache = cache;
  }
  if (cache.ribbon) {
    cache.ribbon.rotation.y = tMs * 0.0018;
    cache.ribbon.position.y = 1.55 + Math.sin(tMs * 0.002) * 0.05;
  }
  if (cache.ribbon2) {
    cache.ribbon2.rotation.y = -tMs * 0.0014;
    cache.ribbon2.position.y = 1.15 + Math.sin(tMs * 0.0017 + 1.2) * 0.04;
  }
  if (cache.tele) {
    const s = 1 + Math.sin(tMs * 0.0024) * 0.05;
    cache.tele.scale.set(s, s, 1);
    const mesh = cache.tele as { material?: { opacity?: number } };
    if (mesh.material && typeof mesh.material.opacity === "number") {
      mesh.material.opacity = 0.2 + Math.sin(tMs * 0.003) * 0.06;
    }
  }
  for (let hi = 0; hi < cache.heads.length; hi++) {
    const o = cache.heads[hi]!;
    const phase = hi * 1.7;
    if (o.userData.baseY == null) o.userData.baseY = o.position.y;
    o.rotation.x = Math.sin(tMs * 0.0016 + phase) * 0.07;
    o.position.y = o.userData.baseY + Math.sin(tMs * 0.0013 + phase) * 0.04;
  }
  for (let ji = 0; ji < cache.jaws.length; ji++) {
    const o = cache.jaws[ji]!;
    if (o.userData.jawPhase == null) o.userData.jawPhase = ji + 0.4;
    o.rotation.x = 1.85 + Math.sin(tMs * 0.0031 + o.userData.jawPhase) * 0.12;
  }
}


type CrushCache = {
  ribbon?: THREE.Object3D;
  ribbon2?: THREE.Object3D;
  tele?: THREE.Object3D;
  aura?: THREE.Object3D;
  body?: THREE.Object3D;
  rollers: THREE.Object3D[];
  discs: THREE.Object3D[];
  ironMat?: THREE.MeshStandardMaterial;
};

/** Idle for Hoard Crush — rollers, discs, ribbon bob, telegraph, emissive pulse (cached). */
export function tickHoardCrush(root: THREE.Object3D, tMs: number) {
  let cache = root.userData.crushCache as CrushCache | undefined;
  if (!cache) {
    cache = { rollers: [], discs: [] };
    root.traverse((o) => {
      if (o.name === "ribbon") cache!.ribbon = o;
      else if (o.name === "ribbon2") cache!.ribbon2 = o;
      else if (o.name === "mawTelegraph") cache!.tele = o;
      else if (o.name === "judgeAura") cache!.aura = o;
      else if (o.name === "crushBody") cache!.body = o;
      else if (o.name === "crushRoller") cache!.rollers.push(o);
      else if (o.name === "weightDisc") cache!.discs.push(o);
    });
    const bodyMesh = cache.body as THREE.Mesh | undefined;
    if (bodyMesh && bodyMesh.material && !Array.isArray(bodyMesh.material)) {
      cache.ironMat = bodyMesh.material as THREE.MeshStandardMaterial;
    }
    root.userData.crushCache = cache;
  }
  if (cache.ribbon) {
    cache.ribbon.rotation.z = tMs * 0.0016;
    cache.ribbon.position.y = 2.2 + Math.sin(tMs * 0.002) * 0.04;
  }
  if (cache.ribbon2) {
    cache.ribbon2.rotation.z = -tMs * 0.0012;
    cache.ribbon2.position.y = 1.4 + Math.sin(tMs * 0.0017 + 1.1) * 0.035;
  }
  if (cache.tele) {
    const s = 1 + Math.sin(tMs * 0.0024) * 0.05;
    cache.tele.scale.set(s, s, 1);
    const mesh = cache.tele as { material?: { opacity?: number } };
    if (mesh.material && typeof mesh.material.opacity === "number") {
      mesh.material.opacity = 0.2 + Math.sin(tMs * 0.003) * 0.06;
    }
  }
  if (cache.aura) {
    const s = 1 + Math.sin(tMs * 0.0031) * 0.04;
    cache.aura.scale.set(s, s, 1);
  }
  if (cache.ironMat) {
    cache.ironMat.emissiveIntensity = 0.34 + Math.sin(tMs * 0.0028) * 0.08;
  }
  if (cache.body) {
    cache.body.position.y = 1.55 + Math.sin(tMs * 0.0021) * 0.045;
  }
  for (let i = 0; i < cache.rollers.length; i++) {
    const o = cache.rollers[i]!;
    o.rotation.x = tMs * (0.0022 + i * 0.0004) * (i % 2 ? -1 : 1);
  }
  for (let i = 0; i < cache.discs.length; i++) {
    const o = cache.discs[i]!;
    o.rotation.z = tMs * 0.0018 * (i % 2 ? -1 : 1);
  }
}
