/**
 * Ground telegraphs (server `telegraph` messages): circle / ring / cone / line shapes on
 * the floor whose fill grows from the attacker to the far edge over the windup, with a
 * bright rim from the first frame and a flash when the blow lands.
 *
 * One shader draws every shape (signed distance per shape, fwidth-antialiased), on a
 * small grid stretched over the shape's bounds and draped over what is drawn beneath it
 * (floor triangles and the boss dais — ground.surfaceAt), so no part of a shape hides
 * inside the dais or a rise in the dirt. A fixed pool of slots is built up front — each
 * slot has its own material (per-instance colour/progress uniforms) and drape heights,
 * but they all share one program, so starting a telegraph never compiles; the drape is
 * sampled once per start, nothing per frame. Timing is on performance.now() (not the
 * world's animT, which slows during hit-stop), so the fill runs in step with the
 * server's windup; on a link slower than the server's dodge grace the fill ends early
 * by the excess (visibleWindupMs), so "out by the time it fills" is always safe.
 */
import * as THREE from "three";
import { markShared } from "./dispose";

export type TelegraphMsg = {
  id: string;
  attackerId?: string | null;
  shape: "circle" | "ring" | "cone" | "line";
  x: number;
  y: number;
  dir?: number;
  radius?: number;
  length?: number;
  width?: number;
  arc?: number;
  inner?: number;
  /** ms */
  duration: number;
  kind?: string;
  dmg?: number;
  /** Optional colours [base, hot, rim] (a hazard that should read apart from foe blows). */
  pal?: [number, number, number];
};

/** A telegraph that just landed (host plays the shock / camera for slams). */
export type TelegraphLand = {
  id: string;
  kind: string;
  shape: string;
  x: number;
  y: number;
  /** reach: radius (circle/ring/cone) or length (line) */
  r: number;
  attackerId: string;
};

export type TelePalette = { base: number; hot: number; rim: number };

const SHAPE_ID: Record<string, number> = { circle: 0, ring: 1, cone: 2, line: 3 };
/** After the fill reaches the edge: a short flash, then the slot frees. */
const LAND_MS = 170;
const POOL = 14;
/** Drape grid: cells per side (13×13 heights sampled once per telegraph start). */
const GRID = 12;
/** Height above the drawn surface. */
const LIFT = 0.07;

/** Server telegraph.mjs GRACE_CAP_MS + the move-packet beat its grace adds. */
const SERVER_GRACE_CAP_MS = 220;
const MOVE_PACKET_MS = 30;

/**
 * How long to draw a windup of `durationMs` on a link with round trip `rttMs`. The
 * server waits up to its grace cap for a dodge sent as the fill ends; past that the
 * fill finishes early by the excess (never below 60% of the windup).
 */
export function visibleWindupMs(durationMs: number, rttMs: number): number {
  const excess = Math.max(0, (Number(rttMs) || 0) + MOVE_PACKET_MS - SERVER_GRACE_CAP_MS);
  return Math.max(durationMs * 0.6, durationMs - excess);
}

