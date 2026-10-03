/**
 * Gluttony (inferno_06) canto mechanic, client side — the Mire. The authoritative half
 * (rules, numbers, wire) is server/src/cantoMech/gluttony.mjs; this module is the feel
 * and the look:
 *   - move feel: wading at the mire's pace off the causeway (gluttonyMire.ts, the same
 *     geometry the server budgets with) and a shorter dash there;
 *   - rain (gluttonyRain.ts) that thickens when the Maw gapes; hailstones dropping onto
 *     the hail telegraphs; mud ripples under your steps, bubbling buried mounds, shades
 *     tearing out of the mud (gluttonyFx.ts);
 *   - the Maw's three heads (and Cerbero's one) rearing through their own bites, choked
 *     with mire when a clod lands; the clod in your fist and in the air, and the heaps
 *     by the dais (one instanced draw — their POI nodes are empty props);
 *   - the throw: an attack press with mire in hand, sent on the server's blade clock
 *     (a packet inside its swing cooldown would be dropped) with combo THROW_COMBO;
 *   - the objective line for the Gluttony chain and the right hint at the right moment.
 * Nothing here allocates per frame: pools are built in enter() and freed in exit().
 */
import * as THREE from "three";
import type { CantoMech, MoveFeelOut } from "./index";
import type { WorldApp } from "../WorldApp";
import type { Objective } from "../objective";
import { GluttonyRain, type RainTier } from "../gluttonyRain";
import { BuriedMounds, ClodHeaps, Clods, Hailstones, MudRipples } from "../gluttonyFx";
import { adoptMire, mireDashAt, mireDepthAt, mireMulAt } from "../gluttonyMire";
import { mobAttack, registerAttackPose, type MobState, type Pose } from "../mobAnim";
import { registerTelePalette, visibleWindupMs } from "../telegraphs";
import { makeFango, makeMireHeart, registerPropPoi, resolveKind } from "../meshes";
import { SWING_CONTACT_MS, SWING_MS } from "../heroMotor";
import { isCompactUi } from "../../ui/hud";

/** Server HEAD_OFF: head i's cone sits this far (planar rad) off the Maw's facing. */
const HEAD_OFF = [-0.8, 0, 0.8];
const BITE_KIND = ["maw_bite_l", "maw_bite_c", "maw_bite_r"];
/** How far a throw reaches (server CLOD.range, a little inside it). */
const THROW_REACH = 10.5;
/** Server THROW_COMBO: the attack packet's combo value that throws (swings are 0–2). */
const THROW_COMBO = 3;
/** Server PLAYER_ATK_CD (ms): a throw rides the blade's cooldown like any attack packet. */
const ATK_CD_MS = 420;
/** Server CLOD.heaveMs: a throw plants your feet this long (predicted here). */
const HEAVE_MS = 300;
/** A queued throw that couldn't go in this long (ms) is let go (the moment passed). */
const THROW_QUEUE_MS = 900;
/** Clod heaps drawn (content has six). */
const HEAP_CAP = 10;
/** Rise → hide the body under the mud by its height (× this). */
const RISE_SINK = 1.04;

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) * (1 - t));

type HeadAnim = { start: number; dur: number; silUntil: number };
type HeadRig = {
  necks: (THREE.Object3D | null)[];
  gapes: (THREE.Object3D | null)[];
  eyes: THREE.Mesh[][];
  plugs: (THREE.Object3D | null)[];
  eyeLit: THREE.Material | null;
  eyeDim: THREE.Material | null;
  choked: boolean[];
};

