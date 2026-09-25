/**
 * D4-style minimap + screen-edge arrows.
 *
 * The minimap turns with the camera (screen-up = camera forward), so a gate at
 * the top of the map is at the top of the screen. Two arrows at most:
 *   objective — gold, driven by the one objective model (world/objective.ts);
 *   foe       — nearest foe that is NOT on screen (and not the objective).
 * Redraws are throttled (map ~12 Hz, arrows ~20 Hz) and DOM is written only on
 * change; arrows move by transform.
 */
import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";
import type { Objective } from "../world/objective";
import { GATE_LABEL_RANGE, gateState, isTwinExitOf, type GateState } from "../world/gates";

type Vec2 = { x: number; y: number };

const RANGE = 38;
/** Avarice gold road is long — pull the map out so Crush/CW/hub gate fit. */
const RANGE_AVA = 48;
const MAP_EVERY_MS = 80;
const ARROW_EVERY_MS = 50;
/** Nearest-foe arrow only for foes this close (further ones are the objective's job). */
const FOE_ARROW_RANGE = 40;
/** Arrows clamped under the hero slide at least this far sideways (px). */
const HERO_CLEAR_PX = 78;
const _ndc = new Vector3();
const _dir = new Vector3();

const GATE_FILL: Record<GateState, string> = {
  forward: "#ffd46a",
  return: "#9cc0ee",
  locked: "#6a6658",
};

type ArrowEl = {
  el: HTMLElement;
  chev: HTMLElement;
  lab: HTMLElement;
  dist: HTMLElement;
  x: number;
  y: number;
  ang: number;
  shown: boolean;
  label: string;
  distTxt: string;
  dest: string;
};

export type RadarTick = {
  you: Vec2;
  aimX: number;
  aimY: number;
  bounds: { width: number; height: number };
  entities: any[];
  cantoId: string;
  camera: PerspectiveCamera;
  compact: boolean;
  firstClears?: string[];
  objective: Objective | null;
  /** Caption under the minimap (objective target + distance, or the hold prompt). */
  hint: string;
};

export class Radar {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  hint: HTMLElement;
  compass: HTMLElement;
  private arrows = new Map<string, ArrowEl>();
  private lastHint = "";
  private lastMapAt = 0;
  private lastArrowAt = 0;
  /** Camera planar basis (forward f, right r) for the rotated map. */
  private fx = 0;
  private fz = -1;
  private rx = 1;
  private rz = 0;

  constructor() {
    this.canvas = document.getElementById("minimap-canvas") as HTMLCanvasElement;
    this.hint = document.getElementById("minimap-hint") as HTMLElement;
    this.compass = document.getElementById("canto-compass") as HTMLElement;
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.id = "minimap-canvas";
      this.canvas.width = 256;
      this.canvas.height = 256;
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("minimap canvas");
    this.ctx = ctx;
    if (!this.hint) {
      this.hint = document.createElement("div");
      this.hint.id = "minimap-hint";
    }
    if (!this.compass) {
      this.compass = document.createElement("div");
      this.compass.id = "canto-compass";
      document.body.appendChild(this.compass);
    }
  }

  tick(opts: RadarTick) {
    const now = performance.now();
    if (now - this.lastArrowAt >= ARROW_EVERY_MS) {
      this.lastArrowAt = now;
      this.drawArrows(opts);
    }
    if (now - this.lastMapAt >= MAP_EVERY_MS) {
      this.lastMapAt = now;
      this.readBasis(opts.camera);
      this.drawMap(opts, now);
    }
    if (opts.hint !== this.lastHint) {
      this.lastHint = opts.hint;
      this.hint.textContent = opts.hint;
      this.hint.classList.toggle("hidden", !opts.hint);
    }
  }

  private readBasis(camera: PerspectiveCamera) {
    camera.getWorldDirection(_dir);
    const len = Math.hypot(_dir.x, _dir.z) || 1;
    this.fx = _dir.x / len;
    this.fz = _dir.z / len;
    // right = forward × up
    this.rx = -this.fz;
    this.rz = this.fx;
  }

  private drawMap(opts: RadarTick, now: number) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const range = opts.cantoId === "inferno_07" ? RANGE_AVA : RANGE;
    const scale = (w * 0.46) / range;
    const { fx, fz, rx, rz } = this;
    const ux = opts.you.x;
    const uy = opts.you.y;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0c0b08ee";
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c9a22799";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = "#6a5e3f44";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.32, 0, Math.PI * 2);
    ctx.stroke();