const VERT = /* glsl */ `
  uniform vec4 uExt;
  attribute float aH;
  varying vec2 vP;
  void main() {
    vec2 k = position.xz * 0.5 + 0.5;
    vec2 p = vec2(mix(uExt.x, uExt.y, k.x), mix(uExt.z, uExt.w, k.y));
    vP = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, aH, p.y, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform int uShape;
  uniform vec4 uP;
  uniform float uU;
  uniform float uLand;
  uniform float uAlpha;
  uniform float uPulse;
  uniform vec3 uBase;
  uniform vec3 uHot;
  uniform vec3 uRim;
  varying vec2 vP;
  void main() {
    float d = length(vP);
    float sd;
    float prog;
    if (uShape == 0) {
      sd = d - uP.x;
      prog = d / uP.x;
    } else if (uShape == 1) {
      sd = max(d - uP.x, uP.y - d);
      prog = (d - uP.y) / max(0.01, uP.x - uP.y);
    } else if (uShape == 2) {
      float ang = abs(atan(vP.y, vP.x));
      float side = d * sin(clamp(ang - uP.z * 0.5, -1.5707, 1.5707));
      sd = max(d - uP.x, side);
      prog = d / uP.x;
    } else {
      sd = max(max(-vP.x, vP.x - uP.z), abs(vP.y) - uP.y * 0.5);
      prog = vP.x / uP.z;
    }
    float aa = max(fwidth(sd), 0.004) * 1.25;
    float body = 1.0 - smoothstep(-aa, aa, sd);
    if (body <= 0.0) discard;
    // rim band inside the edge (thicker on big shapes so phones still read it)
    float rimW = 0.09 + uP.w;
    float rim = 1.0 - smoothstep(rimW - aa, rimW + aa, -sd);
    // fill grows from the attacker to the edge; a bright leading front
    float fill = 1.0 - smoothstep(uU - 0.025, uU + 0.005, prog);
    float front = (1.0 - smoothstep(0.0, 0.06, abs(prog - uU))) * step(0.02, uU);
    vec3 col = mix(uBase, uHot, fill * (0.55 + 0.45 * uU));
    col = mix(col, uRim, max(rim, front * 0.8));
    col += uLand * vec3(0.9, 0.8, 0.6);
    float a = 0.3 + fill * (0.18 + 0.3 * uU) + rim * (0.55 + 0.35 * uPulse) + front * 0.4;
    a = max(a, uLand * 0.85);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * body * uAlpha);
    #include <colorspace_fragment>
  }
`;

type Slot = {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  /** drape heights (world Y per grid vertex) */
  h: THREE.BufferAttribute;
  active: boolean;
  id: string;
  kind: string;
  shape: string;
  attackerId: string;
  x: number;
  y: number;
  reach: number;
  start: number;
  dur: number;
  landed: boolean;
};

/** Grid vertex positions in [0,1]² (shared by every slot's drape sampling). */
let gridK: Float32Array | null = null;
/** A slot's grid: the unit plane (xz in [-1,1]) plus its own height attribute. */
function slotGeo(): { geo: THREE.BufferGeometry; h: THREE.BufferAttribute } {
  const geo = new THREE.PlaneGeometry(2, 2, GRID, GRID).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  if (!gridK) {
    gridK = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      gridK[i * 2] = pos.getX(i) * 0.5 + 0.5;
      gridK[i * 2 + 1] = pos.getZ(i) * 0.5 + 0.5;
    }
  }
  const h = new THREE.BufferAttribute(new Float32Array(pos.count), 1);
  h.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aH", h);
  return { geo: markShared(geo), h };
}