const S = {
  on: false,
  compact: false,
  rain: null as GluttonyRain | null,
  ripples: null as MudRipples | null,
  hail: null as Hailstones | null,
  mounds: null as BuriedMounds | null,
  clods: null as Clods | null,
  heaps: null as ClodHeaps | null,
  /** a hidden Fango: its body's program is built with the arrival prewarm, not in phase 2 */
  fangoWarm: null as THREE.Group | null,
  heapsSet: false,
  heapX: new Float32Array(HEAP_CAP),
  heapY: new Float32Array(HEAP_CAP),
  heapZ: new Float32Array(HEAP_CAP),
  /** the ripple / hail meshes draw only while something lives in them */
  ripplesUntil: 0,
  hailUntil: 0,
  carry: false,
  throwAt: -1e9,
  /** a throw pressed, waiting for the server's blade clock (Date.now ms it was pressed) */
  throwQueued: false,
  throwQueuedAt: 0,
  /** Date.now ms the last throw packet left */
  throwSentAt: -1e12,
  bb: 0,
  moundsSet: false,
  bubbleAt: new Float32Array(31),
  moundTick: 0,
  /** entity id → rise (ms clock, duration) until its node exists */
  rising: new Map<string, { at: number; dur: number }>(),
  /** entity id → per-head bite / choke animation */
  heads: new Map<string, HeadAnim[]>(),
  rigs: new WeakMap<THREE.Object3D, HeadRig>(),
  cerbId: "",
  heartId: "",
  heartSack: null as THREE.Object3D | null,
  mawPhase: 1,
  wasMire: false,
  stepAcc: 0,
  wasRooted: false,
  /** our own heave's root (performance ms): not the mire seizing you */
  heaveUntil: 0,
  // hints (objective sub line)
  mireTipUntil: 0,
  mireTips: 0,
  moundTipUntil: 0,
  moundTips: 0,
  hailTipUntil: 0,
  hailTips: 0,
  crownTipUntil: 0,
  crownTips: 0,
  seizedUntil: 0,
  sinkUntil: 0,
  sinkTips: 0,
  snatchUntil: 0,
  snatchTips: 0,
  sinkShort: false,
  /** phase 2's first fans: say how to live through them */
  fanTipUntil: 0,
  fanTips: 0,
  sinkX: 0,
  sinkY: 0,
  sinkBubbleAt: 0,
  // saved look to restore on exit
  groundRough: 0.72,
  groundMetal: 0.14,
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
let APP: WorldApp | null = null;

// ——— telegraph colours + poses (registered once) ——————————————————————————

let registered = false;
/** Per MobState: the attack start whose facing we already corrected. */
const fixedAt = new WeakMap<MobState, number>();
const fixedKind = new WeakMap<MobState, string>();

function strikeK(r: number): number {
  return r <= 0 ? 0 : r < 0.32 ? easeOut(r / 0.32) : 1 - ease((r - 0.32) / 0.68);
}

/** A Maw bite telegraph points along its head's cone: the body faces the Maw's heading. */
function fixMawFacing(st: MobState, head: number) {
  // (phase 2 opens all three jaws in one tick: the start alone can repeat)
  if (fixedAt.get(st) === st.atkStart && fixedKind.get(st) === st.atkKind) return;
  fixedAt.set(st, st.atkStart);
  fixedKind.set(st, st.atkKind);
  st.atkDir -= HEAD_OFF[head]!;
}

function registerOnce() {
  if (registered) return;
  registered = true;
  // clod heaps are drawn instanced here; their nodes only carry the label + interaction
  registerPropPoi("clod");
  // hail: pale ice; the mire's grab: dark mud with a tan lip; bites: bone-red jaws
  registerTelePalette("hail", { base: 0x0a1622, hot: 0x7fa6c8, rim: 0xeef6ff });
  registerTelePalette("mire_grab", { base: 0x120e04, hot: 0x8a7428, rim: 0xf0d890 });
  // (the sink sits right on your own footing ring: livid violet, never the hero's gold)
  registerTelePalette("mire_sink", { base: 0x0c0414, hot: 0x6a2c9a, rim: 0xe0a8ff });
  registerTelePalette("fango_burst", { base: 0x0c1004, hot: 0x6a8a18, rim: 0xd8f070 });
  const bite = { base: 0x1c0604, hot: 0xc8401c, rim: 0xffd0a0 };
  for (const k of BITE_KIND) registerTelePalette(k, bite);
  registerTelePalette("cerbero_bite", bite);

  // A buried shade tears out of the mud: it rises through its grab windup, arms up out of
  // the muck, then claws down onto the ankles as the grab lands.
  registerAttackPose("mire_grab", (u: number, r: number, st: MobState, out: Pose) => {
    const up = r > 0 ? 1 : easeOut(Math.min(1, u * 1.15));
    out.y = -(1 - up) * st.height * RISE_SINK;
    out.sy = 0.8 + 0.2 * up;
    const s = strikeK(r);
    out.rx = (1 - up) * 0.35 + (r > 0 ? -0.42 * s : 0.1 * u);
    out.fz = 0.25 * s;
    if (st.armL && st.armR) {
      const reach = r > 0 ? 1 - s : ease(u);
      out.aLx = -2.7 * reach + 1.1 * s;
      out.aRx = -2.7 * reach + 1.1 * s;
      out.aLz = -0.45 * reach;
      out.aRz = 0.45 * reach;
    }
  });
  for (let i = 0; i < 3; i++) {
    const head = i;
    registerAttackPose(BITE_KIND[i]!, (u: number, r: number, st: MobState, out: Pose) => {
      fixMawFacing(st, head);
      const w = r > 0 ? Math.max(0, 1 - r / 0.2) : ease(u);
      const s = strikeK(r);
      // the bulk leans toward the biting head and heaves into the snap
      out.rz = (head - 1) * 0.07 * (w + s);
      out.rx = 0.05 * w - 0.1 * s;
      out.y = 0.08 * w - 0.04 * s;
    });
  }
  registerAttackPose("cerbero_bite", (u: number, r: number, _st: MobState, out: Pose) => {
    const w = r > 0 ? Math.max(0, 1 - r / 0.2) : ease(u);
    const s = strikeK(r);
    out.rx = 0.16 * w - 0.3 * s;
    out.fz = -0.12 * w + 0.45 * s;
    out.y = 0.06 * w;
  });
}

// ——— helpers ————————————————————————————————————————————————————————————————

function nowSec(): number {
  return performance.now() / 1000;
}

function ripple(x: number, y: number, radius: number, dur: number, alpha: number, mix = 0, delay = 0) {
  const app = APP;
  if (!S.ripples || !app) return;
  const t = nowSec() + delay;
  S.ripples.spawn(x, app.surfaceY(x, y), y, t, radius, dur, alpha, mix);
  S.ripplesUntil = Math.max(S.ripplesUntil, t + dur);
  S.ripples.mesh.visible = true;
}

function entityById(app: WorldApp, id: string): any {
  const list = app.room?.entities;
  if (!list) return null;
  for (let i = 0; i < list.length; i++) if (String(list[i].id) === id) return list[i];
  return null;
}

function headRig(root: THREE.Object3D, maw: boolean, mats: WorldApp["mats"]): HeadRig {
  let rig = S.rigs.get(root);
  if (rig) return rig;
  const n = maw ? 3 : 1;
  rig = { necks: [], gapes: [], eyes: [], plugs: [], eyeLit: null, eyeDim: mats?.moss ?? null, choked: [] };
  for (let i = 0; i < n; i++) {
    rig.necks.push(root.getObjectByName(maw ? `mawNeck${i}` : "cerbNeck") ?? null);
    rig.gapes.push(root.getObjectByName(maw ? `mawGape${i}` : "cerbGape") ?? null);
    rig.plugs.push(root.getObjectByName(maw ? `mawPlug${i}` : "cerbPlug") ?? null);
    rig.eyes.push([]);
    rig.choked.push(false);
  }
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (let i = 0; i < n; i++) {
      if (o.name === (maw ? `mawEye${i}` : "cerbEye")) {
        rig!.eyes[i]!.push(m);
        if (!rig!.eyeLit) rig!.eyeLit = m.material as THREE.Material;
      }
    }
  });
  S.rigs.set(root, rig);
  return rig;
}