    // Canto floor, drawn in world units through the camera-yaw transform
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.47, 0, Math.PI * 2);
    ctx.clip();
    ctx.setTransform(
      rx * scale,
      -fx * scale,
      rz * scale,
      -fz * scale,
      cx - (ux * rx + uy * rz) * scale,
      cy + (ux * fx + uy * fz) * scale
    );
    ctx.fillStyle = "#3a342855";
    ctx.fillRect(0, 0, opts.bounds.width, opts.bounds.height);
    // Avarice gold road tint — measure lane readable on the map
    if (opts.cantoId === "inferno_07") {
      const road: [number, number][] = [
        [18, 52], [28, 50], [38, 56], [54, 68], [70, 48], [86, 58], [110, 52], [138, 48],
      ];
      ctx.strokeStyle = "#d4a84066";
      ctx.lineWidth = 3.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i < road.length; i++) {
        if (i === 0) ctx.moveTo(road[i][0], road[i][1]);
        else ctx.lineTo(road[i][0], road[i][1]);
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const ring = (px: number, py: number, r: number, fill: string, stroke?: string) => {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };

    const rim = w * 0.45;
    const clears = opts.firstClears || [];
    const objId = opts.objective?.target?.id ?? null;
    let objX = 0;
    let objY = 0;
    let objOn = false;
    let objFound = false;
    for (const e of opts.entities) {
      const dxw = e.x - ux;
      const dyw = e.y - uy;
      const dx = (dxw * rx + dyw * rz) * scale;
      const dy = -(dxw * fx + dyw * fz) * scale;
      const d = Math.hypot(dx, dy);
      const on = d <= rim;
      const sx = on ? cx + dx : cx + (dx / d) * rim;
      const sy = on ? cy + dy : cy + (dy / d) * rim;
      if (objId && String(e.id) === objId) {
        objX = sx;
        objY = sy;
        objOn = on;
        objFound = true;
      }

      if (e.kind === "exit" || e.poiKind === "portal") {
        if (isTwinExitOf(e, opts.entities)) continue;
        const st = gateState(e, opts.cantoId, clears);
        const fill = GATE_FILL[st];
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = fill;
        ctx.globalAlpha = st === "locked" ? 0.55 : 1;
        const s = st === "forward" ? 6 : 5;
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.strokeStyle = "#1a1408";
        ctx.lineWidth = 1.2;
        ctx.strokeRect(-s, -s, s * 2, s * 2);
        ctx.restore();
        if (!on && st !== "locked") this.rimChevron(ctx, sx, sy, fill);
      } else if (e.kind === "boss") {
        ring(sx, sy, on ? 6 : 5, "#d63a2a", "#ffc8b8");
      } else if (e.kind === "mob") {
        if (!on) continue;
        ring(sx, sy, e.champion ? 4.5 : 3.2, e.champion ? "#e8c86a" : "#c44a3a");
      } else if (e.kind === "loot") {
        if (on) ring(sx, sy, 2.4, "#f0d982");
      } else if (e.kind === "poi" || e.poiKind) {
        if (!on) continue;
        ring(sx, sy, 3.2, "#d9cfae", "#8a7030");
      }
    }

    // Objective blip: pulsing gold halo (on the rim with a chevron when off-map)
    if (objFound) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 214, 106, ${0.55 + 0.45 * pulse})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(objX, objY, 9 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (!objOn) this.rimChevron(ctx, objX, objY, "#ffd46a");
    }

    // Hero pip: aim turned into the rotated map frame
    const sx = opts.aimX * rx + opts.aimY * rz;
    const sy = -(opts.aimX * fx + opts.aimY * fz);
    const facing = Math.atan2(sx, -sy);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(facing);
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fillStyle = "#ffe8a0";
    ctx.strokeStyle = "#1a1408";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private rimChevron(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    const ang = Math.atan2(y - ctx.canvas.height * 0.5, x - ctx.canvas.width * 0.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 3);
    ctx.lineTo(-4, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private arrow(id: string): ArrowEl {
    let a = this.arrows.get(id);
    if (a) return a;
    const el = document.createElement("div");
    el.className = "compass-arrow";
    el.innerHTML = `<i class="compass-chevron"></i><span class="compass-label"></span><span class="compass-dist"></span>`;
    this.compass.appendChild(el);
    a = {
      el,
      chev: el.querySelector(".compass-chevron") as HTMLElement,
      lab: el.querySelector(".compass-label") as HTMLElement,
      dist: el.querySelector(".compass-dist") as HTMLElement,
      x: NaN,
      y: NaN,
      ang: NaN,
      shown: true,
      label: "",
      distTxt: "",
      dest: "",
    };
    this.arrows.set(id, a);
    return a;
  }

  private place(a: ArrowEl, show: boolean, x: number, y: number, ang: number, dest: string, label: string, distTxt: string) {
    if (a.shown !== show) {
      a.shown = show;
      a.el.style.opacity = show ? "1" : "0";
    }
    if (!show) return;
    if (a.dest !== dest) {
      a.dest = dest;
      a.el.dataset.dest = dest;
    }
    if (a.label !== label) {
      a.label = label;
      a.lab.textContent = label;
    }
    if (a.distTxt !== distTxt) {
      a.distTxt = distTxt;
      a.dist.textContent = distTxt;
    }
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx !== a.x || ry !== a.y) {
      a.x = rx;
      a.y = ry;
      a.el.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    }
    const ra = Math.round(ang);
    if (ra !== a.ang) {
      a.ang = ra;
      a.chev.style.setProperty("--ang", `${ra}deg`);
    }
  }

  private drawArrows(opts: RadarTick) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Phone HUD v2: keep arrows in the open band between the vitals strip and
    // the stick / thumb arc (see styles.css "HUD v2").
    const landscape = document.body.classList.contains("hud-landscape");
    // Landscape: right pad clears the minimap column, bottom pad the thumb arc.
    // Desktop: right pad clears the minimap disc, top/bottom the plates + bar.
    // (side pads keep half a label on screen: labels are centred on the chevron)
    const padL = opts.compact ? 48 : 64;
    const padR = opts.compact ? (landscape ? 150 : 48) : 200;
    // (portrait: below the minimap column + menu seals)
    const padT = opts.compact ? (landscape ? 44 : 240) : 96;
    const padB = opts.compact ? (landscape ? 190 : 300) : 100;

    const obj = opts.objective?.target ?? null;
    const oa = this.arrow("objective");
    if (obj) {
      const d = Math.hypot(obj.x - opts.you.x, obj.y - opts.you.y);
      const p = this.projectEdge(opts.camera, obj.x, obj.y, vw, vh, padL, padT, padR, padB);
      // On screen and close: the world label / beacon carries it
      // (gate labels show name + distance to GATE_LABEL_RANGE; past that the arrow is the label)
      const hide = p.visible && d <= (obj.kind === "gate" ? GATE_LABEL_RANGE : 16);
      this.place(oa, !hide, p.x, p.y, p.ang, "objective", obj.label, `${Math.round(d)}m`);
    } else {
      this.place(oa, false, 0, 0, 0, "", "", "");
    }

    let foe: any = null;
    let foeD = FOE_ARROW_RANGE;
    for (const e of opts.entities) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      if (e.hp != null && e.hp <= 0) continue;
      if (obj && String(e.id) === obj.id) continue;
      const d = Math.hypot(e.x - opts.you.x, e.y - opts.you.y);
      if (d < foeD) {
        foeD = d;
        foe = e;
      }
    }
    const fa = this.arrow("foe");
    if (foe) {
      const p = this.projectEdge(opts.camera, foe.x, foe.y, vw, vh, padL, padT, padR, padB);
      const label = foe.kind === "boss" ? "Boss" : foe.champion ? "Elite" : "Foe";
      // A foe you can already see needs no arrow
      this.place(fa, !p.visible, p.x, p.y, p.ang, "foe", label, `${Math.round(foeD)}m`);
    } else {
      this.place(fa, false, 0, 0, 0, "", "", "");
    }
  }

  /**
   * Screen point of (x, y) clamped into the arrow band. The band's own centre
   * is the clamp origin (the viewport centre sits on the hero, which on phones
   * is outside the band's middle and pinned arrows onto the hero).
   */
  private projectEdge(
    camera: PerspectiveCamera,
    x: number,
    y: number,
    vw: number,
    vh: number,
    padL: number,
    padT: number,
    padR: number,
    padB: number
  ): { x: number; y: number; ang: number; inside: boolean; visible: boolean } {
    _ndc.set(x, 1.2, y).project(camera);
    let nx = _ndc.x;
    let ny = _ndc.y;
    const behind = _ndc.z > 1;
    if (behind) {
      nx = -nx;
      ny = -ny;
    }
    const sx = (nx * 0.5 + 0.5) * vw;
    const sy = (-ny * 0.5 + 0.5) * vh;
    const left = padL;
    const right = Math.max(left + 40, vw - padR);
    const top = padT;
    const bot = Math.max(top + 40, vh - padB);
    const inside = !behind && sx > left && sx < right && sy > top && sy < bot;
    // On screen at all (the thing itself can be seen), band or not
    const visible = !behind && sx > 12 && sx < vw - 12 && sy > 12 && sy < vh - 12;
    const cx = (left + right) * 0.5;
    const cy = (top + bot) * 0.5;
    let dx = sx - cx;
    let dy = sy - cy;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) dy = -1;
    const ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (inside) return { x: sx, y: sy, ang, inside, visible };
    const hw = (right - left) * 0.5;
    const hh = (bot - top) * 0.5;
    const m = Math.max(Math.abs(dx) / (hw || 1), Math.abs(dy) / (hh || 1), 1);
    let ex = cx + dx / m;
    const ey = cy + dy / m;
    // Behind-you targets clamp onto the band's bottom edge, which on phones is
    // just over the hero's head — slide them aside so they never sit on the hero.
    const heroX = vw * 0.5;
    if (ey >= bot - 1 && Math.abs(ex - heroX) < HERO_CLEAR_PX) {
      ex = heroX + (ex >= heroX ? HERO_CLEAR_PX : -HERO_CLEAR_PX);
    }
    return { x: ex, y: ey, ang, inside, visible };
  }
}