function makeMat(): THREE.ShaderMaterial {
  return markShared(
    new THREE.ShaderMaterial({
      uniforms: {
        uExt: { value: new THREE.Vector4(-1, 1, -1, 1) },
        uShape: { value: 0 },
        uP: { value: new THREE.Vector4(1, 0, 0, 0) },
        uU: { value: 0 },
        uLand: { value: 0 },
        uAlpha: { value: 1 },
        uPulse: { value: 0 },
        uBase: { value: new THREE.Color(0x3a0c06) },
        uHot: { value: new THREE.Color(0xc02810) },
        uRim: { value: new THREE.Color(0xff7040) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      fog: false,
    })
  );
}

export class TelegraphRenderer {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private landed: TelegraphLand[] = [];
  private landedN = 0;

  /** surfaceY: top of what is drawn at a planar point (floor triangles / boss dais). */
  constructor(private surfaceY: (x: number, y: number) => number) {
    this.group.name = "telegraphs";
    for (let i = 0; i < POOL; i++) {
      const mat = makeMat();
      const { geo, h } = slotGeo();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = "telegraph";
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.slots.push({
        mesh,
        mat,
        h,
        active: false,
        id: "",
        kind: "",
        shape: "circle",
        attackerId: "",
        x: 0,
        y: 0,
        reach: 1,
        start: 0,
        dur: 1,
        landed: false,
      });
      this.landed.push({ id: "", kind: "", shape: "", x: 0, y: 0, r: 0, attackerId: "" });
    }
  }

  /** One hidden slot stays compiled via prewarm: show slot 0 invisibly to the compiler. */
  get warmMesh(): THREE.Mesh {
    return this.slots[0]!.mesh;
  }

  /**
   * Start drawing a telegraph (reuses the oldest slot when all are busy). durMs: how
   * long the fill runs here (visibleWindupMs of the message's duration).
   */
  start(m: TelegraphMsg, nowMs: number, pal: TelePalette, durMs: number): void {
    let slot = this.slots.find((s) => !s.active);
    if (!slot) slot = this.slots.reduce((a, b) => (a.start < b.start ? a : b));
    const shape = SHAPE_ID[m.shape] != null ? m.shape : "circle";
    const u = slot.mat.uniforms;
    const dir = Number(m.dir) || 0;
    const R = Math.max(0.2, Number(m.radius) || 1);
    let reach = R;
    // shape params + local bounds (x forward along dir, y to the left)
    const ext = u.uExt.value as THREE.Vector4;
    const p = u.uP.value as THREE.Vector4;
    if (shape === "line") {
      const L = Math.max(0.3, Number(m.length) || 3);
      const W = Math.max(0.2, Number(m.width) || 1);
      reach = L;
      p.set(0, W, L, Math.min(0.08, W * 0.06));
      ext.set(-0.2, L + 0.2, -W * 0.5 - 0.2, W * 0.5 + 0.2);
    } else if (shape === "cone") {
      const arc = Math.min(Math.PI * 2, Math.max(0.2, Number(m.arc) || Math.PI / 2));
      p.set(R, 0, arc, Math.min(0.1, R * 0.03));
      const half = arc / 2;
      const minX = half > Math.PI / 2 ? -R * Math.min(1, -Math.cos(half)) - 0.2 : -0.2;
      const side = half > Math.PI / 2 ? R + 0.2 : R * Math.sin(half) + 0.2;
      ext.set(minX, R + 0.2, -side, side);
    } else if (shape === "ring") {
      const inner = m.inner != null ? Number(m.inner) : Math.max(0, R - (Number(m.width) || 1));
      p.set(R, inner, 0, Math.min(0.1, R * 0.03));
      ext.set(-R - 0.2, R + 0.2, -R - 0.2, R + 0.2);
    } else {
      p.set(R, 0, 0, Math.min(0.12, R * 0.03));
      ext.set(-R - 0.2, R + 0.2, -R - 0.2, R + 0.2);
    }
    u.uShape.value = SHAPE_ID[shape]!;
    u.uU.value = 0;
    u.uLand.value = 0;
    u.uAlpha.value = 1;
    (u.uBase.value as THREE.Color).setHex(pal.base);
    (u.uHot.value as THREE.Color).setHex(pal.hot);
    (u.uRim.value as THREE.Color).setHex(pal.rim);
    const x = Number(m.x) || 0;
    const y = Number(m.y) || 0;
    const kind = String(m.kind || "");
    // Drape: each grid vertex a few cm over the floor / dais under it (bosses' slams
    // lie on the dais, a cone crossing its edge climbs it)
    const c = Math.cos(dir);
    const sn = Math.sin(dir);
    const k = gridK!;
    const hs = slot.h.array as Float32Array;
    for (let i = 0; i < hs.length; i++) {
      const lx = ext.x + (ext.y - ext.x) * k[i * 2]!;
      const lz = ext.z + (ext.w - ext.z) * k[i * 2 + 1]!;
      hs[i] = this.surfaceY(x + c * lx - sn * lz, y + sn * lx + c * lz) + LIFT;
    }
    slot.h.needsUpdate = true;
    slot.mesh.position.set(x, 0, y);
    slot.mesh.rotation.set(0, -dir, 0);
    slot.mesh.visible = true;
    slot.active = true;
    slot.id = String(m.id);
    slot.kind = kind;
    slot.shape = shape;
    slot.attackerId = String(m.attackerId ?? "");
    slot.x = x;
    slot.y = y;
    slot.reach = reach;
    slot.start = nowMs;
    slot.dur = Math.max(60, Number(durMs) || Number(m.duration) || 500);
    slot.landed = false;
  }

  /** Server broke the windup (stagger, death, leash): fade it out now. */
  cancel(id: string, nowMs: number) {
    for (const s of this.slots) {
      if (!s.active || s.id !== id || s.landed) continue;
      // fade from here without the landing flash
      s.landed = true;
      s.dur = Math.max(1, nowMs - s.start);
      s.kind = "cancel";
    }
  }

  /** Is `attackerId` winding up right now? (progress 0..1 or -1) */
  windupOf(attackerId: string, nowMs: number): number {
    for (const s of this.slots) {
      if (!s.active || s.landed || s.attackerId !== attackerId) continue;
      return Math.min(1, (nowMs - s.start) / s.dur);
    }
    return -1;
  }

  /**
   * Per rendered frame. Returns how many telegraphs landed this frame; read them with
   * landedAt(i) (a reused record — copy what you keep).
   */
  tick(nowMs: number): number {
    this.landedN = 0;
    const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.018);
    for (const s of this.slots) {
      if (!s.active) continue;
      const u = s.mat.uniforms;
      const e = nowMs - s.start;
      if (e < s.dur) {
        u.uU.value = Math.max(0, e / s.dur);
        u.uPulse.value = pulse;
        continue;
      }
      if (!s.landed) {
        s.landed = true;
        if (this.landedN < this.landed.length) {
          const l = this.landed[this.landedN++]!;
          l.id = s.id;
          l.kind = s.kind;
          l.shape = s.shape;
          l.x = s.x;
          l.y = s.y;
          l.r = s.reach;
          l.attackerId = s.attackerId;
        }
      }
      const k = (e - s.dur) / LAND_MS;
      if (k >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      u.uU.value = 1;
      const cancelled = s.kind === "cancel";
      u.uLand.value = cancelled ? 0 : Math.max(0, 1 - k * 1.6);
      u.uAlpha.value = (1 - k) * (cancelled ? 0.6 : 1);
    }
    return this.landedN;
  }

  landedAt(i: number): TelegraphLand {
    return this.landed[i]!;
  }

  /** Drop everything (canto travel). */
  clear() {
    for (const s of this.slots) {
      s.active = false;
      s.mesh.visible = false;
    }
  }
}

/** Colours by canto palette and attack weight (slams read hotter than a claw swipe). */
export function telePalette(cantoId: string | undefined, kind: string): TelePalette {
  const heavy = kind === "boss_slam" || kind === "champ_slam" || kind === "champ_cleave";
  if (cantoId === "inferno_07") {
    return heavy
      ? { base: 0x120a02, hot: 0xd09020, rim: 0xffe8a0 }
      : { base: 0x100802, hot: 0xb07818, rim: 0xf6dc90 };
  }
  if (cantoId === "inferno_06") {
    return heavy
      ? { base: 0x0c1002, hot: 0xa8c028, rim: 0xeaf890 }
      : { base: 0x0a0e02, hot: 0x8aa020, rim: 0xdcec80 };
  }
  if (kind === "wisp_dart") return { base: 0x1a0406, hot: 0xd8203a, rim: 0xff90a0 };
  return heavy
    ? { base: 0x1c0402, hot: 0xff3a0c, rim: 0xffc070 }
    : { base: 0x1a0402, hot: 0xe8300e, rim: 0xffa060 };
}