function headsOf(id: string, n: number): HeadAnim[] {
  let h = S.heads.get(id);
  if (!h) {
    h = [];
    for (let i = 0; i < n; i++) h.push({ start: -1e9, dur: 1, silUntil: -1e9 });
    S.heads.set(id, h);
  }
  return h;
}

/** Pose a biter's heads: rear and gape through the windup, snap, recover; choked droop. */
function poseHeads(app: WorldApp, id: string, maw: boolean, nowMs: number, windupLeft: number) {
  const rec = app.nodes.get(id);
  if (!rec) return;
  const n = maw ? 3 : 1;
  const rig = headRig(rec.group, maw, app.mats);
  const anim = headsOf(id, n);
  const t = nowMs * 0.001;
  let anyBite = false;
  for (let i = 0; i < n; i++) if (nowMs - anim[i]!.start < anim[i]!.dur + 420) anyBite = true;
  for (let i = 0; i < n; i++) {
    const a = anim[i]!;
    const neck = rig.necks[i];
    const gape = rig.gapes[i];
    let pitch = Math.sin(t * 1.3 + i * 1.9) * 0.05;
    let open = -0.08 - Math.max(0, Math.sin(t * 2.6 + i * 1.3)) * 0.12;
    const choked = nowMs < a.silUntil;
    if (choked) {
      // a throat full of mire: head sags, jaw propped on the plug, eyes dark
      const k = Math.min(1, (nowMs - (a.silUntil - 5000)) / 260);
      pitch = -0.42 * k + Math.sin(t * 5.5 + i) * 0.03 * k;
      open = -0.32 * k;
    } else {
      const e = nowMs - a.start;
      if (e >= 0 && e < a.dur) {
        const u = e / a.dur;
        // rear back (snout up), jaw gaping wider and wider — the moment to throw
        pitch = 0.62 * ease(u);
        open = -0.12 - 0.95 * ease(u) - Math.sin(t * 38) * 0.04 * u;
      } else if (e >= a.dur && e < a.dur + 420) {
        const r = (e - a.dur) / 420;
        const s = strikeK(r);
        pitch = 0.62 * (1 - easeOut(Math.min(1, r * 3.2))) - 0.5 * s;
        open = -1.07 * (1 - easeOut(Math.min(1, r * 4))) + 0.06 * s;
      } else if (!anyBite && windupLeft > 0.05) {
        // the gorge slam: every jaw gapes as the bulk rears
        const k = Math.min(1, 1.3 - windupLeft);
        open = -0.2 - 0.6 * Math.max(0, k);
        pitch = 0.25 * Math.max(0, k);
      }
    }
    if (neck) neck.rotation.x = pitch;
    if (gape) gape.rotation.x = open;
    if (choked !== rig.choked[i]) {
      rig.choked[i] = choked;
      const plug = rig.plugs[i];
      if (plug) plug.visible = choked;
      const mat = choked ? rig.eyeDim : rig.eyeLit;
      if (mat) for (const eye of rig.eyes[i]!) eye.material = mat;
    }
  }
}

/** The rising shade's node exists (or is built now) and plays its rise on the grab's clock. */
function startRise(app: WorldApp, id: string, r: { at: number; dur: number }) {
  const e = entityById(app, id);
  if (!e) return false;
  let rec = app.nodes.get(id);
  if (!rec) rec = app.spawnNode(id, resolveKind(e), e);
  const st = rec.group.userData.mob as MobState | undefined;
  if (st) {
    const you = app.renderYou;
    mobAttack(st, "mire_grab", Math.atan2(you.y - e.y, you.x - e.x), r.dur, r.at);
  }
  return true;
}

function hailLand(x: number, y: number, z: number) {
  if (!S.ripples) return;
  S.ripples.spawn(x, y, z, nowSec(), 0.9, 0.5, 0.9, 1);
  S.ripplesUntil = Math.max(S.ripplesUntil, nowSec() + 0.5);
  S.ripples.mesh.visible = true;
}

function clodAim(tid: string, out: THREE.Vector3): boolean {
  const app = APP;
  if (!app) return false;
  const rec = app.nodes.get(tid);
  if (!rec) return false;
  const p = rec.group.position;
  const isMaw = rec.kind === "triple_maw";
  const isCerb = tid === S.cerbId;
  out.set(p.x, p.y + (isMaw ? 3.9 : isCerb ? 2.6 : 1.3), p.z);
  return true;
}

