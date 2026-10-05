/**
 * Wrath (inferno_08) canto mechanic, client side — the Styx as the player sees it: a
 * black, glossy marsh with bone-gold glints and the sullen's bubbles rising beneath,
 * the wrathful shades caked in its mud, their fury flaring crimson when they enrage,
 * and Filippo Argenti on his landing. The authoritative half is
 * server/src/cantoMech/wrath.mjs (fury, Styx eruptions, Argenti's phases).
 *
 * «Tutti nudi e con sembiante offeso» — Inferno VII
 */
import * as THREE from "three";
import type { CantoMech } from "./index";
import type { WorldApp } from "../WorldApp";
import type { Objective } from "../objective";
import { makeMireChampion, makeMireHeart, makeMireShade, makeMudWisp } from "../meshes";
import { acquireFxRing, releaseFx, spawnSparks } from "../fx";
import { registerTelePalette, registerTeleWeight } from "../telegraphs";
import { markShared } from "../dispose";
import { isCompactUi, showToast } from "../../ui/hud";
import { STYX_HALF, STYX_PTS } from "../wrathStyx";

// Styx eruptions: silt-black floor, a muddy bronze fill, a bone rim (no gold: gold = go)
registerTelePalette("styx_eruption", { base: 0x0a0806, hot: 0x7a4a22, rim: 0xf0dcb0 });
registerTelePalette("argenti_lunge", { base: 0x1a0404, hot: 0xb02018, rim: 0xffd0b8 });
registerTeleWeight("styx_eruption", "champ");
registerTeleWeight("argenti_lunge", "boss");

const WRATH_RED = 0xc02818;
const FURY_HOT = 0xff5a30;
/** Fury building toward an enrage (2–3 stacks): a dull ember, not yet the crimson. */
const FURY_EMBER = 0xd2782a;

