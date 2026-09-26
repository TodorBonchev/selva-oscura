/**
 * Lust storm, client side: the storm clock (phase + time left from the server, run on
 * performance.now between messages) and everything that shows it —
 *   - the windbreak rock islands (two InstancedMeshes, one shared material),
 *   - the lee of each rock as a darker ground wedge while the storm warns / blows
 *     (one mesh, rebuilt in place when the wind turns — never per frame),
 *   - wind streamers flying along the wind (one InstancedMesh, per-instance fade),
 *   - the ash motes, the hero's cape and legs, the shades' ribbons turned downwind,
 *   - the lovers' bond (one beam + halo) and Minos's tail coils,
 *   - the HUD wind arrow / countdown and the gust streak layer (lustHud.ts).
 * No per-frame allocation; every material is shared (markShared / sharedMat) and in the
 * scene from arrival, so the canto prewarm compiles them before the first fight.
 */
import * as THREE from "three";
import type { WorldApp } from "./WorldApp";
import type { MatKit } from "./materials";
import { disposeNode3D, sharedGeo, sharedMat } from "./dispose";
import { gustEnvelope, inLee, leeHalf, leeLen, STORM, type Windbreak } from "./lustGeo";
import { isCompactUi } from "../ui/hud";
import { LustHud } from "./lustHud";

export type StormPhase = "calm" | "warn" | "gust";

/** Nominal gust length used until the server's next message corrects it (ms). */
const GUST_GUESS_MS = 2750;
const LEE_SEGS = 6;
const COILS = 3;