function clodLand(x: number, y: number, z: number) {
  const app = APP;
  if (!app) return;
  app.combat?.ash.spawn(x, y, z, 0x4a4222, performance.now(), 0.7, 520, 0.6);
  if (S.ripples) {
    // a clod that falls short slaps the mud
    const gy = app.surfaceY(x, z);
    if (y - gy < 0.8) ripple(x, z, 1.4, 0.7, 0.8);
  }
}

/**
 * When (Date.now ms) the server takes our next attack packet: PLAYER_ATK_CD after the
 * last one (a swing's leaves at its blade contact, a throw when thrown). A swing whose
 * contact is still to come waits for it (its packet would land inside the throw's
 * cooldown and be dropped).
 */
function bladeReadyAt(app: WorldApp): number {
  const u = app.heroMotor ? app.heroMotor.swingU() : -1;
  if (u >= 0 && u < SWING_CONTACT_MS / SWING_MS) return Infinity;
  return Math.max(app.socket.lastAttackAt || 0, S.throwSentAt) + ATK_CD_MS;
}

/** The foe a throw goes to: the one you locked, else a biter, else the nearest in reach. */
function throwTarget(app: WorldApp): any {
  const room = app.room;
  if (!room) return null;
  const you = app.renderYou;
  if (app.lockedId) {
    const e = entityById(app, app.lockedId);
    if (e && (e.hp == null || e.hp > 0)) {
      const p = app.entityRenderPos(e);
      if (Math.hypot(p.x - you.x, p.y - you.y) <= THROW_REACH) return e;
    }
  }
  let target: any = null;
  let best = THROW_REACH;
  for (const e of room.entities) {
    if ((e.kind !== "mob" && e.kind !== "boss") || !(e.hp > 0)) continue;
    const p = app.entityRenderPos(e);
    let d = Math.hypot(p.x - you.x, p.y - you.y);
    if (d > THROW_REACH) continue;
    if (e.id === "triple_maw" || String(e.id) === S.cerbId) d -= 100;
    if (d < best) {
      best = d;
      target = e;
    }
  }
  return target;
}

/** Throw the queued clod once the server's blade clock allows (called per frame). */
function fireQueuedThrow(app: WorldApp) {
  if (!S.carry || Date.now() - S.throwQueuedAt > THROW_QUEUE_MS) {
    S.throwQueued = false;
    return;
  }
  if (Date.now() < bladeReadyAt(app) || (app.heroMotor && !app.heroMotor.canDash())) return;
  S.throwQueued = false;
  const target = throwTarget(app);
  if (!target) return;
  const you = app.renderYou;
  const p = app.entityRenderPos(target);
  app.aimX = p.x - you.x;
  app.aimY = p.y - you.y;
  app.moveTarget = null;
  app.socket.attack(String(target.id), THROW_COMBO);
  app.heroMotor?.cast("gale_bolt", 180);
  // the heave: feet planted as the server will plant them (its status confirms it)
  const pnow = performance.now();
  const half = (app.socket.rttMs || 0) * 0.5;
  if (!app.forces.rooted(pnow)) app.forces.status(1, true, HEAVE_MS + half, pnow);
  S.heaveUntil = pnow + HEAVE_MS + (app.socket.rttMs || 0) + 250;
  S.throwSentAt = Date.now();
  S.throwAt = performance.now();
  // (the fist empties now; the snapshot gives it back if the server never took the throw)
  S.carry = false;
  if (S.clods) S.clods.hand.visible = false;
}

/** The heaps by the dais, from the clod POIs (once per arrival). */
function placeHeaps(app: WorldApp) {
  const heaps = S.heaps;
  const ents = app.room?.entities;
  if (!heaps || !ents) return;
  let n = 0;
  for (let i = 0; i < ents.length && n < HEAP_CAP; i++) {
    const e = ents[i];
    if (e.kind !== "poi" || e.poiKind !== "clod") continue;
    const x = Number(e.x) || 0;
    const y = Number(e.y) || 0;
    S.heapX[n] = x;
    S.heapY[n] = app.standY(x, y);
    S.heapZ[n] = y;
    n++;
  }
  if (!n) return;
  heaps.set(S.heapX, S.heapY, S.heapZ, n);
  S.heapsSet = true;
}

// ——— the hooks ————————————————————————————————————————————————————————————

