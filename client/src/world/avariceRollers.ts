/**
 * Avarice processions, drawn: every rolling weight is one instance of a single
 * InstancedMesh (iron drum, gold bands, coin faces with a bar so the roll reads),
 * placed each frame from the shared procession clock (avariceProcession.ts) and
 * turned by the distance it has rolled. Instance N·2 is Plutus's hurled weight
 * (shown only while one rolls down its lane).
 *
 * Clashes are detected on the local procession clock (no message needed): dust and
 * shock rings (pooled fx rings), gold sparks (pooled bursts), the hit light, a camera
 * kick by distance, and the two crowds' cries as world labels —
 * «Perché tieni?» (the wasters, south) and «Perché burli?» (the hoarders, north).
 * Nothing here allocates per frame.
 */
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PROC, GEO, arcPoint, untilClash, weightsAt, type ArcPt, type Weight } from "./avariceProcession";
import { acquireFxRing, spawnSparks } from "./fx";
import { setPlanar } from "./frames";

const WEIGHTS = PROC.N * 2;
/** Instance index of Plutus's hurled weight. */
const SWEEP = WEIGHTS;
/** The hurled weight's speed down its lane (units/s) and how fast a cut-short one sinks. */
const SWEEP_SPEED = 17;
const SWEEP_SINK_MS = 380;

const IRON: [number, number, number] = [0.13, 0.105, 0.08];
const GOLD: [number, number, number] = [0.95, 0.68, 0.24];
const BRONZE: [number, number, number] = [0.42, 0.28, 0.12];