function hash1(i: number, k: number): number {
  let n = (i + 1) * 374761393 + (k + 7) * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

/**
 * A storm-worn boulder: a lumpy icosahedron with a flat base, tapering to a crest that
 * leans with the prevailing wind, its windward face scoured flat.
 */
function boulderGeo(seed: number, lean: number, taper: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  // displacement keyed on the vertex position (the faces stay closed)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k =
      0.8 +
      0.2 * Math.sin(v.x * 2.3 + seed) * Math.cos(v.z * 2.1 - seed * 0.5) +
      0.1 * Math.sin(v.y * 5.1 + v.x * 1.7 + seed * 1.7) +
      0.05 * Math.sin(v.z * 9.3 + seed * 2.3);
    v.multiplyScalar(k);
    const up = Math.max(0, v.y);
    v.x *= 1 - taper * up;
    v.z *= 1 - taper * up;
    v.y = Math.max(-0.12, v.y);
    v.x += up * up * lean;
    // the windward (west) face, scoured flat
    if (v.x < -0.62) v.x = -0.62 + (v.x + 0.62) * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // (PolyhedronGeometry is already non-indexed: flat facets once normals are rebuilt)
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Soft horizontal streak (bright middle, feathered ends and edges). */
function streakTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 16;
  const g = c.getContext("2d")!;
  const gx = g.createLinearGradient(0, 0, 128, 0);
  gx.addColorStop(0, "rgba(255,255,255,0)");
  gx.addColorStop(0.6, "rgba(255,255,255,0.9)");
  gx.addColorStop(0.85, "rgba(255,255,255,1)");
  gx.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gx;
  g.fillRect(0, 4, 128, 8);
  const gy = g.createLinearGradient(0, 0, 0, 16);
  gy.addColorStop(0, "rgba(0,0,0,1)");
  gy.addColorStop(0.5, "rgba(0,0,0,0)");
  gy.addColorStop(1, "rgba(0,0,0,1)");
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = gy;
  g.fillRect(0, 0, 128, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();
const _eu = new THREE.Euler();

export class LustStorm {
  phase: StormPhase = "calm";
  /** performance.now() when the phase began / is due to end */
  t0 = 0;
  t1 = 0;
  wx = 1;
  wy = 0;
  power = 1;
  judged = false;
  wb: Windbreak[] | null = null;
  /** [idA, idB, 0 apart | 1 bound | 2 cut] */
  lov: [string, string, number] | null = null;
  /** gust strength now (0..~1.35) */
  str = 0;
  /** storm presence for visuals (warning build-up, gust, fade after), 0..1 */
  vis = 0;
  /** the lee wedges' fade, 0..1 */
  leeVis = 0;
  /** Minos is shielded by his borne flock (his coils spin round him) */
  minosWard = false;
  /** this frame: you stand in a rock's lee */
  sheltered = false;
  /** this frame's drift on you (u/s) — the hero's legs step with it */
  driftX = 0;
  driftY = 0;

  readonly group = new THREE.Group();
  private windVer = 0;
  private leeVer = -1;
  private rocks: THREE.InstancedMesh | null = null;
  private pebbles: THREE.InstancedMesh | null = null;
  private lee: THREE.Mesh | null = null;
  private leePos: THREE.BufferAttribute | null = null;
  private readonly leeMat: THREE.MeshBasicMaterial;
  private readonly streamers: THREE.InstancedMesh;
  private readonly n: number;
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  private readonly sz: Float32Array;
  private readonly slen: Float32Array;
  private readonly sspd: Float32Array;
  private readonly sage: Float32Array;
  private readonly slife: Float32Array;
  private readonly tether: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  readonly coils: THREE.Mesh[] = [];
  private coilStart = -1;
  private coilN = 0;
  private readonly coilMs = new Float32Array(COILS);
  private coilJudge: THREE.Object3D | null = null;
  private tail: THREE.Object3D | null = null;
  private tailBase = 0;
  private tailSpin = 0;
  private hud: LustHud | null = new LustHud();
  private hudKey = -99;
  private ribRecs: { kind: string; group: THREE.Group }[] = [];
  private ribAt = -999;
  private hudLabel = "";
  private frame = 0;

  constructor(private app: WorldApp) {
    const mats = app.mats as MatKit;
    this.group.name = "lustStorm";
    app.scene.add(this.group);

    // lee wedges (geometry sized when the windbreaks arrive)
    this.leeMat = sharedMat("lust:lee", () => {
      const m = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        fog: false,
      });
      return m;
    });

    // wind streamers
    this.n = isCompactUi() ? 16 : 28;
    const sGeo = sharedGeo("lust:streamer", () => new THREE.PlaneGeometry(1, 0.13).rotateX(-Math.PI / 2));
    const sMat = sharedMat(
      "lust:streamer",
      () =>
        new THREE.MeshBasicMaterial({
          map: streakTexture(),
          color: 0xf0e2da,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          forceSinglePass: true,
          fog: false,
        })
    );
    this.streamers = new THREE.InstancedMesh(sGeo, sMat, this.n);
    this.streamers.name = "lustStreamers";
    this.streamers.frustumCulled = false;
    this.streamers.renderOrder = 3;
    this.streamers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sx = new Float32Array(this.n);
    this.sy = new Float32Array(this.n);
    this.sz = new Float32Array(this.n);
    this.slen = new Float32Array(this.n);
    this.sspd = new Float32Array(this.n);
    this.sage = new Float32Array(this.n);
    this.slife = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.streamers.setColorAt(i, _col.setRGB(0, 0, 0));
      this.sage[i] = 1e9;
      this.slife[i] = 1;
    }
    this.streamers.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.streamers);

    // the lovers' bond: a thin beam and a soft halo around it
    const tGeo = sharedGeo("lust:tether", () => new THREE.CylinderGeometry(1, 1, 1, 6, 1, true));
    const tMat = sharedMat(
      "lust:tether",
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xff6a8e,
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          forceSinglePass: true,
          fog: false,
        })
    );
    const hMat = sharedMat(
      "lust:tetherHalo",
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xe0305e,
          transparent: true,
          opacity: 0.34,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          forceSinglePass: true,
          fog: false,
        })
    );
    this.tether = new THREE.Mesh(tGeo, tMat);
    this.tether.name = "lustTether";
    this.tether.visible = false;
    this.tether.frustumCulled = false;
    this.halo = new THREE.Mesh(tGeo, hMat);
    this.halo.name = "lustTetherHalo";
    this.halo.visible = false;
    this.halo.frustumCulled = false;
    this.group.add(this.tether, this.halo);

    // Minos's tail coils (reparented onto the Judge while he coils)
    const cGeo = sharedGeo("lust:coil", () => new THREE.TorusGeometry(1, 0.12, 8, 36));
    const cMat = sharedMat("lust:coil", () => {
      const m = new THREE.MeshStandardMaterial({
        color: 0x7a4428,
        roughness: 0.42,
        metalness: 0.55,
        emissive: 0xd0306a,
        emissiveIntensity: 0.9,
      });
      if (mats.bronze.map) m.map = mats.bronze.map;
      return m;
    });
    for (let i = 0; i < COILS; i++) {
      const c = new THREE.Mesh(cGeo, cMat);
      c.name = "lustCoil";
      c.visible = false;
      c.castShadow = false;
      c.rotation.x = Math.PI / 2;
      this.coils.push(c);
      this.group.add(c);
    }
  }

  // ——— server state ————————————————————————————————————————————————————————

  /** A storm message or a snapshot's storm fields. */
  sync(m: any) {
    const now = performance.now();
    const phase = (m.phase === "warn" || m.phase === "gust" ? m.phase : "calm") as StormPhase;
    const left = Math.max(0, Number(m.left) || 0);
    if (phase !== this.phase) {
      this.phase = phase;
      this.t0 = now;
      this.t1 = now + left;
    } else if (Math.abs(now + left - this.t1) > 160) {
      this.t1 = now + left;
    }
    const dx = Number(m.dirX);
    const dy = Number(m.dirY);
    if (Number.isFinite(dx) && Number.isFinite(dy) && (Math.abs(dx - this.wx) > 0.01 || Math.abs(dy - this.wy) > 0.01)) {
      const l = Math.hypot(dx, dy) || 1;
      this.wx = dx / l;
      this.wy = dy / l;
      this.windVer++;
    }
    this.judged = Boolean(m.judged);
    this.power = this.judged ? 1.35 : 1;
  }

  /** The windbreak list (flat [x, y, r, …]) — build the rocks and the lee once. */
  setWindbreaks(flat: number[]) {
    if (this.wb || !Array.isArray(flat) || flat.length < 3) return;
    const wb: Windbreak[] = [];
    for (let i = 0; i + 2 < flat.length; i += 3) {
      wb.push({ x: Number(flat[i]), y: Number(flat[i + 1]), r: Number(flat[i + 2]) || 1.5 });
    }
    this.wb = wb;
    this.buildRocks();
    this.buildLee();
  }

  // ——— build ——————————————————————————————————————————————————————————————

  private buildRocks() {
    const app = this.app;
    const wb = this.wb!;
    const mats = app.mats as MatKit;
    const rockMat = sharedMat("lust:rock", () => {
      const m = mats.stone.clone();
      m.color.setHex(0xb2a294);
      m.roughness = 0.9;
      m.metalness = 0.06;
      return m;
    });
    const gA = sharedGeo("lust:boulderA", () => boulderGeo(1.3, 0.22, 0.2));
    const gB = sharedGeo("lust:boulderB", () => boulderGeo(4.1, 0.12, 0.18));
    const rocks = new THREE.InstancedMesh(gA, rockMat, wb.length);
    const pebbles = new THREE.InstancedMesh(gB, rockMat, wb.length * 2);
    rocks.name = "lustWindbreaks";
    pebbles.name = "lustWindbreakStones";
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    pebbles.castShadow = !isCompactUi();
    pebbles.receiveShadow = true;
    for (let i = 0; i < wb.length; i++) {
      const w = wb[i]!;
      const y = app.standY(w.x, w.y);
      // the main boulder fills the footprint; its lean points east (the road's wind)
      const yaw = (hash1(i, 1) - 0.5) * 0.9;
      _q.setFromAxisAngle(_up, yaw);
      _p.set(w.x, y - 0.05, w.y);
      _s.set(w.r * (1.02 + hash1(i, 2) * 0.1), 1.05 + w.r * 0.5 + hash1(i, 3) * 0.3, w.r * (0.95 + hash1(i, 4) * 0.12));
      _m4.compose(_p, _q, _s);
      rocks.setMatrixAt(i, _m4);
      for (let k = 0; k < 2; k++) {
        const a = hash1(i, 10 + k) * Math.PI * 2;
        const d = w.r * (0.55 + hash1(i, 12 + k) * 0.3);
        const px = w.x + Math.cos(a) * d;
        const pz = w.y + Math.sin(a) * d;
        _q.setFromAxisAngle(_up, hash1(i, 14 + k) * Math.PI * 2);
        const sc = w.r * (0.4 + hash1(i, 16 + k) * 0.2);
        _p.set(px, app.standY(px, pz) - 0.04, pz);
        _s.set(sc * 1.2, sc * (0.9 + hash1(i, 18 + k) * 0.5), sc);
        _m4.compose(_p, _q, _s);
        pebbles.setMatrixAt(i * 2 + k, _m4);
      }
    }
    rocks.instanceMatrix.needsUpdate = true;
    pebbles.instanceMatrix.needsUpdate = true;
    rocks.computeBoundingSphere();
    pebbles.computeBoundingSphere();
    this.rocks = rocks;
    this.pebbles = pebbles;
    this.group.add(rocks, pebbles);
  }

  private buildLee() {
    const wb = this.wb!;
    const per = (LEE_SEGS + 1) * 2;
    const nV = wb.length * per;
    const pos = new THREE.BufferAttribute(new Float32Array(nV * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    const col = new Float32Array(nV * 4);
    const idx: number[] = [];
    for (let w = 0; w < wb.length; w++) {
      const base = w * per;
      for (let s = 0; s <= LEE_SEGS; s++) {
        const u = s / LEE_SEGS;
        // darkest just behind the rock, gone at the tail
        const a = Math.min(1, 0.35 + 0.75 * (1 - u)) * (1 - u * u);
        for (let side = 0; side < 2; side++) {
          const o = (base + s * 2 + side) * 4;
          col[o] = 0.04;
          col[o + 1] = 0.02;
          col[o + 2] = 0.03;
          col[o + 3] = a;
        }
        if (s < LEE_SEGS) {
          const i0 = base + s * 2;
          idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", pos);
    geo.setAttribute("color", new THREE.BufferAttribute(col, 4));
    geo.setIndex(idx);
    const lee = new THREE.Mesh(geo, this.leeMat);
    lee.name = "lustLee";
    lee.frustumCulled = false;
    lee.renderOrder = 1;
    lee.visible = false;
    this.lee = lee;
    this.leePos = pos;
    this.leeVer = -1;
    this.group.add(lee);
    this.updateLee();
  }

  /** Re-lay the wedges along the current wind (once per wind change). */
  private updateLee() {
    const wb = this.wb;
    const pos = this.leePos;
    if (!wb || !pos) return;
    this.leeVer = this.windVer;
    const arr = pos.array as Float32Array;
    const wx = this.wx;
    const wy = this.wy;
    const px = -wy;
    const py = wx;
    const app = this.app;
    let v = 0;
    for (let w = 0; w < wb.length; w++) {
      const rk = wb[w]!;
      const r = rk.r;
      const start = r * 0.35;
      const end = r + leeLen(r);
      for (let s = 0; s <= LEE_SEGS; s++) {
        const a = start + ((end - start) * s) / LEE_SEGS;
        const half = leeHalf(r, a) + 0.12;
        for (let side = 0; side < 2; side++) {
          const k = side === 0 ? -half : half;
          const x = rk.x + wx * a + px * k;
          const z = rk.y + wy * a + py * k;
          arr[v++] = x;
          arr[v++] = app.surfaceY(x, z, 0.05);
          arr[v++] = z;
        }
      }
    }
    pos.needsUpdate = true;
  }

  // ——— events ——————————————————————————————————————————————————————————————

  /** Minos coils N times: rings land at coilStart + ms[k]. */
  startCoil(judgeId: string, n: number, ms: number[]) {
    this.coilStart = performance.now();
    this.coilN = Math.min(COILS, Math.max(0, n | 0));
    for (let k = 0; k < COILS; k++) this.coilMs[k] = Number(ms[k]) || 1000 + k * 500;
    this.attachCoils(judgeId);
  }

  /** While the flock shields him, his coils ride loose round him, turning slowly. */
  private wardShown = false;
  private tickWardCoils(now: number) {
    // (re-find the Judge now and then: he may have fallen and risen as a new node)
    if (this.minosWard && (this.frame % 30 === 0 || !this.coilJudge)) this.attachCoils("minos_gate");
    if (!this.minosWard || !this.coilJudge) {
      if (this.wardShown) {
        for (const c of this.coils) c.visible = false;
        this.wardShown = false;
      }
      return;
    }
    this.wardShown = true;
    for (let k = 0; k < COILS; k++) {
      const c = this.coils[k]!;
      const fit = (k === 0 ? 1.36 : k === 1 ? 1.3 : 1.06) * 1.25;
      c.visible = true;
      c.position.set(0, 0.85 + k * 0.85 + Math.sin(now * 0.002 + k * 2) * 0.12, 0);
      c.scale.set(fit, fit, 1);
      c.rotation.set(Math.PI / 2 + Math.sin(now * 0.0015 + k) * 0.25, 0, now * 0.0012 * (k % 2 ? -1 : 1));
    }
  }

  // ——— per frame ———————————————————————————————————————————————————————————

  strength(now: number): number {
    if (this.phase !== "gust") return 0;
    return gustEnvelope((now - this.t0) / 1000, (this.t1 - now) / 1000, this.power);
  }

  /** Seconds left in the current phase (≥ 0). */
  leftSec(now: number): number {
    return Math.max(0, (this.t1 - now) / 1000);
  }

  tick(dt: number) {
    const app = this.app;
    const now = performance.now();
    this.frame++;
    // run the clock on between messages: the warning becomes the gust on time
    if (now >= this.t1) {
      if (this.phase === "warn") {
        this.phase = "gust";
        this.t0 = this.t1;
        this.t1 = this.t0 + GUST_GUESS_MS;
      } else if (this.phase === "gust") {
        this.phase = "calm";
        this.t0 = this.t1;
        this.t1 = this.t0 + 6000;
        this.judged = false;
        this.power = 1;
      }
    }
    this.str = this.strength(now);
    const warnU = this.phase === "warn" ? Math.min(1, (now - this.t0) / (STORM.warn * 1000)) : 0;
    const visT = this.phase === "gust" ? Math.max(0.75, Math.min(1, this.str)) : this.phase === "warn" ? 0.3 + 0.4 * warnU : 0;
    const kv = 1 - Math.exp(-dt * 6);
    this.vis += (visT - this.vis) * kv;
    const leeT = this.phase === "gust" ? 1 : this.phase === "warn" ? warnU : 0;
    this.leeVis += (leeT - this.leeVis) * (1 - Math.exp(-dt * (leeT > this.leeVis ? 8 : 3)));
    if (this.leeVer !== this.windVer) this.updateLee();
    if (this.lee) {
      this.lee.visible = this.leeVis > 0.01;
      this.leeMat.opacity = 0.78 * this.leeVis;
    }
    const you = app.renderYou;
    this.sheltered = inLee(this.wb, this.wx, this.wy, you.x, you.y);

    this.tickStreamers(dt);
    this.tickAsh();
    this.tickHero();
    this.tickTether(dt, now);
    this.tickCoils(dt, now);
    if ((this.frame & 1) === 0) this.tickRibbons();
    this.tickHud(now);
  }

  private tickStreamers(dt: number) {
    const app = this.app;
    const cx = app.camFollow.x;
    const cz = app.camFollow.z;
    const wx = this.wx;
    const wy = this.wy;
    const px = -wy;
    const py = wx;
    const g = Math.max(this.str, this.vis * 0.45);
    const speedK = 3 + 19 * g;
    const bright = 0.12 + 0.6 * this.vis;
    const R = 24;
    const yaw = Math.atan2(-wy, wx);
    _qTilt.setFromEuler(_eu.set(0.55, 0, 0));
    _q.setFromAxisAngle(_up, yaw).multiply(_qTilt);
    const m = this.streamers;
    for (let i = 0; i < this.n; i++) {
      this.sage[i] += dt;
      let x = this.sx[i];
      let z = this.sz[i];
      const along = (x - cx) * wx + (z - cz) * wy;
      const side = (x - cx) * px + (z - cz) * py;
      if (this.sage[i] > this.slife[i] || along > R || along < -R - 4 || Math.abs(side) > R) {
        // respawn upwind of the view, anywhere across it
        const k = i + this.frame * 0.618;
        const a = -R + (((k * 0.3713) % 1) + 1) % 1 * R * 1.4;
        const s = ((((k * 0.7919) % 1) + 1) % 1 - 0.5) * 2 * R;
        x = cx + wx * a + px * s;
        z = cz + wy * a + py * s;
        this.sx[i] = x;
        this.sz[i] = z;
        this.sy[i] = app.standY(x, z, 0.5 + ((k * 0.1731) % 1) * 2.8);
        this.slen[i] = 1.2 + ((k * 0.4217) % 1) * 2.2;
        this.sspd[i] = 0.7 + ((k * 0.2957) % 1) * 0.6;
        this.slife[i] = 1.6 + ((k * 0.5311) % 1) * 2.2;
        this.sage[i] = 0;
      }
      const sp = speedK * this.sspd[i];
      this.sx[i] += wx * sp * dt;
      this.sz[i] += wy * sp * dt;
      const u = this.sage[i] / this.slife[i];
      const fade = Math.min(1, u * 5) * Math.min(1, (1 - u) * 4);
      const b = bright * fade;
      _p.set(this.sx[i], this.sy[i], this.sz[i]);
      _s.set(this.slen[i] * (0.7 + 1.1 * g), 1, 1 + 0.6 * g);
      _m4.compose(_p, _q, _s);
      m.setMatrixAt(i, _m4);
      m.setColorAt(i, _col.setRGB(b, b * 0.94, b * 0.92));
    }
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor!.needsUpdate = true;
  }

  private tickAsh() {
    const ash = this.app.ash;
    if (!ash) return;
    const k = 1.2 + 1.6 * this.vis + 9 * this.str;
    ash.windX = this.wx * k;
    ash.windZ = this.wy * k;
  }

  private tickHero() {
    const hm = this.app.heroMotor;
    if (!hm) return;
    hm.extVelX = this.driftX;
    hm.extVelY = this.driftY;
    const cloth = this.sheltered ? this.vis * 0.15 : this.vis * 0.35 + this.str * 0.9;
    hm.clothWindX = this.wx * cloth;
    hm.clothWindY = this.wy * cloth;
  }

  private tickTether(dt: number, now: number) {
    const lov = this.lov;
    const nodes = this.app.nodes;
    let show = false;
    if (lov && lov[2] === 1) {
      const a = nodes.get(lov[0]);
      const b = nodes.get(lov[1]);
      if (a && b) {
        const pa = a.group.position;
        const pb = b.group.position;
        const h = 1.85;
        _v.set(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
        const len = _v.length();
        if (len > 0.2) {
          show = true;
          _v.multiplyScalar(1 / len);
          _q.setFromUnitVectors(_up, _v);
          const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
          this.tether.position.set((pa.x + pb.x) / 2, (pa.y + pb.y) / 2 + h, (pa.z + pb.z) / 2);
          this.tether.quaternion.copy(_q);
          this.halo.position.copy(this.tether.position);
          this.halo.quaternion.copy(_q);
          this.tether.scale.set(0.07 + 0.03 * pulse, len, 0.07 + 0.03 * pulse);
          this.halo.scale.set(0.24 + 0.08 * pulse, len, 0.24 + 0.08 * pulse);
        }
      }
    }
    this.tether.visible = show;
    this.halo.visible = show;
  }

  /** Hang the coils on the Judge's body (once per Judge node). */
  private attachCoils(judgeId: string): boolean {
    const rec = this.app.nodes.get(judgeId);
    if (!rec) return false;
    const body = (rec.group.userData.mob as { body?: THREE.Object3D } | undefined)?.body ?? rec.group;
    if (this.coilJudge !== body) {
      for (const c of this.coils) body.add(c);
      this.coilJudge = body;
      this.tail = rec.group.getObjectByName("judgeTail") ?? null;
      this.tailBase = this.tail ? this.tail.rotation.y : 0;
    }
    return true;
  }

  private tickCoils(dt: number, now: number) {
    const n = this.coilN;
    if (this.coilStart < 0) {
      this.tickWardCoils(now);
      return;
    }
    const e = now - this.coilStart;
    let any = false;
    for (let k = 0; k < COILS; k++) {
      const c = this.coils[k]!;
      const land = this.coilMs[k]!;
      if (k >= n || e >= land || !this.coilJudge) {
        c.visible = false;
        continue;
      }
      any = true;
      const u = Math.max(0, Math.min(1, e / land));
      // each coil drops onto the robe and cinches tight as its ring fills
      const fit = k === 0 ? 1.36 : k === 1 ? 1.3 : 1.06;
      const s = fit * (1 + 0.75 * (1 - u) * (1 - u));
      c.visible = true;
      c.position.set(0, 0.85 + k * 0.85 + (1 - u) * 0.9, 0);
      c.scale.set(s, s, 1 + 0.6 * u);
      c.rotation.set(Math.PI / 2 + Math.sin(now * 0.004 + k) * 0.12 * (1 - u), 0, now * 0.003 * (k % 2 ? -1 : 1));
    }
    if (this.tail) {
      if (any) this.tailSpin += dt * 5.5;
      else this.tailSpin *= Math.exp(-dt * 6);
      this.tail.rotation.y = this.tailBase + this.tailSpin;
    }
    if (!any && Math.abs(this.tailSpin) < 0.01) {
      this.coilStart = -1;
      if (this.tail) this.tail.rotation.y = this.tailBase;
    }
  }

  /** Shades' ribbons stream downwind (a local offset: the idle spin keeps running). */
  private tickRibbons() {
    const app = this.app;
    const cx = app.camFollow.x;
    const cz = app.camFollow.z;
    const k = 0.1 + 0.28 * this.vis + 0.3 * this.str;
    // (the shade list is refreshed every ~half second, not walked out of the node map
    // every frame)
    const recs = this.ribRecs;
    if (this.frame - this.ribAt > 30) {
      this.ribAt = this.frame;
      recs.length = 0;
      for (const rec of app.nodes.values()) {
        if (rec.kind === "whirl" || rec.kind === "champion") recs.push(rec);
      }
    }
    for (let ri = 0; ri < recs.length; ri++) {
      const rec = recs[ri]!;
      if (!rec.group.parent) continue;
      const gp = rec.group.position;
      const dx = gp.x - cx;
      const dz = gp.z - cz;
      if (dx * dx + dz * dz > 36 * 36) continue;
      let ribs = rec.group.userData.lustRibs as THREE.Object3D[] | undefined;
      if (!ribs) {
        ribs = [];
        rec.group.traverse((o) => {
          if (o.name === "ribbon" || o.name === "ribbon2") ribs!.push(o);
        });
        rec.group.userData.lustRibs = ribs;
      }
      const yaw = rec.group.rotation.y;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      // world planar (wx, wy) → the model's local (x, z)
      const lx = (this.wx * c - this.wy * s) * k;
      const lz = (this.wx * s + this.wy * c) * k;
      for (let i = 0; i < ribs.length; i++) {
        const r = ribs[i]!;
        const m = i === 0 ? 1 : 1.4;
        r.position.x = lx * m;
        r.position.z = lz * m;
      }
    }
  }

  private tickHud(now: number) {
    const hud = this.hud;
    if (!hud) return;
    const cam = this.app.camera;
    cam.getWorldDirection(_v);
    let fx = _v.x;
    let fz = _v.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    // screen right = forward × up = (−fz, fx) in the plane
    const sRight = this.wx * -fz + this.wy * fx;
    const sUp = this.wx * fx + this.wy * fz;
    const ang = Math.atan2(-sUp, sRight);
    // (the label string is rebuilt only when its text would change — not per frame)
    const key =
      this.phase === "warn"
        ? Math.ceil(this.leftSec(now) * 10)
        : this.phase === "gust"
          ? this.judged
            ? -1
            : this.sheltered
              ? -2
              : -3
          : -4;
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.hudLabel =
        key >= 0 ? `bufera ${(key / 10).toFixed(1)}s` : key === -1 ? "the sentence" : key === -2 ? "in the lee" : key === -3 ? "la bufera" : "";
    }
    hud.update(this.phase, ang, this.hudLabel);
  }

  dispose() {
    const app = this.app;
    app.scene.remove(this.group);
    for (const c of this.coils) c.parent?.remove(c);
    if (this.tail) this.tail.rotation.y = this.tailBase;
    disposeNode3D(this.group);
    this.hud?.dispose();
    this.hud = null;
    if (app.ash) {
      app.ash.windX = 2.2;
      app.ash.windZ = 0;
    }
    const hm = app.heroMotor;
    if (hm) {
      hm.extVelX = 0;
      hm.extVelY = 0;
      hm.clothWindX = 0;
      hm.clothWindY = 0;
    }
  }
}