export const gluttonyMech: CantoMech = {
  enter(app) {
    APP = app;
    registerOnce();
    S.on = true;
    S.compact = isCompactUi();
    const mats = app.mats;
    const tier = (app.gfx?.tier ?? "low") as RainTier;
    S.rain = new GluttonyRain(tier, S.compact);
    app.scene.add(S.rain.lines);
    S.ripples = new MudRipples(S.compact ? 28 : 44);
    S.ripples.mesh.visible = false;
    app.scene.add(S.ripples.mesh);
    S.hail = new Hailstones(S.compact ? 30 : 48);
    S.hail.mesh.visible = false;
    app.scene.add(S.hail.mesh);
    if (mats) {
      S.mounds = new BuriedMounds(mats, 31);
      app.scene.add(S.mounds.mesh);
      S.clods = new Clods(mats);
      app.scene.add(S.clods.group);
      S.heaps = new ClodHeaps(mats, HEAP_CAP);
      app.scene.add(S.heaps.group);
      // (compile() walks hidden objects; its geometry + material are shared, kept on exit)
      S.fangoWarm = makeFango(mats);
      S.fangoWarm.visible = false;
      app.scene.add(S.fangoWarm);
      // wet, sheened mud (the ground material is Gluttony's own)
      S.groundRough = mats.groundGlut.roughness;
      S.groundMetal = mats.groundGlut.metalness;
      mats.groundGlut.roughness = 0.6;
      mats.groundGlut.metalness = 0.14;
    }
    S.moundsSet = false;
    S.bb = 0;
    S.carry = false;
    S.throwQueued = false;
    S.heapsSet = false;
    S.fanTipUntil = 0;
    S.rising.clear();
    S.heads.clear();
    S.cerbId = "";
    S.heartId = "";
    S.heartSack = null;
    S.mawPhase = 1;
    S.wasMire = false;
    S.stepAcc = 0;
    S.ripplesUntil = 0;
    S.hailUntil = 0;
    S.bubbleAt.fill(0);
    // olive fog, thicker than the road cantos; the ash thins to a drizzle of mud
    app.glutFogBase = 0.021;
    app.fogTargetDensity = app.glutFogBase;
    app.fogTargetColor.setHex(0x24250f);
    app.ash?.setColor(0x9aa268, S.compact ? 0.2 : 0.26);
  },

  exit(app) {
    S.on = false;
    S.rain?.dispose();
    S.ripples?.dispose();
    S.hail?.dispose();
    S.mounds?.dispose();
    S.clods?.dispose();
    S.heaps?.dispose();
    S.heaps = null;
    S.fangoWarm?.removeFromParent();
    S.fangoWarm = null;
    S.throwQueued = false;
    S.rain = null;
    S.ripples = null;
    S.hail = null;
    S.mounds = null;
    S.clods = null;
    S.rising.clear();
    S.heads.clear();
    if (app.mats) {
      app.mats.groundGlut.roughness = S.groundRough;
      app.mats.groundGlut.metalness = S.groundMetal;
    }
    APP = null;
  },

  moveFeel(app, out: MoveFeelOut) {
    const m = mireMulAt(app.renderYou.x, app.renderYou.y);
    if (m < 1) {
      out.speedMul *= m;
      // the mud sucks at every step: slower to get going
      out.accelMul *= 0.55 + 0.45 * m;
    }
  },

  dashScale(app) {
    return mireDashAt(app.renderYou.x, app.renderYou.y);
  },

  nodeMesh(app, e) {
    if (!app.mats) return null;
    if (e?.archetype === "mire_heart") return makeMireHeart(app.mats);
    // the Maw's feeders (phase 2): a cheap two-draw body, up to four at once
    if (e?.kind === "mob" && e.name === "Fango") return makeFango(app.mats);
    return null;
  },

  onAttackPress(app) {
    if (!S.carry) {
      // just threw: the next swing waits until its blade contact (the packet) lands past
      // the throw's cooldown on the server — else the server drops the blow
      return Date.now() < S.throwSentAt + ATK_CD_MS - SWING_CONTACT_MS;
    }
    if (!app.room) return false;
    // mire in hand: the press throws (queued until the server's blade clock allows it)
    if (S.throwQueued) return true;
    // nothing in a throw's reach: an ordinary press (walk in on the nearest foe)
    if (!throwTarget(app)) return false;
    S.throwQueued = true;
    S.throwQueuedAt = Date.now();
    fireQueuedThrow(app);
    return true;
  },

  onMessage(app, msg) {
    const t = msg?.type;
    if (typeof t !== "string" || !t.startsWith("glut_")) return false;
    const now = performance.now();
    switch (t) {
      case "glut_rise": {
        const k = Number(msg.k);
        S.mounds?.applyMask(S.bb & ~(1 << k), nowSec());
        S.bb &= ~(1 << k);
        const x = Number(msg.x) || 0;
        const y = Number(msg.y) || 0;
        // the mud heaves and bursts
        ripple(x, y, 1.6, 0.7, 1);
        ripple(x, y, 2.6, 0.9, 0.8, 0, 0.15);
        ripple(x, y, 3.3, 1.0, 0.6, 0, 0.35);
        app.combat?.ash.spawn(x, app.surfaceY(x, y), y, 0x3e3a1c, now, 1.1, 800, 1.2);
        const dur = visibleWindupMs(Number(msg.dur) || 800, app.socket.rttMs);
        const r = { at: now, dur };
        if (!startRise(app, String(msg.id), r)) S.rising.set(String(msg.id), r);
        app.camPunch = Math.max(app.camPunch, 0.12);
        return true;
      }
      case "glut_hail": {
        const pts = msg.pts as number[];
        if (!Array.isArray(pts) || !S.hail) return true;
        const dur = visibleWindupMs(Number(msg.dur) || 1000, app.socket.rttMs) / 1000;
        const t1 = nowSec() + dur;
        const per = S.compact ? 2 : 3;
        for (let i = 0; i + 2 < pts.length; i += 3) {
          const x = pts[i]!;
          const y = pts[i + 1]!;
          const r = pts[i + 2]!;
          for (let j = 0; j < per; j++) {
            const a = (i * 1.7 + j * 2.4) % (Math.PI * 2);
            const rr = r * (j === 0 ? 0.1 : 0.55);
            const tx = x + Math.cos(a) * rr;
            const ty = y + Math.sin(a) * rr;
            const land = t1 - 0.03 + j * 0.06;
            S.hail.drop(tx - 2.6, app.surfaceY(tx, ty) + 12, ty - 1.2, land - 0.62, tx, app.surfaceY(tx, ty) + 0.12, ty, land);
          }
        }
        S.hailUntil = Math.max(S.hailUntil, t1 + 0.3);
        S.hail.mesh.visible = true;
        // first volleys: say what the pale circles are
        const you = app.renderYou;
        let mine = false;
        for (let i = 0; i + 2 < pts.length; i += 3) if (Math.hypot(pts[i]! - you.x, pts[i + 1]! - you.y) < 7) mine = true;
        if (mine && msg.crown && S.crownTips < 2) {
          S.crownTips++;
          S.crownTipUntil = now + 1600;
        } else if (mine && S.hailTips < 2) {
          S.hailTips++;
          S.hailTipUntil = now + 3800;
        }
        return true;
      }
      case "glut_bite": {
        const id = String(msg.id);
        const head = Number(msg.head) || 0;
        const isMaw = id === "triple_maw";
        const anim = headsOf(id, isMaw ? 3 : 1);
        const a = anim[Math.min(anim.length - 1, head)]!;
        a.start = now;
        a.dur = visibleWindupMs(Number(msg.dur) || 1000, app.socket.rttMs);
        if (!isMaw) S.cerbId = id;
        // le bocche aperse: the first few fans (all three jaws at once) get a word
        if (isMaw && head === 0 && S.mawPhase >= 2 && S.fanTips < 3) {
          const m = entityById(app, id);
          const you = app.renderYou;
          if (m && Math.hypot(m.x - you.x, m.y - you.y) < 12) {
            S.fanTips++;
            S.fanTipUntil = now + 2200;
          }
        }
        // the head's cone telegraph turned the body toward it: face the Maw's heading
        if (isMaw) {
          const st = app.nodes.get(id)?.group.userData.mob as MobState | undefined;
          if (st && st.atkKind === BITE_KIND[head]) fixMawFacing(st, head);
        }
        return true;
      }
      case "glut_silence": {
        const id = String(msg.id);
        const isMaw = id === "triple_maw";
        const anim = headsOf(id, isMaw ? 3 : 1);
        const a = anim[Math.min(anim.length - 1, Number(msg.head) || 0)]!;
        a.silUntil = now + (Number(msg.dur) || 5000);
        a.start = -1e9;
        const rec = app.nodes.get(id);
        if (rec) {
          const p = rec.group.position;
          app.combat?.ash.spawn(p.x, p.y + (isMaw ? 3.8 : 2.6), p.z, 0x4a4222, now, 1.2, 700, 0.8);
          if (rec.kind === "triple_maw" || id === S.cerbId) app.combat?.hitMob(rec, app.renderYou.x, app.renderYou.y, true, now);
        }
        app.camPunch = Math.max(app.camPunch, 0.3);
        return true;
      }
      case "glut_grab": {
        if (String(msg.pid) === String(app.room?.you?.id ?? app.socket.playerId ?? "")) {
          S.carry = true;
          if (S.snatchTips < 2) {
            S.snatchTips++;
            S.snatchUntil = now + 1400;
          }
          const e = entityById(app, String(msg.id));
          if (e) ripple(e.x, e.y, 1.3, 0.6, 0.9);
        }
        return true;
      }
      case "glut_clod": {
        const mine = String(msg.pid) === String(app.room?.you?.id ?? app.socket.playerId ?? "");
        if (mine) {
          S.carry = false;
          if (S.clods) S.clods.hand.visible = false;
        }
        const x = Number(msg.x) || 0;
        const y = Number(msg.y) || 0;
        const fromX = mine ? app.renderYou.x : x;
        const fromY = mine ? app.renderYou.y : y;
        const tx = Number(msg.tx) || 0;
        const ty = Number(msg.ty) || 0;
        S.clods?.throw(
          fromX,
          app.standY(fromX, fromY) + 1.55,
          fromY,
          String(msg.tid),
          tx,
          app.standY(tx, ty) + 2,
          ty,
          nowSec(),
          (Number(msg.dur) || 300) / 1000
        );
        return true;
      }
      case "glut_sink": {
        const dur = visibleWindupMs(Number(msg.dur) || 1000, app.socket.rttMs);
        S.sinkUntil = now + dur;
        S.sinkX = Number(msg.x) || app.renderYou.x;
        S.sinkY = Number(msg.y) || app.renderYou.y;
        S.sinkBubbleAt = 0;
        S.sinkTips++;
        // (after the first few, the short callout)
        S.sinkShort = S.sinkTips > 3;
        return true;
      }
      case "glut_feed": {
        const rec = app.nodes.get(String(msg.boss));
        if (rec) {
          const p = rec.group.position;
          if (Number(msg.heal) > 0) app.combat?.number(p.x, p.y + 5.2, p.z, Number(msg.heal), "heal", String(msg.boss), now);
          ripple(p.x, p.z, 2.4, 0.8, 0.9);
        }
        return true;
      }
    }
    return true;
  },

  onSnapshot(app, raw) {
    const m = raw as { bv?: number; bb?: number; c?: number; cw?: any; bm?: number[]; hs?: number[]; cs?: number } | undefined;
    if (!m) return;
    if (m.cw) adoptMire(m.cw);
    if (Array.isArray(m.bm) && S.mounds) {
      S.mounds.setSpots(m.bm, (x, y) => app.standY(x, y));
      S.moundsSet = true;
      S.bb = 0x7fffffff;
    }
    if (m.bb != null && S.mounds) {
      S.bb = Number(m.bb) | 0;
      S.mounds.applyMask(S.bb, nowSec());
    }
    const now = performance.now();
    // the server's word on the fist, except right after our own throw (its reply is a
    // round trip away)
    if (now - S.throwAt > 450 + (app.socket.rttMs || 0)) S.carry = Boolean(m.c);
    if (!S.heapsSet) placeHeaps(app);
    if (Array.isArray(m.hs)) {
      const a = headsOf("triple_maw", 3);
      for (let i = 0; i < 3; i++) {
        const left = Number(m.hs[i]) || 0;
        if (left > 0) a[i]!.silUntil = Math.max(a[i]!.silUntil, now + left * 1000 - 50);
      }
    }
    if (m.cs && S.cerbId) {
      const a = headsOf(S.cerbId, 1);
      a[0]!.silUntil = Math.max(a[0]!.silUntil, now + Number(m.cs) * 1000 - 50);
    }
    // shades whose rise message came before their entity
    if (S.rising.size) {
      for (const [id, r] of S.rising) {
        if (now - r.at > r.dur + 400 || startRise(app, id, r)) S.rising.delete(id);
      }
    }
    // Cerbero's id (its bite messages name it too) and the Mire Heart's
    if (!S.cerbId || !S.heartId) {
      for (const e of app.room?.entities ?? []) {
        if (/^cerbero$/i.test(String(e.name || ""))) S.cerbId = String(e.id);
        else if (e.archetype === "mire_heart") S.heartId = String(e.id);
      }
    }
  },

  tick(app, dt) {
    if (!S.on) return;
    const tSec = nowSec();
    const nowMs = tSec * 1000;
    const you = app.renderYou;
    // — weather —
    let maw: any = null;
    const ents = app.room?.entities;
    if (ents) {
      for (let i = 0; i < ents.length; i++) {
        if (ents[i].id === "triple_maw") {
          maw = ents[i];
          break;
        }
      }
    }
    S.mawPhase = maw ? Number(maw.phase) || 1 : 1;
    if (S.rain) {
      const f = app.camFollow;
      S.rain.setStorm(S.mawPhase >= 2 && Boolean(maw) && Math.hypot(maw.x - you.x, maw.y - you.y) < 40);
      S.rain.update(f.x, f.y, f.z, tSec, dt);
    }
    // — pools —
    if (S.ripples) {
      S.ripples.update(tSec);
      if (S.ripples.mesh.visible && tSec > S.ripplesUntil) S.ripples.mesh.visible = false;
    }
    if (S.hail) {
      S.hail.update(tSec, hailLand);
      if (S.hail.mesh.visible && tSec > S.hailUntil) S.hail.mesh.visible = false;
    }
    S.clods?.update(tSec, clodAim, clodLand);
    if (S.throwQueued) fireQueuedThrow(app);
    // — buried mounds: heave at ~20 Hz, bubble near the camera —
    if (S.mounds && S.moundsSet) {
      S.moundTick += dt;
      if (S.moundTick >= 0.05) {
        S.moundTick = 0;
        S.mounds.update(tSec);
      }
      const n = S.mounds.size;
      const cx = app.camFollow.x;
      const cz = app.camFollow.z;
      let nearMound = false;
      for (let k = 0; k < n; k++) {
        if (!S.mounds.isBuried(k)) continue;
        S.mounds.spot(k, _v);
        const dx = _v.x - cx;
        const dz = _v.z - cz;
        const d2 = dx * dx + dz * dz;
        if (Math.hypot(_v.x - you.x, _v.z - you.y) < 7) nearMound = true;
        if (d2 > 28 * 28 || tSec < S.bubbleAt[k]!) continue;
        S.bubbleAt[k] = tSec + 1.1 + ((k * 0.37) % 1) * 0.9;
        ripple(_v.x, _v.z, 1.15, 1.1, 0.75);
        if ((k + Math.floor(tSec)) % 3 === 0) ripple(_v.x + 0.3, _v.z - 0.2, 0.55, 0.6, 0.9, 0, 0.3);
      }
      if (nearMound && S.moundTips < 2 && nowMs > S.moundTipUntil + 20000) {
        S.moundTips++;
        S.moundTipUntil = nowMs + 5200;
      }
    }
    // — your steps in the mire —
    const depth = mireDepthAt(you.x, you.y);
    const inMire = depth > 0.25;
    const sp = Math.hypot(app.velX, app.velY);
    if (inMire && !S.wasMire) {
      if (sp > 1) {
        ripple(you.x, you.y, 1.5, 0.8, 1);
        ripple(you.x, you.y, 0.8, 0.5, 0.9, 0, 0.08);
      }
      if (S.mireTips < 1) {
        S.mireTips++;
        S.mireTipUntil = nowMs + 6000;
      }
    }
    S.wasMire = inMire;
    if (inMire && sp > 0.8) {
      S.stepAcc += sp * dt;
      if (S.stepAcc > 1.25) {
        S.stepAcc = 0;
        // (behind the stride, where the foot pulled free)
        const l = sp || 1;
        ripple(you.x - (app.velX / l) * 0.3, you.y - (app.velY / l) * 0.3, 0.95, 0.9, 0.85);
      }
    } else {
      S.stepAcc = 0;
    }
    // the mud closing on your feet bubbles until it shuts
    if (nowMs < S.sinkUntil && nowMs > S.sinkBubbleAt) {
      S.sinkBubbleAt = nowMs + 180;
      ripple(S.sinkX, S.sinkY, 1.25, 0.45, 0.9);
    }
    // seized by the mire (a buried shade's grab landed on you)
    const rooted = app.forces.rooted(nowMs);
    if (rooted && !S.wasRooted && nowMs > S.heaveUntil) {
      ripple(you.x, you.y, 1.2, 0.8, 1);
      ripple(you.x, you.y, 2.0, 0.9, 0.8, 0, 0.12);
      S.seizedUntil = nowMs + 900;
    }
    S.wasRooted = rooted;
    // — the fist of mire —
    if (S.clods) {
      const hand = S.clods.hand;
      const g = app.youGroup;
      hand.visible = S.carry && Boolean(g);
      if (hand.visible && g) {
        const yaw = g.rotation.y;
        // right hand, a little forward (the model faces −z)
        _w.set(0.36, 1.08 + Math.sin(tSec * 3) * 0.03, -0.18).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
        hand.position.set(g.position.x + _w.x, g.position.y + _w.y, g.position.z + _w.z);
        hand.rotation.y = tSec * 0.8;
      }
    }
    // — the Mire Heart's slow, wet double beat —
    if (S.heartId) {
      const rec = app.nodes.get(S.heartId);
      if (!rec) {
        S.heartSack = null;
      } else {
        if (!S.heartSack) S.heartSack = rec.group.getObjectByName("heartSack") ?? null;
        const p = rec.group.position;
        if (S.heartSack && Math.abs(p.x - app.camFollow.x) + Math.abs(p.z - app.camFollow.z) < 50) {
          const ph = (tSec * 0.9) % 1;
          const beat = Math.exp(-((ph - 0.1) ** 2) * 180) + 0.6 * Math.exp(-((ph - 0.3) ** 2) * 180);
          S.heartSack.scale.set(1.15 + beat * 0.1, 1.25 + beat * 0.12, 1.05 + beat * 0.1);
        }
      }
    }
    // — heads —
    if (maw) poseHeads(app, "triple_maw", true, nowMs, Number(maw.windupLeft) || 0);
    if (S.cerbId) poseHeads(app, S.cerbId, false, nowMs, 0);
  },

  objective(app, obj: Objective) {
    const room = app.room;
    if (!room) return;
    const nowMs = performance.now();
    const you = app.renderYou;
    const t = obj.target;
    const ent = t?.entity;
    const arch = String(ent?.archetype || "");
    // — the Gluttony chain: heart → Cerbero → Triple Maw → gate —
    if (t && t.kind === "foe") {
      if (arch === "mire_heart") obj.text = "Break the Mire Heart out in the mud";
      else if (/^cerbero$/i.test(String(ent?.name || ""))) obj.text = "Choke Cerbero's jaw with mire, then kill it";
      else if (ent?.id === "triple_maw") {
        obj.text =
          Array.isArray(room.you?.firstClears) && room.you.firstClears.includes("inferno_06")
            ? "Slay the Triple Maw"
            : "Slay the Triple Maw to open Avarice";
      }
    }
    // — the hint for this moment (the shrine hint keeps its place at low life) —
    const hpFrac = (Number(room.you?.hp) || 0) / Math.max(1, Number(room.you?.maxHp) || 1);
    if (hpFrac < 0.5 && obj.sub) return;
    let sub = "";
    let nearBiter = false;
    if (ent && (ent.id === "triple_maw" || /^cerbero$/i.test(String(ent.name || "")))) {
      const p = app.entityRenderPos(ent);
      nearBiter = Math.hypot(p.x - you.x, p.y - you.y) < 16;
    }
    let fango = false;
    let clod = false;
    for (const e of room.entities) {
      if (e.name === "Fango" && e.hp > 0) fango = true;
      else if (e.kind === "poi" && e.poiKind === "clod" && Math.hypot(e.x - you.x, e.y - you.y) < 18) clod = true;
    }
    if (nowMs < S.seizedUntil) sub = "Seized by the mire — hold on";
    else if (nowMs < S.snatchUntil) sub = "The mire snatches at the thief — step clear!";
    else if (nowMs < S.sinkUntil) sub = S.sinkShort ? "Sinking — step out!" : "The mud closes on your feet — step out!";
    else if (nowMs < S.fanTipUntil && !S.carry) sub = "All three jaws — choke one with mire, or dash its snap";
    else if (S.carry) sub = "Mire in hand — attack a gaping maw to throw";
    else if (S.mawPhase >= 2 && fango) sub = "Cut down the Fango before it feeds the Maw";
    else if (nearBiter && clod) sub = S.compact ? "Grab mire (Use), throw it in a gaping maw" : "Grab mire (E), throw it in a gaping maw";
    if (!sub && nowMs < S.crownTipUntil) sub = "A ring of hail — out through the gap!";
    if (!sub && nowMs < S.hailTipUntil) sub = "Hail — step out of the pale circles";
    if (!sub && nowMs < S.moundTipUntil) sub = "Bubbling mound: a buried shade — pass wide";
    if (!sub && nowMs < S.mireTipUntil) sub = "The mire drags at you — keep to the stones";
    if (sub) obj.sub = sub;
  },
};