let crimsonMat: THREE.MeshBasicMaterial | null = null;
function wrathMats() {
  if (!crimsonMat) {
    crimsonMat = markShared(
      new THREE.MeshBasicMaterial({
        color: 0xa02414,
        transparent: true,
        opacity: 0.62,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
  }
  return { crimson: crimsonMat! };
}

const auraGeo = markShared(new THREE.RingGeometry(0.75, 1.15, 24).rotateX(-Math.PI / 2));

/** Mud-caked shade with crimson ribbons and a hidden fury ring at its feet. */
function wrathify(g: THREE.Group, scale = 1): THREE.Group {
  const { crimson } = wrathMats();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (o.name === "ribbon" || o.name === "ribbon2") m.material = crimson;
  });
  const aura = new THREE.Mesh(auraGeo, new THREE.MeshBasicMaterial({
    color: FURY_HOT,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  aura.name = "furyAura";
  aura.position.y = 0.06;
  aura.scale.setScalar(scale);
  aura.visible = false;
  aura.renderOrder = 3;
  g.add(aura);
  g.userData.wrath = true;
  return g;
}

/** Filippo Argenti: a towering mud-caked brawler, crimson-ribboned, a bone-gold crown. */
function makeArgenti(app: WorldApp): THREE.Group {
  const g = wrathify(makeMireChampion(app.mats!), 1.7);
  g.scale.setScalar(1.75);
  g.name = "champion";
  g.userData.argenti = true;
  return g;
}

type Glint = { m: THREE.Mesh; seg: number; u: number; speed: number; side: number };
type Bubble = { m: THREE.Mesh | null; t0: number; x: number; y: number };

/**
 * A ribbon following the Styx centreline between lateral offsets `a` and `b` (world
 * units, signed across the flow) at height `y`; uv.x runs along the river / `uvLen`.
 */
function styxStrip(step: number, a: number, b: number, y: number, uvLen: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let along = 0;
  let row = 0;
  for (let i = 0; i < STYX_PTS.length - 1; i++) {
    const [ax, ay] = STYX_PTS[i];
    const [bx, by] = STYX_PTS[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t;
      const z = ay + (by - ay) * t;
      // averaged normal at joints keeps the strip from pinching
      let dx = bx - ax;
      let dz = by - ay;
      if (k === n && i + 1 < STYX_PTS.length - 1) {
        dx += STYX_PTS[i + 2][0] - bx;
        dz += STYX_PTS[i + 2][1] - by;
      }
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l;
      const nz = dx / l;
      pos.push(x + nx * b, y, z + nz * b, x + nx * a, y, z + nz * a);
      uv.push(along / uvLen, 0, along / uvLen, 1);
      if (row > 0) {
        const q = (row - 1) * 2;
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
      row++;
      along += len / n;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  // flat ribbon: normals straight up (winding may point them down)
  const nrm = new Float32Array((pos.length / 3) * 3);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  return geo;
}

class WrathView {
  water: THREE.Mesh | null = null;
  waterMat: THREE.MeshStandardMaterial | null = null;
  bankMat: THREE.MeshBasicMaterial | null = null;
  banks: THREE.Mesh[] = [];
  glints: Glint[] = [];
  bubbles: Bubble[] = [];
  nextBubble = 0;
  toldFury = false;
  toldLantern = false;

  constructor(private app: WorldApp) {}

  enter() {
    const app = this.app;
    const compact = isCompactUi();
    // — the water sheet: a strip along the centreline, just over the sagged channel —
    const step = compact ? 3 : 2;
    const half = STYX_HALF + 0.4;
    // (lifted just over the rest height: the floor's ~4.6 u triangles bridge the sagged
    // channel, and a sheet under them vanished — feet now wade a hand's depth in it)
    const geo = styxStrip(step, -half, half, 0.05, 12);
    this.waterMat = new THREE.MeshStandardMaterial({
      color: 0x0b0a08,
      roughness: 0.22,
      metalness: 0.45,
      emissive: 0x140906,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.93,
      depthWrite: false,
    });
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.water.name = "styx";
    this.water.renderOrder = 1;
    this.water.receiveShadow = false;
    app.scene.add(this.water);
    // — the banks: a pale silt-foam lip on each side, so the river's edge (and the
    //   eruption band past it) reads at a glance on a phone —
    this.bankMat = new THREE.MeshBasicMaterial({
      color: 0xb09a72,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const sgn of [-1, 1]) {
      const a = sgn * (STYX_HALF - 0.15);
      const b = sgn * (STYX_HALF + 0.45);
      const m = new THREE.Mesh(styxStrip(step, Math.min(a, b), Math.max(a, b), 0.062, 6), this.bankMat);
      m.name = "styxBank";
      m.renderOrder = 2;
      app.scene.add(m);
      this.banks.push(m);
    }

    // — bone-gold glints drifting downstream —
    const nG = compact ? 10 : 22;
    const gGeo = new THREE.PlaneGeometry(0.9, 0.12).rotateX(-Math.PI / 2);
    const gMat = new THREE.MeshBasicMaterial({
      color: 0xe8cf98,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < nG; i++) {
      const m = new THREE.Mesh(gGeo, gMat);
      m.renderOrder = 2;
      app.scene.add(m);
      this.glints.push({
        m,
        seg: Math.floor(Math.random() * (STYX_PTS.length - 1)),
        u: Math.random(),
        speed: 0.6 + Math.random() * 0.9,
        side: (Math.random() * 2 - 1) * (STYX_HALF - 0.8),
      });
    }
    for (let i = 0; i < (compact ? 4 : 8); i++) this.bubbles.push({ m: null, t0: 0, x: 0, y: 0 });
    this.nextBubble = app.animT + 400;
  }

  exit() {
    const app = this.app;
    if (this.water) {
      app.scene.remove(this.water);
      this.water.geometry.dispose();
      this.waterMat?.dispose();
      this.water = null;
    }
    for (const b of this.banks) {
      app.scene.remove(b);
      b.geometry.dispose();
    }
    this.banks.length = 0;
    this.bankMat?.dispose();
    this.bankMat = null;
    if (this.glints.length) {
      const g0 = this.glints[0].m;
      for (const g of this.glints) app.scene.remove(g.m);
      g0.geometry.dispose();
      (g0.material as THREE.Material).dispose();
      this.glints.length = 0;
    }
    for (const b of this.bubbles) {
      if (b.m) {
        app.scene.remove(b.m);
        releaseFx(b.m);
        b.m = null;
      }
    }
    this.bubbles.length = 0;
  }

  tick(dt: number) {
    const app = this.app;
    const t = app.animT;
    if (this.waterMat) this.waterMat.emissiveIntensity = 0.3 + 0.08 * Math.sin(t * 0.0013);
    if (this.bankMat) this.bankMat.opacity = 0.19 + 0.05 * Math.sin(t * 0.0021);
    // glints
    for (const g of this.glints) {
      const [ax, ay] = STYX_PTS[g.seg];
      const [bx, by] = STYX_PTS[g.seg + 1];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      g.u += (g.speed * dt) / len;
      if (g.u >= 1) {
        g.u -= 1;
        g.seg = (g.seg + 1) % (STYX_PTS.length - 1);
      }
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      const x = ax + (bx - ax) * g.u + nx * g.side;
      const y = ay + (by - ay) * g.u + ny * g.side;
      g.m.position.set(x, 0.07, y);
      g.m.rotation.y = Math.atan2(-(by - ay), bx - ax);
      const tw = 0.5 + 0.5 * Math.sin(t * 0.004 + g.side * 3 + g.seg);
      g.m.scale.set(0.6 + tw * 0.8, 1, 1);
    }
    // the sullen gurgle: rings rising from the silt near you
    if (t > this.nextBubble) {
      this.nextBubble = t + 260 + Math.random() * 420;
      const slot = this.bubbles.find((b) => !b.m);
      if (slot) {
        const you = app.renderYou;
        // a random point on the river within ~18u of the pilgrim (else anywhere on it)
        for (let tries = 0; tries < 6; tries++) {
          const s = Math.floor(Math.random() * (STYX_PTS.length - 1));
          const u = Math.random();
          const [ax, ay] = STYX_PTS[s];
          const [bx, by] = STYX_PTS[s + 1];
          const x = ax + (bx - ax) * u + (Math.random() * 2 - 1) * (STYX_HALF - 1);
          const y = ay + (by - ay) * u + (Math.random() * 2 - 1) * (STYX_HALF - 1);
          if (tries < 5 && Math.hypot(x - you.x, y - you.y) > 18) continue;
          slot.m = acquireFxRing(0.12, 0.2, 16, 0xcab48a, 0.55);
          slot.m.position.set(x, 0.07, y);
          slot.t0 = t;
          slot.x = x;
          slot.y = y;
          app.scene.add(slot.m);
          break;
        }
      }
    }
    for (const b of this.bubbles) {
      if (!b.m) continue;
      const u = (t - b.t0) / 1100;
      if (u >= 1) {
        app.scene.remove(b.m);
        releaseFx(b.m);
        b.m = null;
        continue;
      }
      b.m.scale.setScalar(1 + u * 5);
      (b.m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - u);
    }
    // fury: enraged wrathful glow crimson at their feet and breathe
    const list = app.room?.entities;
    if (!list) return;
    for (const e of list) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      const rec = app.nodes.get(String(e.id));
      if (!rec || !rec.group.userData.wrath) continue;
      const aura = rec.group.getObjectByName("furyAura") as THREE.Mesh | undefined;
      if (!aura) continue;
      const alive = e.hp == null || e.hp > 0;
      const on = Boolean(e.enraged) && alive;
      // Fury building (2–3 of 4 stacks): a dimmer ember ring that quickens — stun or still it now
      const fury = alive && !on ? Number(e.fury) || 0 : 0;
      const building = fury >= 2;
      aura.visible = on || building;
      const mat = aura.material as THREE.MeshBasicMaterial;
      if (on) {
        const p = 0.5 + 0.5 * Math.sin(t * 0.012);
        mat.color.setHex(FURY_HOT);
        mat.opacity = 0.45 + 0.4 * p;
        aura.rotation.y = t * 0.002;
        aura.scale.setScalar(aura.userData.base ?? (aura.userData.base = aura.scale.x));
      } else if (building) {
        const p = 0.5 + 0.5 * Math.sin(t * (fury >= 3 ? 0.02 : 0.009));
        mat.color.setHex(FURY_EMBER);
        mat.opacity = (fury >= 3 ? 0.3 : 0.16) + (fury >= 3 ? 0.3 : 0.14) * p;
        const base = aura.userData.base ?? (aura.userData.base = aura.scale.x);
        aura.scale.setScalar(base * (fury >= 3 ? 0.9 : 0.78));
      }
    }
  }

  /** Argenti tears at himself (phase 2): a wide crimson burst where three shades rise. */
  onTear(msg: any) {
    const app = this.app;
    const x = Number(msg.x) || 0;
    const y = Number(msg.y) || 0;
    for (let i = 0; i < 2; i++) {
      const ring = acquireFxRing(0.4, 0.62, 36, i ? FURY_HOT : WRATH_RED, 0.9);
      ring.position.set(x, app.surfaceY(x, y, 0.1), y);
      app.scene.add(ring);
      app.impacts.push({ mesh: ring, start: app.animT + i * 140, dur: 760, from: 1, to: i ? 6 : 9 });
    }
    if (app.sparks.length < 6) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const sx = x + Math.cos(a) * 3.4;
        const sy = y + Math.sin(a) * 3.4;
        const b = spawnSparks(sx, sy, app.surfaceY(sx, sy, 0.6), WRATH_RED, app.animT);
        b.dur = 640;
        app.scene.add(b.points);
        app.sparks.push(b);
      }
    }
    const you = app.renderYou;
    if (Math.hypot(x - you.x, y - you.y) < 22) {
      app.kickShake(0.42);
      app.camPunch = Math.max(app.camPunch, 0.5);
      app.pvp?.sfx.enrage(true);
    }
  }


  /** Fury wiped (CC, decay after enrage, or Phlegyas' Lantern): a brief bone-gold still. */
  onCool(msg: any) {
    const app = this.app;
    const x = Number(msg.x) || 0;
    const y = Number(msg.y) || 0;
    const lantern = Boolean(msg.lantern);
    if (app.sparks.length < (isCompactUi() ? 2 : 4)) {
      const b = spawnSparks(x, y, app.surfaceY(x, y, 0.9), lantern ? 0xe8cf98 : 0xf0dcb0, app.animT);
      b.dur = lantern ? 560 : 420;
      app.scene.add(b.points);
      app.sparks.push(b);
    }
    const ring = acquireFxRing(0.28, 0.5, 24, lantern ? 0xe8cf98 : 0xc8b890, 0.75);
    ring.position.set(x, app.surfaceY(x, y, 0.08), y);
    app.scene.add(ring);
    app.impacts.push({ mesh: ring, start: app.animT, dur: 480, from: 1, to: lantern ? 4.2 : 3.2 });
    if (lantern && !this.toldLantern) {
      this.toldLantern = true;
      showToast("Phlegyas' Lantern stills their fury — the ember and the rage both fade in its light.", "info");
    }
  }

  onEnrage(msg: any) {
    const app = this.app;
    const x = Number(msg.x) || 0;
    const y = Number(msg.y) || 0;
    if (app.sparks.length < 4) {
      const b = spawnSparks(x, y, app.surfaceY(x, y, 1.2), FURY_HOT, app.animT);
      b.dur = 520;
      app.scene.add(b.points);
      app.sparks.push(b);
    }
    const ring = acquireFxRing(0.3, 0.55, 28, WRATH_RED, 0.85);
    ring.position.set(x, app.surfaceY(x, y, 0.08), y);
    app.scene.add(ring);
    app.impacts.push({ mesh: ring, start: app.animT, dur: 520, from: 1, to: msg.boss ? 7 : 4 });
    const you = app.renderYou;
    if (Math.hypot(x - you.x, y - you.y) < 16) {
      app.kickShake(msg.boss ? 0.35 : 0.12);
      app.pvp?.sfx.enrage(Boolean(msg.boss));
    }
    if (!this.toldFury && !msg.boss) {
      this.toldFury = true;
      showToast("The wrathful enrage when struck again and again — an ember ring warns first. Stun, root or still them to cool their fury.", "info");
    }
  }
}

let view: WrathView | null = null;

export const wrathMech: CantoMech = {
  enter(app) {
    view?.exit();
    view = new WrathView(app);
    view.enter();
  },
  exit() {
    view?.exit();
    view = null;
  },
  tick(_app, dt) {
    view?.tick(dt);
  },
  onMessage(_app, msg) {
    if (msg?.type === "wrath_fx") {
      if (msg.fx === "enrage") view?.onEnrage(msg);
      else if (msg.fx === "cool") view?.onCool(msg);
      else if (msg.fx === "tear") view?.onTear(msg);
      return true;
    }
    return false;
  },
  nodeMesh(app, e, kind) {
    const arch = String(e.archetype || "");
    if (e.kind === "boss") return makeArgenti(app);
    if (arch === "wrath_shade") return wrathify(makeMireShade(app.mats!));
    if (arch === "fury_champion") return wrathify(makeMireChampion(app.mats!), 1.2);
    if (arch === "sullen_wisp") return makeMudWisp(app.mats!);
    if (arch === "rage_heart") {
      const g = makeMireHeart(app.mats!);
      g.userData.wrath = false;
      return g;
    }
    void kind;
    return null;
  },
  objective(_app, obj: Objective) {
    if (obj.text.includes("Boss")) obj.text = obj.text.replace("Boss", "Filippo Argenti");
  },
};