function paint(g: THREE.BufferGeometry, c: [number, number, number]): THREE.BufferGeometry {
  const n = g.attributes.position!.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * One weight: a drum rolling about local X (forward = local +Z), radius PROC.R. Compact
 * (phones): fewer sides, thinner band tubes, four cleats, no hub bosses — ~half the
 * triangles, drawn twice (shadow pass) for eleven instances.
 */
function weightGeometry(compact: boolean): THREE.BufferGeometry {
  const R = PROC.R;
  const W = 1.34;
  const seg = compact ? 12 : 22;
  const parts: THREE.BufferGeometry[] = [];
  const drum = new THREE.CylinderGeometry(R * 0.97, R * 0.97, W, seg, 1, false);
  drum.rotateZ(Math.PI / 2);
  parts.push(paint(drum, IRON));
  for (const x of [-0.46, 0.46]) {
    const band = new THREE.TorusGeometry(R * 0.985, 0.075, compact ? 3 : 5, seg);
    band.rotateY(Math.PI / 2);
    band.translate(x, 0, 0);
    parts.push(paint(band, GOLD));
  }
  // cleats across the tread: the roll reads from far away
  const cleats = compact ? 4 : 6;
  for (let i = 0; i < cleats; i++) {
    const a = (i / cleats) * Math.PI * 2;
    const c = new THREE.BoxGeometry(W * 0.92, 0.2, 0.36);
    c.translate(0, R * 0.96, 0);
    c.rotateX(a);
    parts.push(paint(c, i % 2 ? BRONZE : IRON));
  }
  for (const side of [-1, 1]) {
    // coin face + a bar across it (the turning mark)
    const face = new THREE.CylinderGeometry(R * 0.62, R * 0.62, 0.08, seg);
    face.rotateZ(Math.PI / 2);
    face.translate((side * W) / 2 + side * 0.03, 0, 0);
    parts.push(paint(face, GOLD));
    const bar = new THREE.BoxGeometry(0.1, R * 1.7, 0.26);
    bar.translate((side * W) / 2 + side * 0.07, 0, 0);
    parts.push(paint(bar, BRONZE));
    if (compact) continue;
    const boss = new THREE.CylinderGeometry(0.26, 0.3, 0.2, 8);
    boss.rotateZ(Math.PI / 2);
    boss.translate((side * W) / 2 + side * 0.12, 0, 0);
    parts.push(paint(boss, IRON));
  }
  // (every part carries position/normal/uv/color)
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}

export type RollerHost = {
  scene: THREE.Scene;
  heightAt(x: number, z: number): number;
  surfaceY(x: number, y: number, lift?: number): number;
  youX(): number;
  youY(): number;
  animT(): number;
  /** Pooled fx ring hand-off: the host ticks + releases it (WorldApp.impacts). */
  pushImpact(mesh: THREE.Mesh, dur: number, from: number, to: number): void;
  /** Pooled spark burst hand-off (WorldApp.sparks); false when the budget is full. */
  pushSparks(x: number, y: number, h: number, color: number, dur: number): boolean;
  flashLight(x: number, y: number, h: number, color: number, intensity: number): void;
  kick(shake: number, punch: number, dirX: number, dirY: number): void;
  compact(): boolean;
  /**
   * Is a world point (planar x, y at height h) on screen clear of the HUD — vitals,
   * objective line, compass arrows' edge, minimap / Inv column, thumbs? (A crowd's cry
   * that would land there is not shown.)
   */
  screenClear(x: number, h: number, y: number, halfW: number): boolean;
};

/**
 * el: the animated inner line (CSS2DRenderer owns the outer element's transform). go:
 * which of the two identical float-up animations runs — switching the animation name
 * restarts it without a forced layout (no offsetWidth read).
 */
type Shout = { obj: CSS2DObject; el: HTMLSpanElement; until: number; go: number };

/** Restart a line's float-up animation (alternate two identical keyframe names). */
export function restartLine(el: HTMLElement, base: string, go: number): number {
  const next = go === 1 ? 2 : 1;
  el.classList.remove(`${base}${go === 2 ? "2" : ""}`);
  el.classList.add(`${base}${next === 2 ? "2" : ""}`);
  return next;
}

/** Where a crowd cries from: this far back along its arc, and this far outside it. */
const SHOUT_BACK = 9;
const SHOUT_OUT = 3.2;
/** Lane cues: drums within CUE_NEAR (u) at ≥ CUE_MIN_SPEED (u/s; the server's crushing
 * speed, ROLL_SOFT_SPEED) light the next CUE_AHEAD_S of their track (≤ CUE_MAX_LEN). */
const CUE_NEAR = 14;
const CUE_MIN_SPEED = 4.0;
const CUE_AHEAD_S = 1.0;
const CUE_MAX_LEN = 9;
/** Half the width (px) of a cry's line, for its on-screen keep-out test. */
const SHOUT_HALF_W = 70;

export class AvariceRollers {
  readonly group = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly ws: Weight[] = [];
  private readonly cue: THREE.InstancedMesh;
  private readonly cueMat: THREE.MeshBasicMaterial;
  private readonly cueE = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly cueQ = new THREE.Quaternion();
  private readonly cueP = new THREE.Vector3();
  private readonly cueS = new THREE.Vector3(1, 1, 1);
  private readonly cueC = new THREE.Color();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly pt: ArcPt = { x: 0, y: 0, tx: 1, ty: 0 };
  private lastT = NaN;
  private shouts: Shout[] = [];
  // Plutus's hurled weight (one at a time)
  private sweepOn = false;
  private sweepX = 0;
  private sweepY = 0;
  private sweepDir = 0;
  private sweepLen = 0;
  /** performance.now() (ms) when the weight passes `sweepHitAt` along its lane */
  private sweepDeadline = 0;
  private sweepHitAt = 0;
  private sweepSpin = 0;
  private sweepId = "";
  /** cut short (bell / leash / death): sinks where it stands from this time (ms) */
  private sweepSinkAt = 0;
  private sweepStopAt = 0;

  constructor(private host: RollerHost) {
    this.group.name = "avaProcessions";
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.55,
      roughness: 0.4,
      emissive: 0x1c1004,
      emissiveIntensity: 0.35,
    });
    this.mesh = new THREE.InstancedMesh(weightGeometry(host.compact()), this.mat, WEIGHTS + 1);
    this.mesh.name = "avaWeights";
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = WEIGHTS;
    this.group.add(this.mesh);
    // the glowing track ahead of drums bearing down near you (updateCues)
    const cueGeo = new THREE.PlaneGeometry(1, 1);
    cueGeo.rotateX(-Math.PI / 2);
    this.cueMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      // (the lane band under it is itself pulled toward the camera: avariceGround)
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    this.cue = new THREE.InstancedMesh(cueGeo, this.cueMat, WEIGHTS);
    this.cue.name = "avaLaneCues";
    this.cue.frustumCulled = false;
    this.cue.renderOrder = 2;
    this.cue.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cue.setColorAt(0, new THREE.Color(0, 0, 0));
    this.cue.count = 1;
    this.group.add(this.cue);
    // the crowds' cries at each clash (north = hoarders, south = wasters)
    for (let i = 0; i < 2; i++) {
      const wrap = document.createElement("div");
      const el = document.createElement("span");
      el.className = `ava-shout ${i === 0 ? "ava-shout-n" : "ava-shout-s"}`;
      el.textContent = i === 0 ? "«Perché burli?»" : "«Perché tieni?»";
      wrap.appendChild(el);
      const obj = new CSS2DObject(wrap);
      obj.visible = false;
      this.group.add(obj);
      this.shouts.push({ obj, el, until: 0, go: 0 });
    }
    host.scene.add(this.group);
  }

  /** Place every weight for procession time t (seconds); fire clash FX on the beat. */
  update(t: number, nowMs: number) {
    const ws = weightsAt(t, this.ws);
    const m = this.m;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]!;
      this.e.set(w.spin, Math.atan2(w.tx, w.ty), 0);
      this.q.setFromEuler(this.e);
      // (the last run climbs onto Plutus's dais: sit on what is drawn there)
      this.p.set(w.x, this.host.surfaceY(w.x, w.y) + PROC.R * 0.97, w.y);
      m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, m);
    }
    this.updateSweep(nowMs);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.updateCues(ws);
    // clash beats: the local clock passed a clash since the last frame
    if (this.lastT === this.lastT && t > this.lastT && t - this.lastT < 0.5) {
      if (untilClash(t, 0) > untilClash(this.lastT, 0)) this.clash(0, nowMs);
      if (untilClash(t, 1) > untilClash(this.lastT, 1)) this.clash(1, nowMs);
    }
    this.lastT = t;
    for (const s of this.shouts) {
      if (s.obj.visible && nowMs > s.until) s.obj.visible = false;
    }
  }

  /**
   * Track ahead of every drum rolling near you (≤ CUE_NEAR, at a crushing speed) glows
   * ember-red for the ~1 s it is about to cover: the lanes' danger read on
   * the ground, where the eye already is (the objective line's countdown is small on a
   * phone). One instanced draw; the visible ones are packed first.
   */
  private updateCues(ws: Weight[]) {
    const cue = this.cue;
    const yx = this.host.youX();
    const yy = this.host.youY();
    let n = 0;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]!;
      if (w.speed < CUE_MIN_SPEED) continue;
      const d = Math.hypot(w.x - yx, w.y - yy);
      if (d > CUE_NEAR) continue;
      const sp = Math.hypot(w.vx, w.vy) || 1;
      const fx = w.vx / sp;
      const fy = w.vy / sp;
      const len = Math.min(CUE_MAX_LEN, w.speed * CUE_AHEAD_S);
      const cx = w.x + fx * (PROC.R + len * 0.5);
      const cy = w.y + fy * (PROC.R + len * 0.5);
      this.cueE.set(0, Math.atan2(fx, fy), 0);
      this.cueQ.setFromEuler(this.cueE);
      this.cueP.set(cx, this.host.surfaceY(cx, cy) + 0.12, cy);
      this.cueS.set(1.5, 1, len);
      this.m.compose(this.cueP, this.cueQ, this.cueS);
      cue.setMatrixAt(n, this.m);
      // brighter the nearer (and the faster) it bears
      const k = Math.min(1, 0.35 + (CUE_NEAR - d) / 8) * Math.min(1, 0.5 + w.speed / 16);
      this.cueC.setRGB(0.8 + 0.2 * k, 0.12 + 0.14 * k, 0.05 + 0.04 * k);
      cue.setColorAt(n, this.cueC);
      n++;
    }
    // (one zero-scale instance keeps the draw — and its program — alive when none show)
    if (n === 0) {
      this.cueS.set(0, 0, 0);
      this.m.compose(this.cueP, this.cueQ, this.cueS);
      cue.setMatrixAt(0, this.m);
      n = 1;
    }
    cue.count = n;
    cue.instanceMatrix.needsUpdate = true;
    if (cue.instanceColor) cue.instanceColor.needsUpdate = true;
  }

  /** Plutus hurls a weight down a lane: it passes `hitAt` along the lane at `deadlineMs`. */
  startSweep(id: string, x: number, y: number, dir: number, len: number, deadlineMs: number, hitAt: number) {
    this.sweepOn = true;
    this.sweepId = id;
    this.sweepSinkAt = 0;
    this.sweepX = x;
    this.sweepY = y;
    this.sweepDir = dir;
    this.sweepLen = len;
    this.sweepDeadline = deadlineMs;
    this.sweepHitAt = Math.max(0, Math.min(len, hitAt));
    this.mesh.count = WEIGHTS + 1;
  }

  /** The throw was cut short (the server's ava_sweep_cancel): the drum sinks where it is. */
  cancelSweep(id: string, nowMs: number) {
    if (!this.sweepOn || id !== this.sweepId || this.sweepSinkAt > 0) return;
    this.sweepSinkAt = nowMs;
    this.sweepStopAt = this.sweepHitAt + ((nowMs - this.sweepDeadline) / 1000) * SWEEP_SPEED;
  }

  private updateSweep(nowMs: number) {
    if (!this.sweepOn) return;
    const sinking = this.sweepSinkAt > 0;
    const along = sinking ? this.sweepStopAt : this.sweepHitAt + ((nowMs - this.sweepDeadline) / 1000) * SWEEP_SPEED;
    const sink = sinking ? 1 - (nowMs - this.sweepSinkAt) / SWEEP_SINK_MS : 1;
    if (along > this.sweepLen + 1 || sink <= 0) {
      this.sweepOn = false;
      this.mesh.count = WEIGHTS;
      return;
    }
    const a = Math.max(0, along);
    const ux = Math.cos(this.sweepDir);
    const uy = Math.sin(this.sweepDir);
    const x = this.sweepX + ux * a;
    const y = this.sweepY + uy * a;
    this.sweepSpin = a / PROC.R;
    // rising out of the ground as it gathers pace, sinking at the lane's end (or where
    // the throw was cut short)
    const rise = Math.min(1, (along + 3) / 3) * Math.min(1, (this.sweepLen + 1 - along) / 1.5) * sink;
    this.e.set(this.sweepSpin, Math.atan2(ux, uy), 0);
    this.q.setFromEuler(this.e);
    this.p.set(x, this.host.surfaceY(x, y) + PROC.R * 1.1 * Math.max(0.05, rise) - PROC.R * 0.12, y);
    const k = 1.1 * Math.max(0.05, rise);
    this.s.set(k, k, k);
    this.m.compose(this.p, this.q, this.s);
    this.s.set(1, 1, 1);
    this.mesh.setMatrixAt(SWEEP, this.m);
  }

  /** The weights meet: dust, sparks, the crowds cry out, the camera takes it by distance. */
  private clash(side: 0 | 1, nowMs: number) {
    const c = side === 0 ? PROC.W : PROC.E;
    const h = this.host;
    const dx = h.youX() - c.x;
    const dy = h.youY() - c.y;
    const d = Math.hypot(dx, dy);
    if (d > 60) return;
    const y0 = h.surfaceY(c.x, c.y, 0.1);
    const segs = h.compact() ? 36 : 48;
    const shock = acquireFxRing(0.9, 1.06, segs, 0xfff0c8, 0.95);
    setPlanar(shock.position, c.x, c.y, y0);
    h.scene.add(shock);
    h.pushImpact(shock, 620, PROC.CLASH_R * 0.35, PROC.CLASH_R * 1.25);
    const dust = acquireFxRing(0.55, 1.0, segs, 0x6a5030, 0.55, false);
    setPlanar(dust.position, c.x, c.y, y0 + 0.02);
    h.scene.add(dust);
    h.pushImpact(dust, 900, PROC.CLASH_R * 0.2, PROC.CLASH_R * 1.05);
    h.pushSparks(c.x, c.y, y0 + PROC.R * 1.3, 0xffd070, 700);
    if (d < 30) h.pushSparks(c.x, c.y, y0 + PROC.R * 0.8, 0xfff0c0, 520);
    h.flashLight(c.x, c.y, y0 + 2, 0xffc060, d < 25 ? 14 : 8);
    const near = d < 10 ? 1 : d < 22 ? 0.55 : d < 40 ? 0.22 : 0;
    if (near > 0) h.kick(0.55 * near, 0.8 * near, dx, dy);
    // the two crowds cry at each other from their own arcs — back along the lane and
    // outside it, so the two lines (and the guidance beacon over the clash) stay apart
    if (d >= 45) return;
    for (let k = 0; k < 2; k++) {
      const s = this.shouts[k]!;
      const pt = arcPoint(k, side === 0 ? SHOUT_BACK : GEO.L - SHOUT_BACK, this.pt);
      // outside the lens (planar +y is south; the left of travel toward E is +y): the
      // hoarders cry from north of their arc, the wasters from south of theirs
      const o = (k === 0 ? -1 : 1) * SHOUT_OUT;
      const x = pt.x - pt.ty * o;
      const y = pt.y + pt.tx * o;
      const hy = h.heightAt(x, y) + 3.4;
      // (a cry over the HUD — the gold arrow, the minimap, the Inv button — stays unsaid)
      if (!h.screenClear(x, hy, y, SHOUT_HALF_W)) continue;
      setPlanar(s.obj.position, x, y, hy);
      s.obj.visible = true;
      s.until = nowMs + 1700;
      s.go = restartLine(s.el, "ava-shout-go", s.go);
    }
  }

  dispose() {
    this.host.scene.remove(this.group);
    for (const s of this.shouts) {
      s.obj.element.remove();
      this.group.remove(s.obj);
    }
    this.shouts = [];
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.dispose();
    this.cue.geometry.dispose();
    this.cueMat.dispose();
    this.cue.dispose();
  }
}
